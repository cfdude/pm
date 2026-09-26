// scripts/test/assert/progress-union.test.mjs
// handoff-demand-blind-spots, design D2: an epic's outstanding work is the UNION of its story part
// and its checkbox source, and neither can hide the other (conductor-record); the refusal names the
// remedy for EACH contributing part, as a conjunction (epic-disposition); every printed remedy keys on
// each part's own open count (emitted-instructions).
//
// THE FILE RUNG: every fixture here writes a `tasks.md` for the engine to read. The cases with no
// checkbox source at all are on the unit rung (unit/progress-union.test.mjs).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, readState, writeState, withAssertInvocation, invokeEngine, archiveDay } from "../fixtures/assert-harness.mjs";
import { bar, epicProgress, outstandingWork } from "../../lib/epic-progress.mjs";

const writeTasks = (cwd, rel, lines) => {
  const d = path.join(cwd, rel);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "tasks.md"), "# Tasks\n\n" + lines.join("\n") + "\n");
};
const liveTasks = (cwd, id, lines) => writeTasks(cwd, path.join("openspec", "changes", id), lines);
const archivedTasks = (cwd, id, lines) => writeTasks(cwd, path.join("openspec", "changes", "archive", `${archiveDay()}-${id}`), lines);
const epic = (over) => ({ id: "u", title: "u", priority: "P1", status: "queued", role: "epic", lane: "openspec", links: [], ...over });
const stateBytes = (cwd) => fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");

// ───────────── 2.1 — the union ─────────────

test("2.1 tasks.md at 1/3 plus one done story → 2/4, outstanding 2", async () => {
  const cwd = tmpRepo();
  liveTasks(cwd, "u", ["- [x] 1 a", "- [ ] 2 b", "- [ ] 3 c"]);
  await withAssertInvocation(cwd, () => {
    const e = epic({ stories: [{ title: "x", done: true }] });
    const p = epicProgress(e);
    assert.deepEqual([p.done, p.total], [2, 4], "a story added to an epic with a tasks.md does not hide the tasks");
    assert.equal(outstandingWork(e), 2);
    assert.equal(p.source, "stories+openspec", "two parts contribute, so the source is two-part");
    assert.deepEqual(p.parts, ["stories", "openspec"]);
    assert.equal(p.stories.open, 0, "the story part's own open count");
    assert.equal(p.checkbox.open, 2, "the checkbox source's own open count");
  });
});

test("2.1 a disposed story plus tasks.md at 2/2 plus a done story → 3/3, excludedLabel naming both kinds", async () => {
  const cwd = tmpRepo();
  liveTasks(cwd, "u", ["- [x] 1 a", "- [x] 2 b", "- [ ] 3 <!-- pm:lifecycle --> archive this change"]);
  await withAssertInvocation(cwd, () => {
    const e = epic({ stories: [{ title: "x", done: true }, { title: "y", done: false, disposition: { state: "wont-do", reason: "r" } }] });
    const p = epicProgress(e);
    assert.deepEqual([p.done, p.total], [3, 3], "the disposed story is in neither side; the tasks still are");
    assert.equal(p.excluded, 2, "one disposed story plus one declared lifecycle task");
    assert.match(p.excludedLabel, /disposed/);
    assert.match(p.excludedLabel, /lifecycle/);
    assert.match(bar(p), /1 disposed/, "the rendered record never calls a disposed story lifecycle");
    assert.match(bar(p), /1 lifecycle/);
  });
});

test("2.1 an openspec epic that is not archived, with stories and no tasks.md anywhere → the missing-source warning", async () => {
  const cwd = tmpRepo();
  await withAssertInvocation(cwd, () => {
    const e = epic({ stories: [{ title: "x", done: true }, { title: "y", done: false }] });
    const p = epicProgress(e);
    assert.equal(p.warn, "tasks.md missing", "a story no longer suppresses a missing checkbox source");
    assert.deepEqual([p.done, p.total], [1, 2], "and its stories are still counted");
  });
});

// ───────────── 2.2 — the 0.43.0 review's reproduction (A2) ─────────────

/** An openspec-lane epic with a passing Gate 2 (no attribution array: `unverifiable`, which the gate
 *  does not refuse), so the handoff is the only obligation in play. */
