// scripts/lib/spend-analysis.mjs
// token-spend-analysis-and-recommendations -- the `spend-analysis` verb: the spend ledger as a postmortem.
//
//   spend-analysis [--epic <id> | --release <id>] [--json] [--no-ingest]
//
// READ-ONLY. It runs the SAME ingest -> attribute -> report pipeline `spend` runs (through `ingestForReport`, so
// developer-log capture stays consistent for every caller) and analyses what that yields. It writes nothing to
// state.json, opens no network connection and calls no model: every recommendation is fixed text for a rule.
//
// RANKED BY `work`, NEVER BY `total` (design D1). Cache-read is the bulk of any total and is context size times turn
// count; `total` is printed beside `work` so a reader sees both, but the order is the work.
//
// TOOLS ARE COUNTS, NOT TOKENS (design D6). A ledger row stores the NAMES of the tools a message called (a set: a
// message calling Read twice stores "Read" once), so the count below is the number of messages that called each
// tool. A message's usage is one number for all its content, so no token figure is given per tool.
//
// COVERAGE AND THE UNATTRIBUTED SECTION ARE LEDGER-WIDE. A row with no epic has no scope to belong to, so under
// --epic and --release they still describe the whole ledger, as `spend`'s own coverage line does.
//
// TRACKING OFF: the verb says so and opens no path under the spend or transcript directory.

import os from "node:os";
import { isInitialized } from "./state.mjs";
import { parseFlags, requireFlagValues } from "./add-epic.mjs";
import { die } from "./command-exit.mjs";
import { escapeControls, jsonText, orNoRemedy, printedId } from "./constants.mjs";
import { currentArgv, currentEnv, outStream } from "./invocation.mjs";
import { resolveMainTree } from "./spend-tree.mjs";
import { spendEnabled } from "./spend-switch.mjs";
import { readLedger } from "./spend-ledger.mjs";
import { attribute } from "./spend-attribution.mjs";
import { COST_NOTE, NONE_KEY, buildReport, emptyTotals } from "./spend-report.mjs";
import { ingestForReport, readMainState } from "./spend-command.mjs";

const refuse = (msg) => die(`conductor: ${msg}\n`);

export const OFF_MESSAGE = "spend tracking is off, so there is nothing to analyse: run `set-spend-tracking on` to start measuring. No ledger or transcript was read.";
export const TOOLS_NOTE = "counts are messages that called each tool (a ledger row stores a message's tool names once); tokens are not apportioned to tools, because a message's usage is one number for everything in it";

const n = (v) => v.toLocaleString("en-US");
// A three-way comparison and not a subtraction: conductor-13 forbids a second place that subtracts `.total`.
const desc = (a, b) => (a < b ? 1 : a > b ? -1 : 0);

/** The epic ids a scope covers. `null` means the whole ledger (every row, including the unattributed). */
function scopeEpicIds(state, scope) {
  if (scope.epic) return new Set([scope.epic]);
  if (scope.release) return new Set((state.epics || []).filter((e) => e && e.release === scope.release).map((e) => e.id));
  return null;
}

const sortedCounts = (map) => [...map.entries()]
  .sort((a, b) => desc(a[1], b[1]) || (a[0] < b[0] ? -1 : 1)).map(([tool, count]) => ({ tool, count }));

function countTools(rows) {
  const all = new Map(), by = { orchestrator: new Map(), subagent: new Map() };
  for (const r of rows) {
    for (const t of new Set(r.tools || [])) {
      all.set(t, (all.get(t) || 0) + 1);
      const m = by[r.actor === "subagent" ? "subagent" : "orchestrator"];
      m.set(t, (m.get(t) || 0) + 1);
    }
  }
  return { note: TOOLS_NOTE, byTool: sortedCounts(all), byActor: { orchestrator: sortedCounts(by.orchestrator), subagent: sortedCounts(by.subagent) } };
}

const sumInto = (target, t) => {
  target.input += t.input; target.cacheCreation += t.cacheCreation; target.cacheRead += t.cacheRead; target.output += t.output;
  target.total += t.total; target.work += t.work; target.messages += t.messages;
};

// ───────────────────────────── the rules ─────────────────────────────
//
// EVERY THRESHOLD BELOW IS A PROPOSAL, NOT A MEASUREMENT (design D3, D5). The ledger holds 4 epics in one release
// (assessment section 6), so these are starting values to be tuned on 0.53's own build; each flag prints its evidence
// and its threshold so a reader can disagree. Rob's call: the values.

