// scripts/test/functional/certify-index.test.mjs
// certification-record-redesign task 1.2 (design D2; suite-certification, "Certification runs over the
// index the commit will be made from") — THE CERTIFY RUNNER OVER A REAL REPOSITORY.
//
// Its assertion twin is scripts/test/unit/certify-index.test.mjs, which pins the run PLAN as a value:
// the live index is read once, by a copy, and every later step reads the copy. What cannot be pinned
// there is what the plan DOES to a real repository, and that is this file:
//
//   * a partially staged file is certified as its STAGED half (#230);
//   * an edit made to the working tree while the bucket runs, and even a `git add` of it, is not in the
//     record, because the record is read from the copy taken before the run;
//   * a passing, a failing and a SIGTERM'd run each leave the working tree, the index, the stash and
//     the worktree list byte-identical, remove their run directory, and a failed or interrupted run
//     records nothing.
//
// Each case builds a fixture repository holding COPIES of this repository's certify.mjs,
// certification.mjs, drift.mjs and fixtures/temp-dir.mjs, so the runner under test is the real one,
// run as its own process, with the fixture as its repository. The fixture's functional bucket is one
// stub test whose behaviour an environment variable selects.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpRepo } from "../fixtures/functional-harness.mjs";
import { RECORD_NAME, contentHash } from "../certification.mjs";

const TEST_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODULE = "scripts/lib/m.mjs";
const BASE = "export const touch = () => gitOps();\n";

const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** The fixture's one functional test. It names `m.mjs`, so the module's entry has a non-empty covers.
 *  PM_STUB_MODE picks what it does: pass, fail, `edit` (append to the module in the USER's working
 *  tree and stage it, mid-run), or `hang` (report ready with its pid, then wait to be killed). */
const STUB = `import { test } from "node:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
// drives m.mjs, the fixture's one certified module
test("stub", async () => {
  const mode = process.env.PM_STUB_MODE || "pass";
  if (mode === "edit") {
    fs.appendFileSync(process.env.PM_STUB_EDIT, "export const MIDRUN = 1;\\n");
    execFileSync("git", ["-C", process.env.PM_STUB_REPO, "add", "--", "scripts/lib/m.mjs"]);
  }
  if (mode === "hang") {
    fs.writeFileSync(process.env.PM_STUB_READY, String(process.pid));
    await new Promise((resolve) => setTimeout(resolve, 60000));
  }
  if (mode === "fail") throw new Error("stub failed on purpose");
});
`;

function fixture() {
  const cwd = tmpRepo();
  git(cwd, "init", "-q");
  git(cwd, "config", "user.email", "test@example.com");
  git(cwd, "config", "user.name", "Test");
  const files = {
    "scripts/conductor.mjs": "export const main = () => 0;\n",
    [MODULE]: BASE,
    "scripts/test/functional/stub.test.mjs": STUB,
    "scripts/test/assert/stub.test.mjs": 'import { test } from "node:test";\ntest("stub twin", () => {});\n',
    "scripts/test/sweeps/output-interpolations.test.mjs": 'import { test } from "node:test";\ntest("sweep", () => {});\n',
  };
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true });
    fs.writeFileSync(path.join(cwd, rel), body);
  }
  for (const rel of ["certify.mjs", "certification.mjs", "drift.mjs", "fixtures/temp-dir.mjs"]) {
    fs.mkdirSync(path.dirname(path.join(cwd, "scripts/test", rel)), { recursive: true });
    fs.copyFileSync(path.join(TEST_ROOT, rel), path.join(cwd, "scripts/test", rel));
  }
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", "fixture");
  return cwd;
}

/** The environment a certify run gets: the node test runner's own markers removed, or the fixture's
 *  nested `node --test` would take itself for a worker of THIS run and run nothing. */
function certifyEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_TEST_WORKER_ID;
  return env;
}

