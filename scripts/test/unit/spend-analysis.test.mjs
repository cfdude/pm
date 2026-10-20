// scripts/test/unit/spend-analysis.test.mjs
// token-spend-analysis-and-recommendations 1.x -- the pure analysis over in-memory attributed rows, and the
// verb's refusals and off messages over an in-memory record. No file is opened.

import assert from "node:assert/strict";
import { emptyRecord, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";
import { analyze, renderAnalysis } from "../../lib/spend-analysis.mjs";

let seq = 0;
const row = (over = {}) => ({
  messageId: `m${++seq}`, sessionId: "s", agentId: null, actor: "orchestrator", at: "2026-10-10T00:00:00.000Z",
  model: "claude-opus-4-7", tier: "opus", input: 0, cacheCreation: 0, cacheRead: 0, output: 0, thinking: 0, tools: [],
  epic: "e1", role: null, phase: null, round: null, attribution: "window", reason: null, ...over,
});
const sub = (agentId, over = {}) => row({ actor: "subagent", agentId, role: "implement", phase: "build", round: 1, attribution: "marker", ...over });
const state = (over = {}) => ({ ...emptyRecord(), epics: [{ id: "e1", release: "r1" }, { id: "e2", release: "r1" }], releases: [{ id: "r1" }], ...over });
const tracking = { enabled: true, enabledAt: "2026-10-09T00:00:00.000Z" };
const run = (attributed, scope = {}, st = state()) => analyze({ attributed, state: st, tracking, ingest: { ran: false, reason: "--no-ingest" }, scope });

unitTest("1.2 sub-agents are ranked by work, not total, and both numbers are printed", () => {
  const a = sub("A", { input: 1000, cacheRead: 60_000_000, output: 0 });
  const b = sub("B", { input: 100_000, cacheRead: 8_000_000, output: 800_000 });
  const out = run([a, b]);
  assert.deepEqual(out.agents.map((x) => x.agentId), ["B", "A"]);
  assert.equal(out.agents[1].total, 60_001_000);
  assert.equal(out.agents[0].work, 900_000);
  const text = renderAnalysis(out).join("\n");
  assert.ok(text.indexOf("agent B") < text.indexOf("agent A"));
  assert.match(text, /total 60,001,000/);
});

unitTest("1.2 the four token classes, work and total are kept apart, split by actor, tier, role and phase", () => {
  const rows = [
    row({ input: 1, cacheCreation: 2, cacheRead: 300, output: 4 }),
    sub("A", { input: 10, cacheCreation: 20, cacheRead: 3000, output: 40, tier: "sonnet" }),
  ];
  const { breakdown } = run(rows);
  assert.deepEqual(breakdown.byActor.orchestrator, { input: 1, cacheCreation: 2, cacheRead: 300, output: 4, total: 307, work: 7, messages: 1 });
  assert.equal(breakdown.byActor.subagent.cacheRead, 3000, "cache-read held by sub-agents is visible apart from the orchestrator's");
  assert.deepEqual(Object.keys(breakdown.byTier).sort(), ["opus", "sonnet"]);
  assert.equal(breakdown.byRole.implement.work, 70);
  assert.equal(breakdown.byPhase.build.total, 3070);
  assert.equal(breakdown.totals.total, 3377);
});

unitTest("1.2 unattributed spend is a section of its own, with the coverage share and every reason", () => {
  const rows = [row({ cacheRead: 680 }), row({ epic: null, reason: "no-active-epic", cacheRead: 200 }), row({ epic: null, reason: "invalid-marker", cacheRead: 120, invalid: { field: "phase", value: "spec", accepted: ["plan"] }, agentId: "X", actor: "subagent" })];
  const out = run(rows);
  assert.equal(out.coverage.share, 0.68);
  assert.equal(out.unattributed.byReason["no-active-epic"].total, 200);
  const text = renderAnalysis(out).join("\n");
  assert.match(text, /unattributed: 320 tokens/);
  assert.match(text, /no-active-epic 200/);
  assert.match(text, /invalid-marker 120/);
  assert.match(text, /coverage: 68\.0%/);
});

unitTest("1.2 no money cost is computed, in text or in the object", () => {
  const out = run([row({ input: 5 })]);
  assert.equal(out.cost.computed, false);
  assert.match(renderAnalysis(out).join("\n"), /cost: not computed/);
});

unitTest("1.1 --epic narrows the breakdown to that epic; --release to the epics of that release; coverage stays ledger-wide", () => {
  const st = state({ epics: [{ id: "e1", release: "r1" }, { id: "e2", release: "r2" }, { id: "e3" }], releases: [{ id: "r1" }, { id: "r2" }] });
  const rows = [row({ epic: "e1", input: 1 }), row({ epic: "e2", input: 10 }), row({ epic: "e3", input: 100 }), row({ epic: null, reason: "no-active-epic", input: 1000 })];
  assert.equal(run(rows, { epic: "e2" }, st).breakdown.totals.total, 10);
  assert.equal(run(rows, { release: "r1" }, st).breakdown.totals.total, 1);
  assert.equal(run(rows, {}, st).breakdown.totals.total, 111);
  assert.equal(run(rows, { epic: "e2" }, st).coverage.total, 1111, "unattributed rows have no epic, so coverage is about the whole ledger");
  assert.deepEqual(run(rows, { epic: "e2" }, st).scope, { kind: "epic", epic: "e2", release: null });
});

unitTest("1.3 tool calls are counted per tool name from the rows, per actor, and never as tokens", () => {
  const rows = [row({ tools: ["Read", "Bash"], input: 999 }), sub("A", { tools: ["Read"] }), row({ tools: [] })];
  const { tools } = run(rows);
  assert.deepEqual(tools.byTool, [{ tool: "Read", count: 2 }, { tool: "Bash", count: 1 }]);
  assert.deepEqual(tools.byActor.orchestrator, [{ tool: "Bash", count: 1 }, { tool: "Read", count: 1 }]);
  assert.deepEqual(tools.byActor.subagent, [{ tool: "Read", count: 1 }]);
  const text = renderAnalysis(run(rows)).join("\n");
  assert.match(text, /Read 2/);
  assert.match(text, /Bash 1/);
  assert.match(text, /tokens are not apportioned to tools/);
  assert.doesNotMatch(JSON.stringify(tools), /token(s)?"\s*:/, "no token figure per tool");
});

unitTest("1.1 the verb refuses --epic with --release, an unknown --epic and an unknown --release, naming the problem", () => {
  const e = memoryEngine({ ...state(), spendTracking: tracking });
  for (const [args, re] of [
    [["spend-analysis", "--epic", "e1", "--release", "r1"], /--epic and --release/],
    [["spend-analysis", "--epic", "nope"], /no epic with that id/],
    [["spend-analysis", "--release", "nope"], /no release/],
  ]) {
    const r = e.result(args);
    assert.notEqual(r.status, 0, args.join(" "));
    assert.match(r.stderr, re);
  }
});

unitTest("1.1 tracking off: the verb says so, names set-spend-tracking on, in text and --json", () => {
  const e = memoryEngine(state());
  assert.match(e(["spend-analysis"]), /spend tracking is off[\s\S]*set-spend-tracking on/);
  const j = JSON.parse(e(["spend-analysis", "--json"]));
  assert.match(j.off, /set-spend-tracking on/);
  assert.equal(j.tracking.enabled, false);
  assert.equal(j.cost.computed, false);
});

unitTest("1.1 an unparseable flag value is refused", () => {
  const e = memoryEngine({ ...state(), spendTracking: tracking });
  assert.notEqual(e.result(["spend-analysis", "--epic"]).status, 0);
});
