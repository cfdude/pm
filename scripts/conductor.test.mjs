import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ENGINE = path.join(path.dirname(fileURLToPath(import.meta.url)), "conductor.mjs");
const EMPTY_CACHE = fs.mkdtempSync(path.join(os.tmpdir(), "pm-empty-cache-"));

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

test("epic without lane reads as openspec (back-compat) and shows a Lane column", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, {
    version: 1, active: null, detourStack: [],
    epics: [{ id: "legacy", title: "Legacy epic", priority: "P1", status: "queued", role: "epic", links: [], reconcileNeeded: false }],
  });
  run(["render"], { cwd });
  const md = projectMd(cwd);
  assert.match(md, /\| Lane \|/);            // Lane column header exists
  assert.match(md, /`legacy`/);
  assert.match(md, /\| openspec \|/);        // legacy epic defaulted to openspec
});

test("epics sort by priority then lane rank deterministically", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, {
    version: 1, active: null, detourStack: [],
    epics: [
      { id: "b-sp", title: "b", priority: "P1", status: "queued", role: "epic", lane: "superpowers", links: [] },
      { id: "a-os", title: "a", priority: "P1", status: "queued", role: "epic", lane: "openspec", links: [] },
      { id: "c-cc", title: "c", priority: "P0", status: "queued", role: "epic", lane: "claude-code", links: [] },
    ],
  });
  run(["render"], { cwd });
  const md = projectMd(cwd);
  // P0 claude-code first, then P1 openspec before P1 superpowers
  const order = ["c-cc", "a-os", "b-sp"].map(id => md.indexOf(`\`${id}\``));
  assert.ok(order[0] < order[1] && order[1] < order[2], `bad order: ${order}`);
});

test("init scaffolds state.json, PROJECT.md, and CLAUDE.md rules block", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const state = readState(cwd);
  assert.equal(state.version, 1);
  assert.deepEqual(state.epics, []);
  assert.deepEqual(state.detourStack, []);
  assert.match(projectMd(cwd), /PROJECT — Conductor Index/);
  assert.match(claudeMd(cwd), /BEGIN pm-conductor rules/);
});

test("progress precedence: manual stories win", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [], epics: [
    { id: "m", title: "m", priority: "P1", status: "queued", role: "epic", lane: "claude-code",
      stories: [{ title: "a", done: true }, { title: "b", done: false }], links: [] },
  ]});
  run(["render"], { cwd });
  assert.match(projectMd(cwd), /1\/2 stories/);
});

test("progress precedence: planPath checkboxes when no stories", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  fs.mkdirSync(path.join(cwd, "docs", "superpowers", "plans"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "docs", "superpowers", "plans", "p.md"),
    "# Plan\n- [x] one\n- [ ] two\n- [ ] three\n");
  writeState(cwd, { version: 1, active: null, detourStack: [], epics: [
    { id: "sp", title: "sp", priority: "P1", status: "queued", role: "epic", lane: "superpowers",
      planPath: "docs/superpowers/plans/p.md", links: [] },
  ]});
  run(["render"], { cwd });
  assert.match(projectMd(cwd), /1\/3 tasks/);
});

test("dangling planPath renders a warning, not a count", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [], epics: [
    { id: "sp", title: "sp", priority: "P1", status: "queued", role: "epic", lane: "superpowers",
      planPath: "docs/superpowers/plans/missing.md", links: [] },
  ]});
  run(["render"], { cwd });
  assert.match(projectMd(cwd), /⚠ planPath missing/);
});

test("decision lane with no source renders an em dash", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [], epics: [
    { id: "d", title: "d", priority: "P2", status: "queued", role: "epic", lane: "decision", links: [] },
  ]});
  run(["render"], { cwd });
  assert.match(projectMd(cwd), /`d` \| decision \| epic \| queued \| — \|/);
});

test("openspec lane still reads tasks.md by id", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const ch = path.join(cwd, "openspec", "changes", "feat-x");
  fs.mkdirSync(ch, { recursive: true });
  fs.writeFileSync(path.join(ch, "tasks.md"), "- [x] a\n- [x] b\n- [ ] c\n");
  run(["sync"], { cwd });
  run(["render"], { cwd });
  assert.match(projectMd(cwd), /2\/3 stories/);
});

test("non-openspec epic appears in NEXT UP", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [], epics: [
    { id: "sp1", title: "sp1", priority: "P1", status: "queued", role: "epic", lane: "superpowers",
      stories: [{ title: "x", done: false }], links: [] },
  ]});
  const brief = parseBrief(cwd);
  assert.match(brief, /NEXT UP/);
  assert.match(brief, /`sp1` \(P1, superpowers, queued\)/);
});

