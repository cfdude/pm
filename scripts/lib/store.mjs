// scripts/lib/store.mjs
// THE STORE SEAM (0.48.0, design D1). The engine's persistence, reachable ONLY through a store the
// CURRENT INVOCATION supplies — the same dependency-injection move `git-gateway.mjs` made for git
// in 0.47.0, and for the same reason: a verb's DECISION and its PERSISTENCE are separable, and a
// test whose subject is a decision should not pay for a power-loss guarantee it does not need.
//
// WHY IT EXISTS, MEASURED. The assertion half performs 12,524 `fsyncSync` calls per run, and with
// `fs.fsyncSync` replaced by a no-op the SAME 1,243 tests pass in 12.2 s against 73.2 s
// (`baseline-before.md`, tasks 0.3(c)/(d)). A state load is sub-millisecond; a render is 0.55 ms.
// The half's cost is the durability term `saveState()` pays on every write — the fsync of the temp
// file before its rename and the fsync of the directory after it — paid by a test that reads a
// value back out of an object.
//
// TWO IMPLEMENTATIONS, ONE INTERFACE.
//
//   * `diskStore()` is what the COMMAND LINE builds, and it is `saveState()`'s behaviour moved
//     rather than rewritten: the strict read before the revision comparison, `--force` read from
//     `currentArgv()`, the lock, the temp-file write, the fsync before the rename, the directory
//     fsync, the read-back. Every byte it writes is the byte the engine wrote before this seam
//     existed — `engine-invocation`'s "The store the command line builds writes the record the
//     command line has always written" is a requirement, not a hope, and task 1.8 checks it.
//
//   * `memoryStore()` keeps the record in an object. It is NOT a weaker engine and it is not a
//     test-only mode bolted on: it reproduces the SAME normalisation the disk LOAD applies — the
//     strict read's shape check, the `defaultState()` merge, the integer coercion of `revision` —
//     and the SAME comparisons the disk WRITE applies — the revision comparison, the no-op
//     comparison, `--force`. What it does NOT reproduce is durability: no lock, no temp file, no
//     fsync, no read-back, because there is no file to lose. A memory store that skipped the shape
//     check would let a unit test assert a record shape a real disk load refuses (design D2's
//     hazard, I6); a memory store that skipped the revision comparison would let one assert
//     behaviour no real invocation has.
//
// THE OWNERSHIP TABLE, DERIVED FROM THE WRITE SITES AND NOT TYPED FROM MEMORY (design D1). What
// the store OWNS: `.conductor/state.json`, `PROJECT.md`, `.conductor/render-stamp.json`,
// `.conductor/detours.log`, `.conductor/write-conflicts.log` + its `.latch` + its `.prev`,
// `.conductor/honcho-memories.log`, `.conductor/activity/*`, `.conductor/brief.txt`,
// `.conductor/session-claim.json`.
//
// WHAT IT DELIBERATELY DOES NOT OWN, each with its reason rather than by omission (I1):
//
//   * `CLAUDE.md` and its managed rules block — written by `rules.mjs`. It is a REPOSITORY file the
//     engine writes into the repository, not into the conductor record; widening the store to
//     include it re-opens the boundary this module exists to close, and the 251 tests that observe
//     it are genuinely integration-shaped.
//   * `.gitignore` line management (`platform.mjs`) — same argument: a repository file, not a record.
//   * `.changesets/` — a repository directory this engine READS and never writes.
//   * `.conductor/commit-observe.json` and its `.lock` (`commit-watch.mjs:191`, `:223`, `:242-243`)
//     — the commit hook's observation record is written under an exclusive-create lock whose
//     IDENTITY is an inode and a nonce, and broken by a stale-age rule that reads the file's mtime.
//     A lock is a filesystem primitive with no in-memory meaning: there is nothing for a memory
//     store to take, nothing for it to break, and a record that cannot be locked cannot be written
//     safely by the two hooks that race for it. The record and its lock are also useless apart —
//     the anchor without the lock that serialises its update is a lost-update waiting to happen.
//   * `.conductor/state.json.lock` and its `.break` sibling — the disk store's own lock, held and
//     released INSIDE `writeRecord()`. It is the mechanism by which the disk store is atomic, not
//     an artifact of the record; a memory store has no section to serialise.
//   * every READ of the repository the engine performs rather than writes (openspec `tasks.md`
//     checkboxes, `docs/lessons/`, plugin metadata).
//
// Depends on Node built-ins and two leaves: `constants.mjs` (the path functions, which are
// themselves functions of the invocation) and `invocation.mjs`. It imports NEITHER `state.mjs` nor
// `write-conflicts.mjs`, so the direction of every edge is one way: those two depend on this one.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CONFLICT_EXIT_CODE, CONFLICT_LOG_MAX_BYTES, STATE_LOCK_POLL_MS, STATE_LOCK_STALE_MS, STATE_LOCK_WAIT_MS,
  briefPath, conductorDir, detoursLog, engineRoot, escapeControls, projectMd,
  renderStampPath, statePath, writeConflictsLog,
} from "./constants.mjs";
import { currentArgv, currentCwd, currentEnv, installedInvocation, invocation } from "./invocation.mjs";

// ─────────────────────────────── the artifact names ───────────────────────────────
//
// A LOGICAL name, not a path: a memory store has no paths, and a caller that named one would make
// the seam a filesystem by another route. The disk store resolves each of these through
// constants.mjs — the ONE place the record directory's layout is spelled — so a path added there
// cannot be written here from memory.

export const ARTIFACT = Object.freeze({
  RECORD: "state.json",
  RENDER_STAMP: "render-stamp.json",
  DETOURS_LOG: "detours.log",
  WRITE_CONFLICTS_LOG: "write-conflicts.log",
  WRITE_CONFLICTS_LATCH: "write-conflicts.latch",
  HONCHO_MEMORIES_LOG: "honcho-memories.log",
  BRIEF: "brief.txt",
  SESSION_CLAIM: "session-claim.json",
  PROJECT_MD: "PROJECT.md",
  /** The PREFIX of the activity segments, not a directory the caller lists by this name: a segment
   *  is `activity/<segment-name>` and the store treats the whole string as one artifact name, so a
   *  memory store holds segments under the same keys a disk store holds them at. */
  ACTIVITY_PREFIX: "activity/",
});

/** The one artifact that lives at the repository ROOT rather than under `.conductor/`. Named here
 *  because the disk implementation would otherwise have to special-case it twice. */
const ROOT_ARTIFACTS = new Set([ARTIFACT.PROJECT_MD]);

// ─────────────────────────────── errors ───────────────────────────────
//
// DECLARED HERE rather than in state.mjs, because the store is what throws them and state.mjs now
// depends on this module rather than the other way round. state.mjs re-exports every one of them,
// so every existing importer — `refusal.mjs`, `rules.mjs`, the functional tests that catch them by
// `name` — is unchanged.

/** Thrown when a write would clobber a newer revision than the one this caller read. */
export class StateConflictError extends Error {
  constructor(expected, found, message) {
    // `message` is for the two conflicts that are not a newer revision — a lock held past the wait,
    // and a lock this writer no longer owns at its rename. Same class, so they share the conflict
    // exit code: both are "someone else is writing; retry", and neither wrote anything.
    super(message || `state.json changed under this process (read revision ${expected}, found ${found})`);
    this.name = "StateConflictError";
    this.expected = expected;
    this.found = found;
  }
}

