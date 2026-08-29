// scripts/lib/commit-watch.mjs
// Did a commit LAND in this repository during the tool call that just returned?
//
// The PostToolUse hook used to answer that by reading the Bash command's TEXT: a `/git\s+commit/`
// test to decide whether to react, then an `-m "…"` capture to recover the subject. Every known
// defect in that hook is a consequence of the question being asked of a string rather than of the
// repository — gh#104 (a `grep`, a heredoc or an `echo` that merely MENTIONS `git commit` fires
// the nudge), and the local `autodetour-parser-misses-am-and-f` epic (`-am`, `-F`, an editor
// commit and an escaped quote inside `-m` are all forms the capture cannot read, and an
// unreadable form either fires blind or is wrongly CONTRADICTED and silently suppressed).
//
// A commit is a fact about the repository, not about the words in a command, and the fact has
// two observable halves:
//
//   1. HEAD moved since the last time this hook looked. That needs a watermark, because
//      PostToolUse fires only AFTER the tool returns — there is no before-snapshot to compare
//      against, and the hook running on EVERY Bash call is exactly what makes a persisted one
//      cheap and always fresh.
//   2. The move was a COMMIT. `git reflog` classifies it: `commit:`, `commit (initial):` and
//      `commit (amend):` created something; `checkout:`, `reset:`, `merge …: Fast-forward`,
//      `rebase …:` and `pull:` moved a pointer at objects that already existed.
//
// Both halves are flag-form-blind, so `-am`, `-F`, `--message`, an editor commit and whatever
// flag git grows next are all covered by construction rather than by a pattern per form.
//
// THREE-VALUED on purpose, and the third value is the whole degradation story. `unverifiable` is
// not a disguised "no": it means this module could not observe (no git, no repository, reflogs
// disabled, or no watermark recorded yet), and the caller then falls back to the pre-observation
// text heuristic. That keeps two properties the hook must not lose: it can never do WORSE than
// the behaviour it replaces, and commit-nudge's archived-epic self-heal still runs in a
// repository with no git at all (see commitNudge's own comment).
//
// Local only, per the engine's architectural law: rev-parse and reflog read this repository's
// own object database and ref logs and contact nothing.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { CONDUCTOR_DIR, ROOT } from "./constants.mjs";

/** Where the HEAD watermark lives. Engine-written and per-checkout (a worktree has its own HEAD
 *  and its own .conductor/), so it is git-ignored by ensureGitignore() rather than tracked. */
export const COMMIT_WATCH_PATH = path.join(CONDUCTOR_DIR, "commit-watch.json");

/** An initialized repository whose HEAD does not resolve yet — `git init` with no commits.
 *  Deliberately a STRING, not null: it is a real, comparable position for HEAD, and the first
 *  commit moves off it. Conflating it with null ("git cannot answer") would put every brand-new
 *  repository permanently on the unverifiable rung. */
const UNBORN = "";

function gitOut(args) {
  return execFileSync("git", args, {
    cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

/** Current HEAD as a full sha, `UNBORN` in a repository with no commits yet, or null when git
 *  cannot answer at all (no git binary, not a repository). */
export function observeHead() {
  try {
    gitOut(["rev-parse", "--git-dir"]);          // are we in a repository at all?
  } catch { return null; }
  try {
    return gitOut(["rev-parse", "HEAD"]) || UNBORN;
  } catch {
    return UNBORN;                                // in a repository, HEAD unborn
  }
}

/** The most recent HEAD reflog entry as `{ sha, action }`, or null when there is no reflog to
 *  read. Empty output is the signal for `core.logAllRefUpdates=false` (git exits 0 and prints
 *  nothing), which is a cannot-answer, not a "no commit". */
export function headReflog() {
  try {
    const out = gitOut(["reflog", "-1", "--format=%H%x09%gs"]);
    if (!out) return null;
    const tab = out.indexOf("\t");
    if (tab < 0) return null;
    return { sha: out.slice(0, tab), action: out.slice(tab + 1) };
  } catch { return null; }
}

/** The recorded watermark, or null when there is none to trust.
 *
 *  Null covers absent AND unreadable AND malformed on purpose: all three mean "no baseline",
 *  which is the unverifiable rung. A corrupt file must degrade the hook, never crash it — this
 *  code runs on every Bash tool call in every pm-initialized project. */
export function readWatch() {
  try {
    const v = JSON.parse(fs.readFileSync(COMMIT_WATCH_PATH, "utf8"));
    return typeof v?.head === "string" ? v.head : null;
  } catch { return null; }
}

/** Record where HEAD is now. Best-effort: a read-only checkout that cannot write it simply stays
 *  on the unverifiable rung forever, which is the old behaviour and therefore safe. */
export function writeWatch(head) {
  try {
    fs.mkdirSync(CONDUCTOR_DIR, { recursive: true });
    fs.writeFileSync(COMMIT_WATCH_PATH, JSON.stringify({ head }) + "\n");
    return true;
  } catch { return false; }
}

/** Reflog actions that mean a commit OBJECT was created at HEAD.
 *
 *  Deliberately narrow. `revert:`, `cherry-pick:`, `merge …:` and `rebase …:` also create commits,
 *  and firing on them would be a behaviour CHANGE rather than a fix: the text check being
 *  replaced never matched those command lines either, so leaving them out keeps this release to
 *  the three issues it is for. Widening the set is a separate decision with its own evidence. */
const COMMIT_ACTION = /^commit\b/;

/** Pure classifier — the whole decision, with no I/O, so every rung is testable directly.
 *
 *  `baseline` / `head`: sha, UNBORN (""), or null for "git cannot answer" on head.
 *  `action` / `reflogSha`: the HEAD reflog's top entry, or null when unavailable. */
export function classifyMovement({ baseline, head, action = null, reflogSha = null }) {
  if (head === null) return { verdict: "unverifiable", reason: "no-git" };
  if (baseline === null) return { verdict: "unverifiable", reason: "no-baseline" };
  if (baseline === head) return { verdict: "no-commit", reason: "head-unchanged" };
  if (!action) return { verdict: "unverifiable", reason: "no-reflog" };
  // A top reflog entry that does not describe where HEAD actually is cannot classify this move.
  if (reflogSha && reflogSha !== head) return { verdict: "unverifiable", reason: "reflog-stale" };
  if (!COMMIT_ACTION.test(action)) {
    return { verdict: "no-commit", reason: `head-moved-by:${action.split(":")[0]}` };
  }
  return { verdict: "landed", reason: "reflog-commit" };
}

/** Observe, record, and classify — the one call commitNudge makes.
 *
 *  The watermark write is UNCONDITIONAL and happens here, before any verdict is returned, so no
 *  caller-side early return can skip it. That ordering is load-bearing: a watermark advanced only
 *  on the paths that nudge would leave the cache pinned wherever the last nudge happened, and
 *  every intervening `git checkout` would then read as a commit.
 *
 *  The reflog subprocess is spawned ONLY when HEAD actually moved against a known baseline, so
 *  the overwhelmingly common case — a Bash call that changed nothing — costs one `rev-parse`. */
export function observeCommit() {
  let head;
  try { head = observeHead(); } catch { head = null; }
  const baseline = readWatch();
  if (head !== null && head !== baseline) writeWatch(head);

  let action = null, reflogSha = null;
  if (head !== null && baseline !== null && head !== baseline) {
    const r = headReflog();
    if (r) { action = r.action; reflogSha = r.sha; }
  }
  return { ...classifyMovement({ baseline, head, action, reflogSha }), head };
}
