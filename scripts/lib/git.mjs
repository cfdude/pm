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

export function appendDetourLog(kind, epic, note) {
  fs.mkdirSync(CONDUCTOR_DIR, { recursive: true });
  const line = [new Date().toISOString(), gitShortSha(), kind, epic || "-", (note || "").replace(/\s+/g, " ").trim()].join("\t");
  fs.appendFileSync(DETOURS_LOG, line + "\n");
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
