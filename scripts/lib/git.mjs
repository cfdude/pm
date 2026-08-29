// scripts/lib/git.mjs
// git plumbing (current SHA) and the append-only detour log. Depends only on
// lib/constants.mjs.

import fs from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { ROOT, CONDUCTOR_DIR, DETOURS_LOG } from "./constants.mjs";

export function gitShortSha() {
  try { return execSync("git rev-parse --short HEAD", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { return "-"; }
}

/** Kinds whose IDENTITY is the commit they describe, so a second row for the same sha is a
 *  duplicate by definition rather than a second event (gh#81: one repo held 8 rows for 4 distinct
 *  shas, one sha three times, twice with an empty note).
 *
 *  MINIMAL is deliberately absent and the distinction is the whole rule. A MINIMAL row records
 *  what the agent DECLARED via `/pm:detour --minimal`, not what git observed: two genuine minimal
 *  detours fixed between one pair of commits share a HEAD and are two real events. Deduping them
 *  would delete a record, which is the opposite of what this is for. */
const COMMIT_DERIVED_KINDS = new Set(["DETOUR-COMMIT", "AUTO-DETOUR"]);

/** Is (sha, kind) already in the log?  Reads the file whole — it is small, append-only, and
 *  render() already reads it whole on every render, so this adds no new order of cost. */
function alreadyLogged(kind, sha) {
  let body;
  try { body = fs.readFileSync(DETOURS_LOG, "utf8"); } catch { return false; }
  for (const line of body.split("\n")) {
    if (!line) continue;
    const [, s, k] = line.split("\t");
    if (s === sha && k === kind) return true;
  }
  return false;
}

/** Append a row to the detour trail. Returns whether a row was actually written, so a caller
 *  never announces "logged to detours.log" for a row that was suppressed as a duplicate.
 *
 *  gh#81: the observed rung (commit-watch.mjs) already refuses to fire twice for one HEAD, but
 *  the UNVERIFIABLE rung — no reflog, no baseline yet, a read-only checkout that cannot persist
 *  the watermark — has no such memory and re-logs the same commit on every hook invocation. The
 *  log is the wrong place to depend on an upstream guard: dedupe where the row is written, so
 *  every rung inherits it. */
export function appendDetourLog(kind, epic, note) {
  fs.mkdirSync(CONDUCTOR_DIR, { recursive: true });
  const sha = gitShortSha();
  // sha "-" is gitShortSha()'s "cannot tell" (no git, no repository, no commits yet), NOT a
  // commit identity. Collapsing on it would fold every unrelated row in a git-less repo into one.
  if (COMMIT_DERIVED_KINDS.has(kind) && sha !== "-" && alreadyLogged(kind, sha)) return false;
  const line = [new Date().toISOString(), sha, kind, epic || "-", (note || "").replace(/\s+/g, " ").trim()].join("\t");
  fs.appendFileSync(DETOURS_LOG, line + "\n");
  return true;
}

/** Is commit `a` an ancestor of commit `b`?  true | false | null.
 *
 *  `null` is a THIRD answer and not a disguised false: it means git could not answer at all —
 *  no repository, no git binary, or a sha this repo has never seen. A verdict whose ancestry
 *  cannot be computed is UNVERIFIABLE, and reporting that as "not stale" would silently claim
 *  a check ran when none did.
 *
 *  `git merge-base --is-ancestor` exits 0 for yes and 1 for no; every other status is the
 *  cannot-answer case. execFileSync, not a shell string: these values reach us from
 *  `state.json` and must never be interpolated into a command line.
 *
 *  Local only, per the engine's architectural law — merge-base reads this repository's own
 *  object database and contacts nothing. */
export function isAncestor(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return null;
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", a, b],
      { cwd: ROOT, stdio: ["ignore", "ignore", "ignore"] });
    return true;
  } catch (e) {
    return e && e.status === 1 ? false : null;
  }
}

