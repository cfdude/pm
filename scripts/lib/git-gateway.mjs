// scripts/lib/git-gateway.mjs
// ONE injected gateway over every git invocation the engine makes. 4.2 of
// functional-assertion-test-split (design D4).
//
// WHY A GATEWAY AT ALL. The assertion half runs the whole engine IN PROCESS (design D5), and
// the repository it runs against is a temporary directory rather than a git checkout. A half that
// ran real git would be the functional half — slow, and the thing the split exists to move off the
// per-commit path. So the assertion half passes a DOUBLE (scripts/test/fake-git.mjs), the functional
// half passes the real one, and the engine cannot tell which it was handed.
//
// WHY IT IS INJECTED RATHER THAN IMPORTED. D4: "no module imports it; every caller receives it." A
// module that imported this one could not be given a double without monkey-patching
// `child_process`, which fakes git for the WHOLE process including tests that want the real thing.
// So the gateway travels the way every other per-invocation value does (D3): it is a field of the
// invocation context, and callers reach it through `gitOps()` in lib/invocation.mjs. `main()` puts
// `io.git` there when the caller supplied one; lib/invocation.mjs builds the real one otherwise.
// THIS FILE IMPORTS NOTHING FROM THE ENGINE, deliberately — invocation.mjs imports it, so anything
// it imported would cycle through the module every other module depends on.
//
// ONE OPERATION PER INVOCATION, not one generic runner. Twenty-three call sites became twenty-three
// operations (the count is DERIVED at apply time, never typed — see the guard in
// scripts/test/git-gateway-guard.test.mjs, which re-runs the derivation against this file's source
// and fails when the two disagree). A generic `git(args)` would put the arg shapes in the callers,
// which is where the fake could not answer them; a named operation is also the unit a fresh capture
// is recorded against (4.3/4.4).
//
// EVERY OPERATION KEEPS ITS CALL SITE'S EXACT SHAPE — the argv, the `stdio`, the `encoding`, the
// `input`, the `env` overrides and the maxBuffer are the ones the site it replaces used, because
// this is a refactor and not a behaviour change. Two consequences worth naming:
//   * THREE of the twenty-three sites run through a SHELL (`execSync` with a command string), and
//     DESIGN D4 says the gateway therefore takes a command for those. They are not "cleaned up" into
//     argv pairs here: that would be a behaviour change smuggled into a refactor.
//   * EVERY OPERATION THROWS ON A NON-ZERO STATUS, exactly as `execFileSync`/`execSync` do, and
//     every caller's try/catch is unchanged. Several callers read git's exit STATUS as data —
//     `isAncestor` distinguishes exit 1 from every other failure, `headRef` distinguishes exit 1
//     from 128 — so the error must carry `status`, and the operations neither swallow nor
//     reinterpret it.

import { execFileSync, execSync } from "node:child_process";

/** The default git: every operation reads the INVOCATION's root and environment, through the thunk
 *  `context` supplies, so a gateway built once for a process is still per-invocation in what it
 *  reads. `lib/invocation.mjs` passes a live view of the process for a caller that never entered
 *  through `main()`, and `main()` itself passes the context it was handed. */
