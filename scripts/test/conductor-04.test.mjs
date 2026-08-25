import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tmpRepo, run, readState, writeState, projectMd, claudeMd, parseBrief, expectFail, fixturePluginRoot, FIXTURE_CHANGELOG } from "./helpers.mjs";

// ───────────────────── 0.6.0: changelog surfacing ─────────────────────

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

test("0.4.1-shaped state (no parent/externalId/tracker) loads and renders unchanged", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  // A state exactly as v0.4.1 would write it — no new fields anywhere.
  writeState(cwd, {
    version: 1, active: "live", detourStack: [], pmVersion: "0.4.1",
    epics: [
      { id: "live", title: "Live one", priority: "P0", status: "active", role: "epic", lane: "openspec", links: [], reconcileNeeded: false },
      { id: "q", title: "Queued", priority: "P1", status: "queued", role: "epic", lane: "superpowers", stories: [{ title: "a", done: false }], links: [] },
    ],
  });
  run(["render"], { cwd });
  const md = projectMd(cwd);
  assert.match(md, /`live`/);
  assert.match(md, /`q`/);
  assert.doesNotMatch(md, /undefined/);
  const brief = parseBrief(cwd);
  assert.match(brief, /NOW: `live`/);
  assert.doesNotMatch(brief, /undefined/);
});

test("add-epic --parent sets parent when the parent exists", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "sprint", "--lane", "external", "--priority", "P0"], { cwd });
  run(["add-epic", "--id", "child-1", "--lane", "external", "--parent", "sprint"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "child-1").parent, "sprint");
});

test("add-epic --parent rejects a non-existent parent and writes nothing", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const before = readState(cwd).epics.length;
  const err = expectFail(() => run(["add-epic", "--id", "orphan", "--lane", "external", "--parent", "nope"], { cwd }));
  assert.ok(err, "expected non-zero exit for missing parent");
  assert.match(String(err.stderr || err.message), /parent/i);
  assert.equal(readState(cwd).epics.length, before);
});

test("render groups children under their parent with indent, rollup, and sorted siblings", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [], epics: [
    { id: "sprint", title: "Sprint", priority: "P0", status: "queued", role: "epic", lane: "external", links: [] },
    { id: "c-b", title: "cb", priority: "P1", status: "queued", role: "epic", lane: "external", parent: "sprint", links: [] },
    { id: "c-a", title: "ca", priority: "P0", status: "archived", role: "epic", lane: "external", parent: "sprint", links: [] },
  ]});
  run(["render"], { cwd });
  const md = projectMd(cwd);
  assert.match(md, /└─ `c-a`/);                       // children indented
  assert.match(md, /└─ `c-b`/);
  assert.match(md, /1\/2 children archived/);          // rollup on the parent row
  assert.ok(md.indexOf("`sprint`") < md.indexOf("`c-a`"), "parent renders before its children");
  assert.ok(md.indexOf("`c-a`") < md.indexOf("`c-b`"), "siblings sorted by priority (P0 before P1)");
});

test("render indents grandchildren one level deeper", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [], epics: [
    { id: "p", title: "p", priority: "P0", status: "queued", role: "epic", lane: "external", links: [] },
    { id: "c", title: "c", priority: "P0", status: "queued", role: "epic", lane: "external", parent: "p", links: [] },
    { id: "gc", title: "gc", priority: "P0", status: "queued", role: "epic", lane: "external", parent: "c", links: [] },
  ]});
  run(["render"], { cwd });
  const md = projectMd(cwd);
  assert.match(md, /└─ `c`/);
  assert.match(md, /└─ └─ `gc`/);
});

test("brief keeps a child's priority slot in NEXT UP and annotates its parent", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [], epics: [
    { id: "par", title: "par", priority: "P2", status: "queued", role: "epic", lane: "external", links: [] },
    { id: "kid", title: "kid", priority: "P0", status: "queued", role: "epic", lane: "external", parent: "par", links: [] },
  ]});
  const brief = parseBrief(cwd);
  assert.ok(brief.indexOf("`kid`") < brief.indexOf("`par`"), "P0 child outranks its P2 parent in NEXT UP");
  assert.match(brief, /`kid`[^\n]*parent: `par`/);     // child annotated with its parent
});

// ───────────────────────── 0.5.0: defensive render ─────────────────────────

