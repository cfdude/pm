// scripts/lib/spend-report.mjs
// token-spend-tracking-per-epic — turning attributed rows into the report. Pure: values in, a value
// (and its text rendering) out.
//
// TOKENS, NEVER MONEY. pm ships no price table — a hardcoded per-token price is an invented number
// that goes stale silently — and Claude Code's own `cost-state` is per main session, includes calls
// the ledger cannot see (background haiku calls never appear as assistant entries) and cannot be split
// per epic without such a table. So the report prints `cost: not computed` and says why.
//
// THE UNATTRIBUTED BUCKET IS ALWAYS PRINTED, even at zero. Spend that was not measured must never look
// like spend that did not happen, and a coverage share makes the gap a number rather than a feeling.

import { escapeControls } from "./constants.mjs";
import { rowTotal } from "./spend-reader.mjs";
import { UNATTRIBUTED_REASONS } from "./spend-attribution.mjs";

export const COST_NOTE =
  "not computed — tokens are the measure. Claude Code's own cost figures are notional under subscription auth.";

/** The key a dimension shows for a row it does not apply to (an orchestrator row has no role). */
export const NONE_KEY = "none";

export const emptyTotals = () => ({ input: 0, cacheCreation: 0, cacheRead: 0, output: 0, total: 0, messages: 0 });

function addTo(t, r) {
  t.input += r.input; t.cacheCreation += r.cacheCreation; t.cacheRead += r.cacheRead; t.output += r.output;
  t.total += rowTotal(r); t.messages += 1;
  return t;
}
const bucket = (map, key) => (map[key] ||= emptyTotals());

/** Is `at` inside the half-open window [since, until)? An absent bound is open. */
function inWindow(at, sinceMs, untilMs) {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return false;
  return (sinceMs === null || t >= sinceMs) && (untilMs === null || t < untilMs);
}

/** Build the report object from attributed rows (spend-attribution.mjs `attribute()`).
 *
 *    filters  { epic?, since?, until? } — `since`/`until` are ISO strings, half-open [since, until)
 *    tracking { enabled, enabledAt }    — echoed so a reader sees what it is reading
 *    ingest   the ingest summary the verb ran (or why it did not)
 *
 *  The window filters EVERY row; `epic` narrows the per-epic section only, because the unattributed
 *  bucket and the coverage line are statements about all the spend in the window. */
export function buildReport({ attributed, tracking, ingest, filters = {} }) {
  const sinceMs = filters.since ? Date.parse(filters.since) : null;
  const untilMs = filters.until ? Date.parse(filters.until) : null;
  const rows = attributed.filter((r) => inWindow(r.at, sinceMs, untilMs));

  const epics = {};
  const unattributed = { totals: emptyTotals(), byReason: Object.fromEntries(UNATTRIBUTED_REASONS.map((k) => [k, emptyTotals()])) };
  let attributedTokens = 0, grand = 0;

  for (const r of rows) {
    grand += rowTotal(r);
    if (r.epic === null || r.epic === undefined) {
      addTo(unattributed.totals, r);
      addTo(bucket(unattributed.byReason, r.reason || "unknown-epic"), r);
      continue;
    }
    attributedTokens += rowTotal(r);
    if (filters.epic && r.epic !== filters.epic) continue;
    const e = (epics[r.epic] ||= {
      totals: emptyTotals(), byActor: {}, byRole: {}, byPhase: {}, byRound: {}, byTier: {},
      firstAt: null, lastAt: null, agents: {},
    });
    addTo(e.totals, r);
    addTo(bucket(e.byActor, r.actor), r);
    addTo(bucket(e.byRole, r.role ?? NONE_KEY), r);
    addTo(bucket(e.byPhase, r.phase ?? NONE_KEY), r);
    addTo(bucket(e.byRound, r.round === null || r.round === undefined ? NONE_KEY : String(r.round)), r);
    addTo(bucket(e.byTier, r.tier), r);
    if (e.firstAt === null || r.at < e.firstAt) e.firstAt = r.at;
    if (e.lastAt === null || r.at > e.lastAt) e.lastAt = r.at;
    if (r.actor === "subagent" && r.agentId) {
      const a = (e.agents[r.agentId] ||= { role: r.role, phase: r.phase, round: r.round, tier: r.tier, totals: emptyTotals(), _byTier: {} });
      addTo(a.totals, r);
      a._byTier[r.tier] = (a._byTier[r.tier] || 0) + rowTotal(r);
    }
  }
  // An agent's `tier` is the tier that carried most of its tokens (one agent can switch model).
  for (const e of Object.values(epics)) {
    for (const a of Object.values(e.agents)) {
      a.tier = Object.entries(a._byTier).sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0][0];
      delete a._byTier;
    }
  }

  return {
    tracking: { enabled: !!(tracking && tracking.enabled), enabledAt: (tracking && tracking.enabledAt) || null },
    ingest,
    epics,
    unattributed,
    coverage: { attributed: attributedTokens, total: grand, share: grand === 0 ? null : attributedTokens / grand },
    cost: { computed: false, note: COST_NOTE },
  };
}

