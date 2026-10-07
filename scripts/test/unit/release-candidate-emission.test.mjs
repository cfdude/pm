// scripts/test/unit/release-candidate-emission.test.mjs
// converged-release-candidate-review 2.1 — the rules block's "Release candidate" section.
// UNIT RUNG: rulesBlock is pure over its arguments. CLAUDE.md on disk and the pinned fixture are in
// assert/release-candidate-emission.test.mjs.

import assert from "node:assert/strict";
import { unitTest } from "../fixtures/unit-harness.mjs";

const RULES = new URL("../../lib/rules.mjs", import.meta.url).href;

unitTest("The rules block points to the procedure: it names the skill, the budget rule and the one-round cap", async () => {
  const { rulesBlock } = await import(RULES);
  const block = rulesBlock(null, "standard");
  assert.match(block, /## Release candidate/);
  assert.match(block, /`release-candidate` skill carries the procedure/);
  assert.match(block, /The budget is the highest review among the candidate members/);
  assert.match(block, /one `thorough` member makes the whole candidate `thorough`|`thorough` member makes the whole candidate `thorough`/);
  assert.match(block, /One round; only a Critical reopens it/);
  assert.match(block, /Important finding is fixed and re-tested, not\s+re-reviewed/);
});

unitTest("the section states the same-range recording rule, attribution before the verdict, and staleness", async () => {
  const { rulesBlock } = await import(RULES);
  const block = rulesBlock(null, "standard");
  assert.match(block, /record-gate-review/);
  assert.match(block, /Gate 2 for EACH candidate member at the SAME base and head, after\s+the last fix has merged/);
  assert.match(block, /attribute each fix commit to the member whose code it fixes, then record/);
  assert.match(block, /A verdict recorded before a fix is stale/);
  assert.match(block, /`release show` reads whether the\s+members converged/);
});

unitTest("the section appears exactly once, and does not depend on the tracker or the platform", async () => {
  const { rulesBlock } = await import(RULES);
  for (const args of [[null, "off"], [{ system: "jira", projectKey: "JOB", direction: "outward" }, "thorough"]]) {
    const block = rulesBlock(...args);
    assert.equal(block.split("## Release candidate").length - 1, 1);
  }
  const { rulesBlock: rb } = await import(RULES);
  assert.equal(rb(null, "standard", [], "codex").split("## Release candidate").length - 1, 1);
});
