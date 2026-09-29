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
// Since certification-record-redesign 2.4 the record is the manifest DIRECTORY
// (`<common>/pm-suite-certification.d/<bucket>/<key>.json`), so each case reads the entry the run wrote
// and asserts on the module's BLOB ID in its manifest — the identity `git ls-files -s` reports.
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
import { RECORD_DIR } from "../certification.mjs";
import { removeTempDir } from "../fixtures/temp-dir.mjs";

const TEST_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODULE = "scripts/lib/m.mjs";
const BASE = "export const touch = () => gitOps();\n";

const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** The fixture's one functional test — the test of its bucket the functional manifest must hold.
 *  PM_STUB_MODE picks what it does: pass, fail, `edit` (append to the module in the USER's working
 *  tree and stage it, mid-run), or `hang` (report ready with its pid, then wait to be killed). */
const STUB = `import { test } from "node:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
// IMPORTS m.mjs, the fixture's one module, so it is in the observed functional subject (3.3)
import { touch } from "../../lib/m.mjs";
void touch;
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
  for (const rel of ["certify.mjs", "certification.mjs", "drift.mjs", "js-lexer.mjs", "fixtures/temp-dir.mjs", "fixtures/observe-reads.mjs"]) {
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

const recordPath = (cwd) => path.join(cwd, ".git", RECORD_DIR);
/** Every entry the record holds for a bucket, parsed. */
const entriesOf = (cwd, bucket) => {
  const dir = path.join(recordPath(cwd), bucket);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => n.endsWith(".json")).map((n) => JSON.parse(fs.readFileSync(path.join(dir, n), "utf8")));
};
/** The one entry a single run wrote for a bucket. */
const onlyEntry = (cwd, bucket) => {
  const all = entriesOf(cwd, bucket);
  assert.equal(all.length, 1, `expected ONE ${bucket} entry, found ${all.length}`);
  return all[0];
};
/** The git blob id of some bytes — what a manifest records for a path holding them. */
const blobOf = (cwd, bytes) => execFileSync("git", ["-C", cwd, "hash-object", "--stdin"], { input: bytes, encoding: "utf8" }).trim();
const blobIn = (entry) => (entry.manifest[MODULE] || "").split(" ")[1];
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

  const entry = onlyEntry(cwd, "functional");
  assert.ok(entry.manifest[MODULE], `the functional manifest holds no ${MODULE}: ${JSON.stringify(Object.keys(entry.manifest))}`);
  assert.notEqual(blobIn(entry), blobOf(cwd, UNSTAGED),
    "certify recorded the WORKING TREE: the record describes bytes the commit does not contain (#230)");
  assert.equal(blobIn(entry), blobOf(cwd, STAGED), "the module's manifest line must be its STAGED blob");
  assert.ok(entry.manifest["scripts/test/functional/stub.test.mjs"], "the manifest names the test the pass rests on");
  assert.equal(blobIn(onlyEntry(cwd, "sweeps")), blobOf(cwd, STAGED), "and the sweeps entry records the same staged blob");

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
  const entry = onlyEntry(cwd, "functional");
  assert.equal(blobIn(entry), blobOf(cwd, before),
    "the record must describe the index copy taken at the START of the run, not an edit made during it");
  assert.notEqual(blobIn(entry), blobOf(cwd, after));
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
    assert.equal(entriesOf(cwd, "functional").length, 1, "a passing run records its entry");
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
    assert.deepEqual(entriesOf(cwd, "functional"), [], "a failing run recorded an entry");
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
    assert.deepEqual(entriesOf(cwd, "functional"), [], "an interrupted run recorded an entry");
    assert.deepEqual(runDirsIn(tmp), [], "an interrupted run left its run directory behind");
  }
});

// ─────────────── 1.3 — REGRESSION GUARD: the bucket passes in the shared clone ───────────────
//
// Several functional tests need a repository AROUND the content they run over: a HEAD, a parent
// commit, a readable object. Run from a bare `checkout-index` export, which has no `.git`, the
// functional half lost four files (task 0.3(d), baseline-before.md): conductor-13's "16.3" (`git
// rev-parse --short HEAD`), conductor-15 and gate-artifact-evidence as whole files, and conductor-37's
// history read — every failure `fatal: not a git repository`. The runner builds a `clone --shared`
// instead (design D2). This guard builds the run directory with the runner's OWN prepareRun(), over
// THIS repository's index, and runs those four files there. It passes the moment it exists; it is
// verified by building the run directory as a bare export in a scratch copy of certify.mjs, which
// must turn it red naming `not a git repository` (mutation-1.3.txt).