test("missing openspec change is marked and excluded from NEXT UP", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [], epics: [
    { id: "ghost", title: "ghost", priority: "P1", status: "queued", role: "epic", lane: "openspec", links: [] },
  ]});
  run(["render"], { cwd });
  assert.match(projectMd(cwd), /no change on disk/);
  const brief = parseBrief(cwd);
  assert.doesNotMatch(brief, /`ghost`/);
});

function manyEpics(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `e${String(i).padStart(2, "0")}`, title: `e${i}`, priority: "P1",
    status: "queued", role: "epic", lane: "superpowers",
    stories: [{ title: "x", done: false }], links: [],
  }));
}

test("brief caps NEXT UP at 5 and reports the remainder", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [], epics: manyEpics(8) });
  const brief = parseBrief(cwd);
  const shown = (brief.match(/^ {2}• /gm) || []).length;
  assert.equal(shown, 5);
  assert.match(brief, /\(\+3 more — see PROJECT\.md\)/);
  assert.match(brief, /lanes: superpowers 8/);
});

test("active epic is shown even when NEXT UP is capped", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const epics = manyEpics(8);
  epics.push({ id: "live", title: "live", priority: "P0", status: "active", role: "epic", lane: "openspec", links: [] });
  writeState(cwd, { version: 1, active: "live", detourStack: [], epics });
  const brief = parseBrief(cwd);
  assert.match(brief, /NOW: `live`/);
});

function expectFail(fn) {
  try { fn(); return null; } catch (e) { return e; }
}

test("epic with no autonomy field defaults to level off via render/brief (no crash, no marker)", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code", "--status", "active"], { cwd });
  const md = projectMd(cwd);
  assert.match(md, /`a`/);
  assert.doesNotMatch(md, /🤖/);              // no autonomy marker for a plain epic
  const brief = parseBrief(cwd);
  assert.doesNotMatch(brief, /🤖/);
});

test("add-epic inserts a lane-tagged epic with defaults", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "refactor-auth", "--title", "Refactor auth", "--lane", "superpowers", "--priority", "P1"], { cwd });
  const e = readState(cwd).epics.find(x => x.id === "refactor-auth");
  assert.equal(e.lane, "superpowers");
  assert.equal(e.priority, "P1");
  assert.equal(e.status, "queued");
  assert.equal(e.role, "epic");
});

test("add-epic rejects a duplicate id", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "dup", "--lane", "claude-code"], { cwd });
  const err = expectFail(() => run(["add-epic", "--id", "dup", "--lane", "claude-code"], { cwd }));
  assert.ok(err, "expected non-zero exit on duplicate");
});

test("add-epic rejects a bad id and an unknown lane", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  assert.ok(expectFail(() => run(["add-epic", "--id", "Bad ID", "--lane", "claude-code"], { cwd })));
  assert.ok(expectFail(() => run(["add-epic", "--id", "ok", "--lane", "nope"], { cwd })));
});

test("add-epic stores planPath and links", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "x", "--lane", "superpowers", "--plan", "docs/superpowers/plans/x.md",
       "--link", "blocks:y:needs token"], { cwd });
  const e = readState(cwd).epics.find(x => x.id === "x");
  assert.equal(e.planPath, "docs/superpowers/plans/x.md");
  assert.deepEqual(e.links, [{ type: "blocks", epic: "y", reason: "needs token" }]);
});

test("sync imports superpowers plans as lane-tagged epics", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  fs.mkdirSync(path.join(cwd, "docs", "superpowers", "plans"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "docs", "superpowers", "plans", "big-refactor.md"), "# Big Refactor\n- [ ] a\n");
  run(["sync"], { cwd });
  const e = readState(cwd).epics.find(x => x.id === "big-refactor");
  assert.equal(e.lane, "superpowers");
  assert.equal(e.title, "Big Refactor");
  assert.equal(e.planPath, "docs/superpowers/plans/big-refactor.md");
});

test("sync tolerates a missing plans dir", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });            // no docs/ dir at all
  run(["sync"], { cwd });            // must not throw
  assert.ok(Array.isArray(readState(cwd).epics));
});

test("sync skips a plan whose id collides with an existing epic", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "auth", "--lane", "openspec"], { cwd });
  fs.mkdirSync(path.join(cwd, "docs", "superpowers", "plans"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "docs", "superpowers", "plans", "auth.md"), "# Auth\n- [ ] a\n");
  run(["sync"], { cwd });
  const matches = readState(cwd).epics.filter(x => x.id === "auth");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].lane, "openspec");   // original kept; plan skipped
});

