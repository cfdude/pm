// scripts/test/certify.mjs
// THE CERTIFY RUNNER (design D7, tasks 6.2 / 6.3). Dev-only, plain Node, no dependency, in the test
// tree — it is NOT part of what the plugin ships, and it is the reason `package.json` still does not
// exist in this repository: it adds no development dependency either.
//
// WHAT IT IS FOR. The functional half and the sweep bucket run on triggers, which means they can go
// months without running, and "I ran it, it passed" is a memory. This runner is what replaces the
// memory: it runs a bucket, and on a PASS writes a machine-readable entry that says what passed, over
// WHICH CONTENT, and when. The gate then decides freshness from the recorded content rather than from
// the age of the record or from a commit identity — a module whose content is unchanged needs no new
// run however old the record, and one whose content changed needs a run however recent the record.
//
//   node scripts/test/certify.mjs functional   → the functional half; on pass, records every certified
//                                                module (the gateway's callers plus conductor.mjs)
//   node scripts/test/certify.mjs sweeps       → scripts/test/sweeps/; on pass, records the
//                                                `engine-source` trigger (conductor.mjs + lib/**)
//
// IT IS THE ONLY RECORD WRITER THERE IS, so "who produces this entry" has one answer rather than one
// per bucket. The two commands are the two a drift-script refusal NAMES, and neither substitutes for
// the other: an edit to `scripts/conductor.mjs` changes both hashes, so it demands a conformance run
// AND a sweep run (D9).
//
// THE RECORD LIVES UNDER `$(git rev-parse --git-common-dir)`, beside the `pm-suite.lock` the hook
// already keeps there — machine state, shared by every worktree of this clone, never committed. A
// fresh clone having no record is correct behaviour: the first commit touching a certified module
// demands a run.
//
// A FAILED RUN WRITES NOTHING. A record is a claim about a PASS; recording a failure would let the
// next commit read it as a result. The exit status is the runner's own, so a caller can gate on it.
//
// IT RUNS OVER THE INDEX, NOT THE WORKING TREE (certification-record-redesign D2, #230). The commit,
// and the pre-commit hook, judge the INDEX; a runner that ran and hashed the working tree certified
// bytes a partial stage does not commit. So the runner copies the index ONCE, builds a run directory
// from that copy (`indexRunPlan()` in certification.mjs: a `clone --shared` whose own index is the
// copy, exported with `checkout-index`), runs the bucket there, and hashes the entries it records
// from the copy's blobs. An edit or a `git add` during a run of several minutes changes neither what
// ran nor what is recorded. The run directory is `pm-certify-run.*` under the OS temp directory; it is
// removed when the runner exits, and on INT/TERM/HUP, which also kill the bucket. The runner never
// writes the working tree, the index, the stash or a worktree registration.
//
// IMPORT-SAFE: importing this module runs no git, copies no index and clones nothing
// (`assert/certify-count` imports it into the assertion half, where a spawn is a refusal). All of it
// runs from main(), which only the direct invocation at the bottom calls.

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONFORMANCE_ID, ENGINE_SOURCE, REPO, certifiedModules, functionalIds, indexRunPlan, moduleEntry,
  triggerEntry, writeEntry,
} from "./certification.mjs";
import { removeAtExit, removeTempDir } from "./fixtures/temp-dir.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The environment every git call and the bucket get: the caller's, WITHOUT the variables git sets
 *  for a hook process. An inherited one would point the run's git at the user's repository or index
 *  instead of the run directory's — the leak `.githooks/pre-commit` scrubs for the same reason. The
 *  caller's `GIT_INDEX_FILE` is read BEFORE the scrub (indexFileOf), because it names the index to
 *  certify. */
export const HOOK_GIT_VARS = ["GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE", "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_PREFIX"];
export function cleanEnv(env = process.env) {
  const out = { ...env };
  for (const k of HOOK_GIT_VARS) delete out[k];
  return out;
}

function git(root, args, extraEnv = {}) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", env: { ...cleanEnv(), ...extraEnv } }).trim();
}

/** The index this certification is taken over: `$GIT_INDEX_FILE` when the caller set one (made
 *  absolute against the caller's cwd, as git resolves it), else the worktree's own index, which in a
 *  linked worktree is `<common>/worktrees/<name>/index`. */
