// scripts/lib/spend-tracking.mjs
// token-spend-tracking-per-epic — the SWITCH and the engine's side of the spend ledger.
//
// The ledger itself (a read-only view over Claude Code's own transcripts) lives in the modules
// beside this one: spend-reader.mjs (pure parsing), spend-attribution.mjs (pure attribution),
// spend-report.mjs (pure aggregation), spend-ledger.mjs (the files) and spend-command.mjs (the
// `spend` verb). This module is the verb that turns it on and off, and the timeline it keeps.
//
// OFF BY DEFAULT, AND AN ADDED OPTIONAL FIELD. `state.spendTracking = {enabled, enabledAt}` has no
// `MIGRATIONS` entry for the reason `state.activityLog` has none: a state file written by the prior
// version loads unchanged and resolves to off, which is what the field's absence already says.
// `enabledAt` is written on the FIRST `on` and never moved after that — it bounds how far back an
// ingest ever looks, so moving it on a re-enable would silently re-open or forget history.
//
// THE TIMELINE (design D7). While tracking is on, the engine records which epic was active and when,
// because the orchestrator's own spend can only be attributed by a window over `state.active`. It is
// written at the dispatch chokepoint by comparing `state.active` before and after one invocation —
// not by instrumenting the six places that write it (call-site-sweep-1.4.txt) — and ONLY when the
// pointer moved, so the hot-path cost with tracking on is the one extra state read the dispatch tail
// already makes for the activity log. It is written through the STORE (it is the main tree's, written
// only from the main tree), and a failed append never fails the invocation it observes.

import { isInitialized, loadState, saveState } from "./state.mjs";
import { ARTIFACT, storeOps } from "./store.mjs";
import { reportSave, STATE_UNCHANGED } from "./save-report.mjs";
import { checkedPositionals } from "./argv-surface.mjs";
import { die } from "./command-exit.mjs";
import { escapeControls } from "./constants.mjs";
import { mainTreeDetached, resolveMainTree } from "./spend-tree.mjs";
import { spendEnabled } from "./spend-switch.mjs";

/** The timeline's artifact name: `.conductor/spend/timeline.jsonl` under the store's root. */
export const TIMELINE = `${ARTIFACT.SPEND_PREFIX}timeline.jsonl`;

// The predicate is a leaf (spend-switch.mjs) so rules.mjs can ask it without a cycle; re-exported here
// because every spend caller reaches for this module.
export { spendEnabled };

/** Append one timeline entry. Never throws: observability must not break the run it observes. */
export function appendTimeline(entry) {
  try { storeOps().append(TIMELINE, JSON.stringify(entry) + "\n"); } catch { /* never fail the observed run */ }
}

/** The dispatch tail's one call (conductor.mjs). `beforeActive` is `state.active` at entry; `after` is
 *  the record at exit. Appends `{at, active}` when the pointer moved while tracking is on — from the
 *  MAIN working tree only, and not while its HEAD is detached. The git probes run only after the cheap
 *  checks pass, so an invocation that moved nothing spawns nothing. */
export function recordActiveChange(beforeActive, after) {
  try {
    if (!spendEnabled(after)) return;
    const now = after.active || null;
    if ((beforeActive || null) === now) return;
    const tree = resolveMainTree();
    if (tree.linked || mainTreeDetached(tree.main)) return;
    appendTimeline({ at: new Date().toISOString(), active: now });
  } catch { /* never fail the observed run */ }
}

/** `set-spend-tracking <on|off>` — the project-level switch. */
export function setSpendTracking() {
  if (!isInitialized()) { die("conductor: run /pm:init first\n"); }
  const [arg] = checkedPositionals("set-spend-tracking");
  if (arg !== "on" && arg !== "off") {
    die("usage: conductor.mjs set-spend-tracking <on|off>\n");
  }
  const state = loadState();
  // The switch and its timeline entry are one change: refused anywhere the entry could not be made
  // true, so `state.json` never says one thing while the timeline says another (a worktree's `off`
  // would otherwise write an off entry into a main timeline that main's state never matches).
  const tree = resolveMainTree();
  if (tree.linked) {
    die(`conductor: set-spend-tracking ${arg} is refused in a linked worktree — the switch and the ledger belong to the main working tree, ${escapeControls(tree.main)}. ` +
      "Run it there. Nothing was changed.\n");
  }
  if (mainTreeDetached(tree.main)) {
    die(`conductor: set-spend-tracking ${arg} is refused while the main working tree's HEAD is detached — its ledger writes are suppressed there, ` +
      "and flipping the switch without its timeline entry would credit spend to the wrong epic. Check out a branch first. Nothing was changed.\n");
  }
  // `off` on a repo that never turned it on is already the state of affairs: say so, write nothing.
  if (arg === "off" && !spendEnabled(state)) {
    reportSave({ unchanged: true }, { unchanged: `conductor: spend tracking was already off — ${STATE_UNCHANGED}` });
    return;
  }
  const prev = state.spendTracking || {};
  const enabledAt = typeof prev.enabledAt === "string" && prev.enabledAt
    ? prev.enabledAt
    : (arg === "on" ? new Date().toISOString() : undefined);
  state.spendTracking = { ...prev, enabled: arg === "on", ...(enabledAt ? { enabledAt } : {}) };
  const saved = saveState(state);
  if (!saved.unchanged) {
    // ONLY on a real change: a repeat writes nothing, to the record or to the timeline.
    appendTimeline(arg === "on"
      ? { at: new Date().toISOString(), tracking: "on", active: state.active || null }
      : { at: new Date().toISOString(), tracking: "off" });
  }
  reportSave(saved, {
    changed: `conductor: spend tracking ${arg}${arg === "on"
      ? " — the ledger is built by `spend` from Claude Code's own transcripts (git-ignored under .conductor/spend/)."
      : " — nothing further is read. What was already recorded is kept."}`,
    unchanged: `conductor: spend tracking was already ${arg} — ${STATE_UNCHANGED}`,
  });
}
