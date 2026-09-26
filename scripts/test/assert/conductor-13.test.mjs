// scripts/test/assert/conductor-13.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/conductor-13.test.mjs — same id, same subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is the FLAG REGISTRY (every flag a verb reads is declared exactly
// once), the DISPOSITION record (how an epic ended, who recorded it, and what that turns off), and
// the LIFECYCLE task count (a `<!-- pm:lifecycle -->`-marked task leaves both the numerator and the
// denominator). All three are state.json, argv and files — no git — so this twin carries the
// behavioural core and belongs on the per-commit path.
//
// THE REGISTRY IS THE ONE PLACE A FLAG CAN BE READ BUT NOT DECLARED, and the failure is silent: the
// verb works, and the flag is invisible to every help surface and every guard built on the registry.
//
// ─────────────── 4.1 SPLIT THIS FILE, AND THIS IS THE FILE-RUNG HALF ───────────────
//
// TWELVE of its twenty tests moved to `scripts/test/unit/conductor-13.test.mjs` — the two registry
// tests, the two unknown-flag refusals, the whole disposition family, and both
// archive-gate-as-a-value tests.
//
// EIGHT STAY, on three of the four seam edges:
//   * SIX lifecycle tests, ONE population: `changeWithTasks()` writes
//     `openspec/changes/feat-x/tasks.md`, and that file is what the task count is READ FROM — the
//     fixture has to put it on disk, which is the rule as written;
//   * `add-many rejects an unpersisted batch key` — a batch FILE;
//   * `update-epic holds no openspec-lane archive condition of its own` — reads `lib/update-epic.mjs`
//     and asserts its call site with comment-only lines stripped. It is one of the source-shape guards
//     4.1 names by hand, and it stays where its subject is.
//
// No assertion changed in either direction.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, readState, writeState, expectFail, projectMd } from "../fixtures/assert-harness.mjs";

const repo = () => { const cwd = tmpRepo(); run(["init"], { cwd }); return cwd; };

/** The source with COMMENT-ONLY lines removed: a line whose first non-space characters open a line
 *  comment, a block comment or a continuation of one.
 *
 *  IT IS LINE-ORIENTED ON PURPOSE, AND THAT IS THE REPAIR. A character-level stripper (the shape
 *  `assert-half-has-no-spawn.test.mjs` carries, whose docstring claims it can only produce a FALSE
 *  POSITIVE) was tried here first and IS NOT SOUND in that direction: measured on
 *  `lib/update-epic.mjs`, a regex literal holding a quote earlier in the file leaves it in
 *  string-mode, and every comment after that point passes through VERBATIM — a false NEGATIVE, which
 *  is the direction a guard cannot have. This cannot desync, because it never tracks state across
 *  lines: it either drops a whole line or keeps it whole. */
function codeLines(src) {
  return src.split("\n").filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join("\n");
}

test("add-many rejects an unpersisted batch key by name and creates ZERO epics", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  const batch = path.join(cwd, "batch.json");
  fs.writeFileSync(batch, JSON.stringify({ epics: [{ id: "b1", title: "t", lane: "claude-code", nonsense: 1 }] }));
  assert.ok(expectFail(() => run(["add-many", "--from", batch], { cwd })));
  assert.deepEqual(readState(cwd).epics, [], "a partial batch is not a batch");
});

