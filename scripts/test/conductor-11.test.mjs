import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tmpRepo, run, writeState, gitRepo, commitFiles, detourLog } from "./helpers.mjs";

// ───────── gh#65 / gh#68: the auto-detour hook must confirm a commit actually landed HERE ─────────
// PostToolUse fires when the Bash tool RETURNS, which is not the same as "a commit landed in
// this repo". Three observed divergences, all producing a false detours.log entry attributed
// to this repo's STALE HEAD: the commit was rejected by pre-commit (gh#65), it was backgrounded
// and is still running (gh#68), or it landed in a different repo entirely (gh#65 bug 2).

test("commit-nudge does not log when the commit was rejected and never landed (gh#65)", () => {
  const cwd = tmpRepo(); run(["init"], { cwd }); gitRepo(cwd);
  // HEAD is "chore: baseline". The rejected commit never became an object.
  run(["commit-nudge"], { cwd, input: JSON.stringify({
    tool_input: { command: 'git commit -m "fix: rejected by pre-commit, never landed"' } }) });
  const log = detourLog(cwd);
  assert.doesNotMatch(log, /AUTO-DETOUR/, "a commit that never landed must not be logged");
  assert.doesNotMatch(log, /rejected by pre-commit/);
});

test("commit-nudge does not log when the commit is still running in the background (gh#68)", () => {
  const cwd = tmpRepo(); run(["init"], { cwd }); gitRepo(cwd);
  // Same observable state as a rejected commit: the hook fires while `git commit` is still
  // running, so HEAD has not advanced yet and still holds "chore: baseline".
  run(["commit-nudge"], { cwd, input: JSON.stringify({
    tool_input: { command: 'git commit -q -m "chore: still running"' } }) });
  assert.doesNotMatch(detourLog(cwd), /AUTO-DETOUR/);
});

test("commit-nudge does not attribute a commit that landed in a DIFFERENT repo (gh#65 bug 2)", () => {
  const cwd = tmpRepo(); run(["init"], { cwd }); gitRepo(cwd);
  // A separate repo standing in for a paired repo / submodule. Note gitRepo() cannot be used
  // here: it assumes /pm:init already scaffolded files, and its baseline commit throws
  // ("nothing to commit") in the empty dir tmpRepo() returns.
  const other = tmpRepo();
  execFileSync("git", ["init", "-q"], { cwd: other });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: other });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: other });
  commitFiles(other, { "paired.txt": "1" }, "fix: belongs to the paired repo");
  // The commit succeeded -- in `other`. This repo's HEAD is untouched, so nothing may be logged.
  run(["commit-nudge"], { cwd, input: JSON.stringify({
    tool_input: { command: 'git commit -m "fix: belongs to the paired repo"' } }) });
  const log = detourLog(cwd);
  assert.doesNotMatch(log, /AUTO-DETOUR/);
  assert.doesNotMatch(log, /paired repo/);
});

test("commit-nudge does not log a DETOUR-COMMIT when the commit never landed (gh#65)", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  writeState(cwd, {
    version: 1, active: "paused-a", detourStack: [
      { pausedEpic: "paused-a", pausedAt: "2026-07-15T00:00:00Z", reason: "x", spawnedDetour: "detour-1", reconcileOnResume: false },
    ],
    epics: [
      { id: "paused-a", title: "paused-a", priority: "P1", status: "paused", role: "epic", lane: "claude-code", links: [], reconcileNeeded: false },
      { id: "detour-1", title: "detour-1", priority: "P1", status: "active", role: "epic", lane: "claude-code", links: [], reconcileNeeded: false },
    ],
  });
  gitRepo(cwd);
  run(["commit-nudge"], { cwd, input: JSON.stringify({
    tool_input: { command: 'git commit -m "fix: this one was rejected too"' } }) });
  assert.doesNotMatch(detourLog(cwd), /DETOUR-COMMIT/,
    "the detour trail must not record a commit that never landed either");
});

test("commit-nudge still logs a genuine landed commit (the guard must not silence the real case)", () => {
  const cwd = tmpRepo(); run(["init"], { cwd }); gitRepo(cwd);
  commitFiles(cwd, { "a.txt": "1" }, "fix: a real landed detour");
  run(["commit-nudge"], { cwd, input: JSON.stringify({
    tool_input: { command: 'git commit -m "fix: a real landed detour"' } }) });
  assert.match(detourLog(cwd), /AUTO-DETOUR/);
  assert.match(detourLog(cwd), /a real landed detour/);
});
