// gh#81 — PROJECT.md is never clean (render stamp + duplicate detour-log rows)
// gh#82 — CLAUDE_PROJECT_DIR silently overrides cwd for ROOT
//
// Both are defects in how the engine treats the working tree and its own root.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ENGINE, EMPTY_CACHE, tmpRepo, run, writeState, detourLog } from "./helpers.mjs";

// ─────────────────────────── shared fixture plumbing ───────────────────────────

const g = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" });

/** An initialized repo, inside a live detour, with git and a baseline commit. The detour frame
 *  is what puts commitNudge on the DETOUR-COMMIT branch — the branch the bookkeeping filter was
 *  missing from. */
function detourRepo() {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, {
    version: 1, active: "paused-a", detourStack: [
      { pausedEpic: "paused-a", pausedAt: "2026-07-15T00:00:00Z", reason: "x", spawnedDetour: "detour-1", reconcileOnResume: false },
    ],
    epics: [
      { id: "paused-a", title: "paused-a", priority: "P1", status: "paused", role: "epic", lane: "claude-code", links: [], reconcileNeeded: false },
      { id: "detour-1", title: "detour-1", priority: "P1", status: "in-progress", role: "detour", lane: "claude-code", links: [], reconcileNeeded: false },
    ],
  });
  g(cwd, "init", "-q");
  g(cwd, "config", "user.email", "test@example.com");
  g(cwd, "config", "user.name", "Test");
  g(cwd, "add", "-A");
  g(cwd, "commit", "-q", "-m", "chore: baseline");
  return cwd;
}

/** Commit everything currently in the tree (`git add -A`, exactly as an agent does), then fire
 *  the PostToolUse hook for it. */
function commitAllAndNudge(cwd, message) {
  g(cwd, "add", "-A");
  g(cwd, "commit", "-q", "-m", message);
  run(["commit-nudge"], { cwd, input: JSON.stringify({ tool_input: { command: `git commit -m "${message}"` } }) });
}

const porcelain = (cwd) => g(cwd, "status", "--porcelain").trim();

// ─────────────────── gh#81 cause 3 + the loop it closes ───────────────────

test("gh#81: the PROJECT.md commit loop terminates — committing the re-render leaves a clean tree", () => {
  const cwd = detourRepo();
  fs.writeFileSync(path.join(cwd, "a.txt"), "1");
  commitAllAndNudge(cwd, "fix: real detour work");
  // The nudge re-rendered PROJECT.md (a new detour row landed), so the tree is dirty. That is
  // correct and expected: real work changed what PROJECT.md says.
  assert.notEqual(porcelain(cwd), "", "precondition: the work commit's re-render must dirty the tree");

  // Now commit that re-render, the way any agent would. THIS is where the loop lives: the
  // bookkeeping commit used to append its own DETOUR-COMMIT row, which changed the "Recent
  // detours" table, which re-rendered PROJECT.md, which dirtied the tree again — forever.
  commitAllAndNudge(cwd, "chore(pm): re-render PROJECT.md");
  assert.equal(porcelain(cwd), "",
    "committing the conductor's own re-render must leave the tree clean, not dirty it again");
});

test("gh#81: a bookkeeping-only commit inside a detour writes no DETOUR-COMMIT row", () => {
  const cwd = detourRepo();
  fs.writeFileSync(path.join(cwd, "a.txt"), "1");
  commitAllAndNudge(cwd, "fix: real detour work");
  const before = detourLog(cwd).trim().split("\n").filter(Boolean).length;
  assert.equal(before, 1, "precondition: the real work commit is logged");

  commitAllAndNudge(cwd, "chore(pm): re-render PROJECT.md");
  const after = detourLog(cwd).trim().split("\n").filter(Boolean).length;
  assert.equal(after, before,
    "a commit touching only pm's own generated files is bookkeeping, not detour work");
});

test("gh#81 control: a real commit inside a detour is still logged (the filter must not silence it)", () => {
  const cwd = detourRepo();
  fs.writeFileSync(path.join(cwd, "a.txt"), "1");
  commitAllAndNudge(cwd, "fix: real detour work");
  assert.match(detourLog(cwd), /DETOUR-COMMIT/);
  assert.match(detourLog(cwd), /real detour work/);

  // And a SECOND real commit — one that also carries the previous render along, as `git add -A`
  // always will — is still real work and still logged.
  fs.writeFileSync(path.join(cwd, "b.txt"), "2");
  commitAllAndNudge(cwd, "fix: more real detour work");
  assert.match(detourLog(cwd), /more real detour work/,
    "a commit that merely INCLUDES PROJECT.md alongside real files is not bookkeeping");
});

// ─────────────────── gh#81 cause 2: one row per SHA ───────────────────

