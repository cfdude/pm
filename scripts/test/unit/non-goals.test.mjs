// release-planning-taxonomy 3.1 (spec non-goals): one non-goal shape on four records. UNIT rung. A SUCCESSFUL `mission` or
// `initiative` write may refresh the managed rules block, which the unit rung's counter refuses, so those two are driven through
// their PURE `applyMission()` / `applyInitiative()`; release, add-epic, update-epic and add-many go through the verb.

import assert from "node:assert/strict";
import { memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";
import { applyMission, missionShowLines } from "../../lib/mission.mjs";
import { applyInitiative, initiativeShowLines } from "../../lib/initiative.mjs";
import { activeNonGoals, addNonGoals, nonGoalError } from "../../lib/non-goals.mjs";

const T = (n) => `2026-11-0${n}T00:00:00Z`;
const epic = (id, over = {}) => ({ id, title: id, priority: "P2", status: "queued", role: "epic", lane: "claude-code", links: [], ...over });
const record = (over = {}) => ({ version: 1, revision: 1, active: null, detourStack: [], epics: [epic("e")], releases: [{ id: "r1", intent: "i", deferred: [] }], ...over });
const board = (state) => JSON.parse(memoryEngine(state)(["board", "--json"]));
const stateOf = (engine) => engine.store.record();

unitTest("shape: {id, text, addedAt}, ids n1, n2 per record from a counter that only advances", () => {
  const rec = {};
  assert.deepEqual(addNonGoals(rec, ["a", "b"], T(1)), ["n1", "n2"]);
  assert.deepEqual(rec.nonGoals[0], { id: "n1", text: "a", addedAt: T(1) });
  rec.nonGoals[1].removedAt = T(2);
  assert.deepEqual(addNonGoals(rec, ["c"], T(3)), ["n3"], "a removed id is never reused");
  assert.deepEqual(activeNonGoals(rec).map(g => g.id), ["n1", "n3"]);
  assert.equal(rec.nextNonGoal, 4);
});

unitTest("ids are per record: a mission non-goal and a release non-goal are both n1, each listed only under its own record", () => {
  const s = record();
  assert.equal(applyMission(s, { "add-non-goal": ["No Jira sync"] }, T(1)).ok, true);
  const e = memoryEngine(s);
  e(["release", "r1", "--add-non-goal", "No SSO"]);
  const b = board(stateOf(e));
  assert.deepEqual(b.missionNonGoals, [{ id: "n1", text: "No Jira sync" }]);
  assert.deepEqual(b.releases[0].nonGoals, [{ id: "n1", text: "No SSO" }]);
  assert.deepEqual(b.epics[0].nonGoals, []);
});

unitTest("a bad value writes nothing: empty, a newline, 301 characters", () => {
  for (const bad of ["", "a\nb", "x".repeat(301)]) {
    assert.match(nonGoalError(bad), /one line of at most 300 characters/, JSON.stringify(bad).slice(0, 20));
  }
  assert.equal(nonGoalError("x".repeat(300)), null);
  const e = memoryEngine(record());
  const before = JSON.stringify(stateOf(e));
  const r = e.result(["release", "r1", "--add-non-goal", "x".repeat(301)]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /one line of at most 300 characters/);
  assert.equal(JSON.stringify(stateOf(e)), before);
  const blank = e.result(["release", "r1", "--add-non-goal", ""]);
  assert.notEqual(blank.status, 0);
  assert.equal(JSON.stringify(stateOf(e)), before);
});

unitTest("add: repeatable, appended in order on update-epic and release", () => {
  const e = memoryEngine(record());
  e(["update-epic", "e", "--add-non-goal", "No Jira sync", "--add-non-goal", "No new verb"]);
  assert.deepEqual(board(stateOf(e)).epics[0].nonGoals, [{ id: "n1", text: "No Jira sync" }, { id: "n2", text: "No new verb" }]);
  e(["release", "r1", "--add-non-goal", "a", "--add-non-goal", "b"]);
  assert.deepEqual(board(stateOf(e)).releases[0].nonGoals.map(g => g.id), ["n1", "n2"]);
});

unitTest("add: one bad value among several refuses the whole invocation", () => {
  const e = memoryEngine(record());
  const before = JSON.stringify(stateOf(e));
  const r = e.result(["update-epic", "e", "--add-non-goal", "fine", "--add-non-goal", "x".repeat(301)]);
  assert.notEqual(r.status, 0);
  assert.equal(JSON.stringify(stateOf(e)), before, "the first good value was not written either");
  const m = { ...record() };
  const mb = JSON.stringify(m);
  assert.equal(applyMission(m, { "add-non-goal": ["fine", "a\nb"] }, T(1)).ok, false);
  assert.equal(JSON.stringify(m), mb);
});

unitTest("add-epic registers an epic with non-goals, and add-many reads a nonGoals array per entry", () => {
  const e = memoryEngine(record());
  e(["add-epic", "--id", "n1e", "--lane", "claude-code", "--add-non-goal", "No CSV"]);
  assert.deepEqual(board(stateOf(e)).epics.find(x => x.id === "n1e").nonGoals, [{ id: "n1", text: "No CSV" }]);
  const many = memoryEngine(record());
  many(["add-many", "--from", "-"], { input: JSON.stringify({ epics: [{ id: "b1", lane: "claude-code", nonGoals: ["No CSV export", "No PDF"] }] }) });
  assert.deepEqual(board(stateOf(many)).epics.find(x => x.id === "b1").nonGoals.map(g => g.text), ["No CSV export", "No PDF"]);
});

unitTest("add-many refuses a bad nonGoals entry or a non-array and creates nothing", () => {
  for (const bad of [["a\nb"], "No CSV", [7], ["x".repeat(301)]]) {
    const e = memoryEngine(record());
    const before = JSON.stringify(stateOf(e));
    const r = e.result(["add-many", "--from", "-"], { input: JSON.stringify({ epics: [{ id: "b1", lane: "claude-code", nonGoals: bad }] }) });
    assert.notEqual(r.status, 0, JSON.stringify(bad));
    assert.equal(JSON.stringify(stateOf(e)), before);
  }
});

unitTest("remove: marks with time and reason, split at the first colon, on mission, initiative, release and update-epic", () => {
  const s = record();
  applyMission(s, { "add-non-goal": ["m"] }, T(1));
  assert.equal(applyMission(s, { "remove-non-goal": "n1:now in scope: yes" }, T(2)).ok, true);
  assert.equal(s.mission.nonGoals[0].removeReason, "now in scope: yes");
  assert.equal(s.mission.nonGoals[0].removedAt, T(2));
  assert.deepEqual(board(s).missionNonGoals, []);
  const e = memoryEngine(s);
  e(["release", "r1", "--add-non-goal", "r"]);
  e(["release", "r1", "--remove-non-goal", "n1:cut"]);
  e(["update-epic", "e", "--add-non-goal", "x"]);
  e(["update-epic", "e", "--remove-non-goal", "n1:dropped"]);
  const b = board(stateOf(e));
  assert.deepEqual([b.releases[0].nonGoals, b.epics[0].nonGoals], [[], []]);
  assert.equal(stateOf(e).releases[0].nonGoals[0].removeReason, "cut", "kept in the record, not deleted");
});

unitTest("remove: refuses unknown, already removed, reasonless and repeated", () => {
  const e = memoryEngine(record());
  e(["release", "r1", "--add-non-goal", "a"]);
  e(["release", "r1", "--add-non-goal", "b"]);
  const fail = (args, re) => {
    const before = JSON.stringify(stateOf(e));
    const r = e.result(args);
    assert.notEqual(r.status, 0, args.join(" "));
    assert.match(r.stderr, re);
    assert.equal(JSON.stringify(stateOf(e)), before);
  };
  fail(["release", "r1", "--remove-non-goal", "n1"], /nN:<why>/);
  fail(["release", "r1", "--remove-non-goal", "n1:"], /nN:<why>/);
  fail(["release", "r1", "--remove-non-goal", "n9:x"], /not an active non-goal/);
  fail(["release", "r1", "--remove-non-goal", "n1:a", "--remove-non-goal", "n2:b"], /not repeatable/);
  e(["release", "r1", "--remove-non-goal", "n1:gone"]);
  fail(["release", "r1", "--remove-non-goal", "n1:again"], /not an active non-goal/);
  const m = record();
  assert.equal(applyMission(m, { "remove-non-goal": "n1:x" }, T(1)).ok, false);
});

unitTest("an initiative non-goal beside --add-milestone lands on the initiative; a milestone carries no non-goals", () => {
  const s = record();
  assert.equal(applyInitiative(s, "boards", { title: "t", capability: "c" }, T(1)).ok, true);
  assert.equal(applyInitiative(s, "boards", { "add-milestone": "Live in every repo", "add-non-goal": ["No hosted service"] }, T(2)).ok, true);
  const i = board(s).initiatives[0];
  assert.deepEqual(i.nonGoals, [{ id: "n1", text: "No hosted service" }]);
  assert.deepEqual(Object.keys(i.milestones[0]).sort(), ["evidence", "id", "reachedAt", "text"]);
  s.initiatives[0].milestones[0].nonGoals = [{ id: "n1", text: "smuggled", addedAt: T(1) }];
  assert.deepEqual(board(s).initiatives[0].nonGoals, [{ id: "n1", text: "No hosted service" }], "a nonGoals key on a milestone is ignored");
  assert.ok(!JSON.stringify(board(s)).includes("smuggled"));
});

unitTest("show --history lists the removed ones, and the plain show lists only the active", () => {
  const s = record();
  applyMission(s, { "add-non-goal": ["gone", "stays"] }, T(1));
  applyMission(s, { "remove-non-goal": "n1:now in scope" }, T(2));
  const plain = missionShowLines(s).join("\n");
  assert.match(plain, /non-goals \(1 active\)/);
  assert.match(plain, /n2 — stays/);
  assert.doesNotMatch(plain, /n1 — gone/);
  assert.match(missionShowLines(s, { history: true }).join("\n"), /non-goal n1 removed: now in scope \(gone\)/);
  applyInitiative(s, "boards", { title: "t", capability: "c", "add-non-goal": ["x"] }, T(1));
  applyInitiative(s, "boards", { "remove-non-goal": "n1:ok" }, T(2));
  assert.match(initiativeShowLines(s, "boards", { history: true }).lines.join("\n"), /non-goal n1 removed: ok \(x\)/);
  const e = memoryEngine(record());
  e(["release", "r1", "--add-non-goal", "rel goal"]);
  assert.match(e(["release", "show", "r1"]), /non-goals \(1\):[\s\S]*n1 — rel goal/);
});

unitTest("a hostile non-goal is escaped on every read-back", () => {
  const s = record();
  applyMission(s, { "add-non-goal": ["bad\u001b[31m"] }, T(1));
  assert.ok(!memoryEngine(s)(["mission", "show"]).includes("\u001b"));
  assert.match(memoryEngine(s)(["mission", "show"]), /bad\\u001b\[31m|bad.*31m/);
});
