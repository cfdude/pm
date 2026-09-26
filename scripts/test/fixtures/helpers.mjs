// Shared scaffolding for the split conductor test suite. Extracted verbatim from the former
// single-file scripts/conductor.test.mjs -- see docs/superpowers/plans for why it was split.
import "./hermetic-git.mjs";   // FIRST: every fixture git call must ignore the developer's global config
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ENGINE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "conductor.mjs");
// `EMPTY_CACHE` lives with the harness that sets it on every invocation's env (5.1) — this module
// is imported by both halves and by the fixtures, and the cache is one per process either way.
// IMPORTED, not only re-exported: `export { X } from "…"` creates NO local binding, and this module
// USES the cache itself (observationRepo/observe pass it to the engine they spawn). Re-exporting it
// alone left every one of those call sites with a ReferenceError — 39 tests in commit-observation
// alone — which is the loud failure rather than a silent one, and is why it was caught here.
import { EMPTY_CACHE } from "./harness.mjs";
export { EMPTY_CACHE };
// gh-cfdude-pm-224: every directory a helper here makes is scheduled for removal when the process
// exits — 0.49.0's one mechanism (`temp-dir.mjs`), not a second one. Unscheduled, `tmpRepo()` alone
// left ~1,850 directories in the OS temp dir per full run (both halves).
import { removeAtExit } from "./temp-dir.mjs";
// The half's `run`, registered by whichever harness module the importing test used. Helpers that
// drive the engine themselves (parseBrief, setupHierarchy, nudgeAndReadLog) go through it, so they
// are in-process with the same gateway the calling test got and not a second, spawned route.
import { runner } from "./harness.mjs";

export function tmpRepo() {
  return removeAtExit(fs.mkdtempSync(path.join(os.tmpdir(), "pm-test-")));
}
// `run` and `runCombined` are NO LONGER DEFINED HERE (5.1). They call `main(argv, io)` in the
// running process, and the only thing that differs between the halves is the git gateway the
// invocation is handed — so each half binds them in its own module, `assert-harness.mjs` and
// `functional-harness.mjs`, and a test imports the one its half uses. A test that imports this
// module directly has no `run` at all, which is the loud failure rather than the quiet one.
export function readState(cwd) {
  return JSON.parse(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"));
}
export function writeState(cwd, obj) {
  fs.mkdirSync(path.join(cwd, ".conductor"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".conductor", "state.json"), JSON.stringify(obj, null, 2) + "\n");
}
export function projectMd(cwd) {
  return fs.readFileSync(path.join(cwd, "PROJECT.md"), "utf8");
}
export function claudeMd(cwd) {
  return fs.readFileSync(path.join(cwd, "CLAUDE.md"), "utf8");
}
export function parseBrief(cwd) {
  const out = runner()(["brief"], { cwd });
  return out.trim() ? JSON.parse(out).hookSpecificOutput.additionalContext : "";
}

export function manyEpics(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `e${String(i).padStart(2, "0")}`, title: `e${i}`, priority: "P1",
    status: "queued", role: "epic", lane: "superpowers",
    stories: [{ title: "x", done: false }], links: [],
  }));
}

/** ONE state.json write conflict, injected into an IN-PROCESS invocation.
 *
 *  `fixtures/inject-state-conflict.cjs` is a NODE PRELOAD, and a preload only reaches a process that
 *  is STARTED — which is what the harness used to do and what 5.1 stopped doing. In-process, the
 *  equivalent is the same one-shot patch applied to the shared `fs` singleton, which is what every
 *  engine module reads (`import fs from "node:fs"`, a property lookup at call time — verified
 *  mechanically in that file's own header).
 *
 *  WHAT IT PATCHES, exactly as the preload does: saveState()'s first filesystem call is
 *  `fs.mkdirSync(CONDUCTOR_DIR)`, and bumping the on-disk `revision` there is precisely "another
 *  writer landed between this read and this write". It fires ONCE, so the retry lands; only
 *  `revision` is touched, so the retry still has something to heal.
 *
 *  THE RETURNED RESTORE IS NOT OPTIONAL. `fs` is ONE object for the whole process — every test in
 *  a file shares it — so a caller that leaves the patch installed turns every later test's saveState
 *  into a conflict. It returns whether it FIRED, which is the
 *  non-vacuity proof the callers assert on: a seam that silently did not fire would otherwise make
 *  a green run mean "no conflict ever happened". */