test("gh#81: the detour log is idempotent on SHA — the same commit is never logged twice", () => {
  const cwd = detourRepo();
  fs.writeFileSync(path.join(cwd, "a.txt"), "1");
  commitAllAndNudge(cwd, "fix: real detour work");
  assert.equal(detourLog(cwd).trim().split("\n").filter(Boolean).length, 1);

  // Re-fire the hook for the SAME commit from the unverifiable rung: dropping the watermark is
  // exactly the "no baseline" state a fresh checkout, a read-only tree or a first hook run is in,
  // and it is what let the observed-rung guard be bypassed and a SHA logged again.
  fs.rmSync(path.join(cwd, ".conductor", "commit-watch.json"), { force: true });
  run(["commit-nudge"], { cwd, input: JSON.stringify({ tool_input: { command: 'git commit -m "fix: real detour work"' } }) });

  const rows = detourLog(cwd).trim().split("\n").filter(Boolean);
  assert.equal(rows.length, 1, `one row per SHA; got:\n${rows.join("\n")}`);
});

test("gh#81 control: two different SHAs both get a row", () => {
  const cwd = detourRepo();
  fs.writeFileSync(path.join(cwd, "a.txt"), "1");
  commitAllAndNudge(cwd, "fix: first");
  fs.writeFileSync(path.join(cwd, "b.txt"), "2");
  commitAllAndNudge(cwd, "fix: second");
  const rows = detourLog(cwd).trim().split("\n").filter(Boolean);
  assert.equal(rows.length, 2, "dedupe must key on the SHA, never collapse distinct commits");
});

test("gh#81: a MINIMAL detour is a declared event, not a commit — two at one HEAD keep both rows", () => {
  const cwd = detourRepo();
  fs.writeFileSync(path.join(cwd, "a.txt"), "1");
  g(cwd, "add", "-A");
  g(cwd, "commit", "-q", "-m", "fix: work");
  run(["log-detour", "--minimal", "fixed the first thing"], { cwd });
  run(["log-detour", "--minimal", "fixed the second thing"], { cwd });
  const rows = detourLog(cwd).trim().split("\n").filter(Boolean).filter(l => l.includes("MINIMAL"));
  assert.equal(rows.length, 2,
    "MINIMAL rows record what the agent declared, not what git observed — deduping them loses a real record");
});

test("gh#81: with no git at all, `-` is 'cannot tell' and must not collapse unrelated rows into one", () => {
  // No gitRepo() here on purpose: gitShortSha() returns "-" for every row, which is a
  // cannot-answer and NOT a commit identity. Keying dedupe on it would fold every entry in a
  // git-less repo into the first one — turning a guard against duplicates into a guard against
  // records.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, {
    version: 1, active: "paused-a", detourStack: [
      { pausedEpic: "paused-a", pausedAt: "2026-07-15T00:00:00Z", reason: "x", spawnedDetour: "detour-1", reconcileOnResume: false },
    ],
    epics: [
      { id: "paused-a", title: "paused-a", priority: "P1", status: "paused", role: "epic", lane: "claude-code", links: [], reconcileNeeded: false },
      { id: "detour-1", title: "detour-1", priority: "P1", status: "in-progress", role: "detour", lane: "claude-code", links: [], reconcileNeeded: false },
    ],
  });
  for (const subject of ["fix: the first thing", "fix: the second thing"]) {
    run(["commit-nudge"], { cwd, input: JSON.stringify({ tool_input: { command: `git commit -m "${subject}"` } }) });
  }
  const rows = detourLog(cwd).trim().split("\n").filter(Boolean);
  assert.equal(rows.length, 2, `two distinct commits, neither identifiable — both must be kept:\n${rows.join("\n")}`);
  assert.match(rows[0], /the first thing/);
  assert.match(rows[1], /the second thing/);
});

// ─────────────────── gh#81 cause 1: the render stamp ───────────────────

test("gh#81: re-rendering with nothing changed leaves PROJECT.md byte-identical", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const first = fs.readFileSync(path.join(cwd, "PROJECT.md"), "utf8");
  run(["render"], { cwd });
  assert.equal(fs.readFileSync(path.join(cwd, "PROJECT.md"), "utf8"), first,
    "the render timestamp alone must never rewrite the file");
});

test("gh#81: the render stamp still MOVES when something real changed (a file that never changes is as wrong as one that always does)", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const stampOf = (s) => (s.match(/^> Last rendered: (.*)$/m) || [])[1];
  const before = stampOf(fs.readFileSync(path.join(cwd, "PROJECT.md"), "utf8"));
  assert.ok(before, "PROJECT.md must carry a render stamp at all");

  run(["add-epic", "--id", "e1", "--title", "Real change", "--lane", "claude-code", "--priority", "P1", "--status", "queued"], { cwd });
  run(["render"], { cwd });
  const after = fs.readFileSync(path.join(cwd, "PROJECT.md"), "utf8");
  assert.match(after, /`e1`/, "the epic must actually appear — otherwise the stamp check proves nothing");
  assert.notEqual(stampOf(after), before,
    "a real content change must carry a fresh timestamp; suppressing the stamp to force cleanliness is the over-fix");
});

