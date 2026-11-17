// release-planning-taxonomy 4.1 (spec release-planning, initiative-record): a release names its primary initiative or declares
// maintenance. UNIT rung, through the verb.

import assert from "node:assert/strict";
import { expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";
import { EPIC_FLAGS, VERB_FLAGS } from "../../lib/constants.mjs";

const initiative = (id, title = `Title of ${id}`) => ({ id, title, capability: "c", status: "open", outcome: null, endedAt: null, createdAt: "2026-11-01T00:00:00Z",
  history: [], milestones: [], nextMilestone: 1, nonGoals: [], nextNonGoal: 1 });
const record = (over = {}) => ({ version: 1, revision: 1, active: null, detourStack: [], epics: [],
  releases: [{ id: "r1", intent: "i", theme: "Lock the API", deferred: [] }], initiatives: [initiative("boards"), initiative("reporting")], ...over });
const board = (e) => JSON.parse(e(["board", "--json"])).releases.find(r => r.id === "r1");
const fails = (e, args, re) => {
  const before = JSON.stringify(e.store.record());
  const r = e.result(args);
  assert.notEqual(r.status, 0, args.join(" "));
  assert.match(r.stderr, re);
  assert.equal(JSON.stringify(e.store.record()), before, "a refusal writes nothing");
};

unitTest("set, switch and clear: --initiative, --maintenance, --clear-initiative", () => {
  const e = memoryEngine(record());
  e(["release", "r1", "--initiative", "boards"]);
  assert.deepEqual([board(e).initiative, board(e).maintenance], ["boards", false]);
  e(["release", "r1", "--maintenance"]);
  assert.deepEqual([board(e).initiative, board(e).maintenance], [null, true]);
  e(["release", "r1", "--initiative", "reporting"]);
  assert.deepEqual([board(e).initiative, board(e).maintenance], ["reporting", false]);
  e(["release", "r1", "--clear-initiative"]);
  assert.deepEqual([board(e).initiative, board(e).maintenance], [null, false]);
  e(["release", "r1", "--maintenance"]);
  e(["release", "r1", "--clear-initiative"]);
  assert.deepEqual([board(e).initiative, board(e).maintenance], [null, false], "it removes either");
});

unitTest("both at once, a contradiction with the clear, and an unknown initiative are refused", () => {
  const e = memoryEngine(record());
  fails(e, ["release", "r1", "--initiative", "boards", "--maintenance"], /exclusive/);
  fails(e, ["release", "r1", "--initiative", "boards", "--clear-initiative"], /contradict/);
  fails(e, ["release", "r1", "--maintenance", "--clear-initiative"], /contradict/);
  fails(e, ["release", "r1", "--initiative", "nope"], /nope/);
  fails(e, ["release", "r1", "--initiative"], /--initiative requires/);
});

unitTest("the plan marker takes none of the three", () => {
  const e = memoryEngine(record());
  for (const flag of [["--initiative", "boards"], ["--maintenance"], ["--clear-initiative"]]) {
    fails(e, ["release", "here", "r1", ...flag], /--text, --next and --clear-here/);
  }
});

unitTest("--goal is an unknown flag: the goal is the theme", () => {
  const e = memoryEngine(record());
  fails(e, ["release", "r1", "--goal", "x"], /unknown flag/);
  assert.ok(![...EPIC_FLAGS, ...VERB_FLAGS].some(r => r.flag === "goal"));
});

unitTest("release show keeps its theme label and prints the purpose", () => {
  const e = memoryEngine(record());
  assert.match(e(["release", "show", "r1"]), /theme: Lock the API/);
  assert.doesNotMatch(e(["release", "show", "r1"]), /initiative:/);
  e(["release", "r1", "--initiative", "boards"]);
  assert.match(e(["release", "show", "r1"]), /initiative: boards \(Title of boards\)/);
  assert.match(e(["release", "show", "r1"]), /theme: Lock the API/);
  e(["release", "r1", "--maintenance"]);
  assert.match(e(["release", "show", "r1"]), /initiative: maintenance/);
  assert.match(e(["release", "show"]), /r1.*maintenance/);
  e(["release", "r1", "--initiative", "boards"]);
  assert.match(e(["release", "show"]), /r1.*boards/);
});

unitTest("release show with a hostile initiative title escapes it", () => {
  const e = memoryEngine(record({ initiatives: [initiative("boards", "bad\u001b[31m title")] }));
  e(["release", "r1", "--initiative", "boards"]);
  assert.ok(!e(["release", "show", "r1"]).includes("\u001b"));
});

unitTest("an unknown initiative is refused by every flag that names one on release; a new release cannot be created by it alone", () => {
  const e = memoryEngine(record());
  fails(e, ["release", "r9", "--initiative", "boards"], /does not exist|--intent/);
  assert.ok(expectFail);
});
