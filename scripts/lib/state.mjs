// scripts/lib/state.mjs
// state.json load/save — the conductor's single source of record, and the sink every epic
// creation routes through. Depends only on lib/constants.mjs, lib/store.mjs and
// lib/disposition.mjs (all leaf modules — none of them imports state.mjs back).
//
// 0.48.0 (task 1.2) MOVED THE PERSISTENCE OUT AND LEFT THE NAMES. Everything below that reads or
// writes the record now asks the INVOCATION for its store (`storeOps()` in lib/store.mjs) instead
// of reaching `getPaths()` — the strict read, the lock, the temp-file write, the fsync before the
// rename, the directory fsync and the read-back all live in the DISK store now, and an in-memory
// store answers the same questions with the same normalisation and no flushes at all.
//
// WHY THE NAMES STAY, and why the 137 call sites of `loadState()`/`saveState()` are not edited.
// The seam is CENTRAL precisely so they need not be: `getPaths()` had exactly one caller — this
// module — and the 137 sites reached the record through it, not through a path of their own. A
// signature change would have been a rewrite of twenty verb bodies, which is a different and much
// larger change than the one this is (design D1's "bodies are otherwise untouched"). What changed
// is where this module's I/O comes FROM.

import fs from "node:fs";
import { claimArtifacts } from "./source-artifacts.mjs";
import { isArchiveBackfilled } from "./disposition.mjs";
import { STORABLE_EPIC_ID, escapeControls } from "./constants.mjs";
import { stdinSource } from "./invocation.mjs";
import {
  StateConflictError, StatePersistError, StateUnreadableError,
  breakStaleLock, breakStaleLockAt, conflictExitCode, defaultState, inspectLock, isStaleLock,
  lockContent, lockHolderAlive, persistFailure, revisionOfText, sameLock, shapeProblem, storeOps,
  TIMEKEEPING_FIELDS, unreadableStateMessage, ARTIFACT,
} from "./store.mjs";

// RE-EXPORTED, so every existing importer of these from state.mjs is unchanged: `refusal.mjs`
// (conflictExitCode, StateUnreadableError, unreadableStateMessage), `rules.mjs` and
// `activity-report.mjs` and `gate-guard.mjs` (StateUnreadableError), `commit-watch.mjs` (the five
// lock primitives), and the tests that catch StatePersistError / StateConflictError by name.
export {
  StateConflictError, StatePersistError, StateUnreadableError,
  breakStaleLock, breakStaleLockAt, conflictExitCode, defaultState, inspectLock, isStaleLock,
  lockContent, lockHolderAlive, persistFailure, revisionOfText, sameLock, shapeProblem, storeOps,
  TIMEKEEPING_FIELDS, unreadableStateMessage,
};

export function readJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return fallback; }
}

/** Drain the INVOCATION's standard input.
 *
 *  It read fd 0 directly until 0.47.0 (task 3.4). The four callers are all hook payloads —
 *  gate-guard, lesson-advice, the refused-hook-line drain in conductor.mjs and add-many's `--from -`
 *  — and a caller that supplied its own input has to see its payload used rather than whatever is
 *  on the process's fd 0. The default (`stdinSource()` over the real process) keeps reading fd 0,
 *  and keeps doing it SYNCHRONOUSLY: touching `process.stdin` to read instead opens a stream on
 *  fd 0 that makes the drain read nothing and leaves the hook writer holding an EPIPE. */
export function readStdin() {
  try { return stdinSource().read(); } catch { return ""; }
}

/** Is there a record at all? ASKS THE STORE, so a memory store answers "yes" for a record it was
 *  seeded with and "no" for one it was not — the same question, asked of the same seam.
 *
 *  VIA `hasRecord()`, NOT via a read. It used to be `fs.existsSync(STATE_PATH)` and it must stay an
 *  existence question: this is called on nearly every dispatch, and a store implementation that
 *  answered it by reading the body would change what a process OBSERVES, not merely what it costs.
 *  Found the hard way — the functional half's commit-nudge conflict test intercepts the first read
 *  of state.json to manufacture a race, and this predicate ate the interception. */
