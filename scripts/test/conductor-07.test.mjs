import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tmpRepo, run, runCombined, readState, writeState, projectMd, parseBrief, expectFail, ENGINE, EMPTY_CACHE } from "./helpers.mjs";

// ──────────────── changesets ────────────────

test("changesets returns an empty list when .changesets doesn't exist", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const out = JSON.parse(run(["changesets"], { cwd }));
  assert.deepEqual(out.changesets, []);
});

test("changesets lists fragment files sorted by epic id, with body content", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const dir = path.join(cwd, ".changesets");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "zeta-epic.md"), "- **Zeta thing.** Did the zeta.\n");
  fs.writeFileSync(path.join(dir, "alpha-epic.md"), "- **Alpha thing.** Did the alpha.\n");
  const out = JSON.parse(run(["changesets"], { cwd }));
  assert.equal(out.changesets.length, 2);
  assert.equal(out.changesets[0].id, "alpha-epic");
  assert.equal(out.changesets[1].id, "zeta-epic");
  assert.match(out.changesets[0].body, /Did the alpha/);
});

test("changesets ignores non-markdown files in .changesets", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const dir = path.join(cwd, ".changesets");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "epic-a.md"), "- **A thing.**\n");
  fs.writeFileSync(path.join(dir, ".gitkeep"), "");
  const out = JSON.parse(run(["changesets"], { cwd }));
  assert.equal(out.changesets.length, 1);
  assert.equal(out.changesets[0].id, "epic-a");
});

// ──────────────── render --diff-summary ────────────────

test("render --diff-summary reports epic-relevant: yes on the very first render (no baseline to compare against)", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd }); // init() itself renders once, establishing a PROJECT.md baseline
  fs.rmSync(path.join(cwd, "PROJECT.md")); // remove it to simulate a genuine "no prior render"
  const out = runCombined(["render", "--diff-summary"], { cwd });
  assert.match(out, /epic-relevant: yes/);
});

test("render --diff-summary reports epic-relevant: no when the only diff is the 'Last rendered' timestamp", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const out = runCombined(["render", "--diff-summary"], { cwd });
  assert.match(out, /epic-relevant: no/);
});

test("render --diff-summary reports epic-relevant: no when the only diff is Recent-detours table rotation", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code"], { cwd });
  // Simulate detour-log rotation directly (log-detour requires a real git SHA context this
  // fixture doesn't have) -- append rows to .conductor/detours.log, the file render() reads
  // to build the "Recent detours" table, then re-render.
  const logPath = path.join(cwd, ".conductor", "detours.log");
  fs.writeFileSync(logPath, "2026-07-01T00:00:00Z\tabc1234\tminimal\ta\tfirst rotation entry\n");
  const out1 = runCombined(["render", "--diff-summary"], { cwd });
  assert.match(out1, /epic-relevant: no/, "first rotation: no other epic-relevant content changed");

  fs.appendFileSync(logPath, "2026-07-02T00:00:00Z\tdef5678\tminimal\ta\tsecond rotation entry\n");
  const out2 = runCombined(["render", "--diff-summary"], { cwd });
  assert.match(out2, /epic-relevant: no/, "further rotation: still no other epic-relevant content changed");
});

test("render --diff-summary reports epic-relevant: yes when the on-disk PROJECT.md is stale relative to current state", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code"], { cwd });
  // add-epic/update-epic/etc already auto-re-render, so PROJECT.md on disk always reflects
  // current state.json by the time this call returns. Capture that as a "stale baseline" (as
  // if it were the last commit), then make a real epic-relevant change, then put the stale
  // baseline back on disk -- simulating a PROJECT.md that hasn't been re-rendered since a real
  // state change landed, which is exactly the case `--diff-summary` needs to catch.
  const staleBaseline = projectMd(cwd);
  run(["add-epic", "--id", "b", "--lane", "claude-code"], { cwd }); // a real, epic-relevant change
  fs.writeFileSync(path.join(cwd, "PROJECT.md"), staleBaseline);
  const out = runCombined(["render", "--diff-summary"], { cwd });
  assert.match(out, /epic-relevant: yes/);
});

