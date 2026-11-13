// scripts/test/unit/mission.test.mjs
// project-boards 4.1 (spec project-mission, managed-rules-block's `## Mission`): the mission record and its rules.
// UNIT rung. A SUCCESSFUL `mission` write refreshes CLAUDE.md's managed block, which the unit rung's counter refuses
// (the reason set-profile's success path is on the file rung), so this file drives the PURE `applyMission()` for every
// rule, the verb for every REFUSAL and for the read form, and the pure readers. The end-to-end write path, the
// `## Mission` section's bytes and `overhead` are in assert/mission-write.test.mjs.

import assert from "node:assert/strict";
import { memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";
import { applyMission, missionShowLines } from "../../lib/mission.mjs";
import { missionBriefLine, missionStatusLines } from "../../lib/mission-record.mjs";
import { missionSectionText, MISSION_SECTION_MAX_BYTES } from "../../lib/rules.mjs";
import { VERB_EFFECTS } from "../../lib/verb-effects.mjs";

const rel = (id, over = {}) => ({ id, intent: `intent of ${id}`, deferred: [], ...over });
const record = (releases = [], over = {}) => ({ version: 1, revision: 1, active: null, detourStack: [], epics: [], releases, ...over });
const T = (n) => `2026-11-0${n}T00:00:00Z`;
const apply = (state, f, now = T(1)) => applyMission(state, f, now);
const ok = (state, f, now) => { const r = apply(state, f, now); assert.equal(r.ok, true, r.message); return r; };
const refusedWith = (state, f, re) => {
  const before = JSON.stringify(state);
  const r = apply(state, f);
  assert.equal(r.ok, false);
  assert.match(r.message, re);
  assert.equal(JSON.stringify(state), before, "a refusal leaves the record untouched");
};
const board = (state) => JSON.parse(memoryEngine(state)(["board", "--json"]));

unitTest("statement: recorded with its time and reason; a new one moves the old into history with when and why", () => {
  const s = record();
  ok(s, { statement: "Stabilize the API", reason: "kickoff" }, T(1));
  assert.deepEqual(s.mission.current, { statement: "Stabilize the API", setAt: T(1), reason: "kickoff" });
  ok(s, { statement: "Ship trading", reason: "API locked" }, T(2));
  assert.equal(s.mission.current.statement, "Ship trading");
  assert.deepEqual(s.mission.history, [{ statement: "Stabilize the API", setAt: T(1), reason: "kickoff", endedAt: T(2), endReason: "API locked" }]);
  const shown = missionShowLines(s, { history: true }).join("\n");
  assert.match(shown, /Ship trading/);
  assert.match(shown, /Stabilize the API.*API locked/);
});

unitTest("statement: requires --reason, one line, at most 300 characters, and is never empty", () => {
  refusedWith(record(), { statement: "x" }, /--reason/);
  refusedWith(record(), { statement: "", reason: "r" }, /--statement/);
  refusedWith(record(), { statement: "a\nb", reason: "r" }, /one line/);
  refusedWith(record(), { statement: "x".repeat(301), reason: "r" }, /300/);
  assert.equal(apply(record(), { statement: "x".repeat(300), reason: "r" }).ok, true);
});

unitTest("statement: the same statement twice writes nothing and says so", () => {
  const s = record();
  ok(s, { statement: "x", reason: "r" });
  const before = JSON.stringify(s);
  const again = ok(s, { statement: "x", reason: "other" }, T(3));
  assert.equal(again.changed, false);
  assert.match(again.notes.join(" "), /nothing changed/);
  assert.equal(JSON.stringify(s), before);
  assert.equal(s.mission.history.length, 0);
});

unitTest("end: keeps the ended statement in history, leaves the milestone and criteria, and is refused with no mission", () => {
  const s = record([rel("r2")]);
  ok(s, { statement: "x", reason: "r" });
  ok(s, { milestone: "r2" });
  ok(s, { "add-criterion": "c" });
  ok(s, { end: true, reason: "project paused" }, T(4));
  assert.equal(s.mission.current, null);
  assert.deepEqual([s.mission.history[0].statement, s.mission.history[0].endReason], ["x", "project paused"]);
  assert.equal(s.mission.milestoneRelease, "r2");
  assert.equal(s.mission.criteria.length, 1);
  assert.equal(board(s).mission, null);
  refusedWith(record(), { end: true, reason: "x" }, /no current mission/);
});

unitTest("reason: serves exactly one operation, and is required by each", () => {
  refusedWith(record(), { statement: "x", end: true, reason: "r" }, /exactly one of --statement, --end and --remove-criterion/);
  const s = record();
  ok(s, { statement: "x", reason: "r" });
  ok(s, { "add-criterion": "c" });
  refusedWith(s, { end: true, "remove-criterion": "c1", reason: "r" }, /exactly one of --statement, --end and --remove-criterion/);
  refusedWith(s, { end: true }, /--end requires --reason/);
  refusedWith(s, { "remove-criterion": "c1" }, /--reason/);
  refusedWith(s, { milestone: "r1", reason: "r" }, /exactly one/);
});

unitTest("milestone: refuses an unknown release; --clear-milestone clears it and every criticalPath reads null", () => {
  const s = record([rel("r1", { order: 1 }), rel("r2", { order: 2 }), rel("r3", { order: 3 })]);
  refusedWith(s, { milestone: "nope" }, /nope/);
  ok(s, { milestone: "r2" });
  assert.deepEqual(board(s).releases.map(r => [r.id, r.criticalPath]), [["r1", true], ["r2", true], ["r3", false]]);
  ok(s, { "clear-milestone": true });
  assert.equal(board(s).milestone, null);
  assert.deepEqual(board(s).releases.map(r => r.criticalPath), [null, null, null]);
  refusedWith(s, { milestone: "r1", "clear-milestone": true }, /contradict/);
});

unitTest("criteria: ids are never reused, removal marks and keeps the record, and the board lists only active ones", () => {
  const s = record([rel("r1")]);
  ok(s, { milestone: "r1" });
  ok(s, { "add-criterion": "one" });
  ok(s, { "add-criterion": "two", check: "npm test" });
  ok(s, { "remove-criterion": "c1", reason: "merged into c2" }, T(5));
  ok(s, { "add-criterion": "three", "needs-human": true });
  assert.deepEqual(s.mission.criteria.map(c => c.id), ["c1", "c2", "c3"]);
  assert.deepEqual([s.mission.criteria[0].removedAt, s.mission.criteria[0].removeReason], [T(5), "merged into c2"]);
  assert.deepEqual(board(s).milestone.criteria.map(c => c.id), ["c2", "c3"]);
  assert.deepEqual([board(s).milestone.criteria[1].needsHuman, board(s).milestone.criteria[1].check], [true, null]);
  assert.match(missionShowLines(s, { history: true }).join("\n"), /c1 removed: merged into c2/);
  refusedWith(s, { "remove-criterion": "c1", reason: "again" }, /already removed/);
  refusedWith(s, { "remove-criterion": "c9", reason: "x" }, /c9/);
});

unitTest("criteria: --check and --needs-human apply only to --add-criterion and not together; criteria need no milestone", () => {
  refusedWith(record(), { check: "x" }, /apply only to --add-criterion/);
  refusedWith(record(), { "needs-human": true }, /apply only to --add-criterion/);
  refusedWith(record(), { "add-criterion": "c", check: "x", "needs-human": true }, /cannot be given together/);
  const s = record();
  ok(s, { "add-criterion": "kept without a milestone" });
  assert.equal(board(s).milestone, null);
  assert.match(missionShowLines(s).join("\n"), /c1 — kept without a milestone/);
});

unitTest("a call naming no operation is refused", () => {
  refusedWith(record(), {}, /needs an operation/);
});

unitTest("show: prints `no mission` on an empty record, exits 0, and writes nothing", () => {
  const engine = memoryEngine(record());
  const before = JSON.stringify(engine.store.record());
  assert.match(engine(["mission", "show"]), /no mission/);
  assert.equal(engine.result(["mission", "show", "--history"]).status, 0);
  assert.equal(JSON.stringify(engine.store.record()), before);
});

unitTest("show: reads the current statement, the mission milestone, the active criteria and the history count", () => {
  const s = record([rel("r1")]);
  ok(s, { statement: "A", reason: "r" });
  ok(s, { statement: "B", reason: "r2" });
  ok(s, { milestone: "r1" });
  ok(s, { "add-criterion": "crit" });
  const out = memoryEngine(s)(["mission", "show"]);
  assert.match(out, /mission: B/);
  assert.match(out, /mission milestone: r1/);
  assert.match(out, /c1 — crit/);
  assert.match(out, /history: 1 earlier statement/);
  assert.doesNotMatch(out, /ended:/, "the history entries print only under --history");
});

unitTest("verb refusals write nothing: no reason, a stray flag, --history off show, a bad milestone", () => {
  for (const args of [["--statement", "x"], ["--end"], ["--milestone", "nope"], ["--history"], ["show", "--statement", "x"]]) {
    const engine = memoryEngine(record());
    const before = JSON.stringify(engine.store.record());
    const r = engine.result(["mission", ...args]);
    assert.notEqual(r.status, 0, args.join(" "));
    assert.equal(JSON.stringify(engine.store.record()), before);
  }
});

unitTest("the verb is declared mutating, and mission is reserved read keyword `show`", () => {
  assert.equal(VERB_EFFECTS.mission.effect, "mutates");
});

unitTest("brief: the mission line is at most 200 bytes, truncated with an ellipsis, and absent with no mission", () => {
  const long = (n) => ({ mission: { current: { statement: "é".repeat(n), setAt: T(1), reason: "r" }, milestoneRelease: null } });
  const line = missionBriefLine(long(300));
  assert.ok(Buffer.byteLength(line) <= 200, `${Buffer.byteLength(line)} bytes`);
  assert.match(line, /…/);
  assert.match(line, /mission milestone: none/);
  assert.equal(missionBriefLine(record()), "");
  assert.equal(missionBriefLine({ mission: { current: null } }), "");
  const text = (state) => JSON.parse(memoryEngine(state)(["brief"])).hookSpecificOutput.additionalContext;
  const carried = text(record([], { mission: long(300).mission })).split("\n").find(l => l.includes("MISSION:"));
  assert.ok(carried && Buffer.byteLength(carried) <= 200, "the brief carries the line, within 200 bytes");
  assert.doesNotMatch(text(record()), /MISSION:/);
});

unitTest("status verb: prints the mission with the mission milestone and the active criteria count; nothing without one", () => {
  const s = record([rel("r1")]);
  ok(s, { statement: "Ship it", reason: "r" });
  ok(s, { milestone: "r1" });
  ok(s, { "add-criterion": "a" });
  const out = memoryEngine(s)(["render"]);
  assert.match(out, /mission: Ship it \(mission milestone: r1; 1 active criteria\)/);
  assert.deepEqual(missionStatusLines(record()), []);
  assert.doesNotMatch(memoryEngine(record())(["render"]), /^mission:/m);
});

unitTest("rules section: at most 280 bytes, ends the statement in an ellipsis and names the milestone; absent with no mission", () => {
  const text = missionSectionText({ mission: { current: { statement: "x".repeat(300), setAt: T(1), reason: "r" }, milestoneRelease: "r2" } });
  assert.ok(Buffer.byteLength(text) <= MISSION_SECTION_MAX_BYTES, `${Buffer.byteLength(text)} bytes`);
  assert.match(text, /^## Mission\n/);
  assert.match(text, /…/);
  assert.match(text, /Mission milestone: r2/);
  assert.equal(missionSectionText(record()), "");
  assert.equal(missionSectionText({ mission: { current: null, milestoneRelease: "r2" } }), "");
  assert.match(missionSectionText({ mission: { current: { statement: "short" }, milestoneRelease: null } }), /Mission milestone: none/);
});

unitTest("comment markers: `<!--` and `-->` are refused in the statement and in criterion text, writing nothing", () => {
  refusedWith(record(), { statement: "a <!-- b", reason: "r" }, /--statement.*<!--/);
  refusedWith(record(), { statement: "a --> b", reason: "r" }, /--statement.*-->/);
  refusedWith(record(), { "add-criterion": "a <!-- b" }, /--add-criterion.*<!--/);
  refusedWith(record(), { "add-criterion": "ok", check: "x --> y" }, /--check.*-->/);
});

unitTest("a stray positional on the mission verb is refused, writing nothing", () => {
  const engine = memoryEngine(record());
  const before = JSON.stringify(engine.store.record());
  const r = engine.result(["mission", "stray", "--statement", "x", "--reason", "r"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /stray|positional/i);
  assert.equal(JSON.stringify(engine.store.record()), before);
});

unitTest("the release verb-effects row says `release here` writes state.releasePlan", () => {
  assert.match(VERB_EFFECTS.release.writes, /release here.*state\.releasePlan/);
});
