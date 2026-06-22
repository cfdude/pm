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
export function run(args, { cwd, env = {} } = {}) {
  return execFileSync("node", [ENGINE, ...args], {
    cwd,
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, PM_CACHE_ROOT: EMPTY_CACHE, ...env },
    encoding: "utf8",
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

function fixturePluginRoot(version) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-plugin-"));
  fs.mkdirSync(path.join(dir, ".claude-plugin"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "pm", version }) + "\n");
  return dir;
}

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
