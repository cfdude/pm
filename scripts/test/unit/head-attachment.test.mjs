// scripts/test/unit/head-attachment.test.mjs
// 4.1's migration of `assert/head-attachment.test.mjs` — 3 of its 3 tests, moved from the file rung to
// the unit rung with every assertion unchanged. The file is GONE from the file rung.
//
// 5.3's ASSERTION TWIN of scripts/test/functional/head-attachment.test.mjs — same id, same subject.
//
// THE SUBJECT is the probe whose EXIT STATUS is the whole answer: 0 attached, 1 detached, and 128 "not
// a repository" — and only status 1 may suppress a write. Its cases all build a real repository and
// detach HEAD, which this half cannot do (design D5).
//
// BUT THE THIRD CASE IS THIS HALF'S WHOLE WORLD: every invocation's root here has no `git init`
// anywhere above it, so the double answers 128 for `headRef`. That is the case the functional file
// calls the SAFE DIRECTION — "status 128 is 'git cannot answer', and a false SUPPRESSION silently
// disables the trail" — and it is the one a pre-commit gate most needs to see break.
//
// WHY THE WHOLE FILE MOVED: `hasState(cwd)` is `store.exists("state.json")`, and the two-root tests
// are TWO MEMORY STORES in one process — which is the property they assert (no captured answer
// crosses between roots) stated in the same shape conductor-12's second-root test uses.
//
//   `tmpRepo()` + `run(["init"], { cwd })`  →  `memoryEngine(emptyRecord())`
//   `hasState(cwd)`                         →  `engine.store.exists("state.json")`
//   `readState(cwd)`                        →  `engine.store.record()`

import assert from "node:assert/strict";
import { emptyRecord, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const readState = (engine) => engine.store.record();
const hasState = (engine) => engine.store.exists("state.json");

unitTest("a directory that is not a repository is `unknown`, NOT detached — every write still lands", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "e1", "--title", "t", "--lane", "claude-code"]);
  assert.deepEqual(readState(engine).epics.map(e => e.id), ["e1"],
    "status 128 must not be read as detached: a false suppression is invisible where a false " +
    "record is visible and removable");
  // A second mutating verb, so the property is not one verb's accident.
  engine(["set-active", "e1"]);
  assert.equal(readState(engine).active, "e1");
});

unitTest("the probe answers about the invocation's ROOT, not the process's cwd", () => {
  const a = memoryEngine(emptyRecord());
  const b = memoryEngine();
  assert.ok(hasState(a) && !hasState(b));
  a(["add-epic", "--id", "only-a", "--lane", "claude-code"]);
  assert.deepEqual(readState(a).epics.map(e => e.id), ["only-a"]);
  assert.equal(hasState(b), false, "the second root's record was never written");
  // And the non-initialized root still refuses for ITS OWN reason rather than reading a's record.
  const err = (() => { try { b(["add-epic", "--id", "x", "--lane", "claude-code"]); return null; }
    catch (e) { return e; } })();
  assert.ok(err, "a non-conductor root refuses");
  assert.match(String(err.stderr), /run \/pm:init first/);
});

unitTest("two roots in one process, one invocation each — no captured answer crosses between them", () => {
  const a = memoryEngine(emptyRecord());
  const b = memoryEngine(emptyRecord());
  a(["add-epic", "--id", "in-a", "--lane", "claude-code"]);
  b(["add-epic", "--id", "in-b", "--lane", "claude-code"]);
  assert.deepEqual(readState(a).epics.map(e => e.id), ["in-a"]);
  assert.deepEqual(readState(b).epics.map(e => e.id), ["in-b"],
    "a per-process answer about the first root would have been served to the second");
});
