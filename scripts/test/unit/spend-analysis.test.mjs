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

// ───────────────────────────── 2.x flags, recommendations, trend ─────────────────────────────

import {
  DOMINANT_AGENT_MIN_AGENTS, DOMINANT_AGENT_SHARE, LONG_CONTEXT_MIN_MESSAGES, LONG_CONTEXT_MIN_PER_MESSAGE,
  LOW_COVERAGE_SHARE, REVIEW_LOOP_MIN_ROUNDS, RULES, TREND_BAND, TREND_MIN_EPICS, TREND_MIN_RELEASES,
} from "../../lib/spend-analysis.mjs";

/** `count` messages of one sub-agent, each with the given per-message context (all in cache-read). */
const agentRows = (agentId, count, ctx, over = {}) => Array.from({ length: count }, () => sub(agentId, { cacheRead: ctx, output: 1, ...over }));
const flagsOf = (out, rule) => out.flags.filter((f) => f.rule === rule);

unitTest("2.1 the thresholds are named constants carrying the spec's proposed defaults", () => {
  assert.deepEqual([LONG_CONTEXT_MIN_MESSAGES, LONG_CONTEXT_MIN_PER_MESSAGE], [100, 200_000]);
  assert.deepEqual([DOMINANT_AGENT_SHARE, DOMINANT_AGENT_MIN_AGENTS], [0.5, 2]);
  assert.equal(REVIEW_LOOP_MIN_ROUNDS, 3);
  assert.equal(LOW_COVERAGE_SHARE, 0.9);
  assert.deepEqual([TREND_MIN_RELEASES, TREND_MIN_EPICS, TREND_BAND], [2, 3, 0.2]);
  assert.deepEqual(RULES.map((r) => r.id), ["long-context-agent", "dominant-agent", "tier-mismatch", "review-loop", "low-coverage", "invalid-markers"]);
  assert.ok(RULES.every((r) => r.status === "proposal"), "every threshold is labelled a proposal, not a measurement");
});

unitTest("2.1 a long-lived large-context agent is flagged with its messages, context and both thresholds", () => {
  const out = run(agentRows("BIG", 156, 379_000));
  const [f] = flagsOf(out, "long-context-agent");
  assert.equal(f.subject, "agent BIG");
  assert.equal(f.values.messages, 156);
  assert.equal(f.values.contextPerMessage, 379_000 + 0);
  assert.deepEqual(f.threshold, { minMessages: 100, minContextPerMessage: 200_000 });
  assert.match(f.recommendation, /split the batch or hand off to a fresh context/);
  assert.match(f.recommendation, /379,000/);
  assert.equal(flagsOf(run(agentRows("A", 99, 379_000)), "long-context-agent").length, 0, "99 messages is under the message threshold");
  assert.equal(flagsOf(run(agentRows("A", 156, 199_999)), "long-context-agent").length, 0, "199,999 per message is under the context threshold");
});

unitTest("2.1 one agent holding half of an epic's work is dominant, but only on an epic with at least two agents", () => {
  const rows = [...agentRows("A", 1, 0, { output: 600 }), ...agentRows("B", 1, 0, { output: 400 })];
  const [f] = flagsOf(run(rows), "dominant-agent");
  assert.equal(f.subject, "agent A");
  assert.deepEqual([f.values.epic, f.values.share], ["e1", 0.6]);
  assert.equal(flagsOf(run(agentRows("A", 1, 0, { output: 600 })), "dominant-agent").length, 0, "a sole agent is not dominant");
  assert.equal(flagsOf(run([...agentRows("A", 1, 0, { output: 499 }), ...agentRows("B", 1, 0, { output: 501 }), row({ output: 10_000 })]), "dominant-agent").length, 0, "share is of the epic's whole work, orchestrator included");
});

unitTest("2.1 a mechanical role on an opus-tier model, and a plan role on a haiku-tier model, are tier mismatches", () => {
  const m = flagsOf(run([sub("M", { role: "mechanical", tier: "opus", output: 5 })]), "tier-mismatch");
  assert.deepEqual([m[0].subject, m[0].values.role, m[0].values.tier], ["agent M", "mechanical", "opus"]);
  assert.equal(flagsOf(run([sub("T", { role: "test", tier: "fable", output: 5 })]), "tier-mismatch").length, 1);
  assert.equal(flagsOf(run([sub("R", { role: "rudimentary", tier: "opus", output: 5 })]), "tier-mismatch").length, 1);
  assert.equal(flagsOf(run([sub("P", { role: "plan", tier: "haiku", output: 5 })]), "tier-mismatch").length, 1);
  assert.equal(flagsOf(run([sub("V", { role: "review", tier: "haiku", output: 5 })]), "tier-mismatch").length, 1);
  assert.equal(flagsOf(run([sub("S", { role: "mechanical", tier: "sonnet", output: 5 }), sub("I", { role: "implement", tier: "opus", output: 5 })]), "tier-mismatch").length, 0);
});