/** Thrown when `.conductor/state.json` is PRESENT and cannot be read as a record
 *  (state-file-refuses-to-guess). Never thrown for an ABSENT file: absence is dormancy before
 *  `/pm:init`, and `init`'s own first save.
 *
 *  A distinct class from StateConflictError, because the response differs again: a conflict is
 *  retryable, and this is not — a human has to fix the file, and re-running cannot help. */
export class StateUnreadableError extends Error {
  constructor(filePath, reason) {
    super(`${STATE_DISPLAY_PATH} cannot be read — ${reason}`);
    this.name = "StateUnreadableError";
    this.path = filePath;
    this.reason = reason;
  }
}

/** Thrown when a write REPORTED SUCCESS and the value is not on disk afterwards.
 *
 *  A distinct class from StateConflictError, because they call for opposite responses: a
 *  conflict is retryable and expected, and this is neither. */
export class StatePersistError extends Error {
  constructor(reason, verb) {
    super(`state.json write reported success but did not persist (verb: ${verb}) — ${reason}`);
    this.name = "StatePersistError";
    this.reason = reason;
    this.verb = verb;
  }
}

/** The path every refusal names. Always this, relative to the project root, because STATE_PATH is
 *  always `<root>/.conductor/state.json` and every remedy below is a command run from that root. */
export const STATE_DISPLAY_PATH = ".conductor/state.json";

/** The whole refusal, as the top-level catch prints it (design D2). Every remedy is a SHELL command:
 *  gate-guard blocks the editing tools while the file is unreadable, and since the-guard-covers-every-
 *  write-path it is matched for Bash too — so what keeps these remedies runnable is no longer that the
 *  hook misses Bash, but an explicit carve-out: over an UNREADABLE record an affirmed Bash call
 *  CARRYING A COMMAND is allowed whatever its shape. That carve-out exists for the `git show …> …`
 *  line below, which is itself a recognized write shape, and for the `mv`. A remedy that needed an
 *  edit tool would still be a wedge. The untracked remedy is not decoration:
 *  a repository `init`'d and damaged before its first commit has nothing for git to restore, and
 *  `init` itself refuses while the damaged file is in place. */
export function unreadableStateMessage(err) {
  return `conductor: ${err.message}. Nothing was written.\n` +
    `  If a merge left conflict markers:  git checkout --ours ${STATE_DISPLAY_PATH}   (or --theirs)\n` +
    `  If the markers were committed:     git show <good-rev>:${STATE_DISPLAY_PATH} > ${STATE_DISPLAY_PATH}\n` +
    `  To discard local damage:           git restore ${STATE_DISPLAY_PATH}\n` +
    `  Never committed (git has no copy): mv ${STATE_DISPLAY_PATH} ${STATE_DISPLAY_PATH}.damaged\n` +
    "                                     then /pm:init   (the damaged bytes are kept beside it)\n" +
    "  Then re-run the command.\n";
}

/** Why a post-write read-back is a failure, or `null` when it is not.
 *
 *  Extracted rather than inlined so every branch is testable without a hidden self-test
 *  subcommand in the shipped CLI — the same reason conflictExitCode() below is a function.
 *
 *  The NEWER-revision branch is what makes an otherwise-noisy guard usable. Two writers
 *  interleave routinely here (a hook-driven render, a second agent): A renames, B loads and
 *  writes, A reads back B's bytes. A's write landed and was legitimately superseded, and calling
 *  that "your write did not persist" would turn a benign race into an error — precisely the
 *  outcome saveState's `onConflict: "skip"` policy exists to avoid. Only a mismatch at the
 *  revision this write itself just published means the bytes never arrived. */
export function persistFailure({ expectedBytes, diskBytes, expectedRevision, diskRevision }) {
  if (diskBytes === expectedBytes) return null;
  if (Number.isInteger(diskRevision) && Number.isInteger(expectedRevision) && diskRevision > expectedRevision) {
    return null;
  }
  if (diskBytes === null || diskBytes === undefined) {
    return "the file could not be read back at all";
  }
  return `the file on disk does not match what was written at revision ${expectedRevision} ` +
    `(disk revision ${diskRevision === null || diskRevision === undefined ? "unreadable" : diskRevision})`;
}

/** The exit code a thrown error should produce, or null to re-throw.
 *
 *  Extracted so the mapping is testable without a hidden self-test subcommand in the shipped
 *  CLI. A conflict is RETRYABLE and every existing validation failure already exits 1, so an
 *  agent that cannot tell them apart cannot decide whether to retry or to fix its command. */
export function conflictExitCode(err) {
  return err instanceof StateConflictError ? CONFLICT_EXIT_CODE : null;
}

/** Why a parsed state value has the WRONG SHAPE, or null. Exactly the four rules the
 *  state-write-guard requirement names, and nothing else (design D1): each is a shape that makes a
 *  reader crash (`state.epics.find is not a function`) or makes a save discard data. A non-integer
 *  `revision` is NOT one — it reads as 0 on both sides and loses nothing — and neither is an unknown
 *  key: state.json grows keys every release, and an older engine must load a newer file's superset. */
export function shapeProblem(s) {
  if (!s || typeof s !== "object" || Array.isArray(s)) return "its top-level value is not a JSON object";
  if (Object.prototype.hasOwnProperty.call(s, "epics")) {
    if (!Array.isArray(s.epics)) return "its `epics` member is present and is not an array";
    const bad = s.epics.findIndex(e => !e || typeof e !== "object" || Array.isArray(e));
    if (bad !== -1) return `its \`epics\` member holds an element that is not a JSON object (index ${bad})`;
  }
  if (Object.prototype.hasOwnProperty.call(s, "detourStack") && !Array.isArray(s.detourStack)) {
    return "its `detourStack` member is present and is not an array";
  }
  return null;
}

/** The `revision` a state.json TEXT carries, or null when the text is missing or unparseable. */
export function revisionOfText(text) {
  if (typeof text !== "string") return null;
  try {
    const s = JSON.parse(text);
    return s && typeof s === "object" && Number.isInteger(s.revision) ? s.revision : null;
  } catch { return null; }
}

export function defaultState() {
  return { version: 1, active: null, epics: [], detourStack: [] };
}

/** The normalisation BOTH implementations apply to whatever they hold, so a unit test can never
 *  assert a record shape a real disk load refuses (I6). */
function normalizeRecord(s) {
  const base = s ? { ...defaultState(), ...s } : defaultState();
  // Absent means 0, which is what lets a state.json written by 0.25.2 load unchanged and take
  // revision 1 on its first write. No migration is needed for that reason.
  base.revision = Number.isInteger(base.revision) ? base.revision : 0;
  return base;
}

// ─────────────────────────── timekeeping + touched-stamp ───────────────────────────

