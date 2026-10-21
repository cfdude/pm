// scripts/lib/decision-log.mjs
// decision-cost-log -- the decisions an epic's work reached, and what reaching each one cost.
//
//   record-decision <epicId> --what <text> --why <text> --since <iso> [--until <iso>] [--alternative <text>]... [--phase <phase>]
//   record-decision <epicId> --withdraw <n> --reason <text>
//
// A decision is a RECORD OF THE WORK, so it lives on the epic (`epic.decisions`, in state.json) and survives a ledger
// `--clear`. Its COST is never stored and never typed: it is computed at read time from the spend ledger (the epic's
// attributed `work` and `total` inside the decision's window), so a re-attribution re-prices it and pm never asks an
// agent for a number it cannot check.
//
// OFF WITH THE REST OF THE SPEND FEATURE. Recording is refused while tracking is off (a decision whose cost can
// never be computed belongs in an epic note). Withdrawing reads no ledger, so it stays accepted.
//
// WITHDRAW MARKS, NEVER DELETES (design D4), as an override revoke does: `withdrawnAt` and `withdrawReason` are
// added and the decision stays. Numbers are per epic, 1-based and never reused (design D5).

import os from "node:os";
import { isInitialized, loadState, saveState } from "./state.mjs";
import { reportSave, STATE_UNCHANGED } from "./save-report.mjs";
import { checkedPositionals } from "./argv-surface.mjs";
import { parseFlags, requireFlagValues } from "./add-epic.mjs";
import { render } from "./render.mjs";
import { die } from "./command-exit.mjs";
import { KNOWN_SPEND_PHASES, escapeControls, jsonText, orNoRemedy, printedId } from "./constants.mjs";
import { currentArgv, currentEnv, outStream } from "./invocation.mjs";
import { resolveMainTree } from "./spend-tree.mjs";
import { spendEnabled } from "./spend-switch.mjs";
import { ingestForReport, readMainState } from "./spend-command.mjs";
import { readLedger } from "./spend-ledger.mjs";
import { attribute } from "./spend-attribution.mjs";
import { buildReport } from "./spend-report.mjs";

const refuse = (msg) => die(`conductor: ${msg}\n`);

/** Each decision text field is capped at this many characters (design Risks): agent-written text, stored as given. */
export const DECISION_TEXT_MAX = 2000;

const ISO_SHAPE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const asList = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const given = (f, name) => f[name] !== undefined;

/** `record-decision` */
export function recordDecision() {
  if (!isInitialized()) { die("conductor: run /pm:init first\n"); }
  const [epicId] = checkedPositionals("record-decision");
  const usage = "usage: conductor.mjs record-decision <epicId> --what \"<decision>\" --why \"<why>\" --since <iso> [--until <iso>] [--alternative \"<alt>\"]... [--phase <phase>]\n" +
    "       conductor.mjs record-decision <epicId> --withdraw <n> --reason \"<why>\"\n";
  if (!epicId) die(usage);
  const f = parseFlags(currentArgv().slice(3));
  requireFlagValues("record-decision", f);

  const state = loadState();
  const epic = state.epics.find((e) => e.id === epicId);
  if (!epic) refuse(`record-decision: no epic '${escapeControls(String(epicId))}' is registered. Nothing was written.`);

  const cap = (flag, text) => {
    if (typeof text !== "string" || !text.trim()) refuse(`record-decision --${flag} needs non-empty text. Nothing was written.`);
    if ([...text].length > DECISION_TEXT_MAX) refuse(`record-decision --${flag} is ${[...text].length.toLocaleString("en-US")} characters; the limit is ${DECISION_TEXT_MAX.toLocaleString("en-US")} (2,000). Nothing was written.`);
    return text.trim();
  };

  if (given(f, "withdraw")) return withdraw(state, epic, f, cap);

  if (given(f, "reason")) refuse("record-decision --reason belongs to --withdraw <n>; a new decision carries --why. Nothing was written.");
  // The tracking switch is the MAIN working tree's. Recording is refused while it is off, writing nothing.
  const tree = resolveMainTree();
  const main = readMainState(tree);
  if (main.reason) refuse(`record-decision could not read the main working tree's state.json (${escapeControls(tree.main)}) — it is ${main.reason}. Nothing was written.`);
  if (!spendEnabled(main.state)) {
    const notes = orNoRemedy(() => `update-epic ${printedId(epic.id)} --notes "<the decision>"`);
    refuse(`record-decision is off while spend tracking is off: a decision's cost is computed from the spend ledger, which is not being kept. Run \`set-spend-tracking on\` to record decisions with their cost, or note this one with \`${notes}\`. Nothing was written.`);
  }

  const what = cap("what", f.what), why = cap("why", f.why);
  const alternatives = asList(f.alternative).map((a) => cap("alternative", a));
  if (typeof f.since !== "string") refuse("record-decision needs --since <iso>: the start of the work window that reached the decision. Nothing was written.");
  const parsed = (flag, v) => {
    if (typeof v !== "string" || !ISO_SHAPE.test(v.trim()) || !Number.isFinite(Date.parse(v))) {
      refuse(`record-decision --${flag} needs an ISO-8601 timestamp, not '${escapeControls(String(v))}'. Nothing was written.`);
    }
    return { text: v.trim(), ms: Date.parse(v) };
  };
  const nowMs = Date.now();
  const at = new Date(nowMs).toISOString();
  const since = parsed("since", f.since);
  let until;
  if (given(f, "until")) {
    until = parsed("until", f.until);
    if (until.ms < since.ms) refuse(`record-decision --until '${escapeControls(until.text)}' is before --since '${escapeControls(since.text)}'. Nothing was written.`);
    if (until.ms > nowMs) refuse(`record-decision --until '${escapeControls(until.text)}' is in the future; the window cannot extend past the record time. Nothing was written.`);
  } else {
    if (since.ms > nowMs) refuse(`record-decision --since '${escapeControls(since.text)}' is after now; --until defaults to the record time, so the window would end before it starts. Nothing was written.`);
    until = { text: at, ms: nowMs };
  }
  let phase = null;
  if (given(f, "phase")) {
    if (!KNOWN_SPEND_PHASES.includes(f.phase)) refuse(`record-decision --phase '${escapeControls(String(f.phase))}' is not one of ${KNOWN_SPEND_PHASES.join("|")}. Nothing was written.`);
    phase = f.phase;
  }

  const existing = Array.isArray(epic.decisions) ? epic.decisions : [];
  const n = existing.reduce((m, d) => (d && Number.isInteger(d.n) && d.n > m ? d.n : m), 0) + 1;
  epic.decisions = [...existing, { n, what, why, alternatives, phase, since: since.text, until: until.text, at }];
  const saved = saveState(state);
  render();
  reportSave(saved, {
    changed: `conductor: recorded decision ${n} on '${escapeControls(epicId)}'; its cost is computed from the spend ledger when read, never stored (the decisions verb prints it)`,
    unchanged: `conductor: that decision was already recorded — ${STATE_UNCHANGED}`,
  });
}

