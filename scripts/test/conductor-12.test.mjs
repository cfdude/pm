import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, fixturePluginRoot, readState, writeState } from "./helpers.mjs";

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

test("--force must never rewind the revision below what's on disk — a lost update one hop removed", async () => {
  // A and B both read the same revision. B saves normally (revision advances by one). C loads
  // the post-B state. A then force-writes with its STALE `expected` — if the new revision is
  // computed as `expected + 1` instead of `max(found, expected) + 1`, A's forced write can land
  // on the SAME revision C already saw as `found`. C's own save then reads `expected === found`,
  // the guard passes, and C silently clobbers A's change — the exact lost update this whole
  // guard exists to prevent, just reopened one write later. The victim (C) never forced anything.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const { loadState, saveState, StateConflictError } = await freshState(cwd);

  const a = loadState();          // A and B both read the same revision
  const b = loadState();

  b.epics.push({ id: "from-b", title: "b", priority: "P1", status: "queued", role: "epic", lane: "claude-code", links: [] });
  assert.equal(saveState(b).ok, true, "B's ordinary write must succeed");

  const c = loadState();          // C loads the post-B revision

  const argv = process.argv;
  try {
    process.argv = [...argv, "--force"];
    a.epics.push({ id: "from-a", title: "a", priority: "P1", status: "queued", role: "epic", lane: "claude-code", links: [] });
    assert.equal(saveState(a).ok, true, "A's forced write must succeed despite its stale revision");
  } finally {
    process.argv = argv;
  }

  c.epics.push({ id: "from-c", title: "c", priority: "P1", status: "queued", role: "epic", lane: "claude-code", links: [] });
  assert.throws(() => saveState(c), StateConflictError,
    "C's revision was superseded by A's forced write and must be refused, not silently accepted");
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

// ─────────────── consuming the warning ───────────────

test("the threshold warning fires ONCE ACROSS INVOCATIONS, not once per process", async () => {
  // conflictCount() is derived from a file, so without consuming the condition the count stays
  // pinned at the threshold and every SessionStart re-warns — the same storm the strict-equality
  // rule exists to prevent, arrived at from the other side.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const { recordConflict } = await freshConflicts(cwd);
  recordConflict({ verb: "render", expected: 1, found: 2 });
  recordConflict({ verb: "render", expected: 1, found: 3 });
  recordConflict({ verb: "render", expected: 1, found: 4 });

  assert.match(run(["brief"], { cwd }), /3 state writes skipped on conflict/);
  assert.doesNotMatch(run(["brief"], { cwd }), /writes skipped on conflict/,
    "consumption rotates the log, resetting count below the threshold — a second brief must not re-warn");
});

test("consuming the warning preserves the evidence it points at — AT THE PATH IT NAMED", async () => {
  // Consumption used to rename the log to .prev, which sent the reader the warning had just told
  // to open `.conductor/write-conflicts.log` to a path that no longer existed. The latch replaces
  // that entirely: the log is left exactly where it is and nothing about it moves.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const { recordConflict } = await freshConflicts(cwd);
  for (const f of [2, 3, 4]) recordConflict({ verb: "render", expected: 1, found: f });

  run(["brief"], { cwd });
  const log = path.join(cwd, ".conductor", "write-conflicts.log");
  assert.ok(fs.existsSync(log), "the log the warning named must still be there to open");
  assert.equal(fs.readFileSync(log, "utf8").split("\n").filter(Boolean).length, 3,
    "and must still hold every skip — consumption is not a rotation");
  assert.ok(!fs.existsSync(`${log}.prev`), "consumption must not rename the log");
  assert.ok(fs.existsSync(path.join(cwd, ".conductor", "write-conflicts.latch")),
    "the latch, not a lowered count, is what stops the warning repeating");
});

test("render() composing PROJECT.md must NOT consume the warning — only a DELIVERED briefing may", async () => {
  // render() calls buildBrief() too (to embed the "Briefing" section into PROJECT.md), and
  // render() itself runs on commit-nudge, /pm:status, init, upgrade, log-detour, set-gate-guard.
  // If composing PROJECT.md consumed the warning, the third skip's warning would be rotated away
  // by the very render() call that produced it — landing once in a PROJECT.md the next render
  // overwrites, and never reaching a live SessionStart brief. Every prior threshold test in this
  // file calls run(["brief"]) with no intervening render() and so cannot catch this.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const { recordConflict } = await freshConflicts(cwd);
  for (const f of [2, 3, 4]) recordConflict({ verb: "render", expected: 1, found: f });   // 3 skips

  run(["render"], { cwd });   // composing PROJECT.md must be a non-event for the warning

  assert.match(run(["brief"], { cwd }), /3 state writes skipped on conflict/,
    "the warning must still be there for the first briefing that actually reaches a session");
});

test("a BURST straight past the threshold still warns, exactly once — the count is SAMPLED, not observed", async () => {
  // This replaces "a count ABOVE the threshold does not warn — the rule is equality, not >=".
  // That rule was wrong for a reason strict equality could not see: conflictCount() is only READ
  // when a briefing is composed, so the count must be exactly 3 AT THAT MOMENT. A wedged writer
  // or a hook loop produces a BURST — verified empirically on 0.26.0, 3 skips warned and 7 did
  // not — so mild contention warned and severe contention did not, and the warning's absence
  // then read as evidence of health. `>=` alone is no fix either: it re-warns on every
  // subsequent briefing, training the reader to filter exactly the message that matters. Hence
  // once per EPISODE: warn at or above the threshold while unlatched, then latch.
  //
  // Drive the counter from 0 to 7 in ONE step with no briefing in between. The existing tests all
  // step it one entry at a time, which is precisely why this shipped broken.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const { recordConflict } = await freshConflicts(cwd);
  for (const f of [2, 3, 4, 5, 6, 7, 8]) recordConflict({ verb: "render", expected: 1, found: f });

  assert.match(run(["brief"], { cwd }), /7 state writes skipped on conflict/,
    "a burst that crossed the threshold unseen must still warn — and name the count it actually found");
  assert.doesNotMatch(run(["brief"], { cwd }), /writes skipped on conflict/,
    "and the latch must hold it to once: without it, >= re-warns every briefing for the same episode");
});

// ─────────────── the distinct exit code ───────────────
//
// Tested as a pure predicate (conflictExitCode), not by driving the CLI end-to-end: a hidden
// self-test subcommand purely to make that possible is a worse trade than a stated coverage
// gap. Every existing verb already exercises the surrounding try/catch on its success path;
// what is NOT covered end-to-end is the one line that turns this predicate's result into an
// actual process.exit() when a real verb throws.

test("a StateConflictError maps to the distinct conflict exit code", async () => {
  const cwd = tmpRepo();
  const { StateConflictError, conflictExitCode } = await freshState(cwd);
  const consts = await import(new URL("../lib/constants.mjs", import.meta.url).href + `?t=${Date.now()}`);
  assert.equal(conflictExitCode(new StateConflictError(4, 5)), consts.CONFLICT_EXIT_CODE);
  assert.notEqual(consts.CONFLICT_EXIT_CODE, 1,
    "sharing exit 1 with validation failures is the whole thing this avoids");
});

test("any other error maps to null so it is re-thrown with its stack intact", async () => {
  const cwd = tmpRepo();
  const { conflictExitCode } = await freshState(cwd);
  assert.equal(conflictExitCode(new TypeError("bad argument")), null);
  assert.equal(conflictExitCode(new Error("something else")), null);
});

// ─────────────── generated logs must not dirty the working tree ───────────────

test("init writes .gitignore entries for the conductor's generated logs", async () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const gi = fs.readFileSync(path.join(cwd, ".gitignore"), "utf8");
  assert.match(gi, /^\.conductor\/detours\.log$/m,
    "detours.log was ignored only by the maintainer's personal global gitignore (#106)");
  assert.match(gi, /^\.conductor\/write-conflicts\.log$/m);
});

test("init is idempotent — a second run does not duplicate the entries", async () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["init"], { cwd });
  const lines = fs.readFileSync(path.join(cwd, ".gitignore"), "utf8").split("\n");
  assert.equal(lines.filter(l => l === ".conductor/detours.log").length, 1);
});

