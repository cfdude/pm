import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpRepo, run, readState, writeState, projectMd } from "../fixtures/assert-harness.mjs";

// ────────────── multi-tracker-primary-secondary-support: secondaryTrackers[] ──────────────
//
// ─────────────── 4.1 SPLIT THIS FILE, AND THIS IS THE FILE-RUNG HALF ───────────────
//
// SEVEN of its twenty-four tests moved to `scripts/test/unit/conductor-10.test.mjs` — the four
// `add-epic` externalUrl-dedup tests, the legacy-record render, and two no-tracker emission tests.
//
// SEVENTEEN STAY, AND THEY ARE ONE SEAM EDGE RATHER THAN SEVENTEEN JUDGMENTS: every one of them runs
// `set-tracker`, which refreshes the managed rules block as a side effect (`tracker.mjs:194` →
// `rules.mjs`'s `writeRules()` → `writeFileSync` on CLAUDE.md). CLAUDE.md is a repository file the
// store does not own, so the verb the fixture has to run performs a write the unit rung forbids — and
// the run-time counter names it.
//
// The alternative was seeding the record's tracker fields by hand, which would have moved the tests
// while deleting what most of them check: that `set-tracker` RECORDS a tracker and `rules` then emits
// its section. Conductor-04 and conductor-05 made the same call for the same reason.
//
// No assertion changed in either direction.

test("set-tracker --role secondary adds a new entry to state.secondaryTrackers, tracker untouched", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-tracker", "--system", "jira", "--project", "JOB"], { cwd });
  run(["set-tracker", "--role", "secondary", "--system", "github-issues",
       "--repo", "acme/market-intelligence"], { cwd });
  const state = readState(cwd);
  assert.equal(state.tracker.system, "jira");
  assert.equal(state.tracker.projectKey, "JOB");
  assert.equal(state.secondaryTrackers.length, 1);
  assert.equal(state.secondaryTrackers[0].system, "github-issues");
  assert.equal(state.secondaryTrackers[0].repo, "acme/market-intelligence");
  assert.equal(state.secondaryTrackers[0].role, "secondary");
});
test("re-running set-tracker --role secondary with the same system+repo merges in place, not a duplicate", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-tracker", "--role", "secondary", "--system", "github-issues",
       "--repo", "acme/market-intelligence"], { cwd });
  run(["set-tracker", "--role", "secondary", "--system", "github-issues",
       "--repo", "acme/market-intelligence", "--instance", "ghe"], { cwd });
  const secondary = readState(cwd).secondaryTrackers;
  assert.equal(secondary.length, 1);
  assert.equal(secondary[0].instance, "ghe");
});
test("two secondary trackers with different repos coexist independently", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-tracker", "--role", "secondary", "--system", "github-issues",
       "--repo", "acme/market-intelligence"], { cwd });
  run(["set-tracker", "--role", "secondary", "--system", "github-issues",
       "--repo", "acme/risk-engine"], { cwd });
  const secondary = readState(cwd).secondaryTrackers;
  assert.equal(secondary.length, 2);
  const repos = secondary.map(s => s.repo).sort();
  assert.deepEqual(repos, ["acme/market-intelligence", "acme/risk-engine"]);
});
test("a repo-keyed and a projectKey-keyed secondary entry with the same string value do not collide", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-tracker", "--role", "secondary", "--system", "jira", "--project", "ABC"], { cwd });
  run(["set-tracker", "--role", "secondary", "--system", "jira", "--repo", "ABC"], { cwd });
  const secondary = readState(cwd).secondaryTrackers;
  assert.equal(secondary.length, 2, "namespace-prefixed keys must not collide across repo/projectKey");
});
test("set-tracker with no --role (and --role primary) behaves exactly as before this change", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-tracker", "--system", "jira", "--instance", "onvex", "--project", "JOB",
       "--mechanism", "mcp", "--intent", "active:in-progress"], { cwd });
  let state = readState(cwd);
  assert.equal(state.tracker.system, "jira");
  assert.equal(state.secondaryTrackers, undefined);

  run(["set-tracker", "--role", "primary", "--intent", "paused:todo"], { cwd });
  state = readState(cwd);
  assert.deepEqual(state.tracker.statusIntent, { active: "in-progress", paused: "todo" });
  assert.equal(state.secondaryTrackers, undefined);
});
test("set-tracker --role secondary --remove deletes the matching entry", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-tracker", "--role", "secondary", "--system", "github-issues",
       "--repo", "acme/decommissioned-repo"], { cwd });
  run(["set-tracker", "--role", "secondary", "--system", "github-issues",
       "--repo", "acme/still-active"], { cwd });
  run(["set-tracker", "--role", "secondary", "--system", "github-issues",
       "--repo", "acme/decommissioned-repo", "--remove"], { cwd });
  const secondary = readState(cwd).secondaryTrackers;
  assert.equal(secondary.length, 1);
  assert.equal(secondary[0].repo, "acme/still-active");
});
test("set-tracker --role secondary --remove against a non-existent entry exits non-zero and changes nothing", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-tracker", "--role", "secondary", "--system", "github-issues", "--repo", "acme/kept"], { cwd });
  assert.throws(() => run(["set-tracker", "--role", "secondary", "--system", "github-issues",
       "--repo", "acme/never-registered", "--remove"], { cwd }));
  const secondary = readState(cwd).secondaryTrackers;
  assert.equal(secondary.length, 1);
  assert.equal(secondary[0].repo, "acme/kept");
});
test("rulesBlock emits an inward-pull + status-writeback section per secondary tracker", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-tracker", "--role", "secondary", "--system", "github-issues",
       "--repo", "acme/market-intelligence"], { cwd });
  const rules = run(["rules"], { cwd });
  assert.match(rules, /acme\/market-intelligence/);
  assert.match(rules, /externalUrl/);
  // The recipe now carries the DERIVED id it used to omit, so it runs as written.
  assert.match(rules, /add-epic --id gh-acme-market-intelligence-<issue-number> .*--status untriaged/);
  assert.match(rules, /archived/);
  assert.match(rules, /close/i);
});
test("rulesBlock emits one section per secondary tracker when multiple are configured", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-tracker", "--role", "secondary", "--system", "github-issues",
       "--repo", "acme/market-intelligence"], { cwd });
  run(["set-tracker", "--role", "secondary", "--system", "github-issues",
       "--repo", "acme/risk-engine"], { cwd });
  const rules = run(["rules"], { cwd });
  assert.match(rules, /acme\/market-intelligence/);
  assert.match(rules, /acme\/risk-engine/);
});
test("secondary trackers never get an outward issue-creation instruction", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-tracker", "--role", "secondary", "--system", "github-issues",
       "--repo", "acme/market-intelligence"], { cwd });
  const rules = run(["rules"], { cwd });
  // The primary-only outward phrase must not appear anywhere in a secondary tracker's section
  assert.doesNotMatch(rules, /create the .*acme\/market-intelligence.* issue/i);
});
test("primary tracker rules-block output (including github-issues-as-primary suppression) is unchanged when secondaryTrackers is empty", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-tracker", "--system", "github-issues", "--repo", "cfdude/pm"], { cwd });
  const rules = run(["rules"], { cwd });
  assert.match(rules, /GitHub issue sync/);
  assert.doesNotMatch(rules, /External tracker sync/);
});
test("jira primary + github-issues secondary coexist: primary gets bidirectional sync, secondary gets inward+writeback only", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  // `--direction outward` is now explicit: a NEW primary tracker defaults to `inward`, the
  // deliberate reversal this release ships. What this test is about is the outward section's
  // content, so it asks for the direction that section belongs to.
  run(["set-tracker", "--system", "jira", "--project", "JOB", "--direction", "outward",
       "--intent", "active:in-progress", "--intent", "archived:done"], { cwd });
  run(["set-tracker", "--role", "secondary", "--system", "github-issues",
       "--repo", "acme/market-intelligence"], { cwd });
  const rules = run(["rules"], { cwd });
  assert.match(rules, /External tracker sync \(jira/);
  assert.match(rules, /acme\/market-intelligence/);
});