/** The fields excluded from the PER-RECORD comparison in stampTouched(), and the exclusion is the
 *  same shape as `revision`'s from the whole-body comparison: a field a mechanism introduces must
 *  not be an input to that mechanism's own decision.
 *
 *  Without it, any write that populates `createdAt` makes every record it fills differ from its
 *  disk pre-image, so the touch stamp fires on all of them — and that is not hypothetical.
 *  `upgrade()` applies every pending migration to ONE in-memory state and calls saveState ONCE, so
 *  the 0.40.0 recovery sweeping an entire archive would record every epic in every repository as
 *  last touched on upgrade day. A record whose only delta is a recovered registration date is a
 *  RECOVERY, not a touch — on upgrade day, and equally on any later day the standalone recovery
 *  verb is re-run, which is the same write. */
/** EXPORTED because it is a POPULATION, not a detail: gh#181 requires every engine-written
 *  timekeeping field to declare in EPIC_FLAGS whether it can be cleared and why, and the check
 *  that enforces that has to derive its population from here rather than transcribe one. */
export const TIMEKEEPING_FIELDS = ["createdAt", "touchedAt"];

/** A record's comparable content: everything except the two timekeeping fields. */
function comparableEpic(epic) {
  const rest = { ...epic };
  for (const k of TIMEKEEPING_FIELDS) delete rest[k];
  return JSON.stringify(rest);
}

/** Advance `touchedAt` on exactly the epics whose stored content differs from the disk pre-image.
 *
 *  Called ONLY after the identity comparison has already decided this save is not a no-op, and
 *  that ordering IS the mechanism. `nextBody` is compared whole with `revision` as its only
 *  exclusion, so a stamp applied BEFORE it makes every save differ from disk unconditionally, the
 *  short-circuit never fires, and byte-idempotence breaks for every verb — three shipped tests
 *  assert it (conductor-02:40, conductor-15:107, conductor-01:80). Stamping per CALLER is the only
 *  other shape and it is infeasible across the engine's 31 saveState call sites, which is the same enumeration
 *  argument pushEpic() above is bound by.
 *
 *  Records are matched BY ID and never by position: remove-epic filters the array, so every record
 *  after a removed one shifts index and an index-matched comparison would report the lot as
 *  changed.
 *
 *  A record with no pre-image is NEW and is stamped — which is also what makes a first save right,
 *  since an absent state file yields no pre-image at all and every epic correctly gets
 *  `createdAt == touchedAt`. A record carrying no usable id is stamped for a different reason: we
 *  cannot tell whether it changed, and "not touched" would be an assertion nothing measured. */
function stampTouched(state, diskBody) {
  const at = new Date().toISOString();
  const preImage = new Map();
  for (const e of Array.isArray(diskBody.epics) ? diskBody.epics : []) {
    if (e && typeof e === "object" && typeof e.id === "string" && !preImage.has(e.id)) {
      preImage.set(e.id, comparableEpic(e));
    }
  }
  for (const e of Array.isArray(state.epics) ? state.epics : []) {
    if (!e || typeof e !== "object") continue;
    const before = typeof e.id === "string" ? preImage.get(e.id) : undefined;
    if (before !== undefined && before === comparableEpic(e)) continue;
    e.touchedAt = at;
  }
}

// ─────────────────────────── the write-conflict sidecar's line ───────────────────────────
//
// THE WRITE MOVES HERE rather than staying in write-conflicts.mjs, and one line of direction is the
// whole reason: `saveState()` must record a conflict from INSIDE its write section, and a module
// the store imports in order to record one would put a cycle on the seam's own edge.
// write-conflicts.mjs DELEGATES to this for the write and keeps the latch, the count and the
// consume semantics, which are policy about an episode rather than a write to an artifact. The
// shape below is that module's, moved verbatim: size-triggered wholesale rotation, then an append,
// every step guarded, because this runs on a hook's FAILURE path where an exception would convert
// the harmless skip it records into the visible error it exists to avoid.

/** Rotate when the file exceeds the cap. Deliberately SIZE-triggered and wholesale: statSync is
 *  O(1) and rename(2) is O(1), so this never reads the log body. A count cap ("keep the last N")
 *  would require reading, filtering and rewriting on every trip — a read-modify-write on the path
 *  that exists to record a failed read-modify-write. */
export function rotateWriteConflictsLog(store) {
  let size;
  try { size = store.size(ARTIFACT.WRITE_CONFLICTS_LOG); } catch { return; }
  if (size <= CONFLICT_LOG_MAX_BYTES) return;
  try { store.rotate(ARTIFACT.WRITE_CONFLICTS_LOG); } catch { /* best effort */ }
}

/** Append one conflict line. Never throws. */
export function recordConflictOn(store, { verb, expected, found }) {
  try {
    rotateWriteConflictsLog(store);
    store.append(ARTIFACT.WRITE_CONFLICTS_LOG, `${new Date().toISOString()}\t${verb}\t${expected}\t${found}\n`);
  } catch { /* observability only — never fail the run being observed */ }
}

// ─────────────────────────────── the state lock (design D4) ───────────────────────────────
//
// WHY A LOCK, REVERSING 0.26.0. 0.26.0 rejected a lock file because "a session killed mid-write
// leaves the lock held forever" and relied on the revision comparison alone. Measured on 0.43.0,
// that is not enough: the comparison and the rename are separate system calls, so two writers can
// both pass it — 16 parallel `add-epic`, three runs, 9/9/8 reported success against 7/6/6 epics on
// disk, and one run published the same revision twice. The objection is answered by the stale rule
// (a lock whose holder is confirmed dead, or older than STATE_LOCK_STALE_MS, is broken); the
// revision guard STAYS, because the lock serialises the section while the revision still detects a
// writer whose LOAD predates another's save.
//
// Identity of a lock is its inode AND its nonce: inode numbers are reused after unlink on some
// filesystems, and two locks with the same recorded fields are otherwise indistinguishable.
//
// IT LIVES HERE AND NOT IN state.mjs because the lock is the DISK store's private mechanism — it is
// taken and released inside `diskStore().writeRecord()` and nothing outside that section needs one.
// `commit-watch.mjs` takes its own lock with the same primitives, which is why they are exported.
// A memory store takes none: there is no section to serialise and nothing to lose.

function lockPaths(root) {
  const STATE_PATH = statePath(root);
  return { LOCK: `${STATE_PATH}.lock`, BREAK: `${STATE_PATH}.lock.break` };
}

/** This process's pid namespace where the platform exposes one (Linux), otherwise null. Two
 *  processes whose `host` and `pidns` both match can judge each other's liveness by pid. */
function pidNamespace() {
  try { return fs.readlinkSync("/proc/self/ns/pid"); } catch { return null; }
}

/** A synchronous sleep with no busy loop and no dependency. */
function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** The lock currently at `lockPath`, read through ONE descriptor so its inode and its content
 *  belong to the same file: `{ino, mtimeMs, content, nonce}` — `content` null when it does not
 *  parse (a holder between its create and its write) — or null when there is no lock. */
