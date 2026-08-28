// gh#95 — stories: atomic creation, and a terminal disposition that lets the ALREADY-EXISTING
// archive gate be cleared honestly.
//
// A separate file rather than an append to conductor-05 (the other story home) purely for
// concurrency: three agents were editing this suite in the same round, and a new file has no
// merge surface at all.
//
// What this file does NOT test, deliberately: a NEW archive refusal. There isn't one. The
// handoff demand in archive-gate.mjs already refuses `--outcome delivered` while
// outstandingWork() > 0, and epicProgress() reads `stories[]` FIRST — so an epic with an
// unticked story is already blocked. Measured on this repository's own record (2026-08-27):
// 3 of 99 archived epics carry incomplete stories and NONE of the three can be re-recorded as
// `delivered` today. The defect is that the refusal's own suggested remedy — put
// `<!-- pm:lifecycle -->` on the task's line — is IMPOSSIBLE on the stories path, because
// inline stories have no task source and epicProgress() hardcoded `excluded: 0` for them.
// The only key was epic-level `--carried-to`, which for deliberately-dropped work names a
// receiver nobody carried anything to: the fabricated record the message itself warns against.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, runCombined, readState, writeState, projectMd, parseBrief, expectFail, writeBatch } from "./helpers.mjs";

const stateFile = (cwd) => path.join(cwd, ".conductor", "state.json");
const epicOf = (cwd, id) => readState(cwd).epics.find(e => e.id === id);

// ───────────── complaint 2: stories creatable WITH the epic, in one write ─────────────

test("add-epic --add-story is repeatable and lands every story in the SAME write", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code",
    "--add-story", "First", "--add-story", "Second", "--add-story", "Third"], { cwd });
  assert.deepEqual(epicOf(cwd, "a").stories, [
    { title: "First", done: false },
    { title: "Second", done: false },
    { title: "Third", done: false },
  ]);
});

test("add-epic without --add-story writes NO stories key at all (absent, not empty)", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code"], { cwd });
  assert.equal("stories" in epicOf(cwd, "a"), false);
});

test("add-epic --add-story with a blank or valueless title is refused and creates no epic", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  for (const args of [["--add-story", "   "], ["--add-story"]]) {
    const err = expectFail(() => run(["add-epic", "--id", "a", "--lane", "claude-code", ...args], { cwd }));
    assert.ok(err, `expected ${args.join(" ")} to be refused`);
    assert.match(String(err.stderr || err.message), /non-empty title/);
    assert.equal(readState(cwd).epics.some(e => e.id === "a"), false, "no epic may be created");
  }
});

test("update-epic --add-story stays repeatable too — two in one call both land", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code"], { cwd });
  run(["update-epic", "a", "--add-story", "One", "--add-story", "Two"], { cwd });
  assert.deepEqual(epicOf(cwd, "a").stories.map(s => s.title), ["One", "Two"]);
});

test("add-many carries a `stories` array per entry, accepting plain titles and {title,done} objects", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const p = writeBatch(cwd, {
    parent: { id: "p", lane: "claude-code", stories: ["chunk 1", "chunk 2"] },
    epics: [{ id: "c1", lane: "claude-code", stories: [{ title: "done bit", done: true }, "todo bit"] }],
  });
  run(["add-many", "--from", p], { cwd });
  assert.deepEqual(epicOf(cwd, "p").stories, [
    { title: "chunk 1", done: false }, { title: "chunk 2", done: false },
  ]);
  assert.deepEqual(epicOf(cwd, "c1").stories, [
    { title: "done bit", done: true }, { title: "todo bit", done: false },
  ]);
});

test("add-many refuses a malformed stories entry and creates NOTHING (validated before any write)", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  for (const stories of [[""], [{ done: true }], "not an array", [42]]) {
    const p = writeBatch(cwd, { epics: [{ id: "ok", lane: "claude-code" }, { id: "bad", lane: "claude-code", stories }] });
    const err = expectFail(() => run(["add-many", "--from", p], { cwd }));
    assert.ok(err, `expected ${JSON.stringify(stories)} to be refused`);
    assert.match(String(err.stderr || err.message), /stories/);
    assert.equal(readState(cwd).epics.length, 0, "a refused batch must create no epics at all");
  }
});