test("init preserves an existing .gitignore instead of overwriting it", async () => {
  const cwd = tmpRepo();
  fs.writeFileSync(path.join(cwd, ".gitignore"), "node_modules/\n");
  run(["init"], { cwd });
  const gi = fs.readFileSync(path.join(cwd, ".gitignore"), "utf8");
  assert.match(gi, /^node_modules\/$/m, "an existing entry must survive");
  assert.match(gi, /^\.conductor\/detours\.log$/m);
});

test("upgrade backfills the gitignore entries — the documented update path, not just init", async () => {
  // /pm:upgrade is what users are told to run on a new plugin version; nobody is told to
  // re-run init. Wiring the backfill only to init would fix #106 for new repos and miss every
  // existing one, which is the population the issue is about.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  fs.writeFileSync(path.join(cwd, ".gitignore"), "node_modules/\n");   // simulate a repo predating the fix
  run(["upgrade"], { cwd, env: { CLAUDE_PLUGIN_ROOT: fixturePluginRoot("0.3.0") } });

  const gi = fs.readFileSync(path.join(cwd, ".gitignore"), "utf8");
  assert.match(gi, /^node_modules\/$/m, "the pre-existing entry must survive");
  assert.match(gi, /^\.conductor\/detours\.log$/m);
  assert.match(gi, /^\.conductor\/write-conflicts\.log$/m);
});

