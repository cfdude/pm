// scripts/test/unit/progress-union.test.mjs
// handoff-demand-blind-spots, design D2 (conductor-record "Outstanding work is a defined quantity"):
// the story part and the checkbox source count TOGETHER. These are the cases with NO checkbox source
// at all — a lane with none and no plan file — so no path is read and the value is the whole subject.
// The cases whose fixture writes a tasks.md are on the file rung (assert/progress-union.test.mjs).

import assert from "node:assert/strict";
import { unitTest } from "../fixtures/unit-harness.mjs";
import { bar, epicProgress, outstandingWork } from "../../lib/epic-progress.mjs";

const storyEpic = (stories) => ({ id: "s", title: "s", status: "queued", lane: "claude-code", stories });

unitTest("2.1 a story-only epic is unchanged: 3 stories, 1 done → 1/3, source stories", () => {
  const e = storyEpic([{ title: "a", done: true }, { title: "b", done: false }, { title: "c", done: false }]);
  const p = epicProgress(e);
  assert.deepEqual([p.done, p.total, p.excluded, p.source, p.warn], [1, 3, 0, "stories", null]);
  assert.deepEqual(p.parts, ["stories"], "one part contributes, so the parts list names one");
  assert.equal(outstandingWork(e), 2);
  assert.equal(bar(p), "1/3 stories", "the rendering of a story-only epic does not move");
});

unitTest("2.1 a disposed story leaves both sides of the ratio", () => {
  const e = storyEpic([{ title: "a", done: true }, { title: "b", done: false, disposition: { state: "wont-do", reason: "r" } }]);
  const p = epicProgress(e);
  assert.deepEqual([p.done, p.total, p.excluded], [1, 1, 1]);
  assert.equal(outstandingWork(e), 0);
});

unitTest("2.1 excludedLabel over stories alone says disposed, never lifecycle", () => {
  const e = storyEpic([{ title: "a", done: true }, { title: "b", done: false, disposition: { state: "wont-do", reason: "r" } }]);
  const p = epicProgress(e);
  assert.equal(p.excludedLabel, "disposed");
  assert.match(bar(p), /· 1 disposed$/);
  assert.doesNotMatch(bar(p), /lifecycle/);
});

unitTest("2.1 each part carries its OWN open count, so a consumer never keys on a single label", () => {
  const e = storyEpic([{ title: "a", done: false }, { title: "b", done: false }]);
  const p = epicProgress(e);
  assert.equal(p.stories.open, 2, "the story part's open count");
  assert.equal(p.checkbox, null, "a lane with no checkbox source has no checkbox part");
});

unitTest("2.1 a two-part source renders `N/M items`, since its total holds stories and tasks together", () => {
  const p = { done: 2, total: 4, excluded: 0, source: "stories+openspec", parts: ["stories", "openspec"], warn: null };
  assert.equal(bar(p), "2/4 items");
  assert.equal(bar({ ...p, source: "stories+plan" }), "2/4 items");
});