function gatedEpic(cwd, id, extra = {}) {
  run(["add-epic", "--id", id, "--lane", "openspec", "--status", "active"], { cwd });
  const st = readState(cwd);
  const e = st.epics.find(x => x.id === id);
  e.gateReview = { gate2: { verdict: "pass", reviewer: "r", reviewedAt: "2026-09-25T00:00:00.000Z" } };
  delete e.attributedCommits;
  Object.assign(e, extra);
  writeState(cwd, st);
}

test("2.2 tasks.md at 1/3, --add-story x, then --story 1 --done with a delivered archive → REFUSED, 2 outstanding", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  liveTasks(cwd, "a2", ["- [x] 1 a", "- [ ] 2 b", "- [ ] 3 c"]);
  gatedEpic(cwd, "a2");
  run(["update-epic", "a2", "--add-story", "x"], { cwd });
  const before = stateBytes(cwd);
  const r = invokeEngine(["update-epic", "a2", "--story", "1", "--done", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd });
  assert.notEqual(r.status, 0, "one inline story must not hide a whole tasks.md");
  assert.match(r.stderr, /2 task\(s\) outstanding \(2\/4 done\)/, `the refusal names the union's count, got: ${r.stderr}`);
  assert.equal(stateBytes(cwd), before, "and the store is byte-identical");
});

// ───────────── 2.3 — every consumer of the part a remedy keys on ─────────────

test("2.3 the archive refusal over BOTH parts names each part's remedy as a conjunction, and the handoff", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  liveTasks(cwd, "mixed", ["- [x] 1 a", "- [ ] 2 b"]);
  gatedEpic(cwd, "mixed", { stories: [{ title: "the open story", done: false }] });
  const before = stateBytes(cwd);
  const r = invokeEngine(["update-epic", "mixed", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd });
  assert.notEqual(r.status, 0);
  const msg = r.stderr;
  assert.match(msg, /2 task\(s\) outstanding \(1\/3 done\)/, "the count the record renders");
  assert.match(msg, /--story <n> --done/, "the story part's own remedy");
  assert.match(msg, /--wont-do/);
  assert.ok(msg.includes("<!-- pm:lifecycle -->"), "the checkbox source's own remedy, the literal declaration");
  assert.match(msg, /\bBOTH\b/, "the per-part remedies are stated as a conjunction");
  assert.match(msg, /--carried-to <epicId>/, "the handoff, the one remedy that covers both parts");
  // Never joined by "or": the story remedy's sentence and the lifecycle remedy's sentence are
  // separated by AND, and no single line offers one part's remedy as an alternative to the other's.
  assert.doesNotMatch(msg, /--wont-do[^\n]*\bor\b[^\n]*pm:lifecycle/, "the two parts' remedies are not alternatives");
  assert.ok(msg.includes("; AND\n"), "the story remedy's line ends in `; AND` — joined as a conjunction, never `; or`");
  assert.ok(!/; or\b/i.test(msg), "no `; or` between the per-part remedies");
  assert.equal(stateBytes(cwd), before);
});

/** The documented end state: Gate 2 passing, the change moved under archive/ with ONE open task, an
 *  open inline story on the epic, and the heal run — so the epic is `archived`, stamped `unknown` by
 *  the drift heal, and carries a passing Gate 2. A receiving epic `later` exists for the handoff. */