/** long-context-agent: a sub-agent with at least this many messages... */
export const LONG_CONTEXT_MIN_MESSAGES = 100;
/** ...AND at least this mean per-message context (`input + cacheCreation + cacheRead`). */
export const LONG_CONTEXT_MIN_PER_MESSAGE = 200_000;
/** dominant-agent: one agent holds at least this share of an epic's work... */
export const DOMINANT_AGENT_SHARE = 0.5;
/** ...on an epic with at least this many sub-agents. */
export const DOMINANT_AGENT_MIN_AGENTS = 2;
/** review-loop: an epic's phase=review rows carry at least this many distinct round values. */
export const REVIEW_LOOP_MIN_ROUNDS = 3;
/** low-coverage: the ledger's coverage share below this. */
export const LOW_COVERAGE_SHARE = 0.9;
/** tier-mismatch: light roles on a top tier, heavy roles on a low tier. */
export const TIER_MISMATCH = Object.freeze({
  lightRoles: Object.freeze(["mechanical", "rudimentary", "test"]), topTiers: Object.freeze(["opus", "fable"]),
  heavyRoles: Object.freeze(["plan", "review"]), lowTiers: Object.freeze(["haiku"]),
});
/** The trend floor and band (design D5): a verdict needs this many releases, each with this many attributed epics. */
export const TREND_MIN_RELEASES = 2;
export const TREND_MIN_EPICS = 3;
/** growing at this fraction above the previous release's mean work per epic, falling at this fraction below. */
export const TREND_BAND = 0.2;

const INVALID_VALUE_MAX = 64;
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const ctxText = (v) => n(Math.round(v));

/** The closed rule list, in the order flags print. Each rule: its id, its threshold (as printed and as carried by
 *  every flag it raises), the pure `find` that raises flags from the analysis inputs, and `evidence` / `recommend`,
 *  which render FIXED text from a flag's own values. No model call: a recommendation is a template. */
