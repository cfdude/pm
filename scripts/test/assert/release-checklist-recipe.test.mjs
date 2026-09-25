// scripts/test/assert/release-checklist-recipe.test.mjs
// #219 — THE REAL NUMBERS RECIPE KEEPS ITS EVIDENCE, AND PUBLISHES NOTHING FROM A RUN THAT FAILED.
//
// `.claude/skills/release-checklist/SKILL.md` step 4 computes the "tests in the engine" row that
// pm-plugin.dev's Introduction publishes as mechanically derived. Until 0.50.0 it piped the run
// through `grep -m1 '^ℹ tests '`, so: a run WITH FAILURES still produced a number to publish; the
// STOP fired only on no output or `ℹ tests 0`; and the run's output was thrown away, which is why
// #219's `fail 1` could never be diagnosed — the one run that failed left nothing behind.
//
// This reads the recipe as TEXT (it spawns nothing and runs no git — the file rung). The recipe's
// decision block was also executed against synthetic clean / failed / cancelled logs when it was
// written; that transcript is kept beside the plan (docs/superpowers/plans/2026-09-25-commit-gate-
// evidence/recipe-decision-2.txt).

import "../fixtures/assert-git-shim.mjs";  // the run-time git counter, installed in THIS process (0.49.0, D3 row 1)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SKILL = path.join(REPO, ".claude", "skills", "release-checklist", "SKILL.md");

/** The Real Numbers part of step 4: from its bullet to the paragraph that follows the recipe. */
function recipe() {
  const text = fs.readFileSync(SKILL, "utf8");
  const start = text.indexOf("**Introduction's \"Real Numbers\" table**");
  const end = text.indexOf("If a metric can't be recomputed", start);
  assert.ok(start > 0 && end > start, "the Real Numbers recipe was not found in the release checklist");
  return text.slice(start, end);
}

test("#219 the Real Numbers run is SAVED WHOLE to a dated file in the git common dir, never piped to a count", () => {
  const r = recipe();
  assert.doesNotMatch(r, /\|\s*grep -m1 '\^ℹ tests '/,
    "the run is still piped straight into a count: its output is discarded, and a failing run still yields a number");
  assert.match(r,
    /^\s*log="\$\(git rev-parse --path-format=absolute --git-common-dir\)\/pm-real-numbers\/\$\(date -u \+%Y-%m-%dT%H%M%SZ\)\.txt"$/m,
    "the log must be an ABSOLUTE, UTC-dated file under the git common dir's pm-real-numbers/");
  const runner = r.split("\n").filter((l) => /FORCE_COLOR=0 node --test --test-reporter=spec/.test(l));
  assert.equal(runner.length, 1, "exactly one runner invocation");
  const block = r.slice(r.indexOf(runner[0]));
  const runnerCmd = block.slice(0, block.indexOf("\n", block.indexOf("sweeps/*.test.mjs")));
  for (const rung of ["unit", "assert", "functional", "sweeps"]) {
    assert.ok(runnerCmd.includes(`scripts/test/${rung}/*.test.mjs`), `the one invocation must include the ${rung} bucket`);
  }
  assert.match(runnerCmd, />"\$log" 2>&1$/, "the whole run — stdout AND stderr — must go to the log");
  assert.match(r, /^\s*code=\$\?$/m, "the runner's exit status must be kept, not lost to a pipe");
  assert.match(r, /^\s*echo "full run saved to: \$log \(runner exit \$code\)"$/m,
    "the recipe must NAME the saved file, so a failure is diagnosable after the fact");
});

test("#219 the recipe publishes NOTHING unless the runner exited 0, fail and cancelled are 0, and tests > 0", () => {
  const r = recipe();
  const gate = r.split("\n").find((l) => /^\s*if \[ "\$code" -eq 0 \]/.test(l));
  assert.ok(gate, "the recipe has no decision on the runner's exit status");
  for (const [clause, why] of [
    ['[ "${fail:-x}" = 0 ]', "a run with a failing test must never publish a count (and an unreadable fail line is not 0)"],
    ['[ "${cancelled:-x}" = 0 ]', "a cancelled test leaves `fail 0` while the run did not pass"],
    ['[ "${tests:-0}" -gt 0 ]', "a run of zero tests is not a count"],
  ]) {
    assert.ok(gate.includes(clause), `the decision is missing ${clause}: ${why}`);
  }
  assert.match(r, /^\s*echo "PUBLISH: tests \$tests"$/m, "a clean run must print the one number to publish");
  assert.match(r, /^\s*echo "STOP -- publish nothing: /m, "any other run must say STOP and publish nothing");
  assert.match(r, /A failed run is recorded BEFORE it is re-run/,
    "the recipe must forbid re-running until green and publishing the green run as if the failure never happened");
});
