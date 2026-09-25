// scripts/test/assert/ci-workflow.test.mjs
// G-C1 (Gate 2) — THE CI WORKFLOW'S BUCKET STEPS MUST BE ABLE TO GO RED.
//
// WHAT WAS WRONG. Each of the three bucket steps ran its suite as
//   total=$(node --test … 2>&1 | tee /tmp/x.out | grep -m1 … | awk '{print $3}')
// so the step's status was `awk`'s, never the runner's. A suite that FAILED still printed its
// summary, still satisfied the floor (the floor only compares two counts), and the step exited 0 —
// proven with one deliberately failing file: `ran 1238, declared 1237`, `STEP EXIT=0`. CI is the
// ONLY place the functional half and the sweep bucket run (6.5), so this made the backstop that
// catches a hand-written certification record unable to fail. `set -e` does not help: it reads the
// status of the PIPELINE, and the pipeline's status is its last command's.
//
// WHY A TEST AND NOT JUST A COMMENT. The shape is invisible in review — every line is a line
// someone would write on purpose — and it was already written three times. This guard reads the
// workflow and refuses the shape, and `bucketRefusals()` is exercised directly against the OLD
// text below so the check has been SEEN to fire rather than assumed able to.
//
// IT READS A FILE AND SPAWNS NOTHING, so it belongs on the per-commit path (design D5). It has no
// functional twin, and does not need one: the twin rule runs in ONE direction (D6), and the
// subject here is the workflow's text, not git's behaviour.

import "../fixtures/assert-git-shim.mjs";  // the run-time git counter, installed in THIS process (0.49.0, D3 row 1)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NODE_FLOOR_MAJOR } from "../../lib/runtime-support.mjs";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WORKFLOW = path.join(REPO, ".github", "workflows", "ci.yml");

/** The three bucket steps, by the bucket directory each one runs. */
export const BUCKETS = ["assert", "functional", "sweeps"];

/** The RUNGS each step's runner is handed — a SET now rather than one directory (0.48.0 task 2.6).
 *  The assertion half carries two rungs, so its step runs `scripts/test/unit/*.test.mjs` and
 *  `scripts/test/assert/*.test.mjs` in ONE invocation with ONE floor over both, exactly as the
 *  pre-commit hook does. The other two steps are unchanged and each names its own directory alone.
 *
 *  THE INVARIANT IS UNCHANGED and it is what the guard below still asserts: the floor compares the
 *  runner's count against exactly the set the runner was GIVEN. A step that enumerated the
 *  functional half as well would still be refused — it is a superset of what its runner was handed,
 *  which is the shape D8 forbids. */
export const RUNGS_OF = { assert: ["assert", "unit"], functional: ["functional"], sweeps: ["sweeps"] };

/** Split a workflow into its steps, keeping `name`, raw text and order. A step starts at its
 *  `- name:` line and ends where the next one begins; indentation is preserved because the YAML
 *  run block's own indentation is not the point here — the text is. */
export function workflowSteps(src) {
  const re = /^(\s*)- name:\s*(.+)$/gm;
  const hits = [...src.matchAll(re)];
  return hits.map((m, i) => ({
    name: m[2].trim(),
    text: src.slice(m.index, i + 1 < hits.length ? hits[i + 1].index : src.length),
  }));
}

/** The `node --test` invocation a step hands its runner, as the literal text and its line.
 *  RE-POINTED IN 0.49.0 (task 4.2): flags may sit between `--test` and the globs
 *  (`--test-reporter=spec`), so they are allowed there rather than making the runner invisible. */
function runnerLine(step) {
  return step.text.split("\n").find((l) => RUNNER.test(l)) ?? null;
}
const RUNNER = /node --test(?:\s+--[\w-]+(?:=\S+)?)*\s+scripts\/test\/[\w-]+\/\*\.test\.mjs/;

/** `total=$(… node --test …` — the PIPELINE shape G-C1 refuses — with any `NAME=value` assignments
 *  before `node --test` (0.49.0, Gate 1 I5): without them, `total=$(FORCE_COLOR=0 node --test … | …)`
 *  slipped past the very guard written for it. */
