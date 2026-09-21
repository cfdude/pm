// scripts/test/fixtures/git-gateway-repo.mjs
// THE DETERMINISTIC REPOSITORY THE GIT GATEWAY'S CAPTURES ARE TAKEN AGAINST — and the case list both
// sides of the fake-versus-live check are driven from (4.3/4.4 of functional-assertion-test-split).
//
// WHY IT IS BUILT RATHER THAN COMMITTED. A checked-in repository cannot carry a git directory inside
// another git directory without becoming part of the history it is meant to be independent of, and
// `git worktree list` names absolute paths, so no static directory could answer it either. What IS
// committed is the CAPTURE (fixtures/git-gateway-capture.json) — git's answers, frozen.
//
// IT IS DETERMINISTIC ON PURPOSE, and that is what makes a FROZEN capture checkable at all: a capture
// that had to be compared against a repository whose object names changed every run would prove
// nothing. Four things make every answer here reproducible:
//   * fixed author and committer identities and DATES (including the timezone offset), so the commit
//     objects — and therefore their sha-1 names — are the same on every run and every machine;
//   * fixed file contents and messages;
//   * `init -b main`, so the branch name is not the machine's `init.defaultBranch`;
//   * the developer's git CONFIG is not consulted at all: GIT_CONFIG_GLOBAL is pointed at
//     /dev/null and the system config is disabled, so `core.abbrev`, `log.showSignature`,
//     `core.autocrlf` and everything else a machine's config could change about git's OUTPUT are
//     out of the picture. The two variables are set on `process.env` at import because a spawned
//     child inherits it and the byte check must run the real gateway under the SAME isolation the
//     fixture was built under; the test tree's hermetic-git.mjs sets the template and signing keys
//     for the same reason, and this is imported first by everything here.
//
// THE ONE NORMALIZATION IS THE ROOT PATH, and it is stated rather than hidden. `git worktree list
// --porcelain` prints the absolute path of every worktree and `headRef` is asked about a root that is
// a fresh temporary directory, so neither side can be byte-identical without a substitution. Each
// fixture root maps to its own token (`<ROOT>` for the attached repository, `<ROOT-DETACHED>` for the
// detached one, since headRef answers differently about each), and BOTH SIDES substitute: the check
// over what git printed, the fake over what it was asked. Nothing else is normalized — a difference
// anywhere else is a difference.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { GIT_OPERATIONS, realGit } from "../../lib/git-gateway.mjs";

// Isolate the fixture from the machine's git config, before any git process starts. `??=` so an
// explicit value from the caller (a debugger, a bisect) wins.
process.env.GIT_TEMPLATE_DIR ??= "";
process.env.GIT_CONFIG_GLOBAL ??= "/dev/null";
process.env.GIT_CONFIG_NOSYSTEM ??= "1";

export const ROOT_TOKEN = "<ROOT>";
/** The detached fixture's token — see rootsOf(). */
export const ROOT_DETACHED_TOKEN = "<ROOT-DETACHED>";
/** The NO-REPOSITORY fixture's token. The assertion half's invocation root is a fresh temporary
 *  directory with no `git init` anywhere above it, so this is the world its double has to model —
 *  see `buildNoRepositoryCapture()` and `fakeGit({ noRepository: true })`. */
export const NO_REPO_TOKEN = "<NO-REPO>";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CAPTURE_PATH = path.join(HERE, "git-gateway-capture.json");

/** The date every object in the fixture is stamped with. An explicit offset, because a bare ISO
//  timestamp is interpreted in the machine's zone and would move the %cI output with it. */
const WHEN = "2020-01-02T03:04:05+00:00";
const IDENTITY = {
  GIT_AUTHOR_NAME: "pm fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "pm fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  GIT_AUTHOR_DATE: WHEN, GIT_COMMITTER_DATE: WHEN,
};

/** The needle `created-at.mjs`'s pickaxe looks for, in the shape it looks for it: the record's own
 *  `"id": "<id>"` key, which is what makes the search precise rather than matching a title. */
const EPIC_ID = "e1";
const STATE_JSON = JSON.stringify({ revision: 1, epics: [{ id: EPIC_ID, title: "first", status: "queued" }] }, null, 2) + "\n";

/** Run git in `cwd` with the fixture's fixed identity, failing loudly on a non-zero status — a
 *  silently half-built fixture would produce a capture that looks fine and is wrong. */
function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...IDENTITY } });
  if (r.status !== 0) throw new Error(`fixture: git ${args.join(" ")} exited ${r.status}: ${r.stderr}`);
  return (r.stdout || "").trim();
}

/** Substitute a fixture root for the token, in a string or in a case's args. Applied by the CHECK to
 *  what git actually printed and by the FAKE to what it is actually asked; the capture holds neither
 *  the real path nor a value that depends on it. */
