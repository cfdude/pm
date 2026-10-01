// scripts/test/functional/attribution-nudge.test.mjs
// hook-friction-0-51 items 1 and 2 — what the commit hook SAYS about attribution, over real commits.
// Its assertion twin is scripts/test/unit/attribution-nudge.test.mjs, which pins the two predicates as
// values; here the real `commit-nudge` hook reads real commits made in a hermetic repository
// (helpers.mjs observationRepo(): epic-a active, no commit attributed to it).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { observationRepo } from "../fixtures/functional-harness.mjs";

const attributeCommands = (context) => [...context.matchAll(/update-epic (\S+) --attribute-commit/g)].map((m) => m[1]);

test("1 a commit of only PROJECT.md and .conductor/ files is bookkeeping: no attribution command, and it says why", () => {
  const repo = observationRepo();
  repo.observe();
  const sha = repo.commit({ "PROJECT.md": "re-rendered\n", ".conductor/feedback/note.md": "n\n" }, "chore(conductor): re-render");
  const o = repo.observe("PostToolUse", "git commit -m 'chore(conductor): re-render'");
  assert.equal(o.status, 0, o.stderr);
  assert.ok(o.context.includes(sha.slice(0, 7)), `the commit is still named: ${o.context}`);
  assert.match(o.context, /pm bookkeeping .* and needs no attribution/);
  assert.doesNotMatch(o.context, /--attribute-commit/, "a bookkeeping commit must never be handed an attribution command");
});

test("1 an /opsx:archive move (every file removed from changes/<id>/ and added under archive/) is bookkeeping", () => {
  const repo = observationRepo();
  repo.commit({ "openspec/changes/epic-a/proposal.md": "p\n", "openspec/changes/epic-a/tasks.md": "- [x] 1. t\n" },
    "feat(epic-a): propose");
  repo.observe();
  fs.mkdirSync(path.join(repo.gitRoot, "openspec", "changes", "archive"), { recursive: true });
  repo.git("mv", "openspec/changes/epic-a", "openspec/changes/archive/2026-09-30-epic-a");
  repo.git("commit", "-q", "-m", "chore(conductor): archive epic-a");
  const o = repo.observe("PostToolUse", "git commit -m 'chore(conductor): archive epic-a'");
  assert.equal(o.status, 0, o.stderr);
  assert.match(o.context, /needs no attribution/, `the archive move is bookkeeping: ${o.context}`);
  assert.doesNotMatch(o.context, /--attribute-commit/);
});

test("1 an EDIT to a change under openspec/changes/ is real work and is still nudged", () => {
  const repo = observationRepo();
  repo.commit({ "openspec/changes/epic-a/tasks.md": "- [ ] 1. t\n" }, "feat(epic-a): propose");
  repo.observe();
  repo.commit({ "openspec/changes/epic-a/tasks.md": "- [x] 1. t\n" }, "docs: tick a task");
  const o = repo.observe("PostToolUse", "git commit -m 'docs: tick a task'");
  assert.doesNotMatch(o.context, /needs no attribution/, o.context);
  assert.deepEqual(attributeCommands(o.context), ["epic-a"]);
});

test("1 one real commit among bookkeeping ones is the only sha in the command, and the rest are named as bookkeeping", () => {
  const repo = observationRepo();
  repo.observe();
  const book = repo.commit({ "PROJECT.md": "x\n" }, "chore(conductor): re-render");
  const real = repo.commit({ "src/work.txt": "w\n" }, "feat(epic-a): the work");
  const o = repo.observe("PostToolUse", "git commit -m a && git commit -m b");
  assert.match(o.context, new RegExp(`update-epic epic-a --attribute-commit ${real}(?! --attribute-commit)`),
    "only the real commit is in the command");
  assert.doesNotMatch(o.context, new RegExp(`--attribute-commit ${book}`));
  assert.match(o.context, new RegExp(`${book.slice(0, 7)}.* is bookkeeping and needs no attribution`));
});

test("2 a commit whose subject and paths do not name the active epic is offered as a candidate, never asserted as its work", () => {
  const repo = observationRepo();
  repo.observe();
  const sha = repo.commit({ "src/unrelated.txt": "u\n" }, "fix: an unrelated tool bug");
  const o = repo.observe("PostToolUse", "git commit -m 'fix: an unrelated tool bug'");
  assert.match(o.context, /cannot tell whether this commit is `epic-a`'s work/);
  assert.match(o.context, /If this commit is `epic-a`'s work, record it/);
  assert.match(o.context, /If it is not, attribute nothing/);
  assert.match(o.context, new RegExp(`update-epic epic-a --attribute-commit ${sha}`), "the command is still runnable");
  assert.doesNotMatch(o.context, /record this commit against its epic now/);
});

test("2 a commit whose subject names the epic, or whose paths are the epic's own, keeps the assertive sentence", () => {
  const repo = observationRepo();
  repo.observe();
  repo.commit({ "src/work.txt": "w\n" }, "feat(epic-a): the work");
  const bySubject = repo.observe("PostToolUse", "git commit -m 'feat(epic-a): the work'");
  assert.doesNotMatch(bySubject.context, /cannot tell whether/, bySubject.context);
  assert.match(bySubject.context, /epic-a` has attributed no commits yet/);
  repo.commit({ "openspec/changes/epic-a/design.md": "d\n" }, "docs: write the design");
  const byPath = repo.observe("PostToolUse", "git commit -m 'docs: write the design'");
  assert.doesNotMatch(byPath.context, /cannot tell whether/, byPath.context);
});

test("1 with NO active epic there is still no attribution line at all, bookkeeping or not", () => {
  const repo = observationRepo({ epicId: null });
  repo.observe();
  repo.commit({ "PROJECT.md": "re-rendered\n" }, "chore(conductor): re-render");
  const o = repo.observe("PostToolUse", "git commit -m 'chore(conductor): re-render'");
  assert.equal(o.status, 0, o.stderr);
  assert.doesNotMatch(o.context, /ATTRIBUTION/, `no candidate means no line, even a 'needs no attribution' one: ${o.context}`);
  repo.commit({ "src/work.txt": "w\n" }, "feat: some work");
  const real = repo.observe("PostToolUse", "git commit -m 'feat: some work'");
  assert.doesNotMatch(real.context, /ATTRIBUTION/, real.context);
});