export function injectConflictOnce(dir) {
  const statePath = path.join(dir, "state.json");
  const real = fs.mkdirSync;
  let fired = false;
  fs.mkdirSync = function (p, ...rest) {
    const out = real.call(this, p, ...rest);
    if (!fired && typeof p === "string" && path.resolve(p) === path.resolve(dir)) {
      fired = true;
      try {
        const st = JSON.parse(fs.readFileSync(statePath, "utf8"));
        st.revision = (Number.isInteger(st.revision) ? st.revision : 0) + 1;
        fs.writeFileSync(statePath, JSON.stringify(st, null, 2) + "\n");
      } catch { fired = false; /* no state.json yet: leave it alone and fail loudly */ }
    }
    return out;
  };
  return () => { fs.mkdirSync = real; return fired; };
}

export function expectFail(fn) {
  try { fn(); return null; } catch (e) { return e; }
}

export function fixtureCache(versions) {
  const root = removeAtExit(fs.mkdtempSync(path.join(os.tmpdir(), "pm-cache-")));
  for (const v of versions) {
    const dir = path.join(root, "mp", "pm", v, ".claude-plugin");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "plugin.json"), JSON.stringify({ name: "pm", version: v }) + "\n");
  }
  return root;
}

export function fixturePluginRoot(version, changelog) {
  const dir = removeAtExit(fs.mkdtempSync(path.join(os.tmpdir(), "pm-plugin-")));
  fs.mkdirSync(path.join(dir, ".claude-plugin"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "pm", version }) + "\n");
  if (changelog) fs.writeFileSync(path.join(dir, "CHANGELOG.md"), changelog);
  return dir;
}

export const FIXTURE_CHANGELOG = `# Changelog

## [0.6.0] — 2026-06-25
### Added
- Feature F6 lands here.

---

## [0.5.0] — 2026-06-24
### Added
- Feature F5 lands here.

---

## [0.4.0] — 2026-06-23
### Added
- Feature F4 lands here.
`;

// ─────────────── 0.7.0: set-active / clear-active + active↔status ───────────────

// ──────────────── epic-level autonomy: set-autonomy ────────────────

// ──────────────── 0.6.1: date-prefixed archive detection ────────────────

/** Today's LOCAL date, `YYYY-MM-DD` — the day `openspec archive` would stamp on a change archived now.
 *  A fixture that archives an epic's change AFTER registering that epic names the directory with it:
 *  the one resolver's date rule (sync-registers-ids-add-epic-refuses) treats an archive dated more than
 *  a day before the epic's `createdAt` as some other, older change, so a fixed past date would describe
 *  a history that cannot happen and would stop healing as the calendar moves on. */
export function archiveDay(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function withArchivedChange(cwd, id) {
  fs.mkdirSync(path.join(cwd, "openspec", "changes", "archive", `2026-06-25-${id}`), { recursive: true });
  writeState(cwd, { version: 1, active: id, detourStack: [], epics: [
    // Registered BEFORE its change was archived (sync-registers-ids-add-epic-refuses): an archive dated
    // before the epic existed is, by the one resolver's date rule, not its archive.
    { id, title: id, priority: "P0", status: "active", role: "epic", lane: "openspec", links: [], createdAt: "2026-06-01T00:00:00.000Z" }] });
}

// ───────── recompute-don't-remember: active validity + reconcileNeeded self-heal ─────────

// ───────────────────── 0.6.0: changelog surfacing ─────────────────────

// ───────────────────────── 0.5.0: epic hierarchy ─────────────────────────

// ───────────────────────── 0.5.0: defensive render ─────────────────────────

// ─────────────────── 0.5.0: external-tracker awareness ───────────────────

// ────────────── github-issues tracker: inward pull (issues → untriaged epics) ──────────────

// ─────────────── update-epic --add-story / --story --done (df-update-epic-no-story-toggle-verb) ───────────────

// ───────────────────────── 0.5.0: bulk creation ─────────────────────────

export function writeBatch(cwd, obj) {
  const p = path.join(cwd, "batch.json");
  fs.writeFileSync(p, JSON.stringify(obj));
  return p;
}

// ───────────────────────── 0.5.0: link migration ─────────────────────────

// ──────────────── epic-hierarchy orchestration: plan-hierarchy ────────────────

export function setupHierarchy(cwd, childOverrides = {}) {
  runner()(["init"], { cwd });
  runner()(["add-epic", "--id", "sprint", "--lane", "claude-code"], { cwd });
  runner()(["add-epic", "--id", "child-a", "--lane", "claude-code", "--parent", "sprint", "--priority", "P1"], { cwd });
  runner()(["add-epic", "--id", "child-b", "--lane", "claude-code", "--parent", "sprint", "--priority", "P0"], { cwd });
  runner()(["add-epic", "--id", "child-c", "--lane", "claude-code", "--parent", "sprint", "--priority", "P2"], { cwd });
  if (childOverrides.applyLinks) childOverrides.applyLinks(cwd);
}

// ──────── top-level queue: dependency-aware ordering (dependency-aware-standalone-ordering) ────────

// ──────────────── verify-worktrees ────────────────

export function gitInitWithCommit(cwd) {
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd });
  execFileSync("git", ["config", "user.name", "Test"], { cwd });
  fs.writeFileSync(path.join(cwd, "README.md"), "# test\n");
  execFileSync("git", ["add", "README.md"], { cwd });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd });
}