export function inspectLock(lockPath) {
  // LSTAT BEFORE OPEN. A lock this engine creates is always a regular file (an exclusive create
  // never follows or makes a symlink), so anything else at the path — a FIFO, a symlink to
  // anything, a directory — is judged from lstat and NEVER opened: opening a FIFO for reading
  // blocks until something opens it for writing, which hung every save with no time limit
  // (Gate 2 re-review). The open below adds O_NONBLOCK and O_NOFOLLOW for the path swapped
  // between this lstat and that open.
  let pre;
  try { pre = fs.lstatSync(lockPath); } catch { return null; }
  if (!pre.isFile()) return lstatLock(lockPath);
  let fd;
  try { fd = fs.openSync(lockPath, NONBLOCKING_READ); } catch { return lstatLock(lockPath); }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return lstatLock(lockPath);
    let content = null;
    try {
      const parsed = JSON.parse(fs.readFileSync(fd, "utf8"));
      content = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch { content = null; }
    return { ino: st.ino, mtimeMs: st.mtimeMs, content,
      nonce: content && typeof content.nonce === "string" ? content.nonce : null };
  } catch { return null; } finally { try { fs.closeSync(fd); } catch { /* already closed */ } }
}

const NONBLOCKING_READ = fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0) | (fs.constants.O_NOFOLLOW || 0);

/** A lock path that EXISTS but cannot be read as a lock file — mode 000, a symlink (dangling or
 *  not), a directory, a FIFO — judged from lstat alone: its identity is its inode with no nonce, its age its own
 *  mtime. Null only when nothing is at the path. Without this, "exists" (the exclusive create's
 *  EEXIST) and "no lock" (the failed open) disagreed, and the acquire loop spun at full CPU. */
function lstatLock(lockPath) {
  try {
    const st = fs.lstatSync(lockPath);
    return { ino: st.ino, mtimeMs: st.mtimeMs, content: null, nonce: null, unreadable: true,
      kind: st.isDirectory() ? "directory" : (st.isSymbolicLink() ? "symlink" : (st.isFile() ? "file" : "other")) };
  } catch { return null; }
}

export const sameLock = (a, b) => !!a && !!b && a.ino === b.ino && a.nonce === b.nonce;

/** The content a lock holder writes: who holds it, where, since when, and a nonce that makes its
 *  identity unique. Shared by the state lock and the commit hook's observation lock
 *  (commit-watch.mjs), so both are judged by the same liveness rule. */
export function lockContent() {
  return {
    pid: process.pid, host: os.hostname(), pidns: pidNamespace(),
    acquiredAt: new Date().toISOString(), nonce: crypto.randomBytes(16).toString("hex"),
  };
}

/** Is this lock's holder CONFIRMED alive (true), CONFIRMED dead (false), or not confirmable (null)?
 *  Confirmable only where the checker shares the holder's host AND pid namespace; ESRCH is dead and
 *  EPERM means the process exists. */
export function lockHolderAlive(info) {
  const c = info && info.content;
  if (!c || !Number.isInteger(c.pid) || c.pid <= 0) return null;
  if (c.host !== os.hostname() || c.pidns !== pidNamespace()) return null;
  try { process.kill(c.pid, 0); return true; }
  catch (e) { return e && e.code === "ESRCH" ? false : null; }
}

/** Is this lock STALE — safe for a breaker to remove? (design D4)
 *
 *  AGE is the backstop and applies whatever the lock records, including when its content cannot be
 *  read: older than STATE_LOCK_STALE_MS, or dated that far in the FUTURE (a backward clock step must
 *  not wedge the lock). LIVENESS is only an accelerator, and only where the checker can confirm it
 *  shares the holder's host AND pid namespace: a container reusing the host name sees a live
 *  holder's pid as absent, so a different (or unconfirmable) namespace is judged by age alone.
 *  ESRCH is dead; EPERM means the process exists. A holder between its create and its write has
 *  unparseable content and a fresh mtime, so it is young and not stale. */
export function isStaleLock(info, now = Date.now()) {
  if (!info) return false;
  if (Math.abs(now - info.mtimeMs) > STATE_LOCK_STALE_MS) return true;
  return lockHolderAlive(info) === false;
}

/** Remove `judged` — the very lock a caller found stale — and nothing else. Returns whether it
 *  removed it.
 *
 *  SERIALISED by `state.json.lock.break`, created exclusively: at most one process breaks locks at a
 *  time. While holding it the breaker RE-JUDGES the lock currently at the path and unlinks it only if
 *  it is still the judged identity (inode AND nonce) and still stale. That closes the Gate 1
 *  interleaving: B judges L stale; A breaks L and takes N; B cannot act until A has released the
 *  break file, and on re-judging finds N — another identity, fresh, its holder alive — so B removes
 *  nothing. No path renames a lock away, so the lock path is never empty while a holder is mid-save.
 *
 *  The break file is itself recoverable by age: one older than STATE_LOCK_STALE_MS is unlinked if
 *  its inode is still the one just stat'ed, and the caller goes back to waiting. */
export function breakStaleLock(judged, root = engineRoot()) {
  return tryBreakStaleLock(judged, lockPaths(root)).removed;
}

/** breakStaleLock() for ANOTHER lock: the same serialised, re-judging break, at `LOCK` with its own
 *  `BREAK` sibling, judged by `isStale`, with the break file itself recoverable after `staleMs`. The
 *  commit hook's observation lock uses it (commit-watch.mjs, Gate 2 G2-I3). */
export function breakStaleLockAt(judged, { LOCK, BREAK, isStale, staleMs }) {
  return tryBreakStaleLock(judged, { LOCK, BREAK, isStale, staleMs }).removed;
}

/** breakStaleLock()'s body, also reporting an OBSTACLE: a path past the stale age that the engine
 *  cannot remove (a directory at the lock or the break path). The acquire loop refuses on one at
 *  once, naming it — waiting cannot help, and the age rule would otherwise judge it forever. */
function tryBreakStaleLock(judged, at) {
  const { LOCK, BREAK } = at;
  const isStale = at.isStale || isStaleLock;
  const staleMs = at.staleMs || STATE_LOCK_STALE_MS;
  let bfd;
  try { bfd = fs.openSync(BREAK, "wx"); } catch (e) {
    if (!e || e.code !== "EEXIST") return { removed: false };
    try {
      const st = fs.lstatSync(BREAK);
      if (Math.abs(Date.now() - st.mtimeMs) > staleMs && fs.lstatSync(BREAK).ino === st.ino) {
        try { fs.unlinkSync(BREAK); }
        catch (u) { if (u && u.code !== "ENOENT") return { removed: false, obstacle: { path: BREAK, directory: st.isDirectory() } }; }
      }
    } catch { /* gone already */ }
    return { removed: false };
  }
  let breakIno = null;
  try { breakIno = fs.fstatSync(bfd).ino; } catch { /* unknown: released by age */ } finally { fs.closeSync(bfd); }
  try {
    const current = inspectLock(LOCK);
    if (!sameLock(current, judged) || !isStale(current)) return { removed: false };
    try { fs.unlinkSync(LOCK); return { removed: true }; }
    catch (u) {
      return u && u.code === "ENOENT" ? { removed: false }
        : { removed: false, obstacle: { path: LOCK, directory: current.kind === "directory" } };
    }
  } finally {
    try { if (breakIno !== null && fs.lstatSync(BREAK).ino === breakIno) fs.unlinkSync(BREAK); } catch { /* gone */ }
  }
}

/** The refusal for a lock this save could not take — naming the path, the stale age, and the shell
 *  command that removes it, because while a reconcile is owed the editing tools are blocked. The
 *  gate guard matches Bash now, but this remedy STAYS RUNNABLE: its `rm` is keyed on the record's own
 *  path (or a trailing `*` on it), never on a longer literal filename beneath it, and this message
 *  always prints the LITERAL lock path rather than a glob. */