function withdraw(state, epic, f, cap) {
  const stray = ["what", "why", "since", "until", "alternative", "phase"].filter((k) => given(f, k));
  if (stray.length) refuse(`record-decision --withdraw takes only --reason; --${stray.join(", --")} would be ignored, which reads as a narrower operation than it is. Nothing was written.`);
  const raw = f.withdraw;
  if (typeof raw !== "string" || !/^[1-9][0-9]*$/.test(raw)) refuse(`record-decision --withdraw needs a decision number (a positive whole number), not '${escapeControls(String(raw))}'. Nothing was written.`);
  if (!given(f, "reason")) refuse("record-decision --withdraw needs --reason \"<why>\" (non-empty). Nothing was written.");
  const reason = cap("reason", f.reason);
  const n = Number(raw);
  const d = (Array.isArray(epic.decisions) ? epic.decisions : []).find((x) => x && x.n === n);
  if (!d) refuse(`record-decision --withdraw: epic '${escapeControls(epic.id)}' has no decision ${n}. Nothing was written.`);
  if (d.withdrawnAt) refuse(`record-decision --withdraw: decision ${n} on '${escapeControls(epic.id)}' is already withdrawn (${escapeControls(String(d.withdrawnAt))}). Nothing was written.`);
  d.withdrawnAt = new Date().toISOString();
  d.withdrawReason = reason;
  const saved = saveState(state);
  render();
  reportSave(saved, {
    changed: `conductor: withdrew decision ${n} on '${escapeControls(epic.id)}' (kept in the record; it is listed as withdrawn and has no cost)`,
    unchanged: `conductor: that withdrawal was already recorded — ${STATE_UNCHANGED}`,
  });
}

// ───────────────────────────── cost and render ─────────────────────────────

export const OFF_REASON = "spend tracking is off";
export const NOT_CAUSAL = "cost is the epic's attributed spend in the window, not spend caused by the decision alone; windows may overlap, so decision costs are not summed";

const n = (v) => v.toLocaleString("en-US");

/** Cost every decision of one epic from attributed ledger rows, pure. NOTHING here is stored: a decision's cost is the
 *  `work` and `total` the spend report attributes to its epic with `since <= at < until` (half-open, as `spend --since
 *  --until` is), plus that window's coverage share. A withdrawn decision has no cost computed; with tracking off none
 *  does. Entries carry the stored fields plus `withdrawn` and `cost`, in `n` order. */