test("sync: openspec change discovered in same run prevents same-id plan from being added", () => {
  // This test guards the known.add(id) call inside the openspec loop of sync.
  // Without that call, a plan with the same id as a freshly-discovered openspec
  // change would be pushed as a second epic with lane "superpowers".
  const cwd = tmpRepo();
  run(["init"], { cwd });
  // On-disk OpenSpec change directory with tasks.md (no pre-existing epic in state)
  const chDir = path.join(cwd, "openspec", "changes", "auth");
  fs.mkdirSync(chDir, { recursive: true });
  fs.writeFileSync(path.join(chDir, "tasks.md"), "- [ ] a\n");
  // Superpowers plan with the same id
  fs.mkdirSync(path.join(cwd, "docs", "superpowers", "plans"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "docs", "superpowers", "plans", "auth.md"), "# Auth\n- [ ] a\n");
  // Both are discovered in the same sync run
  run(["sync"], { cwd });
  const matches = readState(cwd).epics.filter(x => x.id === "auth");
  assert.equal(matches.length, 1, "expected exactly one 'auth' epic");
  assert.equal(matches[0].lane, "openspec", "openspec change should win over same-run plan");
});

function fixtureCache(versions) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-cache-"));
  for (const v of versions) {
    const dir = path.join(root, "mp", "pm", v, ".claude-plugin");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "plugin.json"), JSON.stringify({ name: "pm", version: v }) + "\n");
  }
  return root;
}

function fixturePluginRoot(version, changelog) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-plugin-"));
  fs.mkdirSync(path.join(dir, ".claude-plugin"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "pm", version }) + "\n");
  if (changelog) fs.writeFileSync(path.join(dir, "CHANGELOG.md"), changelog);
  return dir;
}

