import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, runCombined, readState, writeState, expectFail, invokeEngine } from "../fixtures/assert-harness.mjs";

// ─────────────── 4.1 SPLIT THIS FILE, AND THIS IS THE FILE-RUNG HALF ───────────────
//
// EIGHTEEN of its twenty-three tests moved to `scripts/test/unit/conductor-07.test.mjs` — `changesets`
// on an absent directory, all four `render --diff-summary` cases, the two plan-hierarchy tests, all
// four engine-banner tests, the five timestamp/staleness tests, and `verify-state` on a record that
// was never rendered.
//
// FIVE STAY, and TWO OF THEM ARE A FINDING RATHER THAN A PLACEMENT:
//
//   * two `changesets` tests, whose fixture writes `.changesets/*.md` — a repository directory the
//     store does not own;
//   * `verify-state`'s hand-edit test, which forces state.json's MTIME forward with `utimesSync`
//     because mtime ordering IS the subject of that comparison;
//   * **the two `verify-state` success tests, because THE READER BYPASSES THE SEAM.** `verifyState()`
//     reads its stamp with `readJSON(renderStampPath(), null)` and state.json's mtime with
//     `fs.statSync(statePath())` — raw paths — while `render.mjs` WRITES both through the store
//     (`store.mtimeMs(ARTIFACT.RECORD)`, `store.write(ARTIFACT.RENDER_STAMP, …)`). Against a memory
//     store the render writes the stamp and `store.exists("render-stamp.json")` is true, yet
//     verify-state reports "no render stamp found". Probed, not inferred. The fix is two lines in
//     `worktree-hygiene.mjs` — read both through `storeOps()` — and it is deliberately NOT taken in a
//     per-file migration commit: it changes what an engine VERB reads and deserves its own commit.
//     Recorded in worklist-4.1.md as this batch's finding.
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
test("verify-state succeeds right after init/render (stamp matches state.json)", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const out = runCombined(["verify-state"], { cwd });
  assert.match(out, /conductor: state.json matches the last render/);
});
test("verify-state succeeds after render is re-run following a legitimate state change", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code"], { cwd });
  run(["render"], { cwd });
  const out = runCombined(["verify-state"], { cwd });
  assert.match(out, /conductor: state.json matches the last render/);
});