// ──────────────── verify-state ────────────────

test("verify-state succeeds right after init/render (stamp matches state.json)", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const out = runCombined(["verify-state"], { cwd });
  assert.match(out, /conductor: state.json matches the last render/);
});

test("verify-state succeeds after render is re-run following a legitimate state change", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code"], { cwd });
  run(["render"], { cwd });
  const out = runCombined(["verify-state"], { cwd });
  assert.match(out, /conductor: state.json matches the last render/);
});

test("verify-state fails loudly when state.json is hand-edited after the last render", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const state = readState(cwd);
  state.epics.push({ id: "hand-edited", title: "Hand edited", priority: "P2", status: "queued", role: "epic", lane: "claude-code", links: [], reconcileNeeded: false });
  // Force the on-disk mtime forward so it's unambiguously newer than the render stamp,
  // even on filesystems with coarse mtime resolution.
  const statePath = path.join(cwd, ".conductor", "state.json");
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
  const future = new Date(Date.now() + 60_000);
  fs.utimesSync(statePath, future, future);
  const err = expectFail(() => run(["verify-state"], { cwd }));
  assert.ok(err);
  const out = runCombined(["verify-state"], { cwd });
  assert.match(out, /hand-edit|re-render|\/pm:status/i);
});

test("verify-state fails loudly when never rendered (no stamp) but state.json exists", () => {
  const cwd = tmpRepo();
  fs.mkdirSync(path.join(cwd, ".conductor"), { recursive: true });
  writeState(cwd, { version: 1, active: null, detourStack: [], epics: [] });
  const err = expectFail(() => run(["verify-state"], { cwd }));
  assert.ok(err);
});

test("plan-hierarchy excludes already-archived children from the plan", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "sprint", "--lane", "claude-code"], { cwd });
  run(["add-epic", "--id", "done-child", "--lane", "claude-code", "--parent", "sprint", "--status", "archived"], { cwd });
  run(["add-epic", "--id", "pending-child", "--lane", "claude-code", "--parent", "sprint"], { cwd });
  const out = JSON.parse(run(["plan-hierarchy", "--parent", "sprint"], { cwd }));
  const allIds = out.batches.flatMap(b => b.epics.map(e => e.id));
  assert.ok(!allIds.includes("done-child"), "archived child should not appear in the plan");
  assert.ok(allIds.includes("pending-child"), "non-archived child should still appear");
});

test("plan-hierarchy on a parent whose only children are all archived returns an empty batches array", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "sprint2", "--lane", "claude-code"], { cwd });
  run(["add-epic", "--id", "done-only", "--lane", "claude-code", "--parent", "sprint2", "--status", "archived"], { cwd });
  const out = JSON.parse(run(["plan-hierarchy", "--parent", "sprint2"], { cwd }));
  assert.deepEqual(out.batches, []);
});

test("the engine banner is suppressed by default in a dev/self-hosting context (CLAUDE_PROJECT_DIR set), so it's not noise on every invocation", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  // run()/runCombined() always set CLAUDE_PROJECT_DIR=cwd (matching real self-hosting
  // usage), so the default here is already the suppressed case -- see the next test for the
  // opt-in override, and the one after for the banner's un-suppressed default elsewhere.
  const r = runCombined(["render"], { cwd });
  assert.doesNotMatch(r, /conductor: engine/);
});

test("PM_VERBOSE_ENGINE_BANNER=1 forces the engine banner back on even when CLAUDE_PROJECT_DIR is set", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const r = runCombined(["render"], { cwd, env: { PM_VERBOSE_ENGINE_BANNER: "1" } });
  assert.match(r, /conductor: engine \S+ @ .*scripts/);
});