const FIXTURE_CHANGELOG = `# Changelog

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

test("init stamps pmVersion from the running plugin", () => {
  const cwd = tmpRepo();
  const root = fixturePluginRoot("0.3.0");
  run(["init"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  assert.equal(readState(cwd).pmVersion, "0.3.0");
});

test("brief nudges when stamped pmVersion is older than running (semver-aware)", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  // simulate an old repo: stamp 0.9.0, run as 0.10.0 (string compare would get this wrong)
  const s = readState(cwd); s.pmVersion = "0.9.0"; writeState(cwd, s);
  const root = fixturePluginRoot("0.10.0");
  const out = JSON.parse(run(["brief"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } })).hookSpecificOutput.additionalContext;
  assert.match(out, /pm 0\.9\.0 → 0\.10\.0 since this repo was set up/);
  assert.match(out, /\/pm:upgrade/);
});

test("no nudge when stamped equals running", () => {
  const cwd = tmpRepo();
  const root = fixturePluginRoot("0.3.0");
  run(["init"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  const out = JSON.parse(run(["brief"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } })).hookSpecificOutput.additionalContext;
  assert.doesNotMatch(out, /since this repo was set up/);
});

test("upgrade on a never-stamped repo runs migrations, stamps lanes + pmVersion", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  // simulate a pre-0.3.0 repo: remove pmVersion, add an epic with no lane
  const s = readState(cwd); delete s.pmVersion;
  s.epics.push({ id: "legacy", title: "legacy", priority: "P1", status: "queued", role: "epic", links: [] });
  writeState(cwd, s);
  const root = fixturePluginRoot("0.3.0");
  run(["upgrade"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  const after = readState(cwd);
  assert.equal(after.pmVersion, "0.3.0");
  assert.equal(after.epics.find(e => e.id === "legacy").lane, "openspec");
});

test("upgrade from several versions behind applies ALL intermediate migrations", () => {
  // A repo two minor versions behind (0.2.0) must replay BOTH the 0.3.0 (lane) and
  // 0.5.0 (link-normalize) migrations — not just the most recent one.
  const cwd = tmpRepo();
  const root = fixturePluginRoot("0.5.1");
  run(["init"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  writeState(cwd, { version: 1, active: null, detourStack: [], pmVersion: "0.2.0",
    epics: [{ id: "old", title: "old", priority: "P1", status: "queued", role: "epic",
              links: ["blocks:other:was flaky", ""] }] });
  run(["upgrade"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  const after = readState(cwd);
  assert.equal(after.pmVersion, "0.5.1");
  const e = after.epics.find(x => x.id === "old");
  assert.equal(e.lane, "openspec");                                                 // 0.3.0 migration fired
  assert.deepEqual(e.links, [{ type: "blocks", epic: "other", reason: "was flaky" }]); // 0.5.0 migration fired
});

test("upgrade is idempotent on a second run", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const s = readState(cwd); delete s.pmVersion; writeState(cwd, s);
  const root = fixturePluginRoot("0.3.0");
  run(["upgrade"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  const first = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  run(["upgrade"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  const second = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  assert.equal(first, second);
});

test("rules block is lane-agnostic, not openspec-only", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const out = run(["rules"], { cwd });
  assert.match(out, /lane-agnostic/i);
  assert.match(out, /openspec \| superpowers \| claude-code/);
  assert.doesNotMatch(out, /becomes its own OpenSpec proposal/);
});

test("rules block always includes the epic-level autonomy section, with the five-criteria decision rule", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const out = run(["rules"], { cwd });
  assert.match(out, /## Epic-level autonomy/);
  assert.match(out, /set-autonomy/);
  assert.match(out, /No backup\/restore path exists\? → STOP/);
  assert.match(out, /Destructive but restorable.*→ WARN/);
  assert.match(out, /irreversible EXTERNAL side/i);   // scope boundary called out explicitly
});

test("render is a no-op when content is unchanged (no timestamp churn)", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["render"], { cwd });
  const first = fs.readFileSync(path.join(cwd, "PROJECT.md"), "utf8");
  run(["render"], { cwd });
  const second = fs.readFileSync(path.join(cwd, "PROJECT.md"), "utf8");
  assert.equal(first, second); // byte-identical, including the Last rendered line
});

test("render rewrites with a fresh stamp when content changes", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["render"], { cwd });
  const before = fs.readFileSync(path.join(cwd, "PROJECT.md"), "utf8");
  const s = readState(cwd);
  s.epics.push({ id: "x", title: "x", priority: "P1", status: "queued", role: "epic", lane: "claude-code", links: [] });
  writeState(cwd, s);
  run(["render"], { cwd });
  const after = fs.readFileSync(path.join(cwd, "PROJECT.md"), "utf8");
  assert.notEqual(before, after);
  assert.match(after, /`x`/);
});

test("add-epic accepts --status planned", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "road-1", "--title", "Road 1", "--lane", "openspec", "--status", "planned"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "road-1").status, "planned");
});

test("add-epic rejects an unknown --status", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  assert.ok(expectFail(() => run(["add-epic", "--id", "x", "--lane", "openspec", "--status", "bogus"], { cwd })));
});

test("add-epic rejects a valueless --id and writes nothing", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  assert.ok(expectFail(() => run(["add-epic", "--lane", "openspec", "--id"], { cwd })));
  assert.equal(readState(cwd).epics.length, 0);
});

test("add-epic tolerates a valueless --link without crashing", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "y", "--lane", "claude-code", "--link"], { cwd }); // must not throw
  assert.deepEqual(readState(cwd).epics.find(e => e.id === "y").links, []);
});

test("ACCEPTANCE: 30 lane-tagged epics, zero OpenSpec changes", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const lanes = ["superpowers", "claude-code", "decision"];
  for (let i = 0; i < 30; i++) {
    const lane = lanes[i % lanes.length];
    const pr = `P${i % 4}`;
    run(["add-epic", "--id", `item-${String(i).padStart(2, "0")}`, "--title", `Item ${i}`,
         "--lane", lane, "--priority", pr], { cwd });
  }
  // mark one superpowers epic active with manual progress
  const s = readState(cwd);
  const target = s.epics.find(e => e.lane === "superpowers");
  target.status = "active";
  target.stories = [{ title: "a", done: true }, { title: "b", done: false }];
  s.active = target.id;
  writeState(cwd, s);
  run(["render"], { cwd });

  // all 30 registered, none from OpenSpec
  assert.equal(readState(cwd).epics.length, 30);
  assert.equal(fs.existsSync(path.join(cwd, "openspec")), false);

  // PROJECT.md shows them with lanes and the active one's progress
  const md = projectMd(cwd);
  for (let i = 0; i < 30; i++) assert.match(md, new RegExp(`item-${String(i).padStart(2, "0")}`));
  assert.match(md, /1\/2 stories/);                  // active epic's manual progress rendered
  assert.match(md, new RegExp(`\`${target.id}\``));

  // brief is bounded and shows lane counts
  const brief = parseBrief(cwd);
  assert.match(brief, /NOW: `/);
  assert.match(brief, /lanes: /);
  assert.match(brief, /\(\+\d+ more — see PROJECT\.md\)/);
});

test("planned openspec epic: not missing, not in NEXT UP, counted, in table", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [], epics: [
    { id: "4c", title: "4c", priority: "P0", status: "planned", role: "epic", lane: "openspec", links: [] },
  ]});
  run(["render"], { cwd });
  const md = projectMd(cwd);
  assert.doesNotMatch(md, /no change on disk/);            // not flagged missing
  assert.match(md, /`4c` \| openspec \| epic \| planned/); // shown in Epics table
  const brief = parseBrief(cwd);
  assert.doesNotMatch(brief, /NEXT UP/);                   // not actionable
  assert.match(brief, /planned: 1 — see PROJECT\.md/);
});

test("planned epics do not inflate the brief lanes: rollup", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [], epics: [
    { id: "q1", title: "q1", priority: "P1", status: "queued", role: "epic", lane: "superpowers", stories: [{ title: "a", done: false }], links: [] },
    { id: "p1", title: "p1", priority: "P0", status: "planned", role: "epic", lane: "openspec", links: [] },
  ]});
  const brief = parseBrief(cwd);
  assert.match(brief, /lanes: superpowers 1/);
  assert.doesNotMatch(brief, /openspec 1/);  // planned openspec excluded from lanes rollup
  assert.match(brief, /planned: 1/);
});

test("sync auto-transitions a planned openspec epic to untriaged once its change dir exists", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "feat-z", "--lane", "openspec", "--priority", "P1", "--status", "planned"], { cwd });
  assert.doesNotMatch(parseBrief(cwd), /`feat-z`/);  // planned → not in NEXT UP yet
  fs.mkdirSync(path.join(cwd, "openspec", "changes", "feat-z"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "openspec", "changes", "feat-z", "tasks.md"), "- [ ] a\n");
  run(["sync"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "feat-z").status, "untriaged");
  assert.match(parseBrief(cwd), /`feat-z`/);         // now actionable
});

test("sync does not transition a non-openspec planned epic (lane guard)", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "dual", "--lane", "claude-code", "--status", "planned"], { cwd });
  fs.mkdirSync(path.join(cwd, "openspec", "changes", "dual"), { recursive: true });
  run(["sync"], { cwd });
  const e = readState(cwd).epics.find(x => x.id === "dual");
  assert.equal(e.lane, "claude-code");
  assert.equal(e.status, "planned");  // lane guard: not flipped despite a matching change dir
});

test("rules block mentions planned status and the roadmap on-ramp", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  const out = run(["rules"], { cwd });
  assert.match(out, /planned/);
  assert.match(out, /roadmap/i);
});

test("upgrade refuses when a newer pm is installed than the running engine", () => {
  const cwd = tmpRepo();
  const root03 = fixturePluginRoot("0.4.0");
  run(["init"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root03 } });
  const stampedBefore = readState(cwd).pmVersion; // 0.4.0
  const cache = fixtureCache(["0.4.0", "0.4.1"]);
  const err = expectFail(() => run(["upgrade"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root03, PM_CACHE_ROOT: cache } }));
  assert.ok(err, "expected non-zero exit when stale");
  assert.match(String(err.stderr || err.message), /0\.4\.0.*0\.4\.1|0\.4\.1.*installed/);
  assert.equal(readState(cwd).pmVersion, stampedBefore); // unchanged — no mutation
});

test("upgrade proceeds when the running engine is the newest installed", () => {
  const cwd = tmpRepo();
  const root = fixturePluginRoot("0.4.1");
  run(["init"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  const cache = fixtureCache(["0.4.0", "0.4.1"]);
  run(["upgrade"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root, PM_CACHE_ROOT: cache } });
  assert.equal(readState(cwd).pmVersion, "0.4.1");
});

test("upgrade proceeds when the cache cannot be read (newest null)", () => {
  const cwd = tmpRepo();
  const root = fixturePluginRoot("0.4.0");
  run(["init"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  // PM_CACHE_ROOT defaults to the empty cache → newest is null → guard no-op
  run(["upgrade"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  assert.equal(readState(cwd).pmVersion, "0.4.0");
});

test("newest-version semver: 0.10.0 beats 0.9.0 (guard fires)", () => {
  const cwd = tmpRepo();
  const root = fixturePluginRoot("0.9.0");
  run(["init"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  const cache = fixtureCache(["0.9.0", "0.10.0"]);
  const err = expectFail(() => run(["upgrade"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root, PM_CACHE_ROOT: cache } }));
  assert.ok(err, "0.10.0 must be treated as newer than 0.9.0");
});

test("nudge fires from newest-installed even when the running engine is old", () => {
  const cwd = tmpRepo();
  const root = fixturePluginRoot("0.3.0");
  run(["init"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } }); // stamps 0.3.0
  const cache = fixtureCache(["0.3.0", "0.4.1"]);
  const out = JSON.parse(run(["brief"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root, PM_CACHE_ROOT: cache } }))
    .hookSpecificOutput.additionalContext;
  assert.match(out, /pm 0\.3\.0 → 0\.4\.1 available/);
  assert.match(out, /\/reload-plugins/);
  assert.match(out, /\/pm:upgrade/);
});

test("no nudge when stamped equals newest installed", () => {
  const cwd = tmpRepo();
  const root = fixturePluginRoot("0.4.1");
  run(["init"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  const cache = fixtureCache(["0.4.1"]);
  const out = JSON.parse(run(["brief"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root, PM_CACHE_ROOT: cache } }))
    .hookSpecificOutput.additionalContext;
  assert.doesNotMatch(out, /available —/);
  assert.doesNotMatch(out, /since this repo was set up/);
});

// ─────────────── 0.7.0: set-active / clear-active + active↔status ───────────────

test("set-active sets the .active pointer and the epic's status, demoting a prior active", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code"], { cwd });
  run(["add-epic", "--id", "b", "--lane", "claude-code"], { cwd });
  run(["set-active", "a"], { cwd });
  let s = readState(cwd);
  assert.equal(s.active, "a");
  assert.equal(s.epics.find(e => e.id === "a").status, "active");
  run(["set-active", "b"], { cwd });
  s = readState(cwd);
  assert.equal(s.active, "b");
  assert.equal(s.epics.find(e => e.id === "b").status, "active");
  assert.equal(s.epics.find(e => e.id === "a").status, "queued");   // prior active demoted
});

test("set-active rejects an unknown or archived id and writes nothing", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "real", "--lane", "claude-code"], { cwd });
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  assert.ok(expectFail(() => run(["set-active", "ghost"], { cwd })), "unknown id rejected");
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before);
  // archived id
  fs.mkdirSync(path.join(cwd, "openspec", "changes", "archive", "2026-07-08-done"), { recursive: true });
  run(["add-epic", "--id", "done", "--lane", "openspec"], { cwd });
  assert.ok(expectFail(() => run(["set-active", "done"], { cwd })), "archived id rejected");
});

test("clear-active nulls the pointer and demotes the active epic", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code"], { cwd });
  run(["set-active", "a"], { cwd });
  run(["clear-active"], { cwd });
  const s = readState(cwd);
  assert.equal(s.active, null);
  assert.equal(s.epics.find(e => e.id === "a").status, "queued");
});

test("update-epic --status active also sets the .active pointer (no desync)", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code"], { cwd });
  run(["update-epic", "a", "--status", "active"], { cwd });
  const s = readState(cwd);
  assert.equal(s.active, "a");                                       // the reported footgun, fixed
  assert.equal(s.epics.find(e => e.id === "a").status, "active");
  assert.match(parseBrief(cwd), /NOW: `a`/);
});

test("update-epic moving the active epic off active clears the pointer", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code"], { cwd });
  run(["set-active", "a"], { cwd });
  run(["update-epic", "a", "--status", "queued"], { cwd });
  const s = readState(cwd);
  assert.equal(s.active, null);
  assert.equal(s.epics.find(e => e.id === "a").status, "queued");
});

test("add-epic --status active sets the .active pointer too", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code", "--status", "active"], { cwd });
  assert.equal(readState(cwd).active, "a");
});

// ──────────────── epic-level autonomy: set-autonomy ────────────────

test("set-autonomy sets level and rejects an unknown level", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code"], { cwd });
  run(["set-autonomy", "a", "--level", "autonomous"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "a").autonomy.level, "autonomous");
  assert.ok(expectFail(() => run(["set-autonomy", "a", "--level", "bogus"], { cwd })), "bad level rejected");
});

test("set-autonomy records preauthorize/context/notify entries, repeatable and merged across calls", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code"], { cwd });
  run(["set-autonomy", "a",
    "--preauthorize", "drop-scratch-table:reviewed, safe to drop",
    "--preauthorize", "rename-field:no external readers",
    "--context", "staging DB only, no prod access",
  ], { cwd });
  let a = readState(cwd).epics.find(e => e.id === "a").autonomy;
  assert.equal(a.preAuthorized.length, 2);
  assert.deepEqual(
    { action: a.preAuthorized[0].action, reason: a.preAuthorized[0].reason },
    { action: "drop-scratch-table", reason: "reviewed, safe to drop" },
  );
  assert.ok(a.preAuthorized[0].grantedAt);            // timestamp present
  assert.deepEqual(a.context, ["staging DB only, no prod access"]);

  // a second call APPENDS, does not clobber
  run(["set-autonomy", "a", "--notify", "ran a schema migration"], { cwd });
  a = readState(cwd).epics.find(e => e.id === "a").autonomy;
  assert.equal(a.preAuthorized.length, 2);            // unchanged by the second call
  assert.equal(a.notifications.length, 1);
  assert.equal(a.notifications[0].what, "ran a schema migration");
  assert.ok(a.notifications[0].when);
});

test("set-autonomy on an unknown id exits non-zero and writes nothing", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  assert.ok(expectFail(() => run(["set-autonomy", "ghost", "--level", "autonomous"], { cwd })));
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before);
});

test("render marks an autonomous epic with 🤖 in its Status cell; a plain epic gets no marker", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "auto", "--lane", "claude-code"], { cwd });
  run(["add-epic", "--id", "plain", "--lane", "claude-code"], { cwd });
  run(["set-autonomy", "auto", "--level", "autonomous"], { cwd });
  const md = projectMd(cwd);
  const autoLine = md.split("\n").find(l => l.includes("`auto`"));
  const plainLine = md.split("\n").find(l => l.includes("`plain`"));
  assert.match(autoLine, /🤖/);
  assert.doesNotMatch(plainLine, /🤖/);
});

test("brief NOW line shows 🤖 autonomous only when the active epic is autonomous", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code", "--status", "active"], { cwd });
  assert.doesNotMatch(parseBrief(cwd), /🤖/);
  run(["set-autonomy", "a", "--level", "autonomous"], { cwd });
  assert.match(parseBrief(cwd), /NOW: `a`.*🤖 autonomous/);
});

// ──────────────── 0.6.1: date-prefixed archive detection ────────────────

function withArchivedChange(cwd, id) {
  fs.mkdirSync(path.join(cwd, "openspec", "changes", "archive", `2026-06-25-${id}`), { recursive: true });
  writeState(cwd, { version: 1, active: id, detourStack: [], epics: [
    { id, title: id, priority: "P0", status: "active", role: "epic", lane: "openspec", links: [] }] });
}

test("isArchived recognizes a date-prefixed openspec archive dir (status flips, no ghost)", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  withArchivedChange(cwd, "feat-x");
  run(["render"], { cwd });
  const md = projectMd(cwd);
  assert.match(md, /`feat-x` \| openspec \| epic \| archived/);   // derived status = archived
  assert.doesNotMatch(md, /no change on disk/);                   // not a false ghost
});

test("brief does not show an archived epic as active, and stays read-only", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  withArchivedChange(cwd, "feat-x");
  const brief = parseBrief(cwd);
  assert.doesNotMatch(brief, /NOW: `feat-x`/);    // not presented as active
  assert.match(brief, /was archived/);            // honest note instead
  assert.equal(readState(cwd).active, "feat-x");  // brief did NOT mutate state (read path)
});

test("sync clears an archived active pointer and stamps archived status", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  withArchivedChange(cwd, "feat-x");
  run(["sync"], { cwd });
  const s = readState(cwd);
  assert.equal(s.active, null);
  assert.equal(s.epics.find(e => e.id === "feat-x").status, "archived");
});

test("commit-nudge self-heals an archived active pointer after a git commit", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  withArchivedChange(cwd, "feat-x");
  run(["commit-nudge"], { cwd, input: JSON.stringify({ tool_input: { command: 'git commit -m "archive feat-x"' } }) });
  const s = readState(cwd);
  assert.equal(s.active, null);
  assert.equal(s.epics.find(e => e.id === "feat-x").status, "archived");
});

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

test("rules block gains an External tracker sync section only when a tracker is configured", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  assert.doesNotMatch(claudeMd(cwd), /External tracker sync/);     // none after a plain init
  run(["set-tracker", "--system", "jira", "--project", "JOB"], { cwd });
  assert.match(claudeMd(cwd), /External tracker sync/);
  assert.match(claudeMd(cwd), /jira/);
});

test("tracker-linked autonomy addendum appears only when a tracker is configured", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const noTracker = run(["rules"], { cwd });
  assert.doesNotMatch(noTracker, /Epic-level autonomy on tracker-linked epics/);

  run(["set-tracker", "--system", "jira", "--project", "JOB"], { cwd });
  const withTracker = run(["rules"], { cwd });
  assert.match(withTracker, /Epic-level autonomy on tracker-linked epics/);
  assert.match(withTracker, /mid-run drift/i);
  assert.match(withTracker, /non-authoritative/i);
});

test("brief surfaces create-issue drift only for unmirrored active-work epics", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [],
    tracker: { system: "jira", projectKey: "JOB", statusIntent: {} },
    epics: [
      { id: "m1", title: "m1", priority: "P1", status: "queued", role: "epic", lane: "external", links: [] },                       // unmirrored → listed
      { id: "m2", title: "m2", priority: "P1", status: "active", role: "epic", lane: "external", externalId: "JOB-2", links: [] },   // mirrored → excluded
      { id: "done", title: "done", priority: "P1", status: "archived", role: "epic", lane: "external", links: [] },                  // archived → excluded
      { id: "later", title: "later", priority: "P1", status: "planned", role: "epic", lane: "external", links: [] },                 // planned → excluded
      { id: "ghost", title: "ghost", priority: "P1", status: "queued", role: "epic", lane: "openspec", links: [] },                  // missing() openspec → excluded
    ]});
  const brief = parseBrief(cwd);
  assert.match(brief, /TRACKER SYNC \(jira · JOB\)/);
  const syncLine = brief.split("\n").find(l => /not yet in jira/.test(l)) || "";
  assert.match(syncLine, /`m1`/);
  for (const id of ["m2", "done", "later", "ghost"]) assert.doesNotMatch(syncLine, new RegExp(`\`${id}\``));
});

