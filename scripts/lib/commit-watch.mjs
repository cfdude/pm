// scripts/lib/commit-watch.mjs
// Which commits LANDED in this repository since the commit hook last looked?
//
// History. The PostToolUse hook first answered "did a commit happen?" by reading the Bash
// command's TEXT (gh#104, `autodetour-parser-misses-am-and-f`), then — 0.44.0 and earlier — by
// comparing HEAD against one watermark and reading the TOP reflog entry. That single read was
// wrong in both directions (commit-nudge-reads-the-whole-move, proposal defects 1, 2 and 4): a
// commit followed by a checkout in the same call was read as `checkout` and never reported, two
// commits in one call reported only HEAD, and an amend reported a second row.
//
// Now: a REFLOG ANCHOR. After each observation the hook records the byte size of HEAD's reflog
// file and that file's full last line AS BYTES (base64): a reflog is not guaranteed to be UTF-8 — a
// commit made with `i18n.commitEncoding=ISO-8859-1` writes its raw subject bytes there — and a line
// decoded as UTF-8 and re-encoded is not the line on disk, so it was never found again and nothing
// was reported from then on (Gate 2 G2-C1). The next observation locates the anchor BY CONTENT — the
// last occurrence of the anchored line that ends at or before the recorded size — and reads every
// entry after it. Expiry (`git reflog expire`, `git gc`) removes entries from the FRONT, so the
// anchored line survives at a smaller offset; appends only land after the recorded size, so
// bounding the search keeps an identical later line from being mistaken for the anchor. Every
// entry whose action begins with `commit` is a candidate, oldest first, whatever HEAD did
// afterwards. Design Decision 1.
//
// REPORTED ONCE (Decision 3). The whole observation — read the record, walk the reflog, decide,
// write the new record — runs under an O_EXCL lock. A run that cannot take the lock within 200 ms
// SKIPS entirely: no report, no write, so the commits stay after the anchor for the next run. The
// lock records its holder (pid, host, pid namespace, nonce — state.mjs lockContent()) and is broken
// only when that holder is CONFIRMED dead, or — where liveness cannot be confirmed (another host or
// namespace, unreadable content) — once it is older than 10 s. A holder confirmed ALIVE is never
// broken for age inside OBSERVE_LOCK_LIVE_MAX_MS: breaking a slow live observation at 10 s reported
// its commits twice (Gate 2 G2-I3, 330 commits). Breaking is state.mjs's serialised, re-judging
// break, so two starters can never both remove a lock and both hold one. The record also keeps the
// set of full shas already reported (bounded to the 500 most recent).
//
// A NEW FILE (Decision 2): `.conductor/commit-observe.json`, never `commit-watch.json`. An
// unreloaded 0.44.0 session rewrites `commit-watch.json` as `{head}` on every Bash call, and would
// erase anything added to it. This engine never reads or writes that file.
//
// UNVERIFIABLE is still not a disguised "no": no git, no reflog file, no anchor recorded yet, or
// an anchor no longer in the reflog. The caller then takes the pre-observation text heuristic, so
// the hook never does worse than what it replaced and the archived-epic self-heal still runs in a
// repository with no git at all.
//
// Local only, per the engine's architectural law: rev-parse, for-each-ref and a file read of this
// repository's own reflog contact nothing.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { engineRoot } from "./constants.mjs";
import { isDetachedTree } from "./git.mjs";
import { breakStaleLockAt, inspectLock, lockContent, lockHolderAlive, sameLock } from "./state.mjs";

export const COMMIT_OBSERVE_FILE = "commit-observe.json";
/** Where the observation record lives for a conductor root. Per-checkout (a worktree has its own
 *  HEAD reflog and its own .conductor/), so ensureGitignore() ignores it and its lock and temp. */
export const commitObservePath = (root = engineRoot()) => path.join(root, ".conductor", COMMIT_OBSERVE_FILE);

export const OBSERVE_LOCK_WAIT_MS = 200;
export const OBSERVE_LOCK_STALE_MS = 10_000;
/** The backstop for a holder confirmed alive: a pid reused by an unrelated long-lived process after
 *  a hook was killed must not stop observation forever. Far above any observation measured. */
export const OBSERVE_LOCK_LIVE_MAX_MS = 600_000;
export const REPORTED_BOUND = 500;

/** Reflog actions that mean a commit OBJECT was created at HEAD: `commit`, `commit (initial)`,
 *  `commit (amend)`, `commit (merge)`, `commit (cherry-pick)`. `revert:`, clean `merge …:`, clean
 *  `cherry-pick:` and rebase `(pick)` entries stay out, unchanged (design Non-Goals). */
const COMMIT_ACTION = /^commit\b/;
const AMEND_ACTION = /^commit \(amend\)/;