function indexFileOf(root) {
  if (process.env.GIT_INDEX_FILE) return path.resolve(process.cwd(), process.env.GIT_INDEX_FILE);
  return git(root, ["rev-parse", "--path-format=absolute", "--git-path", "index"]);
}

/** Execute `indexRunPlan()` in a fresh run directory. Returns the run directory, the clone the bucket
 *  runs in, and readers over the INDEX COPY in the shape the certification functions take — `readdir`
 *  over the copy's paths, `readFile` returning a path's blob as the copy holds it (or "" for a path
 *  the copy does not hold, exactly as drift's `indexReaders()` reads the commit's index).
 *  Exported for functional/certify-index's 1.3 guard, which runs files in the directory it builds. */
export function prepareRun(root, gitCommonDir) {
  const dir = removeAtExit(fs.mkdtempSync(path.join(os.tmpdir(), "pm-certify-run.")));
  let headSha = null;
  try { headSha = git(root, ["rev-parse", "--verify", "-q", "HEAD"]) || null; } catch { headSha = null; }
  const plan = indexRunPlan({ indexFile: indexFileOf(root), commonDir: gitCommonDir, headSha, tmp: dir });
  let lsFiles = null;
  for (const step of plan.steps) {
    if (step.op === "copy") { fs.copyFileSync(step.from, step.to); continue; }
    const out = execFileSync("git", step.args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: { ...cleanEnv(), ...(step.env || {}) } });
    if (step.args.includes("ls-files")) lsFiles = out;
  }
  // `ls-files -s -z`: "<mode> <blob> <stage>\t<path>\0" per entry.
  const blobs = new Map();
  for (const rec of (lsFiles || "").split("\0").filter(Boolean)) {
    const tab = rec.indexOf("\t");
    blobs.set(rec.slice(tab + 1), rec.slice(0, tab).split(" ")[1]);
  }
  const paths = [...blobs.keys()];
  const tree = plan.tree;
  const rel = (abs) => path.relative(tree, abs).split(path.sep).join("/");
  const readdir = (abs) => {
    const prefix = rel(abs) ? `${rel(abs)}/` : "";
    const names = new Set();
    for (const f of paths) if (f.startsWith(prefix)) names.add(f.slice(prefix.length).split("/")[0]);
    return [...names].sort();
  };
  const cache = new Map();
  const readFile = (abs) => {
    const blob = blobs.get(rel(abs));
    if (!blob) return "";
    // UNTRIMMED, unlike git(): these are the bytes the hash is taken over, and drift reads the same
    // blob untrimmed (`show :<path>`), so the two hashes agree byte for byte.
    if (!cache.has(blob)) {
      cache.set(blob, execFileSync("git", ["-C", tree, "cat-file", "blob", blob],
        { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: cleanEnv() }));
    }
    return cache.get(blob);
  };
  return { dir, tree, readdir, readFile };
}

/** The bucket's files, expanded here rather than left to a shell: the runner is invoked from a
 *  script (and from CI) where the glob would otherwise be the shell's to expand, and a glob that
 *  quietly stopped matching is the failure this whole change is about. An empty list is an error
 *  rather than a zero-test pass. */
function bucketFiles(root, bucket) {
  const dir = path.join(root, "scripts", "test", bucket === ENGINE_SOURCE ? "sweeps" : bucket);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".test.mjs")).sort().map((f) => path.join(dir, f));
  if (!files.length) throw new Error(`certify: no test files under ${path.relative(root, dir)} — refusing to record a run of nothing`);
  return files;
}

/** One count from the runner's summary: `ℹ <label> N` at the start of a line, or `null`. ONE FORMAT
 *  (0.49.0, design D4): the runner is started with `--test-reporter=spec` and `FORCE_COLOR=0`, so the
 *  summary is these bytes on every supported Node major. A TAP summary (`# tests N`) or a coloured one
 *  (`ESC[34mℹ tests N`) is NOT read — a count in another format is one this runner did not ask for. */
export function summaryCount(output, label) {
  const m = new RegExp(`^ℹ ${label} (\\d+)$`, "m").exec(output);
  return m ? Number(m[1]) : null;
}

/** One bucket run. Returns `{ ok, counts, output }`; `counts` is read from the runner's own summary
 *  line, in the one format the runner is forced to print. */
