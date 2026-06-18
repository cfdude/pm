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
