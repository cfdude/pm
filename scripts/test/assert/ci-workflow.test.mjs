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

/** The `node --test` invocation a step hands its runner, as the literal text and its line. */
function runnerLine(step) {
  return step.text.split("\n").find((l) => /node --test\s+scripts\/test\/[\w-]+\/\*\.test\.mjs/.test(l)) ?? null;
}

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
  if (/total\s*=\s*\$\(\s*node --test/.test(stepText)) {
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
  if (gated && /total\s*=\s*\$\(\s*node --test/.test(stepText.split(/\|\|\s*\{/)[0] ?? "")) {
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
  const fixed = [
    "        run: |",
    "          set -e",
    "          node --test scripts/test/assert/*.test.mjs > /tmp/assert.out 2>&1 || {",
    "            cat /tmp/assert.out",
    "            exit 1",
    "          }",
    "          total=$(grep -m1 -E '^(ℹ|#) tests ' /tmp/assert.out | awk '{print $3}')",
    "          declared=$(git ls-files 'scripts/test/assert/*.test.mjs' | xargs grep -c '^test(' " +
      "| awk -F: '{s+=$NF} END {print s+0}')",
  ].join("\n");
  assert.deepEqual(bucketRefusals("Assertion half", fixed, "assert"), []);

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
    "          node --test scripts/test/assert/*.test.mjs > /tmp/assert.out 2>&1 || {",
    "          node --test scripts/test/assert/*.test.mjs scripts/test/functional/*.test.mjs > /tmp/assert.out 2>&1 || {");
  assert.match(bucketRefusals("Assertion half", mismatched, "assert", RUNGS_OF.assert).join(" | "),
    /the runner is handed assert, functional instead of assert, unit —/,
    "a runner given a rung the step is not named for must be refused — here the FUNCTIONAL half, " +
    "which is the per-commit-cost shape the spec's 'does not run the functional half' forbids");
});
