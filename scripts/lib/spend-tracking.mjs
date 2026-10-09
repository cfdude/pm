// scripts/lib/spend-tracking.mjs
// token-spend-tracking-per-epic — the SWITCH and the engine's side of the spend ledger.
//
// The ledger itself (a read-only view over Claude Code's own transcripts) lives in the modules
// beside this one: spend-reader.mjs (pure parsing), spend-attribution.mjs (pure attribution and
// aggregation) and spend-ledger.mjs (the files). This module is the verb that turns it on and off.
//
// OFF BY DEFAULT, AND AN ADDED OPTIONAL FIELD. `state.spendTracking = {enabled, enabledAt}` has no
// `MIGRATIONS` entry for the reason `state.activityLog` has none: a state file written by the prior
// version loads unchanged and resolves to off, which is what the field's absence already says.
// `enabledAt` is written on the FIRST `on` and never moved after that — it bounds how far back an
// ingest ever looks, so moving it on a re-enable would silently re-open or forget history.

import { isInitialized, loadState, saveState } from "./state.mjs";
import { reportSave, STATE_UNCHANGED } from "./save-report.mjs";
import { checkedPositionals } from "./argv-surface.mjs";
import { die } from "./command-exit.mjs";

/** Is spend tracking on in this record? Absent config means OFF. */
export function spendEnabled(state) {
  return !!(state && state.spendTracking && state.spendTracking.enabled === true);
}

/** `set-spend-tracking <on|off>` — the project-level switch. */
export function setSpendTracking() {
  if (!isInitialized()) { die("conductor: run /pm:init first\n"); }
  const [arg] = checkedPositionals("set-spend-tracking");
  if (arg !== "on" && arg !== "off") {
    die("usage: conductor.mjs set-spend-tracking <on|off>\n");
  }
  const state = loadState();
  const prev = state.spendTracking || {};
  const enabledAt = typeof prev.enabledAt === "string" && prev.enabledAt
    ? prev.enabledAt
    : (arg === "on" ? new Date().toISOString() : undefined);
  state.spendTracking = { ...prev, enabled: arg === "on", ...(enabledAt ? { enabledAt } : {}) };
  const saved = saveState(state);
  reportSave(saved, {
    changed: `conductor: spend tracking ${arg}${arg === "on"
      ? " — the ledger is built by `spend` from Claude Code's own transcripts (git-ignored under .conductor/spend/)."
      : " — nothing further is read. What was already recorded is kept."}`,
    unchanged: `conductor: spend tracking was already ${arg} — ${STATE_UNCHANGED}`,
  });
}