// ────────────── completion-time resync instruction + session-start sync nudge ──────────────
test("rulesBlock adds a resync-after-completion instruction when a secondary tracker is configured", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-tracker", "--role", "secondary", "--system", "github-issues",
       "--repo", "acme/market-intelligence"], { cwd });
  const rules = run(["rules"], { cwd });
  assert.match(rules, /Sync after completing tracker-linked work/);
  assert.match(rules, /\/pm:sync/);
});
test("rulesBlock adds a resync-after-completion instruction when the primary tracker is github-issues", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-tracker", "--system", "github-issues", "--repo", "cfdude/pm"], { cwd });
  const rules = run(["rules"], { cwd });
  assert.match(rules, /Sync after completing tracker-linked work/);
});
test("rulesBlock omits the resync instruction when the only tracker is an outward primary with no secondaries", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  // The reminder now keys on an emittable INWARD procedure rather than on the vendor's name:
  // an outward-only repo re-syncs nothing inward, so there is nothing for it to point at.
  run(["set-tracker", "--system", "jira", "--project", "JOB", "--direction", "outward"], { cwd });
  const rules = run(["rules"], { cwd });
  assert.doesNotMatch(rules, /Sync after completing tracker-linked work/);
});
test("SessionStart brief nudges toward /pm:sync when trackers are configured, singular phrasing for one", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-tracker", "--system", "github-issues", "--repo", "cfdude/pm"], { cwd });
  const brief = run(["brief"], { cwd });
  assert.match(brief, /1 tracker configured \(github-issues\) — consider `\/pm:sync`/);
});
test("SessionStart brief pluralizes and lists every system when primary + secondary trackers are configured", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-tracker", "--system", "jira", "--project", "JOB"], { cwd });
  run(["set-tracker", "--role", "secondary", "--system", "github-issues",
       "--repo", "acme/market-intelligence"], { cwd });
  const brief = run(["brief"], { cwd });
  assert.match(brief, /2 trackers configured \(jira, github-issues\) — consider `\/pm:sync`/);
});
