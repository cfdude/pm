// scripts/test/certify.mjs
// THE CERTIFY RUNNER (design D7, tasks 6.2 / 6.3). Dev-only, plain Node, no dependency, in the test
// tree — it is NOT part of what the plugin ships, and it is the reason `package.json` still does not
// exist in this repository: it adds no development dependency either.
//
// WHAT IT IS FOR. The functional half and the sweep bucket run on triggers, which means they can go
// months without running, and "I ran it, it passed" is a memory. This runner is what replaces the
// memory: it runs a bucket, and on a PASS writes a machine-readable entry that says what passed, over
// WHICH CONTENT, and when. The gate then decides freshness from the recorded content rather than from
// the age of the record or from a commit identity — a subject whose content is unchanged needs no new
// run however old the record, and one whose content changed needs a run however recent the record.
//
//   node scripts/test/certify.mjs functional   → the functional half; on pass, records ONE entry: the
//                                                manifest of the functional subject in the run's index
//   node scripts/test/certify.mjs sweeps       → scripts/test/sweeps/; on pass, records ONE entry: the
//                                                manifest of the sweeps subject in the run's index
//
// IT IS THE ONLY RECORD WRITER THERE IS, so "who produces this entry" has one answer rather than one
// per bucket. The two commands are the two a drift-script refusal NAMES, and neither substitutes for
// the other: an edit to `scripts/conductor.mjs` is in both subjects, so it demands both runs (D9).
//
// THE RECORD IS A DIRECTORY UNDER `$(git rev-parse --git-common-dir)` (certification-record-redesign
// D1): `pm-suite-certification.d/<bucket>/<manifest key>.json`, one file per passing run, created and
// never rewritten, so parallel worktrees certify with no lock. Machine state, shared by every worktree
// of this clone, never committed. The manifest is read through drift's `indexManifest()` over the
// run's index COPY — the same function drift judges a commit with. A fresh clone having no record is
// correct behaviour: the first commit that stages a subject path demands a run. The superseded
// single-file record `pm-suite-certification.json` is neither written nor removed (D5).
//
// A FAILED RUN WRITES NOTHING. A record is a claim about a PASS; recording a failure would let the
// next commit read it as a result. The exit status is the runner's own, so a caller can gate on it.
//
// IT RUNS OVER THE INDEX, NOT THE WORKING TREE (certification-record-redesign D2, #230). The commit,
// and the pre-commit hook, judge the INDEX; a runner that ran and hashed the working tree certified
// bytes a partial stage does not commit. So the runner copies the index ONCE, builds a run directory
// from that copy (`indexRunPlan()` in certification.mjs: a `clone --shared` whose own index is the
// copy, exported with `checkout-index`), runs the bucket there, and records the manifest of the
// copy. An edit or a `git add` during a run of several minutes changes neither what
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
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  OBSERVER, REPO, bucketDir, functionalSubject, indexRunPlan, nodeOptionsRefusals, observationRefusals, pruneRecord,
  writeManifestEntry,
} from "./certification.mjs";
import { indexManifest, indexReaders } from "./drift.mjs";
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
 *  runs in, and the path of the INDEX COPY, which the manifest is read from.
 *  Exported for functional/certify-index's 1.3 guard, which runs files in the directory it builds. */
export function prepareRun(root, gitCommonDir) {
  const dir = removeAtExit(fs.mkdtempSync(path.join(os.tmpdir(), "pm-certify-run.")));
  let headSha = null;
  try { headSha = git(root, ["rev-parse", "--verify", "-q", "HEAD"]) || null; } catch { headSha = null; }
  const plan = indexRunPlan({ indexFile: indexFileOf(root), commonDir: gitCommonDir, headSha, tmp: dir });
  for (const step of plan.steps) {
    if (step.op === "copy") { fs.copyFileSync(step.from, step.to); continue; }
    execFileSync("git", step.args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: { ...cleanEnv(), ...(step.env || {}) } });
  }
  return { dir, tree: plan.tree, indexCopy: plan.copy, root };
}

