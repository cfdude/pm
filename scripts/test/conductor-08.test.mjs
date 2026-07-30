import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tmpRepo, run, readState, writeState, gitRepo, commitFiles, detourLog, nudgeAndReadLog } from "./helpers.mjs";

// ─────────────── honcho-memory: push/pop ready-to-copy line ───────────────

test("honcho-memory push prints the exact ready-to-copy line and appends it to .conductor/honcho-memories.log", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const out = run(["honcho-memory", "push", "parent-epic", "blocking bug in shared lib"], { cwd });
  assert.equal(out.trim(), "paused parent-epic for blocking bug in shared lib");

  const logPath = path.join(cwd, ".conductor", "honcho-memories.log");
  const logged = fs.readFileSync(logPath, "utf8").trim().split("\n");
  assert.equal(logged.length, 1);
  const [ts, line] = logged[0].split("\t");
  assert.ok(!Number.isNaN(Date.parse(ts)), "first field should be an ISO timestamp");
  assert.equal(line, "paused parent-epic for blocking bug in shared lib");
});

test("honcho-memory pop prints the resume line, formatted differently from push", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const out = run(["honcho-memory", "pop", "parent-epic", "detour-fix-shared-lib"], { cwd });
  assert.equal(out.trim(), "resumed parent-epic, reconciled vs detour-fix-shared-lib");
});

test("honcho-memory appends multiple emissions to the same log file, one line each", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["honcho-memory", "push", "epic-a", "reason one"], { cwd });
  run(["honcho-memory", "pop", "epic-a", "detour-a"], { cwd });
  const logPath = path.join(cwd, ".conductor", "honcho-memories.log");
  const lines = fs.readFileSync(logPath, "utf8").trim().split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0], /paused epic-a for reason one$/);
  assert.match(lines[1], /resumed epic-a, reconciled vs detour-a$/);
});

test("honcho-memory rejects an unknown action", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  assert.throws(() => run(["honcho-memory", "sideways", "epic-a", "reason"], { cwd }));
});

test("commit-nudge auto-logs a minimal detour for a small fix commit with no active detour", () => {
  const cwd = tmpRepo(); run(["init"], { cwd }); gitRepo(cwd);
  commitFiles(cwd, { "a.txt": "1" }, "fix: correct off-by-one in renderer");
  run(["commit-nudge"], { cwd, input: JSON.stringify({ tool_input: { command: 'git commit -m "fix: correct off-by-one in renderer"' } }) });
  const log = detourLog(cwd);
  assert.match(log, /AUTO-DETOUR/);
  assert.match(log, /correct off-by-one in renderer/);
});

test("commit-nudge does not auto-log a large commit (more than 3 files)", () => {
  const cwd = tmpRepo(); run(["init"], { cwd }); gitRepo(cwd);
  commitFiles(cwd, { "a.txt": "1", "b.txt": "1", "c.txt": "1", "d.txt": "1" }, "fix: sweeping cleanup");
  assert.doesNotMatch(nudgeAndReadLog(cwd, 'git commit -m "fix: sweeping cleanup"'), /AUTO-DETOUR/);
});

test("commit-nudge does not auto-log a commit without a fix/chore conventional-commit prefix", () => {
  const cwd = tmpRepo(); run(["init"], { cwd }); gitRepo(cwd);
  commitFiles(cwd, { "a.txt": "1" }, "feat: add new widget");
  assert.doesNotMatch(nudgeAndReadLog(cwd, 'git commit -m "feat: add new widget"'), /AUTO-DETOUR/);
});

test("commit-nudge does not auto-log a commit that names the active epic (treated as the epic's own work)", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  writeState(cwd, { version: 1, active: "feat-x", detourStack: [], epics: [
    { id: "feat-x", title: "feat-x", priority: "P1", status: "in-progress", role: "epic", lane: "claude-code", links: [], reconcileNeeded: false },
  ]});
  gitRepo(cwd);
  commitFiles(cwd, { "a.txt": "1" }, "fix(feat-x): tighten validation");
  assert.doesNotMatch(nudgeAndReadLog(cwd, 'git commit -m "fix(feat-x): tighten validation"'), /AUTO-DETOUR/);
});

