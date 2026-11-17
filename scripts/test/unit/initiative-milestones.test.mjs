// release-planning-taxonomy 2.3 (spec initiative-record): initiative milestones nested inside their initiative. UNIT rung, pure
// `applyInitiative()` plus `board --json`. (This behaviour landed with the verb in 2.2, so its RED is recorded in red-2.3.txt as the
// mutation the guards were proven against.)

import assert from "node:assert/strict";
import { memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";
import { applyInitiative, initiativeShowLines } from "../../lib/initiative.mjs";

const T = (n) => `2026-11-0${n}T00:00:00Z`;
const record = (over = {}) => ({ version: 1, revision: 1, active: null, detourStack: [], epics: [], ...over });
const board = (state) => JSON.parse(memoryEngine(state)(["board", "--json"]));
const apply = (state, f, now = T(1)) => applyInitiative(state, "boards", f, now);
const ok = (state, f, now) => { const r = apply(state, f, now); assert.equal(r.ok, true, r.message); return r; };
const refusedWith = (state, f, re) => {
  const before = JSON.stringify(state);
  const r = apply(state, f);
  assert.equal(r.ok, false);
  assert.match(r.message, re);
  assert.equal(JSON.stringify(state), before);
};
const seeded = () => { const s = record(); ok(s, { title: "t", capability: "c" }); return s; };
const ids = (s) => board(s).initiatives[0].milestones.map(m => m.id);

unitTest("milestones: stable mN ids, never reused after a removal", () => {
  const s = seeded();
  ok(s, { "add-milestone": "one" });
  ok(s, { "add-milestone": "two" });
  assert.deepEqual(ids(s), ["m1", "m2"]);
  ok(s, { "remove-milestone": "m1:cut" }, T(2));
  ok(s, { "add-milestone": "three" });
  assert.deepEqual(ids(s), ["m2", "m3"]);
  assert.equal(s.initiatives[0].nextMilestone, 4);
});

unitTest("milestones: text is one line of at most 300 characters", () => {
  refusedWith(seeded(), { "add-milestone": "a\nb" }, /one line of at most 300/);
  refusedWith(seeded(), { "add-milestone": "x".repeat(301) }, /300/);
  assert.equal(apply(seeded(), { "add-milestone": "x".repeat(300) }).ok, true);
});

unitTest("milestones: removal marks with time and reason, keeps the record, and refuses unknown, removed and reasonless", () => {
  const s = seeded();
  ok(s, { "add-milestone": "one" });
  refusedWith(s, { "remove-milestone": "m1" }, /mN:<why>/);
  refusedWith(s, { "remove-milestone": "m1:" }, /mN:<why>|reason/);
  refusedWith(s, { "remove-milestone": "m9:x" }, /not an initiative milestone/);
  ok(s, { "remove-milestone": "m1:no longer a milestone: scope changed" }, T(2));
  assert.deepEqual(s.initiatives[0].milestones[0].removeReason, "no longer a milestone: scope changed", "split at the FIRST colon");
  assert.equal(s.initiatives[0].milestones[0].removedAt, T(2));
  refusedWith(s, { "remove-milestone": "m1:again" }, /already removed/);
  assert.deepEqual(ids(s), []);
  assert.match(initiativeShowLines(s, "boards", { history: true }).lines.join("\n"), /milestone m1 removed: no longer a milestone/);
  assert.doesNotMatch(initiativeShowLines(s, "boards").lines.join("\n"), /m1 —/);
});

unitTest("milestones: no release field, the mission milestone and criticalPath are untouched", () => {
  const s = record({ releases: [{ id: "r1", intent: "i", order: 1, deferred: [] }, { id: "r2", intent: "j", order: 2, deferred: [] }],
    mission: { current: { statement: "s", setAt: T(1), reason: "r" }, history: [], milestoneRelease: "r1", criteria: [], nextCriterion: 1 } });
  ok(s, { title: "t", capability: "c" });
  const before = board(s).releases.map(r => [r.id, r.criticalPath]);
  ok(s, { "add-milestone": "Boards live in every repo" });
  assert.equal(s.mission.milestoneRelease, "r1");
  assert.deepEqual(board(s).releases.map(r => [r.id, r.criticalPath]), before);
  assert.ok(!("release" in s.initiatives[0].milestones[0]));
  assert.deepEqual(Object.keys(board(s).initiatives[0].milestones[0]).sort(), ["evidence", "id", "reachedAt", "text"]);
});

unitTest("reach then unreach: both events kept, the mark follows, and the wrong state is refused", () => {
  const s = seeded();
  ok(s, { "add-milestone": "one" });
  ok(s, { "add-milestone": "two" });
  refusedWith(s, { "unreach-milestone": "m1:x" }, /not reached/);
  refusedWith(s, { "reach-milestone": "m1" }, /mN:<evidence>/);
  refusedWith(s, { "reach-milestone": "m1:" }, /mN:<evidence>|reason/);
  ok(s, { "reach-milestone": "m1:both boards live in 26 repos" }, T(2));
  const m = board(s).initiatives[0].milestones[0];
  assert.deepEqual([m.id, m.reachedAt, m.evidence], ["m1", T(2), "both boards live in 26 repos"]);
  refusedWith(s, { "reach-milestone": "m1:again" }, /already reached/);
  refusedWith(s, { "unreach-milestone": "m2:x" }, /not reached/);
  ok(s, { "unreach-milestone": "m1:three repos still fall back" }, T(3));
  const after = board(s).initiatives[0].milestones[0];
  assert.deepEqual([after.reachedAt, after.evidence], [null, null]);
  const shown = initiativeShowLines(s, "boards", { history: true }).lines.join("\n");
  assert.match(shown, /milestone m1 reached: both boards live/);
  assert.match(shown, /milestone m1 unreached: three repos still fall back/);
  refusedWith(s, { "reach-milestone": "m1:" + "e".repeat(301) }, /300/);
});

unitTest("reach and remove need an existing milestone, and a removed one cannot be reached", () => {
  const s = seeded();
  refusedWith(s, { "reach-milestone": "m1:x" }, /not an initiative milestone/);
  ok(s, { "add-milestone": "one" });
  ok(s, { "remove-milestone": "m1:cut" });
  refusedWith(s, { "reach-milestone": "m1:x" }, /already removed/);
});

unitTest("the three reasoned milestone flags are not repeatable: one reason, one record", () => {
  const s = seeded();
  ok(s, { "add-milestone": "one" });
  ok(s, { "add-milestone": "two" });
  refusedWith(s, { "remove-milestone": ["m1:a", "m2:b"] }, /not repeatable/);
});