export function addHierarchyWorktree(cwd, epicId) {
  const branch = `hierarchy-child/${epicId}`;
  const wtPath = removeAtExit(fs.mkdtempSync(path.join(os.tmpdir(), "pm-wt-")));
  fs.rmdirSync(wtPath); // git worktree add requires the target not exist yet
  execFileSync("git", ["worktree", "add", "-b", branch, wtPath], { cwd });
  return wtPath;
}

// ──────────────── changesets ────────────────

// ──────────────── render --diff-summary ────────────────

// ──────────────── verify-state ────────────────

// ─────────────── timestamps + staleness ───────────────

// ─────────────── honcho-memory: push/pop ready-to-copy line ───────────────

// ───────── auto-detect an unlogged minimal detour from commit/diff shape ─────────

export function gitRepo(cwd) {
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd });
  execFileSync("git", ["config", "user.name", "Test"], { cwd });
  // Baseline commit for whatever /pm:init already scaffolded (CLAUDE.md, .conductor/state.json,
  // PROJECT.md), so the commit under test only reflects the files it actually touches.
  execFileSync("git", ["add", "-A"], { cwd });
  execFileSync("git", ["commit", "-q", "-m", "chore: baseline"], { cwd });
}
export function commitFiles(cwd, files, message) {
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(cwd, name), content);
  }
  execFileSync("git", ["add", "-A"], { cwd });
  execFileSync("git", ["commit", "-q", "-m", message], { cwd });
}
/** State with an ACTIVE epic and no detour — the precondition of the AUTO-DETOUR heuristic.
 *
 *  gh#91: a detour is an interruption of an active epic, so with none there is nothing to detour
 *  FROM and nothing is logged. Every auto-detour fixture therefore has to set one, INCLUDING the
 *  negative ones: without an active epic they pass because the gh#91 guard refuses, never
 *  reaching the diff-shape rule each of them claims to be testing.
 *
 *  Call it BEFORE gitRepo(), so the state lands in the baseline commit and the commit under test
 *  still touches only the files it names. */
export function autoDetourState(cwd, id = "epic-a") {
  writeState(cwd, {
    version: 1, active: id, detourStack: [],
    epics: [{ id, title: id, priority: "P1", status: "in-progress", role: "epic", lane: "claude-code", links: [], reconcileNeeded: false }],
  });
}
export function detourLog(cwd) {
  try { return fs.readFileSync(path.join(cwd, ".conductor", "detours.log"), "utf8"); }
  catch { return ""; }
}

/** Run commit-nudge, assert it actually executed, then return the detour log.
 *
 *  Why this exists: detourLog() returns "" for a missing file, so a bare
 *  `assert.doesNotMatch(detourLog(cwd), /AUTO-DETOUR/)` also passes when the hook never ran at
 *  all -- an uninitialized fixture, a command string that misses the /git\s+commit/ regex, an
 *  early return for an unrelated reason. commit-nudge exits 0 on every early return, so run()
 *  does not throw either, and the assertion cannot tell "the rule under test rejected this
 *  commit" from "nothing happened."
 *
 *  commit-nudge emits a PostToolUse context payload on every path where it ran to completion,
 *  so requiring that payload pins the difference. Use this instead of a bare detourLog() read
 *  whenever the ABSENCE of an entry is the thing being asserted.
 *
 *  Note it is deliberately NOT for the gh#65/gh#68 suppression cases: those legitimately emit
 *  nothing, and they prove non-vacuity a different way (see assertSuppressedThenLands). */
