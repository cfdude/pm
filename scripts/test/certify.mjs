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

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONFORMANCE_ID, ENGINE_SOURCE, REPO, certifiedModules, functionalIds, moduleEntry, triggerEntry,
  writeEntry,
} from "./certification.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
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

/** One bucket run. Returns `{ ok, counts, output }`; `counts` is read from the runner's own summary
 *  line (both reporters: newer Node uses the `spec` reporter's `ℹ`, the CI runner's Node 18 the
 *  `tap` reporter's `#`). */
function runBucket(root, bucket) {
  const files = bucketFiles(root, bucket);
  const r = spawnSync(process.execPath, ["--test", ...files], { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const output = `${r.stdout || ""}${r.stderr || ""}`;
  const pick = (label) => {
    const m = new RegExp(`^(?:ℹ|#) ${label} (\\d+)$`, "m").exec(output);
    return m ? Number(m[1]) : null;
  };
  return {
    ok: r.status === 0,
    status: r.status,
    counts: { tests: pick("tests"), pass: pick("pass"), fail: pick("fail") },
    output,
  };
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

function certifyFunctional(root, gitCommonDir) {
  const run = runBucket(root, "functional");
  if (!run.ok) {
    process.stderr.write(run.output);
    process.stderr.write(`\ncertify: the functional half FAILED (status ${run.status}). Nothing recorded — a record is a claim about a pass.\n`);
    return 1;
  }
  const { ranAt, engineSha } = provenance(root);
  const functional = functionalIds(root);
  const mods = certifiedModules(root);
  for (const id of mods) {
    writeEntry(gitCommonDir, id, moduleEntry(id, { root, functional, counts: run.counts, ranAt, engineSha }));
  }
  process.stdout.write(
    `certify: functional half passed (${run.counts.pass}/${run.counts.tests}); recorded ${mods.length} module ` +
    `entries in ${path.join(gitCommonDir, "pm-suite-certification.json")}\n`,
  );
  return 0;
}

function certifySweeps(root, gitCommonDir) {
  const run = runBucket(root, ENGINE_SOURCE);
  if (!run.ok) {
    process.stderr.write(run.output);
    process.stderr.write(`\ncertify: the sweeps bucket FAILED (status ${run.status}). Nothing recorded.\n`);
    return 1;
  }
  const { ranAt, engineSha } = provenance(root);
  const entry = triggerEntry({ root, counts: run.counts, ranAt, engineSha });
  writeEntry(gitCommonDir, ENGINE_SOURCE, entry);
  process.stdout.write(
    `certify: sweeps bucket passed (${run.counts.pass}/${run.counts.tests}); recorded the '${ENGINE_SOURCE}' ` +
    `entry over ${entry.files.length} engine-source files\n`,
  );
  return 0;
}

export function main(argv, { root = REPO } = {}) {
  const bucket = argv[0];
  if (bucket !== "functional" && bucket !== "sweeps") {
    process.stderr.write(
      "certify: usage: node scripts/test/certify.mjs <functional|sweeps>\n" +
      "  functional — run scripts/test/functional/ and record every certified module on a pass\n" +
      "  sweeps     — run scripts/test/sweeps/ and record the engine-source trigger on a pass\n",
    );
    return 1;
  }
  const gitCommonDir = path.resolve(root, git(root, ["rev-parse", "--git-common-dir"]));
  return bucket === "sweeps" ? certifySweeps(root, gitCommonDir) : certifyFunctional(root, gitCommonDir);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exit(main(process.argv.slice(2)));

export { CONFORMANCE_ID, HERE };
