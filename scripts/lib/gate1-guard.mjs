// scripts/lib/gate1-guard.mjs
// The Gate 1 (spec review) guard on ACTIVATION. Gate 1 is recorded (`epic.gateReview.gate1`) and the
// archive gate deliberately exempts it (Gate 1 gates CODE, which is written long before archive), so the
// only place a mechanical demand belongs is the transition INTO implementation.
//
// THE ENGINE HAS NO "apply started" EVENT, so the guard keys on the nearest mechanical proxy and states its
// limit: an openspec-lane epic that is NOT active and whose change directory IS on disk (planning exists, so
// there is something to review) may not be moved to `active` without a passing Gate 1 verdict or a recorded
// waiver. An epic with no change on disk is pre-propose — activating it is how the change gets written — so
// it is never refused. A STALE Gate 1 is not refused here (integrity's `gate1-verdict-stale` reports it).

import { isOpenspecLane, orNoRemedy, printedId, escapeControls, asCode, withdrawnGate } from "./constants.mjs";
import { activeChangeIds } from "./epic-progress.mjs";
import { changeNamesClaimedByArtifacts } from "./source-artifacts.mjs";
import { gateRemedy } from "./archive-gate.mjs";

/** The recorded waiver reason (trimmed), or `null`: only a non-blank string counts. */
export function gate1Waiver(epic) {
  const w = epic && epic.gate1Waived;
  return typeof w === "string" && w.trim() !== "" ? w.trim() : null;
}

/** Does `epic` meet the activation demand: not openspec-lane, no change on disk, a passing Gate 1, or a
 *  waiver. `changeIds` is injectable so a test needs no disk. Returns the unmet reason or `null`. */
export function gate1ActivationGap(epic, changeIds = activeChangeIds()) {
  if (!epic || !isOpenspecLane(epic)) return null;
  // The epic's change is named by its id OR by the change directory its `--plan` / `--spec` points into
  // (gh#200: an epic registered under one id whose change was proposed under another). Matching the id
  // alone treated such an epic as pre-propose and never refused it.
  const names = [epic.id, ...changeNamesClaimedByArtifacts({ epics: [epic] })];
  if (!names.some(n => changeIds.includes(n))) return null;
  if (gate1Waiver(epic)) return null;
  const g1 = epic.gateReview && epic.gateReview.gate1;
  if (g1 && g1.verdict === "pass") return null;
  if (g1) return `its Gate 1 (spec review) verdict is '${escapeControls(String(g1.verdict))}', not pass`;
  if (withdrawnGate(epic, 1)) return "its Gate 1 (spec review) verdict was withdrawn";
  return "it has no Gate 1 (spec review) verdict";
}

/** The refusal text for one epic, or `null`. `creating` swaps the remedy for add-epic/add-many, where the
 *  epic does not exist yet and so cannot carry a verdict or a waiver. */
export function gate1ActivationRefusal(epic, { creating = false, changeIds } = {}) {
  const gap = gate1ActivationGap(epic, changeIds);
  if (gap === null) return null;
  const id = epic.id;
  const head = `cannot make openspec-lane epic '${escapeControls(id)}' active — its change is on disk but ${gap}. ` +
    "Gate 1 gates code: a spec review comes before implementation. ";
  if (creating) {
    return head + "Register it at another status (e.g. --status queued), then " +
      orNoRemedy(() => `${asCode(gateRemedy(id, 1))} after a real fresh-context spec review, and activate it. Nothing was written.`);
  }
  return head + "Either record the review — " +
    orNoRemedy(() => asCode(gateRemedy(id, 1))) +
    " — after a real fresh-context spec review, or waive it deliberately — " +
    orNoRemedy(() => asCode(`update-epic ${printedId(id)} --status active --gate1-waived "<why Gate 1 does not apply>"`)) +
    ". Nothing was written.";
}

/** The WARNING the detour verbs print instead of refusing. push-detour activates the detour and pop-detour
 *  re-activates the paused epic: refusing either would leave no CLI route to set work aside (the precedent
 *  owedReconcileNotice sets), and a pop is a RESUMPTION of an epic that was already active, not an entry.
 *  `null` when the epic meets the demand. */
export function gate1ActivationNotice(epic, changeIds) {
  const gap = gate1ActivationGap(epic, changeIds);
  if (gap === null) return null;
  return `conductor: warning — '${escapeControls(epic.id)}' is now active but ${gap}, and its change is on disk. ` +
    "Gate 1 gates code: " +
    orNoRemedy(() => `${asCode(gateRemedy(epic.id, 1))} (or waive it: ${asCode(`update-epic ${printedId(epic.id)} --gate1-waived "<why>"`)}) `) +
    "before implementing.\n";
}