const BARE_EXPORT_CASUALTIES = [
  "scripts/test/functional/conductor-13.test.mjs",
  "scripts/test/functional/conductor-15.test.mjs",
  "scripts/test/functional/conductor-37.test.mjs",
  "scripts/test/functional/gate-artifact-evidence.test.mjs",
];

test("1.3 the four files a bare export breaks pass in the run directory the runner builds", async () => {
  const { prepareRun } = await import("../certify.mjs");
  const repo = path.join(TEST_ROOT, "..", "..");
  const commonDir = path.resolve(repo, git(repo, "rev-parse", "--git-common-dir").trim());
  const run = prepareRun(repo, commonDir);
  try {
    for (const rel of BARE_EXPORT_CASUALTIES) {
      assert.ok(fs.existsSync(path.join(run.tree, rel)), `${rel} is not in the run directory: the index no longer holds it`);
    }
    const r = spawnSync(process.execPath, ["--test", "--test-reporter=spec", ...BARE_EXPORT_CASUALTIES],
      { cwd: run.tree, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: certifyEnv({ FORCE_COLOR: "0" }) });
    const out = `${r.stdout}${r.stderr}`;
    const failing = out.split("\n").filter((l) => /^✖ /.test(l) || /not a git repository/.test(l));
    assert.equal(r.status, 0,
      `the files a bare export breaks failed in the runner's run directory (status ${r.status}):\n` +
      `${[...new Set(failing)].slice(0, 20).join("\n")}\n${out.split("\n").filter((l) => /^ℹ (tests|pass|fail) /.test(l)).join("\n")}`);
    assert.doesNotMatch(out, /not a git repository/, "a test in the run directory found no repository around it");
  } finally {
    removeTempDir(run.dir);
  }
});

// ─────────────── 3.1 — THE SHARED LEXER OVER THE WHOLE TRACKED TREE (functional twin case) ───────────────
//
// The functional subject's comment stripper and the static NODE_OPTIONS guard both FAIL CLOSED on a
// misparse (design D3 (b)): `lex()` records a quoted string or a regex literal meeting an unescaped
// newline, an unterminated block comment, and input ending inside a string, template, `${…}` or regex, and
// its callers throw on any. So a misparse anywhere in the files they read would stop every functional
// certification. This case reads EVERY tracked `.mjs`/`.cjs`/`.js` file under `scripts/` — the engine,
// `scripts/lib/`, and every file under `scripts/test/`, both halves and the fixtures — from this
// repository's INDEX (`git show :<path>`, the bytes a commit holds) and requires zero misparses. The unit
// rung reads no path, so this case lives here. A zero does NOT cover the statement-position regex
// misread (design D3 (b), the spec's fourth stated limit), which records no misparse.