test("no tracker block → no TRACKER SYNC in the brief", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [], epics: [
    { id: "x", title: "x", priority: "P1", status: "queued", role: "epic", lane: "external", links: [] }]});
  assert.doesNotMatch(parseBrief(cwd), /TRACKER SYNC/);
});

test("brief invents no transition drift when all active epics are mirrored", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [],
    tracker: { system: "jira", projectKey: "JOB", statusIntent: { archived: "done" } },
    epics: [{ id: "m", title: "m", priority: "P1", status: "active", role: "epic", lane: "external", externalId: "JOB-1", links: [] }]});
  const brief = parseBrief(cwd);
  assert.doesNotMatch(brief, /not yet in jira/);                       // nothing to create
  assert.doesNotMatch(brief, /transition pending|out of sync|drift/i); // no fabricated transition drift
});

// ───────────────────────── 0.5.0: bulk creation ─────────────────────────

function writeBatch(cwd, obj) {
  const p = path.join(cwd, "batch.json");
  fs.writeFileSync(p, JSON.stringify(obj));
  return p;
}

test("add-many creates a parent + children atomically; children inherit the parent id", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const batch = writeBatch(cwd, {
    parent: { id: "sprint", title: "Sprint", lane: "external", priority: "P0", status: "queued" },
    epics: [
      { id: "job-1", title: "one", lane: "external", priority: "P0", externalId: "JOB-1" },
      { id: "job-2", title: "two", lane: "external", priority: "P1" },
    ],
  });
  run(["add-many", "--from", batch], { cwd });
  const s = readState(cwd);
  assert.ok(s.epics.find(e => e.id === "sprint"));
  assert.equal(s.epics.find(e => e.id === "job-1").parent, "sprint");
  assert.equal(s.epics.find(e => e.id === "job-2").parent, "sprint");
  assert.equal(s.epics.find(e => e.id === "job-1").externalId, "JOB-1");
});

