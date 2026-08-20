import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run } from "./helpers.mjs";

// ─────────────── the revision guard ───────────────
//
// state.json was read-modify-written with no comparison, so two writers that both loaded the
// same state produced a SILENT lost update: second write wins, first change gone, nothing
// recorded. The atomic rename already guaranteed the WRITE; the unguarded thing was the CYCLE.

/** Load state.mjs fresh with CLAUDE_PROJECT_DIR pointed at `cwd`, since constants.mjs
 *  resolves ROOT once at import time. A cache-busting query makes each load independent. */
async function freshState(cwd) {
  process.env.CLAUDE_PROJECT_DIR = cwd;
  const url = new URL("../lib/state.mjs", import.meta.url);
  return import(`${url.href}?t=${Date.now()}${Math.random()}`);
}

test("loadState stamps a revision, and a file written without one reads as 0", async () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  // init wrote via saveState, so it is already at revision 1. Simulate a 0.25.2 file:
  const p = path.join(cwd, ".conductor", "state.json");
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  delete raw.revision;
  fs.writeFileSync(p, JSON.stringify(raw, null, 2) + "\n");

  const { loadState } = await freshState(cwd);
  assert.equal(loadState().revision, 0, "a pre-0.26 state.json must load as revision 0");
});

test("a second writer holding a stale revision is REFUSED, not silently applied", async () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const { loadState, saveState, StateConflictError } = await freshState(cwd);

  const a = loadState();          // both read the same revision
  const b = loadState();

  a.epics.push({ id: "from-a", title: "a", priority: "P1", status: "queued", role: "epic", lane: "claude-code", links: [] });
  assert.equal(saveState(a).ok, true, "the first writer must succeed");

  b.epics.push({ id: "from-b", title: "b", priority: "P1", status: "queued", role: "epic", lane: "claude-code", links: [] });
  assert.throws(() => saveState(b), StateConflictError,
    "the second writer holds a stale revision and must be refused");

  // and the first writer's change must still be on disk
  const onDisk = JSON.parse(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"));
  assert.deepEqual(onDisk.epics.map(e => e.id), ["from-a"],
    "the refused write must not have clobbered the successful one");
});

test("a successful write increments the revision", async () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const { loadState, saveState } = await freshState(cwd);

  const first = loadState().revision;
  const s = loadState();
  s.active = "test-id";  // modify the state to ensure a real write
  saveState(s);
  assert.equal(loadState().revision, first + 1);
});

test("--force overwrites deliberately, and ONLY with the flag", async () => {
  // Without a documented override people learn to hand-edit state.json to get past the guard,
  // which is strictly worse than an override that leaves a trace in the command line.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const { loadState, saveState } = await freshState(cwd);

  const stale = loadState();
  const fresh = loadState();
  fresh.active = "test-id";  // modify the state to ensure a real write
  saveState(fresh);                             // advance the on-disk revision

  const argv = process.argv;
  try {
    process.argv = [...argv, "--force"];
    assert.equal(saveState(stale).ok, true, "--force must write despite the stale revision");
  } finally {
    process.argv = argv;
  }
});

test("onConflict:skip returns false instead of throwing", async () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const { loadState, saveState } = await freshState(cwd);

  const stale = loadState();
  const fresh = loadState();
  fresh.active = "test-id";  // modify the state to ensure a real write
  saveState(fresh);                             // advance the on-disk revision

  assert.equal(saveState(stale, { onConflict: "skip", verb: "render" }).ok, false,
    "a hook write must report the skip rather than exiting");
});

test("a save that changes nothing does not write and does not bump the revision", async () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const { loadState, saveState } = await freshState(cwd);

  const before = loadState().revision;
  const r = saveState(loadState());          // identical content
  assert.equal(r.unchanged, true, "an unchanged save must report itself as a no-op");
  assert.equal(loadState().revision, before, "and must not advance the revision");
});