/** The bucket's files, expanded here rather than left to a shell: the runner is invoked from a
 *  script (and from CI) where the glob would otherwise be the shell's to expand, and a glob that
 *  quietly stopped matching is the failure this whole change is about. An empty list is an error
 *  rather than a zero-test pass. */
function bucketFiles(root, bucket) {
  const dir = path.join(root, "scripts", "test", bucket);
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
function runBucket(tree, bucket, extraEnv = {}) {
  const files = bucketFiles(tree, bucket);
  const { args, env } = runnerInvocation(files, { ...cleanEnv(), ...extraEnv });
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

/** The provenance every entry carries. `engineSha` is INFORMATIONAL (D7): nothing gates on it — the
 *  freshness test is the manifest, because a sha record has to be checked for ancestry and goes stale
 *  on a rebase that changed nothing. `ranAt` is stamped by the writer when the entry is WRITTEN. */
function provenance(root) {
  let engineSha = "unknown";
  try { engineSha = git(root, ["rev-parse", "HEAD"]); } catch { /* not a commit yet — a bare `git init` */ }
  return { engineSha };
}

/** One bucket, over the run's index copy. On a pass it records ONE entry — the manifest of the
 *  bucket's subject in the COPY, read through drift's `indexManifest()` (the function drift judges a
 *  commit with) — then prunes the bucket's directory, never removing the entry it just wrote. */
async function certifyBucket(root, gitCommonDir, run, bucket) {
  const label = bucket === "functional" ? "functional half" : "sweeps bucket";
  let observed = null;
  if (bucket === "functional") {
    // THE STATIC GUARD, BEFORE THE BUCKET RUNS, over the exported index copy (design D3, Gate 1 B4).
    const guard = staticGuardRefusal(run);
    if (guard) { process.stderr.write(guard); return 1; }
    observed = observerEnv(run);
    if (typeof observed === "string") { process.stderr.write(observed); return 1; }
  }
  const result = await runBucket(run.tree, bucket, observed ? observed.env : {});
  if (!result.ok) {
    process.stderr.write(result.output);
    process.stderr.write(`\ncertify: the ${label} FAILED (status ${result.status}). Nothing recorded — a record is a claim about a pass.\n`);
    return 1;
  }
  const refused = countRefusal(label, result.counts);
  if (refused) { process.stderr.write(result.output + "\n" + refused); return 1; }
  if (observed) {
    const seen = observationRefusal(root, run, observed.dir, label, result.counts);
    if (seen) { process.stderr.write(seen); return 1; }
  }
  const { engineSha } = provenance(root);
  let worktree = null;
  try { worktree = git(root, ["rev-parse", "--path-format=absolute", "--git-dir"]); } catch { /* informational only */ }
  const { manifest } = indexManifest(root, bucket, { indexFile: run.indexCopy });
  const { key, file } = writeManifestEntry(gitCommonDir, { bucket, manifest, counts: result.counts, engineSha, worktree });
  pruneRecord(gitCommonDir, bucket, { keep: key });
  process.stdout.write(
    `certify: ${label} passed (${result.counts.pass}/${result.counts.tests}); recorded ${Object.keys(manifest).length} ` +
    `subject paths as ${path.relative(bucketDir(gitCommonDir, bucket), file)} in ${bucketDir(gitCommonDir, bucket)}\n`,
  );
  return 0;
}

// ───────────────────────── the run-time observer (certification-record-redesign D3, task 3.2) ─────────────────────────

/** The static NODE_OPTIONS guard over the RUN's tree — the exported index copy, so the guard reads the
 *  bytes that run. Every tracked script under `scripts/test/{functional,fixtures}/` is judged by
 *  `nodeOptionsRefusals()`; a misparse throws and fails the certification closed. Returns the refusal
 *  text, or null. */
function staticGuardRefusal(run) {
  const readers = indexReaders(REPO_OF(run), { indexFile: run.indexCopy });
  const files = readers.paths.filter((p) => /^scripts\/test\/(functional|fixtures)\/.+\.(mjs|cjs|js)$/.test(p))
    .map((p) => ({ path: p, text: fs.readFileSync(path.join(run.tree, p), "utf8") }));
  const found = nodeOptionsRefusals(files);
  if (!found.length) return null;
  return "certify: the static NODE_OPTIONS guard refuses — each line below assigns NODE_OPTIONS a value that does not carry " +
    "process.env.NODE_OPTIONS, so a Node child under it drops the run-time observer (design D3). Append to the inherited " +
    "value instead: `${process.env.NODE_OPTIONS ?? \"\"} --require …`.\n" +
    found.map((r) => `  ${r.file}:${r.line} — NODE_OPTIONS = ${r.value}\n`).join("") +
    "certify: nothing run, nothing recorded.\n";
}

/** The repository whose object store the run's index copy points into — the root certify was run for.
 *  Kept on the run by prepareRun(). */
const REPO_OF = (run) => run.root;

/** The observer's environment: `NODE_OPTIONS` APPENDED with `--import` of the RUN TREE's observer (the
 *  staged copy, m9), configured through its own URL — its observation directory and the run tree — so an
 *  observer stacked on another keeps its own run (a certify inside a certified functional test). Returns
 *  `{ env, dir }`, or the refusal text when the index holds no observer. */
function observerEnv(run) {
  const file = path.join(run.tree, OBSERVER);
  if (!fs.existsSync(file)) {
    return `certify: the index holds no ${OBSERVER}, so the functional half cannot be observed — refusing to record an unobserved run.\n`;
  }
  const dir = path.join(run.dir, "observe");
  fs.mkdirSync(dir, { recursive: true });
  const url = pathToFileURL(file);
  url.searchParams.set("dir", dir);
  url.searchParams.set("root", run.tree);
  const inherited = cleanEnv().NODE_OPTIONS;
  return { dir, env: { NODE_OPTIONS: `${inherited ? `${inherited} ` : ""}--import=${url.href}` } };
}

/** After a PASS: every observation file the run's processes wrote, judged by `observationRefusals()`
 *  against `functionalSubject()` over the run's index copy. Returns the refusal text, or null. */
function observationRefusal(root, run, dir, label, counts) {
  const observations = fs.readdirSync(dir).filter((n) => n.endsWith(".json"))
    .map((n) => JSON.parse(fs.readFileSync(path.join(dir, n), "utf8")));
  const readers = indexReaders(root, { indexFile: run.indexCopy });
  const subject = functionalSubject({ root, ...readers });
  const { missed, unarrived, excluded } = observationRefusals({ observations, subject, tracked: readers.paths });
  if (!missed.length && !unarrived.length) {
    process.stdout.write(`certify: the observer saw ${observations.length} Node processes; every tracked file they read is in the ` +
      `functional subject (${subject.length} paths)${excluded.length ? `, or the record (${excluded.length}, excluded by rule)` : ""}.\n`);
    return null;
  }
  return `certify: the ${label} passed (${counts.pass}/${counts.tests}), but the run-time observer refuses it (design D3):\n` +
    missed.map((p) => `  ${p} — the half read this tracked file and the subject derivation missed it; spell its name in the test that reads it\n`).join("") +
    unarrived.map((e) => `  a Node child that never loaded the observer: ${e.test} ran ${JSON.stringify(e.argv)} — append to NODE_OPTIONS, never replace it\n`).join("") +
    "certify: nothing recorded.\n";
}

/** Resolves to the exit status. The run directory is removed before it resolves, and by the exit
 *  listener `removeAtExit()` registered if the process ends first. */
export async function main(argv, { root = REPO } = {}) {
  const bucket = argv[0];
  if (bucket !== "functional" && bucket !== "sweeps") {
    process.stderr.write(
      "certify: usage: node scripts/test/certify.mjs <functional|sweeps>\n" +
      "  functional — run scripts/test/functional/ over the index and record the functional subject's manifest on a pass\n" +
      "  sweeps     — run scripts/test/sweeps/ over the index and record the sweeps subject's manifest on a pass\n",
    );
    return 1;
  }
  const gitCommonDir = path.resolve(root, git(root, ["rev-parse", "--git-common-dir"]));
  const run = prepareRun(root, gitCommonDir);
  try {
    return await certifyBucket(root, gitCommonDir, run, bucket);
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

export { HERE };
