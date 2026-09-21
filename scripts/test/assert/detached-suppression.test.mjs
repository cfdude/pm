// scripts/test/assert/detached-suppression.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/detached-suppression.test.mjs — same id, same
// subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is the suppression rule: in a genuinely DETACHED tree the engine
// stops writing the artefacts that only make sense beside a branch (the commit-observation record,
// the detour log, the brief snapshot, the session claim, the activity log), while the state of
// record is untouched. Every positive case builds a real repository and detaches HEAD (design D5).
//
// THE CASE THIS HALF OWNS IS ITS MIRROR, and it is the one the spec's "safe direction" turns on: a
// tree git CANNOT ANSWER ABOUT (status 128, not 1) must keep writing. The assertion half's every root
// is exactly that tree. If the probe ever collapsed 128 into "detached", every write in this half
// would vanish silently and the half would pass on nothing.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, readState, projectMd } from "../fixtures/assert-harness.mjs";

const at = (cwd, ...p) => path.join(cwd, ...p);
const exists = (...p) => fs.existsSync(path.join(...p));

test("a tree git cannot answer about keeps writing — the safe direction", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "e1", "--lane", "claude-code"], { cwd });
  // Every artefact the suppression rule covers is still written, because 128 is "cannot answer",
  // not "detached". A false suppression is invisible; a false record is visible and removable.
  assert.ok(exists(cwd, ".conductor", "state.json"), "the state of record is written");
  run(["render"], { cwd });
  assert.ok(exists(cwd, "PROJECT.md"), "the render is written");
  run(["snapshot"], { cwd });
  assert.ok(exists(cwd, ".conductor", "brief.txt"), "the brief snapshot is written");
});

test("the detour log is written by a minimal detour, and the verb still reports", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const out = run(["log-detour", "a quick fix"], { cwd });
  assert.ok(exists(cwd, ".conductor", "detours.log"), "an unanswerable tree is not a suppressed one");
  assert.doesNotMatch(out, /DETACHED/);
  assert.match(fs.readFileSync(at(cwd, ".conductor", "detours.log"), "utf8"), /a quick fix/);
});

test("the activity log's own reader does not treat an unanswerable tree as detached", () => {
  // The log is one file per day under `.conductor/activity/` and is OFF until the project turns it
  // on, so what this half can assert is the shared probe's answer rather than a written file: the
  // reader reports the log's state without claiming the tree is detached, which is what the
  // suppression rule keys on.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const out = run(["activity"], { cwd });
  assert.ok(typeof out === "string");
  assert.doesNotMatch(out, /DETACHED/i, "an unanswerable tree is not a detached one");
  assert.ok(exists(cwd, ".conductor", "state.json"));
});

test("the state of record is never suppressed, whatever the tree is", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const before = readState(cwd).revision;
  run(["add-epic", "--id", "e1", "--lane", "claude-code"], { cwd });
  assert.ok(readState(cwd).revision > before, "the write landed");
});

test("commit-nudge in a tree git cannot answer about does not take the suppressed path", () => {
  // The suppression this file is named for must be reachable ONLY through `detached`; with no
  // answer at all the hook falls back to its unverifiable rung, which emits its advisory.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const out = run(["commit-nudge"], { cwd, input: JSON.stringify({ tool_input: { command: "git commit -m x" } }) });
  assert.match(out, /hookSpecificOutput/, "the hook is not silenced by an unanswerable tree");
});

// ───────────────────────── the deliberate omissions ─────────────────────────
//
// The functional file's five paired cases — the observation record, the detour log, the brief
// snapshot, the session claim and the activity log, each asserted NOT written in a detached tree and
// then asserted WRITTEN on a branch as its control — all need `git checkout --detach` in a real
// repository (design D5). Their absence half is the safe direction asserted above, which is the half
// this half can prove every commit.
