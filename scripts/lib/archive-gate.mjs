// scripts/lib/archive-gate.mjs
// What the archive transition requires, per path. May import constants.mjs,
// epic-progress.mjs, disposition.mjs and git.mjs — and nothing else, and nothing under those
// imports back up. `update-epic.mjs` imports THIS module; the reverse never happens.
//
// Why a module rather than the inline refusal this replaces: the Gate 2 check lived at
// update-epic.mjs:106-115, and that placement is exactly how it came to bind ONE of the five
// paths that can leave an epic at `status: "archived"` — the interactive verb — while the
// archive-drift heal, the archive backfill registration and the two archived-at-creation paths
// went ungated. A rule written here is a rule every one of those paths can import; a rule
// written inside one command's body is a rule about that command.
//
// SEAM OWNERSHIP (design § 1): this module owns what is REQUIRED AT A TRANSITION. What is
// TRUE OF AN EPIC — outstanding work above all — belongs to epic-progress.mjs, and the gate
// READS that quantity rather than computing one of its own. Two counters is how a guard comes
// to refuse an epic that renders as complete.

import { gateHasEvidence, isOpenspecLane } from "./constants.mjs";
import { isAncestor } from "./git.mjs";
import { epicProgress, outstandingWork } from "./epic-progress.mjs";

/**
 * The outstanding-work quantity a refusal cites, rendered ONCE so a guard can never name a
 * number the record does not show. `claimed` is the very substring PROJECT.md and the brief
 * render for the same epic, and `outstanding` is epic-progress.mjs's single definition —
 * this module reads that quantity and deliberately computes none of its own (design § 1).
 *
 * Nothing refuses on work remaining yet; the handoff demand is the first caller. It lands
 * here rather than beside it so the refusal and the record share one renderer by construction.
 */
export function outstandingSummary(epic) {
  const p = epicProgress(epic);
  return { outstanding: outstandingWork(epic), claimed: `${p.done}/${p.total}`, excluded: p.excluded };
}

/**
 * How well a recorded verdict covers the work actually attributed to the epic.
 *
 * Four distinct answers, and collapsing any two of them is the defect:
 *
 *   "unverifiable"    the epic has NO attribution array (it predates the capability), or the
 *                     verdict records no range, or git cannot answer. Nothing is known; the
 *                     archive is not refused on staleness grounds, and the verdict is not
 *                     silently shown as a covering pass either.
 *   "none-attributed" the array is PRESENT and EMPTY — the epic was created under this
 *                     capability and asserts that nothing has been attributed to it. No verdict
 *                     can be shown stale by an empty array, so the archive is not refused; it
 *                     renders differently from unverifiable because it is a different claim.
 *   "stale"           the recorded `headSha` is a STRICT ANCESTOR of the last attributed
 *                     commit: work landed after the range the reviewer read.
 *   "fresh"           everything else, including the ordinary case where repository HEAD has
 *                     moved far past the verdict through commits belonging to other epics.
 *                     Repository HEAD is deliberately NOT the baseline — an epic archived a
 *                     week after its merge would otherwise read stale through nobody's fault.
 *
 * `uncovered` names the attributed commits the range does not reach, so a refusal can say what
 * is missing rather than only that something is.
 *
 * THE ARCHIVE MOVE IS THE CASE THIS SHAPE EXISTS TO SURVIVE. `/opsx:archive` commits a move of
 * `openspec/changes/<id>/` under `archive/`, and that commit lands AFTER the reviewed range by
 * construction. Attribute it and the last entry becomes a descendant of the recorded `headSha`,
 * the verdict reads stale, and the gate refuses the very `delivered` record the interactive
 * verb is required to accept — the documented workflow blocked by its own last step.
 *
 * The exclusion is AGENT-DECLARED, exactly like the `<!-- pm:lifecycle -->` marker: the emitted
 * instructions say not to attribute the move, and this function classifies nothing. It appends
 * no hash, inspects no commit's contents, and reads no commit message; it compares only the
 * array it was given. Withholding that one append never empties a populated array, so an epic
 * that attributed its delivery commits keeps them and stays fresh.
 */
export function gateStaleness(epic, entry) {
  if (!entry || typeof entry.verdict !== "string") return { state: "none", uncovered: [] };
  const attributed = epic && epic.attributedCommits;
  if (!Array.isArray(attributed)) return { state: "unverifiable", uncovered: [] };
  if (!attributed.length) return { state: "none-attributed", uncovered: [] };
  if (!gateHasEvidence(entry)) return { state: "unverifiable", uncovered: [] };
  const last = attributed[attributed.length - 1];
  if (last === entry.headSha) return { state: "fresh", uncovered: [] };
  const covers = isAncestor(entry.headSha, last);
  if (covers === null) return { state: "unverifiable", uncovered: [] };
  if (covers !== true) return { state: "fresh", uncovered: [] };
  const uncovered = attributed.filter(c => c !== entry.headSha && isAncestor(entry.headSha, c) === true);
  return { state: "stale", uncovered, headSha: entry.headSha };
}

/** The marking a rendered verdict carries, so PROJECT.md, the brief and any refusal describe
 *  the same verdict the same way. Exported for render.mjs and briefing.mjs, which import it
 *  from here rather than re-deriving staleness of their own. */
export function stalenessMarking(epic, entry) {
  switch (gateStaleness(epic, entry).state) {
    case "stale": return " ⚠ stale";
    case "unverifiable": return " ⚠ unverifiable";
    case "none-attributed": return " · no attributed commits";
    default: return "";
  }
}

/**
 * The archive transition's gate.
 *
 * Returns a REFUSAL OBJECT and never exits: the caller owns its own exit code, its own stderr,
 * and any cleanup it has to do. A gate that called process.exit() itself would be unusable
 * from the non-interactive paths, which must reflect what disk already says rather than die.
 *
 * @param {object} epic     the epic as it stands BEFORE the transition.
 * @param {object} [request] what the caller is asking for at this transition — the interactive
 *                           verb supplies the agent's disposition here. Empty for now; the
 *                           outcome requirement, the replacement rule, the deferral assertion
 *                           and the handoff demand all land in this parameter.
 * @returns {{ok: true} | {ok: false, message: string}}
 */
export function archiveGate(epic, request = {}) {
  // An ABSENT lane is openspec-lane (isOpenspecLane), so a lane-less epic is held to this
  // gate exactly as a declared one is — it renders as openspec-lane on every surface.
  if (isOpenspecLane(epic)) {
    const gate2 = epic.gateReview && epic.gateReview.gate2;
    if (!gate2 || gate2.verdict !== "pass") {
      return { ok: false, message:
        `cannot archive openspec-lane epic '${epic.id}' — missing a passing Gate 2 ` +
        `(implementation review) verdict. Run 'record-gate-review ${epic.id} --gate 2 ` +
        `--verdict pass' after a real fresh-context implementation review before archiving.` };
    }
    // A passing verdict that does not reach the commits the epic attributed to itself did not
    // review the code that shipped. Only "stale" refuses: an absent array, an empty one and a
    // git that cannot answer are all reported rather than blocked (gateStaleness).
    const staleness = gateStaleness(epic, gate2);
    if (staleness.state === "stale") {
      return { ok: false, message:
        `cannot archive openspec-lane epic '${epic.id}' — its passing Gate 2 reviewed up to ` +
        `${staleness.headSha}, which does not cover the commit(s) attributed to this epic ` +
        `since: ${staleness.uncovered.join(", ")}. Re-review the full range and record it, or ` +
        `correct the attribution.` };
    }
  }

  return { ok: true };
}
