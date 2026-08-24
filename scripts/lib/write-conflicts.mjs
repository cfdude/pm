// scripts/lib/write-conflicts.mjs
// The conflict sidecar for hook writes that were skipped rather than applied.
//
// WHY A SIDECAR. The count cannot live in state.json — that is the file whose write just
// failed, so recording the failure there would require the very write that is failing. This
// log is APPEND-ONLY and therefore needs no guard of its own: no reader-modifier-writer, no
// lock, nothing that can be lost to the race it exists to record.

import fs from "node:fs";
import path from "node:path";
import { CONFLICT_LOG_MAX_BYTES } from "./constants.mjs";

// Re-evaluate paths each time they're accessed to support cache-busting tests
function getPaths() {
  const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const CONDUCTOR_DIR = path.join(ROOT, ".conductor");
  const WRITE_CONFLICTS_LOG = path.join(CONDUCTOR_DIR, "write-conflicts.log");
  // The latch marker lives BESIDE the log, never in state.json — that is the file whose write
  // just failed, which is the whole reason this module exists.
  const WRITE_CONFLICTS_LATCH = path.join(CONDUCTOR_DIR, "write-conflicts.latch");
  return { CONDUCTOR_DIR, WRITE_CONFLICTS_LOG, WRITE_CONFLICTS_LATCH };
}

/** Rotate when the file exceeds the cap. Deliberately SIZE-triggered and wholesale:
 *  statSync is O(1) and rename(2) is O(1), so this never reads the log body. A count cap
 *  ("keep the last N") would require reading, filtering and rewriting on every trip — a
 *  read-modify-write on the path that exists to record a failed read-modify-write. */
function rotateIfNeeded() {
  const { WRITE_CONFLICTS_LOG } = getPaths();
  let size = 0;
  try { size = fs.statSync(WRITE_CONFLICTS_LOG).size; } catch { return; }
  if (size <= CONFLICT_LOG_MAX_BYTES) return;
  try { fs.renameSync(WRITE_CONFLICTS_LOG, `${WRITE_CONFLICTS_LOG}.prev`); } catch { /* best effort */ }
}

export function recordConflict({ verb, expected, found }) {
  // Diagnostics must NEVER break the hook they are diagnosing. Every filesystem call here is
  // guarded, mkdirSync included: this runs on a hook's failure path, so an exception converts
  // the harmless skip we deliberately chose into the visible error we deliberately avoided —
  // and it would fire exactly when the filesystem is already in trouble.
  try {
    const { CONDUCTOR_DIR, WRITE_CONFLICTS_LOG } = getPaths();
    fs.mkdirSync(CONDUCTOR_DIR, { recursive: true });
    rotateIfNeeded();
    const line = `${new Date().toISOString()}\t${verb}\t${expected}\t${found}\n`;
    fs.appendFileSync(WRITE_CONFLICTS_LOG, line);
  } catch { /* observability only — never fail the run being observed */ }
}

/** Consecutive skips since the last successful write. Counting lines is fine here — this is
 *  read only by the briefing, not on the write path, and the file is capped at 8 KB. */
export function conflictCount() {
  const { WRITE_CONFLICTS_LOG } = getPaths();
  try {
    return fs.readFileSync(WRITE_CONFLICTS_LOG, "utf8").split("\n").filter(Boolean).length;
  } catch { return 0; }
}

/** Called after ANY successful state write. The signal of interest is CONSECUTIVE skips, not
 *  skips ever — without this reset a single contended afternoon would warn forever. */
export function clearConflicts() {
  const { WRITE_CONFLICTS_LOG, WRITE_CONFLICTS_LATCH } = getPaths();
  try { fs.rmSync(WRITE_CONFLICTS_LOG, { force: true }); } catch { /* best effort */ }
  // The latch goes with the log: a successful write ends the episode, so the NEXT run of
  // contention must be able to warn again. Leaving the latch behind would silence it forever.
  try { fs.rmSync(WRITE_CONFLICTS_LATCH, { force: true }); } catch { /* best effort */ }
}

/** Has this episode of contention already been warned about? The warning is delivered once per
 *  EPISODE, not once per crossing of the threshold: `conflictCount()` is SAMPLED (read only when
 *  a briefing is composed), so the count is whatever the burst left behind by the time anyone
 *  looks. See consumeConflictWarning() for why the latch is a file rather than a lower count. */
export function conflictWarningLatched() {
  const { WRITE_CONFLICTS_LATCH } = getPaths();
  try { return fs.existsSync(WRITE_CONFLICTS_LATCH); } catch { return false; }
}

/** Consume the warning condition: the count resets, the evidence survives.
 *
 *  Called when the briefing SURFACES the threshold warning. Without this, `conflictCount()`
 *  stays pinned at the threshold once contention stops — nothing else clears it, because
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
    const { CONDUCTOR_DIR, WRITE_CONFLICTS_LATCH } = getPaths();
    fs.mkdirSync(CONDUCTOR_DIR, { recursive: true });
    fs.writeFileSync(WRITE_CONFLICTS_LATCH, `${new Date().toISOString()}\n`);
  } catch { /* observability only — never fail the run being observed */ }
}
