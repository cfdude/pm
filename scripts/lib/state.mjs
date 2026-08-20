// scripts/lib/state.mjs
// state.json load/save — the conductor's single source of record. Depends only on
// lib/constants.mjs.

import fs from "node:fs";
import path from "node:path";
import { recordConflict, clearConflicts } from "./write-conflicts.mjs";
import { CONFLICT_EXIT_CODE } from "./constants.mjs";

// Re-evaluate paths each time they're accessed to support cache-busting tests
function getPaths() {
  const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const CONDUCTOR_DIR = path.join(ROOT, ".conductor");
  const STATE_PATH = path.join(CONDUCTOR_DIR, "state.json");
  return { STATE_PATH, CONDUCTOR_DIR };
}

export function readJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return fallback; }
}

export function readStdin() {
  try { return fs.readFileSync(0, "utf8"); } catch { return ""; }
}

export function isInitialized() {
  const { STATE_PATH } = getPaths();
  return fs.existsSync(STATE_PATH);
}

export function defaultState() {
  return { version: 1, active: null, epics: [], detourStack: [] };
}

/** Thrown when a write would clobber a newer revision than the one this caller read. */
export class StateConflictError extends Error {
  constructor(expected, found) {
    super(`state.json changed under this process (read revision ${expected}, found ${found})`);
    this.name = "StateConflictError";
    this.expected = expected;
    this.found = found;
  }
}

/** The exit code a thrown error should produce, or null to re-throw.
 *
 *  Extracted so the mapping is testable without a hidden self-test subcommand in the shipped
 *  CLI. A conflict is RETRYABLE and every existing validation failure already exits 1, so an
 *  agent that cannot tell them apart cannot decide whether to retry or to fix its command. */
export function conflictExitCode(err) {
  return err instanceof StateConflictError ? CONFLICT_EXIT_CODE : null;
}

/** Read the revision currently on disk without parsing the whole state twice at the call site. */
function diskRevision() {
  const { STATE_PATH } = getPaths();
  const s = readJSON(STATE_PATH, null);
  return s && typeof s === "object" && Number.isInteger(s.revision) ? s.revision : 0;
}

export function loadState() {
  const { STATE_PATH } = getPaths();
  const s = readJSON(STATE_PATH, null);
  const base = s && typeof s === "object" ? { ...defaultState(), ...s } : defaultState();
  // Absent means 0, which is what lets a state.json written by 0.25.2 load unchanged and take
  // revision 1 on its first write. No migration is needed for that reason.
  base.revision = Number.isInteger(base.revision) ? base.revision : 0;
  return base;
}

/** Atomic write with an optimistic revision check.
 *
 *  The tmp-file + rename(2) below already guaranteed the WRITE was atomic — a crash never left
 *  a torn state.json. What was unguarded was the read-modify-write CYCLE: two processes that
 *  both loaded the same revision each wrote back wholesale, and the second silently discarded
 *  the first one's change. A lockfile was rejected because a session killed mid-write leaves
 *  the lock held forever; a revision comparison leaves nothing behind.
 *
 *  opts.onConflict "throw" (default) is for interactive verbs: a human or agent is present and
 *  can re-read and re-apply. "skip" is for HOOK writes — render.mjs's and commitNudge()'s own
 *  reconcileArchived() self-heals — that re-run on the next hook, so losing either costs
 *  nothing, while hard-failing would turn an invisible race into a visible mid-session error for
 *  a write that did not matter.
 */
export function saveState(state, opts = {}) {
  const { onConflict = "throw", verb = "unknown" } = opts;
  const { STATE_PATH, CONDUCTOR_DIR } = getPaths();
  fs.mkdirSync(CONDUCTOR_DIR, { recursive: true });

  const expected = Number.isInteger(state.revision) ? state.revision : 0;
  const found = diskRevision();
  // --force is the deliberate "I know, overwrite it" escape hatch. It is read from argv rather
  // than threaded through 24 call sites, which is the same shape as platformFlag() in
  // conductor.mjs. Without an escape hatch people learn to hand-edit state.json to get around
  // the guard, which is strictly worse than a documented override.
  const forced = process.argv.includes("--force");
  if (found !== expected && !forced) {
    if (onConflict === "skip") {
      recordConflict({ verb, expected, found });
      return { ok: false, expected, found, verb };
    }
    throw new StateConflictError(expected, found);
  }

  // A no-op save must be a NO-OP. Bumping the revision for a write that changes nothing breaks
  // byte-idempotence — two existing tests assert `upgrade` run twice leaves state.json
  // identical — and rewrites a file for no reason, which is the same pointless-churn class the
  // tracker already complains about elsewhere. Compare with `revision` excluded from both sides,
  // since that is the only field this function itself introduces.
  const { revision: _cur, ...currentBody } = readJSON(STATE_PATH, {}) || {};
  const { revision: _next, ...nextBody } = { ...state };
  if (JSON.stringify(currentBody) === JSON.stringify(nextBody)) {
    return { ok: true, revision: found, unchanged: true };
  }

  // Math.max(found, expected), not just expected: with --force, `expected` is the forcing
  // writer's STALE value, and a plain `expected + 1` can land BELOW what's already on disk
  // (found). That reopens the exact lost-update window this guard exists to close, just one
  // hop removed: a third writer who loaded the post-`found` state now sees its own `expected`
  // equal the forced write's (too-low) new revision, the guard passes, and the forced write's
  // change is the one silently discarded. Always advance strictly past whichever of the two is
  // higher so a forced write can never rewind the revision counter.
  const next = { ...state, revision: Math.max(found, expected) + 1 };
  const data = JSON.stringify(next, null, 2) + "\n";
  const tmpPath = `${STATE_PATH}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, data);
  fs.renameSync(tmpPath, STATE_PATH);
  state.revision = next.revision;   // keep the caller's object usable for a subsequent save
  clearConflicts();   // consecutive skips end at the first success
  return { ok: true, revision: next.revision };
}