// ───────────────────────────── the text rendering ─────────────────────────────

const n = (v) => v.toLocaleString("en-US");
const parts = (t) => `input ${n(t.input)} · cache-write ${n(t.cacheCreation)} · cache-read ${n(t.cacheRead)} · output ${n(t.output)}`;
// Largest first, ties by key. A three-way comparison and not a subtraction: conductor-13 forbids a second
// place that subtracts `.total`, because that is how outstanding-work arithmetic forks.
const byTotalDesc = (x, y) => (x[1].total < y[1].total ? 1 : x[1].total > y[1].total ? -1 : (x[0] < y[0] ? -1 : 1));
const dim = (map) => Object.entries(map).sort(byTotalDesc)
  .map(([k, t]) => `${k} ${n(t.total)}`).join(" · ");

/** The report as lines of text. `ingestLines` are the verb's own account of what the ingest did. */
export function renderReport(report, { ingestLines = [] } = {}) {
  const lines = [];
  const tr = report.tracking;
  lines.push(`spend — tokens by epic · tracking ${tr.enabled ? `on since ${tr.enabledAt || "?"}` : "OFF"}`);
  for (const l of ingestLines) lines.push(l);
  const ids = Object.keys(report.epics).sort();
  if (!ids.length) lines.push("no epic has attributed spend in this window");
  for (const id of ids) {
    const e = report.epics[id];
    lines.push("", `epic ${id}: ${n(e.totals.total)} tokens in ${n(e.totals.messages)} messages  (${parts(e.totals)})`);
    lines.push(`  window: ${e.firstAt} .. ${e.lastAt}`);
    lines.push(`  by actor: ${dim(e.byActor)}`);
    lines.push(`  by role:  ${dim(e.byRole)}`);
    lines.push(`  by phase: ${dim(e.byPhase)}`);
    lines.push(`  by round: ${dim(e.byRound)}`);
    lines.push(`  by tier:  ${dim(e.byTier)}`);
    for (const [agentId, a] of Object.entries(e.agents).sort()) {
      lines.push(`  agent ${agentId}: role=${a.role} phase=${a.phase} round=${a.round} tier=${a.tier} — ${n(a.totals.total)} tokens`);
    }
  }
  const u = report.unattributed;
  lines.push("", `unattributed: ${n(u.totals.total)} tokens in ${n(u.totals.messages)} messages` +
    `  (${UNATTRIBUTED_REASONS.map((k) => `${k} ${n(u.byReason[k].total)}`).join(" · ")})`);
  const c = report.coverage;
  lines.push(`coverage: ${c.share === null ? "n/a (no spend in this window)" : `${(c.share * 100).toFixed(1)}%`} of ${n(c.total)} tokens attributed to an epic`);
  lines.push(`cost: ${report.cost.note}`);
  // Every line leaves through the escaper: an epic id, an agent id (a transcript file's name) and the
  // ingest lines are all stored or foreign text.
  return lines.map(escapeControls);
}