export function nudgeAndReadLog(cwd, command) {
  const out = runner()(["commit-nudge"], { cwd, input: JSON.stringify({ tool_input: { command } }) });
  assert.ok(out.includes("hookSpecificOutput"),
    "commit-nudge emitted no context payload, so it did not run to completion -- any absence " +
    `assertion against the detour log would be vacuous. Output was: ${JSON.stringify(out)}`);
  return detourLog(cwd);
}

// ─────────────────── lane-routing overrides ───────────────────

// ──────────────── reconciler structured writeback: record-reconcile ────────────────

// ──────────────── openspec gate enforcement: record-gate-review ────────────────

/** Copies the real .githooks/pre-commit into a fresh throwaway git repo with a stand-in
 *  scripts/conductor.test.mjs (either passing or failing), so the hook's actual noise-control
 *  logic (capture-to-tempfile, exit-code check, cat-only-on-failure) is exercised against the
 *  shipped file — not a re-implementation of it — without paying the ~30s cost of the real
 *  236-test suite for both the success and failure cases.
 *
 *  FOUR OPTIONS BEYOND THE FILES (0.49.0 tasks 1.1-1.5), each one a condition the hook must meet that
 *  a plain fixture cannot build:
 *    * `env` — overlaid on the inherited environment (1.1: `FORCE_COLOR=1`, the setting that used to
 *      disable the floor silently);
 *    * `pathPrepend` — a directory put IN FRONT of PATH, never in place of it (1.2: a stub `node`
 *      that prints no summary; `sh`, `git`, `grep` and `awk` must still resolve);
 *    * `withFixture: false` — omit the default `scripts/test/assert/fixture.test.mjs`, so the rungs
 *      hold only what `extraFiles` puts there (1.3: both rungs hold only `.keep`);
 *    * `setup(cwd)` — runs after `git init` and before the hook (1.5: a stale `pm-isolation-flag`).
 *  The result carries `cwd`, so a caller can inspect the fixture after the hook ran. */