// ─────────────── the conflict sidecar ───────────────
//
// The counter CANNOT live in state.json: that is the file the write just failed against, so
// recording the failure there would need the very write that is failing. Hence a sidecar that
// is append-only and therefore needs no guard of its own.

async function freshConflicts(cwd) {
  process.env.CLAUDE_PROJECT_DIR = cwd;
  const url = new URL("../lib/write-conflicts.mjs", import.meta.url);
  return import(`${url.href}?t=${Date.now()}${Math.random()}`);
}

test("recordConflict appends one line per skip and conflictCount counts them", async () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const { recordConflict, conflictCount } = await freshConflicts(cwd);

  assert.equal(conflictCount(), 0, "a repo with no conflicts must report zero");
  recordConflict({ verb: "render", expected: 4, found: 5 });
  recordConflict({ verb: "brief", expected: 5, found: 6 });
  assert.equal(conflictCount(), 2);

  const body = fs.readFileSync(path.join(cwd, ".conductor", "write-conflicts.log"), "utf8");
  assert.match(body, /\trender\t4\t5\n/, "the line must name the verb and both revisions");
});

test("clearConflicts resets the count — the signal is CONSECUTIVE skips, not skips ever", async () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const { recordConflict, conflictCount, clearConflicts } = await freshConflicts(cwd);

  recordConflict({ verb: "render", expected: 1, found: 2 });
  recordConflict({ verb: "render", expected: 1, found: 3 });
  clearConflicts();
  assert.equal(conflictCount(), 0, "a successful write must reset, or one bad hour nags forever");
});

test("the log rotates on SIZE to a .prev, and rotation never reads the body", async () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const { recordConflict } = await freshConflicts(cwd);
  const logPath = path.join(cwd, ".conductor", "write-conflicts.log");

  // Pre-fill past the 8192-byte cap without going through recordConflict.
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, "x".repeat(9000));

  recordConflict({ verb: "render", expected: 9, found: 10 });

  assert.ok(fs.existsSync(`${logPath}.prev`), "the oversized log must be rotated to .prev");
  assert.equal(fs.readFileSync(`${logPath}.prev`, "utf8").length, 9000,
    ".prev must hold the previous body verbatim");
  const fresh = fs.readFileSync(logPath, "utf8");
  assert.ok(fresh.length < 200 && fresh.includes("render"),
    "the live log must restart with just the new entry");
});

test("rotation replaces an existing .prev rather than accumulating files", async () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const { recordConflict } = await freshConflicts(cwd);
  const logPath = path.join(cwd, ".conductor", "write-conflicts.log");
  fs.mkdirSync(path.dirname(logPath), { recursive: true });

  fs.writeFileSync(`${logPath}.prev`, "older");
  fs.writeFileSync(logPath, "y".repeat(9000));
  recordConflict({ verb: "brief", expected: 1, found: 2 });

  assert.equal(fs.readFileSync(`${logPath}.prev`, "utf8").length, 9000,
    "the new .prev must overwrite the old one");
  assert.ok(!fs.existsSync(`${logPath}.prev.prev`), "rotation must not chain");
});

test("state.mjs's locally computed paths agree with constants.mjs — #82 must not silently diverge them", async () => {
  // state.mjs computes its own paths because the cache-busting test pattern cannot refresh a
  // statically imported constants.mjs. That duplication is behaviourally identical TODAY. #82
  // proposes changing ROOT resolution; without this test its fix would update constants.mjs and
  // leave state.mjs resolving a different root, silently.
  const cwd = tmpRepo();
  process.env.CLAUDE_PROJECT_DIR = cwd;
  const bust = `?t=${Date.now()}${Math.random()}`;
  const consts = await import(new URL("../lib/constants.mjs", import.meta.url).href + bust);
  const { loadState, saveState } = await import(new URL("../lib/state.mjs", import.meta.url).href + bust);

  run(["init"], { cwd });
  const s = loadState();
  s.epics.push({ id: "path-probe", title: "p", priority: "P3", status: "queued", role: "epic", lane: "claude-code", links: [] });
  saveState(s);

  // If state.mjs resolved a different root, the write would have landed somewhere else.
  assert.ok(fs.existsSync(consts.STATE_PATH), "state.mjs must write to the path constants.mjs names");
  assert.match(fs.readFileSync(consts.STATE_PATH, "utf8"), /path-probe/);
});