export function isInitialized() {
  return storeOps().hasRecord();
}

/** The strict reader for the record: `{kind: "absent"}`, `{kind: "ok", state}` or
 *  `{kind: "unreadable", reason}`. loadState() and the write path both go through it, which is the
 *  whole point: an unreadable file used to read as revision 0 on BOTH sides of the revision
 *  guard, so the guard passed and a default record was written over it.
 *
 *  readJSON() above keeps its swallow on purpose — its other callers read files whose absence or
 *  damage is legitimately "no value" (the render stamp, plugin metadata). Only THIS file is a record
 *  that must never be guessed at. `ENOTDIR` is absence too, matching isInitialized(). */
export function readStateFile() {
  return storeOps().readRecord();
}

export function loadState() {
  const store = storeOps();
  const read = store.readRecord();
  if (read.kind === "unreadable") {
    throw new StateUnreadableError(store.resolve("state.json") || ".conductor/state.json", read.reason);
  }
  const s = read.kind === "ok" ? read.state : null;
  const base = s ? { ...defaultState(), ...s } : defaultState();
  // Absent means 0, which is what lets a state.json written by 0.25.2 load unchanged and take
  // revision 1 on its first write. No migration is needed for that reason.
  base.revision = Number.isInteger(base.revision) ? base.revision : 0;
  return base;
}

/** THE sink every epic creation routes through, and the ONE site the "an epic created after
 *  this capability carries `attributedCommits`, initialized empty" rule is bound to.
 *
 *  It is a function and not a convention on purpose. The rule was previously written out at
 *  each construction site, and the enumeration went stale exactly as
 *  docs/lessons/bind-rules-to-functions-not-enumerations predicts: `add-epic` and `add-many`
 *  carried it, `sync`'s two registration paths did not, and neither consumer complained —
 *  absent is FORGIVEN by the staleness gate and invisible to the integrity check, so the
 *  omission hid behind the one case the gate is required to forgive. A sixth creation path
 *  now cannot omit the array without routing around this function, and a source scan in
 *  scripts/test/conductor-13.test.mjs forbids that.
 *
 *  The ONE exemption is derived, not passed: an epic carrying the `archive-backfill` engine
 *  stamp genuinely predates commit attribution, so its array must stay ABSENT — absent means
 *  "unverifiable", which is the truth about a change archived before the conductor held it.
 *  Keyed on that token specifically and never on "has an engine stamp": the two
 *  archived-at-creation paths in `add-epic` and `add-many` carry their own distinct tokens and
 *  must still get `[]`.
 *
 *  Anything already carrying the key is left exactly as given — the migration must never
 *  back-fill the array onto a pre-existing epic, and this function is not a back-fill either.
 *
 *  It also clears any sync-ignore tombstone on a source artifact the new epic claims: claiming
 *  an artifact says it is real work, which contradicts a tombstone saying it is not, and the
 *  record must not hold two opposite claims about one file. Done HERE for the same reason the
 *  array is — `add-epic`, `add-many` and `sync` are three construction sites, and a rule
 *  written out at each of them is a stale enumeration waiting for a fourth. `update-epic` does
 *  not route through here and calls claimArtifacts() itself; those two are the only ways an
 *  epic comes to claim an artifact. NOTE the body below is kept tight on purpose — a source
 *  scan in conductor-13 allows the raw push only within a few lines of this signature. */
export function pushEpic(state, epic) {
  if (!STORABLE_EPIC_ID(epic.id)) throw new InvalidEpicIdError(epic.id);
  seedCreationFields(epic);
  claimArtifacts(state, epic);
  state.epics.push(epic);
  return epic;
}

