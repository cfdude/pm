// scripts/test/assert/dev-log-switch.test.mjs
// developer-session-log 1.2 -- the FILE rung of the switch: bytes in state.json, and the refusals outside the
// main working tree.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, invokeEngine } from "../fixtures/assert-harness.mjs";
import { fakeGit } from "../fixtures/fake-git.mjs";

const realRepo = () => fs.realpathSync(tmpRepo());
const stateBytes = (cwd) => fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
const spendPath = (cwd, ...p) => path.join(cwd, ".conductor", "spend", ...p);

function gateway({ main, linked = null, detached = [] }) {
  const base = fakeGit({ noRepository: true });
  const rec = (p, b) => `worktree ${p}\0HEAD 0123456789abcdef\0branch refs/heads/${b}\0\0`;
  return {
    ...base,
    worktreeList: () => rec(main, "main") + (linked ? rec(linked, "wt") : ""),
    headRef: (at) => {
      if (detached.includes(at)) throw Object.assign(new Error("detached"), { status: 1 });
      return Buffer.alloc(0);
    },
  };
}

test("1.2 init leaves state.devLog absent, and upgrade lists the opt-in", () => {
  const cwd = realRepo();
  run(["init"], { cwd });
  assert.equal(JSON.parse(stateBytes(cwd)).devLog, undefined);
  assert.match(run(["upgrade"], { cwd }), /NOT SET: devLog/);
  assert.equal(JSON.parse(stateBytes(cwd)).devLog, undefined, "upgrade does not turn it on");
});

test("1.2 `on` without spend tracking leaves state.json byte-identical", () => {
  const cwd = realRepo();
  run(["init"], { cwd });
  const before = stateBytes(cwd);
  const r = invokeEngine(["set-dev-log", "on"], { cwd });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /set-spend-tracking on/);
  assert.equal(stateBytes(cwd), before);
});

test("1.2 a repeated `on` writes nothing: state.json is byte-identical", () => {
  const cwd = realRepo();
  run(["init"], { cwd });
  run(["set-spend-tracking", "on"], { cwd });
  run(["set-dev-log", "on"], { cwd });
  const before = stateBytes(cwd);
  run(["set-dev-log", "on"], { cwd });
  assert.equal(stateBytes(cwd), before);
});

test("1.2 the switch is refused in a linked worktree and on a detached main HEAD, writing nothing", () => {
  const main = realRepo();
  run(["init"], { cwd: main });
  run(["set-spend-tracking", "on"], { cwd: main });
  const linked = realRepo();
  fs.mkdirSync(path.join(linked, ".conductor"), { recursive: true });
  fs.copyFileSync(path.join(main, ".conductor", "state.json"), path.join(linked, ".conductor", "state.json"));
  const before = stateBytes(linked);
  for (const arg of ["on", "off"]) {
    const r = invokeEngine(["set-dev-log", arg], { cwd: linked, git: gateway({ main, linked }) });
    assert.notEqual(r.status, 0);
    assert.ok(r.stderr.includes(main), `names the main working tree (${r.stderr})`);
  }
  assert.equal(stateBytes(linked), before);
  const mainBefore = stateBytes(main);
  const d = invokeEngine(["set-dev-log", "on"], { cwd: main, git: gateway({ main, detached: [main] }) });
  assert.notEqual(d.status, 0);
  assert.match(d.stderr, /detached/);
  assert.equal(stateBytes(main), mainBefore);
  assert.equal(fs.existsSync(spendPath(linked)), false);
});