export function runHookAgainstFixture(testFileBody, {
  extraFiles = {}, env: envOverlay = {}, pathPrepend = null, withFixture = true, setup = null,
} = {}) {
  const cwd = tmpRepo();
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd });
  execFileSync("git", ["config", "user.name", "Test"], { cwd });
  // Mirror the real layout: after 5.1 the hook's runner is handed `scripts/test/assert/*.test.mjs`,
  // so the fixture file has to sit there or the glob finds nothing. The body is de-indented so its
  // `test(` calls sit at column 0, because the hook's ran-fewer-than-declared guard counts `^test(`
  // -- an indented fixture would report 0 declared tests and silently skip the very guard this
  // fixture exists to exercise.
  fs.mkdirSync(path.join(cwd, "scripts", "test", "assert"), { recursive: true });
  if (withFixture) {
    const deindented = testFileBody.replace(/^[ \t]+/gm, "");
    const needsHeader = !/^import /m.test(deindented);
    const fixturePath = path.join(cwd, "scripts", "test", "assert", "fixture.test.mjs");
    fs.writeFileSync(fixturePath,
      (needsHeader
        ? 'import { test } from "node:test";\nimport assert from "node:assert/strict";\n'
        : "") + deindented);
  }
  for (const [rel, content] of Object.entries(extraFiles)) {
    const dest = path.join(cwd, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
  }
  fs.mkdirSync(path.join(cwd, ".githooks"), { recursive: true });
  // THE DRIFT STEP (6.4) runs the REAL script, not a stub. The hook invokes
  // `node scripts/test/drift.mjs` before the suite, so a fixture holding a hook but not the script
  // would abort for a reason that has nothing to do with what these fixtures test — and stubbing it
  // would mean the hook's own wiring is never exercised. The script and its shared machinery are
  // copied in, and the minimal tree it reads is created: an EMPTY `scripts/lib/` and an empty
  // `conductor.mjs` derive an empty certified set, and the two empty buckets derive no functional
  // ids — so all four checks pass on the fixture by construction, which is what lets the floor and
  // the quiet/failure behaviour below be observed through the real hook.
  const repoRoot = path.join(path.dirname(ENGINE), "..");
  for (const rel of ["scripts/test/drift.mjs", "scripts/test/certification.mjs"]) {
    fs.copyFileSync(path.join(repoRoot, rel), path.join(cwd, rel));
  }
  fs.writeFileSync(path.join(cwd, "scripts", "conductor.mjs"), "");
  for (const d of ["scripts/lib", "scripts/test/functional", "scripts/test/sweeps"]) {
    fs.mkdirSync(path.join(cwd, d), { recursive: true });
  }
  // THE FIXTURE MUST BE TRACKED, and this is new with the re-pointed floor. `declared` is now
  // enumerated with `git ls-files`, which answers for the INDEX — a file written but never added is
  // invisible to it, the floor would compare a real count against 0, and every assertion written
  // against the hook's guard would be passing on nothing. In the real repository the suite is
  // tracked by construction; a fixture has to say so.
  //
  // THE extraFiles ARE TRACKED TOO (G-I1). The floor's firing direction needs a file that is IN the
  // index — so it is declared — and NOT reachable by the shell's expansion of the runner's own glob,
  // which is the one shape that separates "what the runner ran" from "what the runner was given".
  // A fixture could not express that while only one path was addable.
  const tracked = [...(withFixture ? ["scripts/test/assert/fixture.test.mjs"] : []), ...Object.keys(extraFiles)];
  if (tracked.length) execFileSync("git", ["add", "--", ...tracked], { cwd });
  const realHookPath = path.join(path.dirname(ENGINE), "..", ".githooks", "pre-commit");
  const hookDestPath = path.join(cwd, ".githooks", "pre-commit");
  fs.copyFileSync(realHookPath, hookDestPath);
  fs.chmodSync(hookDestPath, 0o755);
  // Strip NODE_TEST_CONTEXT/NODE_TEST_WORKER_ID: node --test sets these on itself, and if
  // inherited by the hook's own nested `node --test` invocation, node treats it as an
  // already-child test-runner worker and short-circuits rather than actually running the
  // fixture suite — a real hook invocation via `git commit` never has these set.
  const env = { ...process.env, ...envOverlay };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_TEST_WORKER_ID;
  if (pathPrepend) env.PATH = `${pathPrepend}${path.delimiter}${env.PATH || ""}`;
  if (setup) setup(cwd);
  const r = spawnSync("sh", [hookDestPath], { cwd, encoding: "utf8", env });
  return Object.assign(r, { cwd });
}

// ────────────── multi-tracker-primary-secondary-support: secondaryTrackers[] ──────────────

// ────────────── externalUrl-first dedup (cross-tracker externalId collision fix) ──────────────

// ────────────── rulesBlock(): secondary-tracker inward pull + status writeback ──────────────

// ────────────── completion-time resync instruction + session-start sync nudge ──────────────

// ───────── gh#65 / gh#68: the auto-detour hook must confirm a commit actually landed HERE ─────────
// PostToolUse fires when the Bash tool RETURNS, which is not the same as "a commit landed in
// this repo". Three observed divergences, all producing a false detours.log entry attributed
// to this repo's STALE HEAD: the commit was rejected by pre-commit (gh#65), it was backgrounded
// and is still running (gh#68), or it landed in a different repo entirely (gh#65 bug 2).

/** The emitted rules block MINUS its always-on sections — the ones no tracker configuration turns
 *  on, off, or into something else.
 *
 *  HOISTED HERE (#161) because it was duplicated across conductor-14 and conductor-15, which both
 *  compare against the same 0.26.0 fixtures and so must strip identically. Nothing enforced that.
 *  It was found the way it was always going to be found: 0.37.0 added one always-on section, the
 *  edit landed in one copy, that file ran green on its own (68/68), and the sibling failed in the full suite.
 *  A byte-identity test between the two copies was considered and rejected — it DETECTS
 *  divergence where one definition PREVENTS it.
 *
 *  Byte-identity against 0.26.0 is claimed for the SYNC SECTIONS, not the whole document: a
 *  release that adds instruction no tracker governs must be able to do so. Order within the chain
 *  is READABILITY, not a constraint — each replace is anchored at its own heading and non-greedy,
 *  verified by moving one to the end and watching everything still pass. */