/** Do `a` and `b` name the SAME commit, whatever length each is written at?
 *
 *  Git accepts any unambiguous prefix, so the same commit legitimately appears as `22b52f2` in one
 *  record and `22b52f2c9d…` in another. A raw `===` says those differ, and the staleness check that
 *  followed it then asked `isAncestor(X, X)` — which is TRUE, since a commit is its own ancestor —
 *  and concluded the verdict was stale. A gate refusing an archive over a formatting difference is
 *  the failure this release exists to end, so identity is resolved through git rather than assumed
 *  from the string.
 *
 *  `null` when git cannot answer, the same third answer `isAncestor` gives and meaning the same
 *  thing. Local only. */
export function sameCommit(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return null;
  if (a === b) return true;
  const full = (r) => {
    try {
      return execFileSync("git", ["rev-parse", "--verify", `${r}^{commit}`],
        { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch { return null; }
  };
  const fa = full(a), fb = full(b);
  return fa && fb ? fa === fb : null;
}

/** The committer date of `sha`, as an ISO-8601 string, or null.
 *
 *  `null` is the same third answer `isAncestor` gives and means the same thing: git could not
 *  answer — no repository, no git binary, or a hash this repository has never seen. A check that
 *  compared a timestamp against a `null` date would be comparing against nothing, so every
 *  caller treats it as "this arm does not apply" rather than as a date in 1970.
 *
 *  `%cI` (committer date) rather than `%aI` (author date) on purpose: a rebased or cherry-picked
 *  commit keeps its author date from before the rebase, so an author date can sit BEFORE a
 *  review that genuinely read the rebased code. The committer date is when the commit as it
 *  stands came into existence, which is the quantity a review can be after.
 *
 *  Local only, per the engine's architectural law — this reads the object database and contacts
 *  nothing. */
export function commitDate(sha) {
  if (typeof sha !== "string" || !sha) return null;
  try {
    const out = execFileSync("git", ["show", "-s", "--format=%cI", sha],
      { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return out || null;
  } catch { return null; }
}

/** Does this repository's object database currently hold `sha` as a commit?
 *
 *  `rev-parse --verify <sha>^{commit}` rather than `cat-file -e`, matching sameCommit()'s idiom
 *  above: peeling to `^{commit}` makes a tag or a blob whose name happens to be spelled here
 *  answer false rather than true.
 *
 *  This is deliberately TWO-valued, and that is not a departure from isAncestor()'s three. It
 *  answers a question about THIS repository's object store — "do you have it" — which has no
 *  cannot-answer case: no git and no repository both mean this repository holds nothing, which
 *  is `false` and is true. What is genuinely unknowable is the INTERPRETATION of a `false`
 *  ("destroyed here" vs "a clone that never had it"), and that judgment is made from the
 *  population of answers rather than from any one of them — see the
 *  recorded-sha-the-repository-cannot-resolve check in integrity.mjs.
 *
 *  execFileSync with an argv array, never a shell string: these values reach us from
 *  `state.json`. Local only — reads the object database and contacts nothing. */
export function objectExists(sha) {
  if (typeof sha !== "string" || !sha) return false;
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", `${sha}^{commit}`],
      { cwd: ROOT, stdio: ["ignore", "ignore", "ignore"] });
    return true;
  } catch { return false; }
}

/** Is `sha` reachable from ANY ref — a branch, a tag, a remote-tracking ref, a note?
 *
 *  This is the question a squash-merge answers "no" to for every commit on the merged branch,
 *  while the objects themselves survive in the authoring clone until `git gc` prunes them
 *  (default `gc.pruneExpire`: two weeks). `for-each-ref` lists neither `HEAD` nor the reflog,
 *  which is exactly right: a commit kept alive only by a reflog entry is a commit on its way out.
 *
 *  Two-valued for the same reason objectExists() is, and callers only ever ask it about a sha
 *  objectExists() has already confirmed — so "git could not answer" and "no ref contains it"
 *  cannot both be live at that point. Local only. */
export function reachableFromAnyRef(sha) {
  if (typeof sha !== "string" || !sha) return false;
  try {
    const out = execFileSync("git",
      ["for-each-ref", "--contains", sha, "--count=1", "--format=%(refname)"],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return out.length > 0;
  } catch { return false; }
}
