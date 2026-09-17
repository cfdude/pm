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
// file and that file's full last line. The next observation locates the anchor BY CONTENT — the
// last occurrence of the anchored line that ends at or before the recorded size — and reads every
// entry after it. Expiry (`git reflog expire`, `git gc`) removes entries from the FRONT, so the
// anchored line survives at a smaller offset; appends only land after the recorded size, so
// bounding the search keeps an identical later line from being mistaken for the anchor. Every
// entry whose action begins with `commit` is a candidate, oldest first, whatever HEAD did
// afterwards. Design Decision 1.
//
// REPORTED ONCE (Decision 3). The whole observation — read the record, walk the reflog, decide,
// write the new record — runs under an O_EXCL lock. A run that cannot take the lock within 200 ms
// SKIPS entirely: no report, no write, so the commits stay after the anchor for the next run. A
// lock older than 10 s was left by a killed hook and is broken. The record also keeps the set of
// full shas already reported (bounded to the 500 most recent).
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
import { ROOT } from "./constants.mjs";
import { isDetachedTree } from "./git.mjs";

export const COMMIT_OBSERVE_FILE = "commit-observe.json";
/** Where the observation record lives for a conductor root. Per-checkout (a worktree has its own
 *  HEAD reflog and its own .conductor/), so ensureGitignore() ignores it and its lock and temp. */
export const commitObservePath = (root = ROOT) => path.join(root, ".conductor", COMMIT_OBSERVE_FILE);

export const OBSERVE_LOCK_WAIT_MS = 200;
export const OBSERVE_LOCK_STALE_MS = 10_000;
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
export function headReflogPath(root = ROOT) {
  try {
    gitOut(["rev-parse", "--git-dir"], root);
    return path.resolve(root, gitOut(["rev-parse", "--git-path", "logs/HEAD"], root));
  } catch { return null; }
}

/** The recorded `{anchor, reported}`. Absent, unreadable and malformed all read as "no anchor",
 *  which is the unverifiable rung — a corrupt record degrades the hook, never crashes it. */
export function readObserveRecord(root = ROOT) {
  try {
    const v = JSON.parse(fs.readFileSync(commitObservePath(root), "utf8"));
    const a = v && v.anchor;
    const anchor = a && Number.isInteger(a.size) && a.size >= 0 && typeof a.line === "string" ? a : null;
    const reported = Array.isArray(v && v.reported) ? v.reported.filter(s => typeof s === "string") : [];
    return { anchor, reported };
  } catch { return { anchor: null, reported: [] }; }
}

/** The anchor for a reflog buffer as it is now: its byte size and its last line. */
export function anchorOf(buf) {
  const text = buf.toString("utf8").replace(/\n+$/, "");
  const nl = text.lastIndexOf("\n");
  return { size: buf.length, line: nl < 0 ? text : text.slice(nl + 1) };
}

/** Byte offset just past the anchored line, or -1 when the anchor is not in the reflog.
 *
 *  The LAST occurrence of the whole line that ends at or before the recorded size. An anchor
 *  recorded against an empty or absent reflog (`{size: 0, line: ""}`) is the start of the file. */
export function locateAnchor(buf, anchor) {
  if (anchor.size === 0 && anchor.line === "") return 0;
  const needle = Buffer.from(anchor.line + "\n", "utf8");
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

/** Take the observation lock: true when held, false on contention past the wait, and "unlockable"
 *  when the lock cannot be created at all (a read-only checkout) — that run proceeds and its
 *  record write fails harmlessly, which is the pre-lock behaviour and therefore safe. */
function acquireLock(lockPath, { waitMs = OBSERVE_LOCK_WAIT_MS, staleMs = OBSERVE_LOCK_STALE_MS } = {}) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      try { fs.writeSync(fd, String(process.pid)); } finally { fs.closeSync(fd); }
      return true;
    } catch (e) {
      if (!e || e.code !== "EEXIST") return "unlockable";
      let st = null;
      try { st = fs.statSync(lockPath); } catch { continue; }   // released between open and stat
      if (Date.now() - st.mtimeMs > staleMs) { try { fs.rmSync(lockPath, { force: true }); } catch { /* raced */ } continue; }
      if (Date.now() >= deadline) return false;
      sleepMs(10);
    }
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
export function beginObservation({ root = ROOT } = {}) {
  const lockPath = commitObservePath(root) + ".lock";
  const got = acquireLock(lockPath);
  if (got === false) return { verdict: "skipped" };
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    if (got === true) { try { fs.rmSync(lockPath, { force: true }); } catch { /* best effort */ } }
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
      return handle("unverifiable", "no-reflog", { record, nextAnchor: { size: 0, line: "" } });
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
export function isLiveCommit(sha, root = ROOT) {
  try {
    return gitOut(["for-each-ref", "--contains", sha, "--count=1", "--format=%(refname)", "refs/heads"], root) !== "";
  } catch { return true; }
}