function certify(cwd, bucket, extra) {
  const r = spawnSync(process.execPath, [path.join(cwd, "scripts/test/certify.mjs"), bucket],
    { cwd, encoding: "utf8", env: certifyEnv({ TMPDIR: tmpRepo(), ...extra }) });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

const recordPath = (cwd) => path.join(cwd, ".git", RECORD_NAME);
const readRecord = (cwd) => JSON.parse(fs.readFileSync(recordPath(cwd), "utf8"));
const hashOf = (bytes) => contentHash([MODULE], () => bytes);
/** The run directories left in `tmp`. Each run below is handed its OWN temp directory (TMPDIR), so a
 *  certify running concurrently in another worktree of this machine cannot enter the count. */
const runDirsIn = (tmp) => fs.readdirSync(tmp).filter((n) => n.startsWith("pm-certify-run."));

/** Everything the user owns that a run could change: every working-tree file's bytes, the index's
 *  bytes, the stash list and the worktree list. */
function snapshot(cwd) {
  const h = crypto.createHash("sha256");
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(cwd, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const r = path.join(rel, e.name);
      if (r === ".git") continue;
      if (e.isDirectory()) walk(r);
      else h.update(r).update("\0").update(fs.readFileSync(path.join(cwd, r))).update("\0");
    }
  };
  walk("");
  return {
    workingTree: h.digest("hex"),
    index: crypto.createHash("sha256").update(fs.readFileSync(path.join(cwd, ".git", "index"))).digest("hex"),
    stash: git(cwd, "stash", "list"),
    worktrees: git(cwd, "worktree", "list", "--porcelain"),
  };
}

test("1.2 a partial stage is certified as its STAGED half, and a commit of exactly that index is fresh", () => {
  const cwd = fixture();
  const STAGED = `${BASE}export const STAGED = 1;\n`;
  const UNSTAGED = `${STAGED}export const UNSTAGED = 1;\n`;
  fs.writeFileSync(path.join(cwd, MODULE), STAGED);
  git(cwd, "add", "--", MODULE);
  fs.writeFileSync(path.join(cwd, MODULE), UNSTAGED);
  assert.equal(git(cwd, "show", `:${MODULE}`), STAGED, "precondition: the index holds the staged half");

  const f = certify(cwd, "functional");
  assert.equal(f.status, 0, `certify functional failed on a passing bucket:\n${f.out}`);
  const s = certify(cwd, "sweeps");
  assert.equal(s.status, 0, `certify sweeps failed on a passing bucket:\n${s.out}`);

  const entries = readRecord(cwd).entries;
  assert.ok(entries[MODULE], `no entry for ${MODULE}: ${JSON.stringify(Object.keys(entries))}`);
  assert.notEqual(entries[MODULE].contentHash, hashOf(UNSTAGED),
    "certify hashed the WORKING TREE: the record describes bytes the commit does not contain (#230)");
  assert.equal(entries[MODULE].contentHash, hashOf(STAGED),
    "the module's entry must be the hash of its STAGED bytes");
  assert.deepEqual(entries[MODULE].covers, ["stub"], "the stub, which names the module, is its covers");

  // The gate agrees: the drift script, which reads the index, finds the commit fresh...
  const drift = spawnSync(process.execPath, [path.join(TEST_ROOT, "drift.mjs"), "--root", cwd], { encoding: "utf8" });
  assert.equal(drift.status, 0, `a commit of exactly the certified index must be fresh:\n${drift.stdout}${drift.stderr}`);
  // ...and refuses once the unstaged half is staged, which no run covered.
  git(cwd, "add", "--", MODULE);
  const stale = spawnSync(process.execPath, [path.join(TEST_ROOT, "drift.mjs"), "--root", cwd], { encoding: "utf8" });
  assert.notEqual(stale.status, 0, "staging the uncertified half must make the commit stale");
  assert.match(stale.stderr, /scripts\/lib\/m\.mjs/);
});