// ─────────── commit-nudge: the second hook write must degrade too ───────────
//
// commitNudge() (registered as the PostToolUse hook) has its OWN saveState() call for
// reconcileArchived()'s self-heal — a second hook write the original design assumed did not
// exist (render.mjs's was believed to be the only one). It needs the identical retry-once-
// then-skip treatment: a conflict there is a self-heal that re-runs on the next hook, so losing
// it costs nothing, while the default onConflict:"throw" turns an invisible race into a visible
// exit-9 mid-session error for a write that did not matter.

async function freshSubcommands(cwd) {
  process.env.CLAUDE_PROJECT_DIR = cwd;
  const url = new URL("../lib/subcommands.mjs", import.meta.url);
  return import(`${url.href}?t=${Date.now()}${Math.random()}`);
}

test("commit-nudge degrades on conflict instead of throwing — the second hook write", async () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });

  // Give commit-nudge's self-heal something to do: an active pointer at an epic that no longer
  // exists. reconcileArchived() nulls it out, which is what makes commitNudge() attempt a save.
  const baseline = readState(cwd);
  baseline.active = "ghost-epic";
  writeState(cwd, baseline);

  const statePath = path.join(cwd, ".conductor", "state.json");
  const staleContent = fs.readFileSync(statePath, "utf8");   // what commit-nudge's OWN loadState() sees

  // Simulate another writer landing between commit-nudge's read and its write: bump the on-disk
  // revision past what commit-nudge is about to compare against (the pointer stays unhealed, as
  // an unrelated writer's change would leave it).
  writeState(cwd, { ...baseline, revision: baseline.revision + 1 });

  const { commitNudge } = await freshSubcommands(cwd);

  // Intercept exactly the FIRST read of state.json (commit-nudge's own loadState()) to hand back
  // the pre-race snapshot; every later read of it (saveState's conflict check, and the reload on
  // retry) falls through to the real, already-bumped file on disk — reproducing the race without
  // needing a second process.
  const originalReadFileSync = fs.readFileSync;
  let staleServed = false;
  fs.readFileSync = (p, ...rest) => {
    if (p === 0) return JSON.stringify({ tool_input: { command: 'git commit -m "chore: test"' } });
    if (!staleServed && p === statePath) { staleServed = true; return staleContent; }
    return originalReadFileSync(p, ...rest);
  };

  // Spy on the append that records a skip, rather than reading write-conflicts.log back after
  // the fact: the retry's eventual SUCCESS calls clearConflicts() (by design — "a successful
  // write must reset the consecutive-skip signal"), which deletes the log again before this
  // test ever gets to inspect it. The append call itself is the only durable evidence.
  const originalAppendFileSync = fs.appendFileSync;
  const appended = [];
  fs.appendFileSync = (p, data) => {
    appended.push(String(data));
    return originalAppendFileSync(p, data);
  };

  try {
    assert.doesNotThrow(() => commitNudge(),
      "a conflict on commit-nudge's self-heal write must degrade, not throw StateConflictError");
  } finally {
    fs.readFileSync = originalReadFileSync;
    fs.appendFileSync = originalAppendFileSync;
  }

  // The first attempt's conflict must actually have been recorded — proves the retry path was
  // genuinely exercised, not that the heal happened to succeed on the first try.
  assert.ok(appended.some(line => line.includes("\tcommit-nudge\t")),
    "the first attempt's conflict must be recorded against the commit-nudge verb");

  // And the retry (reload + re-run the heal) must still have landed the self-heal on disk.
  assert.equal(readState(cwd).active, null,
    "the retry must still heal the stale active pointer despite the first attempt's conflict");
});