export const ALWAYS_ON_HEADINGS = [
  "## PM Conductor — operating rules",
  "## Getting help with pm — two channels, and which one can lie",
  "## The gate procedure — required task items",
  "## Intake — triage an ask against the whole backlog BEFORE registering it",
  "## Reporting — pm owns what is recorded and what is said; you own how you say it",
];
export const REFRESH_GATE_HEADING = "## Re-read the source before an epic becomes the work";

export const stripAlwaysOn = (block) =>
  ALWAYS_ON_HEADINGS.reduce(
    (b, heading) => b.replace(new RegExp(`${heading}[\\s\\S]*?(?=## )`), ""),
    // The refresh gate is last in the document, so it consumes to the END marker rather than to a
    // following heading — a different shape, hence outside the reduce.
    block.replace(
      new RegExp(`\\n*${REFRESH_GATE_HEADING}[\\s\\S]*?(?=\\n<!-- END pm-conductor rules -->)`), ""),
  );

// ───────── gates-bind-to-verified-evidence: fixture repositories that hold REAL commits ─────────

/** One real commit per requested name in the fixture repository at `cwd`, returned as their FULL
 *  object names in the order asked. The engine resolves every commit value it records at write time
 *  (`--attribute-commit`, `--withdraw-commit`, `--base-sha`, `--head-sha`), so a test that fed it
 *  `aaaaaaa` or `root` was exercising the refusal, not the rule it meant to.
 *
 *  `tmpRepo()` does not create a repository, so one is initialised here — hermetically, through the
 *  env hermetic-git.mjs sets — when `cwd` holds none. Commits are made with PLUMBING
 *  (`commit-tree` + `update-ref`), never `git commit`: nothing a test left in the index or the
 *  working tree is swept into a fixture commit, and no hook runs.
 *
 *  Chained by default: each commit's parent is HEAD at the time (none on an unborn HEAD), so the
 *  names come back as a linear history, first the oldest. `{ orphan: true }` makes each one a
 *  root commit sharing no history with anything — the "unrelated branch" shape — and leaves HEAD
 *  where it was. */
export function fixtureCommits(cwd, names, { orphan = false } = {}) {
  const git = (args, input) => execFileSync("git", args,
    { cwd, encoding: "utf8", input, stdio: ["pipe", "pipe", "ignore"] }).trim();
  let inRepo = false;
  try { inRepo = git(["rev-parse", "--show-toplevel"]) === fs.realpathSync(cwd); } catch { inRepo = false; }
  if (!inRepo) {
    git(["init", "-q"]);
    git(["config", "user.email", "test@example.com"]);
    git(["config", "user.name", "Test"]);
  }
  const tree = git(["mktree"], "");
  const out = [];
  for (const name of names) {
    let parent = null;
    if (!orphan) { try { parent = git(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]); } catch { parent = null; } }
    const sha = git(["commit-tree", tree, ...(parent ? ["-p", parent] : []), "-m", String(name)]);
    if (!orphan) git(["update-ref", "HEAD", sha]);
    out.push(sha);
  }
  return out;
}

/** The single-commit form of fixtureCommits(). */
export function fixtureCommit(cwd, name = "fixture", opts) {
  return fixtureCommits(cwd, [name], opts)[0];
}

// ───────── commit-nudge-reads-the-whole-move: hermetic observation fixtures ─────────