/** The runner's argv and environment for a bucket: the spec reporter FORCED and colour OFF, whatever
 *  the caller's environment says, so the summary is the one format `summaryCount()` reads. Exported so
 *  a test asserts what the runner is actually handed (Gate 2 I2). */
export function runnerInvocation(files, env = process.env) {
  return { args: ["--test", "--test-reporter=spec", ...files], env: { ...env, FORCE_COLOR: "0" } };
}

/** The bucket's runner, while one is running — what a signal handler must kill before it exits. */
let activeRun = null;

/** How long one bucket run may take before it is killed and fails. */
const BUCKET_BOUND_MS = 60 * 60 * 1000;

/** Run a bucket IN THE RUN DIRECTORY's clone (`tree`), asynchronously so a signal reaches its handler
 *  while the bucket runs. The runner is started in its OWN process group (`detached`), so a signal
 *  handler kills the runner and every test process under it at once (`killActiveRun`). */
function runBucket(tree, bucket) {
  const files = bucketFiles(tree, bucket);
  const { args, env } = runnerInvocation(files, cleanEnv());
  return new Promise((resolve) => {
    let stdout = "", stderr = "";
    const child = spawn(process.execPath, args, { cwd: tree, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    activeRun = child;
    child.stdout.setEncoding("utf8").on("data", (d) => { stdout += d; });
    child.stderr.setEncoding("utf8").on("data", (d) => { stderr += d; });
    let settled = false;
    // BOUNDED (#220's rule, assert/state-file-refuses-to-guess 5.1): a bucket that hangs must not
    // hang the runner forever. The bound is far above the slowest measured functional run (672 s
    // under a load average above 140); on expiry the whole group is killed and the run FAILS, which
    // records nothing. The timer resolves the run itself, because a grandchild holding a pipe can keep
    // 'close' from ever firing.
    const timer = setTimeout(() => {
      try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ }
      done(null, `\ncertify: the ${bucket} run exceeded ${BUCKET_BOUND_MS / 60000} minutes and was killed.\n`);
    }, BUCKET_BOUND_MS);
    const done = (status, extra = "") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      activeRun = null;
      const output = `${stdout}${stderr}${extra}`;
      resolve({
        ok: status === 0,
        status,
        counts: { tests: summaryCount(output, "tests"), pass: summaryCount(output, "pass"), fail: summaryCount(output, "fail") },
        output,
      });
    };
    child.on("error", (e) => done(null, `\ncertify: could not start the runner: ${e.message}\n`));
    child.on("close", (status) => done(status));
  });
}

/** Kill the running bucket's whole process group. Silent when there is none, or it is already gone. */
function killActiveRun(signal) {
  if (!activeRun) return;
  try { process.kill(-activeRun.pid, signal); } catch { /* already gone */ }
}

/** A passing run is recorded only over a count that was READ and is not ZERO. A record is a claim about
 *  a pass over N tests; an unreadable or empty count is a run this runner cannot vouch for. Returns
 *  the refusal text, or `null` when the count may be recorded. Exported for its test (Gate 2 I2). */
export function countRefusal(label, counts) {
  if (counts.tests === null || counts.pass === null) {
    return `certify: the ${label} passed but its count could not be read (no '^ℹ tests' / '^ℹ pass' line). Nothing recorded.\n`;
  }
  if (counts.tests === 0) return `certify: the ${label} ran ZERO tests. Nothing recorded — a run of nothing is not a pass.\n`;
  return null;
}

/** The provenance and the timing every entry carries. `engineSha` is INFORMATIONAL (D7): nothing
 *  gates on it — the freshness test is the content hash, because a sha record has to be checked for
 *  ancestry and goes stale on a rebase that changed nothing. It says how the certification was
 *  produced, and that is all it is for. */
function provenance(root) {
  let engineSha = "unknown";
  try { engineSha = git(root, ["rev-parse", "HEAD"]); } catch { /* not a commit yet — a bare `git init` */ }
  return { ranAt: new Date().toISOString(), engineSha };
}

/** The functional half, over the run's index copy. The entries are the OLD single-file format (L1 of
 *  the redesign keeps the reader it has): one per certified module, hashed from the COPY's blobs, so
 *  the hash is the one drift takes over the commit's staged bytes. */