/** The fields every epic owes AT CREATION, seeded in one place so pushEpic()'s body stays the
 *  handful of lines conductor-13's source scan allows the raw array append to sit within — the
 *  scan matches on the literal call, so this sentence deliberately does not spell it. Called from
 *  pushEpic() and nowhere else: the sink is still the sink, and this is only where its seeding is
 *  spelled out.
 *
 *  `createdAt` binds here for exactly the reason the array does, and the enumeration history above
 *  is the argument rather than a preference. It takes NO exemption, not even the archive
 *  backfill's: registration records when PM LEARNED OF THE WORK and not how old the work is, so a
 *  change archived long ago and registered today is correctly stamped today. Reaching back for the
 *  epics that predate the field is the recovery verb's job, and it can only fill an ABSENT date.
 *
 *  Both guards are ABSENCE guards, so anything already carrying the key is left exactly as given —
 *  which is what lets the recovery, or a caller replaying a record, route through here without
 *  being re-dated. */
function seedCreationFields(epic) {
  if (!Object.prototype.hasOwnProperty.call(epic, "attributedCommits") && !isArchiveBackfilled(epic)) {
    epic.attributedCommits = [];
  }
  if (!Object.prototype.hasOwnProperty.call(epic, "createdAt")) {
    epic.createdAt = new Date().toISOString();
  }
}

/** pushEpic()'s refusal of an id no epic may carry (a control character or whitespace). Carries the
 *  raw id; its message escapes it. Every caller checks STORABLE_EPIC_ID first, so reaching this is a
 *  creation path that skipped the check — loud by design. */
export class InvalidEpicIdError extends Error {
  constructor(id) {
    super(`epic id '${escapeControls(String(id))}' holds a control character or whitespace — it cannot be stored`);
    this.name = "InvalidEpicIdError";
    this.id = id;
  }
}

/** Atomic, serialised write with an optimistic revision check — now a THIN DELEGATION to the store
 *  the invocation supplied, which is where every one of the invariants this comment used to
 *  describe is implemented (lib/store.mjs, `diskStore().writeRecord`).
 *
 *  The disk store's section is unchanged in every respect that matters: the tmp-file + rename
 *  guarantees the WRITE is atomic; the temp file is fsynced before the rename so its data is
 *  ordered ahead of it; the revision comparison detects a writer whose load predates another's
 *  save and the lock makes the strict read, the comparison, the no-op comparison, the write, the
 *  rename and the read-back ONE critical section; `--force` bypasses only the comparison, never the
 *  lock; `opts.onConflict` "skip" is the HOOK policy (render.mjs's and commitNudge()'s own
 *  reconcileArchived() self-heals, which re-run on the next hook) and "throw" is for interactive
 *  verbs. The in-memory store reproduces the comparisons and the normalisation and drops the
 *  durability — a different sink, never a weaker engine. */
export function saveState(state, opts = {}) {
  const result = storeOps().writeRecord(state, opts);
  if (result && result.ok && !result.unchanged) recordEngineSave(result.revision);
  return result;
}

/** Stamp the engine's OWN save onto the render stamp as `lastSave: {revision, mtimeMs}` — the
 *  baseline `verify-state` compares a later mtime against (code review 0.43.0 C2, branch review).
 *  Without it, a revision ahead of the render could only be TRUSTED (blind to a hand-edit made after
 *  a non-rendering save) or DISTRUSTED (the false "hand-edit" after every claim). The render fields
 *  (`renderedAt`, `stateRevision`, `stateMtimeMs`) are untouched, so the stamp still says what
 *  PROJECT.md was rendered from. Only when a stamp exists — before the first render there is no
 *  baseline to extend. Observability: it never breaks the save it records. */
function recordEngineSave(revision) {
  try {
    const store = storeOps();
    const read = store.read(ARTIFACT.RENDER_STAMP);
    if (read.kind !== "ok" || !Number.isInteger(revision)) return;
    const stamp = JSON.parse(read.text);
    if (!stamp || typeof stamp !== "object") return;
    stamp.lastSave = { revision, mtimeMs: store.mtimeMs(ARTIFACT.RECORD) };
    store.write(ARTIFACT.RENDER_STAMP, JSON.stringify(stamp, null, 2) + "\n");
  } catch { /* the save already landed; a missed stamp reads as "cannot rule out", never as clean */ }
}
