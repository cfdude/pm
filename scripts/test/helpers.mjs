// Shared scaffolding for the split conductor test suite. Extracted verbatim from the former
// single-file scripts/conductor.test.mjs -- see docs/superpowers/plans for why it was split.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ENGINE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "conductor.mjs");
export const EMPTY_CACHE = fs.mkdtempSync(path.join(os.tmpdir(), "pm-empty-cache-"));

export function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pm-test-"));
}
export function run(args, { cwd, env = {}, input } = {}) {
  return execFileSync("node", [ENGINE, ...args], {
    cwd,
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, PM_CACHE_ROOT: EMPTY_CACHE, ...env },
    encoding: "utf8",
    input,
  });
}
/** Like run(), but returns stdout+stderr combined — for commands whose confirmation
 *  message (e.g. remove-epic's "stripped dangling link" warning) is on stderr. */
export function runCombined(args, { cwd, env = {}, input } = {}) {
  const r = spawnSync("node", [ENGINE, ...args], {
    cwd,
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, PM_CACHE_ROOT: EMPTY_CACHE, ...env },
    encoding: "utf8",
    input,
  });
  return (r.stdout || "") + (r.stderr || "");
}
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
  const out = run(["brief"], { cwd });
  return out.trim() ? JSON.parse(out).hookSpecificOutput.additionalContext : "";
}

export function manyEpics(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `e${String(i).padStart(2, "0")}`, title: `e${i}`, priority: "P1",
    status: "queued", role: "epic", lane: "superpowers",
    stories: [{ title: "x", done: false }], links: [],
  }));
}

export function expectFail(fn) {
  try { fn(); return null; } catch (e) { return e; }
}

export function fixtureCache(versions) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-cache-"));
  for (const v of versions) {
    const dir = path.join(root, "mp", "pm", v, ".claude-plugin");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "plugin.json"), JSON.stringify({ name: "pm", version: v }) + "\n");
  }
  return root;
}

export function fixturePluginRoot(version, changelog) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-plugin-"));
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

export function withArchivedChange(cwd, id) {
  fs.mkdirSync(path.join(cwd, "openspec", "changes", "archive", `2026-06-25-${id}`), { recursive: true });
  writeState(cwd, { version: 1, active: id, detourStack: [], epics: [
    { id, title: id, priority: "P0", status: "active", role: "epic", lane: "openspec", links: [] }] });
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
  run(["init"], { cwd });
  run(["add-epic", "--id", "sprint", "--lane", "claude-code"], { cwd });
  run(["add-epic", "--id", "child-a", "--lane", "claude-code", "--parent", "sprint", "--priority", "P1"], { cwd });
  run(["add-epic", "--id", "child-b", "--lane", "claude-code", "--parent", "sprint", "--priority", "P0"], { cwd });
  run(["add-epic", "--id", "child-c", "--lane", "claude-code", "--parent", "sprint", "--priority", "P2"], { cwd });
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
  const wtPath = fs.mkdtempSync(path.join(os.tmpdir(), "pm-wt-"));
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
  const out = run(["commit-nudge"], { cwd, input: JSON.stringify({ tool_input: { command } }) });
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
 *  236-test suite for both the success and failure cases. */
export function runHookAgainstFixture(testFileBody, { extraFiles = {} } = {}) {
  const cwd = tmpRepo();
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd });
  execFileSync("git", ["config", "user.name", "Test"], { cwd });
  // Mirror the real layout: the suite is scripts/test/*.test.mjs, which is what the hook globs.
  // The body is de-indented so its `test(` calls sit at column 0, because the hook's
  // ran-fewer-than-declared guard counts `^test(` -- an indented fixture would report 0
  // declared tests and silently skip the very guard this fixture exists to exercise.
  fs.mkdirSync(path.join(cwd, "scripts", "test"), { recursive: true });
  const deindented = testFileBody.replace(/^[ \t]+/gm, "");
  const needsHeader = !/^import /m.test(deindented);
  fs.writeFileSync(path.join(cwd, "scripts", "test", "fixture.test.mjs"),
    (needsHeader
      ? 'import { test } from "node:test";\nimport assert from "node:assert/strict";\n'
      : "") + deindented);
  for (const [rel, content] of Object.entries(extraFiles)) {
    const dest = path.join(cwd, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
  }
  fs.mkdirSync(path.join(cwd, ".githooks"), { recursive: true });
  const realHookPath = path.join(path.dirname(ENGINE), "..", ".githooks", "pre-commit");
  const hookDestPath = path.join(cwd, ".githooks", "pre-commit");
  fs.copyFileSync(realHookPath, hookDestPath);
  fs.chmodSync(hookDestPath, 0o755);
  // Strip NODE_TEST_CONTEXT/NODE_TEST_WORKER_ID: node --test sets these on itself, and if
  // inherited by the hook's own nested `node --test` invocation, node treats it as an
  // already-child test-runner worker and short-circuits rather than actually running the
  // fixture suite — a real hook invocation via `git commit` never has these set.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_TEST_WORKER_ID;
  return spawnSync("sh", [hookDestPath], { cwd, encoding: "utf8", env });
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
 *  edit landed in one copy, that file ran 93/93 green, and the sibling failed in the full suite.
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