/** git in a fixture, hermetic through the env hermetic-git.mjs sets (no template, no signing). */
export function fixtureGit(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function initFixtureGit(dir) {
  fixtureGit(dir, "init", "-q", "-b", "main");
  fixtureGit(dir, "config", "user.email", "test@example.com");
  fixtureGit(dir, "config", "user.name", "Test");
  fixtureGit(dir, "config", "commit.gpgsign", "false");
}

/** A pm-managed fixture repository in which the commit hook can be observed the way
 *  `hooks/hooks.json` invokes it.
 *
 *  `nested: true` puts the conductor at `projects/sub/` of the git repository; `clone: true` makes
 *  the repository a clone of an upstream that `upstreamCommit()` can advance, for `pull --rebase`.
 *  The epic `epicId` is registered (claude-code lane) and set active, and everything init wrote is
 *  committed as a baseline. Setup failures throw — a fixture that half-built would make every
 *  absence assertion vacuous. */
export function observationRepo({ nested = false, clone = false, epicId = "epic-a" } = {}) {
  let gitRoot;
  let upstream = null;
  if (clone) {
    upstream = tmpRepo();
    initFixtureGit(upstream);
    fs.writeFileSync(path.join(upstream, "UPSTREAM.md"), "upstream\n");
    fixtureGit(upstream, "add", "UPSTREAM.md");
    fixtureGit(upstream, "commit", "-q", "-m", "chore: upstream root");
    // A non-bare upstream accepts a push to its checked-out branch only with this set.
    fixtureGit(upstream, "config", "receive.denyCurrentBranch", "updateInstead");
    gitRoot = tmpRepo();
    fs.rmdirSync(gitRoot);
    execFileSync("git", ["clone", "-q", upstream, gitRoot], { stdio: ["ignore", "ignore", "pipe"] });
    fixtureGit(gitRoot, "config", "user.email", "test@example.com");
    fixtureGit(gitRoot, "config", "user.name", "Test");
    fixtureGit(gitRoot, "config", "commit.gpgsign", "false");
    fixtureGit(gitRoot, "config", "pull.rebase", "true");
  } else {
    gitRoot = tmpRepo();
    initFixtureGit(gitRoot);
  }
  // `nested: true` is `projects/sub/`; a string names the git-root-relative directory instead.
  const cwd = typeof nested === "string" ? path.join(gitRoot, nested) : nested ? path.join(gitRoot, "projects", "sub") : gitRoot;
  fs.mkdirSync(cwd, { recursive: true });
  const quiet = (args) => execFileSync("node", [ENGINE, ...args], {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, PM_CACHE_ROOT: EMPTY_CACHE },
  });
  quiet(["init", "--platform", "claude-code"]);
  if (epicId) {
    quiet(["add-epic", "--id", epicId, "--lane", "claude-code"]);
    quiet(["set-active", epicId]);
  }
  fixtureGit(gitRoot, "add", "-A");
  fixtureGit(gitRoot, "commit", "-q", "-m", "chore: baseline");
  if (clone) fixtureGit(gitRoot, "push", "-q", "origin", "HEAD");

  const repo = {
    gitRoot, cwd, upstream,
    git: (...args) => fixtureGit(gitRoot, ...args),
    head: () => fixtureGit(gitRoot, "rev-parse", "HEAD"),
    /** Write `files` (paths relative to the GIT ROOT) and commit exactly those paths. */
    commit(files, message) {
      for (const [rel, content] of Object.entries(files)) {
        const p = path.join(gitRoot, rel);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, content);
      }
      fixtureGit(gitRoot, "add", "--", ...Object.keys(files));
      fixtureGit(gitRoot, "commit", "-q", "-m", message);
      return fixtureGit(gitRoot, "rev-parse", "HEAD");
    },
    /** Advance the upstream of a `clone: true` fixture by one commit. */
    upstreamCommit(message = "chore: upstream moved") {
      if (!upstream) throw new Error("upstreamCommit() needs observationRepo({ clone: true })");
      fs.appendFileSync(path.join(upstream, "UPSTREAM.md"), `${message}\n`);
      fixtureGit(upstream, "commit", "-q", "-am", message);
      return fixtureGit(upstream, "rev-parse", "HEAD");
    },
    observe: (event = "PostToolUse", command = "true") => observe(event, cwd, command),
    detours: () => detourLog(cwd),
  };
  return repo;
}

/** One commit-hook observation: pipes a `{hook_event_name, tool_name: "Bash", tool_input}` payload
 *  into `commit-nudge --platform claude-code` exactly as hooks/hooks.json does, and returns
 *  `{ status, stdout, stderr, context }` — `context` is the parsed additionalContext, or "". */
export function observe(event, cwd, command = "true") {
  const r = spawnSync("node", [ENGINE, "commit-nudge", "--platform", "claude-code"], {
    cwd,
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, PM_CACHE_ROOT: EMPTY_CACHE },
    encoding: "utf8",
    input: JSON.stringify({ hook_event_name: event, tool_name: "Bash", tool_input: { command } }),
  });
  let context = "", eventName = null;
  if (r.stdout && r.stdout.trim()) {
    try {
      const j = JSON.parse(r.stdout);
      context = j.hookSpecificOutput?.additionalContext || "";
      eventName = j.hookSpecificOutput?.hookEventName ?? null;
    } catch { context = ""; }
  }
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "", context, eventName };
}