test("add-many children-only batch leaves parent unset", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const batch = writeBatch(cwd, { epics: [
    { id: "x", lane: "external", priority: "P1" }, { id: "y", lane: "external", priority: "P1" }] });
  run(["add-many", "--from", batch], { cwd });
  const s = readState(cwd);
  assert.ok(s.epics.find(e => e.id === "x") && s.epics.find(e => e.id === "y"));
  assert.equal(s.epics.find(e => e.id === "x").parent, undefined);
});

test("add-many aborts the whole batch on one invalid entry, writing nothing", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const before = readState(cwd).epics.length;
  const batch = writeBatch(cwd, { epics: [
    { id: "good", lane: "external", priority: "P1" },
    { id: "Bad ID", lane: "external" },                 // malformed id
  ]});
  assert.ok(expectFail(() => run(["add-many", "--from", batch], { cwd })), "expected non-zero exit");
  assert.equal(readState(cwd).epics.length, before);     // nothing written — not even 'good'
});

test("add-many rejects a duplicate id within the batch", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const batch = writeBatch(cwd, { epics: [{ id: "dup", lane: "external" }, { id: "dup", lane: "external" }] });
  assert.ok(expectFail(() => run(["add-many", "--from", batch], { cwd })));
  assert.equal(readState(cwd).epics.length, 0);
});