// ───────────── the disposition: the honest key to a refusal that already exists ─────────────

test("--story <n> --wont-do \"<reason>\" keeps the row and records the reason durably", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code", "--add-story", "Keep", "--add-story", "Drop"], { cwd });
  run(["update-epic", "a", "--story", "2", "--wont-do", "docs site was retired"], { cwd });
  const s = epicOf(cwd, "a").stories;
  assert.equal(s.length, 2, "the row survives — deletion is not the release valve");
  assert.equal(s[1].title, "Drop");
  assert.equal(s[1].done, false, "a dropped story is NOT completed");
  assert.equal(s[1].disposition.state, "wont-do");
  assert.equal(s[1].disposition.reason, "docs site was retired");
  assert.match(s[1].disposition.recordedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(s[0], { title: "Keep", done: false }, "the untouched story is untouched");
});

test("--wont-do REQUIRES a reason — blank, whitespace and valueless are all refused, nothing written", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code", "--add-story", "Drop"], { cwd });
  const before = fs.readFileSync(stateFile(cwd), "utf8");
  for (const args of [["--wont-do", ""], ["--wont-do", "   "], ["--wont-do"]]) {
    const err = expectFail(() => run(["update-epic", "a", "--story", "1", ...args], { cwd }));
    assert.ok(err, `expected ${JSON.stringify(args)} to be refused`);
    assert.match(String(err.stderr || err.message), /--wont-do requires a reason/,
      "the refusal must name --wont-do's own rule, not a generic parse error");
    assert.equal(fs.readFileSync(stateFile(cwd), "utf8"), before);
  }
});

test("re-disposing an already-disposed story is refused — a recorded judgment is not overwritten", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code", "--add-story", "Drop"], { cwd });
  run(["update-epic", "a", "--story", "1", "--wont-do", "first reason"], { cwd });
  const before = fs.readFileSync(stateFile(cwd), "utf8");
  const err = expectFail(() => run(["update-epic", "a", "--story", "1", "--wont-do", "second reason"], { cwd }));
  assert.ok(err);
  assert.match(String(err.stderr || err.message), /already carries a recorded disposition/);
  assert.equal(fs.readFileSync(stateFile(cwd), "utf8"), before);
  assert.equal(epicOf(cwd, "a").stories[0].disposition.reason, "first reason");
});

test("a COMPLETED story cannot be dropped, and a DISPOSED story cannot be ticked done", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code", "--add-story", "Ship", "--add-story", "Drop"], { cwd });
  run(["update-epic", "a", "--story", "1", "--done"], { cwd });
  run(["update-epic", "a", "--story", "2", "--wont-do", "out of scope"], { cwd });
  const e1 = expectFail(() => run(["update-epic", "a", "--story", "1", "--wont-do", "changed my mind"], { cwd }));
  assert.ok(e1);
  assert.match(String(e1.stderr || e1.message), /already done/);
  const e2 = expectFail(() => run(["update-epic", "a", "--story", "2", "--done"], { cwd }));
  assert.ok(e2);
  assert.match(String(e2.stderr || e2.message), /already carries a recorded disposition/);
});

test("--story <n> with neither --done nor --wont-do names BOTH, and --wont-do without --story is refused", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code", "--add-story", "Only"], { cwd });
  const e1 = expectFail(() => run(["update-epic", "a", "--story", "1"], { cwd }));
  assert.match(String(e1.stderr || e1.message), /--done/);
  assert.match(String(e1.stderr || e1.message), /--wont-do/);
  const e2 = expectFail(() => run(["update-epic", "a", "--wont-do", "why"], { cwd }));
  assert.ok(e2);
  assert.match(String(e2.stderr || e2.message), /requires --story/);
});

// ───────────── what the disposition does to the counts, and so to the gate ─────────────