function gitOut(args, root) {
  return execFileSync("git", args, {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

/** Absolute path of HEAD's reflog file, or null when git cannot answer (no git, no repository).
 *  `--git-path` prints a path relative to the working directory (`../../.git/logs/HEAD` in a
 *  nested conductor), so it is resolved against the conductor root the command ran in. */
export function headReflogPath(root = engineRoot()) {
  try {
    gitOut(["rev-parse", "--git-dir"], root);
    return path.resolve(root, gitOut(["rev-parse", "--git-path", "logs/HEAD"], root));
  } catch { return null; }
}

/** The recorded `{anchor, reported}`. Absent, unreadable and malformed all read as "no anchor",
 *  which is the unverifiable rung — a corrupt record degrades the hook, never crashes it. */
export function readObserveRecord(root = engineRoot()) {
  try {
    const v = JSON.parse(fs.readFileSync(commitObservePath(root), "utf8"));
    const a = v && v.anchor;
    // `lineBase64` only: a record carrying the earlier `line` (a UTF-8 decode) reads as no anchor and
    // re-anchors once, on the unverifiable rung.
    const anchor = a && Number.isInteger(a.size) && a.size >= 0 && typeof a.lineBase64 === "string"
      ? { size: a.size, lineBase64: a.lineBase64 } : null;
    const reported = Array.isArray(v && v.reported) ? v.reported.filter(s => typeof s === "string") : [];
    return { anchor, reported };
  } catch { return { anchor: null, reported: [] }; }
}

/** The anchor for a reflog buffer as it is now: its byte size and its last line's BYTES, base64.
 *  Never decoded: the comparison in locateAnchor() is byte for byte, whatever the encoding. */
export function anchorOf(buf) {
  let end = buf.length;
  while (end > 0 && buf[end - 1] === 0x0a) end--;
  const nl = end > 0 ? buf.lastIndexOf(0x0a, end - 1) : -1;
  return { size: buf.length, lineBase64: buf.subarray(nl + 1, end).toString("base64") };
}

/** The anchored line's bytes. */
const anchorLineBytes = (anchor) => Buffer.from(anchor.lineBase64, "base64");

/** Byte offset just past the anchored line, or -1 when the anchor is not in the reflog.
 *
 *  The LAST occurrence of the whole line that ends at or before the recorded size. An anchor
 *  recorded against an empty or absent reflog (`{size: 0, lineBase64: ""}`) is the start of the file. */
export function locateAnchor(buf, anchor) {
  const line = anchorLineBytes(anchor);
  if (anchor.size === 0 && line.length === 0) return 0;
  const needle = Buffer.concat([line, Buffer.from([0x0a])]);
  let from = anchor.size - needle.length;
  while (from >= 0) {
    const i = buf.lastIndexOf(needle, from);
    if (i < 0) return -1;
    if (i === 0 || buf[i - 1] === 0x0a) return i + needle.length;
    from = i - 1;
  }
  return -1;
}

/** Reflog lines `<old> <new> <ident> <time> <tz>\t<message>` as `{old, sha, action}`. */
export function parseReflog(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const [old, sha] = line.slice(0, tab).split(" ");
    if (!/^[0-9a-f]{40,64}$/.test(old || "") || !/^[0-9a-f]{40,64}$/.test(sha || "")) continue;
    out.push({ old, sha, action: line.slice(tab + 1) });
  }
  return out;
}

const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const observeLockPaths = (root) => {
  const LOCK = commitObservePath(root) + ".lock";
  return { LOCK, BREAK: `${LOCK}.break` };
};

/** The observation lock currently in place, as state.mjs inspectLock() reads a lock, or null. */
export const inspectObserveLock = (root = engineRoot()) => inspectLock(observeLockPaths(root).LOCK);

/** Is this observation lock stale — safe to break? Holder confirmed dead: yes, at once. Holder
 *  confirmed alive: only past OBSERVE_LOCK_LIVE_MAX_MS. Not confirmable (another host or pid
 *  namespace, content not yet written or not a lock record): past OBSERVE_LOCK_STALE_MS. Age is
 *  absolute, so a lock dated in the future by a clock step cannot wedge observation. */
export function isStaleObserveLock(info, now = Date.now()) {
  if (!info) return false;
  const age = Math.abs(now - info.mtimeMs);
  const alive = lockHolderAlive(info);
  if (alive === false) return true;
  if (alive === true) return age > OBSERVE_LOCK_LIVE_MAX_MS;
  return age > OBSERVE_LOCK_STALE_MS;
}

/** Break `judged` — the very observation lock a caller found stale — and nothing else. */
export const breakStaleObserveLock = (root, judged) =>
  breakStaleLockAt(judged, { ...observeLockPaths(root), isStale: isStaleObserveLock, staleMs: OBSERVE_LOCK_STALE_MS });

/** Take the observation lock: `{ino, nonce}` when held, false on contention past the wait, and
 *  "unlockable" when the lock cannot be created at all (a read-only checkout) — that run proceeds
 *  and its record write fails harmlessly, which is the pre-lock behaviour and therefore safe. */
function acquireLock(root, { waitMs = OBSERVE_LOCK_WAIT_MS } = {}) {
  const { LOCK } = observeLockPaths(root);
  const deadline = Date.now() + waitMs;
  for (;;) {
    let fd;
    try { fd = fs.openSync(LOCK, "wx"); } catch (e) {
      if (!e || e.code !== "EEXIST") return "unlockable";
      const held = inspectLock(LOCK);
      if (held === null) continue;                      // released between the create and the look
      if (isStaleObserveLock(held) && breakStaleObserveLock(root, held)) continue;
      if (Date.now() >= deadline) return false;
      sleepMs(10);
      continue;
    }
    const content = lockContent();
    let ino = null;
    try {
      ino = fs.fstatSync(fd).ino;
      fs.writeFileSync(fd, JSON.stringify(content));
      return { ino, nonce: content.nonce };
    } catch {
      // Created but not written: remove only the file this call created, then proceed unlocked as a
      // lock that cannot be written is a checkout that cannot hold one.
      try { if (ino === null || fs.lstatSync(LOCK).ino === ino) fs.unlinkSync(LOCK); } catch { /* gone */ }
      return "unlockable";
    } finally { try { fs.closeSync(fd); } catch { /* closed */ } }
  }
}

/** Begin one observation. Returns `{ verdict: "skipped" }` when another observation holds the
 *  lock, or a handle:
 *
 *    verdict     "landed" | "no-commit" | "unverifiable"
 *    reason      why, for the unverifiable rung (no-git | no-reflog | no-anchor | anchor-lost)
 *    candidates  [{old, sha, action}] — `commit…` entries since the anchor not yet reported,
 *                oldest first (empty unless landed)
 *    finish(shas) write the new anchor plus `shas` into the reported set, then release
 *    release()   release without writing (idempotent; finish calls it)
 *
 *  The caller MUST end every handle with finish() or release(). A run that exits on unreadable
 *  state calls neither write, so the anchor and the set stay where they were (Decision 3). */
export function beginObservation({ root = engineRoot() } = {}) {
  const got = acquireLock(root);
  if (got === false) return { verdict: "skipped" };
  let released = false;
  // Only OUR lock is removed — never one another observation took after ours was broken.
  const release = () => {
    if (released) return;
    released = true;
    if (got && typeof got === "object") {
      try { if (sameLock(inspectObserveLock(root), got)) fs.rmSync(observeLockPaths(root).LOCK, { force: true }); }
      catch { /* best effort: the stale rule recovers */ }
    }
  };

  const handle = (verdict, reason, { candidates = [], nextAnchor = null, record }) => ({
    verdict, reason, candidates,
    release,
    finish(shas = []) {
      try {
        if (nextAnchor === null && !shas.length) return;
        // gh#175: session bookkeeping, and a detached tree has no session. Suppressed silently.
        if (isDetachedTree(root)) return;
        const merged = record.reported.filter(s => !shas.includes(s)).concat(shas).slice(-REPORTED_BOUND);
        const body = JSON.stringify({ anchor: nextAnchor || record.anchor, reported: merged }) + "\n";
        const target = commitObservePath(root);
        const tmp = `${target}.tmp-${process.pid}`;
        try {
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(tmp, body);
          fs.renameSync(tmp, target);
        } catch { try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ } }
      } finally { release(); }
    },
  });

  try {
    const record = readObserveRecord(root);
    const file = headReflogPath(root);
    if (file === null) return handle("unverifiable", "no-git", { record });
    let buf;
    try { buf = fs.readFileSync(file); } catch {
      // No reflog file: an unborn HEAD, or reflogs disabled. Anchored at the start, so the first
      // commit of an unborn repository is reported once the file appears.
      return handle("unverifiable", "no-reflog", { record, nextAnchor: { size: 0, lineBase64: "" } });
    }
    const nextAnchor = anchorOf(buf);
    if (!record.anchor) return handle("unverifiable", "no-anchor", { record, nextAnchor });
    const at = locateAnchor(buf, record.anchor);
    if (at < 0) return handle("unverifiable", "anchor-lost", { record, nextAnchor });
    const seen = new Set(record.reported);
    const candidates = parseReflog(buf.subarray(at).toString("utf8"))
      .filter(e => COMMIT_ACTION.test(e.action) && !seen.has(e.sha));
    return handle(candidates.length ? "landed" : "no-commit", null, { record, nextAnchor, candidates });
  } catch (e) {
    release();
    throw e;
  }
}

/** Is this candidate an amend, whose `old` is the commit it replaced? */
export const isAmend = (entry) => AMEND_ACTION.test(entry.action);

/** Is this commit reachable from a branch? (design Decision 4)
 *
 *  `for-each-ref --contains` with an empty answer means the commit was rewritten (`pull --rebase`,
 *  `rebase`), reset away, or made on a detached HEAD and abandoned. Such a commit is named, never
 *  logged or offered for attribution: a dead sha on an append-only attribution array is a Gate 2
 *  endpoint nothing can reach. An empty `refs/heads` makes every commit dead; accepted.
 *
 *  git failing to answer at all reads as LIVE — the pre-filter behaviour, and the direction in which
 *  a wrong answer is visible (a row that can be retracted) rather than silent. */
export function isLiveCommit(sha, root = engineRoot()) {
  try {
    return gitOut(["for-each-ref", "--contains", sha, "--count=1", "--format=%(refname)", "refs/heads"], root) !== "";
  } catch { return true; }
}
