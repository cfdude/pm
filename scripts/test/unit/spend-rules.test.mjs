// scripts/test/unit/spend-rules.test.mjs
// token-spend-tracking-per-epic, group 5 (5.1) — the rules-block section that makes agents write the
// dispatch marker. UNIT rung: `rulesBlock()` is a pure function of its arguments.

import assert from "node:assert/strict";
import { unitTest } from "../fixtures/unit-harness.mjs";
import { KNOWN_JOB_ROLES, KNOWN_PLATFORMS, KNOWN_SPEND_PHASES } from "../../lib/constants.mjs";
import { rulesBlock } from "../../lib/rules.mjs";

const on = () => rulesBlock(null, "standard", [], "claude-code", null, true);
const off = () => rulesBlock(null, "standard", [], "claude-code", null, false);

unitTest("5.1 On emits the section: the heading, the marker format, and the role and phase lists", () => {
  const block = on();
  assert.match(block, /^## Spend tracking$/m);
  assert.ok(block.includes("`pm-spend: epic=<id> role=<role> phase=<phase> [round=<n>]`"), "the marker format");
  for (const role of KNOWN_JOB_ROLES) assert.ok(block.includes(`\`${role}\``), `role ${role} is rendered from KNOWN_JOB_ROLES`);
  for (const phase of KNOWN_SPEND_PHASES) assert.ok(block.includes(`\`${phase}\``), `phase ${phase} is rendered from KNOWN_SPEND_PHASES`);
  assert.match(block, /A dispatch without the marker is counted as unattributed\./);
});

unitTest("5.1 Off emits nothing: no section and no marker text, and a caller that omits the argument gets the off rendering", () => {
  const block = off();
  assert.doesNotMatch(block, /## Spend tracking/);
  assert.doesNotMatch(block, /pm-spend:/);
  assert.equal(rulesBlock(null, "standard", [], "claude-code"), block, "the default is OFF: a user who never opts in pays zero bytes");
  assert.equal(rulesBlock(null, "standard", [], "claude-code", null, undefined), block);
});

unitTest("5.1 the section sits after Execution profile and before Release candidate, once", () => {
  const block = on();
  const at = block.indexOf("## Spend tracking");
  assert.ok(block.indexOf("## Execution profile") < at && at < block.indexOf("## Release candidate"));
  assert.equal(block.split("## Spend tracking").length - 1, 1);
});

unitTest("5.1 turning the section on adds only the section: the rest of the block is byte-identical", () => {
  const withSection = on();
  const start = withSection.indexOf("## Spend tracking");
  const end = withSection.indexOf("## Release candidate");
  assert.equal(withSection.slice(0, start) + withSection.slice(end), off());
});

unitTest("5.1 the marker line is an instruction on its own line the dispatch can copy", () => {
  const block = on();
  const line = block.split("\n").find((l) => l.startsWith("`pm-spend:"));
  assert.ok(line && line.endsWith("`"), "a code span on a line of its own");
});

unitTest("5.1 every platform's block carries the section when on, and none when off", () => {
  for (const platform of KNOWN_PLATFORMS) {
    assert.match(rulesBlock(null, "standard", [], platform, null, true), /## Spend tracking/, platform);
    assert.doesNotMatch(rulesBlock(null, "standard", [], platform, null, false), /## Spend tracking/, platform);
  }
});
