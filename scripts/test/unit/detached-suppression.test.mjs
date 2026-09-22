// scripts/test/unit/detached-suppression.test.mjs
// 4.1's migration of `assert/detached-suppression.test.mjs` — 5 of its 5 tests, moved from the file
// rung to the unit rung with every assertion unchanged. The file is GONE from the file rung.
//
// 5.3's ASSERTION TWIN of scripts/test/functional/detached-suppression.test.mjs — same id, same
// subject.
//
// THE SUBJECT is the suppression rule: in a genuinely DETACHED tree the engine stops writing the
// artefacts that only make sense beside a branch (the commit-observation record, the detour log, the
// brief snapshot, the session claim, the activity log), while the state of record is untouched.
//
// THE CASE THIS HALF OWNS IS ITS MIRROR, and it is the one the spec's "safe direction" turns on: a
// tree git CANNOT ANSWER ABOUT (status 128, not 1) must keep writing. The assertion half's every root
// is exactly that tree.
//
// WHY THE WHOLE FILE MOVED: every artefact the rule covers is a STORE-OWNED artifact, so "it was
// still written" is `store.exists(...)` — the same absence-or-presence question `fs.existsSync` asked,
// through the seam. The one verb whose record is not an artifact (`commit-nudge`) is asserted on its
// printed payload.
//
//   `tmpRepo()` + `run(["init"], { cwd })`  →  `memoryEngine(emptyRecord())`
//   `exists(cwd, ".conductor", "brief.txt")`→  `engine.store.exists("brief.txt")`
//   `readState(cwd)`                        →  `engine.store.record()`

import assert from "node:assert/strict";
import { emptyRecord, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const readState = (engine) => engine.store.record();

unitTest("a tree git cannot answer about keeps writing — the safe direction", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "e1", "--lane", "claude-code"]);
  // Every artefact the suppression rule covers is still written, because 128 is "cannot answer",
  // not "detached". A false suppression is invisible; a false record is visible and removable.
  assert.ok(engine.store.exists("state.json"), "the state of record is written");
  engine(["render"]);
  assert.ok(engine.store.exists("PROJECT.md"), "the render is written");
  engine(["snapshot"]);
  assert.ok(engine.store.exists("brief.txt"), "the brief snapshot is written");
});

unitTest("the detour log is written by a minimal detour, and the verb still reports", () => {
  const engine = memoryEngine(emptyRecord());
  const out = engine(["log-detour", "a quick fix"]);
  assert.ok(engine.store.exists("detours.log"), "an unanswerable tree is not a suppressed one");
  assert.doesNotMatch(out, /DETACHED/);
  assert.match(engine.store.read("detours.log").text, /a quick fix/);
});

unitTest("the activity log's own reader does not treat an unanswerable tree as detached", () => {
  // The log is one file per day under `.conductor/activity/` and is OFF until the project turns it
  // on, so what this half can assert is the shared probe's answer rather than a written file: the
  // reader reports the log's state without claiming the tree is detached, which is what the
  // suppression rule keys on.
  const engine = memoryEngine(emptyRecord());
  const out = engine(["activity"]);
  assert.ok(typeof out === "string");
  assert.doesNotMatch(out, /DETACHED/i, "an unanswerable tree is not a detached one");
  assert.ok(engine.store.exists("state.json"));
});

unitTest("the state of record is never suppressed, whatever the tree is", () => {
  const engine = memoryEngine(emptyRecord());
  const before = readState(engine).revision;
  engine(["add-epic", "--id", "e1", "--lane", "claude-code"]);
  assert.ok(readState(engine).revision > before, "the write landed");
});

unitTest("commit-nudge in a tree git cannot answer about does not take the suppressed path", () => {
  // The suppression this file is named for must be reachable ONLY through `detached`; with no
  // answer at all the hook falls back to its unverifiable rung, which emits its advisory.
  const engine = memoryEngine(emptyRecord());
  const out = engine(["commit-nudge"], { input: JSON.stringify({ tool_input: { command: "git commit -m x" } }) });
  assert.match(out, /hookSpecificOutput/, "the hook is not silenced by an unanswerable tree");
});