test("the engine banner is shown by default when CLAUDE_PROJECT_DIR is NOT set (outside a dev/self-hosting context), so a stale cached engine is still visible there", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const env = { ...process.env, PM_CACHE_ROOT: EMPTY_CACHE };
  delete env.CLAUDE_PROJECT_DIR;
  const r = spawnSync("node", [ENGINE, "render"], { cwd, env, encoding: "utf8" });
  const combined = (r.stdout || "") + (r.stderr || "");
  assert.match(combined, /conductor: engine \S+ @ .*scripts/);
});

test("the engine banner stays suppressed when both CLAUDE_PROJECT_DIR and PM_QUIET_ENGINE_BANNER are set (explicit suppress, back-compat with the pre-fix default-on behavior)", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const r = runCombined(["render"], { cwd, env: { PM_QUIET_ENGINE_BANNER: "1" } });
  assert.doesNotMatch(r, /conductor: engine/);
});

// ─────────────── timestamps + staleness ───────────────

test("set-active stamps startedAt (ISO string) on first activation, and does not reset it on re-activation", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code"], { cwd });
  run(["add-epic", "--id", "b", "--lane", "claude-code"], { cwd });
  run(["set-active", "a"], { cwd });
  const s1 = readState(cwd);
  const a1 = s1.epics.find(e => e.id === "a");
  assert.ok(a1.startedAt, "startedAt stamped");
  assert.ok(!Number.isNaN(Date.parse(a1.startedAt)), "startedAt is a valid ISO string");

  run(["set-active", "b"], { cwd });      // demotes a
  run(["set-active", "a"], { cwd });      // re-activate a
  const s2 = readState(cwd);
  const a2 = s2.epics.find(e => e.id === "a");
  assert.equal(a2.startedAt, a1.startedAt, "re-activation does not reset startedAt");
});

test("update-epic --status archived stamps completedAt", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code"], { cwd });
  run(["set-active", "a"], { cwd });
  run(["update-epic", "a", "--status", "archived"], { cwd });
  const s = readState(cwd);
  const a = s.epics.find(e => e.id === "a");
  assert.ok(a.completedAt, "completedAt stamped");
  assert.ok(!Number.isNaN(Date.parse(a.completedAt)), "completedAt is a valid ISO string");
});

test("update-epic --status queued (not archived) does not stamp completedAt", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code"], { cwd });
  run(["set-active", "a"], { cwd });
  run(["update-epic", "a", "--status", "queued"], { cwd });
  const s = readState(cwd);
  assert.equal(s.epics.find(e => e.id === "a").completedAt, undefined);
});

test("PROJECT.md and the brief flag a stale epic (startedAt > 14 days ago, no completedAt)", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code"], { cwd });
  run(["set-active", "a"], { cwd });
  const s = readState(cwd);
  const staleDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
  s.epics.find(e => e.id === "a").startedAt = staleDate;
  writeState(cwd, s);
  run(["render"], { cwd });
  const md = projectMd(cwd);
  assert.match(md, /⚠ stale, 20d active/);
  const brief = parseBrief(cwd);
  assert.match(brief, /⚠ stale, 20d active/);
});

test("an epic active fewer than 14 days is not flagged stale", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code"], { cwd });
  run(["set-active", "a"], { cwd });
  run(["render"], { cwd });
  const md = projectMd(cwd);
  assert.doesNotMatch(md, /stale/);
});

test("a completed epic is never flagged stale, even if startedAt is old", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code"], { cwd });
  run(["set-active", "a"], { cwd });
  run(["update-epic", "a", "--status", "archived"], { cwd });
  const s = readState(cwd);
  const a = s.epics.find(e => e.id === "a");
  a.startedAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  writeState(cwd, s);
  run(["render"], { cwd });
  const md = projectMd(cwd);
  assert.doesNotMatch(md, /stale/);
});