test("a disposed story leaves BOTH sides of the ratio, exactly as a lifecycle-marked task does", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code",
    "--add-story", "Ship", "--add-story", "Drop", "--add-story", "Also drop"], { cwd });
  run(["update-epic", "a", "--story", "1", "--done"], { cwd });
  run(["update-epic", "a", "--story", "2", "--wont-do", "r1"], { cwd });
  run(["update-epic", "a", "--story", "3", "--wont-do", "r2"], { cwd });
  // 1/1, not 1/3 and not 3/3: the two dropped rows are neither outstanding nor completed.
  assert.match(projectMd(cwd), /1\/1 stories · 2 disposed/);
  assert.match(parseBrief(cwd), /1\/1 stories · 2 disposed/);
});

test("an epic whose every story is disposed renders 0/0 · N disposed rather than an em dash", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code", "--add-story", "Drop"], { cwd });
  run(["update-epic", "a", "--story", "1", "--wont-do", "never mind"], { cwd });
  assert.match(projectMd(cwd), /0\/0 · 1 disposed/);
});

test("the EXISTING archive gate refuses a stories epic with an undisposed story, and the disposition clears it", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code", "--add-story", "Ship", "--add-story", "Drop"], { cwd });
  run(["update-epic", "a", "--story", "1", "--done"], { cwd });
  const err = expectFail(() => run(["update-epic", "a", "--status", "archived",
    "--outcome", "delivered", "--no-deferrals"], { cwd }));
  assert.ok(err, "the gate already refuses this — no new refusal is added by gh#95");
  run(["update-epic", "a", "--story", "2", "--wont-do", "descoped"], { cwd });
  run(["update-epic", "a", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd });
  const e = epicOf(cwd, "a");
  assert.equal(e.status, "archived");
  assert.equal(e.stories[1].disposition.reason, "descoped",
    "the archived epic still carries WHY the dropped work was dropped — the searchable audit trail");
});

test("the refusal NAMES the outstanding stories, and offers --wont-do instead of the impossible lifecycle marker", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code",
    "--add-story", "Ship", "--add-story", "Cut over staging DNS", "--add-story", "Retire the old worker"], { cwd });
  run(["update-epic", "a", "--story", "1", "--done"], { cwd });
  const err = expectFail(() => run(["update-epic", "a", "--status", "archived",
    "--outcome", "delivered", "--no-deferrals"], { cwd }));
  const msg = String(err.stderr || err.message);
  // The block IS the reminder: the unfinished work leads, the disposal options come second.
  assert.match(msg, /2\. Cut over staging DNS/);
  assert.match(msg, /3\. Retire the old worker/);
  assert.ok(msg.indexOf("Cut over staging DNS") < msg.indexOf("--wont-do"),
    "the stories must be named BEFORE the way past them");
  assert.doesNotMatch(msg, /pm:lifecycle/,
    "the lifecycle marker cannot be applied to an inline story — offering it is a dead end");
});

test("a checkbox-source epic's refusal is UNCHANGED — it still points at the lifecycle marker", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  fs.mkdirSync(path.join(cwd, "docs", "superpowers", "plans"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "docs", "superpowers", "plans", "p.md"), "# P\n\n- [x] one\n- [ ] two\n");
  run(["add-epic", "--id", "a", "--lane", "superpowers", "--plan", "docs/superpowers/plans/p.md"], { cwd });
  const err = expectFail(() => run(["update-epic", "a", "--status", "archived",
    "--outcome", "delivered", "--no-deferrals"], { cwd }));
  const msg = String(err.stderr || err.message);
  assert.match(msg, /pm:lifecycle/, "the checkbox path keeps its own remedy, which IS performable there");
  assert.doesNotMatch(msg, /--wont-do/, "--wont-do writes to stories[] and cannot dispose a checkbox");
});

test("--carried-to still clears the gate for a stories epic — the epic-level handoff is not replaced", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "recv", "--lane", "claude-code"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code", "--add-story", "Ship", "--add-story", "Moved"], { cwd });
  run(["update-epic", "a", "--story", "1", "--done"], { cwd });
  run(["update-epic", "a", "--status", "archived", "--outcome", "delivered", "--no-deferrals",
    "--carried-to", "recv", "--reason", "story 2 moved"], { cwd });
  assert.equal(epicOf(cwd, "a").status, "archived");
});