export function realGit(context) {
  const root = () => context().root;
  const env = () => context().env;

  return {
    // ── lib/git.mjs, 11 sites ──────────────────────────────────────────────────────────────────
    // git.mjs:11 — the abbreviated HEAD, or a throw the caller turns into "-".
    shortHead: () =>
      execSync("git rev-parse --short HEAD", { cwd: root(), stdio: ["ignore", "pipe", "ignore"] }).toString().trim(),

    // git.mjs:57 — `symbolic-ref --quiet HEAD`. Its EXIT STATUS IS THE ANSWER (1 = detached,
    // 128 = not a repository), so the throw is the value and the caller discriminates it.
    headRef: (at) =>
      execFileSync("git", ["symbolic-ref", "--quiet", "HEAD"], { cwd: at ?? root(), stdio: ["ignore", "ignore", "ignore"] }),

    // git.mjs:123 — the abbreviated name of one commit.
    abbreviateCommit: (rev) =>
      execFileSync("git", ["rev-parse", "--short", String(rev)],
        { cwd: root(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(),

    // git.mjs:131 — peel `rev` to a commit and print its full object name.
    verifyCommitName: (rev) =>
      execFileSync("git", ["rev-parse", "--verify", "--quiet", `${String(rev)}^{commit}`],
        { cwd: root(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(),

    // git.mjs:205 — `merge-base --is-ancestor`; exit 0 yes, 1 no, anything else cannot-answer.
    mergeBaseIsAncestor: (a, b) =>
      execFileSync("git", ["merge-base", "--is-ancestor", a, b], { cwd: root(), stdio: ["ignore", "ignore", "ignore"] }),

    // git.mjs:231 — the committer date of one commit, ISO-8601.
    committerDate: (sha) =>
      execFileSync("git", ["show", "-s", "--format=%cI", sha],
        { cwd: root(), stdio: ["ignore", "pipe", "ignore"] }).toString().trim(),

    // git.mjs:256 — the same peel as verifyCommitName, and a SEPARATE operation because the two
    // callers ask different questions of it (a name, or does this clone hold it) and the guard
    // counts sites, not questions.
    commitExists: (sha) =>
      execFileSync("git", ["rev-parse", "--verify", "--quiet", `${sha}^{commit}`],
        { cwd: root(), stdio: ["ignore", "ignore", "ignore"] }),

    // git.mjs:276 — the refs containing a commit, capped at one by `--count=1`.
    refsContaining: (sha) =>
      execFileSync("git", ["for-each-ref", `--contains=${sha}`, "--count=1", "--format=%(refname)"],
        { cwd: root(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(),

    // git.mjs:322 — the paths under this pathspec that differ from HEAD, NUL-separated.
    diffNamesAgainstHead: (paths) =>
      execFileSync("git", ["diff", "-z", "--name-only", "HEAD", "--", ...paths],
        { cwd: root(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }),

    // git.mjs:394 — ONE `cat-file --batch-check` for a whole set of values, fed on stdin.
    batchCheckCommits: (lines) =>
      execFileSync("git", ["cat-file", "--batch-check"], {
        cwd: root(), encoding: "utf8", input: lines,
        stdio: ["pipe", "pipe", "ignore"], env: { ...env(), GIT_NO_LAZY_FETCH: "1" },
      }),

    // git.mjs:438 — which of these full object names `head` does not reach, in one rev-list.
    revListNotReached: (list, head) =>
      execFileSync("git", ["rev-list", ...list, "^" + head], {
        cwd: root(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 256 * 1024 * 1024,
        env: { ...env(), GIT_NO_LAZY_FETCH: "1" },
      }),

    // ── lib/created-at.mjs, 3 sites ────────────────────────────────────────────────────────────
    // created-at.mjs:62 — the shallow-repository flag, printed as the literal `true`/`false`.
    isShallowRepository: () =>
      execFileSync("git", ["rev-parse", "--is-shallow-repository"],
        { cwd: root(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(),

    // created-at.mjs:65 — a git-internal path, RELATIVE to the directory git ran in.
    gitPath: (name) =>
      execFileSync("git", ["rev-parse", "--git-path", name],
        { cwd: root(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(),

    // created-at.mjs:99 — the pickaxe over a fixed string, oldest first.
    logPickaxe: (needle, pathspec) =>
      execFileSync("git", ["log", `-S${needle}`, "--reverse", "--format=%H %cI", "--", pathspec],
        { cwd: root(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }),

    // ── lib/subcommands.mjs, 4 sites ───────────────────────────────────────────────────────────
    // subcommands.mjs:200 — the names one commit changed, NUL-separated and unquoted.
    diffTreeNames: (sha) =>
      execFileSync("git", ["diff-tree", "-z", "--no-commit-id", "--name-only", "-r", "--root", sha],
        { cwd: root(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }),

    // subcommands.mjs:205 — this directory's prefix inside the git tree, with quotePath off so it
    // stays comparable with `diff-tree -z`'s unquoted paths.
    showPrefix: () =>
      execFileSync("git", ["-c", "core.quotePath=false", "rev-parse", "--show-prefix"],
        { cwd: root(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }),

    // subcommands.mjs:229 — the subject line of one commit.
    commitSubject: (sha) =>
      execFileSync("git", ["log", "-1", "--format=%s", sha],
        { cwd: root(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(),

    // subcommands.mjs:240 — the subject line of HEAD. A SHELL command at its call site and kept as
    // one (D4); the string is a constant, so there is nothing for a shell to interpolate.
    headSubject: () =>
      execSync("git log -1 --format=%s", { cwd: root(), stdio: ["ignore", "pipe", "ignore"] }).toString().trim(),

    // ── lib/commit-watch.mjs, 1 site ───────────────────────────────────────────────────────────
    // commit-watch.mjs:72 — the module's own `gitOut(args, root)` helper, whose three CALLERS pass
    // three different arg lists. It stays generic HERE, which is why this file holds one exec site
    // for those three callers: the callers' arg SHAPES are commit-watch's business, and the fake
    // answers this operation by matching the args it is handed.
    commitWatchGit: (args, at) =>
      execFileSync("git", args, { cwd: at ?? root(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(),

    // ── lib/worktree-hygiene.mjs, 2 sites ──────────────────────────────────────────────────────
    // worktree-hygiene.mjs:37 — the porcelain worktree listing. A SHELL command at its call site,
    // kept as one (D4): the string is a constant.
    worktreeList: () =>
      execSync("git worktree list --porcelain", { cwd: root(), encoding: "utf8" }),

    // worktree-hygiene.mjs:77 — is this worktree's head already merged into HEAD. `stdio: "ignore"`
    // at the call site, which is not the same option as the `["ignore","ignore","ignore"]` above.
    mergeBaseIsAncestorOfHead: (sha) =>
      execFileSync("git", ["merge-base", "--is-ancestor", sha, "HEAD"], { cwd: root(), stdio: "ignore" }),

    // ── lib/tool-currency.mjs, 1 site ──────────────────────────────────────────────────────────
    // tool-currency.mjs:149 — the tracked files under a pathspec, relative to this directory.
    lsFiles: (paths) =>
      execFileSync("git", ["ls-files", "--", ...paths],
        { cwd: root(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }),

    // ── lib/constants.mjs, 1 site ──────────────────────────────────────────────────────────────
    // constants.mjs:1641 — the tag HEAD is exactly at, or a throw when it is at none.
    describeExactTag: () =>
      execFileSync("git", ["describe", "--tags", "--exact-match", "HEAD"],
        { cwd: root(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(),
  };
}

/** THE DECLARED TABLE the call-site guard asserts against.
 *
 *  `command` is the operation's git invocation as a single normalized string, and it is the JOINING
 *  KEY: scripts/test/git-gateway-guard.test.mjs derives the same string from this file's own
 *  `execSync`/`execFileSync` calls and requires the two SETS to be equal. The guard's derivation is
 *  mechanical (a regex over the source, not a list), so a call site added to this file later without
 *  an entry here fails the guard, and so does one added to ANY OTHER engine module — which is the
 *  property the gateway exists to hold.
 *
 *  `asks` is for the reader and for the failure message; nothing is keyed on it. */
export const GIT_OPERATIONS = [
  { name: "shortHead", command: "git rev-parse --short HEAD", asks: "the abbreviated object name of HEAD" },
  { name: "headRef", command: "git symbolic-ref --quiet HEAD", asks: "the ref HEAD points at; exit 1 means detached" },
  { name: "abbreviateCommit", command: "git rev-parse --short <rev>", asks: "one commit's abbreviated name" },
  { name: "verifyCommitName", command: "git rev-parse --verify --quiet <rev>^{commit}", asks: "one value's full object name, peeled to a commit" },
  { name: "mergeBaseIsAncestor", command: "git merge-base --is-ancestor <a> <b>", asks: "is a an ancestor of b" },
  { name: "committerDate", command: "git show -s --format=%cI <sha>", asks: "one commit's committer date" },
  { name: "commitExists", command: "git rev-parse --verify --quiet <sha>^{commit}", asks: "does this clone hold that commit" },
  { name: "refsContaining", command: "git for-each-ref --contains=<sha> --count=1 --format=%(refname)", asks: "is the commit reachable from any ref" },
  { name: "diffNamesAgainstHead", command: "git diff -z --name-only HEAD -- <paths...>", asks: "which of these paths differ from HEAD" },
  { name: "batchCheckCommits", command: "git cat-file --batch-check", asks: "resolve a set of commit values in one process" },
  { name: "revListNotReached", command: "git rev-list <commits...> ^<head>", asks: "which of these are not reached by head" },
  { name: "isShallowRepository", command: "git rev-parse --is-shallow-repository", asks: "is this a shallow clone" },
  { name: "gitPath", command: "git rev-parse --git-path <name>", asks: "a git-internal path, relative to this directory" },
  { name: "logPickaxe", command: "git log -S<needle> --reverse --format=%H %cI -- <pathspec>", asks: "when a fixed string first appeared in these paths" },
  { name: "diffTreeNames", command: "git diff-tree -z --no-commit-id --name-only -r --root <sha>", asks: "the names one commit changed" },
  { name: "showPrefix", command: "git -c core.quotePath=false rev-parse --show-prefix", asks: "this directory's prefix inside the git tree" },
  { name: "commitSubject", command: "git log -1 --format=%s <sha>", asks: "one commit's subject line" },
  { name: "headSubject", command: "git log -1 --format=%s", asks: "HEAD's subject line" },
  { name: "commitWatchGit", command: "git <args...>", asks: "commit-watch's own plumbing, for the three arg lists it passes" },
  { name: "worktreeList", command: "git worktree list --porcelain", asks: "every worktree, its HEAD and its branch" },
  { name: "mergeBaseIsAncestorOfHead", command: "git merge-base --is-ancestor <sha> HEAD", asks: "is a worktree's head already merged into HEAD" },
  { name: "lsFiles", command: "git ls-files -- <paths...>", asks: "the tracked files under a pathspec" },
  { name: "describeExactTag", command: "git describe --tags --exact-match HEAD", asks: "the tag HEAD is exactly at, if any" },
];
