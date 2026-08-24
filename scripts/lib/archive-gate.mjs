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
  // openspec-lane epics may not be archived without a passing Gate 2 (implementation review)
  // verdict — see CLAUDE.md "OpenSpec build — TWO mandatory gates" and recordGateReview().
  // Gate 1 (spec review) gates code, which already happened earlier in the workflow; only
  // Gate 2 blocks archiving. Non-openspec-lane epics are completely unaffected.
  if (epic.lane === "openspec") {
    const gate2 = epic.gateReview && epic.gateReview.gate2;
    if (!gate2 || gate2.verdict !== "pass") {
      return { ok: false, message:
        `cannot archive openspec-lane epic '${epic.id}' — missing a passing Gate 2 ` +
        `(implementation review) verdict. Run 'record-gate-review ${epic.id} --gate 2 ` +
        `--verdict pass' after a real fresh-context implementation review before archiving.` };
    }
  }
  return { ok: true };
}
