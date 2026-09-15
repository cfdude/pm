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

// ─────────────── 2.1 — hooks never write over an unreadable state file ───────────────

/** An initialized, git-tracked repository whose active epic owes a reconcile. */
function reconcileOwedRepo() {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, {
    version: 1, active: "epic-a", detourStack: [],
    epics: [{ id: "epic-a", title: "epic-a", priority: "P1", status: "active", role: "epic",
      lane: "openspec", links: [], reconcileNeeded: true }],
  });
  run(["render"], { cwd });
  return cwd;
}

const gitIn = (cwd, ...args) => spawnSync("git", args, { cwd, encoding: "utf8" });

test("2.1(a): gate-guard blocks on a conflicted state file, naming the file and a git command", () => {
  const cwd = reconcileOwedRepo();
  assert.equal(sh(["gate-guard", "--platform", "claude-code"], { cwd, input: "{}" }).status, 2,
    "precondition: the clean file blocks on the owed reconcile");
  fs.writeFileSync(statePath(cwd), CONFLICT_MARKER + fs.readFileSync(statePath(cwd), "utf8"));
  const r = sh(["gate-guard", "--platform", "claude-code"], { cwd, input: "{}" });
  assert.equal(r.status, 2, `fail CLOSED, stderr: ${r.stderr}`);
  assert.match(r.stderr, /\.conductor\/state\.json/);
  assert.match(r.stderr, /git (checkout|restore|show)/);
});

test("2.1(b): gate-guard does not crash on a wrong-shape file — exit 2, not a TypeError", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, { version: 1, active: "epic-a", epics: {}, detourStack: [] });
  const r = sh(["gate-guard", "--platform", "claude-code"], { cwd, input: "{}" });
  assert.equal(r.status, 2, `stderr: ${r.stderr}`);
  assert.doesNotMatch(r.stderr, /TypeError/);
  assert.match(r.stderr, /cannot be read/);
});

test("2.1(c): the session brief carries the warning instead of a guessed record, and writes nothing", () => {
  const cwd = reconcileOwedRepo();
  // Enough skipped hook writes that a normal brief would surface the contention warning and
  // CONSUME its latch — so "no file under .conductor/ changed" cannot pass vacuously.
  const log = path.join(cwd, ".conductor", "write-conflicts.log");
  fs.writeFileSync(log, "2026-01-01T00:00:00.000Z\trender\t1\t2\n".repeat(4));
  fs.writeFileSync(statePath(cwd), "{ not json at all");
  const before = snapshotTree(path.join(cwd, ".conductor"));
  const r = sh(["brief", "--platform", "claude-code"], { cwd });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
  assert.match(ctx, /\.conductor\/state\.json/);
  assert.match(ctx, /git (checkout|restore)/);
  assert.match(ctx, /tracking nothing/i);
  assert.doesNotMatch(ctx, /epic-a/, "no epic content");
  assert.doesNotMatch(ctx, /available/, "no version-currency content");
  assert.doesNotMatch(ctx, /next[- ]up/i, "no next-up content");
  assert.deepEqual(snapshotTree(path.join(cwd, ".conductor")), before, "no file under .conductor/ written");
});

test("2.1(d): commit-nudge writes nothing after a commit lands over an unreadable file, and exits 2", () => {
  const cwd = reconcileOwedRepo();
  gitIn(cwd, "init", "-q");
  gitIn(cwd, "add", "-A");
  gitIn(cwd, "commit", "-q", "-m", "chore: base");
  const payload = (c) => JSON.stringify({ tool_input: { command: c } });
  sh(["commit-nudge", "--platform", "claude-code"], { cwd, input: payload("ls") });   // prime the watermark
  fs.writeFileSync(path.join(cwd, "a.txt"), "1");
  gitIn(cwd, "add", "a.txt");
  gitIn(cwd, "commit", "-q", "-m", "fix: small");
  fs.writeFileSync(statePath(cwd), "{ not json at all");
  const watched = [statePath(cwd), path.join(cwd, "PROJECT.md"), path.join(cwd, ".conductor", "detours.log")];
  const before = watched.map(bytes);
  const r = sh(["commit-nudge", "--platform", "claude-code"], { cwd, input: payload("git commit -m 'fix: small'") });
  assert.equal(r.status, 2, `stderr: ${r.stderr}`);
  assert.match(r.stderr, /\.conductor\/state\.json/);
  watched.forEach((p, i) => assert.ok(sameBytes(before[i], bytes(p)), `${path.basename(p)} changed`));
});

test("2.1(e) REGRESSION GUARD: a pre-compaction snapshot writes nothing and does not block compaction", () => {
  const cwd = reconcileOwedRepo();
  fs.writeFileSync(statePath(cwd), "{ not json at all");
  const md = path.join(cwd, "PROJECT.md");
  const brief = path.join(cwd, ".conductor", "brief.txt");
  const before = [bytes(md), bytes(brief)];
  const r = sh(["snapshot", "--platform", "claude-code"], { cwd });
  assert.notEqual(r.status, 0, `stderr: ${r.stderr}`);
  assert.notEqual(r.status, 2, "exit 2 on PreCompact blocks compaction");
  assert.ok(sameBytes(before[0], bytes(md)), "PROJECT.md unchanged");
  assert.ok(sameBytes(before[1], bytes(brief)), "brief.txt unchanged or absent");
});

test("2.1(f): a refusal raised by code a hook calls still takes the hook's exit status", async () => {
  const { refusalFor } = await import("../lib/refusal.mjs");
  const { StateUnreadableError } = await import("../lib/state.mjs");
  const stub = () => { throw new StateUnreadableError("/x/.conductor/state.json", "it does not parse as JSON"); };
  for (const verb of ["gate-guard", "commit-nudge"]) {
    let err = null;
    try { stub(); } catch (e) { err = e; }
    const r = refusalFor(verb, err);
    assert.equal(r && r.exitCode, 2, `${verb} must map an unreadable-state refusal to 2`);
    assert.match(r.stderr, /\.conductor\/state\.json/);
  }
});
