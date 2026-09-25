// scripts/test/assert/archived-progress.test.mjs
// handoff-demand-blind-spots, design D1 (conductor-record "Outstanding work is a defined quantity"):
// the checkbox source of an archived openspec change is its ARCHIVED tasks.md, for every epic and not
// only a backfilled one, and ONE resolver decides which archived directory is an epic's.
//
// THE FILE RUNG, because every fixture here writes `openspec/changes/archive/<dir>/tasks.md` for the
// engine to read (the unit rung refuses a test that touches a path; precedent unit/conductor-22 and
// unit/conductor-03, which left every `withArchivedChange()` case here).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, readState, writeState, withAssertInvocation, expectFail, invokeEngine } from "../fixtures/assert-harness.mjs";
import * as progress from "../../lib/epic-progress.mjs";

/** Write `tasks.md` with `ticked` ticked and `open` unticked undeclared tasks (plus, optionally, a
 *  declared archive task), under `openspec/changes/archive/<dir>/`. */
function archivedTasks(cwd, dir, { ticked, open, declared = false }) {
  const d = path.join(cwd, "openspec", "changes", "archive", dir);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "tasks.md"), "# Tasks\n\n" +
    Array.from({ length: ticked }, (_, n) => `- [x] ${n + 1} shipped\n`).join("") +
    Array.from({ length: open }, (_, n) => `- [ ] ${ticked + n + 1} open\n`).join("") +
    (declared ? "- [ ] 99 <!-- pm:lifecycle --> archive this change\n" : ""));
}

const managed = (id) => ({ id, title: id, priority: "P1", status: "archived", role: "epic", lane: "openspec", links: [] });

for (const [label, dirOf] of [["date-prefixed", (id) => `2026-08-05-${id}`], ["undated", (id) => id]]) {
  test(`1.2 a MANAGED archived epic (no backfill stamp) reads its archived tasks.md — ${label} directory`, async () => {
    const cwd = tmpRepo();
    archivedTasks(cwd, dirOf("managed-change"), { ticked: 1, open: 2 });
    await withAssertInvocation(cwd, () => {
      const p = progress.epicProgress(managed("managed-change"));
      assert.deepEqual([p.done, p.total], [1, 3],
        "the archived tasks.md is the checkbox source once the live one is gone — `0/0` is the blind spot");
      assert.equal(progress.outstandingWork(managed("managed-change")), 2);
      assert.equal(p.warn, null, "an archived epic whose source was found does not warn");
    });
  });
}

test("1.2 two dated directories for one id: the LATER date is read, and isArchived/archivedTasksPath name it", async () => {
  const cwd = tmpRepo();
  archivedTasks(cwd, "2026-08-01-twice", { ticked: 1, open: 4 });
  archivedTasks(cwd, "2026-09-01-twice", { ticked: 2, open: 1 });
  archivedTasks(cwd, "twice", { ticked: 0, open: 7 });
  await withAssertInvocation(cwd, () => {
    assert.equal(typeof progress.archivedChangeDir, "function", "ONE exported resolver answers both questions");
    assert.equal(progress.archivedChangeDir("twice"), "2026-09-01-twice",
      "the latest date wins, and an undated directory ranks below every dated one");
    assert.equal(path.basename(path.dirname(progress.archivedTasksPath("twice"))), "2026-09-01-twice",
      "archivedTasksPath() reads the directory the resolver names — never the first in directory order");
    assert.equal(progress.isArchived("twice"), true);
    const p = progress.epicProgress(managed("twice"));
    assert.deepEqual([p.done, p.total], [2, 3], "progress is read from the 2026-09-01 directory");
  });
});

test("1.2 an id that itself carries a date prefix resolves identically through both questions", async () => {
  const cwd = tmpRepo();
  archivedTasks(cwd, "2026-07-07-dated-id", { ticked: 1, open: 1 });
  await withAssertInvocation(cwd, () => {
    for (const id of ["2026-07-07-dated-id", "dated-id", "2026-01-01-dated-id"]) {
      assert.equal(progress.archivedChangeDir(id), "2026-07-07-dated-id", `${id} resolves by its stripped id`);
      assert.equal(progress.isArchived(id), true, `${id}: isArchived agrees with the resolver`);
      assert.equal(path.basename(path.dirname(progress.archivedTasksPath(id))), "2026-07-07-dated-id",
        `${id}: archivedTasksPath agrees with the resolver`);
    }
    assert.equal(progress.archivedChangeDir("never-archived"), null);
    assert.equal(progress.isArchived("never-archived"), false);
  });
});

test("1.2 the live tasks.md still wins while it exists", async () => {
  const cwd = tmpRepo();
  archivedTasks(cwd, "2026-08-05-both", { ticked: 0, open: 5 });
  const live = path.join(cwd, "openspec", "changes", "both");
  fs.mkdirSync(live, { recursive: true });
  fs.writeFileSync(path.join(live, "tasks.md"), "- [x] 1 a\n- [x] 2 b\n");
  await withAssertInvocation(cwd, () => {
    const p = progress.epicProgress({ ...managed("both"), status: "queued" });
    assert.deepEqual([p.done, p.total], [2, 2]);
  });
});

// ───────────── 1.3 — the documented sequence refuses a delivered archive with open archived tasks ─────────────

/** Gate 2 recorded, the change moved under archive/, the heal run: the documented state at which the
 *  agent records the real disposition. `tasks` shapes the archived tasks.md. */
function documentedSequence(tasks) {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "seq-change", "--lane", "openspec", "--status", "active"], { cwd });
  const st = readState(cwd);
  const e = st.epics.find(x => x.id === "seq-change");
  // A passing Gate 2 with no attribution array: `unverifiable`, which the gate does not refuse.
  e.gateReview = { gate2: { verdict: "pass", reviewer: "r", reviewedAt: "2026-09-25T00:00:00.000Z" } };
  delete e.attributedCommits;
  writeState(cwd, st);
  archivedTasks(cwd, "2026-09-25-seq-change", tasks);   // /opsx:archive moved the change
  run(["sync"], { cwd });                                // the archive-drift heal
  const healed = readState(cwd).epics.find(x => x.id === "seq-change");
  assert.equal(healed.status, "archived", "the heal flipped it");
  return cwd;
}
const stateBytes = (cwd) => fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");

test("1.3 the documented sequence REFUSES delivered while the archived tasks.md has open tasks", () => {
  const cwd = documentedSequence({ ticked: 1, open: 2 });
  const before = stateBytes(cwd);
  const r = invokeEngine(["update-epic", "seq-change", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd });
  assert.notEqual(r.status, 0, "a delivered archive over open archived tasks is refused");
  assert.match(r.stderr, /2 of 1\/3 task\(s\) outstanding|2 task\(s\) outstanding \(1\/3 done\)/,
    `the refusal names the count the record renders, got: ${r.stderr}`);
  assert.equal(stateBytes(cwd), before, "and the store is byte-identical");
});

test("1.3 the paired case: every undeclared archived task ticked, the archive task declared → accepted", () => {
  const cwd = documentedSequence({ ticked: 3, open: 0, declared: true });
  const r = invokeEngine(["update-epic", "seq-change", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd });
  assert.equal(r.status, 0, `accepted, got: ${r.stderr}`);
  assert.equal(readState(cwd).epics.find(x => x.id === "seq-change").disposition.outcome, "delivered");
});

void expectFail;
