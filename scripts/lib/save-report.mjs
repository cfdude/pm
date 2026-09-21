// scripts/lib/save-report.mjs
// THE one place a verb's outcome line is chosen from the save's own answer to "did anything
// change". Zero dependencies — it imports nothing, so every module may call it.
//
// WHY IT IS A FUNCTION AND NOT A RULE WRITTEN DOWN. `epic-annotation`'s "a write that changes
// nothing says so" binds THE WRITE SURFACE and not an enumerated list of paths, and it shipped at
// exactly one verb: `update-epic` kept saveState()'s return, and twenty-odd sibling verbs threw it
// away and printed an unconditional success line. Four of them were EXECUTED by a Gate 2 reviewer
// and confirmed reporting success on a save that wrote nothing. A fix that edited those four would
// have reproduced, inside the fix, the defect required task item 1 exists to catch.
//
// So the rule is INVERTED into a shape a later verb inherits by default: a call site must CAPTURE
// saveState()'s return and hand it here, and `scripts/test/save-report-surface.test.mjs` scans the
// shipped source for a site that does neither. A verb that genuinely cannot reach a no-op — or that
// prints no outcome line at all — says so at the call site with
// `// save-report: exempt — <reason>`, which is the per-verb judgement the finding asked for, in a
// form the scan can read.
//
// SCOPE OF THE WORD "NOTHING". saveState()'s `unchanged` means `.conductor/state.json` was not
// rewritten. Most verbs call render() (PROJECT.md) and several call writeRules() (CLAUDE.md) after
// it, and those CAN change while state does not — so an `unchanged` line for such a verb names the
// state file rather than claiming the invocation did nothing at all.
import { errStream } from "./invocation.mjs";

/** Print the outcome of a save from the save's OWN answer, never from an assumption.
 *
 *  `saved` is saveState()'s return. A hook write that skipped on conflict returns
 *  `{ok: false, …}` and carries no `unchanged`, so it reports the CHANGED line — correct, because
 *  a skipped write is a lost write, not a no-op, and the hook sites that produce one print nothing
 *  here anyway.
 *
 *  Returns whether the save was a no-op, so a caller can suppress follow-on detail that would
 *  otherwise describe a write that did not happen. */
export function reportSave(saved, { changed, unchanged, stream = errStream(), quiet = false } = {}) {
  const noop = !!(saved && saved.unchanged);
  const line = noop ? unchanged : changed;
  if (!quiet && line) stream.write(line.endsWith("\n") ? line : `${line}\n`);
  return noop;
}

/** The shared tail for a verb whose save changed nothing but whose RENDERED surfaces were
 *  rewritten anyway. Kept here so twenty verbs cannot come to describe one situation twenty ways,
 *  and so the distinction between "state.json is unchanged" and "the invocation did nothing" is
 *  made in one place rather than re-decided per call site. */
export const STATE_UNCHANGED = "nothing was written to .conductor/state.json";
