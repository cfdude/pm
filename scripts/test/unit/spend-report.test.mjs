// scripts/test/unit/spend-report.test.mjs
// token-spend-tracking-per-epic, group 4 (4.1) — report aggregation over folded, attributed rows.
// UNIT rung: rows in, a report value out.

import assert from "node:assert/strict";
import { unitTest } from "../fixtures/unit-harness.mjs";
import { UNATTRIBUTED_REASONS, attribute } from "../../lib/spend-attribution.mjs";
import { COST_NOTE, buildReport, renderReport } from "../../lib/spend-report.mjs";

const T = (sec) => new Date(Date.UTC(2026, 9, 9, 10, 0, sec)).toISOString();
const row = (over) => ({
  messageId: "m", actor: "orchestrator", agentId: null, at: T(0), tier: "opus",
  input: 1, cacheCreation: 10, cacheRead: 100, output: 1000, ...over,
});
const TOTAL = 1111;
const STATE = { epics: [{ id: "e1" }, { id: "e2" }] };
const TL = [{ at: T(0), tracking: "on", active: "e1" }, { at: T(50), active: "e2" }];
const MARKERS = {
  A: { epic: "e1", role: "review", phase: "review", round: "2" },
  B: { epic: "e1", role: "implement", phase: "build", round: null },
};
const attributed = (rows) => attribute(rows, MARKERS, TL, STATE);
const report = (rows, filters = {}) => buildReport({ attributed: attributed(rows), tracking: { enabled: true, enabledAt: T(0) }, ingest: { ran: true }, filters });

unitTest("4.1 The JSON shape serves the dependent epics: every key the spec names", () => {
  const r = report([
    row({ messageId: "o1", at: T(10) }),
    row({ messageId: "a1", actor: "subagent", agentId: "A", at: T(11), tier: "sonnet" }),
    row({ messageId: "x1", actor: "subagent", agentId: "ZZ", at: T(12) }),
  ]);
  assert.deepEqual(Object.keys(r).sort(), ["cost", "coverage", "epics", "ingest", "tracking", "unattributed"]);
  const e1 = r.epics.e1;
  assert.deepEqual(Object.keys(e1).sort(),
    ["agents", "byActor", "byPhase", "byRole", "byRound", "byTier", "firstAt", "lastAt", "totals"]);
  for (const t of [e1.totals, e1.byActor.orchestrator, e1.byRole.review, e1.byPhase.review, e1.byRound["2"], e1.byTier.opus, e1.agents.A.totals, r.unattributed.totals]) {
    for (const k of ["input", "cacheCreation", "cacheRead", "output", "total"]) assert.equal(typeof t[k], "number", k);
  }
  assert.deepEqual({ ...e1.totals }, { input: 2, cacheCreation: 20, cacheRead: 200, output: 2000, total: 2 * TOTAL, messages: 2 });
  assert.deepEqual(e1.agents.A, { role: "review", phase: "review", round: 2, tier: "sonnet", totals: e1.agents.A.totals });
  assert.deepEqual(Object.keys(r.unattributed).sort(), ["byReason", "totals"]);
  assert.equal(r.cost.computed, false);
  assert.equal(r.cost.note, COST_NOTE);
});

unitTest("4.1 input, cacheCreation, cacheRead and output are kept separate per agent", () => {
  const r = report([row({ messageId: "a1", actor: "subagent", agentId: "A", at: T(11), input: 3, cacheCreation: 5, cacheRead: 7, output: 11 })]);
  assert.deepEqual(r.epics.e1.agents.A.totals, { input: 3, cacheCreation: 5, cacheRead: 7, output: 11, total: 26, messages: 1 });
});

unitTest("4.1 byRound separates gate rounds: review round 1 and round 2 are different keys", () => {
  const a2 = row({ messageId: "r2", actor: "subagent", agentId: "A", at: T(11) });
  const b = row({ messageId: "r1", actor: "subagent", agentId: "B", at: T(12) });
  const r = report([a2, b]);
  assert.deepEqual(Object.keys(r.epics.e1.byRound).sort(), ["1", "2"]);
  assert.equal(r.epics.e1.byRound["2"].total, TOTAL);
});