function healedMixed() {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "later", "--lane", "claude-code"], { cwd });
  gatedEpic(cwd, "mixed", { stories: [{ title: "the open story", done: false }] });
  archivedTasks(cwd, "mixed", ["- [x] 1 a", "- [ ] 2 b", "- [ ] 3 <!-- pm:lifecycle --> archive"]);
  run(["sync"], { cwd });
  const e = readState(cwd).epics.find(x => x.id === "mixed");
  assert.equal(e.status, "archived");
  assert.equal(e.disposition.outcome, "unknown");
  return cwd;
}
const unconsidered = (cwd) => JSON.parse(run(["unconsidered-outcomes"], { cwd }).replace(/^[^{]*/, ""));
const handoffOf = (report, id) => {
  const row = report.unconsidered.find(u => u.id === id);
  return row && row.deliveredBlockedBy.find(b => b.kind === "handoff");
};

test("2.3 unconsidered-outcomes over both parts: --story alone leaves the handoff named; the --carried-to archive clears it", () => {
  const cwd = healedMixed();
  const first = handoffOf(unconsidered(cwd), "mixed");
  assert.ok(first, "the handoff obligation is named");
  assert.ok(first.remedy.some(l => /--story <n> --done/.test(l)), "the story part's remedy is named");
  assert.ok(first.remedy.some(l => /--carried-to <epicId>/.test(l)), "and the checkbox source's handoff too");
  run(["update-epic", "mixed", "--story", "1", "--done"], { cwd });
  const second = handoffOf(unconsidered(cwd), "mixed");
  assert.ok(second, "recording the story alone is not the way past a union with a task still open");
  assert.ok(!second.remedy.some(l => /--story <n> --done/.test(l)), "and it no longer names the story remedy");
  const line = second.remedy.find(l => /--carried-to <epicId>/.test(l));
  const filled = line.replace("<epicId>", "later").replace('"<which tasks moved>"', "task-2-moved").split(" ");
  assert.equal(filled[0], "update-epic");
  run(filled, { cwd });
  const after = unconsidered(cwd);
  assert.equal(after.unconsidered.find(u => u.id === "mixed"), undefined, "the entry is removed");
  assert.ok(readState(cwd).epics.find(x => x.id === "mixed"), "and the epic still exists");
});

test("2.3 the drift-heal disposition step integrity prints names --story first AND carries --carried-to; followed, it clears", () => {
  const cwd = healedMixed();
  const report = run(["integrity"], { cwd });
  const block = report.split("\n").filter(l => l.includes("`mixed`") && l.includes("drift heal"));
  assert.equal(block.length, 1, `the heal check names the epic once, got:\n${report}`);
  const line = block[0];
  const story = line.indexOf("--story <n> --done"), carried = line.indexOf("--carried-to <epicId>");
  assert.ok(story > 0, "the story part's remedy is named");
  assert.ok(carried > story, "and the archive carrying --carried-to comes after it");
  run(["update-epic", "mixed", "--story", "1", "--done"], { cwd });
  run(["update-epic", "mixed", "--status", "archived", "--outcome", "delivered", "--carried-to", "later", "--reason", "task 2 moved", "--no-deferrals"], { cwd });
  const again = run(["integrity"], { cwd });
  assert.ok(!again.split("\n").some(l => l.includes("`mixed`") && l.includes("drift heal")), "the finding clears");
  assert.ok(readState(cwd).epics.find(x => x.id === "mixed"), "and the epic still exists");
});

test("2.3 the delivered-release alternative keys on each part: --story first, --carried-to for the task; followed in order it clears", () => {
  // emitted-instructions, "Each alternative of the delivered-release finding clears it on its own":
  // a member with an open inline story AND an open task in its checkbox source (a plan file here, so no
  // Gate 2 is owed and the handoff is the only obligation) is offered BOTH parts' remedies.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const plan = path.join("docs", "superpowers", "plans", "left.md");
  fs.mkdirSync(path.join(cwd, path.dirname(plan)), { recursive: true });
  fs.writeFileSync(path.join(cwd, plan), "# Plan\n\n- [x] 1 done\n- [ ] 2 still open\n");
  const st = readState(cwd);
  const base = { priority: "P1", role: "epic", links: [] };
  st.releases = [{ id: "1.0", intent: "x", deferred: [] }];
  st.epics.push(
    { ...base, id: "shipped", title: "shipped", lane: "claude-code", release: "1.0", status: "archived",
      disposition: { outcome: "delivered", recordedAt: "2026-01-01T00:00:00Z" } },
    { ...base, id: "left", title: "left", lane: "superpowers", release: "1.0", status: "queued", planPath: plan,
      stories: [{ title: "the open story", done: false }] },
    { ...base, id: "later", title: "later", lane: "claude-code", status: "queued" });
  writeState(cwd, st);
  const report = run(["integrity"], { cwd });
  const line = report.split("\n").find(l => l.includes("`left`") && l.includes("release"));
  assert.ok(line, `the member is reported:\n${report}`);
  const story = line.indexOf("--story <n> --done"), carried = line.indexOf("--carried-to <epicId>");
  assert.ok(story > 0 && carried > story, `--story first, then the archive carrying --carried-to:\n${line}`);
  run(["update-epic", "left", "--story", "1", "--done"], { cwd });
  run(["update-epic", "left", "--status", "archived", "--outcome", "delivered", "--carried-to", "later", "--reason", "task 2 moved", "--no-deferrals"], { cwd });
  const again = run(["integrity"], { cwd });
  assert.ok(!again.split("\n").some(l => l.includes("`left`") && l.includes("release")), "the finding clears");
  assert.ok(readState(cwd).epics.find(x => x.id === "left"), "and the epic still exists");
});