// ─────────────────── the disposition record ───────────────────
test("update-epic holds no openspec-lane archive condition of its own", () => {
  // The gate owns the rule; a second copy in the verb is how the two drift apart.
  //
  // 5.6 MUTATION-REPAIRED. This read the RAW source, and the verb's own prose calls the gate by
  // name — `// The REPLACEMENT RULE, one level down from archiveGate()'s refusal …` — so the guard
  // was satisfied by a COMMENT. Proved by mutation in a copy: alias the imported symbol and its
  // call site away and the guard stayed GREEN, because the comment still matched. A source-reading
  // guard a comment can satisfy checks the wrong half of what it claims
  // (`docs/lessons/a-guard-can-check-the-wrong-half.md`), so the read drops comment-only lines.
  const src = codeLines(fs.readFileSync(new URL("../../lib/update-epic.mjs", import.meta.url), "utf8"));
  assert.match(src, /archiveGate\(/, "the verb calls the gate");
});

// ─────────────────── the lifecycle task count ───────────────────

/** An openspec change whose tasks.md holds `body`. */
function changeWithTasks(cwd, body, id = "feat-x") {
  const dir = path.join(cwd, "openspec", "changes", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "tasks.md"), body);
  return dir;
}
// The twin of the functional "a delivered archive with outstanding work names BOTH remedies and the
// same count", whose expected wording moved with code-review-0-43-0-minors ("3 of 78/81" read as
// three numbers; it is "3 task(s) outstanding (78/81 done)" now). Same count, from a plan checkbox
// source on disk — the file rung.
test("a delivered archive refused for open plan tasks states the count, then what is done", () => {
  const cwd = repo();
  fs.mkdirSync(path.join(cwd, "docs", "superpowers", "plans"), { recursive: true });
  const plan = path.join("docs", "superpowers", "plans", "rem.md");
  fs.writeFileSync(path.join(cwd, plan), ["# rem", "", "- [x] 1.1 Done", "- [ ] 2.1 Not done", "- [ ] 3.1 Nor this", ""].join("\n"));
  run(["add-epic", "--id", "rem", "--lane", "superpowers", "--plan", plan], { cwd });
  const err = expectFail(() => run(["update-epic", "rem", "--status", "archived", "--outcome", "delivered",
    "--no-deferrals"], { cwd }));
  assert.ok(err);
  assert.match(String(err.stderr || err.message), /2 task\(s\) outstanding \(1\/3 done\)/);
});
test("a declared lifecycle task leaves BOTH numerator and denominator", () => {
  const cwd = repo();
  run(["add-epic", "--id", "feat-x", "--title", "t", "--lane", "openspec"], { cwd });
  changeWithTasks(cwd, [
    "- [x] 1.1 do the thing",
    "- [ ] 1.2 <!-- pm:lifecycle --> Archive — /opsx:archive feat-x",
  ].join("\n") + "\n");
  run(["render"], { cwd });
  // One task counted, one ticked, and the marked line reported as its OWN count: the lifecycle
  // task leaves the numerator and the denominator TOGETHER, and the render says how many it left.
  assert.match(projectMd(cwd), /1\/1 stories · 1 lifecycle/);
});
test("a marked task is excluded whether or not it is ticked", () => {
  const cwd = repo();
  run(["add-epic", "--id", "feat-x", "--title", "t", "--lane", "openspec"], { cwd });
  changeWithTasks(cwd, [
    "- [x] 1.1 one",
    "- [x] 1.2 two <!-- pm:lifecycle --> Archive",
  ].join("\n") + "\n");
  run(["render"], { cwd });
  assert.match(projectMd(cwd), /1\/1 stories · 1 lifecycle/,
    "a marked task is excluded whether or not it is ticked");
});
test("the marker is read on the task LINE — never on a following line, never by position", () => {
  const cwd = repo();
  run(["add-epic", "--id", "feat-x", "--title", "t", "--lane", "openspec"], { cwd });
  changeWithTasks(cwd, [
    "- [ ] 1.1 an undeclared task",
    "<!-- pm:lifecycle --> on its own line",
  ].join("\n") + "\n");
  run(["render"], { cwd });
  const row = projectMd(cwd).split("\n").find(l => l.includes("`feat-x`"));
  assert.match(row, /0\/1 stories/, "a marker on its own line belongs to no task");
  assert.doesNotMatch(row, /lifecycle/, "and it excludes nothing");
});
test("an UNDECLARED task is counted however it is worded", () => {
  const cwd = repo();
  run(["add-epic", "--id", "feat-x", "--title", "t", "--lane", "openspec"], { cwd });
  changeWithTasks(cwd, [
    "- [ ] Archive the change",
    "- [ ] anything at all",
  ].join("\n") + "\n");
  run(["render"], { cwd });
  assert.match(projectMd(cwd), /0\/2 stories/);
});
test("a source whose every task is excluded is still a SOURCE — no missing-source warning", () => {
  const cwd = repo();
  run(["add-epic", "--id", "feat-x", "--title", "t", "--lane", "openspec"], { cwd });
  changeWithTasks(cwd, "- [ ] 1.1 <!-- pm:lifecycle --> Archive\n");
  run(["render"], { cwd });
  const md = projectMd(cwd);
  assert.doesNotMatch(md, /no change on disk/, "an all-excluded source is a source, not a ghost");
});
test("a task that merely DOCUMENTS the marker is not excluded by it", () => {
  const cwd = repo();
  run(["add-epic", "--id", "feat-x", "--title", "t", "--lane", "openspec"], { cwd });
  changeWithTasks(cwd, "- [ ] 1.1 write about the `<!-- pm:lifecycle -->` marker\n");
  run(["render"], { cwd });
  const row = projectMd(cwd).split("\n").find(l => l.includes("`feat-x`"));
  assert.match(row, /0\/1 stories/, "documenting the marker is not declaring it");
  assert.doesNotMatch(row, /lifecycle/);
});

// ───────────────────────── the deliberate omissions ─────────────────────────
//
// "the registry's update-epic projection still accepts every 0.26.0 UPDATE_EPIC_FLAGS entry" and the
// two 0.26.0 round-trip sweeps replay a FIXTURE read from the repository's own history; "no module
// under scripts/lib/ reads .outcome or .recordedBy off an epic" and "no module decides openspec-lane
// membership with a strict comparison" are source sweeps whose population is the whole tree. All are
// functional-only by subject (design D5), and the RULES they protect are asserted above.

// sync-registers-ids-add-epic-refuses (0.50.0) — twin note for the functional file's fixture change.
// The one archive resolver now sets aside an archive directory dated more than a day before the epic's
// `createdAt`, and never ends an undated live epic on a bare name. The functional fixtures that
// registered an epic and then archived its change under a FIXED past date (or hand-wrote a live epic
// with no `createdAt`) described a history that cannot happen; they now date the directory with
// `archiveDay()` (fixtures/helpers.mjs) or give the epic an earlier `createdAt`. Their assertions are
// unchanged. The rule itself is asserted per commit in assert/sync-registration-ids.test.mjs.
