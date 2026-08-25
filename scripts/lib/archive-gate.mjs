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
import { LIFECYCLE_MARKER, epicProgress, outstandingWork } from "./epic-progress.mjs";
import { KNOWN_OUTCOMES, agentDisposition, dispositionError, isEngineStamped, outcomeOf } from "./disposition.mjs";

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
/** The outcomes an AGENT may choose. `unknown` is excluded deliberately: it records that
 *  nobody was asked, and an agent running the verb was asked — choosing "I don't know" over a
 *  real disposition is exactly the silence this release removes. */
export const AGENT_OUTCOMES = KNOWN_OUTCOMES.filter(o => o !== "unknown");

export function archiveGate(epic, request = {}) {
  // The interactive verb must name how the work ended. Every OTHER archive path — the
  // archive-drift heal, the archive backfill and the two archived-at-creation paths — supplies
  // no disposition and never reaches this function; each stamps `unknown` with its own
  // `recordedBy` instead, because there is nobody on those paths to ask.
  const { outcome, reason } = request;
  if (outcome === undefined) {
    return { ok: false, message:
      `cannot archive '${epic.id}' — no outcome recorded. Pass --outcome ` +
      `<${AGENT_OUTCOMES.join("|")}> (and --reason "<why>" for anything but delivered), so ` +
      `the record says how this work ended rather than only that it stopped.` };
  }
  if (!AGENT_OUTCOMES.includes(outcome)) {
    return { ok: false, message:
      `cannot archive '${epic.id}' — --outcome '${outcome}' is not one of ` +
      `${AGENT_OUTCOMES.join("|")}. 'unknown' records that nobody was asked, and running this ` +
      `verb means somebody was.` };
  }
  const invalid = dispositionError({ outcome, reason });
  if (invalid) return { ok: false, message: `cannot archive '${epic.id}' — ${invalid}` };

  // REPLACEMENT, and its refusal. An agent's disposition replaces an ENGINE-stamped one —
  // outcome, reason and timestamp together — because a disposition nobody chose is exactly what
  // an agent is entitled to answer. It is REFUSED against another agent's record, which would
  // destroy a durable judgment somebody made.
  //
  // This rule runs OPPOSITE to its two neighbours and must not be generalized from them: the
  // heal may not overwrite an existing `gate2`, and the migration may not overwrite an existing
  // `disposition`. Both are engine paths overwriting an agent's work. This is an agent
  // correcting a record the engine wrote because nobody was asked — and without it every
  // migration-stamped archived epic is frozen at `unknown` forever.
  const existing = epic.disposition;
  if (existing && !isEngineStamped(existing)) {
    return { ok: false, message:
      `cannot archive '${epic.id}' — it already carries an agent-recorded outcome ` +
      `'${outcomeOf(epic)}'${existing.recordedAt ? `, recorded ${existing.recordedAt}` : ""}. ` +
      `Replacing it would destroy a judgment somebody made; correcting a mistaken disposition ` +
      `is not something this verb does.` };
  }

  // The DEFERRAL ASSERTION. The engine has not identified this change's deferrals and cannot,
  // so this refusal names the MISSING ASSERTION and never a list — a message naming specific
  // deferrals would require exactly the prose scanner this design rules out, and shipping it
  // would make the guard's message a guess.
  if (!epic.deferralAssertion && !request.deferralAssertion) {
    return { ok: false, message:
      `cannot archive '${epic.id}' — no deferral assertion recorded. Say what this change ` +
      `deferred: --deferral "<epicId>:<artifact section>" for work now held by a registered ` +
      `epic, --declined-deferral "<what>:<why not>" for one you are deliberately not doing, ` +
      `or --no-deferrals if there are none. What was deferred is yours to identify; this ` +
      `command does not read your artifacts and will not guess.` };
  }

  // openspec-lane epics may not be archived without a passing Gate 2 (implementation review)
  // verdict — see CLAUDE.md "OpenSpec build — TWO mandatory gates" and recordGateReview().
  // Gate 1 (spec review) gates code, which already happened earlier in the workflow; only
  // Gate 2 blocks archiving. Non-openspec-lane epics are completely unaffected.
  // An ABSENT lane is openspec-lane (isOpenspecLane), so a lane-less epic is held to this
  // gate exactly as a declared one is — it renders as openspec-lane on every surface.
  //
  // The Gate 2 demand binds `delivered` ONLY. A change that is killed, superseded or abandoned
  // has no passing Gate 2 and never will — the code was never written, or was written and
  // thrown away — so demanding one would make those dispositions recordable only by fabricating
  // a verdict or hand-editing state.json, which are the two failures this release exists to
  // end. For those outcomes the reason the disposition already requires substitutes for the
  // verdict, and the archive proceeds.
  if (isOpenspecLane(epic) && outcome === "delivered") {
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

  // The HANDOFF. Binds `delivered` only, for the same reason the Gate 2 demand does: killed,
  // superseded and abandoned already carry a required reason that answers where the work went,
  // and a change killed with every task outstanding by construction would otherwise be refused
  // the exact archive this release exists to make recordable.
  //
  // Keyed on outstandingWork(), never raw checkboxes: a change's own task list carries the task
  // instructing the agent to archive it, unticked at archive time by construction, so a guard
  // counting raw checkbox state would demand a handoff for every fully delivered change.
  if (outcome === "delivered" && !request.carriedTo) {
    const summary = outstandingSummary(epic);
    if (summary.outstanding > 0) {
      return { ok: false, message:
        `cannot archive '${epic.id}' as delivered — ${summary.outstanding} of ` +
        `${summary.claimed} task(s) outstanding. Either record where the work went with ` +
        `--carried-to <epicId> --reason "<which tasks moved>", or — if the outstanding item ` +
        `is lifecycle bookkeeping rather than delivery — declare it in the task source by ` +
        `putting the literal ${LIFECYCLE_MARKER} on that task's own line. Naming a receiver ` +
        `for work nobody carried anywhere is a fabricated record.` };
    }
  }

  return { ok: true,
    disposition: agentDisposition({ outcome, reason, carriedTo: request.carriedTo }),
    deferralAssertion: request.deferralAssertion };
}