export const RULES = [
  {
    id: "long-context-agent", status: "proposal",
    threshold: { minMessages: LONG_CONTEXT_MIN_MESSAGES, minContextPerMessage: LONG_CONTEXT_MIN_PER_MESSAGE },
    describe: () => `an agent with >= ${n(LONG_CONTEXT_MIN_MESSAGES)} messages and >= ${n(LONG_CONTEXT_MIN_PER_MESSAGE)} mean context per message`,
    find: ({ agents }) => agents
      .filter((g) => g.messages >= LONG_CONTEXT_MIN_MESSAGES && g.contextPerMessage >= LONG_CONTEXT_MIN_PER_MESSAGE)
      .map((g) => ({ subject: `agent ${g.agentId}`, values: { agentId: g.agentId, epic: g.epic, messages: g.messages, contextPerMessage: g.contextPerMessage, work: g.work, total: g.total } })),
    evidence: (f) => `${f.values.messages} messages (threshold ${n(LONG_CONTEXT_MIN_MESSAGES)}), mean context ${ctxText(f.values.contextPerMessage)} per message (threshold ${n(LONG_CONTEXT_MIN_PER_MESSAGE)}); work ${n(f.values.work)}, total ${n(f.values.total)}`,
    recommend: (f) => `${f.subject} carried about ${ctxText(f.values.contextPerMessage)} tokens of context on each of ${f.values.messages} messages: split the batch or hand off to a fresh context before the context passes ${n(LONG_CONTEXT_MIN_PER_MESSAGE)} per message.`,
  },
  {
    id: "dominant-agent", status: "proposal",
    threshold: { share: DOMINANT_AGENT_SHARE, minAgents: DOMINANT_AGENT_MIN_AGENTS },
    describe: () => `one agent holding >= ${pct(DOMINANT_AGENT_SHARE)} of an epic's work, on an epic with >= ${DOMINANT_AGENT_MIN_AGENTS} agents`,
    find: ({ agents, epicWork }) => {
      const perEpic = new Map();
      for (const g of agents) perEpic.set(g.epic, (perEpic.get(g.epic) || 0) + 1);
      return agents
        .filter((g) => perEpic.get(g.epic) >= DOMINANT_AGENT_MIN_AGENTS && epicWork[g.epic] > 0 && g.work / epicWork[g.epic] >= DOMINANT_AGENT_SHARE)
        .map((g) => ({ subject: `agent ${g.agentId}`, values: { agentId: g.agentId, epic: g.epic, share: g.work / epicWork[g.epic], work: g.work, epicWork: epicWork[g.epic], agentsOnEpic: perEpic.get(g.epic) } }));
    },
    evidence: (f) => `${pct(f.values.share)} of epic ${f.values.epic}'s work (${n(f.values.work)} of ${n(f.values.epicWork)}) across ${f.values.agentsOnEpic} agents (threshold ${pct(DOMINANT_AGENT_SHARE)} on at least ${DOMINANT_AGENT_MIN_AGENTS})`,
    recommend: (f) => `${f.subject} did ${pct(f.values.share)} of epic ${f.values.epic}'s work: the plan left one executor too much to decide, so sharpen the plan or split the epic into stories dispatched separately.`,
  },
  {
    id: "tier-mismatch", status: "proposal",
    threshold: { lightRoles: TIER_MISMATCH.lightRoles, topTiers: TIER_MISMATCH.topTiers, heavyRoles: TIER_MISMATCH.heavyRoles, lowTiers: TIER_MISMATCH.lowTiers },
    describe: () => `role ${TIER_MISMATCH.lightRoles.join("/")} on a ${TIER_MISMATCH.topTiers.join("/")} model, or role ${TIER_MISMATCH.heavyRoles.join("/")} on a ${TIER_MISMATCH.lowTiers.join("/")} model`,
    find: ({ agents }) => agents
      .filter((g) => (TIER_MISMATCH.lightRoles.includes(g.role) && TIER_MISMATCH.topTiers.includes(g.tier))
        || (TIER_MISMATCH.heavyRoles.includes(g.role) && TIER_MISMATCH.lowTiers.includes(g.tier)))
      .map((g) => ({ subject: `agent ${g.agentId}`, values: { agentId: g.agentId, epic: g.epic, role: g.role, tier: g.tier, work: g.work, total: g.total } })),
    evidence: (f) => `role=${f.values.role} ran on the ${f.values.tier} tier; work ${n(f.values.work)}, total ${n(f.values.total)}`,
    recommend: (f) => `${f.subject} ran role=${f.values.role} on the ${f.values.tier} tier: set the role's model with set-profile --model ${f.values.role}=<model> (or --model on the epic).`,
  },
  {
    id: "review-loop", status: "proposal",
    threshold: { minDistinctRounds: REVIEW_LOOP_MIN_ROUNDS },
    describe: () => `an epic whose phase=review rows carry >= ${REVIEW_LOOP_MIN_ROUNDS} distinct round values`,
    find: ({ reviewRounds }) => Object.entries(reviewRounds)
      .filter(([, rounds]) => rounds.length >= REVIEW_LOOP_MIN_ROUNDS)
      .map(([epic, rounds]) => ({
        subject: `epic ${epic}`, values: { epic, distinctRounds: rounds.length, rounds },
        note: "distinct review rounds in the ledger; this is not the spend guard's rounds signal, which counts from the pass anchor",
      })),
    evidence: (f) => `${f.values.distinctRounds} distinct review rounds (${f.values.rounds.join(", ")}; threshold ${REVIEW_LOOP_MIN_ROUNDS}); ${f.note}`,
    recommend: (f) => `${f.subject} reached ${f.values.distinctRounds} distinct review rounds: if the rounds fail on the same finding, run ${orNoRemedy(() => `spend-guard ${printedId(f.values.epic)}`)} and escalate rather than retry at the same tier.`,
  },
  {
    id: "low-coverage", status: "proposal",
    threshold: LOW_COVERAGE_SHARE,
    describe: () => `ledger coverage below ${pct(LOW_COVERAGE_SHARE)}`,
    find: ({ coverage }) => (coverage.share !== null && coverage.share < LOW_COVERAGE_SHARE
      ? [{ subject: "ledger", values: { share: coverage.share, attributed: coverage.attributed, total: coverage.total } }] : []),
    evidence: (f) => `${pct(f.values.share)} of ${n(f.values.total)} tokens attributed to an epic (threshold ${pct(LOW_COVERAGE_SHARE)}); the unattributed reasons are printed above`,
    recommend: (f) => `Only ${pct(f.values.share)} of the ledger is attributed: begin each sub-agent dispatch prompt with the pm-spend marker line and keep an epic active (set-active) so orchestrator turns are credited.`,
  },
  {
    id: "invalid-markers", status: "proposal",
    threshold: { minTokens: 1 },
    describe: () => "any invalid-marker tokens",
    find: ({ unattributed }) => {
      const t = unattributed.byReason["invalid-marker"];
      if (!t || t.total <= 0) return [];
      return [{
        subject: "ledger",
        values: {
          tokens: t.total, messages: t.messages,
          markers: (unattributed.invalidMarkers || []).map((m) => ({ field: m.field, value: String([...String(m.value)].slice(0, INVALID_VALUE_MAX).join("")), agents: m.agents, tokens: m.totals.total })),
        },
      }];
    },
    evidence: (f) => `${n(f.values.tokens)} tokens in ${n(f.values.messages)} messages under markers the ledger refused${f.values.markers.length ? ` (${f.values.markers.map((m) => `${m.field} "${m.value}"`).join(", ")})` : ""}`,
    recommend: (f) => `${n(f.values.tokens)} tokens sit under phase or role names outside the accepted lists: fix the names in the dispatch prompts (each invalid pm-spend marker line \`spend\` prints names the value and the accepted set).`,
  },
];