// ─────────────────── gh#82: root divergence ───────────────────

/** Run the engine with cwd and CLAUDE_PROJECT_DIR set INDEPENDENTLY — the whole point of these
 *  tests, and something helpers.run() deliberately cannot do (it pins them equal). */
function runSplit(args, { cwd, projectDir }) {
  const env = { ...process.env, PM_CACHE_ROOT: EMPTY_CACHE };
  if (projectDir === undefined) delete env.CLAUDE_PROJECT_DIR;
  else env.CLAUDE_PROJECT_DIR = projectDir;
  const r = spawnSync("node", [ENGINE, ...args], { cwd, env, encoding: "utf8" });
  return { stdout: r.stdout || "", stderr: r.stderr || "", status: r.status };
}

const WARN = /different repository/i;

test("gh#82: writing another initialized repo's conductor warns, names both paths, and still writes", () => {
  const target = tmpRepo(); run(["init"], { cwd: target });
  const here = tmpRepo();   run(["init"], { cwd: here });

  const r = runSplit(["add-epic", "--id", "e1", "--title", "T", "--lane", "claude-code", "--priority", "P1", "--status", "queued"],
    { cwd: here, projectDir: target });

  assert.equal(r.status, 0, "a warning, not a refusal — cross-repo dispatch is a supported pattern");
  assert.match(r.stderr, WARN, `expected a divergence warning, got:\n${r.stderr}`);
  assert.ok(r.stderr.includes(fs.realpathSync(target)), "the warning must name the repo actually written");
  assert.ok(r.stderr.includes(fs.realpathSync(here)), "the warning must name the repo the caller is standing in");

  const wrote = JSON.parse(fs.readFileSync(path.join(target, ".conductor", "state.json"), "utf8"));
  assert.ok(wrote.epics.some(e => e.id === "e1"), "the write must still land — this guard observes, it does not redirect");
  const local = JSON.parse(fs.readFileSync(path.join(here, ".conductor", "state.json"), "utf8"));
  assert.ok(!local.epics.some(e => e.id === "e1"), "control: the local repo must be untouched, or the test proves nothing");
});

test("gh#82: the same directory reached by an unresolved symlink does NOT warn", () => {
  // macOS: tmpRepo() hands back /var/folders/… while process.cwd() in the child reports the
  // physical /private/var/folders/…. A string compare calls that a divergence for one directory,
  // which would fire this warning on every fixture in the suite — and, in the field, on every
  // hook invocation in any project reached through a symlinked path.
  const cwd = tmpRepo(); run(["init"], { cwd });
  const r = runSplit(["render"], { cwd, projectDir: cwd });
  assert.doesNotMatch(r.stderr, WARN, `same directory, unresolved path — must not warn:\n${r.stderr}`);
  assert.equal(r.status, 0);
});

test("gh#82: targeting a repo from a directory with no conductor of its own does NOT warn", () => {
  // The deliberate case: the test harness, evals/fixtures.py, and any orchestrator that cd's
  // somewhere neutral and points the engine at a project. There is no other conductor here to
  // have meant instead, so there is nothing to warn about.
  const target = tmpRepo(); run(["init"], { cwd: target });
  const neutral = tmpRepo();
  const r = runSplit(["render"], { cwd: neutral, projectDir: target });
  assert.doesNotMatch(r.stderr, WARN, `no local conductor — must not warn:\n${r.stderr}`);
  assert.equal(r.status, 0);
});

test("gh#82: with CLAUDE_PROJECT_DIR unset there is nothing to diverge from", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  const r = runSplit(["render"], { cwd, projectDir: undefined });
  assert.doesNotMatch(r.stderr, WARN, `unset — must not warn:\n${r.stderr}`);
  assert.equal(r.status, 0);
});

test("gh#82: the warning is not silenced by the banner switches that the redirect itself trips", () => {
  // df-engine-banner-noise-every-invocation suppresses the engine banner whenever
  // CLAUDE_PROJECT_DIR is set — i.e. the single condition that redirects every write is also the
  // condition that makes the engine quietest. A safety line must not inherit that.
  const target = tmpRepo(); run(["init"], { cwd: target });
  const here = tmpRepo();   run(["init"], { cwd: here });
  const r = spawnSync("node", [ENGINE, "render"], {
    cwd: here,
    env: { ...process.env, PM_CACHE_ROOT: EMPTY_CACHE, CLAUDE_PROJECT_DIR: target, PM_QUIET_ENGINE_BANNER: "1" },
    encoding: "utf8",
  });
  assert.match(r.stderr || "", WARN, `PM_QUIET_ENGINE_BANNER must not suppress it:\n${r.stderr}`);
});
