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
//
// ─────────────── 4.1 SPLIT THIS FILE, AND THIS IS THE FILE-RUNG HALF ───────────────
//
// TWENTY of its twenty-four tests moved to `scripts/test/unit/conductor-21.test.mjs` — every
// story-creation and disposition test, the counts on both rendered surfaces, the archive-gate
// handoff, `--carried-to`, the legacy-record test, and all four gate-guard cases.
//
// FOUR STAY, on three of the four seam edges: two `add-many` tests whose fixture is a BATCH FILE; the
// checkbox-source test, which writes `docs/superpowers/plans/p.md` because reading that file IS its
// subject; and the usage/doc test, which reads `commands/epic.md`.
//
// No assertion changed in either direction.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, runCombined, readState, writeState, expectFail, writeBatch } from "../fixtures/assert-harness.mjs";

const stateFile = (cwd) => path.join(cwd, ".conductor", "state.json");
const epicOf = (cwd, id) => readState(cwd).epics.find(e => e.id === id);

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
test("update-epic's usage line and commands/epic.md both name --wont-do", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const usage = runCombined(["update-epic"], { cwd });
  assert.match(usage, /--wont-do/);
  const doc = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..", "commands", "epic.md"), "utf8");
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