function raiseFlags(inputs) {
  const flags = [];
  for (const rule of RULES) {
    const found = rule.find(inputs).sort((a, b) => (a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0));
    for (const f of found) {
      const flag = { rule: rule.id, subject: f.subject, values: f.values, threshold: rule.threshold, ...(f.note ? { note: f.note } : {}) };
      flag.recommendation = rule.recommend(flag);
      flags.push(flag);
    }
  }
  return flags;
}

/** The cross-release trend (design D5). Ledger-wide, whatever the scope. Releases are ordered by registration in
 *  state, newest first; an epic counts toward its release only when it holds attributed rows. */
function buildTrend(state, reportEpics) {
  const releases = [];
  for (const rel of [...(state.releases || [])].reverse()) {
    if (!rel || typeof rel.id !== "string") continue;
    const members = (state.epics || []).filter((e) => e && e.release === rel.id && reportEpics[e.id] && reportEpics[e.id].totals.messages > 0);
    if (!members.length) continue;
    const work = members.reduce((sum, e) => sum + reportEpics[e.id].totals.work, 0);
    releases.push({ release: rel.id, epics: members.length, meanWork: work / members.length });
  }
  const qualifying = releases.filter((r) => r.epics >= TREND_MIN_EPICS);
  const base = { releases, floor: { minReleases: TREND_MIN_RELEASES, minEpicsPerRelease: TREND_MIN_EPICS }, band: TREND_BAND, status: "proposal" };
  if (qualifying.length < TREND_MIN_RELEASES) {
    const reason = `insufficient data — ${releases.length} releases, ${releases.reduce((s, r) => s + r.epics, 0)} epics`;
    return { ...base, verdict: "insufficient data", reason };
  }
  const [latest, previous] = qualifying;
  const verdict = latest.meanWork >= previous.meanWork * (1 + TREND_BAND) ? "growing"
    : latest.meanWork <= previous.meanWork * (1 - TREND_BAND) ? "falling" : "flat";
  return { ...base, verdict, latest: latest.release, previous: previous.release };
}

/** Analyse attributed rows (spend-attribution.mjs `attribute()`), pure.
 *    scope  { epic?, release? } -- at most one
 *    state  the record: its epics (and their `release`) and its releases */
export function analyze({ attributed, state, tracking, ingest = null, scope = {} }) {
  const ids = scopeEpicIds(state, scope);
  const report = buildReport({ attributed, tracking, ingest });
  const inScope = (id) => ids === null || ids.has(id);

  const breakdown = { totals: emptyTotals(), byActor: {}, byTier: {}, byRole: {}, byPhase: {} };
  const agents = [];
  for (const [epicId, e] of Object.entries(report.epics)) {
    if (!inScope(epicId)) continue;
    sumInto(breakdown.totals, e.totals);
    for (const [dim, key] of [["byActor", "byActor"], ["byTier", "byTier"], ["byRole", "byRole"], ["byPhase", "byPhase"]]) {
      for (const [k, t] of Object.entries(e[key])) sumInto((breakdown[dim][k] ||= emptyTotals()), t);
    }
    for (const [agentId, a] of Object.entries(e.agents)) {
      const t = a.totals;
      agents.push({
        agentId, epic: epicId, role: a.role, phase: a.phase, round: a.round, tier: a.tier,
        messages: t.messages, input: t.input, cacheCreation: t.cacheCreation, cacheRead: t.cacheRead, output: t.output,
        work: t.work, total: t.total,
        contextPerMessage: t.messages ? (t.input + t.cacheCreation + t.cacheRead) / t.messages : 0,
      });
    }
  }
  agents.sort((a, b) => desc(a.work, b.work) || desc(a.total, b.total) || (a.agentId < b.agentId ? -1 : 1));

  const toolRows = attributed.filter((r) => (ids === null ? true : r.epic != null && ids.has(r.epic)));
  const epicWork = Object.fromEntries(Object.entries(report.epics).map(([id, e]) => [id, e.totals.work]));
  const rounds = {};
  for (const r of toolRows) {
    if (r.phase !== "review" || r.epic == null) continue;
    const key = r.round === null || r.round === undefined ? 1 : r.round;
    (rounds[r.epic] ||= new Set()).add(key);
  }
  const reviewRounds = Object.fromEntries(Object.entries(rounds).map(([id, set]) => [id, [...set].sort((a, b) => a - b)]));
  return {
    tracking: report.tracking,
    ingest: report.ingest,
    scope: { kind: scope.epic ? "epic" : scope.release ? "release" : "ledger", epic: scope.epic || null, release: scope.release || null },
    breakdown,
    agents,
    unattributed: report.unattributed,
    coverage: report.coverage,
    tools: countTools(toolRows),
    flags: raiseFlags({ agents, epicWork, reviewRounds, coverage: report.coverage, unattributed: report.unattributed }),
    trend: buildTrend(state, report.epics),
    cost: report.cost,
  };
}