test("commit-nudge does not auto-log a commit already inside a detour (existing DETOUR-COMMIT path wins)", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  writeState(cwd, {
    version: 1, active: "paused-a", detourStack: [
      { pausedEpic: "paused-a", pausedAt: "2026-07-15T00:00:00Z", reason: "x", spawnedDetour: "detour-1", reconcileOnResume: false },
    ],
    epics: [
      { id: "paused-a", title: "paused-a", priority: "P1", status: "paused", role: "epic", lane: "claude-code", links: [], reconcileNeeded: false },
      { id: "detour-1", title: "detour-1", priority: "P1", status: "in-progress", role: "detour", lane: "claude-code", links: [], reconcileNeeded: false },
    ],
  });
  gitRepo(cwd);
  commitFiles(cwd, { "a.txt": "1" }, "fix: patch the thing");
  run(["commit-nudge"], { cwd, input: JSON.stringify({ tool_input: { command: 'git commit -m "fix: patch the thing"' } }) });
  const log = detourLog(cwd);
  assert.match(log, /DETOUR-COMMIT/);
  assert.doesNotMatch(log, /AUTO-DETOUR/);
});

test("commit-nudge does not auto-log a routine conductor-bookkeeping commit touching only its own state-output files", () => {
  const cwd = tmpRepo(); run(["init"], { cwd }); gitRepo(cwd);
  commitFiles(cwd, {
    ".conductor/state.json": '{"version":1,"active":null,"detourStack":[],"epics":[]}',
    "PROJECT.md": "# updated\n",
  }, "chore(pm): register 3 new epics");
  assert.doesNotMatch(nudgeAndReadLog(cwd, 'git commit -m "chore(pm): register 3 new epics"'), /AUTO-DETOUR/);
});

test("commit-nudge still auto-logs a chore commit that touches a real source file alongside state.json", () => {
  const cwd = tmpRepo(); run(["init"], { cwd }); gitRepo(cwd);
  commitFiles(cwd, {
    ".conductor/state.json": '{"version":1,"active":null,"detourStack":[],"epics":[]}',
    "some-real-file.mjs": "// fix\n",
  }, "chore: tidy up a helper");
  run(["commit-nudge"], { cwd, input: JSON.stringify({ tool_input: { command: 'git commit -m "chore: tidy up a helper"' } }) });
  assert.match(detourLog(cwd), /AUTO-DETOUR/);
});

// ─────────────────── lane-routing overrides ───────────────────

test("set-lane-routing --add writes a laneRouting.overrides block", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-lane-routing", "--add", "billing-*:openspec", "--add", "hotfix:claude-code"], { cwd });
  const lr = readState(cwd).laneRouting;
  assert.deepEqual(lr.overrides, [
    { match: "billing-*", lane: "openspec" },
    { match: "hotfix", lane: "claude-code" },
  ]);
});

test("set-lane-routing rejects an override naming an unknown lane", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  assert.throws(() => run(["set-lane-routing", "--add", "foo:not-a-lane"], { cwd }));
});

test("set-lane-routing rejects a malformed override (missing ':lane')", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  assert.throws(() => run(["set-lane-routing", "--add", "no-colon-here"], { cwd }));
});

test("set-lane-routing --remove drops a single override by its match string", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-lane-routing", "--add", "billing-*:openspec", "--add", "hotfix:claude-code"], { cwd });
  run(["set-lane-routing", "--remove", "hotfix"], { cwd });
  const lr = readState(cwd).laneRouting;
  assert.deepEqual(lr.overrides, [{ match: "billing-*", lane: "openspec" }]);
});

test("set-lane-routing --clear empties the overrides list", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-lane-routing", "--add", "billing-*:openspec"], { cwd });
  run(["set-lane-routing", "--clear"], { cwd });
  const lr = readState(cwd).laneRouting;
  assert.deepEqual(lr.overrides, []);
});

test("suggest-lane matches an exact keyword override before falling back", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-lane-routing", "--add", "hotfix:claude-code"], { cwd });
  const out = run(["suggest-lane", "urgent hotfix for prod"], { cwd }).trim();
  const parsed = JSON.parse(out);
  assert.equal(parsed.lane, "claude-code");
  assert.equal(parsed.matched, "hotfix");
});

test("suggest-lane matches a glob-style override (billing-*)", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-lane-routing", "--add", "billing-*:openspec"], { cwd });
  const out = JSON.parse(run(["suggest-lane", "billing-refund-flow"], { cwd }).trim());
  assert.equal(out.lane, "openspec");
  assert.equal(out.matched, "billing-*");
});

test("suggest-lane with no matching override reports no override so the generic heuristic applies", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-lane-routing", "--add", "hotfix:claude-code"], { cwd });
  const out = JSON.parse(run(["suggest-lane", "brand new capability"], { cwd }).trim());
  assert.equal(out.lane, null);
  assert.equal(out.matched, null);
});

test("suggest-lane with no laneRouting configured at all reports no override", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const out = JSON.parse(run(["suggest-lane", "anything"], { cwd }).trim());
  assert.equal(out.lane, null);
});