const PIPELINE = /total\s*=\s*\$\(\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*node --test/;

/** Every reason a bucket step cannot go red on a failing suite, or on the collapse the floor exists
 *  for. Empty means the step is sound. PURE — so the old shape can be fed to it by a test. */
export function bucketRefusals(stepName, stepText, bucket, rungs = [bucket]) {
  const found = [];
  const step = { name: stepName, text: stepText };
  const line = runnerLine(step);
  const want = new Set(rungs);

  if (!line) {
    return [`${stepName}: no 'node --test scripts/test/${bucket}/*.test.mjs' invocation — the step ` +
      `does not run the bucket it is named for, and this guard is then checking nothing`];
  }
  // THE RUNNER IS HANDED EXACTLY THE EXPECTED RUNGS — no more and no fewer. Added with the two-rung
  // assertion step (task 2.6): the `declared` check below would accept a runner given the unit rung
  // whose floor also counted it, so the two checks together are what pin the invariant from both
  // ends. A runner handed a bucket its floor does not name (or the reverse) is the mismatch.
  const handed = new Set([...line.matchAll(/scripts\/test\/([\w-]+)\/\*\.test\.mjs/g)].map((m) => m[1]));
  if (handed.size !== want.size || [...handed].some((h) => !want.has(h))) {
    found.push(`${stepName}: the runner is handed ${[...handed].sort().join(", ") || "nothing"} ` +
      `instead of ${[...want].sort().join(", ")} — the step must run exactly the rungs it is named for`);
  }

  // 1. The runner's status must be GATED ON, not piped away. `total=$(node --test … | …)` is the
  //    exact shape that shipped; `|| {` / `|| exit` / `set -o pipefail` are the shapes that gate.
  if (PIPELINE.test(stepText)) {
    found.push(`${stepName}: the count is parsed from a PIPELINE over the runner — the step's ` +
      `status is the last pipe's (awk's), so a failing suite exits 0`);
  }
  const gated = /\|\|\s*\{/.test(stepText) || /\|\|\s*exit/.test(stepText) || /set -o pipefail/.test(stepText);
  if (!gated) {
    found.push(`${stepName}: nothing gates on the runner's own status — a failing suite cannot fail ` +
      `the step (neither a '|| { … exit 1; }' gate nor 'set -o pipefail' is present)`);
  }
  // The gate must precede the first count read: a gate that runs after the count has been parsed
  // from a pipeline is no gate at all.
  if (gated && PIPELINE.test(stepText.split(/\|\|\s*\{/)[0] ?? "")) {
    found.push(`${stepName}: the runner's status gate comes after the count was parsed`);
  }

  // 2. The floor's `declared` must be enumerated from THIS bucket's own tracked files — the same
  //    set the runner was handed, never a superset (the invariant design D8 states).
  const declared = stepText.split("\n").find((l) => /^declared=/.test(l.trim()));
  if (!declared) {
    found.push(`${stepName}: the step carries no 'declared=' line, so the floor's invariant is unstated`);
  } else {
    // EVERY `scripts/test/<half>/*.test.mjs` the line enumerates — the floor must name exactly the
    // set the runner was handed. Naming a second half is the superset D8 forbids: on the per-commit
    // hook it aborts every commit that has a functional half at all.
    const named = new Set([...declared.matchAll(/scripts\/test\/([\w-]+)\/\*\.test\.mjs/g)].map((m) => m[1]));
    if (!declared.includes("git ls-files")) {
      found.push(`${stepName}: 'declared' is not enumerated from the index (git ls-files) — a glob ` +
        `that stopped matching would shrink both sides at once and leave the floor blind`);
    }
    if (named.size !== want.size || [...named].some((n) => !want.has(n))) {
      found.push(`${stepName}: 'declared' enumerates ${[...named].sort().join(", ") || "nothing"} ` +
        `instead of ${[...want].map((r) => `scripts/test/${r}/`).join(" + ")} — the floor must compare ` +
        `the runner's count against exactly the set the runner was GIVEN, never a superset of it`);
    }
  }
  return found;
}

test("G-C1 CI: every bucket step can go red on a failing suite", () => {
  const src = fs.readFileSync(WORKFLOW, "utf8");
  const steps = workflowSteps(src);
  const found = [];
  let seen = 0;
  for (const bucket of BUCKETS) {
    const step = steps.find((s) => s.text.includes(`scripts/test/${bucket}/*.test.mjs`));
    if (!step) { found.push(`no CI step runs scripts/test/${bucket}/*.test.mjs`); continue; }
    seen++;
    found.push(...bucketRefusals(step.name, step.text, bucket, RUNGS_OF[bucket]));
  }
  assert.equal(seen, BUCKETS.length,
    "the workflow must hold one step per bucket; a bucket with no step is a bucket CI never runs");
  assert.deepEqual(found, [],
    "a bucket step whose status is not the runner's can report green on a failing suite, and CI is " +
    "the only place the functional half and the sweep bucket run at all (6.5)");
});

test("G-C1 CI: the guard DISCRIMINATES — the shape that shipped is refused, for the stated reason", () => {
  // The OLD step, copied from the shape this change replaced (the three live steps were identical
  // but for the bucket name). It must be refused, and refused for the pipeline reason — a guard
  // that only ever sees a healthy workflow is a guard nobody has watched work.
  const old = [
    "        run: |",
    "          set -e",
    "          total=$(node --test scripts/test/assert/*.test.mjs 2>&1 | tee /tmp/assert.out " +
      "| grep -m1 -E '^(ℹ|#) tests ' | awk '{print $3}')",
    "          declared=$(git ls-files 'scripts/test/assert/*.test.mjs' | xargs grep -c '^test(' " +
      "| awk -F: '{s+=$NF} END {print s+0}')",
    "          echo \"assertion half: ran ${total}, declared ${declared}\"",
  ].join("\n");
  const reasons = bucketRefusals("Assertion half", old, "assert").join(" | ");
  assert.match(reasons, /PIPELINE over the runner/,
    `the shipped shape must be refused as a pipeline over the runner; got: ${reasons}`);
  assert.match(reasons, /nothing gates on the runner's own status/,
    `the shipped shape carries no status gate either; got: ${reasons}`);

  // And it must NOT fire on a step that gates correctly — otherwise the guard would be weakened the
  // first day, which is how the property it protects gets lost.
  // RE-POINTED IN 0.49.0 (task 4.2) to the shape the workflow now uses: one forced reporter, no
  // colour, the `ℹ` parse only, and a zero-count refusal of its own.
  const fixed = [
    "        run: |",
    "          set -e",
    "          FORCE_COLOR=0 node --test --test-reporter=spec scripts/test/assert/*.test.mjs > /tmp/assert.out 2>&1 || {",
    "            cat /tmp/assert.out",
    "            exit 1",
    "          }",
    "          total=$(grep -m1 -E '^ℹ tests ' /tmp/assert.out | awk '{print $3}')",
    "          declared=$(git ls-files 'scripts/test/assert/*.test.mjs' | xargs grep -c '^test(' " +
      "| awk -F: '{s+=$NF} END {print s+0}')",
    "          if [ -z \"$total\" ]; then echo \"::error::unreadable\"; exit 1; fi",
    "          if [ \"$total\" -lt \"$declared\" ]; then echo \"::error::short\"; exit 1; fi",
    "          if [ \"$total\" -eq 0 ]; then",
    "            echo \"::error::the assertion half ran zero tests\"; exit 1",
    "          fi",
  ].join("\n");
  assert.deepEqual(bucketRefusals("Assertion half", fixed, "assert"), []);
  assert.deepEqual(reporterRefusals("Assertion half", fixed), []);

  // THE SHIPPED PIPELINE, WITH AN ENV PREFIX, IS STILL THE SHIPPED PIPELINE (0.49.0, Gate 1 I5).
  const prefixed = old.replace("total=$(node --test", "total=$(FORCE_COLOR=0 node --test --test-reporter=spec");
  assert.match(bucketRefusals("Assertion half", prefixed, "assert").join(" | "), /PIPELINE over the runner/,
    "`total=$(FORCE_COLOR=0 node --test … | …)` must be refused exactly as the unprefixed shape is");

  // A step whose `declared` enumerates a SUPERSET (both halves) is refused too: that is the shape
  // design D8 forbids, and on the hook it aborts every commit that has a functional half at all.
  const superset = fixed.replace(
    "declared=$(git ls-files 'scripts/test/assert/*.test.mjs'",
    "declared=$(git ls-files 'scripts/test/assert/*.test.mjs' 'scripts/test/functional/*.test.mjs'");
  assert.match(bucketRefusals("Assertion half", superset, "assert", RUNGS_OF.assert).join(" | "),
    /enumerates assert, functional instead of scripts\/test\/assert\/ \+ scripts\/test\/unit\//,
    "a superset enumeration must be refused: the floor must never compare against more than the runner was given");

  // AND A RUNNER HANDED A RUNG ITS FLOOR DOES NOT NAME is refused too (task 2.6): the two ends of
  // the invariant are checked separately because a step can be wrong in either direction.
  const mismatched = fixed.replace(
    "          FORCE_COLOR=0 node --test --test-reporter=spec scripts/test/assert/*.test.mjs > /tmp/assert.out 2>&1 || {",
    "          FORCE_COLOR=0 node --test --test-reporter=spec scripts/test/assert/*.test.mjs scripts/test/functional/*.test.mjs > /tmp/assert.out 2>&1 || {");
  assert.match(bucketRefusals("Assertion half", mismatched, "assert", RUNGS_OF.assert).join(" | "),
    /the runner is handed assert, functional instead of assert, unit —/,
    "a runner given a rung the step is not named for must be refused — here the FUNCTIONAL half, " +
    "which is the per-commit-cost shape the spec's 'does not run the functional half' forbids");
});

// ─────────────── 0.49.0 tasks 4.2 / 4.3 — THE MATRIX, THE AGGREGATE, ONE REPORTER, CURRENT ACTIONS ───────────────
//
// Pure functions over `ci.yml`'s TEXT (no YAML parser: the engine and its tests carry no dependency),
// each exercised by a test below and each seen to fail on its mutation (mutation-4.3.txt). What they
// hold (runtime-support's second requirement, design D2/D4/D7):
//   (a) a job named `test` with `if: always()`, needing the compute job and the matrix job;
//   (b) its step fails unless BOTH `needs.*.result` equal `success`;
//   (c) the matrix job: `fail-fast: false`, `timeout-minutes`, `matrix.node` from the compute job's output;
//   (d) the compute step fetches the PINNED schedule URL with curl, and runs node-majors.mjs with the
//       fetched file (or the fetch's failure), `date -u +%F` and `$PM_NODE_FALLBACK`;
//   (e) the minimum of `PM_NODE_FALLBACK` equals NODE_FLOOR_MAJOR;
//   (f) every bucket step forces `--test-reporter=spec` and `FORCE_COLOR=0`, and parses `ℹ`, never `#`;
//   (f2) every bucket step refuses a ZERO count on its own;
//   (g) `actions/checkout@v7`, `actions/setup-node@v7`, and no `node-version: "18"`.

/** The pinned schedule URL. A throwaway branch that points CI at a 404 edits THIS and the workflow in
 *  the same commit (task 4.5, design D2 option (b)); on `main` the two must agree. */
export const SCHEDULE_URL = "https://raw.githubusercontent.com/nodejs/Release/main/schedule-404-ci-verify-049.json";
export const COMPUTE_JOB = "node-majors";
export const MATRIX_JOB = "test-node";
export const AGGREGATE_JOB = "test";

/** The workflow's jobs by id: the text from each `  <id>:` line under `jobs:` to the next. */
export function workflowJobs(src) {
  const jobsAt = src.search(/^jobs:\s*$/m);
  if (jobsAt < 0) return {};
  const body = src.slice(jobsAt);
  const hits = [...body.matchAll(/^ {2}([\w-]+):\s*$/gm)];
  return Object.fromEntries(hits.map((m, i) =>
    [m[1], body.slice(m.index, i + 1 < hits.length ? hits[i + 1].index : body.length)]));
}

/** (a) + (b): the required check is one aggregate that cannot pass on a leg that did not run. */
export function aggregateRefusals(src) {
  const job = workflowJobs(src)[AGGREGATE_JOB];
  if (!job) return [`no job '${AGGREGATE_JOB}' — branch protection requires that context and nothing reports it`];
  const found = [];
  if (!/^ {4}name:\s*test\s*$/m.test(job)) found.push(`job '${AGGREGATE_JOB}' does not report under the name 'test'`);
  if (!/^ {4}if:\s*always\(\)\s*$/m.test(job)) {
    found.push(`job '${AGGREGATE_JOB}' has no 'if: always()' — a failed dependency SKIPS it, and a skipped required check passes`);
  }
  const needs = /^ {4}needs:\s*\[([^\]]*)\]/m.exec(job);
  const named = needs ? needs[1].split(",").map((n) => n.trim()) : [];
  for (const dep of [COMPUTE_JOB, MATRIX_JOB]) {
    if (!named.includes(dep)) found.push(`job '${AGGREGATE_JOB}' does not need '${dep}'`);
  }
  for (const dep of [COMPUTE_JOB, MATRIX_JOB]) {
    const checked = new RegExp(`"\\$\\{\\{ needs\\.${dep}\\.result \\}\\}" != "success"`).test(job);
    if (!checked) found.push(`job '${AGGREGATE_JOB}' does not fail unless needs.${dep}.result is 'success'`);
  }
  if (!/exit 1/.test(job)) found.push(`job '${AGGREGATE_JOB}' never exits 1, so it cannot fail`);
  return found;
}

/** (c): every major runs to completion, bounded, from the computed set. */
export function matrixRefusals(src) {
  const job = workflowJobs(src)[MATRIX_JOB];
  if (!job) return [`no job '${MATRIX_JOB}' — nothing runs the suite per major`];
  const found = [];
  if (!/^ {6}fail-fast:\s*false\s*$/m.test(job)) found.push(`job '${MATRIX_JOB}' does not set 'fail-fast: false' — one failing major would cancel the rest`);
  if (!/^ {4}timeout-minutes:\s*\d+\s*$/m.test(job)) found.push(`job '${MATRIX_JOB}' has no 'timeout-minutes' — a hung synchronous spawn would run until GitHub's own limit`);
  if (!new RegExp(`^ {8}node:\\s*\\$\\{\\{ fromJSON\\(needs\\.${COMPUTE_JOB}\\.outputs\\.majors\\) \\}\\}\\s*$`, "m").test(job)) {
    found.push(`job '${MATRIX_JOB}' does not take matrix.node from needs.${COMPUTE_JOB}.outputs.majors — a typed list is not a computed one`);
  }
  if (!new RegExp(`^ {4}needs:\\s*${COMPUTE_JOB}\\s*$`, "m").test(job)) found.push(`job '${MATRIX_JOB}' does not need '${COMPUTE_JOB}'`);
  return found;
}

/** (d): the set is computed from the pinned schedule by the committed script, never typed and never
 *  computed without the committed list (a step that ignored $PM_NODE_FALLBACK could not fall back
 *  and could not be checked for agreement — Gate 1 B5). */
export function computeRefusals(src, url = SCHEDULE_URL) {
  const job = workflowJobs(src)[COMPUTE_JOB];
  if (!job) return [`no job '${COMPUTE_JOB}' — nothing computes the supported majors`];
  const found = [];
  const curl = job.split("\n").find((l) => /\bcurl\b/.test(l));
  if (!curl) found.push(`job '${COMPUTE_JOB}' does not fetch the schedule with curl`);
  else {
    if (!curl.includes(url)) found.push(`job '${COMPUTE_JOB}' does not fetch the pinned schedule URL ${url}: ${curl.trim()}`);
    if (!/\s-\w*f\w*\s/.test(curl + " ")) found.push(`job '${COMPUTE_JOB}''s curl lacks -f, so an HTTP error would read as a fetched body`);
  }
  const runs = job.split("\n").filter((l) => /node scripts\/test\/node-majors\.mjs/.test(l));
  if (!runs.length) found.push(`job '${COMPUTE_JOB}' does not run scripts/test/node-majors.mjs`);
  if (!runs.some((l) => /--schedule\s/.test(l))) found.push(`job '${COMPUTE_JOB}' never hands node-majors.mjs the fetched schedule`);
  if (!runs.some((l) => /--fetch-failed/.test(l))) found.push(`job '${COMPUTE_JOB}' never tells node-majors.mjs the fetch failed`);
  for (const l of runs) {
    if (!/--today "\$\(date -u \+%F\)"/.test(l)) found.push(`a node-majors.mjs run does not pass today's UTC date: ${l.trim()}`);
    if (!/--fallback "\$PM_NODE_FALLBACK"/.test(l)) found.push(`a node-majors.mjs run does not pass $PM_NODE_FALLBACK: ${l.trim()}`);
  }
  return found;
}

/** The committed fallback list, from the workflow-level env. */
export function fallbackOf(src) {
  const m = /^ {2}PM_NODE_FALLBACK:\s*"(\[[^"]*\])"\s*$/m.exec(src);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