function lockRefusalMessage(lock, expected) {
  const shown = path.relative(currentEnv().CLAUDE_PROJECT_DIR || currentCwd(), lock.path) || lock.path;
  const directory = lock.directory || (lock.holder && lock.holder.kind === "directory");
  const rm = `${directory ? "rm -r" : "rm"} ${shown}`;
  const stale = STATE_LOCK_STALE_MS / 1000;
  if (lock.breakHeld) {
    const bShown = path.relative(currentEnv().CLAUDE_PROJECT_DIR || currentCwd(), lock.breakHeld.path) || lock.breakHeld.path;
    return `state.json's lock at ${shown} is stale, but it could not be broken within ${STATE_LOCK_WAIT_MS} ms ` +
      `because ${bShown} is held — by another save breaking it, or by one that died; nothing was written ` +
      `(read revision ${expected}). A break file older than ${stale} s is recovered automatically; if no pm ` +
      `command is running, remove it with \`${lock.breakHeld.directory ? "rm -r" : "rm"} ${bShown}\` and re-run the command.`;
  }
  if (lock.blocked) {
    return `state.json's lock cannot be taken: ${shown} is ${directory ? "a directory" : "a path"} older than ` +
      `${stale} s that the engine cannot remove; nothing was written (read revision ${expected}). ` +
      `Remove it with \`${rm}\`, then re-run the command.`;
  }
  return `state.json is locked at ${shown} (${describeHolder(lock.holder)}) and was not released within ` +
    `${STATE_LOCK_WAIT_MS} ms; nothing was written (read revision ${expected}). A lock older than ${stale} s ` +
    `is broken automatically by the next save; if no pm command is running, remove it with \`${rm}\` and ` +
    "re-run the command.";
}

/** How a lock's recorded holder reads in a refusal. */
function describeHolder(info) {
  const c = info && info.content;
  if (!c) return info && info.kind && info.kind !== "file"
    ? `not a lock file at all — a ${info.kind}` : "a writer whose lock content could not be read";
  const parts = [];
  if (Number.isInteger(c.pid)) parts.push(`pid ${c.pid}`);
  if (typeof c.host === "string") parts.push(`on host ${escapeControls(c.host)}`);
  if (typeof c.acquiredAt === "string") parts.push(`since ${escapeControls(c.acquiredAt)}`);
  return parts.length ? parts.join(" ") : "a writer whose lock records no pid or host";
}

/** Create the lock exclusively and write its content. `{ino, nonce}` when acquired, or
 *  `{timedOut: true, holder}` when a holder that is not stale did not release it within
 *  STATE_LOCK_WAIT_MS. A stale lock is broken on the way (isStaleLock, breakStaleLock). */
function acquireStateLock(root) {
  const { LOCK } = lockPaths(root);
  const deadline = Date.now() + STATE_LOCK_WAIT_MS;
  for (;;) {
    let fd;
    try { fd = fs.openSync(LOCK, "wx"); } catch (e) {
      if (!e || e.code !== "EEXIST") throw e;
      // EVERY path below either makes progress (a lock that vanished, a lock broken) or reaches
      // the deadline and the sleep. A `continue` that skipped both spun at full CPU forever on a
      // lock path that exists but cannot be read (Gate 2 C1).
      if (Date.now() >= deadline) {
        const holder = inspectLock(LOCK);
        // A STALE lock that is still here at the deadline was not broken because the break path is
        // held — by another breaker, or by one that died. Name that path, not the dead holder.
        let breakHeld = null;
        if (holder && isStaleLock(holder)) {
          try { breakHeld = { path: lockPaths(root).BREAK, directory: fs.lstatSync(lockPaths(root).BREAK).isDirectory() }; }
          catch { breakHeld = null; }
        }
        return { timedOut: true, holder, path: LOCK, breakHeld };
      }
      const held = inspectLock(LOCK);
      if (held === null) continue;                     // released between the create and the look
      // A stale lock is broken — serialised, and only the very lock judged — then the create is
      // retried. A break that did not happen (another breaker, or the lock is no longer the one
      // judged) falls through to waiting like any held lock — unless what stands in the way can
      // never be removed, which waiting cannot fix.
      if (isStaleLock(held)) {
        const broke = tryBreakStaleLock(held, lockPaths(root));
        if (broke.removed) continue;
        if (broke.obstacle) return { blocked: true, holder: held, ...broke.obstacle };
      }
      sleepMs(STATE_LOCK_POLL_MS);
      continue;
    }
    const content = lockContent();
    const nonce = content.nonce;
    let ino = null;
    try {
      ino = fs.fstatSync(fd).ino;
      fs.writeFileSync(fd, JSON.stringify(content));
      return { ino, nonce };
    } catch (e) {
      // The lock was CREATED and its content never written: remove it rather than leave an empty
      // lock every other writer waits out for STATE_LOCK_STALE_MS (Gate 2 I3). Only the file this
      // call created — its inode, when that could be read.
      try { if (ino === null || fs.lstatSync(LOCK).ino === ino) fs.unlinkSync(LOCK); } catch { /* gone */ }
      throw e;
    } finally { fs.closeSync(fd); }
  }
}

/** Unlink the lock ONLY if it is still ours — never a lock another writer created after ours was
 *  removed. Best effort: a release that fails leaves a lock the stale rule recovers. */
function releaseStateLock(lock, root) {
  const { LOCK } = lockPaths(root);
  try { if (sameLock(inspectLock(LOCK), lock)) fs.unlinkSync(LOCK); } catch { /* stale rule recovers */ }
}

// ─────────────────────────────── the DISK store ───────────────────────────────

/** The store the COMMAND LINE builds. Every artifact it touches is a real path under the
 *  invocation's root, and every byte it writes is the byte the engine wrote before the seam.
 *
 *  THE PARAGRAPH ABOVE DELIBERATELY DOES NOT SPELL THE GIT GATEWAY ACCESSOR'S CALL. `certifiedModules()`
 *  in certification.mjs derives the certified set from a source scan for that call, comments
 *  included, so a COMMENT naming it enrolls this module in a set it has no business being in — the
 *  module reaches no gateway and a functional run certifying it would certify nothing. This is a
 *  false POSITIVE in the derivation rather than a hole in it, and the fix is the comment, not the
 *  scan: the scan's whole value is that it cannot be fooled by a module that reaches git by another
 *  name. If you are tempted to restore the token here, run
 *  `node --test scripts/test/assert/drift-script.test.mjs` first and read 6.1.
 *
 *  `ctx` is held rather than a root value, so the paths stay a function of the LIVE invocation —
 *  the same reason `constants.mjs`'s path functions are functions, and the same reason the gateway
 *  ACCESSOR (named in invocation.mjs, and deliberately not spelled here — see the note below)
 *  caches a gateway per context rather than per call. */