test("3.1 the shared lexer reads every tracked script under scripts/ with zero misparses", async () => {
  const { lex } = await import("../js-lexer.mjs");
  const repo = path.join(TEST_ROOT, "..", "..");
  const files = git(repo, "ls-files", "-z", "--", "scripts").split("\0").filter((p) => /\.(mjs|cjs|js)$/.test(p));
  assert.ok(files.length > 100, `expected the whole scripts/ tree, found ${files.length} files`);
  const bad = [];
  for (const rel of files) {
    const src = execFileSync("git", ["-C", repo, "show", `:${rel}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    for (const m of lex(src).misparse) bad.push(`${rel}:${m.line}: ${m.what}`);
  }
  assert.deepEqual(bad, [], `the shared lexer misparsed ${bad.length} place(s) in ${files.length} tracked files`);
});

// ─────────────── 3.2 — THE RUN-TIME OBSERVER (design D3; suite-certification, "The functional subject's
// derivation is checked against what a run observes") ───────────────
//
// `certify.mjs functional` runs the half with `NODE_OPTIONS=--import <run>/tree/scripts/test/fixtures/
// observe-reads.mjs?…`, so every Node process the half starts records which tracked files it resolved,
// read or ran; certify then refuses an observed path outside `functionalSubject()` (the record excluded
// by rule), and a direct Node child that loaded code but never reported. Before the bucket runs, a static
// guard refuses a functional test or fixture whose code REPLACES NODE_OPTIONS. Each case below is a
// fixture repository whose functional bucket is one test file, certified by the real runner.

/** A fixture repository like `fixture()`, whose functional test is `body` and which also tracks `extra`. */
function observedFixture(body, extra = {}) {
  const cwd = fixture();
  fs.writeFileSync(path.join(cwd, "scripts/test/functional/stub.test.mjs"), body);
  for (const [rel, text] of Object.entries(extra)) {
    fs.mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true });
    fs.writeFileSync(path.join(cwd, rel), text);
  }
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", "observed fixture");
  return cwd;
}
const HEAD_LINES = 'import { test } from "node:test";\nimport assert from "node:assert/strict";\n' +
  'import fs from "node:fs";\nimport path from "node:path";\nimport { spawn, spawnSync } from "node:child_process";\n';
const HIDDEN = { "scripts/lib/hidden.mjs": "export const hidden = 1;\n" };
/** The fixture tests' one wait on a child, BOUNDED (#220): a hung child is killed and the wait resolves. */
const WAIT = 'const waitFor = (c) => new Promise((res) => { const t = setTimeout(() => { c.kill("SIGKILL"); res(null); }, 30000); ' +
  'c.on("close", (s) => { clearTimeout(t); res(s); }); });\n';

test("3.2 a tracked scripts/ file read through a path assembled at run time is refused, naming it, and no entry is written", () => {
  const cwd = observedFixture(HEAD_LINES +
    'test("reads a module by a built name", () => {\n' +
    '  const name = ["hid", "den"].join("") + ".mjs";\n' +
    '  assert.ok(fs.readFileSync(path.join(process.cwd(), "scripts", "lib", name), "utf8").length > 0);\n' +
    "});\n", HIDDEN);
  const r = certify(cwd, "functional");
  assert.notEqual(r.status, 0, `a read the derivation missed must fail the certification:\n${r.out}`);
  assert.match(r.out, /scripts\/lib\/hidden\.mjs[^\n]*the subject derivation missed it/, `the refusal names the file and says the derivation missed it:\n${r.out}`);
  assert.deepEqual(entriesOf(cwd, "functional"), [], "a refused run records no entry");
});

test("3.2 with the derivation complete — the same read, its name spelled — certify writes its entry", () => {
  const cwd = observedFixture(HEAD_LINES +
    'test("reads a module it names", () => {\n' +
    '  assert.ok(fs.readFileSync(path.join(process.cwd(), "scripts", "lib", "hidden.mjs"), "utf8").length > 0);\n' +
    "});\n", HIDDEN);
  const r = certify(cwd, "functional");
  assert.equal(r.status, 0, `a complete derivation certifies:\n${r.out}`);
  assert.ok(onlyEntry(cwd, "functional").manifest["scripts/test/functional/stub.test.mjs"], "the entry is written");
  assert.doesNotMatch(r.out, /observe-reads\.mjs/, "the observer's own load is never reported (m9)");
});

test("3.2 a read of the record (openspec/changes/archive/) is excluded by rule and does not refuse", () => {
  const cwd = observedFixture(HEAD_LINES +
    'test("walks the archive", () => {\n' +
    '  const dir = path.join(process.cwd(), "openspec", "changes", "archive");\n' +
    '  for (const d of fs.readdirSync(dir)) assert.ok(fs.readFileSync(path.join(dir, d, "tasks.md"), "utf8"));\n' +
    "});\n", { "openspec/changes/archive/2026-01-01-x/tasks.md": "- [x] 1.1 done\n" });
  const r = certify(cwd, "functional");
  assert.equal(r.status, 0, `a record read is not a refusal:\n${r.out}`);
  assert.equal(entriesOf(cwd, "functional").length, 1);
});

test("3.2 the static guard: a test whose CODE replaces NODE_OPTIONS is refused before the bucket runs, naming the file and line", () => {
  const ran = path.join(tmpRepo(), "ran");
  const cwd = observedFixture(HEAD_LINES +
    'test("replaces the options for a child", () => {\n' +
    '  fs.writeFileSync(process.env.PM_STUB_RAN, "1");\n' +
    '  const r = spawnSync(process.execPath, ["-e", "1"], { env: { ...process.env, NODE_OPTIONS: "--no-warnings" } });\n' +
    "  assert.equal(r.status, 0);\n" +
    "});\n");
  const r = certify(cwd, "functional", { PM_STUB_RAN: ran });
  assert.notEqual(r.status, 0, `the replacement must be refused:\n${r.out}`);
  assert.match(r.out, /scripts\/test\/functional\/stub\.test\.mjs:8\b[^\n]*NODE_OPTIONS/, `the refusal names the file and line:\n${r.out}`);
  assert.equal(fs.existsSync(ran), false, "the guard runs BEFORE the bucket");
  assert.deepEqual(entriesOf(cwd, "functional"), []);
});

test("3.2 the observer bypass: a direct Node child whose options are replaced at run time fails closed, naming the test file and argv", () => {
  const cwd = observedFixture(HEAD_LINES +
    'test("drops the observer from a child by a key the static guard cannot read", () => {\n' +
    "  const env = { ...process.env };\n" +
    '  env[["NODE", "OPTIONS"].join("_")] = "--no-warnings";\n' +
    '  const r = spawnSync(process.execPath, ["-e", "require(\\"node:fs\\")"], { env });\n' +
    "  assert.equal(r.status, 0);\n" +
    "});\n");
  const r = certify(cwd, "functional");
  assert.notEqual(r.status, 0, `an unobserved Node child must fail the certification closed:\n${r.out}`);
  assert.match(r.out, /never loaded the observer[^\n]*scripts\/test\/functional\/stub\.test\.mjs[^\n]*"-e"/, `the refusal names the test file and argv:\n${r.out}`);
  assert.deepEqual(entriesOf(cwd, "functional"), []);
});

test("3.2 `node --version` expects no report; `node -e \"\"`, a child that exits at once, and two concurrent children all report", () => {
  const cwd = observedFixture(HEAD_LINES + WAIT +
    'test("children that must not refuse", async () => {\n' +
    '  assert.equal(spawnSync(process.execPath, ["--version"]).status, 0);\n' +
    '  assert.equal(spawnSync(process.execPath, ["-e", ""]).status, 0);\n' +
    '  assert.equal(spawnSync(process.execPath, ["-e", "process.exit(0)"]).status, 0);\n' +
    '  const one = () => waitFor(spawn(process.execPath, ["-e", "setTimeout(() => {}, 300)"]));\n' +
    "  assert.deepEqual(await Promise.all([one(), one()]), [0, 0]);\n" +
    '  const url = globalThis[Symbol.for("pm.observe-reads")].url;\n' +
    '  assert.ok(fs.realpathSync(new URL(url).pathname).startsWith(fs.realpathSync(process.cwd()) + path.sep),\n' +
    '    "the observer that loaded is the RUN DIRECTORY\'s copy: " + url);\n' +
    "});\n");
  const r = certify(cwd, "functional");
  assert.equal(r.status, 0, `none of these children is unobserved:\n${r.out}`);
  assert.equal(entriesOf(cwd, "functional").length, 1);
});

test("3.2 two Node children observed at once each leave their own observation, and both are read", () => {
  const cwd = observedFixture(HEAD_LINES + WAIT +
    'test("two children read two files by built names, concurrently", async () => {\n' +
    '  const reader = (a, b) => "require(\\"node:fs\\").readFileSync(require(\\"node:path\\").join(process.cwd(), \\"scripts\\", \\"lib\\", " +\n' +
    '    JSON.stringify(a) + " + " + JSON.stringify(b) + "))";\n' +
    '  const run = (code) => waitFor(spawn(process.execPath, ["-e", code]));\n' +
    '  assert.deepEqual(await Promise.all([run(reader("hid", "den.mjs")), run(reader("sec", "ret.mjs"))]), [0, 0]);\n' +
    "});\n", { ...HIDDEN, "scripts/lib/secret.mjs": "export const secret = 1;\n" });
  const r = certify(cwd, "functional");
  assert.notEqual(r.status, 0, r.out);
  assert.match(r.out, /scripts\/lib\/hidden\.mjs/, `the first child's read is reported:\n${r.out}`);
  assert.match(r.out, /scripts\/lib\/secret\.mjs/, `and the second's — neither overwrote the other:\n${r.out}`);
});

test("G2 a child SIGTERMed after a read still reports the read: each new read reaches disk when it is seen", () => {
  // Gate 2 G2. The observer used to write a process's reads only at load, at an expected spawn and on
  // exit, and a signal-killed child runs no exit listener, so its reads were lost and certify passed a
  // run whose derivation had missed a file. The child reads a tracked file by a built name, says so, and
  // is SIGTERMed by the test, which then passes: the read must still be reported.
  const cwd = observedFixture(HEAD_LINES + WAIT +
    'test("a child reads, then is killed", async () => {\n' +
    '  const code = "require(\\"node:fs\\").readFileSync(require(\\"node:path\\").join(process.cwd(), \\"scripts\\", \\"lib\\", \\"hid\\" + \\"den.mjs\\")); " +\n' +
    '    "process.stdout.write(\\"read\\\\n\\"); setInterval(() => {}, 1000);";\n' +
    '  const c = spawn(process.execPath, ["-e", code]);\n' +
    '  await new Promise((res) => c.stdout.on("data", (d) => { if (String(d).includes("read")) res(); }));\n' +
    '  c.kill("SIGTERM");\n' +
    '  assert.equal(await waitFor(c), null, "the child was killed by the signal, so no exit listener ran");\n' +
    "});\n", HIDDEN);
  const r = certify(cwd, "functional");
  assert.notEqual(r.status, 0, `the killed child's read must fail the certification:\n${r.out}`);
  assert.match(r.out, /scripts\/lib\/hidden\.mjs[^\n]*the subject derivation missed it/, `the refusal names the file:\n${r.out}`);
  assert.deepEqual(entriesOf(cwd, "functional"), [], "a refused run records no entry");
});

test("m2 a corrupt observation file is a NAMED refusal — the file's path, no stack trace — and no entry is written", () => {
  // Gate 2 m2. A damaged observation used to escape as an exception, printed as a stack trace by the
  // runner's last-resort handler. The fixture test writes a corrupt observation file into its own run's
  // observation directory (the observer publishes it), so the half passes and the read of it fails.
  const cwd = observedFixture(HEAD_LINES +
    'test("damages the observation", () => {\n' +
    '  const dir = globalThis[Symbol.for("pm.observe-reads")].dir;\n' +
    '  fs.writeFileSync(path.join(dir, "damaged.jsonl"), "not json\\n{}\\n");\n' +
    "});\n");
  const r = certify(cwd, "functional");
  assert.notEqual(r.status, 0, `a run whose observation cannot be read must not be recorded:\n${r.out}`);
  assert.match(r.out, /damaged\.jsonl is corrupt at line 1/, `the refusal names the file and the line:\n${r.out}`);
  assert.doesNotMatch(r.out, /^\s+at /m, `a refusal, not a stack trace:\n${r.out}`);
  assert.deepEqual(entriesOf(cwd, "functional"), [], "no entry is written");
});

test("3.2 the token rule: a Node spawn that fails to start cancels its expectation and is not refused", () => {
  const cwd = observedFixture(HEAD_LINES +
    'test("spawns that never start", async () => {\n' +
    '  const missing = path.join(process.cwd(), "no-such-dir");\n' +
    '  assert.ok(spawnSync(process.execPath, ["-e", "1"], { cwd: missing }).error, "spawnSync reports the failure");\n' +
    '  await new Promise((res) => spawn(process.execPath, ["-e", "1"], { cwd: missing }).on("error", res));\n' +
    "});\n");
  const r = certify(cwd, "functional");
  assert.equal(r.status, 0, `a child that never started cannot report, and is not refused:\n${r.out}`);
});

// ─────────────── 3.2 — THE STATIC GUARD OVER THE WHOLE TRACKED TREE (functional twin case) ───────────────
//
// The unit rung pins the guard's shapes over texts handed to it; it reads no path. This case runs it over
// every tracked script under `scripts/test/{functional,fixtures}/`, read through git, at two points: at
// c96240ab — the commit the design measured, before task 3.2's fix — where it flags EXACTLY
// `functional/conformance.test.mjs:210`, the one child whose NODE_OPTIONS replaced the inherited value;
// and over this repository's INDEX, where it flags nothing.

test("3.2 the static guard flags exactly conformance.test.mjs:210 at c96240ab, and nothing over the index", async (t) => {
  const { nodeOptionsRefusals } = await import("../certification.mjs");
  const repo = path.join(TEST_ROOT, "..", "..");
  const SCOPE = /^scripts\/test\/(functional|fixtures)\/.+\.(mjs|cjs|js)$/;
  const read = (spec) => execFileSync("git", ["-C", repo, "show", spec], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const indexFiles = git(repo, "ls-files", "-z", "--", "scripts/test").split("\0").filter((p) => SCOPE.test(p));
  assert.deepEqual(nodeOptionsRefusals(indexFiles.map((p) => ({ path: p, text: read(`:${p}`) }))), [],
    "a functional test or fixture over the index replaces NODE_OPTIONS");
  let base = true;
  try { git(repo, "cat-file", "-e", "c96240ab^{commit}"); } catch { base = false; }
  if (!base) { t.skip("c96240ab is not in this clone"); return; }
  const oldFiles = git(repo, "ls-tree", "-r", "-z", "--name-only", "c96240ab", "--", "scripts/test").split("\0").filter((p) => SCOPE.test(p));
  assert.deepEqual(nodeOptionsRefusals(oldFiles.map((p) => ({ path: p, text: read(`c96240ab:${p}`) }))).map((r) => `${r.file}:${r.line}`),
    ["scripts/test/functional/conformance.test.mjs:210"], "at c96240ab the guard flags exactly the one replacement the design found");
});

// ─────────────── 3.5 — REGRESSION GUARD: the #229 reproduction, over the REAL index (Gate 1 M4) ───────────────
//
// b4ffe164 changed `scripts/lib/archive-gate.mjs` — a module the functional half imports, and which
// never reaches git — together with `scripts/lib/store.mjs`, and no functional run was demanded: the
// subject was then the modules that call the gateway, and archive-gate calls none (#229). Here the
// functional subject is derived over THIS repository's own index (`git ls-files` and `git show :<path>`
// in the repository, never an injected reader), and b4ffe164's two paths are taken as staged against a
// record with no agreeing entry: the result must be a functional DEMAND naming archive-gate.mjs.
// Why the index and not `git ls-tree b4ffe164`: that commit is reachable only from the tag
// `presquash/pr-234`, so a clone without the tag cannot read it. It passes the moment it exists; it is
// verified by restoring the `gitOps(` derivation in a scratch copy, which must turn it red (mutation-3.5.txt).

test("3.5 b4ffe164's change to an imported, gateway-free module demands the functional half over the real index", async () => {
  const { indexReaders, headSubject, indexManifest } = await import("../drift.mjs");
  const { bucketSubject, freshnessRefusal } = await import("../certification.mjs");
  const repo = path.join(TEST_ROOT, "..", "..");
  const readers = indexReaders(repo);
  const staged = ["scripts/lib/archive-gate.mjs", "scripts/lib/store.mjs"];
  for (const p of staged) assert.ok(readers.paths.includes(p), `precondition: the index holds ${p}`);
  const emptyRecord = tmpRepo();
  const refusal = freshnessRefusal({
    commonDir: emptyRecord,
    bucket: "functional",
    stagedPaths: staged,
    indexPaths: new Set(readers.paths),
    subjectIndex: () => bucketSubject("functional", { root: repo, ...readers }),
    subjectHead: () => headSubject(repo, "functional"),
    manifest: () => indexManifest(repo, "functional").manifest,
  });
  assert.ok(refusal, "b4ffe164's change demanded nothing: the functional subject misses a module the half imports (#229)");
  assert.ok(refusal.changed.includes("scripts/lib/archive-gate.mjs"),
    `the demand must name archive-gate.mjs, the module the retired gitOps( scan left out: ${JSON.stringify(refusal.changed)}`);
});
