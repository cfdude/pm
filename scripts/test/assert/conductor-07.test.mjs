import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, runCombined, readState, writeState, expectFail, invokeEngine } from "../fixtures/assert-harness.mjs";

// ─────────────── 4.1 SPLIT THIS FILE, AND THIS IS THE FILE-RUNG HALF ───────────────
//
// TWENTY of its twenty-three tests moved to `scripts/test/unit/conductor-07.test.mjs` — `changesets`
// on an absent directory, all four `render --diff-summary` cases, the two plan-hierarchy tests, all
// four engine-banner tests, the five timestamp/staleness tests, `verify-state` on a record that was
// never rendered, and the two `verify-state` SUCCESS tests.
//
// THREE STAY, and each is a filesystem subject rather than a placement:
//
//   * two `changesets` tests, whose fixture writes `.changesets/*.md` — a repository directory the
//     store does not own;
//   * `verify-state`'s hand-edit test, which forces state.json's MTIME forward with `utimesSync`
//     because mtime ordering IS the subject of that comparison.
//
// THE TWO SUCCESS TESTS WERE THE FINDING (worklist-4.1.md), AND THEY MOVED WHEN IT WAS FIXED.
// `verifyState()` read its stamp with `readJSON(renderStampPath(), null)` and state.json's mtime with
// `fs.statSync(statePath())` — raw paths — while `render.mjs` WRITES both through the store
// (`store.mtimeMs(ARTIFACT.RECORD)`, `store.write(ARTIFACT.RENDER_STAMP, …)`): the writer behind the
// seam and the reader in front of it, so a memory-store render left verify-state answering "no render
// stamp found" while `store.exists("render-stamp.json")` was true. Probed, not inferred. The two-line
// fix in `worktree-hygiene.mjs` landed in its own commit and moved these two tests with it.
//
// No assertion changed in either direction.

test("changesets lists fragment files sorted by epic id, with body content", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const dir = path.join(cwd, ".changesets");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "zeta-epic.md"), "- **Zeta thing.** Did the zeta.\n");
  fs.writeFileSync(path.join(dir, "alpha-epic.md"), "- **Alpha thing.** Did the alpha.\n");
  const out = JSON.parse(run(["changesets"], { cwd }));
  assert.equal(out.changesets.length, 2);
  assert.equal(out.changesets[0].id, "alpha-epic");
  assert.equal(out.changesets[1].id, "zeta-epic");
  assert.match(out.changesets[0].body, /Did the alpha/);
});
test("changesets ignores non-markdown files in .changesets", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const dir = path.join(cwd, ".changesets");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "epic-a.md"), "- **A thing.**\n");
  fs.writeFileSync(path.join(dir, ".gitkeep"), "");
  const out = JSON.parse(run(["changesets"], { cwd }));
  assert.equal(out.changesets.length, 1);
  assert.equal(out.changesets[0].id, "epic-a");
});

// ──────────────── render --diff-summary ────────────────
test("verify-state fails loudly when state.json is hand-edited after the last render", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const state = readState(cwd);
  state.epics.push({ id: "hand-edited", title: "Hand edited", priority: "P2", status: "queued", role: "epic", lane: "claude-code", links: [], reconcileNeeded: false });
  // Force the on-disk mtime forward so it's unambiguously newer than the render stamp,
  // even on filesystems with coarse mtime resolution.
  const statePath = path.join(cwd, ".conductor", "state.json");
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
  const future = new Date(Date.now() + 60_000);
  fs.utimesSync(statePath, future, future);
  const err = expectFail(() => run(["verify-state"], { cwd }));
  assert.ok(err);
  const out = runCombined(["verify-state"], { cwd });
  assert.match(out, /hand-edit|re-render|\/pm:status/i);
});

// verify-state-false-hand-edit (code review 0.43.0, C2). A verb that SAVES without rendering —
// `set-activity-log`, a claim — advances the record's revision and moves its mtime past the stamp.
// Comparing mtime alone called that a hand-edit. The revision is what an engine write advances and
// a hand-edit does not, so a newer mtime with a NEWER revision is the engine's own write. The mtime
// is forced forward after the engine writes, so the old comparison fails however coarse the clock.
test("verify-state does not call an engine write that saved without rendering a hand-edit", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-activity-log", "on"], { cwd });
  run(["add-epic", "--id", "c", "--lane", "claude-code"], { cwd });
  run(["claim", "c", "--session", "s1"], { cwd });
  const out = runCombined(["verify-state"], { cwd });
  assert.doesNotMatch(out, /hand-edit(?! detected)|cannot rule out/i);
  assert.match(out, /no hand-edit detected/);
  assert.match(out, /\/pm:status/, "a record written since the render still says PROJECT.md may be stale");
});

// Branch review of the fix above: trusting ANY revision ahead of the render stamp as the engine's
// own made the check blind to a hand-edit made after a non-rendering save — `init`,
// `set-activity-log on`, hand-edit → exit 0, where the old mtime check caught it. Every engine save
// now records `{revision, mtimeMs}` on the stamp as `lastSave`, so a hand-edit after it is bytes that
// moved at the last SAVED revision, exactly as one after a render is at the rendered revision.
test("verify-state catches a hand-edit made AFTER an engine save that did not render", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-activity-log", "on"], { cwd });
  const statePath = path.join(cwd, ".conductor", "state.json");
  const state = readState(cwd);
  state.epics.push({ id: "hand-edited", title: "Hand edited", priority: "P2", status: "queued", role: "epic", lane: "claude-code", links: [], reconcileNeeded: false });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
  const future = new Date(Date.now() + 60_000);
  fs.utimesSync(statePath, future, future);
  assert.ok(expectFail(() => run(["verify-state"], { cwd })), "the hand-edit is reported");
  assert.match(runCombined(["verify-state"], { cwd }), /undetected hand-edit/);
});
test("verify-state cannot rule out a hand-edit when the revision moved past the last recorded save", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const statePath = path.join(cwd, ".conductor", "state.json");
  const state = readState(cwd);
  state.revision += 5;   // no engine save recorded this revision
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
  assert.ok(expectFail(() => run(["verify-state"], { cwd })), "an unrecorded revision is not trusted");
  assert.match(runCombined(["verify-state"], { cwd }), /cannot rule out a hand-edit/);
});
test("verify-state fails loudly when state.json's revision went BACKWARDS since the last render", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code"], { cwd });
  const state = readState(cwd);
  state.revision = 0;
  const statePath = path.join(cwd, ".conductor", "state.json");
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
  const err = expectFail(() => run(["verify-state"], { cwd }));
  assert.ok(err, "a rewound revision must fail verify-state");
  assert.match(runCombined(["verify-state"], { cwd }), /revision went backwards/i);
});