export function diskStore(ctx = invocation()) {
  const root = () => engineRoot(ctx);

  /** The real path of a logical artifact name. The ONE place the layout is resolved: everything
   *  under `.conductor/` by name, and PROJECT.md at the repository root. `honcho-memories.log` and
   *  the activity segments reach their constants through this map too, so a path that moved in
   *  constants.mjs could not be remembered here. */
  const pathOf = (name) => {
    if (name === ARTIFACT.RECORD) return statePath(root());
    if (name === ARTIFACT.RENDER_STAMP) return renderStampPath(root());
    if (name === ARTIFACT.DETOURS_LOG) return detoursLog(root());
    if (name === ARTIFACT.WRITE_CONFLICTS_LOG) return writeConflictsLog(root());
    if (name === ARTIFACT.WRITE_CONFLICTS_LATCH) return path.join(conductorDir(root()), "write-conflicts.latch");
    // NO CONSTANT DERIVES THIS ONE — it is built inline in subcommands.mjs today, which is why
    // task 5.1's constants sweep (twelve exported paths) does NOT reach it and why it is spelled
    // out here rather than imported. See 5.1's finding: a sweep that starts from the path
    // constants is a superset of nothing, and this artifact is the instance that proves it.
    if (name === ARTIFACT.HONCHO_MEMORIES_LOG) return path.join(conductorDir(root()), "honcho-memories.log");
    if (name === ARTIFACT.BRIEF) return briefPath(root());
    if (name === ARTIFACT.SESSION_CLAIM) return path.join(conductorDir(root()), "session-claim.json");
    if (name === ARTIFACT.PROJECT_MD) return projectMd(root());
    return path.join(conductorDir(root()), name);   // activity/<segment>
  };

  return {
    kind: "disk",
    root,
    /** The artifact's real path, or null when the store has no path to offer. Named `resolve` and
     *  never `path`: this is the ONE operation a memory store answers with null, and every caller
     *  that needs a path for a reason the store cannot express (a shell remedy in a refusal, a
     *  `verify-state` mtime comparison) has to say so. */
    resolve: (name) => pathOf(name),
    owns: (name) => ROOT_ARTIFACTS.has(name) || !name.startsWith("/"),

    // ── the record ──────────────────────────────────────────────────────────────────────────
    /** DOES A RECORD EXIST — answered WITHOUT reading its body, which is the whole reason this is
     *  its own operation rather than `readRecord().kind !== "absent"`. The difference is not cost:
     *  a caller that merely asks `isInitialized()` must not consume a read of the file, because
     *  another reader may be observing those reads (conductor-12's commit-nudge conflict test
     *  intercepts the FIRST read of state.json to reproduce a race, and an `existsSync` that had
     *  become a `readFileSync` ate that one interception and hid the race the test exists to
     *  create). `ENOTDIR` is absence, matching the strict read's own treatment. */
    hasRecord() {
      try { return fs.existsSync(statePath(root())); } catch { return false; }
    },
    readRecord() {
      const p = statePath(root());
      let text;
      try { text = fs.readFileSync(p, "utf8"); }
      catch (e) {
        if (e && (e.code === "ENOENT" || e.code === "ENOTDIR")) return { kind: "absent" };
        return { kind: "unreadable", reason: `it could not be read (${escapeControls((e && (e.code || e.message)) || e)})` };
      }
      let s;
      try { s = JSON.parse(text); }
      catch (e) { return { kind: "unreadable", reason: `it does not parse as JSON (${escapeControls(e.message)})` }; }
      const shape = shapeProblem(s);
      return shape ? { kind: "unreadable", reason: shape } : { kind: "ok", state: s };
    },
    /** The identity of the record the store currently holds, for a consumer that cannot read a
     *  path (render's skip-rewrite decision, task 1.3). The REVISION is that identity for both
     *  implementations, and it is a faithful one: `writeRecord()` advances it on every save that
     *  changes content and returns early without writing when nothing changed, so "the revision
     *  moved" and "the record was written" are the same statement. Null when there is no record. */
    recordIdentity() {
      const read = this.readRecord();
      if (read.kind !== "ok") return null;
      return Number.isInteger(read.state.revision) ? read.state.revision : 0;
    },
    writeRecord(state, opts = {}) {
      const { onConflict = "throw", verb = "unknown" } = opts;
      const STATE_PATH = statePath(root());
      const CONDUCTOR_DIR = conductorDir(root());
      fs.mkdirSync(CONDUCTOR_DIR, { recursive: true });
      const expected = Number.isInteger(state.revision) ? state.revision : 0;

      const lock = acquireStateLock(root());
      if (lock.timedOut || lock.blocked) {
        // `found` is the disk revision read WITHOUT the lock, at the timeout — the only reading there
        // is, and the sidecar's contract is a verb and two revisions.
        const peek = this.readRecord();
        if (peek.kind === "unreadable") throw new StateUnreadableError(STATE_PATH, peek.reason);
        const found = peek.kind === "ok" && Number.isInteger(peek.state.revision) ? peek.state.revision : 0;
        if (onConflict === "skip") {
          recordConflictOn(this, { verb, expected, found });
          return { ok: false, expected, found, verb, locked: true };
        }
        throw new StateConflictError(expected, found, lockRefusalMessage(lock, expected));
      }
      try {
        // ONE strict read of the disk file serves the revision comparison AND the no-op comparison
        // below, and it refuses BEFORE --force is consulted. --force overrides a NEWER READABLE
        // revision, whose content the caller can be shown; an unreadable file's content is unknown, and
        // overwriting it discards whatever the other side of a merge held. ABSENT is `{}`: init's first
        // save.
        const disk = this.readRecord();
        if (disk.kind === "unreadable") throw new StateUnreadableError(STATE_PATH, disk.reason);
        const diskBody = disk.kind === "ok" ? disk.state : {};
        const found = Number.isInteger(diskBody.revision) ? diskBody.revision : 0;
        // --force is the deliberate "I know, overwrite it" escape hatch. It is read from argv rather
        // than threaded through 24 call sites, which is the same shape as platformFlag() in
        // conductor.mjs. Without an escape hatch people learn to hand-edit state.json to get around
        // the guard, which is strictly worse than a documented override.
        const forced = currentArgv(ctx).includes("--force");
        if (found !== expected && !forced) {
          if (onConflict === "skip") {
            recordConflictOn(this, { verb, expected, found });
            return { ok: false, expected, found, verb };
          }
          throw new StateConflictError(expected, found);
        }

        // A no-op save must be a NO-OP. Bumping the revision for a write that changes nothing breaks
        // byte-idempotence — two existing tests assert `upgrade` run twice leaves state.json
        // identical — and rewrites a file for no reason, which is the same pointless-churn class the
        // tracker already complains about elsewhere. Compare with `revision` excluded from both sides,
        // since that is the only field this function itself introduces.
        const { revision: _cur, ...currentBody } = diskBody;
        const { revision: _next, ...nextBody } = { ...state };
        if (JSON.stringify(currentBody) === JSON.stringify(nextBody)) {
          return { ok: true, revision: found, unchanged: true };
        }

        // AFTER the early return, never before it — see stampTouched(). `next` below is built from
        // `state` and therefore carries the stamps this mutates in place.
        stampTouched(state, currentBody);

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
        let renamed = false;
        try {
          const tfd = fs.openSync(tmpPath, "w");
          try {
            fs.writeFileSync(tfd, data);
            fs.fsyncSync(tfd);
          } finally { fs.closeSync(tfd); }

          // STILL OURS? Immediately before the rename, because a holder stalled past the stale age can
          // have had its lock broken and taken by another writer. Refused as a conflict, writing nothing.
          if (!sameLock(inspectLock(lockPaths(root()).LOCK), lock)) {
            try { fs.unlinkSync(tmpPath); } catch { /* best effort */ }
            if (onConflict === "skip") {
              recordConflictOn(this, { verb, expected, found });
              return { ok: false, expected, found, verb, locked: true };
            }
            throw new StateConflictError(expected, found,
              "state.json's lock was taken over by another writer before this save could land; nothing was " +
              `written (read revision ${expected}). Retry the command.`);
          }
          fs.renameSync(tmpPath, STATE_PATH);
          renamed = true;
        } finally {
          // A write, fsync, close or rename that throws must not leave the temp file behind (Gate 2 I4).
          // After a successful rename the path no longer exists and there is nothing to remove.
          if (!renamed) { try { fs.unlinkSync(tmpPath); } catch { /* never created, or already removed */ } }
        }
        // Best effort: persist the rename's directory entry where the platform allows an fsync of one.
        try {
          const dfd = fs.openSync(CONDUCTOR_DIR, "r");
          try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); }
        } catch { /* not every platform fsyncs a directory descriptor */ }

        // READ BACK WHAT WE JUST WROTE. #140: `update-epic --attribute-commit` reported success for
        // four commits and the array read `[]` afterwards. This is scoped to the WRITE PATH rather
        // than to that one flag on purpose — "reported success for a write that did not persist" is
        // not a property of a flag, and every verb in this engine ends by calling this function, so a
        // guard bound here covers the twenty-odd of them for one file read. Cost: one readFileSync of
        // a file the OS just wrote and still holds in cache.
        //
        // HONEST SCOPE, because the temptation to overstate it is the whole reason #140 was hard to
        // read: in the filed incident the working tree DID hold all four values afterwards. This does
        // not close that incident, whose loss was at `git commit` time and whose mechanism remains
        // unestablished. It closes the class the engine could not previously distinguish.
        let diskBytes = null;
        try { diskBytes = fs.readFileSync(STATE_PATH, "utf8"); } catch { diskBytes = null; }
        const why = persistFailure({
          expectedBytes: data, diskBytes,
          expectedRevision: next.revision, diskRevision: revisionOfText(diskBytes),
        });
        // THROWN, never skipped, and deliberately not routed through the onConflict policy: a
        // revision conflict has a documented benign reading ("someone else's write superseded a write
        // that did not matter"), and persistFailure() has already handed that reading back as `null`.
        // What is left has no benign reading — the bytes this process wrote are not on disk and
        // nothing newer explains it — and silence there is the defect being fixed.
        if (why) throw new StatePersistError(why, verb);

        state.revision = next.revision;   // keep the caller's object usable for a subsequent save
        clearConflictsOn(this);           // consecutive skips end at the first success
        return { ok: true, revision: next.revision };
      } finally {
        releaseStateLock(lock, root());
      }
    },

    // ── the artifacts the store owns ────────────────────────────────────────────────────────
    exists(name) {
      try { return fs.existsSync(pathOf(name)); } catch { return false; }
    },
    size(name) {
      try { return fs.statSync(pathOf(name)).size; } catch { return 0; }
    },
    mtimeMs(name) {
      try { return fs.statSync(pathOf(name)).mtimeMs; } catch { return null; }
    },
    read(name) {
      try { return { kind: "ok", text: fs.readFileSync(pathOf(name), "utf8") }; }
      catch (e) {
        if (e && (e.code === "ENOENT" || e.code === "ENOTDIR")) return { kind: "absent" };
        return { kind: "unreadable", reason: String((e && (e.code || e.message)) || e) };
      }
    },
    write(name, text) {
      fs.mkdirSync(path.dirname(pathOf(name)), { recursive: true });
      fs.writeFileSync(pathOf(name), text);
    },
    /** A write a concurrent READER must never see half-done: temp file plus rename in the same
     *  directory, so a racer sees the whole old value or the whole new one. Not LOCKED — every
     *  caller of this is an advisory marker that guarded no read-modify-write (claims.mjs D5). */
    writeAtomic(name, text) {
      const p = pathOf(name);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
      fs.writeFileSync(tmp, text);
      fs.renameSync(tmp, p);
    },
    append(name, text) {
      fs.mkdirSync(path.dirname(pathOf(name)), { recursive: true });
      fs.appendFileSync(pathOf(name), text);
    },
    remove(name) {
      fs.rmSync(pathOf(name), { force: true });
    },
    /** The inverse of a write that ACCUMULATES: `x` becomes `x.prev`, wholesale and without
     *  reading the body (see rotateIfNeeded's argument in write-conflicts.mjs, which this serves). */
    rotate(name) {
      fs.renameSync(pathOf(name), `${pathOf(name)}.prev`);
    },
    /** The names of every artifact under `prefix`, sorted. A memory store answers from its own
     *  keys, so a segment name is a key there exactly as it is a filename here. */
    list(prefix) {
      let names;
      try { names = fs.readdirSync(pathOf(prefix)); } catch { return []; }
      return names.filter(n => n !== "." && n !== "..").sort();
    },
  };
}

