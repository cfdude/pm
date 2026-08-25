import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tmpRepo, run, readState, writeState, projectMd } from "./helpers.mjs";

// ────────────── multi-tracker-primary-secondary-support: secondaryTrackers[] ──────────────

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

test("state.json without secondaryTrackers loads and renders exactly as before this change", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, {
    version: 1, active: null, detourStack: [],
    tracker: { system: "jira", projectKey: "JOB" },
    epics: [{ id: "a", title: "a", priority: "P1", status: "queued", role: "epic", lane: "claude-code", links: [] }],
  });
  run(["render"], { cwd });
  const md = projectMd(cwd);
  assert.match(md, /`a`/);
  const rules = run(["rules"], { cwd });
  assert.doesNotMatch(rules, /market-intelligence/);
});

// ────────────── externalUrl-first dedup (cross-tracker externalId collision fix) ──────────────

test("add-epic dedups by externalUrl when both incoming and an existing epic have one, even if externalId matches", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "mi-42", "--lane", "claude-code", "--external-id", "42",
       "--external-url", "https://github.com/acme/market-intelligence/issues/42"], { cwd });
  // Same bare externalId "42", but a DIFFERENT repo's issue — must NOT be treated as a duplicate.
  run(["add-epic", "--id", "risk-42", "--lane", "claude-code", "--external-id", "42",
       "--external-url", "https://github.com/acme/risk-engine/issues/42"], { cwd });
  const ids = readState(cwd).epics.map(e => e.id).sort();
  assert.deepEqual(ids, ["mi-42", "risk-42"]);
});

test("add-epic still rejects a true duplicate externalUrl", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "mi-42", "--lane", "claude-code", "--external-id", "42",
       "--external-url", "https://github.com/acme/market-intelligence/issues/42"], { cwd });
  assert.throws(() => run(["add-epic", "--id", "mi-42-dup", "--lane", "claude-code", "--external-id", "42",
       "--external-url", "https://github.com/acme/market-intelligence/issues/42"], { cwd }));
  const ids = readState(cwd).epics.map(e => e.id);
  assert.deepEqual(ids, ["mi-42"]);
});

test("add-epic falls back to bare externalId dedup when neither side has a URL", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "job-1", "--lane", "claude-code", "--external-id", "JOB-1"], { cwd });
  assert.throws(() => run(["add-epic", "--id", "job-1-dup", "--lane", "claude-code", "--external-id", "JOB-1"], { cwd }));
  const ids = readState(cwd).epics.map(e => e.id);
  assert.deepEqual(ids, ["job-1"]);
});

test("a URL-less legacy epic never falsely blocks a genuinely distinct, URL-bearing epic sharing the same bare externalId (Gate 2 finding)", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  // Legacy epic registered with only a bare externalId, no URL.
  run(["add-epic", "--id", "legacy-42", "--lane", "claude-code", "--external-id", "42"], { cwd });
  // A genuinely distinct epic happens to share the bare id "42" but DOES carry a URL — must
  // NOT be treated as a duplicate of the URL-less legacy entry.
  run(["add-epic", "--id", "risk-42", "--lane", "claude-code", "--external-id", "42",
       "--external-url", "https://github.com/acme/risk-engine/issues/42"], { cwd });
  const ids = readState(cwd).epics.map(e => e.id).sort();
  assert.deepEqual(ids, ["legacy-42", "risk-42"]);
});

// ────────────── rulesBlock(): secondary-tracker inward pull + status writeback ──────────────

test("rulesBlock emits an inward-pull + status-writeback section per secondary tracker", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-tracker", "--role", "secondary", "--system", "github-issues",
       "--repo", "acme/market-intelligence"], { cwd });
  const rules = run(["rules"], { cwd });
  assert.match(rules, /acme\/market-intelligence/);
  assert.match(rules, /externalUrl/);
  assert.match(rules, /add-epic --status untriaged/);
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

test("rulesBlock omits the resync instruction when no tracker is configured at all", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
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

test("SessionStart brief has no sync nudge when no tracker is configured", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const brief = run(["brief"], { cwd });
  assert.doesNotMatch(brief, /consider `\/pm:sync` this session/);
});
