// scripts/lib/state.mjs
// state.json load/save — the conductor's single source of record, and the sink every epic
// creation routes through. Depends only on lib/constants.mjs, lib/write-conflicts.mjs and
// lib/disposition.mjs (all leaf modules — none of them imports state.mjs back).

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { recordConflict, clearConflicts } from "./write-conflicts.mjs";
import { CONFLICT_EXIT_CODE, STATE_LOCK_POLL_MS, STATE_LOCK_STALE_MS, STATE_LOCK_WAIT_MS, escapeControls } from "./constants.mjs";
import { isArchiveBackfilled } from "./disposition.mjs";
import { claimArtifacts } from "./source-artifacts.mjs";

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

/** Why a post-write read-back is a failure, or `null` when it is not.
 *
 *  Extracted rather than inlined so every branch is testable without a hidden self-test
 *  subcommand in the shipped CLI — the same reason conflictExitCode() above is a function.
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

/** The `revision` a state.json TEXT carries, or null when the text is missing or unparseable. */
function revisionOfText(text) {
  if (typeof text !== "string") return null;
  try {
    const s = JSON.parse(text);
    return s && typeof s === "object" && Number.isInteger(s.revision) ? s.revision : null;
  } catch { return null; }
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

/** The path every refusal names. Always this, relative to the project root, because STATE_PATH is
 *  always `<root>/.conductor/state.json` and every remedy below is a command run from that root. */
const STATE_DISPLAY_PATH = ".conductor/state.json";

/** The whole refusal, as the top-level catch prints it (design D2). Every remedy is a SHELL command:
 *  gate-guard blocks Edit/Write/NotebookEdit while the file is unreadable, and Bash is not matched by
 *  it, so a remedy that needed an edit tool would be a wedge. The untracked remedy is not decoration:
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

/** Why a parsed state value has the WRONG SHAPE, or null. Exactly the four rules the
 *  state-write-guard requirement names, and nothing else (design D1): each is a shape that makes a
 *  reader crash (`state.epics.find is not a function`) or makes a save discard data. A non-integer
 *  `revision` is NOT one — it reads as 0 on both sides and loses nothing — and neither is an unknown
 *  key: state.json grows keys every release, and an older engine must load a newer file's superset. */
function shapeProblem(s) {
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

/** THE strict reader for state.json: `{kind: "absent"}`, `{kind: "ok", state}` or
 *  `{kind: "unreadable", reason}`. loadState() and saveState()'s disk read both go through it, which
 *  is the whole point: an unreadable file used to read as revision 0 on BOTH sides of the revision
 *  guard, so the guard passed and a default record was written over it.
 *
 *  readJSON() above keeps its swallow on purpose — its other callers read files whose absence or
 *  damage is legitimately "no value" (the render stamp, plugin metadata). Only THIS file is a record
 *  that must never be guessed at. `ENOTDIR` is absence too, matching isInitialized()'s existsSync. */
export function readStateFile(p = getPaths().STATE_PATH) {
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
}

export function loadState() {
  const { STATE_PATH } = getPaths();
  const read = readStateFile(STATE_PATH);
  if (read.kind === "unreadable") throw new StateUnreadableError(STATE_PATH, read.reason);
  const s = read.kind === "ok" ? read.state : null;
  const base = s ? { ...defaultState(), ...s } : defaultState();
  // Absent means 0, which is what lets a state.json written by 0.25.2 load unchanged and take
  // revision 1 on its first write. No migration is needed for that reason.
  base.revision = Number.isInteger(base.revision) ? base.revision : 0;
  return base;
}

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

// ─────────────────────────────── the state lock (design D4) ───────────────────────────────
//
// WHY A LOCK, REVERSING 0.26.0. 0.26.0 rejected a lock file because "a session killed mid-write
// leaves the lock held forever" and relied on the revision comparison alone. Measured on 0.43.0,
// that is not sufficient: the comparison and the rename are separate system calls, so two writers
// can both pass it — 16 parallel `add-epic`, three runs, 9/9/8 reported success against 7/6/6 epics
// on disk, and one run published the same revision twice. The objection is answered by the stale
// rule (a lock whose holder is confirmed dead, or older than STATE_LOCK_STALE_MS, is broken); the
// revision guard STAYS, because the lock serialises the section while the revision still detects a
// writer whose LOAD predates another's save.
//
// Identity of a lock is its inode AND its nonce: inode numbers are reused after unlink on some
// filesystems, and two locks with the same recorded fields are otherwise indistinguishable.

function lockPaths() {
  const { STATE_PATH } = getPaths();
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
export function inspectLock(lockPath = lockPaths().LOCK) {
  let fd;
  try { fd = fs.openSync(lockPath, "r"); } catch { return lstatLock(lockPath); }
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

/** A lock path that EXISTS but cannot be read as a lock file — mode 000, a dangling symlink, a
 *  directory — judged from lstat alone: its identity is its inode with no nonce, its age its own
 *  mtime. Null only when nothing is at the path. Without this, "exists" (the exclusive create's
 *  EEXIST) and "no lock" (the failed open) disagreed, and the acquire loop spun at full CPU. */
function lstatLock(lockPath) {
  try {
    const st = fs.lstatSync(lockPath);
    return { ino: st.ino, mtimeMs: st.mtimeMs, content: null, nonce: null, unreadable: true,
      kind: st.isDirectory() ? "directory" : (st.isSymbolicLink() ? "symlink" : (st.isFile() ? "file" : "other")) };
  } catch { return null; }
}

const sameLock = (a, b) => !!a && !!b && a.ino === b.ino && a.nonce === b.nonce;

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
  const c = info.content;
  if (!c || !Number.isInteger(c.pid) || c.pid <= 0) return false;
  if (c.host !== os.hostname() || c.pidns !== pidNamespace()) return false;
  try { process.kill(c.pid, 0); return false; }
  catch (e) { return !!e && e.code === "ESRCH"; }
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
export function breakStaleLock(judged) {
  return tryBreakStaleLock(judged).removed;
}

/** breakStaleLock()'s body, also reporting an OBSTACLE: a path past the stale age that the engine
 *  cannot remove (a directory at the lock or the break path). The acquire loop refuses on one at
 *  once, naming it — waiting cannot help, and the age rule would otherwise judge it forever. */
function tryBreakStaleLock(judged) {
  const { LOCK, BREAK } = lockPaths();
  let bfd;
  try { bfd = fs.openSync(BREAK, "wx"); } catch (e) {
    if (!e || e.code !== "EEXIST") return { removed: false };
    try {
      const st = fs.lstatSync(BREAK);
      if (Math.abs(Date.now() - st.mtimeMs) > STATE_LOCK_STALE_MS && fs.lstatSync(BREAK).ino === st.ino) {
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
    if (!sameLock(current, judged) || !isStaleLock(current)) return { removed: false };
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
 *  command that removes it, because while a reconcile is owed Edit and Write are blocked. */
function lockRefusalMessage(lock, expected) {
  const shown = path.relative(process.env.CLAUDE_PROJECT_DIR || process.cwd(), lock.path) || lock.path;
  const directory = lock.directory || (lock.holder && lock.holder.kind === "directory");
  const rm = `${directory ? "rm -r" : "rm"} ${shown}`;
  const stale = STATE_LOCK_STALE_MS / 1000;
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
  return `pid ${c.pid} on host ${escapeControls(c.host)}` +
    (c.acquiredAt ? ` since ${escapeControls(c.acquiredAt)}` : "");
}

/** Create the lock exclusively and write its content. `{ino, nonce}` when acquired, or
 *  `{timedOut: true, holder}` when a holder that is not stale did not release it within
 *  STATE_LOCK_WAIT_MS. A stale lock is broken on the way (isStaleLock, breakStaleLock). */
function acquireStateLock() {
  const { LOCK } = lockPaths();
  const deadline = Date.now() + STATE_LOCK_WAIT_MS;
  for (;;) {
    let fd;
    try { fd = fs.openSync(LOCK, "wx"); } catch (e) {
      if (!e || e.code !== "EEXIST") throw e;
      // EVERY path below either makes progress (a lock that vanished, a lock broken) or reaches
      // the deadline and the sleep. A `continue` that skipped both spun at full CPU forever on a
      // lock path that exists but cannot be read (Gate 2 C1).
      if (Date.now() >= deadline) return { timedOut: true, holder: inspectLock(LOCK), path: LOCK };
      const held = inspectLock(LOCK);
      if (held === null) continue;                     // released between the create and the look
      // A stale lock is broken — serialised, and only the very lock judged — then the create is
      // retried. A break that did not happen (another breaker, or the lock is no longer the one
      // judged) falls through to waiting like any held lock — unless what stands in the way can
      // never be removed, which waiting cannot fix.
      if (isStaleLock(held)) {
        const broke = tryBreakStaleLock(held);
        if (broke.removed) continue;
        if (broke.obstacle) return { blocked: true, holder: held, ...broke.obstacle };
      }
      sleepMs(STATE_LOCK_POLL_MS);
      continue;
    }
    const nonce = crypto.randomBytes(16).toString("hex");
    let ino = null;
    try {
      ino = fs.fstatSync(fd).ino;
      fs.writeFileSync(fd, JSON.stringify({
        pid: process.pid, host: os.hostname(), pidns: pidNamespace(),
        acquiredAt: new Date().toISOString(), nonce,
      }));
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
function releaseStateLock(lock) {
  const { LOCK } = lockPaths();
  try { if (sameLock(inspectLock(LOCK), lock)) fs.unlinkSync(LOCK); } catch { /* stale rule recovers */ }
}

/** Atomic, serialised write with an optimistic revision check.
 *
 *  The tmp-file + rename(2) guarantees the WRITE is atomic — a crash never leaves a torn
 *  state.json — and the temp file is fsynced before the rename, so its data is ordered ahead of it.
 *  (fsync(2), not F_FULLFSYNC: on macOS this is ordering, not a power-loss durability promise.) The
 *  read-modify-write CYCLE is guarded twice: the revision comparison detects a writer whose load
 *  predates another's save, and the lock above makes the strict disk read, that comparison, the
 *  no-op comparison, the write, the rename and the read-back ONE critical section, so two writers
 *  can no longer both pass the comparison. `--force` bypasses only the comparison, never the lock.
 *
 *  Every return and throw inside the section releases the lock in `finally`. There is no
 *  process.on("exit") handler: every process.exit in the engine's verbs runs after saveState() has
 *  returned. A signal kill leaves the lock; the stale rule removes it.
 *
 *  opts.onConflict "throw" (default) is for interactive verbs: a human or agent is present and
 *  can re-read and re-apply. "skip" is for HOOK writes — render.mjs's and commitNudge()'s own
 *  reconcileArchived() self-heals — that re-run on the next hook, so losing either costs
 *  nothing, while hard-failing would turn an invisible race into a visible mid-session error for
 *  a write that did not matter. A lock held past the wait is a conflict under the same policy.
 */
export function saveState(state, opts = {}) {
  const { onConflict = "throw", verb = "unknown" } = opts;
  const { STATE_PATH, CONDUCTOR_DIR } = getPaths();
  fs.mkdirSync(CONDUCTOR_DIR, { recursive: true });
  const expected = Number.isInteger(state.revision) ? state.revision : 0;

  const lock = acquireStateLock();
  if (lock.timedOut || lock.blocked) {
    // `found` is the disk revision read WITHOUT the lock, at the timeout — the only reading there
    // is, and the sidecar's contract is a verb and two revisions.
    const peek = readStateFile(STATE_PATH);
    if (peek.kind === "unreadable") throw new StateUnreadableError(STATE_PATH, peek.reason);
    const found = peek.kind === "ok" && Number.isInteger(peek.state.revision) ? peek.state.revision : 0;
    if (onConflict === "skip") {
      recordConflict({ verb, expected, found });
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
    const disk = readStateFile(STATE_PATH);
    if (disk.kind === "unreadable") throw new StateUnreadableError(STATE_PATH, disk.reason);
    const diskBody = disk.kind === "ok" ? disk.state : {};
    const found = Number.isInteger(diskBody.revision) ? diskBody.revision : 0;
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
      if (!sameLock(inspectLock(lockPaths().LOCK), lock)) {
        try { fs.unlinkSync(tmpPath); } catch { /* best effort */ }
        if (onConflict === "skip") {
          recordConflict({ verb, expected, found });
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
    clearConflicts();   // consecutive skips end at the first success
    return { ok: true, revision: next.revision };
  } finally {
    releaseStateLock(lock);
  }
}
