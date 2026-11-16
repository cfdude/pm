// release-planning-taxonomy 4.4 (spec release-planning): `releaseJoinedAt` and the derived planning baseline. UNIT rung, through the verb.

import assert from "node:assert/strict";
import { memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";
import { releaseScope } from "../../lib/release-plan.mjs";

const epic = (id, over = {}) => ({ id, title: id, priority: "P2", status: "queued", role: "epic", lane: "superpowers", links: [], ...over });
const record = (epics) => ({ version: 1, revision: 1, active: null, detourStack: [], epics,
  releases: [{ id: "r1", intent: "i", deferred: [] }, { id: "r2", intent: "j", deferred: [] }] });
const E = (e, id) => e.store.record().epics.find(x => x.id === id);

unitTest("--member writes releaseJoinedAt on a join; a repeat for the same release keeps it; a move replaces it", async () => {
  const e = memoryEngine(record([epic("a")]));
  e(["release", "r1", "--member", "a"]);
  const first = E(e, "a").releaseJoinedAt;
  assert.ok(Number.isFinite(Date.parse(first)));
  await new Promise(r => setTimeout(r, 5));
  e(["release", "r1", "--member", "a"]);
  assert.equal(E(e, "a").releaseJoinedAt, first, "a repeat keeps the first join time");
  await new Promise(r => setTimeout(r, 5));
  e(["release", "r2", "--member", "a"]);
  assert.notEqual(E(e, "a").releaseJoinedAt, first);
  assert.ok(Date.parse(E(e, "a").releaseJoinedAt) > Date.parse(first), "a move replaces it with the move's time");
});

unitTest("both removers delete it: --unmember and --defer on that release", () => {
  const e = memoryEngine(record([epic("a"), epic("b")]));
  e(["release", "r1", "--member", "a", "--member", "b"]);
  assert.ok(E(e, "a").releaseJoinedAt && E(e, "b").releaseJoinedAt);
  e(["release", "r1", "--unmember", "a:wrong release"]);
  assert.equal(E(e, "a").release, undefined);
  assert.equal(E(e, "a").releaseJoinedAt, undefined);
  e(["release", "r1", "--defer", "b:cut"]);
  assert.equal(E(e, "b").release, undefined);
  assert.equal(E(e, "b").releaseJoinedAt, undefined);
});

unitTest("a pre-0.56.0 member reads null, and nothing backfills it", () => {
  const e = memoryEngine(record([epic("a", { release: "r1" })]));
  const b = JSON.parse(e(["board", "--json"]));
  assert.equal(b.epics[0].releaseJoinedAt, null);
  e(["release", "r1", "--intent", "i"]);
  assert.equal(E(e, "a").releaseJoinedAt, undefined);
});

unitTest("planningBaseline is the earliest startedAt among started members, null with none; the counts follow it", () => {
  const T = (n) => `2026-11-0${n}T00:00:00.000Z`;
  assert.deepEqual(releaseScope([epic("a"), epic("b")]), { planningBaseline: null, addedSincePlanning: null, unknownJoinTime: null });
  const scope = releaseScope([
    epic("e1", { startedAt: T(3), releaseJoinedAt: T(1) }),
    epic("e2", { startedAt: T(2), releaseJoinedAt: T(1) }),
    epic("e3", { releaseJoinedAt: T(5) }),
    epic("e4", { releaseJoinedAt: T(2) }),
    epic("e5"),
  ]);
  assert.deepEqual(scope, { planningBaseline: T(2), addedSincePlanning: 1, unknownJoinTime: 1 }, "the earliest startedAt, one later join, one with none");
});

unitTest("through the verbs: scope added after the first member started is reported by board and release show", () => {
  const first = memoryEngine(record([epic("e1"), epic("e2"), epic("e3")]));
  first(["release", "r1", "--member", "e1", "--member", "e2"]);
  const state = first.store.record();
  // e1 and e2 joined in 2000 (hand-set), e1 started later that year, and e3 joins now.
  state.epics[0].releaseJoinedAt = "2000-01-01T00:00:00.000Z";
  state.epics[1].releaseJoinedAt = "2000-01-02T00:00:00.000Z";
  state.epics[0].startedAt = "2000-06-01T00:00:00.000Z";
  const eng = memoryEngine(state);
  eng(["release", "r1", "--member", "e3"]);
  const r = JSON.parse(eng(["board", "--json"])).releases[0];
  assert.deepEqual([r.planningBaseline, r.addedSincePlanning, r.unknownJoinTime], ["2000-06-01T00:00:00.000Z", 1, 0]);
  assert.match(eng(["release", "show", "r1"]), /1 epic added since the first member started/);
});

unitTest("no baseline: no scope line, and `release --planned` is an unknown flag", () => {
  const e = memoryEngine(record([epic("a", { release: "r1" })]));
  assert.doesNotMatch(e(["release", "show", "r1"]), /added since/);
  const r = e.result(["release", "r1", "--planned"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /unknown flag/);
});

unitTest("a singular count reads `1 epic added`", () => {
  const T = "2000-01-01T00:00:00.000Z";
  const e = memoryEngine(record([epic("e1", { release: "r1", startedAt: T, releaseJoinedAt: T }), epic("e2", { release: "r1", releaseJoinedAt: "2026-11-01T00:00:00.000Z" })]));
  assert.match(e(["release", "show", "r1"]), /1 epic added since the first member started/);
});
