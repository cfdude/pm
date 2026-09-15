// scripts/test/state-file-refuses-to-guess.test.mjs
//
// state-file-refuses-to-guess — the engine meets a state file it cannot read and REFUSES, where it
// used to guess. Every reproduction below was a success report over a loss on 0.43.0: `add-epic`
// over a conflicted state.json printed `added epic` and left one epic where three had been.
//
// The process-level cases are spawned, never run in-process, because the refusal's exit status is
// decided at conductor.mjs's top-level catch — the half an in-process call cannot see. The
// in-process cases are the ones that need to reach inside a single save (a --force over a file
// replaced after load, an fs spy on the critical section).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ENGINE, EMPTY_CACHE, tmpRepo, run, writeState } from "./helpers.mjs";

const UNREADABLE = 11;
const CONFLICT_MARKER = "<<<<<<< HEAD\n";

/** Run the engine and keep every channel: the exit status is the assertion here. */
function sh(args, { cwd, input, env = {} } = {}) {
  const r = spawnSync("node", [ENGINE, ...args], {
    cwd, input, encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, PM_CACHE_ROOT: EMPTY_CACHE, ...env },
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

const statePath = (cwd) => path.join(cwd, ".conductor", "state.json");
const bytes = (p) => (fs.existsSync(p) ? fs.readFileSync(p) : null);
const sameBytes = (a, b) => (a === null ? b === null : b !== null && Buffer.compare(a, b) === 0);

/** An initialized repository holding three epics. */
function threeEpicRepo() {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  for (const id of ["e1", "e2", "e3"]) run(["add-epic", "--id", id, "--lane", "claude-code"], { cwd });
  return cwd;
}

/** Every file under `dir`, relative, with its bytes — so "created no file" and "changed no file"
 *  are one comparison. */
function snapshotTree(dir) {
  const out = new Map();
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else out.set(path.relative(dir, p), fs.readFileSync(p).toString("base64"));
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

function assertRefusalMessage(stderr) {
  assert.match(stderr, /\.conductor\/state\.json/, `names the file, got: ${stderr}`);
  assert.match(stderr, /git (checkout|restore|show)/, `names a git remedy, got: ${stderr}`);
  assert.match(stderr, /mv \.conductor\/state\.json/, `names the move-aside remedy, got: ${stderr}`);
  assert.match(stderr, /init/, `names re-initialising, got: ${stderr}`);
  assert.doesNotMatch(stderr, /\n\s+at /, `no stack trace, got: ${stderr}`);
}

// ─────────────── 1.1 — an unreadable state file is refused, never replaced ───────────────

test("1.1: a conflict marker does not wipe the record — add-epic exits 11 and writes nothing", () => {
  const cwd = threeEpicRepo();
  fs.writeFileSync(statePath(cwd), CONFLICT_MARKER + fs.readFileSync(statePath(cwd), "utf8"));
  const before = bytes(statePath(cwd));
  const r = sh(["add-epic", "--id", "new", "--lane", "claude-code"], { cwd });
  assert.equal(r.status, UNREADABLE, `exit status, stderr: ${r.stderr}`);
  assert.ok(sameBytes(before, bytes(statePath(cwd))), "state.json must be byte-identical");
  assertRefusalMessage(r.stderr);
});

test("1.1: a truncated file is not replaced by sync, upgrade or init", () => {
  const cwd = threeEpicRepo();
  // A .gitignore that init/upgrade WOULD extend, so "byte-identical" cannot pass vacuously.
  fs.writeFileSync(path.join(cwd, ".gitignore"), "node_modules/\n");
  fs.writeFileSync(statePath(cwd), fs.readFileSync(statePath(cwd)).subarray(0, 40));
  const files = [statePath(cwd), path.join(cwd, "PROJECT.md"), path.join(cwd, "CLAUDE.md")];
  for (const verb of ["sync", "upgrade", "init"]) {
    const watched = verb === "sync" ? files : [...files, path.join(cwd, ".gitignore")];
    const before = watched.map(bytes);
    const r = sh([verb], { cwd });
    assert.equal(r.status, UNREADABLE, `${verb} exit status, stderr: ${r.stderr}`);
    watched.forEach((p, i) => assert.ok(sameBytes(before[i], bytes(p)), `${verb} changed ${path.basename(p)}`));
    assertRefusalMessage(r.stderr);
  }
});

test("1.1: a reading verb refuses rather than reporting an empty record", () => {
  const cwd = threeEpicRepo();
  fs.writeFileSync(statePath(cwd), "{ not json at all");
  const r = sh(["owners"], { cwd });
  assert.equal(r.status, UNREADABLE, `stderr: ${r.stderr}`);
  assert.equal(r.stdout, "", "no ownership report on stdout");
});

test("1.1: a wrong-shape file is refused, naming the member", () => {
  const cwd = threeEpicRepo();
  writeState(cwd, { version: 1, active: null, epics: {}, detourStack: [] });
  const before = bytes(statePath(cwd));
  const r = sh(["owners"], { cwd });
  assert.equal(r.status, UNREADABLE, `stderr: ${r.stderr}`);
  assert.match(r.stderr, /epics/, "names `epics` as the member with the wrong shape");
  assert.ok(sameBytes(before, bytes(statePath(cwd))));
});

test("1.1: verify-state and activity do not depend on the content and do not refuse", () => {
  const cwd = threeEpicRepo();
  fs.writeFileSync(statePath(cwd), "{ not json at all");
  for (const verb of ["verify-state", "activity"]) {
    const r = sh([verb], { cwd });
    assert.notEqual(r.status, UNREADABLE, `${verb} must not refuse, stderr: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /\n\s+at /, `${verb} must not crash, stderr: ${r.stderr}`);
  }
});

test("1.1: --force does not overwrite a file that became unreadable after the load", async () => {
  const cwd = threeEpicRepo();
  const stateLib = await import("../lib/state.mjs");
  const prevDir = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = cwd;
  process.argv.push("--force");
  try {
    const s = stateLib.loadState();
    s.epics.push({ id: "forced", title: "forced", status: "queued", lane: "claude-code" });
    fs.writeFileSync(statePath(cwd), CONFLICT_MARKER + "{ half a merge");
    const before = bytes(statePath(cwd));
    let thrown = null;
    try { stateLib.saveState(s); } catch (e) { thrown = e; }
    assert.ok(thrown, "the forced save must refuse");
    assert.equal(thrown.name, "StateUnreadableError", `got: ${thrown && thrown.stack}`);
    assert.ok(sameBytes(before, bytes(statePath(cwd))), "the unparseable file must be byte-identical");
  } finally {
    process.argv.splice(process.argv.lastIndexOf("--force"), 1);
    if (prevDir === undefined) delete process.env.CLAUDE_PROJECT_DIR; else process.env.CLAUDE_PROJECT_DIR = prevDir;
  }
});

// ─────────────── 1.3 — REGRESSION GUARD: an absent file is still dormancy ───────────────

test("1.3: with no state.json every hook exits 0, prints nothing and creates no file", () => {
  const cwd = tmpRepo();
  const before = snapshotTree(cwd);
  const payload = JSON.stringify({ tool_input: { command: "git commit -m x" } });
  for (const [verb, input] of [["brief", ""], ["snapshot", ""], ["commit-nudge", payload], ["gate-guard", "{}"]]) {
    const r = sh([verb], { cwd, input });
    assert.equal(r.status, 0, `${verb} exit status, stderr: ${r.stderr}`);
    assert.equal(r.stdout, "", `${verb} must print nothing`);
  }
  assert.deepEqual([...snapshotTree(cwd).keys()], [...before.keys()], "no file created");
});