test("malformed links never render as undefined, valid links still show", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [], epics: [
    { id: "a", title: "a", priority: "P1", status: "queued", role: "epic", lane: "external",
      links: [{ reason: "broken — no type/epic" }, { type: "blocks", epic: "b" }] },
    { id: "b", title: "b", priority: "P1", status: "queued", role: "epic", lane: "external", links: [] },
  ]});
  run(["render"], { cwd });
  const md = projectMd(cwd);
  assert.doesNotMatch(md, /undefined/);
  assert.match(md, /blocks→b/);                  // valid link still rendered in the table
  const brief = parseBrief(cwd);
  assert.doesNotMatch(brief, /undefined/);
  assert.match(brief, /`a` blocks `b`/);         // valid link still rendered in EPIC LINKS
});

// ─────────────────── 0.5.0: external-tracker awareness ───────────────────

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

test("add-epic stores externalId/externalUrl", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "job-506", "--lane", "external",
       "--external-id", "JOB-506", "--external-url", "https://onvex.example/JOB-506"], { cwd });
  const e = readState(cwd).epics.find(x => x.id === "job-506");
  assert.equal(e.externalId, "JOB-506");
  assert.equal(e.externalUrl, "https://onvex.example/JOB-506");
});

test("update-epic records external id/url onto an existing epic (write-back)", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "job-507", "--lane", "external"], { cwd });
  run(["update-epic", "job-507", "--external-id", "JOB-507", "--external-url", "https://onvex.example/JOB-507"], { cwd });
  const e = readState(cwd).epics.find(x => x.id === "job-507");
  assert.equal(e.externalId, "JOB-507");
  assert.equal(e.externalUrl, "https://onvex.example/JOB-507");
});

// ────────────── github-issues tracker: inward pull (issues → untriaged epics) ──────────────

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
  assert.match(md, /add-epic --status untriaged/);
  assert.match(md, /--lane claude-code/);
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

test("add-epic rejects a duplicate --external-id, leaving state unchanged (dedup by externalId)", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "gh-42", "--lane", "claude-code", "--status", "untriaged",
       "--external-id", "42", "--external-url", "https://github.com/cfdude/pm/issues/42"], { cwd });
  const before = readState(cwd).epics.length;
  const err = expectFail(() => run(["add-epic", "--id", "gh-42-dup", "--lane", "claude-code",
       "--status", "untriaged", "--external-id", "42",
       "--external-url", "https://github.com/cfdude/pm/issues/42"], { cwd }));
  assert.match(String(err.stderr || err.message), /external-id '42' already/);
  const after = readState(cwd);
  assert.equal(after.epics.length, before);
  assert.ok(!after.epics.some(e => e.id === "gh-42-dup"));
});

test("update-epic's own --external-id write is unaffected by the add-epic dedup guard", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "gh-43", "--lane", "claude-code"], { cwd });
  run(["update-epic", "gh-43", "--external-id", "43", "--external-url", "https://github.com/cfdude/pm/issues/43"], { cwd });
  const e = readState(cwd).epics.find(x => x.id === "gh-43");
  assert.equal(e.externalId, "43");
});

test("update-epic re-status/re-priority works; self-parent and cycle are rejected", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "external"], { cwd });
  run(["add-epic", "--id", "b", "--lane", "external", "--parent", "a"], { cwd }); // b under a
  run(["update-epic", "a", "--status", "active", "--priority", "P0"], { cwd });
  const e = readState(cwd).epics.find(x => x.id === "a");
  assert.equal(e.status, "active");
  assert.equal(e.priority, "P0");
  assert.ok(expectFail(() => run(["update-epic", "a", "--parent", "a"], { cwd })), "self-parent rejected");
  assert.ok(expectFail(() => run(["update-epic", "a", "--parent", "b"], { cwd })), "cycle rejected");
  assert.equal(readState(cwd).epics.find(x => x.id === "a").parent, undefined);
});

test("update-epic on an unknown id exits non-zero and writes nothing", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "real", "--lane", "external"], { cwd });
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  const err = expectFail(() => run(["update-epic", "ghost", "--status", "active"], { cwd }));
  assert.ok(err, "expected non-zero exit for unknown id");
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before);
});

test("update-epic --title updates an existing epic's title, mirroring add-epic", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--title", "Old title", "--lane", "claude-code"], { cwd });
  run(["update-epic", "a", "--title", "New, corrected title"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "a").title, "New, corrected title");
});
