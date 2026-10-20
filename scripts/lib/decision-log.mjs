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

import { isInitialized, loadState, saveState } from "./state.mjs";
import { reportSave, STATE_UNCHANGED } from "./save-report.mjs";
import { checkedPositionals } from "./argv-surface.mjs";
import { parseFlags, requireFlagValues } from "./add-epic.mjs";
import { render } from "./render.mjs";
import { die } from "./command-exit.mjs";
import { KNOWN_SPEND_PHASES, escapeControls, orNoRemedy, printedId } from "./constants.mjs";
import { currentArgv } from "./invocation.mjs";
import { resolveMainTree } from "./spend-tree.mjs";
import { spendEnabled } from "./spend-switch.mjs";
import { readMainState } from "./spend-command.mjs";

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
    changed: `conductor: recorded decision ${n} on '${escapeControls(epicId)}'; its cost is computed from the spend ledger when read (\`decisions ${escapeControls(orNoRemedy(() => printedId(epicId)))}\`)`,
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
