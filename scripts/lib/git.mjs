// scripts/lib/git.mjs
// git plumbing (current SHA) and the append-only detour log. Depends only on
// lib/constants.mjs.

import fs from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { ROOT, CONDUCTOR_DIR, DETOURS_LOG, CONTROL_CHARACTER, escapeControls } from "./constants.mjs";

export function gitShortSha() {
  try { return execSync("git rev-parse --short HEAD", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { return "-"; }
}

/** IS THIS TREE A PLACE TO WORK? Three states, and `unknown` is a real third answer rather than a
 *  synonym for `attached`, even though both write normally — collapsing them is how a future
 *  reader turns "git could not say" into "the tree is a workspace" and takes the discrimination
 *  below with it.
 *
 *  gh#175. pm's dormancy guard asks whether `.conductor/state.json` EXISTS, and that file is
 *  git-tracked by design because `git restore` is the documented undo. A repository that deploys by
 *  checking ITSELF out therefore carries state.json in the deployed copy and reads as a workspace.
 *  One file was answering two questions — is this repository pm-managed, and is this tree a place
 *  to work — which diverge exactly there. Measured: a production checkout detached at a tag held a
 *  commit watermark, a brief snapshot and an activity log, and a fleet upgrade later stamped a new
 *  pmVersion and rewrote the rules block into it, all of which the next `git checkout --force`
 *  discards.
 *
 *  `symbolic-ref --quiet HEAD` rather than `rev-parse --abbrev-ref HEAD`, for two independent
 *  reasons: the latter returns the literal string `HEAD` when detached — which is also a legal ref
 *  name, so the comparison is ambiguous by construction — and it exits 128 on an UNBORN HEAD,
 *  putting every fresh repository on the error path.
 *
 *  THE EXIT STATUS IS DISCRIMINATED, not merely tested for non-zero. Status 1 is a detached HEAD;
 *  128 is "not a repository"; a throw is git missing from PATH. `catch → detached` would make a
 *  non-repository SUPPRESS writes, which is the opposite of the safe direction — a false record is
 *  visible and removable, a false suppression silently disables the trail. Same shape as
 *  `isAncestor()` below, deliberately.
 *
 *  TAKES THE ROOT IT IS ASKED ABOUT, defaulting to `ROOT`. gh#175 Gate 2 C-A: a caller must be
 *  able to ask about THE TREE IT IS WRITING TO, and one of them derives that per call. `ROOT` is
 *  frozen at constants.mjs load, while `activityDir()` re-derives from CLAUDE_PROJECT_DIR every
 *  time — deliberately, so tests can move it. Guarding one tree while writing to another is
 *  silently wrong in-process, and it broke this repository's own suite under a detached ROOT,
 *  which is EVERY CI run: `actions/checkout` leaves HEAD detached at the sha. The CLI never
 *  diverges (one root, fixed at startup), which is exactly why a local run could not see it.
 *
 *  CACHED PER PROCESS, PER ROOT. Every caller is a write path that would otherwise spawn git
 *  again, and HEAD does not move under a running invocation. Keyed by root so asking about a
 *  second tree is answered, not served a stale answer about the first. */
const headAttachmentCache = new Map();
export function headAttachment(root = ROOT) {
  if (headAttachmentCache.has(root)) return headAttachmentCache.get(root);
  let answer;
  try {
    execFileSync("git", ["symbolic-ref", "--quiet", "HEAD"],
      { cwd: root, stdio: ["ignore", "ignore", "ignore"] });
    answer = "attached";
  } catch (e) {
    answer = e && e.status === 1 ? "detached" : "unknown";
  }
  headAttachmentCache.set(root, answer);
  return answer;
}

/** `true` only where git SAID the tree is detached. An unanswerable probe is not detachment, which
 *  is why every caller asks this rather than `!== "attached"`. */
export const isDetachedTree = (root = ROOT) => headAttachment(root) === "detached";

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
  // gh#175: a detour is BY DEFINITION an interruption of active work, and a detached tree is one
  // nobody is working in. Suppressed silently, like every other session-bookkeeping write.
  if (isDetachedTree()) return false;
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

/** Which of `paths` — each ROOT-relative, as `generatedArtifactsTracked()`'s pathspec is —
 *  currently DIFFER from HEAD. In other words: what is there here to commit.
 *
 *  WHY THIS EXISTS. A machine-wide sweep on 2026-09-08 found NINE repositories where
 *  `/pm:upgrade` or `openspec update` had run, succeeded, rewritten git-tracked files, and been
 *  left uncommitted — git recording an old version while the session read the new rules off
 *  disk. Two repos sat six days with git saying pm 0.16.0 and disk running 0.39.0; one was two
 *  OpenSpec upgrades deep. Nothing catches it because nothing is broken: the session reads the
 *  new files, so everything works. And `tool-currency.mjs` resolves the project version from the
 *  `generatedBy:` stamp ON DISK, so an uncommitted upgrade makes the one surface built to notice
 *  staleness go quiet — correct for what that function measures, and the reason no surface
 *  anywhere is watching.
 *
 *  ONE PROBE, THREE ANSWERS, and that is why it is `git diff` rather than `git ls-files`:
 *    - content that did not change never appears, so an idempotent re-run stays SILENT — and a
 *      writer that rewrites byte-identical content (`writeRules` does exactly that) cannot
 *      produce a false positive the way an mtime or a "we wrote it" flag would;
 *    - a path that is untracked or GITIGNORED never appears, so a repo that git-ignores the
 *      file is never told to commit something git would refuse;
 *    - what remains is the `git add` list.
 *  `generatedArtifactsTracked()` is deliberately NOT reused: it hardcodes the OpenSpec generated
 *  paths in both its pathspec and its result regex, and answers a different question — "will a
 *  diff exist for THOSE files" — about files this never looks at.
 *
 *  The pathspec and the returned values are CWD-RELATIVE for the reason tool-currency.mjs's
 *  probe is: `git` walks UP to find a repository, so a pm-managed project nested inside a larger
 *  repo must be described in its own terms. `git diff --name-only` prints ROOT-relative paths,
 *  so the caller's own strings are returned rather than git's output — printing git's would
 *  hand a nested project a `git add` line that does not work from where it is standing.
 *
 *  `[]` on any failure — no HEAD yet, not a git repository, git absent. Every one of those means
 *  there is no commit to compare against, and a nudge derived from a comparison that never
 *  happened would be asserting work it did not measure. */
export function differsFromHead(paths) {
  if (!paths || !paths.length) return [];
  try {
    const out = execFileSync("git", ["diff", "--name-only", "HEAD", "--", ...paths], {
      cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    });
    const changed = out.split("\n").map(l => l.trim()).filter(Boolean);
    return paths.filter(p => changed.some(l => l === p || l.endsWith(`/${p}`)));
  } catch { return []; }
}

/** The full object name of a commit, as git prints it: 40 hex in a SHA-1 repository, 64 in a
 *  SHA-256 one. Never a hardcoded 40 — a SHA-256 repository is a git repository too. */
export const FULL_COMMIT_NAME = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/** Is `v` SHAPED as a hexadecimal commit object name — full or abbreviated?
 *
 *  THE ONE PREDICATE the staleness rule (archive-gate.mjs gateStaleness) and the integrity report
 *  (`recorded-sha-the-repository-cannot-resolve`'s not-an-object-name arm) share, so the two can
 *  never disagree about which recorded value is malformed. A value failing it — `HEAD`, `main~1`,
 *  `not-a-commit` — was stored before write-time resolution existed, and it is NEVER resolved as a
 *  ref at read time: which commit a moving ref named when it was written is not recoverable from
 *  the record. A value passing it is a commit name this clone may or may not hold. */
export function isCommitNameShaped(v) {
  return typeof v === "string" && /^[0-9a-f]{4,64}$/.test(v);
}

/** Resolve commit values against THIS repository's object database, in ONE git process.
 *
 *  gates-bind-to-verified-evidence Decision 7. Every commit value pm records — `--attribute-commit`,
 *  `--withdraw-commit`, `--base-sha`, `--head-sha` — used to be stored exactly as typed, so a string
 *  that is not a commit turned a refused archive into an accepted one (it read `unverifiable`), and a
 *  moving ref like `HEAD` meant a different commit every time the record was read.
 *
 *  `git cat-file --batch-check` fed `<value>^{commit}` per line: peeling to `^{commit}` makes a tag
 *  resolve to the commit it names and a tree or blob name answer `missing`. Output is mapped to input
 *  BY LINE ORDER, so a value that could split one input line into two — whitespace, a control
 *  character — is unresolved before the process starts. A `missing` or `ambiguous` line, or a
 *  process that could not run at all, leaves the value unresolved. There is NO fallback: a second
 *  resolution path would be a second behaviour.
 *
 *  FORBIDDEN here, and in every freshness decision built on this: anything reading the current
 *  branch or asking which refs contain a commit (`merge-base --is-ancestor <x> HEAD`, `branch
 *  --contains`, `for-each-ref --contains`). A squash-merged commit is reachable only from a
 *  `presquash/*` tag, and CI's checkout is detached; each of those probes answers "no" for a commit
 *  this repository holds. Resolution asks only whether the object is here.
 *
 *  `GIT_NO_LAZY_FETCH=1`, spread over `process.env` (the test suite's hermetic git config lives
 *  there): a partial clone must never fetch from its promisor remote to answer — the engine opens
 *  no network connection.
 *
 *  CACHED PER PROCESS for hexadecimal values only. A hex name names the same commit for the life of
 *  the process; a ref (`HEAD`, `main~1`) does not, and caching one would make the second write in a
 *  process record where the ref USED to point.
 *
 *  @returns {{resolved: Map<string,string>, unresolved: string[]}} */
const resolvedCommitCache = new Map();
export function resolveCommits(values) {
  const resolved = new Map();
  const unresolved = [];
  const asked = [];
  for (const v of [...new Set(Array.isArray(values) ? values : [])]) {
    if (typeof v !== "string") continue;
    if (!v || /\s/.test(v) || CONTROL_CHARACTER.test(v)) { unresolved.push(v); continue; }
    if (resolvedCommitCache.has(v)) {
      const hit = resolvedCommitCache.get(v);
      if (hit) resolved.set(v, hit); else unresolved.push(v);
      continue;
    }
    asked.push(v);
  }
  if (!asked.length) return { resolved, unresolved };
  let lines = [];
  try {
    lines = execFileSync("git", ["cat-file", "--batch-check"], {
      cwd: ROOT, encoding: "utf8", input: asked.map(v => `${v}^{commit}\n`).join(""),
      stdio: ["pipe", "pipe", "ignore"], env: { ...process.env, GIT_NO_LAZY_FETCH: "1" },
    }).split("\n");
  } catch { lines = []; }
  asked.forEach((v, i) => {
    const m = /^([0-9a-f]{40}(?:[0-9a-f]{24})?) commit \d+$/.exec(lines[i] || "");
    const full = m ? m[1] : null;
    if (isCommitNameShaped(v)) resolvedCommitCache.set(v, full);
    if (full) resolved.set(v, full); else unresolved.push(v);
  });
  return { resolved, unresolved };
}

/** The one refusal wording for commit values that did not resolve, named together so a caller
 *  fixes every one in a single re-run. */
export function unresolvedCommitsMessage(unresolved, flags) {
  return `conductor: ${flags} ${unresolved.length === 1 ? "value" : "values"} ` +
    `${unresolved.map(v => escapeControls(JSON.stringify(v))).join(", ")} ` +
    `${unresolved.length === 1 ? "does" : "do"} not resolve to exactly one commit in this repository's ` +
    "object database — not a commit, ambiguous, or absent from this clone. A recorded commit is " +
    "resolved when it is written and stored as its full object name, so a value nobody can check " +
    "is never recorded. Nothing was written.\n";
}

/** Which of `commits` (FULL object names) are NOT reached by `head` (a full object name) — equal to
 *  it or one of its ancestors counts as reached. ONE `git rev-list <commits…> ^<head>` for the whole
 *  set (gates-bind-to-verified-evidence Decision 9): a per-commit `merge-base --is-ancestor` loop
 *  measured 139 git calls / ~711 ms over this repository's record, against 14 calls / ~70 ms batched.
 *
 *  `null` when git could not answer — a missing object makes rev-list exit non-zero — and a caller
 *  must read `null` as UNANSWERABLE, never as "all reached": that is the direction of the bug a
 *  `covers !== true → fresh` branch shipped. Reachability from a branch or any ref is never asked.
 *
 *  Cached per process by (head, commits): full object names are immutable. */
const unreachedCache = new Map();
export function commitsNotReachedBy(commits, head) {
  const list = [...new Set((commits || []).filter(c => FULL_COMMIT_NAME.test(c)))];
  if (!FULL_COMMIT_NAME.test(head || "")) return null;
  if (!list.length) return new Set();
  const key = head + " " + [...list].sort().join(" ");
  if (unreachedCache.has(key)) return unreachedCache.get(key);
  let answer;
  try {
    const out = execFileSync("git", ["rev-list", ...list, "^" + head], {
      cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 256 * 1024 * 1024,
      env: { ...process.env, GIT_NO_LAZY_FETCH: "1" },
    });
    const listed = new Set(out.split("\n").map(l => l.trim()).filter(Boolean));
    answer = new Set(list.filter(c => listed.has(c)));
  } catch { answer = null; }
  unreachedCache.set(key, answer);
  return answer;
}
