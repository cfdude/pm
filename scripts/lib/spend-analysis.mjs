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
import { escapeControls, jsonText } from "./constants.mjs";
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
  return {
    tracking: report.tracking,
    ingest: report.ingest,
    scope: { kind: scope.epic ? "epic" : scope.release ? "release" : "ledger", epic: scope.epic || null, release: scope.release || null },
    breakdown,
    agents,
    unattributed: report.unattributed,
    coverage: report.coverage,
    tools: countTools(toolRows),
    flags: [],
    trend: null,
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