unitTest("4.1 orchestrator rows land under `none` for role, phase and round", () => {
  const r = report([row({ messageId: "o1", at: T(10) })]);
  assert.deepEqual(Object.keys(r.epics.e1.byRole), ["none"]);
  assert.deepEqual(Object.keys(r.epics.e1.byPhase), ["none"]);
  assert.deepEqual(Object.keys(r.epics.e1.byRound), ["none"]);
});

unitTest("4.1 The unattributed total is printed even at 0, by every reason", () => {
  const r = report([row({ messageId: "o1", at: T(10) })]);
  assert.equal(r.unattributed.totals.total, 0);
  assert.deepEqual(Object.keys(r.unattributed.byReason), [...UNATTRIBUTED_REASONS]);
  const text = renderReport(r).join("\n");
  assert.match(text, /unattributed: 0 tokens in 0 messages/);
  assert.match(text, /tracking-off 0 · unmarked-subagent 0/);
});

unitTest("4.1 unattributed spend is totalled by reason and the coverage share is the attributed fraction", () => {
  const r = report([
    row({ messageId: "o1", at: T(10) }),                                          // e1 by window
    row({ messageId: "x1", actor: "subagent", agentId: "ZZ", at: T(12) }),        // unmarked
    row({ messageId: "o0", at: T(-5) }),                                          // before the timeline
  ]);
  assert.equal(r.unattributed.byReason["unmarked-subagent"].total, TOTAL);
  assert.equal(r.unattributed.byReason["before-timeline"].total, TOTAL);
  assert.equal(r.unattributed.totals.total, 2 * TOTAL);
  assert.deepEqual([r.coverage.attributed, r.coverage.total], [TOTAL, 3 * TOTAL]);
  assert.ok(Math.abs(r.coverage.share - 1 / 3) < 1e-9);
  assert.match(renderReport(r).join("\n"), /coverage: 33\.3% of 3,333 tokens attributed/);
});

unitTest("4.1 an empty window has a null coverage share and says n/a", () => {
  const r = report([]);
  assert.equal(r.coverage.share, null);
  assert.match(renderReport(r).join("\n"), /coverage: n\/a/);
});

unitTest("4.1 Filtering by epic and window: only rows attributed to e1 with T1 <= at < T2 are summed", () => {
  const rows = [
    row({ messageId: "a", at: T(9) }), row({ messageId: "b", at: T(10) }), row({ messageId: "c", at: T(20) }),
    row({ messageId: "d", at: T(30) }), row({ messageId: "e", at: T(60) }),   // e is e2's by window
  ];
  const r = report(rows, { epic: "e1", since: T(10), until: T(30) });
  assert.deepEqual(Object.keys(r.epics), ["e1"]);
  assert.equal(r.epics.e1.totals.messages, 2, "T1 is included, T2 is excluded");
  assert.equal(r.epics.e1.firstAt, T(10));
  assert.equal(r.epics.e1.lastAt, T(20));
  assert.equal(report(rows, { epic: "e2" }).epics.e2.totals.messages, 1);
});

unitTest("4.1 --epic narrows the per-epic section but not the unattributed bucket", () => {
  const rows = [row({ messageId: "o1", at: T(10) }), row({ messageId: "x1", actor: "subagent", agentId: "ZZ", at: T(12) })];
  const r = report(rows, { epic: "e2" });
  assert.deepEqual(Object.keys(r.epics), []);
  assert.equal(r.unattributed.totals.total, TOTAL);
});

unitTest("4.1 The cost line states that no cost is computed, tokens are the measure, and figures are notional", () => {
  const text = renderReport(report([row({ at: T(10) })])).join("\n");
  assert.match(text, /cost: not computed — tokens are the measure\. Claude Code's own cost figures are notional under subscription auth\./);
});

unitTest("4.1 a sub-agent's tier is the tier that carried most of its tokens", () => {
  const r = report([
    row({ messageId: "a1", actor: "subagent", agentId: "A", at: T(11), tier: "sonnet", output: 5000 }),
    row({ messageId: "a2", actor: "subagent", agentId: "A", at: T(12), tier: "opus", output: 10 }),
  ]);
  assert.equal(r.epics.e1.agents.A.tier, "sonnet");
});

unitTest("4.1 the report is built from the rows it is given and never mutates them", () => {
  const rows = attributed([row({ messageId: "o1", at: T(10) })]);
  const frozen = JSON.stringify(rows);
  buildReport({ attributed: rows, tracking: {}, ingest: null });
  assert.equal(JSON.stringify(rows), frozen);
});