// ───────────── backward compatibility: no migration, old records still mean what they meant ─────────────

test("a pre-existing {title, done} story is untouched and still counts as outstanding", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code"], { cwd });
  const st = readState(cwd);
  st.epics.find(e => e.id === "a").stories = [{ title: "legacy", done: false }];
  fs.writeFileSync(stateFile(cwd), JSON.stringify(st, null, 2) + "\n");
  run(["render"], { cwd });
  assert.match(projectMd(cwd), /0\/1 stories/);
  assert.doesNotMatch(projectMd(cwd), /disposed/);
  const err = expectFail(() => run(["update-epic", "a", "--status", "archived",
    "--outcome", "delivered", "--no-deferrals"], { cwd }));
  assert.ok(err, "a legacy record keeps meaning exactly what it meant — no transform, no migration");
});

test("`--wont-do` is refused on an epic that has no stories at all, rather than inventing one", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code"], { cwd });
  const err = expectFail(() => run(["update-epic", "a", "--story", "1", "--wont-do", "x"], { cwd }));
  assert.ok(err);
  assert.match(String(err.stderr || err.message), /out of range/);
});

test("update-epic's usage line and commands/epic.md both name --wont-do", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const usage = runCombined(["update-epic"], { cwd });
  assert.match(usage, /--wont-do/);
  const doc = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..", "commands", "epic.md"), "utf8");
  assert.match(doc, /--wont-do/);
  assert.match(doc, /--add-story/);
});

// ───────── gate-guard: an epic that has ENDED must not still block writes (sibling of #95) ─────────
//
// Raised by another agent this round and verified against the code: `state.active` can name an
// ARCHIVED epic for a stretch, and the codebase already says so out loud — render.mjs:68 prints
// "`<id>` was archived; the active pointer clears on next `/pm:sync` or commit". render.mjs:53
// and briefing.mjs:60 both filter that case at the point they resolve the pointer to an epic.
// gate-guard.mjs was the THIRD reader and the only one that did not, so an ended epic could keep
// mechanically blocking Edit/Write/NotebookEdit through PreToolUse — and `set-gate-guard off`
// deliberately does not reach the reconcile case, so there was no way out but a hand-edit.
//
// The ordinary CLI path does not produce it (update-epic clears `state.active` on archive). A
// hand-edited state does, and this repo produces hand-edited state.
//
// BOTH DIRECTIONS ARE ASSERTED. This edits a hook that BLOCKS WRITES: an error the other way
// stops the guard firing when it should, which is worse than the defect being fixed.

const guardState = (over) => ({
  version: 1, active: "a", detourStack: [], epics: [{
    id: "a", title: "a", priority: "P1", role: "epic", lane: "claude-code", links: [],
    status: "active", reconcileNeeded: false, ...over,
  }],
});

test("gate-guard does NOT block on an ARCHIVED active epic that still carries reconcileNeeded", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, guardState({ status: "archived", reconcileNeeded: true }));
  run(["gate-guard"], { cwd, input: "{}" });   // must not throw
});

test("gate-guard does NOT block on an ARCHIVED active epic that still owes a tracker refresh", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, { ...guardState({ status: "archived", trackerRefreshNeeded: true }), gateGuard: true });
  run(["gate-guard"], { cwd, input: "{}" });   // must not throw
});

test("gate-guard STILL blocks a LIVE active epic that owes a reconcile — the fix must not disarm it", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  for (const status of ["active", "paused", "queued", "blocked"]) {
    writeState(cwd, guardState({ status, reconcileNeeded: true }));
    const err = expectFail(() => run(["gate-guard"], { cwd, input: "{}" }));
    assert.ok(err, `expected a block for a live epic at status '${status}'`);
    assert.match(String(err.stderr || err.message), /still owes a reconcile/);
  }
});

test("gate-guard STILL blocks a LIVE active epic that owes a tracker refresh", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, { ...guardState({ trackerRefreshNeeded: true }), gateGuard: true });
  const err = expectFail(() => run(["gate-guard"], { cwd, input: "{}" }));
  assert.ok(err);
  assert.match(String(err.stderr || err.message), /owes a tracker refresh/);
});
