// scripts/lib/unconsidered.mjs
// The DISPATCHED half of the unconsidered-outcome walker.
//
// `unconsideredOutcomes()` lives in archive-gate.mjs, which may import constants.mjs,
// epic-progress.mjs, disposition.mjs and git.mjs AND NOTHING ELSE — `state.mjs` is not on that
// list, so the walker cannot load a repository's record itself. This module is the seam: it
// reads state and asks the walker, and the walker stays a pure function of an epics array that
// the suite can drive against a constructed fixture.
//
// WHY A VERB AT ALL. `epic-disposition/spec.md` says an agent ASKS the engine which archived
// epics ended with an outcome nobody considered. Shipping the enumeration as a library export
// with no consumer outside tests would ship an answer nobody can ask for.
//
// WHY NOT AN INTEGRITY CHECK — the other candidate surface, and it was declined on evidence
// rather than taste: conductor-15 asserts the archived `integrity-day-one.md` names the epic of
// every finding integrity reports, so registering this population there would require writing
// ~66 epic ids into a closed change's document.

import { unconsideredOutcomes } from "./archive-gate.mjs";
import { recordedByOf } from "./disposition.mjs";
import { jsonText } from "./constants.mjs";
import { isInitialized, loadState } from "./state.mjs";
import { die } from "./command-exit.mjs";

/** READ-ONLY. Prints the archived epics whose outcome nobody considered, each with the exact
 *  invocation that would record one — machine-readable, because the caller is an agent that is
 *  about to run those invocations. */
export function unconsideredOutcomesReport() {
  if (!isInitialized()) { die("conductor: run /pm:init first\n"); }
  const state = loadState();
  const rows = unconsideredOutcomes(state.epics || []);
  process.stdout.write(jsonText({
    count: rows.length,
    unconsidered: rows.map(({ epic, invocation, deliveredBlockedBy }) => ({
      id: epic.id,
      title: epic.title || epic.id,
      lane: epic.lane || "openspec",
      // WHO stamped it, carried through rather than summarised: "the migration wrote this" and
      // "the archive-drift heal wrote this" are different histories, and an agent deciding what
      // an epic's outcome WAS needs to know which one it is looking at. Read through
      // disposition.mjs's own reader, never off the field — the suite's source scan fails a
      // direct read, because that is how a second definition of "engine-stamped" starts.
      recordedBy: recordedByOf(epic),
      recordedAt: (epic.disposition && epic.disposition.recordedAt) || null,
      invocation,
      // What blocks `delivered` for this epic, each `{kind, detail, remedy}` — always present, `[]`
      // when nothing does. The invocation above omits `delivered` exactly when this is non-empty
      // (gh-189: 12 of 20 openspec-lane entries were refused when `delivered` was substituted).
      deliveredBlockedBy,
    })),
  }, null, 2) + "\n");
}
