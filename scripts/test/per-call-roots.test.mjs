// scripts/test/per-call-roots.test.mjs
//
// 0.47.0 (tasks 3.1 and 3.6). TWO ROOTS IN ONE PROCESS, and the two ways the old engine could not
// do it.
//
// 3.1 is the guarantee itself: `main()` called twice in one process against two different working
// directories — the first initialized, the second not — with each call's read and each call's write
// landing under the directory THAT call was given. Against 0.46.0 this test cannot even be written:
// `rg -n '^export' scripts/conductor.mjs` was empty, so there was no in-process call to make. It
// would also fail against an engine whose root is still captured at module load, which is the
// failure it exists to catch.
//
// 3.6 is a DIFFERENT failure that survives the constants sweep, and that is why it has its own
// test. `subcommands.mjs` cached `git rev-parse --show-prefix` in a module-scope `let`, under a
// comment stating the invariant "ROOT does not move under a running invocation". Per-call roots are
// precisely the decision that makes that invariant false, and a module-scope cache would then serve
// invocation 2 the prefix it computed for invocation 1 — mis-stripping every path and corrupting
// each CONDUCTOR_OWN_FILES comparison the root-divergence and bookkeeping-commit logic rests on.
// The test drives the cache through two invocations whose git answers genuinely differ: a conductor
// at the git root (prefix "") and a conductor in a SUBDIRECTORY of it (prefix "sub/").

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { EMPTY_CACHE, tmpRepo, run } from "./helpers.mjs";

const { main } = await import("../conductor.mjs");
const { changedFiles } = await import("../lib/subcommands.mjs");
const { setInvocation } = await import("../lib/invocation.mjs");

const baseEnv = (cwd) => ({ ...process.env, CLAUDE_PROJECT_DIR: cwd, PM_CACHE_ROOT: EMPTY_CACHE });

/** An in-process call, with caller-supplied streams. Returns what the caller can read back: the
 *  status, and everything the engine wrote on either channel. */
async function call(cwd, args) {
  let out = "", err = "";
  const status = await main(args, {
    cwd, env: baseEnv(cwd),
    stdin: { read: () => "", isTTY: false },
    stdout: { write: (s) => { out += s; return true; } },
    stderr: { write: (s) => { err += s; return true; } },
  });
  return { status, stdout: out, stderr: err };
}

const ids = (cwd) => JSON.parse(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"))
  .epics.map(e => e.id).sort();
const hasState = (cwd) => fs.existsSync(path.join(cwd, ".conductor", "state.json"));

test("3.1 two roots in one process: the first initialized, the second not — each call lands under its own", async () => {
  const first = tmpRepo();
  run(["init", "--platform", "claude-code"], { cwd: first });
  const second = tmpRepo();   // deliberately NOT initialized

  const a = await call(first, ["add-epic", "--id", "alpha", "--lane", "claude-code"]);
  assert.equal(a.status, 0, `the first call must succeed against the first root: ${a.stderr}`);
  assert.deepEqual(ids(first), ["alpha"], "the write landed under the root that call was given");

  const b = await call(second, ["add-epic", "--id", "beta", "--lane", "claude-code"]);
  assert.equal(b.status, 1, "the second root is not a conductor, so the same verb refuses there");
  assert.match(b.stderr, /run \/pm:init first/,
    "and it refuses for the SECOND root's reason, not by reading the first root's record");
  assert.equal(hasState(second), false, "the second call wrote nothing under its root");

  assert.deepEqual(ids(first), ["alpha"],
    "and the first root's record is exactly what the first call left — a module-scope root would " +
    "have had the second call read, or write, THIS repository");
});

test("3.1 the argument list is the one the caller passed, not the running process's", async () => {
  const cwd = tmpRepo();
  run(["init", "--platform", "claude-code"], { cwd });
  const own = [...process.argv];
  const r = await call(cwd, ["add-epic", "--id", "from-caller", "--lane", "claude-code"]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(ids(cwd), ["from-caller"], "the epic the caller named, not one from this process's argv");
  assert.deepEqual(process.argv, own, "and the calling process's own arguments are untouched");
});

// ───────────────────────────── 3.6 — the showPrefix symptom ─────────────────────────────

/** A git repository whose conductor sits at `nested` (a subdirectory, or the root when omitted),
 *  with one commit that touches a file at the git root and one under the conductor. Returns the
 *  commit's full name. */
function nestedRepo(nested) {
  const gitRoot = tmpRepo();
  const git = (...args) => execFileSync("git", args, {
    cwd: gitRoot, encoding: "utf8",
    env: { ...process.env, GIT_TEMPLATE_DIR: "", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "commit.gpgsign", GIT_CONFIG_VALUE_0: "false" },
  });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  const cwd = nested ? path.join(gitRoot, nested) : gitRoot;
  fs.mkdirSync(cwd, { recursive: true });
  run(["init", "--platform", "claude-code"], { cwd });
  fs.writeFileSync(path.join(gitRoot, "ROOTFILE.md"), "root\n");
  git("add", "-A");
  git("commit", "-q", "-m", "chore: both");
  return { gitRoot, cwd, sha: git("rev-parse", "HEAD").trim() };
}

test("3.6 changedFiles() strips the prefix of the root THAT invocation was given", async () => {
  // The FIRST invocation is the nested conductor: its own file is `PROJECT.md` relative to the
  // conductor root, and it must NOT come back carrying the `sub/` prefix git prints.
  const { gitRoot, cwd, sha } = nestedRepo("sub");
  const nestedCtx = {
    argv: ["node", "conductor.mjs", "render"],
    cwd, env: baseEnv(cwd), root: cwd,
    stdin: { read: () => "", isTTY: false },
    stdout: { write: () => true }, stderr: { write: () => true },
  };
  setInvocation(nestedCtx);
  const nestedPaths = changedFiles(sha);
  assert.ok(nestedPaths.includes("PROJECT.md"),
    `a nested conductor's own file is conductor-root relative — got ${JSON.stringify(nestedPaths)}`);

  // The SECOND invocation asks about the SAME commit from the git root, where the prefix is empty.
  // A module-scope cache would answer with the first invocation's prefix and strip nothing.
  // Built FRESH, never spread from nestedCtx: the per-invocation cache lives ON the context, so a
  // spread would carry the first invocation's cache into the second and the test would be
  // reproducing its own bug rather than the engine's.
  const rootCtx = {
    argv: ["node", "conductor.mjs", "render"],
    cwd: gitRoot, env: baseEnv(gitRoot), root: gitRoot,
    stdin: { read: () => "", isTTY: false },
    stdout: { write: () => true }, stderr: { write: () => true },
  };
  setInvocation(rootCtx);
  const rootPaths = changedFiles(sha);
  assert.ok(rootPaths.includes("sub/PROJECT.md"),
    `from the git root the same file is git-root relative — got ${JSON.stringify(rootPaths)}`);
  assert.ok(rootPaths.includes("ROOTFILE.md"));

  // And back again: the first invocation's answer must not have been overwritten by the second's.
  setInvocation(nestedCtx);
  assert.deepEqual(changedFiles(sha).sort(), nestedPaths.slice().sort(),
    "the cache is per invocation, so returning to the first root returns its own answer");
});