// ─────────────────────────────── the MEMORY store ───────────────────────────────

/** A deep copy of a seeded value, so two stores built from ONE literal cannot share a record. The
 *  hazard is D5's, one level over: a state object shared between unit tests leaks exactly the way a
 *  shared fixture template does, and it does it silently — the later test passes against the
 *  earlier test's mutation. */
const copy = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** The store the unit rung binds: the record lives in an object, no path exists, nothing is
 *  flushed.
 *
 *  WHAT IT REPRODUCES, deliberately and not optionally: the strict read's shape check (I6), the
 *  `defaultState()` merge, the integer coercion of `revision`, the revision comparison, the no-op
 *  comparison, and `--force`. A unit test that hands in a record must meet the same door a real
 *  load puts up — the alternative is a test asserting a shape the engine refuses, which is the
 *  quiet weakening the seam would otherwise introduce.
 *
 *  WHAT IT DOES NOT: the lock, the temp file, the fsync, the read-back, and the write-conflict
 *  sidecar's line. There is no file to lose and no second writer to serialise against; recording a
 *  "conflict" that no writer could produce would be theatre. `verified` below says so in the value
 *  rather than in a comment, so a caller cannot mistake the returned shape for the disk store's.
 *
 *  `seed` is the record the caller starts from — an OBJECT, which is the whole point of the rung.
 *  It is copied, so the caller's literal is not captured, and `record()` hands back the object the
 *  store holds, so `state.revision` is kept usable across a second save exactly as it is on disk. */