// ───────────────────────────── the text rendering ─────────────────────────────

const classes = (t) => `input ${n(t.input)} · cache-write ${n(t.cacheCreation)} · cache-read ${n(t.cacheRead)} · output ${n(t.output)} · work ${n(t.work)} · total ${n(t.total)}`;
const ranked = (map) => Object.entries(map).sort((x, y) => desc(x[1].work, y[1].work) || desc(x[1].total, y[1].total) || (x[0] < y[0] ? -1 : 1));

export function renderAnalysis(a, { extra = [] } = {}) {
  const L = [];
  const s = a.scope;
  const scopeText = s.kind === "epic" ? `epic ${s.epic}` : s.kind === "release" ? `release ${s.release}` : "the whole ledger";
  L.push(`spend-analysis — ${scopeText} · tracking ${a.tracking.enabled ? `on since ${a.tracking.enabledAt || "?"}` : "OFF"}`);
  for (const l of extra) L.push(l);
  if (a.off) { L.push(a.off); return L.map(escapeControls); }
  const t = a.breakdown.totals;
  if (a.coverage.total === 0) { L.push("the ledger holds no rows to analyse"); return L.map(escapeControls); }

  L.push("", `breakdown (ranked by work; total printed beside it): ${n(t.messages)} messages`, `  ${classes(t)}`);
  for (const [label, key] of [["actor", "byActor"], ["tier", "byTier"], ["role", "byRole"], ["phase", "byPhase"]]) {
    const rows = ranked(a.breakdown[key]);
    if (!rows.length) continue;
    L.push(`  by ${label}:`);
    for (const [k, v] of rows) L.push(`    ${k === NONE_KEY ? "none" : k}: ${classes(v)} · ${n(v.messages)} messages`);
  }

  L.push("", "sub-agents (ranked by work):");
  if (!a.agents.length) L.push("  none in this scope");
  for (const g of a.agents) {
    L.push(`  agent ${g.agentId} (epic ${g.epic} role=${g.role} phase=${g.phase} round=${g.round} tier=${g.tier}): work ${n(g.work)} · total ${n(g.total)} · ${n(g.messages)} messages · context per message ${n(Math.round(g.contextPerMessage))} · cache-read ${n(g.cacheRead)}`);
  }

  const u = a.unattributed;
  L.push("", `unattributed: ${n(u.totals.total)} tokens in ${n(u.totals.messages)} messages  (${Object.entries(u.byReason).map(([k, v]) => `${k} ${n(v.total)}`).join(" · ")})`);
  const c = a.coverage;
  L.push(`coverage: ${c.share === null ? "n/a" : `${(c.share * 100).toFixed(1)}%`} of ${n(c.total)} tokens attributed to an epic (ledger-wide)`);

  L.push("", "tools (messages that called each tool):");
  L.push(`  ${a.tools.byTool.length ? a.tools.byTool.map((x) => `${x.tool} ${n(x.count)}`).join(" · ") : "none"}`);
  for (const actor of ["orchestrator", "subagent"]) {
    const list = a.tools.byActor[actor];
    if (list.length) L.push(`  ${actor}: ${list.map((x) => `${x.tool} ${n(x.count)}`).join(" · ")}`);
  }
  L.push(`  ${a.tools.note}`);

  L.push("", "outliers:");
  if (!a.flags.length) {
    L.push("  no outliers were found. Thresholds are proposals, not measurements:");
    for (const r of RULES) L.push(`    ${r.id}: ${r.describe()}`);
  }
  for (const f of a.flags) {
    const rule = RULES.find((r) => r.id === f.rule);
    L.push(`  FLAG ${f.rule} — ${f.subject}: ${rule.evidence(f)}`, `    recommendation: ${f.recommendation}`);
  }
  if (a.flags.length) L.push("  (thresholds are proposals, not measurements)");

  L.push("", "trend (mean work per epic, newest release first):");
  for (const r of a.trend.releases) L.push(`  ${r.release}: ${n(r.epics)} epics, mean work ${n(Math.round(r.meanWork))}`);
  L.push(a.trend.verdict === "insufficient data"
    ? `  ${a.trend.reason}`
    : `  ${a.trend.verdict}: ${a.trend.latest} against ${a.trend.previous} (band ${pct(TREND_BAND)}, a proposal)`);

  L.push("", `cost: ${COST_NOTE}`);
  return L.map(escapeControls);
}