test("recordConflict must never throw, even when mkdirSync fails — it runs on a hook's failure path", async () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const { recordConflict } = await freshConflicts(cwd);

  const original = fs.mkdirSync;
  try {
    fs.mkdirSync = () => { throw new Error("EACCES: permission denied"); };
    // This must NOT throw — diagnostics on a hook's failure path cannot become visible errors.
    recordConflict({ verb: "render", expected: 1, found: 2 });
    assert.ok(true, "recordConflict swallowed the mkdirSync error");
  } finally {
    fs.mkdirSync = original;
  }
});

test("write-conflicts.mjs's locally computed paths agree with constants.mjs — #82 must not silently diverge them", async () => {
  // write-conflicts.mjs computes its own paths for the same reason state.mjs does: cache-busting
  // tests cannot refresh a statically imported constants.mjs. That duplication is behaviourally
  // identical TODAY. #82 proposes changing ROOT resolution; without this test its fix would update
  // constants.mjs and leave write-conflicts.mjs resolving a different root, silently.
  const cwd = tmpRepo();
  process.env.CLAUDE_PROJECT_DIR = cwd;
  const bust = `?t=${Date.now()}${Math.random()}`;
  const consts = await import(new URL("../lib/constants.mjs", import.meta.url).href + bust);
  const { recordConflict, conflictCount } = await import(new URL("../lib/write-conflicts.mjs", import.meta.url).href + bust).then(m => ({ recordConflict: m.recordConflict, conflictCount: m.conflictCount }));

  run(["init"], { cwd });
  recordConflict({ verb: "render", expected: 1, found: 2 });

  // If write-conflicts.mjs resolved a different root, the write would have landed somewhere else.
  assert.ok(fs.existsSync(consts.WRITE_CONFLICTS_LOG), "write-conflicts.mjs must write to the path constants.mjs names");
  assert.match(fs.readFileSync(consts.WRITE_CONFLICTS_LOG, "utf8"), /render\t1\t2/);
});

// ─────────────── the threshold warning ───────────────

test("the brief warns ONCE at the threshold and does NOT re-warn above it", async () => {
  // The absence half is the point. A warning that fires on every skip past the threshold is the
  // three-minute error storm that trains a reader to filter it — which is how a real signal
  // becomes invisible. Assert both halves or this test passes on a warning that always fires.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const { recordConflict } = await freshConflicts(cwd);

  recordConflict({ verb: "render", expected: 1, found: 2 });
  recordConflict({ verb: "render", expected: 1, found: 3 });
  assert.doesNotMatch(run(["brief"], { cwd }), /writes skipped on conflict/,
    "below the threshold the brief must stay quiet");

  recordConflict({ verb: "render", expected: 1, found: 4 });   // now at 3
  assert.match(run(["brief"], { cwd }), /3 state writes skipped on conflict/,
    "at the threshold the brief must say so");

  recordConflict({ verb: "render", expected: 1, found: 5 });   // now at 4
  assert.doesNotMatch(run(["brief"], { cwd }), /writes skipped on conflict/,
    "past the threshold it must NOT warn again until a success resets it");
});

test("a successful state write clears the conflict log", async () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const { recordConflict } = await freshConflicts(cwd);
  recordConflict({ verb: "render", expected: 1, found: 2 });

  run(["add-epic", "--id", "clears-it", "--lane", "claude-code", "--priority", "P3"], { cwd });

  assert.ok(!fs.existsSync(path.join(cwd, ".conductor", "write-conflicts.log")),
    "any successful write must reset the consecutive-skip signal");
});