/** (e): the fallback's minimum IS the engine's support floor. */
export function floorRefusals(src, floor = NODE_FLOOR_MAJOR) {
  const list = fallbackOf(src);
  if (!Array.isArray(list) || !list.length) return ["the workflow carries no readable PM_NODE_FALLBACK list"];
  const min = Math.min(...list);
  return min === floor ? [] : [
    `the minimum of CI's committed fallback PM_NODE_FALLBACK is ${min}, but the engine's support floor ` +
    `NODE_FLOOR_MAJOR is ${floor} — move them together`,
  ];
}

/** (f) + (f2): one reporter, no colour, the `ℹ` parse only, and a zero count refused on its own. */
export function reporterRefusals(stepName, stepText) {
  const found = [];
  const line = runnerLine({ text: stepText });
  if (!line) return [`${stepName}: no runner line`];
  if (!/--test-reporter=spec\b/.test(line)) found.push(`${stepName}: the runner does not force --test-reporter=spec`);
  if (!/(?:^|\s)FORCE_COLOR=0\s/.test(line)) found.push(`${stepName}: the runner does not set FORCE_COLOR=0`);
  const parses = stepText.split("\n").filter((l) => /^\s*total=\$\(grep/.test(l));
  if (!parses.length) found.push(`${stepName}: no count parse`);
  for (const l of parses) {
    if (!/\^ℹ tests /.test(l)) found.push(`${stepName}: the count parse does not read '^ℹ tests': ${l.trim()}`);
    if (/#/.test(l)) found.push(`${stepName}: the count parse still reads the TAP '#' format: ${l.trim()}`);
  }
  const zero = /if \[ "\$total" -eq 0 \]; then\s*\n\s*echo "::error::[^\n]*"; exit 1/.test(stepText);
  if (!zero) found.push(`${stepName}: no refusal of a ZERO count on its own — '[ "$total" -lt "$declared" ]' is green at 0/0`);
  return found;
}

/** (g): current actions, and the old pin gone. */
export function actionRefusals(src) {
  const found = [];
  for (const m of src.matchAll(/uses:\s*actions\/(checkout|setup-node)@(\S+)/g)) {
    if (m[2] !== "v7") found.push(`actions/${m[1]}@${m[2]} — expected @v7`);
  }
  if (!/uses:\s*actions\/checkout@/.test(src)) found.push("no actions/checkout step");
  if (!/uses:\s*actions\/setup-node@/.test(src)) found.push("no actions/setup-node step");
  if (/node-version:\s*"?18"?\s*$/m.test(src)) found.push('the workflow still pins node-version: "18"');
  return found;
}

test("4.2 (a)(b) the required check is one aggregate named test that cannot pass on a leg that did not run", () => {
  assert.deepEqual(aggregateRefusals(fs.readFileSync(WORKFLOW, "utf8")), []);
});

test("4.2 (c) the matrix job runs every computed major to completion, bounded", () => {
  assert.deepEqual(matrixRefusals(fs.readFileSync(WORKFLOW, "utf8")), []);
});

test("4.2 (d) the set is computed from the pinned schedule by node-majors.mjs, with today and the fallback", () => {
  assert.deepEqual(computeRefusals(fs.readFileSync(WORKFLOW, "utf8")), []);
});

test("4.2 (e) the minimum of CI's committed fallback equals the engine's support floor", () => {
  assert.deepEqual(floorRefusals(fs.readFileSync(WORKFLOW, "utf8")), []);
  // …and a mismatch names BOTH values.
  const off = fs.readFileSync(WORKFLOW, "utf8").replace(/PM_NODE_FALLBACK: "\[[^"]*\]"/, 'PM_NODE_FALLBACK: "[20,22,24,26]"');
  assert.match(floorRefusals(off).join(" | "), new RegExp(`is 20, but the engine's support floor NODE_FLOOR_MAJOR is ${NODE_FLOOR_MAJOR}`));
});

test("4.2 (f)(f2) every bucket step forces one reporter, parses ℹ only, and refuses a zero count", () => {
  const src = fs.readFileSync(WORKFLOW, "utf8");
  const steps = workflowSteps(src);
  const found = [];
  for (const bucket of BUCKETS) {
    const step = steps.find((s) => s.text.includes(`scripts/test/${bucket}/*.test.mjs`));
    if (!step) { found.push(`no CI step runs scripts/test/${bucket}/*.test.mjs`); continue; }
    found.push(...reporterRefusals(step.name, step.text));
  }
  assert.deepEqual(found, []);
});

test("4.2 (g) actions/checkout@v7 and actions/setup-node@v7, and no Node 18 pin", () => {
  assert.deepEqual(actionRefusals(fs.readFileSync(WORKFLOW, "utf8")), []);
});