export function rootToToken(text, roots) {
  const list = Array.isArray(roots) ? roots : [roots];
  if (typeof text === "string") {
    let out = text;
    for (const { root, token } of list) {
      // BOTH SPELLINGS. `os.tmpdir()` answers `/var/folders/...` on macOS while git prints the
      // PHYSICAL `/private/var/folders/...`, so substituting only the first leaves an absolute path
      // in the capture and the check would fail on a machine-dependent prefix. Substituting the
      // realpath too is what makes the token the same string on both sides.
      let real = root;
      try { real = fs.realpathSync(root); } catch { /* not on disk: the mkdtemp path is all there is */ }
      out = out.split(real).join(token).split(root).join(token);
    }
    return out;
  }
  if (Array.isArray(text)) return text.map(t => rootToToken(t, list));
  return text;
}

/** Every root a fixture built, each with the token that stands in for it: the attached repository and
 *  the detached one. TWO TOKENS RATHER THAN ONE, and the reason is mechanical — `headRef` is asked
 *  about each and they answer differently (0 attached, 1 detached), so with one token the fake would
 *  have two cases with identical args and no way to choose between them. */
export const rootsOf = (fx) => [
  { root: fx.attached.root, token: ROOT_TOKEN },
  { root: fx.detached.root, token: ROOT_DETACHED_TOKEN },
];

/** Build one fixture repository and return the names of everything the cases refer to.
 *
 *  The commit graph is deliberately more than a straight line: c3 is committed on a branch that is
 *  then DELETED, so it survives as an object no ref reaches — which is the only state in which
 *  `git rev-list <c3> ^HEAD` prints anything, and the state `commitsNotReachedBy` exists to detect
 *  (a squash-merged commit). A linked worktree is added for the same reason: `git worktree list
 *  --porcelain` has a one-entry answer in a bare clone and only shows its real shape with two. */
