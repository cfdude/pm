// scripts/test/assert/conductor-08.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/conductor-08.test.mjs — same id, same subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is two families: honcho-memory's ready-to-copy line and log, and the
// lane-routing overrides. NEITHER reads git. It is in the functional half for its commit-nudge
// auto-detour tests, which land a real commit and then read the reflog back — the part this half
// cannot reach (design D5).
//
// So the twin carries every behaviour of the functional file that needs no repository. The
// commit-nudge auto-detour family is asserted here in the form this half CAN prove: with no
// repository the hook observes nothing, so it must not auto-log anything — and the detour log must
// stay absent rather than carrying a row the hook invented.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, readState, writeState, detourLog, autoDetourState } from "../fixtures/assert-harness.mjs";

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

// ──────────────── the auto-detour family, in the no-repository world ────────────────
//
// `commit-nudge` decides by OBSERVING the repo (commit-watch). With no repository the double answers
// headRef with status 128, so nothing is observed to have landed — and a hook that wrote an
// AUTO-DETOUR row on an unverifiable HEAD is exactly the false attribution gh#65/gh#68 are about.
// The detour log must therefore stay absent, not merely lack the string.

test("commit-nudge witnesses no landing without a repository, so it writes no detour row at all", () => {
  const cwd = tmpRepo(); run(["init"], { cwd }); autoDetourState(cwd);
  run(["commit-nudge"], { cwd, input: JSON.stringify({ tool_input: { command: 'git commit -m "fix: correct off-by-one in renderer"' } }) });
  assert.equal(detourLog(cwd), "", "an unverifiable HEAD must produce no detour row, not a wrong one");
});

test("commit-nudge inside a live detour takes the DETOUR-COMMIT path, never AUTO-DETOUR, and records `-` as 'cannot tell'", () => {
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
  run(["commit-nudge"], { cwd, input: JSON.stringify({ tool_input: { command: 'git commit -m "fix: patch the thing"' } }) });
  const log = detourLog(cwd);
  // The DETOUR-COMMIT path is selected by the live frame, not by an observation, so it writes here
  // — and its sha field is the literal `-`, which is gh#81's "with no git at all, `-` is 'cannot
  // tell'": a row that must never be collapsed together with another `-` row.
  assert.match(log, /\tDETOUR-COMMIT\tdetour-1\t/);
  assert.match(log, /\t-\tDETOUR-COMMIT\t/, "no repository: the sha field is `-`, not an invented name");
  assert.doesNotMatch(log, /AUTO-DETOUR/, "the live detour's own path wins; AUTO-DETOUR must not be reached");
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

// ───────────────────────── the deliberate omissions ─────────────────────────
//
// The functional file's three POSITIVE auto-detour tests ("auto-logs a minimal detour", "still
// auto-logs a chore commit that touches a real source file") plus its three shape-based negatives
// (large commit, no fix/chore prefix, names the active epic) all require a real commit and a real
// diff, so the hook can OBSERVE a landing. That is exactly what this half's world does not have
// (design D5); the two tests above are the half of that family this half can prove — an
// unverifiable HEAD writes nothing, which is the same guard from the other side.
