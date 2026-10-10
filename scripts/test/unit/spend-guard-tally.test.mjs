// scripts/test/unit/spend-guard-tally.test.mjs
// spend-budget-and-stuck-loop-guard, tasks 1.1 and 1.2 — the per-gate round tally and the rule that
// only an accepted record-gate-review moves it. UNIT rung: every observable is a VALUE in the record,
// over an in-memory store (record-gate-review writes state.json only, never CLAUDE.md).

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";
import { gateTallies, passAnchor, recordedStreak, tallyVerdict } from "../../lib/spend-guard.mjs";

const repo = () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "e1", "--title", "E", "--lane", "openspec"]);
  return engine;
};
const epicOf = (engine) => engine.store.record().epics.find((e) => e.id === "e1");
const fail = (engine, gate) => engine(["record-gate-review", "e1", "--gate", String(gate), "--verdict", "fail"]);
const pass = (engine, gate) => engine(["record-gate-review", "e1", "--gate", String(gate), "--verdict", "pass",
  "--artifact", "openspec/changes/x/proposal.md"]);

unitTest("1.1 consecutive fails build a streak, with no lastPassAt key", () => {
  const engine = repo();
  fail(engine, 1); fail(engine, 1); fail(engine, 1);
  const g1 = epicOf(engine).gateRounds.gate1;
  assert.deepEqual(g1, { fails: 3, passes: 0, failStreak: 3, lastVerdictAt: epicOf(engine).gateReview.gate1.reviewedAt });
  assert.ok(!("lastPassAt" in g1), "lastPassAt is absent after fails only");
});

unitTest("1.1 a pass ends the streak, keeps the lifetime counts and stamps lastPassAt", () => {
  const engine = repo();
  // Gate 1: its pass needs artifacts, not a resolvable commit range, which this rung's double cannot give.
  fail(engine, 1); fail(engine, 1);
  pass(engine, 1);
  const g1 = epicOf(engine).gateRounds.gate1;
  assert.equal(g1.failStreak, 0);
  assert.equal(g1.fails, 2);
  assert.equal(g1.passes, 1);
  assert.equal(g1.lastPassAt, epicOf(engine).gateReview.gate1.reviewedAt);
  assert.equal(g1.lastVerdictAt, g1.lastPassAt);
});

unitTest("1.1 the two gates are counted apart", () => {
  const engine = repo();
  fail(engine, 1); fail(engine, 1);
  fail(engine, 2);
  const r = epicOf(engine).gateRounds;
  assert.equal(r.gate1.failStreak, 2);
  assert.equal(r.gate2.failStreak, 1);
});

unitTest("1.1 pass, fail, fail on one gate keeps lastPassAt though gateReview dropped the pass", () => {
  const engine = repo();
  pass(engine, 1);
  const passedAt = epicOf(engine).gateReview.gate1.reviewedAt;
  fail(engine, 1); fail(engine, 1);
  const e = epicOf(engine);
  assert.equal(e.gateRounds.gate1.lastPassAt, passedAt);
  assert.equal(e.gateReview.gate1.verdict, "fail");
  assert.equal(e.gateReview.gate1.superseded.verdict, "fail", "gateReview now holds only fails: the pass is gone");
  assert.equal(passAnchor(e), passedAt, "the anchor still sees it");
});

unitTest("1.1 the pass anchor is the latest lastPassAt across gates, and none without one", () => {
  assert.equal(passAnchor({}), null);
  assert.equal(passAnchor({ gateRounds: { gate1: { failStreak: 2 } } }), null);
  const e = { gateRounds: {
    gate1: { lastPassAt: "2026-10-09T01:00:00.000Z" },
    gate2: { lastPassAt: "2026-10-09T02:00:00.000Z" },
  } };
  assert.equal(passAnchor(e), "2026-10-09T02:00:00.000Z");
  const reversed = { gateRounds: { gate1: { lastPassAt: "2026-10-09T03:00:00.000Z" }, gate2: { lastPassAt: "2026-10-09T02:00:00.000Z" } } };
  assert.equal(passAnchor(reversed), "2026-10-09T03:00:00.000Z");
});

unitTest("1.1 recordedStreak is the highest failStreak across gates, naming the gate", () => {
  assert.deepEqual(recordedStreak({}), { count: 0, gate: null });
  assert.deepEqual(recordedStreak({ gateRounds: { gate1: { failStreak: 2 }, gate2: { failStreak: 3 } } }), { count: 3, gate: "gate2" });
  assert.equal(gateTallies({ gateRounds: { gate2: { failStreak: 1 }, gate1: { failStreak: 1 } } })[0][0], "gate1");
});

unitTest("1.1 tallyVerdict is the pure fold the verb calls", () => {
  const e = {};
  tallyVerdict(e, "1", "fail", "2026-10-09T00:00:00.000Z");
  tallyVerdict(e, "1", "pass", "2026-10-09T00:01:00.000Z");
  tallyVerdict(e, "1", "fail", "2026-10-09T00:02:00.000Z");
  assert.deepEqual(e.gateRounds.gate1, {
    fails: 2, passes: 1, failStreak: 1, lastVerdictAt: "2026-10-09T00:02:00.000Z", lastPassAt: "2026-10-09T00:01:00.000Z",
  });
});

unitTest("1.1 a refused invocation makes no write", () => {
  const engine = repo();
  const before = engine.store.read("state.json").text;
  expectFail(() => engine(["record-gate-review", "e1", "--gate", "2", "--verdict", "pass"]));   // missing --base-sha
  expectFail(() => engine(["record-gate-review", "ghost", "--gate", "1", "--verdict", "fail"]));
  assert.equal(engine.store.read("state.json").text, before);
  assert.equal(epicOf(engine).gateRounds, undefined);
});

unitTest("1.2 withdrawing a verdict leaves the tally unchanged", () => {
  const engine = repo();
  fail(engine, 1); fail(engine, 1);
  const before = JSON.stringify(epicOf(engine).gateRounds);
  engine(["update-epic", "e1", "--withdraw-gate-review", "1", "--withdrawal-reason", "x"]);
  assert.equal(JSON.stringify(epicOf(engine).gateRounds), before);
  assert.equal(epicOf(engine).gateRounds.gate1.failStreak, 2);
});

unitTest("1.2 a withdrawn pass is not undone: the streak stays 0 and lastPassAt still anchors", () => {
  const engine = repo();
  fail(engine, 1); fail(engine, 1); fail(engine, 1);
  pass(engine, 1);
  const passedAt = epicOf(engine).gateRounds.gate1.lastPassAt;
  engine(["update-epic", "e1", "--withdraw-gate-review", "1", "--withdrawal-reason", "x"]);
  const g1 = epicOf(engine).gateRounds.gate1;
  assert.equal(g1.failStreak, 0);
  assert.equal(g1.lastPassAt, passedAt);
  assert.equal(passAnchor(epicOf(engine)), passedAt);
});

unitTest("1.2 an epic recorded before this release reads zero with no anchor", () => {
  const rec = emptyRecord();
  rec.epics.push({ id: "old", title: "old", priority: "P2", status: "queued", role: "epic", lane: "openspec", links: [],
    gateReview: { gate1: { verdict: "fail", reviewedAt: "2026-09-01T00:00:00.000Z", superseded: { verdict: "fail", reviewedAt: "2026-08-01T00:00:00.000Z" } } } });
  const engine = memoryEngine(rec);
  const old = engine.store.record().epics[0];
  assert.deepEqual(recordedStreak(old), { count: 0, gate: null });
  assert.equal(passAnchor(old), null);
  assert.equal(old.gateRounds, undefined, "nothing backfills it");
});