// ───────────────────────────── the verb ─────────────────────────────

/** `spend-analysis` */
export function spendAnalysis() {
  if (!isInitialized()) { die("conductor: run /pm:init first\n"); }
  const f = parseFlags(currentArgv().slice(3));
  requireFlagValues("spend-analysis", f);
  const on = (name) => f[name] === true || (Array.isArray(f[name]) && f[name].length > 0 && f[name].every((v) => v === true));
  const epic = typeof f.epic === "string" ? f.epic : undefined;
  const release = typeof f.release === "string" ? f.release : undefined;
  if (epic !== undefined && release !== undefined) {
    refuse("spend-analysis takes --epic or --release, not both: --epic and --release each pick the scope. Nothing was ingested.");
  }

  const tree = resolveMainTree();
  const r = readMainState(tree);
  if (r.reason) refuse(`spend-analysis could not read the main working tree's state.json (${escapeControls(tree.main)}) — it is ${r.reason}.`);
  const state = r.state;
  if (epic !== undefined && !(state.epics || []).some((e) => e && e.id === epic)) {
    refuse(`spend-analysis --epic '${escapeControls(epic)}' — no epic with that id is registered${tree.linked ? " in the main working tree" : ""}. Nothing was ingested.`);
  }
  if (release !== undefined && !(state.releases || []).some((x) => x && x.id === release)) {
    refuse(`spend-analysis --release '${escapeControls(release)}' — no release with that id is declared${tree.linked ? " in the main working tree" : ""}. Nothing was ingested.`);
  }
  const scope = { epic, release };
  const enabled = spendEnabled(state);
  const json = on("json");
  const trackingInfo = state.spendTracking;

  if (!enabled) {
    // Nothing under the spend or transcript directory is opened: the analysis of an empty set, plus the reason.
    const empty = analyze({ attributed: [], state, tracking: trackingInfo, ingest: { ran: false, reason: "tracking is off" }, scope });
    empty.off = OFF_MESSAGE;
    outStream().write(json ? jsonText(empty, null, 2) + "\n" : renderAnalysis(empty).join("\n") + "\n");
    return;
  }
  const enabledAtMs = Date.parse(trackingInfo && trackingInfo.enabledAt);
  if (!Number.isFinite(enabledAtMs)) {
    refuse("state.spendTracking.enabledAt is missing or unreadable, so there is no start to bound an ingest by. Run set-spend-tracking off, then on, to stamp a fresh start. Nothing was ingested.");
  }
  const env = currentEnv();
  const readCtx = { mainRoot: tree.main, env, home: env.HOME || os.homedir() };
  const ingestInfo = ingestForReport({ noIngest: on("no-ingest"), enabled: true, tree, readCtx, enabledAtMs, state });
  const ledger = readLedger(tree.main);
  const attributed = attribute(ledger.rows, ledger.markers, ledger.timeline, state);
  const out = analyze({ attributed, state, tracking: trackingInfo, ingest: ingestInfo, scope });
  if (json) { outStream().write(jsonText(out, null, 2) + "\n"); return; }
  const extra = [`ingest: ${ingestInfo.ran ? `+${ingestInfo.rowsAdded} message(s)` : ingestInfo.reason}`];
  if (ledger.corrupt) extra.push(`ledger: ${ledger.corrupt} unreadable line(s) were skipped`);
  outStream().write(renderAnalysis(out, { extra }).join("\n") + "\n");
}