async function certifyFunctional(root, gitCommonDir, run) {
  const result = await runBucket(run.tree, "functional");
  if (!result.ok) {
    process.stderr.write(result.output);
    process.stderr.write(`\ncertify: the functional half FAILED (status ${result.status}). Nothing recorded — a record is a claim about a pass.\n`);
    return 1;
  }
  const refusedF = countRefusal("functional half", result.counts);
  if (refusedF) { process.stderr.write(result.output + "\n" + refusedF); return 1; }
  const { ranAt, engineSha } = provenance(root);
  const { tree, readFile, readdir } = run;
  const functional = functionalIds(tree, readdir);
  const mods = certifiedModules(tree, readFile, readdir);
  for (const id of mods) {
    writeEntry(gitCommonDir, id, moduleEntry(id, { root: tree, functional, counts: result.counts, ranAt, engineSha, readFile }));
  }
  process.stdout.write(
    `certify: functional half passed (${result.counts.pass}/${result.counts.tests}); recorded ${mods.length} module ` +
    `entries in ${path.join(gitCommonDir, "pm-suite-certification.json")}\n`,
  );
  return 0;
}

/** The sweep bucket, over the run's index copy; its `engine-source` entry is hashed from the copy. */
async function certifySweeps(root, gitCommonDir, run) {
  const result = await runBucket(run.tree, ENGINE_SOURCE);
  if (!result.ok) {
    process.stderr.write(result.output);
    process.stderr.write(`\ncertify: the sweeps bucket FAILED (status ${result.status}). Nothing recorded.\n`);
    return 1;
  }
  const refusedS = countRefusal("sweeps bucket", result.counts);
  if (refusedS) { process.stderr.write(result.output + "\n" + refusedS); return 1; }
  const { ranAt, engineSha } = provenance(root);
  const entry = triggerEntry({ root: run.tree, counts: result.counts, ranAt, engineSha, readFile: run.readFile, readdir: run.readdir });
  writeEntry(gitCommonDir, ENGINE_SOURCE, entry);
  process.stdout.write(
    `certify: sweeps bucket passed (${result.counts.pass}/${result.counts.tests}); recorded the '${ENGINE_SOURCE}' ` +
    `entry over ${entry.files.length} engine-source files\n`,
  );
  return 0;
}

/** Resolves to the exit status. The run directory is removed before it resolves, and by the exit
 *  listener `removeAtExit()` registered if the process ends first. */
export async function main(argv, { root = REPO } = {}) {
  const bucket = argv[0];
  if (bucket !== "functional" && bucket !== "sweeps") {
    process.stderr.write(
      "certify: usage: node scripts/test/certify.mjs <functional|sweeps>\n" +
      "  functional — run scripts/test/functional/ over the index and record every certified module on a pass\n" +
      "  sweeps     — run scripts/test/sweeps/ over the index and record the engine-source trigger on a pass\n",
    );
    return 1;
  }
  const gitCommonDir = path.resolve(root, git(root, ["rev-parse", "--git-common-dir"]));
  const run = prepareRun(root, gitCommonDir);
  try {
    return bucket === "sweeps" ? await certifySweeps(root, gitCommonDir, run) : await certifyFunctional(root, gitCommonDir, run);
  } finally {
    removeTempDir(run.dir);
  }
}

// REALPATHS ON BOTH SIDES (0.50.0): Node resolves the main module to its REAL path, so a script run
// through a symlinked directory — macOS $TMPDIR is /var/… -> /private/var/…, where the pre-commit hook
// now runs drift from its index snapshot — compared unequal, did nothing, and exited 0.
const invokedDirectly = (() => {
  try { return fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }  // no argv[1], or one that is not a file: imported, not run
})();
if (invokedDirectly) {
  // A SIGNAL KILLS THE BUCKET AND ENDS THE RUN, and the exit listener removeAtExit() registered then
  // removes the run directory. Registered here, never at import, so importing the module stays inert.
  // The exit codes are the shell's (128 + the signal number), as .githooks/pre-commit uses.
  for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]]) {
    process.on(signal, () => { killActiveRun(signal); process.exit(code); });
  }
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => { process.stderr.write(`certify: ${e && e.stack ? e.stack : e}\n`); process.exit(1); },
  );
}

export { CONFORMANCE_ID, HERE };