function buildAt(prefix, { detach = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  git(root, "init", "-q", "-b", "main");
  fs.mkdirSync(path.join(root, ".conductor"), { recursive: true });
  fs.mkdirSync(path.join(root, ".claude", "skills", "openspec-apply"), { recursive: true });
  fs.writeFileSync(path.join(root, ".conductor", "state.json"), STATE_JSON);
  fs.writeFileSync(path.join(root, ".claude", "skills", "openspec-apply", "SKILL.md"), "apply\n");
  fs.writeFileSync(path.join(root, "README.md"), "one\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "one");
  const c1 = git(root, "rev-parse", "HEAD");

  fs.writeFileSync(path.join(root, "README.md"), "one\ntwo\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "two");
  const c2 = git(root, "rev-parse", "HEAD");
  git(root, "tag", "v-fixture");

  // c3: committed on a branch that is then deleted. It stays in the object database and is reached
  // by nothing — `rev-list <c3> ^<c2>` is the only question that answers non-empty for it.
  git(root, "checkout", "-q", "-b", "abandoned");
  fs.writeFileSync(path.join(root, "README.md"), "one\ntwo\nthree\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "three");
  const c3 = git(root, "rev-parse", "HEAD");
  git(root, "checkout", "-q", "main");
  git(root, "branch", "-D", "abandoned");

  // A dirty tracked file, so `git diff --name-only HEAD -- README.md` answers with a name rather
  // than with nothing.
  fs.writeFileSync(path.join(root, "README.md"), "one\ntwo\ndirty\n");

  let worktree = null;
  if (!detach) {
    worktree = root + "-wt";
    // The branch is named so `refs/heads/main` sorts before it: `for-each-ref --contains=<HEAD>
    // --count=1` answers with the alphabetically first containing ref, and the fixture reads better
    // naming the branch the engine's own commit is on.
    git(root, "worktree", "add", "-q", worktree, "-b", "wt-branch");
  }
  if (detach) git(root, "checkout", "-q", "--detach", c2);

  return { root, c1, c2, c3, worktree, tag: "v-fixture" };
}

/** The whole fixture: an attached repository whose case list the capture was taken from, and one
 *  detached repository, which exists solely so `headRef`'s DISCRIMINATING answer — a throw with
 *  status 1 — has a live side to be checked against. The third root is NOT a repository at all —
 *  see `buildNoRepositoryCapture()`. */
export function buildFixture() {
  return {
    attached: buildAt("pm-gateway-fx-"),
    detached: buildAt("pm-gateway-fx-det-", { detach: true }),
    // A plain temporary directory: no `git init`, and nothing above it either, so every git command
    // run with this as its cwd answers 128 "not a git repository". That is the world the ASSERTION
    // half's invocations run in (design D5's placement rule sends a test that needs a real
    // repository to the functional half), so the double has to model it rather than guess at it.
    plain: fs.mkdtempSync(path.join(os.tmpdir(), "pm-gateway-fx-plain-")),
  };
}

/** THE ASSERTION HALF'S WORLD, CAPTURED. Every gateway operation run with a non-repository
 *  directory as the invocation's root, frozen the same way the repository cases are and checked
 *  against the live git by the same 4.4 test.
 *
 *  ARGUMENTS ARE DELIBERATELY THE SAME SHAPES AS `casesFor()`, and the answers do not depend on
 *  them at all: git fails before it reads them. That is why the fake built from this section
 *  answers PER OPERATION rather than per argument — see `fakeGit({ noRepository: true })` and the
 *  note there on why that is not the "plausible default" the arg-keyed mode refuses.
 *
 *  This section exists because the alternative is a silent lie in the other direction. Without it
 *  the double would answer every root-less operation with the FIXTURE repository's answer —
 *  `shortHead()` returning a commit the test's directory does not contain, `worktreeList()`
 *  listing a worktree that does not exist — and the assertion half would be asserting against a
 *  repository that is not there. */
export function buildNoRepositoryCapture(plain) {
  const gateway = realGit(() => ({ root: plain, env: process.env }));
  // Placeholder values, not a real repository's: git never gets as far as reading them here, which
  // is the point — the answer is the same for every argument, so the arguments cannot matter.
  const aSha = "0".repeat(40);
  const argsFor = {
    headRef: [plain], commitWatchGit: [["rev-parse", "--git-dir"], plain],
    abbreviateCommit: [aSha], verifyCommitName: [aSha], mergeBaseIsAncestor: [aSha, aSha],
    committerDate: [aSha], commitExists: [aSha], refsContaining: [aSha],
    diffNamesAgainstHead: [["README.md"]], batchCheckCommits: [`${aSha}^{commit}\n`],
    revListNotReached: [[aSha], aSha], gitPath: ["shallow"], logPickaxe: ["x", ".conductor/state.json"],
    diffTreeNames: [aSha], commitSubject: [aSha], mergeBaseIsAncestorOfHead: [aSha],
    lsFiles: [[".claude/skills"]],
  };
  const roots = { root: plain, token: NO_REPO_TOKEN };
  const out = {};
  for (const op of REQUIRED_OPERATIONS) {
    const answer = callReal(gateway, op, argsFor[op] ?? []);
    out[op] = {
      status: answer.status,
      value: rootToToken(answer.value, roots),
      ...(answer.stderr ? { stderr: rootToToken(answer.stderr, roots) } : {}),
    };
  }
  return out;
}

/** EVERY INVOCATION THE CHECK AND THE CAPTURE ARE DRIVEN FROM — one object per call, `args` being
 *  what the operation is called with.
 *
 *  THE COVERAGE IS ASSERTED, not assumed: the test requires this list to exercise every operation in
 *  GIT_OPERATIONS, so an operation added to the gateway without a case here fails rather than
 *  quietly going uncaptured. Each case names a real call the engine makes, not a synthetic one, so a
 *  capture that drifted from the engine's usage would show up as a missing answer in the fake. */
export function casesFor(fx) {
  const a = fx.attached, d = fx.detached;
  const absent = "0".repeat(40);
  return [
    { op: "shortHead", args: [] },
    { op: "headRef", args: [a.root] },
    { op: "headRef", args: [d.root] },
    { op: "abbreviateCommit", args: [a.c2] },
    { op: "verifyCommitName", args: [a.c1] },
    { op: "verifyCommitName", args: [absent] },
    { op: "mergeBaseIsAncestor", args: [a.c1, a.c2] },
    { op: "mergeBaseIsAncestor", args: [a.c2, a.c1] },
    { op: "committerDate", args: [a.c2] },
    { op: "commitExists", args: [a.c1] },
    { op: "commitExists", args: [absent] },
    { op: "refsContaining", args: [a.c2] },
    { op: "diffNamesAgainstHead", args: [["README.md"]] },
    { op: "diffNamesAgainstHead", args: [["PROJECT.md"]] },
    { op: "batchCheckCommits", args: [`${a.c2}^{commit}\n${absent}^{commit}\n`] },
    { op: "revListNotReached", args: [[a.c3], a.c2] },
    { op: "revListNotReached", args: [[a.c2], a.c2] },
    { op: "isShallowRepository", args: [] },
    { op: "gitPath", args: ["shallow"] },
    { op: "logPickaxe", args: [`"id": "${EPIC_ID}"`, ".conductor/state.json"] },
    { op: "diffTreeNames", args: [a.c2] },
    { op: "showPrefix", args: [] },
    { op: "commitSubject", args: [a.c2] },
    { op: "headSubject", args: [] },
    { op: "commitWatchGit", args: [["rev-parse", "--git-dir"], a.root] },
    { op: "commitWatchGit", args: [["rev-parse", "--git-path", "logs/HEAD"], a.root] },
    { op: "commitWatchGit", args: [["for-each-ref", "--contains", a.c2, "--count=1", "--format=%(refname)", "refs/heads"], a.root] },
    { op: "worktreeList", args: [] },
    { op: "mergeBaseIsAncestorOfHead", args: [a.c1] },
    { op: "mergeBaseIsAncestorOfHead", args: [a.c3] },
    { op: "lsFiles", args: [[".claude/skills", ".claude/commands/opsx"]] },
    { op: "describeExactTag", args: [] },
  ];
}

/** The operation names the case list must cover — the gateway's own table, so the two cannot drift. */
export const REQUIRED_OPERATIONS = GIT_OPERATIONS.map(o => o.name);

/** WHEN IT IS LEGITIMATE TO REFRESH EACH OPERATION'S CAPTURE. Required by 4.3, and per operation
 *  rather than one sentence for the file, because the honest answer differs: an answer that moves
 *  when the fixture's own content moves is a different event from one a git release reformatted.
 *
 *  TWO ARE LEGITIMATE AND BOTH ARE DELIBERATE. 4.5 decides the git-version question: a live output
 *  that changes with the git version FAILS this check loudly rather than being absorbed, and
 *  refreshing the capture is then a deliberate edit which the certification record re-certifies. */
const REFRESH_WHEN = {
  worktreeList: "the porcelain format changes in a git release, OR the fixture gains or loses a worktree — both change the number of entries, which is the field a failure names",
  batchCheckCommits: "the fixture's commit content changes (the object size on the second field moves with it), or git stops printing `<name> commit <size>` for a peeled value",
  logPickaxe: "the fixture's first commit changes, or the pickaxe's output format moves",
};
const REFRESH_DEFAULT =
  "the fixture in git-gateway-repo.mjs changes (a new commit, path or tag moves this answer), or a git release changes this command's output. Never refresh to make a failing check pass — read the difference the failure names first";

/** Build the capture object from a fresh fixture. Both the first capture and any refresh come from
 *  HERE, so the file's shape and its provenance cannot drift apart. */
export function buildCapture(fx) {
  const gateway = realGit(() => ({ root: fx.attached.root, env: process.env }));
  const operations = {};
  for (const op of REQUIRED_OPERATIONS) {
    const declared = GIT_OPERATIONS.find(o => o.name === op);
    operations[op] = {
      asks: declared.asks,
      refreshWhen: REFRESH_WHEN[op] || REFRESH_DEFAULT,
      cases: [],
    };
  }
  const roots = rootsOf(fx);
  for (const c of casesFor(fx)) {
    const answer = callReal(gateway, c.op, c.args);
    operations[c.op].cases.push({
      args: rootToToken(c.args, roots),
      status: answer.status,
      value: rootToToken(answer.value, roots),
      ...(answer.stderr ? { stderr: rootToToken(answer.stderr, roots) } : {}),
    });
  }
  return {
    _what: "Frozen captures of the git gateway's operations (scripts/lib/git-gateway.mjs), for the assertion half's double (fixtures/fake-git.mjs). Committed deliberately: the double must not be reconstructed from the machine's git at test time.",
    _builtBy: "scripts/test/fixtures/git-gateway-repo.mjs buildCapture(), against the fixture that module builds",
    _normalization: `Each fixture root path is replaced by its token in every case's args and every case's value: ${ROOT_TOKEN} for the attached repository, ${ROOT_DETACHED_TOKEN} for the detached one. It is the ONE substitution either side makes — git worktree list --porcelain prints absolute paths, and headRef is asked about directories that are fresh temporary ones, so neither could be byte-identical without it. Nothing else is normalized.`,
    _refreshWhen: "Only when a failure has been READ and attributed to a real change — the fixture, or a git release reformatting a command's output. The check names the operation and the first differing line; a refresh that skips that step is a stale capture wearing a pass.",
    operations,
    noRepository: buildNoRepositoryCapture(fx.plain),
  };
}

/** Call one REAL operation and report its answer in the shape a case holds: the VALUE it returned,
 *  or the STATUS and stderr it threw with. `undefined` and Buffers are normalized, because those
 *  operations answer with their exit status rather than with output and the case has to record that
 *  answer the same way the fake will produce it. */
export function callReal(gateway, op, args) {
  try {
    const r = gateway[op](...args);
    // `undefined` and `null` are the same answer here: the four status-only operations return
    // whatever `execFileSync` gives back when every stdio is ignored, which is `null`.
    if (r === undefined || r === null) return { status: 0, value: null };
    return { status: 0, value: Buffer.isBuffer(r) ? r.toString("utf8") : String(r) };
  } catch (e) {
    return { status: e && typeof e.status === "number" ? e.status : -1, value: null, stderr: String((e && e.stderr) || "") };
  }
}
