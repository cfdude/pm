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
