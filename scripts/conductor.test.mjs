import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ENGINE = path.join(path.dirname(fileURLToPath(import.meta.url)), "conductor.mjs");

export function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pm-test-"));
}
export function run(args, { cwd, env = {} } = {}) {
  return execFileSync("node", [ENGINE, ...args], {
    cwd,
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, ...env },
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
