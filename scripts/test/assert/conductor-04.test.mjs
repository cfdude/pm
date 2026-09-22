import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpRepo, run, readState, writeState, claudeMd, fixturePluginRoot, FIXTURE_CHANGELOG } from "../fixtures/assert-harness.mjs";

// ─────────────── 4.1 SPLIT THIS FILE, AND THIS IS THE FILE-RUNG HALF ───────────────
//
// FOURTEEN of its twenty-six tests moved to `scripts/test/unit/conductor-04.test.mjs` — the
// 0.4.1-shaped record's render, the hierarchy grouping/indentation/sibling ordering, the brief's
// parent annotation, the defensive-render test for malformed links, four external-id/url tests, and
// every `update-epic` refusal.
//
// TWELVE STAY, and they are two of the four seam edges rather than twelve judgments:
//   * SIX version-currency tests — `changelog` and `upgrade` — whose fixture is
//     `fixturePluginRoot(version, FIXTURE_CHANGELOG)`, a REAL plugin directory on disk that the
//     engine reads, and `init`/`upgrade` back-fill `.gitignore` beside it;
//   * SIX tracker tests. Five assert on `claudeMd(cwd)` — CLAUDE.md's managed block, a repository
//     file the store does not own — and all six run `set-tracker`, which WRITES that file as a side
//     effect. The multi-entry statusIntent test asserts on a VALUE and still cannot move, because
//     the verb the fixture must run performs a write the rung forbids.
//
// No assertion changed in either direction.

test("changelog --since lists only entries newer than the given version", () => {
  const cwd = tmpRepo();
  const root = fixturePluginRoot("0.6.0", FIXTURE_CHANGELOG);
  run(["init"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  const out = run(["changelog", "--since", "0.4.0"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  assert.match(out, /Feature F6/);
  assert.match(out, /Feature F5/);
  assert.doesNotMatch(out, /Feature F4/);   // 0.4.0 is the floor, excluded
});
test("changelog defaults --since to the version stamped in this repo", () => {
  const cwd = tmpRepo();
  const root = fixturePluginRoot("0.6.0", FIXTURE_CHANGELOG);
  run(["init"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  const s = readState(cwd); s.pmVersion = "0.5.0"; writeState(cwd, s);
  const out = run(["changelog"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  assert.match(out, /Feature F6/);
  assert.doesNotMatch(out, /Feature F5/);   // 0.5.0 not newer than stamped 0.5.0
});
test("changelog is graceful when the plugin ships no CHANGELOG", () => {
  const cwd = tmpRepo();
  const root = fixturePluginRoot("0.6.0");   // no changelog file
  run(["init"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  const out = run(["changelog", "--since", "0.1.0"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  assert.match(out, /no CHANGELOG/i);
});
test("upgrade prints the changelog delta for the versions it crossed", () => {
  const cwd = tmpRepo();
  const root = fixturePluginRoot("0.6.0", FIXTURE_CHANGELOG);
  run(["init"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  const s = readState(cwd); s.pmVersion = "0.4.0"; writeState(cwd, s);
  const out = run(["upgrade"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  assert.match(out, /What's new/i);
  assert.match(out, /Feature F6/);
  assert.match(out, /Feature F5/);
  assert.doesNotMatch(out, /Feature F4/);   // from-version excluded
});
test("upgrade prints no changelog delta on an idempotent re-run", () => {
  const cwd = tmpRepo();
  const root = fixturePluginRoot("0.6.0", FIXTURE_CHANGELOG);
  run(["init"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });   // stamps 0.6.0 == running
  const out = run(["upgrade"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  assert.doesNotMatch(out, /Feature F6/);
});
test("nudge falls back to running-version comparison when cache is unreadable", () => {
  const cwd = tmpRepo();
  const root = fixturePluginRoot("0.3.0");
  run(["init"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  const newer = fixturePluginRoot("0.4.1");
  // default PM_CACHE_ROOT (empty) → newest null → fallback compares stamped(0.3.0) vs running(0.4.1)
  const out = JSON.parse(run(["brief"], { cwd, env: { CLAUDE_PLUGIN_ROOT: newer } }))
    .hookSpecificOutput.additionalContext;
  assert.match(out, /since this repo was set up/);
});

// ───────────────────────── 0.5.0: epic hierarchy ─────────────────────────
test("set-tracker writes a tracker block with a multi-entry statusIntent map", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-tracker", "--system", "jira", "--instance", "onvex", "--project", "JOB",
       "--mechanism", "mcp", "--intent", "active:in-progress", "--intent", "paused:todo",
       "--intent", "archived:done"], { cwd });
  const t = readState(cwd).tracker;
  assert.equal(t.system, "jira");
  assert.equal(t.instance, "onvex");
  assert.equal(t.projectKey, "JOB");
  assert.equal(t.mechanism, "mcp");
  assert.deepEqual(t.statusIntent, { active: "in-progress", paused: "todo", archived: "done" });
});
test("set-tracker --system github-issues --repo stores the repo alongside system", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-tracker", "--system", "github-issues", "--repo", "cfdude/pm"], { cwd });
  const t = readState(cwd).tracker;
  assert.equal(t.system, "github-issues");
  assert.equal(t.repo, "cfdude/pm");
});
test("rules block gains a GitHub issue sync section (gh issue list -> add-epic) only for a github-issues tracker", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  assert.doesNotMatch(claudeMd(cwd), /GitHub issue sync/);
  run(["set-tracker", "--system", "github-issues", "--repo", "cfdude/pm"], { cwd });
  const md = claudeMd(cwd);
  assert.match(md, /GitHub issue sync/);
  assert.match(md, /gh issue list --repo cfdude\/pm --state open/);
  assert.match(md, /externalId/);
  assert.match(md, /add-epic --id gh-cfdude-pm-<issue-number> .*--status untriaged/);
  // The lane is no longer hardcoded — it comes from lane routing, with the recipe naming the
  // source and permitting an override with a recorded reason.
  assert.match(md, /--lane <lane>/);
  assert.match(md, /suggest-lane/);
  assert.match(md, /--priority P2/);
});
test("a jira tracker does not get the GitHub issue sync section", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-tracker", "--system", "jira", "--project", "JOB"], { cwd });
  assert.doesNotMatch(claudeMd(cwd), /GitHub issue sync/);
});
test("a github-issues tracker suppresses the outward External tracker sync section — inward-only by design", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-tracker", "--system", "github-issues", "--repo", "cfdude/pm"], { cwd });
  const md = claudeMd(cwd);
  assert.doesNotMatch(md, /External tracker sync/);
  assert.doesNotMatch(md, /has no `externalId` → create the/);
  assert.match(md, /GitHub issue sync/);
});
test("a jira tracker keeps the outward External tracker sync section fully intact — bidirectional", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  // `--direction outward` is now explicit: a NEW primary tracker defaults to `inward`, the
  // deliberate reversal this release ships. What this test is about is the outward section's
  // content, so it asks for the direction that section belongs to.
  run(["set-tracker", "--system", "jira", "--project", "JOB", "--direction", "outward"], { cwd });
  const md = claudeMd(cwd);
  assert.match(md, /External tracker sync/);
  assert.match(md, /has no `externalId` → create the/);
});