export function memoryStore(seed = undefined) {
  let record = seed === undefined ? undefined : copy(seed);
  const artifacts = new Map();

  /** A DEEP COPY, and this is the one place the memory store's discipline differs from the disk
   *  store's shape. On disk the caller's `loadState()` result and the record the next write reads
   *  share NOTHING — one is an object in memory, the other is re-parsed from the file — and the
   *  revision and no-op comparisons run against the file. Handing out the live object here would
   *  make the caller's copy and the store's record share their nested arrays, so a verb APPENDING
   *  TO THE EPIC LIST would edit the record the comparison then reads and the save would report
   *  ITSELF as a no-op. That is not a theoretical hazard: the first draft of this store did exactly
   *  that and `add-epic` reported "'probe' was already recorded exactly as supplied" while writing
   *  nothing. The copy is what makes the memory store a SINK rather than an alias.
   *
   *  (The sentence above does NOT spell that append as code, and the difference is load-bearing: a
   *  source scan in `scripts/test/functional/conductor-13.test.mjs` refuses a raw epic-list append
   *  anywhere outside `pushEpic()`'s body, COMMENTS INCLUDED, so writing it out here would report
   *  this file as a fifth epic-creation path. Same false positive, same remedy, as the certified-set
   *  note on `diskStore()` above.) */
  /** The bytes a disk store would hold for `name`, or `""` when it holds none. */
  const memoryArtifact = (name) => {
    if (name === ARTIFACT.RECORD) return record === undefined ? "" : JSON.stringify(record, null, 2) + "\n";
    return artifacts.has(name) ? artifacts.get(name) : "";
  };

  const readRecord = () => {
    if (record === undefined) return { kind: "absent" };
    const shape = shapeProblem(record);
    return shape ? { kind: "unreadable", reason: shape } : { kind: "ok", state: copy(record) };
  };

  return {
    kind: "memory",
    /** No path exists, and that is the point — a caller that needs one for a reason the store
     *  cannot express has to say so out loud rather than receive a path that is not real. */
    resolve: () => null,
    owns: () => true,
    hasRecord: () => record !== undefined,
    readRecord,
    /** The record the store HOLDS, for a test that wants to read back what a verb wrote — the
     *  in-memory equivalent of reading `state.json` off disk. */
    record: () => record,
    recordIdentity() {
      const read = readRecord();
      if (read.kind !== "ok") return null;
      return Number.isInteger(read.state.revision) ? read.state.revision : 0;
    },
    writeRecord(state, opts = {}) {
      const { onConflict = "throw" } = opts;
      const expected = Number.isInteger(state.revision) ? state.revision : 0;
      const disk = readRecord();
      if (disk.kind === "unreadable") throw new StateUnreadableError(`<memory>.conductor/${ARTIFACT.RECORD}`, disk.reason);
      const diskBody = disk.kind === "ok" ? disk.state : {};
      const found = Number.isInteger(diskBody.revision) ? diskBody.revision : 0;
      const forced = currentArgv(invocation()).includes("--force");
      if (found !== expected && !forced) {
        if (onConflict === "skip") return { ok: false, expected, found, verb: opts.verb || "unknown" };
        throw new StateConflictError(expected, found);
      }
      const { revision: _cur, ...currentBody } = diskBody;
      const { revision: _next, ...nextBody } = { ...state };
      if (JSON.stringify(currentBody) === JSON.stringify(nextBody)) {
        return { ok: true, revision: found, unchanged: true };
      }
      stampTouched(state, currentBody);
      const next = { ...state, revision: Math.max(found, expected) + 1 };
      // A COPY, for the reason readRecord() gives: the record belongs to the store, and the caller's
      // object stays the caller's. `state.revision` is still kept usable for a subsequent save, which
      // is the one thing the disk store's tail does to the caller's object either way.
      record = copy(next);
      state.revision = next.revision;
      return { ok: true, revision: next.revision };
    },

    // THE RECORD IS AN ARTIFACT TOO, and answering it from the artifacts map alone would be wrong in
    // a way a unit test would feel immediately: the map holds what the OTHER artifact operations put
    // in it, while the record lives in `record`. A test asserting on the record FILE's bytes — the
    // refusal-leaves-it-byte-identical shape several files use — has to see the bytes the memory
    // store would have written, so it is serialised ON READ, with exactly the disk store's
    // formatting (`JSON.stringify(next, null, 2)` plus a trailing newline). Without this the seam
    // would silently be narrower than the disk store for one artifact, which is exactly the kind of
    // difference a unit-rung test could not have noticed.
    exists: (name) => (name === ARTIFACT.RECORD ? record !== undefined : artifacts.has(name)),
    size: (name) => Buffer.byteLength(memoryArtifact(name), "utf8"),
    mtimeMs: (name) => (memoryArtifact(name) === "" ? null : 0),
    read: (name) => {
      const text = memoryArtifact(name);
      return text === "" && !(name === ARTIFACT.RECORD ? record !== undefined : artifacts.has(name))
        ? { kind: "absent" } : { kind: "ok", text };
    },
    write: (name, text) => { artifacts.set(name, String(text)); },
    writeAtomic: (name, text) => { artifacts.set(name, String(text)); },
    append: (name, text) => { artifacts.set(name, (artifacts.get(name) || "") + String(text)); },
    remove: (name) => { artifacts.delete(name); },
    rotate: (name) => {
      if (artifacts.has(name)) { artifacts.set(`${name}.prev`, artifacts.get(name)); artifacts.delete(name); }
    },
    list: (prefix) => [...artifacts.keys()].filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length)).sort(),
    /** The artifacts this store holds, so a test can assert what a verb did NOT write as easily as
     *  what it did — the in-memory equivalent of walking `.conductor/`. */
    artifacts: () => new Map(artifacts),
  };
}

/** Called after ANY successful state write. The signal of interest is CONSECUTIVE skips, not
 *  skips ever — without this reset a single contended afternoon would warn forever. */
export function clearConflictsOn(store) {
  try { store.remove(ARTIFACT.WRITE_CONFLICTS_LOG); } catch { /* best effort */ }
  // The latch goes with the log: a successful write ends the episode, so the NEXT run of
  // contention must be able to warn again. Leaving the latch behind would silence it forever.
  try { store.remove(ARTIFACT.WRITE_CONFLICTS_LATCH); } catch { /* best effort */ }
}

// ─────────────────────────────── the seam ───────────────────────────────

/** The gateway used when nothing has called `setInvocation()`: built once, lazily, against a LIVE
 *  view of this process — the same shape and the same reason as `PROCESS_GIT` in invocation.mjs. */
let PROCESS_STORE = null;

/** The store THIS invocation was handed — the caller's own when it supplied `io.store`, the disk
 *  store otherwise.
 *
 *  THIS ACCESSOR IS WHY NO MODULE IMPORTS A STORE. A module that imported one could not be given a
 *  memory store, and a module that reached `statePath()` and `fs` directly would be a call site
 *  outside the seam — the whole 137-call-site population `loadState()`/`saveState()` exist to
 *  cover. Every consumer asks the INVOCATION for its store, exactly as it asks for its root, env
 *  and streams.
 *
 *  The PROCESS case is distinguished by `installedInvocation()`, never by comparing contexts:
 *  outside an invocation `invocation()` answers with a LIVE VIEW of the process, and that view is
 *  module-private to invocation.mjs precisely so it cannot be captured here as a value. */
export function storeOps(ctx = invocation()) {
  if (ctx.store) return ctx.store;
  // Built once PER CONTEXT and cached on it, never per call: the disk store's root is a thunk over
  // the context, so one object serves every call and still follows a moved root. */
  if (installedInvocation() === null) return (PROCESS_STORE ??= diskStore(invocation()));
  return (ctx.__store ??= diskStore(ctx));
}