test("add-many rejects a duplicate against an existing epic", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "exists", "--lane", "external"], { cwd });
  const batch = writeBatch(cwd, { epics: [{ id: "exists", lane: "external" }] });
  assert.ok(expectFail(() => run(["add-many", "--from", batch], { cwd })));
  assert.equal(readState(cwd).epics.filter(e => e.id === "exists").length, 1);
});

test("add-many reads a batch from stdin (--from -)", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const batch = JSON.stringify({ epics: [{ id: "s1", lane: "external", priority: "P1" }] });
  run(["add-many", "--from", "-"], { cwd, input: batch });
  assert.ok(readState(cwd).epics.find(e => e.id === "s1"));
});

test("add-many rejects an intra-batch parent cycle", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const batch = writeBatch(cwd, { epics: [
    { id: "x", lane: "external", parent: "y" }, { id: "y", lane: "external", parent: "x" }] });
  assert.ok(expectFail(() => run(["add-many", "--from", batch], { cwd })));
  assert.equal(readState(cwd).epics.length, 0);
});

// ───────────────────────── 0.5.0: link migration ─────────────────────────

test("0.5.0 migration repairs colon-string links, drops unrecoverable, is idempotent", () => {
  const cwd = tmpRepo();
  const root = fixturePluginRoot("0.5.0");
  run(["init"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  const s = readState(cwd);
  s.pmVersion = "0.4.1";
  s.epics.push({ id: "a", title: "a", priority: "P1", status: "queued", role: "epic", lane: "openspec",
    links: ["blocks:other:was flaky", { type: "related", epic: "z" }, "", {}] });
  writeState(cwd, s);

  run(["upgrade"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  const after = readState(cwd);
  assert.equal(after.pmVersion, "0.5.0");
  const links = after.epics.find(e => e.id === "a").links;
  assert.deepEqual(links.find(l => l.type === "blocks"), { type: "blocks", epic: "other", reason: "was flaky" });
  assert.ok(links.find(l => l.type === "related" && l.epic === "z"));  // valid object preserved
  assert.equal(links.length, 2);                                       // "" and {} dropped

  // idempotent on a second run
  const first = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  run(["upgrade"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), first);
});