unitTest("2.1 an epic whose review rows carry rounds 1, 2 and 3 is a review loop, and says it is not the guard's signal", () => {
  const rows = [1, 2, 3].map((n) => sub(`R${n}`, { role: "review", phase: "review", round: n, output: 1 }));
  const [f] = flagsOf(run(rows), "review-loop");
  assert.equal(f.subject, "epic e1");
  assert.equal(f.values.distinctRounds, 3);
  assert.match(f.note, /not the spend guard's rounds signal, which counts from the pass anchor/);
  assert.equal(flagsOf(run(rows.slice(0, 2)), "review-loop").length, 0);
  assert.equal(flagsOf(run([...rows.slice(0, 2), sub("X", { role: "implement", phase: "build", round: 3, output: 1 })]), "review-loop").length, 0, "only phase=review rows count");
});

unitTest("2.1 coverage under 90% is flagged; exactly 90% is not", () => {
  const rows = (att, unatt) => [row({ cacheRead: att }), row({ epic: null, reason: "no-active-epic", cacheRead: unatt })];
  const [f] = flagsOf(run(rows(89, 11)), "low-coverage");
  assert.equal(f.values.share, 0.89);
  assert.equal(f.threshold, 0.9);
  assert.equal(flagsOf(run(rows(90, 10)), "low-coverage").length, 0);
});

unitTest("2.1 invalid-marker tokens are flagged and point to the list spend prints", () => {
  const bad = row({ epic: null, reason: "invalid-marker", actor: "subagent", agentId: "X", cacheRead: 24_500_000, invalid: { field: "phase", value: "spec", accepted: ["plan", "build"] } });
  const [f] = flagsOf(run([row({ cacheRead: 75_500_000 }), bad]), "invalid-markers");
  assert.equal(f.values.tokens, 24_500_000);
  assert.deepEqual(f.values.markers.map((m) => [m.field, m.value]), [["phase", "spec"]]);
  assert.match(f.recommendation, /invalid pm-spend marker/);
  assert.equal(flagsOf(run([row({ cacheRead: 5 })]), "invalid-markers").length, 0);
});

unitTest("2.1 a clean scope flags nothing, says so, and prints each rule's threshold", () => {
  const out = run([row({ input: 100, output: 10 })]);
  assert.deepEqual(out.flags, []);
  const text = renderAnalysis(out).join("\n");
  assert.match(text, /no outliers were found/);
  for (const r of RULES) assert.match(text, new RegExp(r.id));
  assert.match(text, /Thresholds are proposals/);
});

unitTest("2.2 every flag carries exactly one recommendation; a tier mismatch names set-profile --model", () => {
  const out = run([
    ...agentRows("BIG", 156, 379_000), sub("M", { role: "mechanical", tier: "opus", output: 5 }),
    ...[1, 2, 3].map((n) => sub(`R${n}`, { role: "review", phase: "review", round: n })),
    row({ epic: null, reason: "invalid-marker", actor: "subagent", agentId: "X", cacheRead: 9e9, invalid: { field: "phase", value: "spec", accepted: ["plan"] } }),
  ]);
  const rules = new Set(out.flags.map((f) => f.rule));
  for (const r of ["long-context-agent", "tier-mismatch", "review-loop", "invalid-markers", "low-coverage"]) assert.ok(rules.has(r), r);
  for (const f of out.flags) {
    assert.equal(typeof f.recommendation, "string");
    assert.ok(f.recommendation.length > 0);
    assert.deepEqual(Object.keys(f).filter((k) => ["rule", "subject", "values", "threshold", "recommendation"].includes(k)).sort(), ["recommendation", "rule", "subject", "threshold", "values"]);
  }
  assert.match(flagsOf(out, "tier-mismatch")[0].recommendation, /set-profile --model mechanical=<model>/);
  assert.match(flagsOf(out, "review-loop")[0].recommendation, /spend-guard e1/);
  assert.match(flagsOf(out, "low-coverage")[0].recommendation, /pm-spend/);
});

unitTest("2.2 the same ledger and state give identical output, text and JSON", () => {
  const rows = [...agentRows("BIG", 156, 379_000), sub("M", { role: "mechanical", tier: "opus", output: 5 })];
  assert.deepEqual(renderAnalysis(run(rows)), renderAnalysis(run(rows.map((r) => ({ ...r })))));
  assert.equal(JSON.stringify(run(rows)), JSON.stringify(run([...rows])));
});

// 2.3 the trend. Each epic's rows carry `output` only, so its work is the number.
const epicRows = (id, work) => [row({ epic: id, output: work })];
const trendState = (spec) => {
  const epics = [], releases = [];
  for (const [rid, ids] of Object.entries(spec)) { releases.push({ id: rid }); for (const id of ids) epics.push({ id, release: rid }); }
  return { ...emptyRecord(), epics, releases };
};

unitTest("2.3 one release is not a trend: insufficient data with the release and epic counts", () => {
  const st = trendState({ r1: ["a", "b", "c", "d"] });
  const out = run(["a", "b", "c", "d"].flatMap((id) => epicRows(id, 1000)), {}, st);
  assert.equal(out.trend.verdict, "insufficient data");
  assert.match(renderAnalysis(out).join("\n"), /insufficient data — 1 releases, 4 epics/);
  assert.deepEqual(out.trend.releases, [{ release: "r1", epics: 4, meanWork: 1000 }]);
});

unitTest("2.3 a mean 30% above the previous release is growing; 10% above is flat; 30% below is falling", () => {
  const st = trendState({ r1: ["a", "b", "c"], r2: ["d", "e", "f"] });
  const at = (r2work) => run([...["a", "b", "c"].flatMap((id) => epicRows(id, 1_000_000)), ...["d", "e", "f"].flatMap((id) => epicRows(id, r2work))], {}, st).trend;
  assert.equal(at(1_300_000).verdict, "growing");
  assert.equal(at(1_100_000).verdict, "flat");
  assert.equal(at(700_000).verdict, "falling");
  assert.equal(at(1_200_000).verdict, "growing", "exactly 20% above is at the band");
  assert.equal(at(800_000).verdict, "falling", "exactly 20% below is at the band");
  assert.equal(at(1_300_000).latest, "r2");
  assert.equal(at(1_300_000).previous, "r1");
});

unitTest("2.3 a release with fewer than 3 attributed epics does not meet the floor", () => {
  const st = trendState({ r1: ["a", "b", "c"], r2: ["d", "e"] });
  const t = run(["a", "b", "c", "d", "e"].flatMap((id) => epicRows(id, 10)), {}, st).trend;
  assert.equal(t.verdict, "insufficient data");
  assert.match(t.reason, /insufficient data — 2 releases, 5 epics/);
});

unitTest("2.3 releases are ordered by registration, newest first, and the verdict compares the latest two that meet the floor", () => {
  const st = trendState({ r1: ["a", "b", "c"], r2: ["d", "e", "f"], r3: ["g"] });
  const rows = [["a", "b", "c", 100], ["d", "e", "f", 200], ["g", 5]].flatMap(([...xs]) => xs.slice(0, -1).flatMap((id) => epicRows(id, xs.at(-1))));
  const t = run(rows, {}, st).trend;
  assert.deepEqual(t.releases.map((r) => r.release), ["r3", "r2", "r1"]);
  assert.deepEqual([t.latest, t.previous, t.verdict], ["r2", "r1", "growing"]);
});

unitTest("2.3 an epic with no release, or with no attributed rows, is not counted in any release", () => {
  const st = { ...trendState({ r1: ["a", "b", "c"] }), epics: [{ id: "a", release: "r1" }, { id: "b", release: "r1" }, { id: "c", release: "r1" }, { id: "z" }] };
  const t = run(["a", "z"].flatMap((id) => epicRows(id, 10)), {}, st).trend;
  assert.deepEqual(t.releases, [{ release: "r1", epics: 1, meanWork: 10 }]);
});

unitTest("2.4 the JSON form carries every key, cost.computed false, and flags in the documented shape", () => {
  const e = memoryEngine({ ...state(), spendTracking: tracking });
  const off = JSON.parse(memoryEngine(state())(["spend-analysis", "--json"]));
  for (const k of ["tracking", "scope", "breakdown", "agents", "unattributed", "coverage", "tools", "flags", "trend", "cost"]) assert.ok(k in off, k);
  assert.equal(off.cost.computed, false);
  assert.ok(e);
  const out = run(agentRows("BIG", 156, 379_000));
  assert.ok(Array.isArray(out.flags) && out.flags.length > 0);
  for (const f of out.flags) for (const k of ["rule", "subject", "values", "threshold", "recommendation"]) assert.ok(k in f, k);
  assert.equal(out.decisions, undefined, "decisions is reserved for decision-cost-log under --epic");
});
