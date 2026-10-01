// scripts/test/unit/attribution-nudge.test.mjs
// hook-friction-0-51 items 1 and 2 — the two predicates the attribution nudge decides with, as VALUES.
// Its functional twin is scripts/test/functional/attribution-nudge.test.mjs, which runs the real
// commit-nudge hook over real commits and reads what it says.

import assert from "node:assert/strict";
import { unitTest } from "../fixtures/unit-harness.mjs";

const load = () => import(new URL("../../lib/subcommands.mjs", import.meta.url).href);

unitTest("a commit of only .conductor/**, PROJECT.md or both is bookkeeping", async () => {
  const { isAttributionBookkeeping } = await load();
  assert.equal(isAttributionBookkeeping(["PROJECT.md"]), true);
  assert.equal(isAttributionBookkeeping([".conductor/state.json", ".conductor/feedback/x.md", "PROJECT.md"]), true);
});

unitTest("a change MOVED under openspec/changes/archive/ is bookkeeping, recognised by pairing the removed and added names", async () => {
  const { isAttributionBookkeeping } = await load();
  assert.equal(isAttributionBookkeeping([
    "openspec/changes/foo/proposal.md", "openspec/changes/foo/tasks.md",
    "openspec/changes/archive/2026-09-30-foo/proposal.md", "openspec/changes/archive/2026-09-30-foo/tasks.md",
    ".conductor/state.json", "PROJECT.md",
  ]), true);
});

unitTest("an edit to a change, a new change, or half a move is real work, not bookkeeping", async () => {
  const { isAttributionBookkeeping } = await load();
  assert.equal(isAttributionBookkeeping(["openspec/changes/foo/tasks.md"]), false, "an edit has no archive partner");
  assert.equal(isAttributionBookkeeping(["openspec/changes/foo/tasks.md", "PROJECT.md"]), false);
  assert.equal(isAttributionBookkeeping(["openspec/changes/archive/2026-09-30-foo/tasks.md"]), false, "an add with no removed original");
  assert.equal(isAttributionBookkeeping([
    "openspec/changes/foo/tasks.md", "openspec/changes/archive/2026-09-30-foo/proposal.md"]), false, "names that do not pair");
  assert.equal(isAttributionBookkeeping([
    "openspec/changes/foo/tasks.md", "openspec/changes/archive/2026-09-30-bar/tasks.md"]), false, "a different change's archive");
});

unitTest("a commit that also touches anything else is not bookkeeping; no list, an empty list, and git's null are not", async () => {
  const { isAttributionBookkeeping } = await load();
  assert.equal(isAttributionBookkeeping(["PROJECT.md", "src/app.mjs"]), false);
  assert.equal(isAttributionBookkeeping([".conductor/state.json", ":/PROJECT.md"]), false, "a path outside the conductor root is not this conductor's");
  assert.equal(isAttributionBookkeeping([]), false);
  assert.equal(isAttributionBookkeeping(null), false);
  assert.equal(isAttributionBookkeeping(undefined), false);
});

unitTest("a subject names an epic as a whole token: prefix, scope or bare mention, never a substring of another word", async () => {
  const { subjectNamesEpic } = await load();
  assert.equal(subjectNamesEpic("epic-a: tighten the guard", "epic-a"), true);
  assert.equal(subjectNamesEpic("feat(epic-a): tighten the guard", "epic-a"), true);
  assert.equal(subjectNamesEpic("fix: the EPIC-A hook", "epic-a"), true);
  assert.equal(subjectNamesEpic("fix: epic-abc is different", "epic-a"), false);
  assert.equal(subjectNamesEpic("fix: data race", "a"), false);
  assert.equal(subjectNamesEpic("fix: something", ""), false);
  assert.equal(subjectNamesEpic(null, "epic-a"), false);
});

unitTest("an id holding regex metacharacters matches itself and nothing wider", async () => {
  const { subjectNamesEpic } = await load();
  assert.equal(subjectNamesEpic("chore: v1.2 notes", "v1.2"), true);
  assert.equal(subjectNamesEpic("chore: v1x2 notes", "v1.2"), false);
});
