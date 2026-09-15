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
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
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

test("2.1(f) sweep: every hook verb is settled — in the status table or named as taking the default", async () => {
  // The default status is fail-OPEN on PreToolUse, so a hook verb added later and left out of both
  // lists would silently let Edit/Write through over an unreadable file. Bound to the hook set.
  const { HOOK_ON_UNREADABLE, HOOK_DEFAULT_ON_UNREADABLE } = await import("../lib/refusal.mjs");
  const { VERB_EFFECTS } = await import("../lib/verb-effects.mjs");
  const hooks = Object.keys(VERB_EFFECTS).filter((v) => VERB_EFFECTS[v].hook === true).sort();
  const settled = [...Object.keys(HOOK_ON_UNREADABLE), ...Object.keys(HOOK_DEFAULT_ON_UNREADABLE)].sort();
  assert.deepEqual(settled, hooks);
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

// ─────────────── 3 — concurrent saves are serialised and fsynced ───────────────

const lockPath = (cwd) => path.join(cwd, ".conductor", "state.json.lock");
const CONFLICT = 9;

/** Start `n` engine children at once — spawned, never sequential — and collect every outcome. */
function spawnAll(cwd, argvs) {
  return Promise.all(argvs.map((args) => new Promise((resolve) => {
    const child = spawn("node", [ENGINE, ...args], {
      cwd, env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, PM_CACHE_ROOT: EMPTY_CACHE },
    });
    let stderr = "";
    child.stderr.on("data", (d) => { stderr += d; });
    child.stdout.on("data", () => {});
    child.on("close", (status) => resolve({ args, status, stderr }));
  })));
}

/** The pid namespace this process is in, as the engine reads it — null where /proc is absent. */
function ourPidns() {
  try { return fs.readlinkSync("/proc/self/ns/pid"); } catch { return null; }
}

/** Place a lock file by hand, as another writer would have left it. */
function placeLock(cwd, content, { ageMs = 0 } = {}) {
  fs.writeFileSync(lockPath(cwd), typeof content === "string" ? content : JSON.stringify(content));
  if (ageMs) {
    const t = new Date(Date.now() - ageMs);
    fs.utimesSync(lockPath(cwd), t, t);
  }
}

/** Wrap functions on the default node:fs object for the duration of `fn`, recording every call. */
function withFsSpy(wrappers, fn) {
  const saved = {};
  for (const [name, wrap] of Object.entries(wrappers)) {
    saved[name] = fs[name];
    fs[name] = wrap(saved[name]);
  }
  try { return fn(); } finally { for (const [name, orig] of Object.entries(saved)) fs[name] = orig; }
}

/** Run `fn` with CLAUDE_PROJECT_DIR pointed at `cwd` and, optionally, --force on argv. */
async function inRepo(cwd, fn, { force = false } = {}) {
  const prevDir = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = cwd;
  if (force) process.argv.push("--force");
  try { return await fn(); } finally {
    if (force) process.argv.splice(process.argv.lastIndexOf("--force"), 1);
    if (prevDir === undefined) delete process.env.CLAUDE_PROJECT_DIR; else process.env.CLAUDE_PROJECT_DIR = prevDir;
  }
}

test("3.1: parallel writers never lose an update — 16 concurrent add-epic, three runs", async () => {
  for (let runNo = 0; runNo < 3; runNo++) {
    const cwd = tmpRepo();
    run(["init"], { cwd });
    const ids = Array.from({ length: 16 }, (_, i) => `p${runNo}-${i}`);
    const results = await spawnAll(cwd, ids.map((id) => ["add-epic", "--id", id, "--lane", "claude-code"]));
    const onDisk = new Set(JSON.parse(fs.readFileSync(statePath(cwd), "utf8")).epics.map((e) => e.id));
    for (const r of results) {
      const id = r.args[2];
      assert.doesNotMatch(r.stderr, /did not persist/, `run ${runNo} ${id}: ${r.stderr}`);
      if (r.status === 0) assert.ok(onDisk.has(id), `run ${runNo}: ${id} exited 0 but is not on disk`);
      else assert.equal(r.status, CONFLICT, `run ${runNo}: ${id} exited ${r.status}: ${r.stderr}`);
    }
    assert.ok(results.some((r) => r.status === 0), `run ${runNo}: at least one writer landed`);
    assert.ok(!fs.existsSync(lockPath(cwd)), "no lock left behind");
  }
});

test("3.1: the temp file is fsynced before it is renamed over state.json", async () => {
  const cwd = threeEpicRepo();
  const stateLib = await import("../lib/state.mjs");
  await inRepo(cwd, () => {
    const calls = [];
    const fdPath = new Map();
    withFsSpy({
      openSync: (orig) => (p, ...rest) => { const fd = orig(p, ...rest); fdPath.set(fd, String(p)); return fd; },
      fsyncSync: (orig) => (fd) => { calls.push({ op: "fsync", path: fdPath.get(fd) }); return orig(fd); },
      renameSync: (orig) => (from, to) => { calls.push({ op: "rename", from: String(from), to: String(to) }); return orig(from, to); },
    }, () => {
      const s = stateLib.loadState();
      s.epics.push({ id: "synced", title: "synced", status: "queued", lane: "claude-code" });
      stateLib.saveState(s);
    });
    const renameAt = calls.findIndex((c) => c.op === "rename" && c.to === statePath(cwd));
    assert.ok(renameAt !== -1, "the save renamed a temp file over state.json");
    const tmp = calls[renameAt].from;
    const fsyncAt = calls.findIndex((c) => c.op === "fsync" && c.path === tmp);
    assert.ok(fsyncAt !== -1 && fsyncAt < renameAt, `an fsync of ${tmp} precedes the rename: ${JSON.stringify(calls)}`);
  });
});

test("3.2 REGRESSION GUARD: every way out of a save held the lock and releases it", async () => {
  const stateLib = await import("../lib/state.mjs");
  const outcomes = {
    writes: (cwd) => { const s = stateLib.loadState(); s.epics.push({ id: "w", title: "w", status: "queued" }); stateLib.saveState(s); },
    noop: (cwd) => { const r = stateLib.saveState(stateLib.loadState()); assert.equal(r.unchanged, true); },
    conflict: (cwd) => {
      const s = stateLib.loadState();
      run(["add-epic", "--id", "other", "--lane", "claude-code"], { cwd });
      s.epics.push({ id: "c", title: "c", status: "queued" });
      assert.throws(() => stateLib.saveState(s), { name: "StateConflictError" });
    },
    unreadable: (cwd) => {
      const s = stateLib.loadState();
      s.epics.push({ id: "u", title: "u", status: "queued" });
      fs.writeFileSync(statePath(cwd), "{ not json");
      assert.throws(() => stateLib.saveState(s), { name: "StateUnreadableError" });
    },
    readBackFails: (cwd) => {
      const s = stateLib.loadState();
      s.epics.push({ id: "r", title: "r", status: "queued" });
      let renamed = false;
      withFsSpy({
        renameSync: (orig) => (from, to) => { const out = orig(from, to); renamed = true; return out; },
        readFileSync: (orig) => (p, ...rest) => {
          if (renamed && p === statePath(cwd)) throw Object.assign(new Error("injected"), { code: "EIO" });
          return orig(p, ...rest);
        },
      }, () => assert.throws(() => stateLib.saveState(s), { name: "StatePersistError" }));
    },
  };
  for (const [name, act] of Object.entries(outcomes)) {
    const cwd = threeEpicRepo();
    await inRepo(cwd, () => {
      let lockCreated = false;
      withFsSpy({
        openSync: (orig) => (p, flags, ...rest) => {
          if (String(p) === lockPath(cwd) && flags === "wx") lockCreated = true;
          return orig(p, flags, ...rest);
        },
      }, () => act(cwd));
      assert.ok(lockCreated, `${name}: the save created the lock`);
      assert.ok(!fs.existsSync(lockPath(cwd)), `${name}: no lock file remains`);
    });
  }
});

test("3.3: a live, fresh lock is waited for then refused — interactive, --force, hook, detached", async () => {
  const live = () => ({ pid: process.pid, host: os.hostname(), pidns: ourPidns(),
    acquiredAt: new Date().toISOString(), nonce: "live-holder-nonce" });

  // Interactive: exit 9 within the wait budget plus slack, nothing written, the holder named.
  const cwd = threeEpicRepo();
  placeLock(cwd, live());
  const before = bytes(statePath(cwd));
  const t0 = Date.now();
  const r = sh(["update-epic", "e1", "--status", "active"], { cwd });
  assert.equal(r.status, CONFLICT, `stderr: ${r.stderr}`);
  assert.ok(Date.now() - t0 < 2000 + 8000, "refused within the wait budget plus slack");
  assert.ok(sameBytes(before, bytes(statePath(cwd))), "state.json byte-identical");
  assert.match(r.stderr, new RegExp(`\\b${process.pid}\\b`), "names the recorded holder's pid");

  // --force bypasses only the revision comparison, never the lock.
  const forced = sh(["update-epic", "e1", "--status", "active", "--force"], { cwd });
  assert.equal(forced.status, CONFLICT, `stderr: ${forced.stderr}`);
  assert.ok(sameBytes(before, bytes(statePath(cwd))), "a forced save does not write through a held lock");

  // A hook write: retry once, then skip, recorded to the sidecar.
  const { saveHookHeal } = await import("../lib/hook-write.mjs");
  const stateLib = await import("../lib/state.mjs");
  const sidecar = path.join(cwd, ".conductor", "write-conflicts.log");
  const sidecarBefore = fs.existsSync(sidecar) ? fs.readFileSync(sidecar, "utf8") : "";
  const outcome = await inRepo(cwd, () => {
    const s = stateLib.loadState();
    s.epics[0].title = "healed";
    return saveHookHeal({ state: s, verb: "render", heal: (fresh) => { fresh.epics[0].title = "healed"; return true; } });
  });
  assert.equal(outcome.ok, false, "a hook write on a held lock skips");
  assert.ok(sameBytes(before, bytes(statePath(cwd))));
  const added = fs.readFileSync(sidecar, "utf8").slice(sidecarBefore.length).split("\n").filter(Boolean);
  assert.ok(added.length >= 1, "the sidecar gained an entry");
  assert.match(added[0], /\trender\t\d+\t\d+$/, `names the verb and two revisions: ${added[0]}`);

  // A detached tree: the save is still serialised.
  const detached = threeEpicRepo();
  gitIn(detached, "init", "-q");
  gitIn(detached, "add", "-A");
  gitIn(detached, "commit", "-q", "-m", "base");
  gitIn(detached, "checkout", "-q", "--detach");
  placeLock(detached, live());
  const dBefore = bytes(statePath(detached));
  const d = sh(["update-epic", "e1", "--status", "active"], { cwd: detached });
  assert.equal(d.status, CONFLICT, `detached tree, stderr: ${d.stderr}`);
  assert.ok(sameBytes(dBefore, bytes(statePath(detached))), "detached tree: state.json byte-identical");
});

test("3.5: a holder that no longer owns the lock does not rename", async () => {
  const cwd = threeEpicRepo();
  const stateLib = await import("../lib/state.mjs");
  const before = bytes(statePath(cwd));
  await inRepo(cwd, () => {
    const s = stateLib.loadState();
    s.epics.push({ id: "usurped", title: "usurped", status: "queued" });
    let replaced = false;
    let thrown = null;
    withFsSpy({
      fsyncSync: (orig) => (fd) => {
        if (!replaced) {
          replaced = true;
          try { fs.unlinkSync(lockPath(cwd)); } catch { /* absent today: there is no lock */ }
          fs.writeFileSync(lockPath(cwd), JSON.stringify({ pid: process.pid, host: os.hostname(),
            pidns: ourPidns(), acquiredAt: new Date().toISOString(), nonce: "a-different-lock" }));
        }
        return orig(fd);
      },
    }, () => { try { stateLib.saveState(s); } catch (e) { thrown = e; } });
    assert.ok(thrown, "the save must refuse");
    assert.equal(thrown.name, "StateConflictError", `got ${thrown && thrown.stack}`);
  });
  assert.ok(sameBytes(before, bytes(statePath(cwd))), "state.json byte-identical");
  assert.ok(fs.existsSync(lockPath(cwd)), "the other writer's lock is not removed");
  fs.unlinkSync(lockPath(cwd));
});

// ─────────────── 4 — a stale lock is broken, a live one is waited for then refused ───────────────

/** A pid that WAS running on this host and is not any more. */
function deadPid() {
  const r = spawnSync("node", ["-e", ""]);
  return r.pid;
}

test("4.1: a lock left by a dead process on this host and pid namespace does not wedge the repository", () => {
  const cwd = threeEpicRepo();
  placeLock(cwd, { pid: deadPid(), host: os.hostname(), pidns: ourPidns(),
    acquiredAt: new Date().toISOString(), nonce: "dead-holder" });
  const r = sh(["add-epic", "--id", "after-dead", "--lane", "claude-code"], { cwd });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assert.ok(JSON.parse(fs.readFileSync(statePath(cwd), "utf8")).epics.some((e) => e.id === "after-dead"));
  assert.ok(!fs.existsSync(lockPath(cwd)), "the pre-placed lock file is gone");
});

test("4.1: a lock older than the maximum age is broken, even when its content cannot be read", async () => {
  const { STATE_LOCK_STALE_MS } = await import("../lib/constants.mjs");
  const cwd = threeEpicRepo();
  placeLock(cwd, "{ half-writ", { ageMs: (STATE_LOCK_STALE_MS || 30000) + 60000 });
  const r = sh(["add-epic", "--id", "after-old", "--lane", "claude-code"], { cwd });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assert.ok(JSON.parse(fs.readFileSync(statePath(cwd), "utf8")).epics.some((e) => e.id === "after-old"));
  assert.ok(!fs.existsSync(lockPath(cwd)), "the pre-placed lock file is gone");
});

test("4.1: a holder in an unconfirmed pid namespace, or on another host, is judged by age only", () => {
  for (const [label, content] of [
    ["different pidns", { pid: deadPid(), host: os.hostname(), pidns: "pid:[1]-not-ours", nonce: "ns" }],
    ["different host", { pid: deadPid(), host: `${os.hostname()}-elsewhere`, pidns: ourPidns(), nonce: "host" }],
  ]) {
    const cwd = threeEpicRepo();
    placeLock(cwd, { ...content, acquiredAt: new Date().toISOString() });
    const before = bytes(statePath(cwd));
    const r = sh(["update-epic", "e1", "--status", "active"], { cwd });
    assert.equal(r.status, CONFLICT, `${label}: stderr: ${r.stderr}`);
    assert.ok(sameBytes(before, bytes(statePath(cwd))), `${label}: state.json byte-identical`);
    assert.ok(fs.existsSync(lockPath(cwd)), `${label}: the lock was not broken`);
  }
});

test("4.3(a): several breakers on one stale lock lose no update — 8 concurrent, three runs", async () => {
  for (let runNo = 0; runNo < 3; runNo++) {
    const cwd = tmpRepo();
    run(["init"], { cwd });
    placeLock(cwd, { pid: deadPid(), host: os.hostname(), pidns: ourPidns(),
      acquiredAt: new Date().toISOString(), nonce: `stale-${runNo}` });
    const ids = Array.from({ length: 8 }, (_, i) => `b${runNo}-${i}`);
    const results = await spawnAll(cwd, ids.map((id) => ["add-epic", "--id", id, "--lane", "claude-code"]));
    const onDisk = new Set(JSON.parse(fs.readFileSync(statePath(cwd), "utf8")).epics.map((e) => e.id));
    for (const r of results) {
      const id = r.args[2];
      if (r.status === 0) assert.ok(onDisk.has(id), `run ${runNo}: ${id} exited 0 but is not on disk`);
      else assert.equal(r.status, CONFLICT, `run ${runNo}: ${id} exited ${r.status}: ${r.stderr}`);
    }
    assert.ok(results.some((r) => r.status === 0), `run ${runNo}: the stale lock was broken by someone`);
    assert.ok(!fs.existsSync(lockPath(cwd)), "no lock left behind");
  }
});

test("4.3(b): a breaker that judged a lock stale removes nothing once another breaker has replaced it", async () => {
  // The Gate 1 interleaving: B judges L stale; A breaks L and acquires N; B then proceeds.
  const cwd = threeEpicRepo();
  const stateLib = await import("../lib/state.mjs");
  placeLock(cwd, { pid: deadPid(), host: os.hostname(), pidns: ourPidns(),
    acquiredAt: new Date().toISOString(), nonce: "L" });
  await inRepo(cwd, () => {
    const judgedByB = stateLib.inspectLock(lockPath(cwd));
    assert.ok(judgedByB && stateLib.isStaleLock(judgedByB), "precondition: B judges L stale");
    let bRemoved = null;
    let nDuringB = null;
    const s = stateLib.loadState();
    s.epics.push({ id: "by-a", title: "by-a", status: "queued" });
    withFsSpy({
      fsyncSync: (orig) => (fd) => {
        if (bRemoved === null) {
          // A holds N (inside its critical section): now B acts on its stale judgement of L.
          bRemoved = stateLib.breakStaleLock(judgedByB);
          nDuringB = stateLib.inspectLock(lockPath(cwd));
        }
        return orig(fd);
      },
    }, () => stateLib.saveState(s));
    assert.equal(bRemoved, false, "B removes nothing");
    assert.ok(nDuringB && nDuringB.nonce !== "L", "N was present while B acted");
  });
  const epics = JSON.parse(fs.readFileSync(statePath(cwd), "utf8")).epics.map((e) => e.id);
  assert.ok(epics.includes("by-a"), "A's save is the write that landed");
  assert.ok(!fs.existsSync(lockPath(cwd)), "A released N");
});

// ─────────────── 5 — advisory-claim lifetime is bounded; an unreadable expiry reads as expired ───────────────

const MAX_TTL = 10080;
const repoClaimPath = (cwd) => path.join(cwd, ".conductor", "session-claim.json");

test("5.1: an oversized TTL is refused at input, for an epic claim and the repository claim", () => {
  const cwd = threeEpicRepo();
  const before = bytes(statePath(cwd));
  const r = sh(["claim", "e1", "--session", "s1", "--ttl", "1e12"], { cwd });
  assert.notEqual(r.status, 0, `stderr: ${r.stderr}`);
  assert.match(r.stderr, new RegExp(String(MAX_TTL)), `names the maximum, got: ${r.stderr}`);
  assert.doesNotMatch(r.stderr, /RangeError/);
  assert.ok(sameBytes(before, bytes(statePath(cwd))), "state.json byte-identical");

  const repo = sh(["claim", "--repo", "--session", "s1", "--ttl", "1e12"], { cwd });
  assert.notEqual(repo.status, 0, `stderr: ${repo.stderr}`);
  assert.match(repo.stderr, new RegExp(String(MAX_TTL)));
  assert.ok(!fs.existsSync(repoClaimPath(cwd)), "session-claim.json not created");
});

test("5.1: the maximum itself is accepted and the report names its expiry", () => {
  const cwd = threeEpicRepo();
  const r = sh(["claim", "e1", "--session", "s1", "--ttl", String(MAX_TTL)], { cwd });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assert.match(r.stderr, /claimed by 's1' until \d{4}-\d{2}-\d{2}T/, r.stderr);
});

test("5.3: a poisoned epic claim already on disk reads as expired, and no reader throws", () => {
  const cwd = threeEpicRepo();
  const s = JSON.parse(fs.readFileSync(statePath(cwd), "utf8"));
  s.epics.find((e) => e.id === "e1").claim = { session: "s1", claimedAt: new Date().toISOString(), ttlMinutes: 1000000000000 };
  s.epics.find((e) => e.id === "e2").claim = { session: "s1", claimedAt: new Date().toISOString(), ttlMinutes: MAX_TTL + 1 };
  writeState(cwd, s);

  const owners = sh(["owners"], { cwd });
  assert.equal(owners.status, 0, `owners, stderr: ${owners.stderr}`);
  assert.match(owners.stdout, /`e1` — STALE/, owners.stdout);
  assert.match(owners.stdout, /`e2` — STALE/, `a TTL one minute above the maximum reads expired: ${owners.stdout}`);
  assert.doesNotMatch(owners.stdout, /\bnull\b/, "no literal null for an unreadable expiry");

  const integrity = sh(["integrity"], { cwd });
  assert.doesNotMatch(integrity.stderr, /RangeError|\n\s+at /, `integrity, stderr: ${integrity.stderr}`);
  assert.ok(integrity.status === 0 || integrity.status === 1, `integrity exits normally, got ${integrity.status}`);
  assert.match(integrity.stdout + integrity.stderr, /expired at an unreadable time/);

  const take = sh(["claim", "e1", "--session", "s2"], { cwd });
  assert.equal(take.status, 0, `claim by s2 without --steal, stderr: ${take.stderr}`);
  assert.match(take.stderr, /its claim had expired/);
});

test("5.3: a poisoned repository claim already on disk reads as expired", () => {
  const cwd = threeEpicRepo();
  fs.writeFileSync(repoClaimPath(cwd),
    JSON.stringify({ session: "s1", claimedAt: new Date().toISOString(), ttlMinutes: 1000000000000 }) + "\n");
  const r = sh(["owners"], { cwd });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assert.match(r.stdout, /repository: STALE/, r.stdout);
  assert.doesNotMatch(r.stdout, /\bnull\b/);
});

test("5.5: the repository claim is written by temp file plus rename, never directly", async () => {
  const cwd = threeEpicRepo();
  const { claim } = await import("../lib/claims.mjs");
  const target = repoClaimPath(cwd);
  const writes = [];
  const renames = [];
  const argv = process.argv.slice();
  await inRepo(cwd, () => {
    process.argv.splice(2, process.argv.length - 2, "claim", "--repo", "--session", "s1");
    try {
      withFsSpy({
        writeFileSync: (orig) => (p, ...rest) => { writes.push(String(p)); return orig(p, ...rest); },
        renameSync: (orig) => (from, to) => { renames.push([String(from), String(to)]); return orig(from, to); },
      }, () => claim());
    } finally { process.argv.splice(0, process.argv.length, ...argv); }
  });
  assert.ok(!writes.includes(target), `no direct write to ${target}: ${JSON.stringify(writes)}`);
  const rename = renames.find(([, to]) => to === target);
  assert.ok(rename, `a rename over the target: ${JSON.stringify(renames)}`);
  assert.equal(path.dirname(rename[0]), path.dirname(target), "the temp file is in .conductor/");
  assert.ok(writes.includes(rename[0]), "the temp file is the one written");
  assert.equal(JSON.parse(fs.readFileSync(target, "utf8")).session, "s1");
});
