// scripts/lib/write-conflicts.mjs
// The conflict sidecar for hook writes that were skipped rather than applied.
//
// WHY A SIDECAR. The count cannot live in state.json — that is the file whose write just
// failed, so recording the failure there would require the very write that is failing. This
// log is APPEND-ONLY and therefore needs no guard of its own: no reader-modifier-writer, no
// lock, nothing that can be lost to the race it exists to record.

import { ARTIFACT, clearConflictsOn, recordConflictOn, storeOps } from "./store.mjs";

// NO PATHS ARE DERIVED HERE ANY MORE (0.48.0 task 1.4). Every operation below is a store
// operation keyed on a LOGICAL artifact name, so the root keeps being re-evaluated per call for the
// reason it always was — the root is the INVOCATION's, and this module runs on a hook's failure
// path, the one place a stale root would write the diagnostic into the wrong repository and leave
// the real one silent — except that re-evaluation now happens inside the store.
//
// THE WRITE ITSELF LIVES IN store.mjs (`recordConflictOn`), and the direction of that edge is
// deliberate rather than tidy: `writeRecord()` must record a conflict from INSIDE its own write
// section, and a module the store imported in order to do that would put a cycle on the seam's own
// edge. The policy below — the latch, the count, and what "consume" means — stays HERE, because it
// is policy about an EPISODE rather than a write to an artifact.

export function recordConflict({ verb, expected, found }) {
  // Diagnostics must NEVER break the hook they are diagnosing. Every operation here is guarded:
  // this runs on a hook's failure path, so an exception converts the harmless skip we deliberately
  // chose into the visible error we deliberately avoided — and it would fire exactly when the
  // filesystem is already in trouble.
  recordConflictOn(storeOps(), { verb, expected, found });
}

/** Consecutive skips since the last successful write. Counting lines is fine here — this is
 *  read only by the briefing, not on the write path, and the file is capped at 8 KB. */
export function conflictCount() {
  const read = storeOps().read(ARTIFACT.WRITE_CONFLICTS_LOG);
  if (read.kind !== "ok") return 0;
  return read.text.split("\n").filter(Boolean).length;
}

/** Called after ANY successful state write. The signal of interest is CONSECUTIVE skips, not
 *  skips ever — without this reset a single contended afternoon would warn forever.
 *
 *  Also called from INSIDE store.mjs's own writeRecord() on the success path, which is why the
 *  body lives there as `clearConflictsOn(store)` and this is a delegation rather than a second
 *  copy: two implementations of "the episode ended" would be two chances to disagree. */
export function clearConflicts() {
  clearConflictsOn(storeOps());
}

/** Has this episode of contention already been warned about? The warning is delivered once per
 *  EPISODE, not once per crossing of the threshold: `conflictCount()` is SAMPLED (read only when
 *  a briefing is composed), so the count is whatever the burst left behind by the time anyone
 *  looks. See consumeConflictWarning() for why the latch is a file rather than a lower count. */
export function conflictWarningLatched() {
  return storeOps().exists(ARTIFACT.WRITE_CONFLICTS_LATCH);
}

/** Consume the warning for this EPISODE: nothing about the log moves, and the evidence stays at
 *  the path the warning just named.
 *
 *  Called when the briefing SURFACES the threshold warning. Without this, `conflictCount()`
 *  stays at or above the threshold once contention stops — nothing else clears it, because
 *  clearConflicts() only runs on a successful state write and render() only writes when
 *  reconcileArchived() has something to heal. The brief runs every SessionStart, so the
 *  warning would re-fire every session for a problem that resolved days ago.
 *
 *  Sets a LATCH rather than touching the log. Suppressing the repeat by lowering the count —
 *  rotating the log away — cannot work: it destroys the very path the warning tells the reader
 *  to open, and it re-arms the threshold, so a run of contention that continues climbs back
 *  through it and warns again. The latch says "this episode has been reported"; only
 *  clearConflicts(), on a successful state write, ends the episode. */
export function consumeConflictWarning() {
  try {
    storeOps().write(ARTIFACT.WRITE_CONFLICTS_LATCH, `${new Date().toISOString()}\n`);
  } catch { /* observability only — never fail the run being observed */ }
}