test("1.2 an edit, and a `git add` of it, made while the bucket runs are absent from the record", () => {
  const cwd = fixture();
  const before = git(cwd, "show", `:${MODULE}`);
  const r = certify(cwd, "functional",
    { PM_STUB_MODE: "edit", PM_STUB_EDIT: path.join(cwd, MODULE), PM_STUB_REPO: cwd });
  assert.equal(r.status, 0, `certify functional failed:\n${r.out}`);
  const after = git(cwd, "show", `:${MODULE}`);
  assert.notEqual(after, before, "precondition: the stub edited and staged the module mid-run");
  const entry = readRecord(cwd).entries[MODULE];
  assert.equal(entry.contentHash, hashOf(before),
    "the record must describe the index copy taken at the START of the run, not an edit made during it");
  assert.notEqual(entry.contentHash, hashOf(after));
});

test("1.2 a passing, a failing and a SIGTERM'd run leave the repository as they found it, and remove their run directory", async () => {
  // PASS: the record is written, and nothing the user owns moves.
  {
    const cwd = fixture();
    const tmp = tmpRepo();
    const was = snapshot(cwd);
    const r = certify(cwd, "functional", { TMPDIR: tmp });
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(snapshot(cwd), was, "a passing run changed the working tree, the index, the stash or the worktrees");
    assert.ok(fs.existsSync(recordPath(cwd)), "a passing run records its entry");
    assert.deepEqual(runDirsIn(tmp), [], "a passing run left its run directory behind");
  }
  // FAIL: nothing recorded, nothing moved, nothing left.
  {
    const cwd = fixture();
    const tmp = tmpRepo();
    const was = snapshot(cwd);
    const r = certify(cwd, "functional", { PM_STUB_MODE: "fail", TMPDIR: tmp });
    assert.notEqual(r.status, 0, "a failing bucket must fail the certification");
    assert.deepEqual(snapshot(cwd), was, "a failing run changed the working tree, the index, the stash or the worktrees");
    assert.equal(fs.existsSync(recordPath(cwd)), false, "a failing run recorded an entry");
    assert.deepEqual(runDirsIn(tmp), [], "a failing run left its run directory behind");
  }
  // SIGTERM mid-run: the bucket is killed with the runner, nothing recorded, nothing moved, nothing left.
  {
    const cwd = fixture();
    const tmp = tmpRepo();
    const was = snapshot(cwd);
    const ready = path.join(tmpRepo(), "ready");
    const child = spawn(process.execPath, [path.join(cwd, "scripts/test/certify.mjs"), "functional"],
      { cwd, env: certifyEnv({ PM_STUB_MODE: "hang", PM_STUB_READY: ready, TMPDIR: tmp }), stdio: "ignore" });
    // BOUNDED (#220): if the runner ignores the SIGTERM below, it is SIGKILLed after 60 s and the
    // wait resolves as a failure rather than hanging the half.
    const exited = new Promise((resolve) => {
      const bound = setTimeout(() => { child.kill("SIGKILL"); resolve({ code: null, signal: "timeout" }); }, 60000);
      child.on("exit", (code, signal) => { clearTimeout(bound); resolve({ code, signal }); });
    });
    const deadline = Date.now() + 60000;
    while (!fs.existsSync(ready) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    assert.ok(fs.existsSync(ready), "the stub never reported ready: the run did not reach the bucket");
    assert.equal(runDirsIn(tmp).length, 1, "mid-run, the run directory must exist in the TMPDIR it was handed — else the leftover check below is vacuous");
    const stubPid = Number(fs.readFileSync(ready, "utf8"));
    child.kill("SIGTERM");
    const { code, signal } = await exited;
    assert.ok(code === 143 || signal === "SIGTERM", `the runner did not end on SIGTERM (code ${code}, signal ${signal})`);
    let alive = true;
    for (const until = Date.now() + 10000; alive && Date.now() < until;) {
      try { process.kill(stubPid, 0); await new Promise((r) => setTimeout(r, 50)); } catch { alive = false; }
    }
    assert.equal(alive, false, `the bucket's test process ${stubPid} outlived the SIGTERM'd runner`);
    assert.deepEqual(snapshot(cwd), was, "an interrupted run changed the working tree, the index, the stash or the worktrees");
    assert.equal(fs.existsSync(recordPath(cwd)), false, "an interrupted run recorded an entry");
    assert.deepEqual(runDirsIn(tmp), [], "an interrupted run left its run directory behind");
  }
});