export function costDecisions({ decisions, epicId, attributed, tracking }) {
  const enabled = !!(tracking && tracking.enabled);
  return [...(Array.isArray(decisions) ? decisions : [])]
    .filter((d) => d && Number.isInteger(d.n))
    .sort((a, b) => a.n - b.n)
    .map((d) => {
      const withdrawn = !!d.withdrawnAt;
      let cost;
      if (withdrawn) cost = { computed: false, reason: "withdrawn" };
      else if (!enabled) cost = { computed: false, reason: OFF_REASON };
      else {
        const report = buildReport({ attributed, tracking, ingest: null, filters: { epic: epicId, since: d.since, until: d.until } });
        const t = report.epics[epicId] ? report.epics[epicId].totals : null;
        cost = { computed: true, work: t ? t.work : 0, total: t ? t.total : 0, messages: t ? t.messages : 0, coverage: report.coverage.share };
      }
      return { ...d, alternatives: Array.isArray(d.alternatives) ? d.alternatives : [], withdrawn, cost };
    });
}

/** The lines `decisions` and the analysis's Decisions section both print (so the two cannot differ). */
export function renderDecisionLines(entries) {
  const L = [];
  for (const d of entries) {
    if (d.withdrawn) L.push(`decision ${d.n} (withdrawn ${d.withdrawnAt}: ${d.withdrawReason}): ${d.what}`);
    else L.push(`decision ${d.n}: ${d.what}`);
    L.push(`  why: ${d.why}`);
    L.push(`  alternatives: ${d.alternatives.length ? d.alternatives.join("; ") : "none recorded"}`);
    L.push(`  ${d.phase ? `phase ${d.phase} · ` : ""}window ${d.since} .. ${d.until} · recorded ${d.at}`);
    if (d.cost.computed) {
      const cov = d.cost.coverage === null ? "no spend in the window" : `coverage ${(d.cost.coverage * 100).toFixed(1)}%`;
      L.push(`  cost: work ${n(d.cost.work)} · total ${n(d.cost.total)} · ${cov}`);
    } else if (d.cost.reason === OFF_REASON) L.push(`  cost: not computed — ${OFF_REASON}`);
    else L.push(`  cost: none (${d.cost.reason})`);
  }
  if (entries.length) L.push(`(${NOT_CAUSAL})`);
  return L.map(escapeControls);
}

/** `decisions <epicId> [--json] [--no-ingest]` */
export function decisionsVerb() {
  if (!isInitialized()) { die("conductor: run /pm:init first\n"); }
  const [epicId] = checkedPositionals("decisions");
  if (!epicId) die("usage: conductor.mjs decisions <epicId> [--json] [--no-ingest]\n");
  const f = parseFlags(currentArgv().slice(3));
  requireFlagValues("decisions", f);
  const on = (name) => f[name] === true || (Array.isArray(f[name]) && f[name].length > 0 && f[name].every((v) => v === true));
  const local = loadState();
  const epic = local.epics.find((e) => e.id === epicId);
  if (!epic) refuse(`decisions: no epic '${escapeControls(String(epicId))}' is registered.`);
  const decisions = Array.isArray(epic.decisions) ? epic.decisions : [];

  const tree = resolveMainTree();
  const main = readMainState(tree);
  if (main.reason) refuse(`decisions could not read the main working tree's state.json (${escapeControls(tree.main)}) — it is ${main.reason}.`);
  const tracking = main.state.spendTracking;
  const enabled = spendEnabled(main.state);

  let attributed = [], ingestInfo = null;
  // Nothing to cost (no decisions, or every one withdrawn) reads no ledger and ingests nothing.
  if (enabled && decisions.some((d) => d && !d.withdrawnAt)) {
    const enabledAtMs = Date.parse(tracking && tracking.enabledAt);
    if (!Number.isFinite(enabledAtMs)) {
      refuse("state.spendTracking.enabledAt is missing or unreadable, so there is no start to bound an ingest by. Run set-spend-tracking off, then on, to stamp a fresh start. Nothing was ingested.");
    }
    const env = currentEnv();
    const readCtx = { mainRoot: tree.main, env, home: env.HOME || os.homedir() };
    ingestInfo = ingestForReport({ noIngest: on("no-ingest"), enabled: true, tree, readCtx, enabledAtMs, state: main.state });
    const ledger = readLedger(tree.main);
    attributed = attribute(ledger.rows, ledger.markers, ledger.timeline, main.state);
  }
  const entries = costDecisions({ decisions, epicId, attributed, tracking });
  if (on("json")) {
    outStream().write(jsonText({ epic: epicId, tracking: { enabled }, decisions: entries, note: NOT_CAUSAL }, null, 2) + "\n");
    return;
  }
  const L = [`Decisions for epic ${epicId} · tracking ${enabled ? "on" : "OFF"}`];
  if (ingestInfo && !ingestInfo.ran) L.push(`ingest: ${ingestInfo.reason}`);
  if (!entries.length) L.push(`no decisions recorded for '${epicId}'`);
  L.push(...renderDecisionLines(entries));
  outStream().write(L.map(escapeControls).join("\n") + "\n");
}
