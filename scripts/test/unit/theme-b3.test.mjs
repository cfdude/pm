// scripts/test/unit/theme-b3.test.mjs
// Theme B batch B3 (pm 0.51.0), the VALUE rung. The file-shaped half is scripts/test/assert/theme-b3.test.mjs.
//
//   openspec-planning-completeness-instruction   the emitted rules state the OBLIGATION and name NO openspec command
//   spec-sync-waive-for-skip-specs               inSpecSyncScope() honours a recorded waiver (value over one record)

import assert from "node:assert/strict";
import { unitTest } from "../fixtures/unit-harness.mjs";

const RULES = new URL("../../lib/rules.mjs", import.meta.url).href;
const SPEC_SYNC = new URL("../../lib/spec-sync.mjs", import.meta.url).href;

unitTest("the rules block tells an agent to confirm an OpenSpec epic's planning is complete before it is ready to apply", async () => {
  const { rulesBlock } = await import(RULES);
  for (const platform of ["claude-code", "codex"]) {
    const block = rulesBlock(null, "standard", [], platform);
    assert.match(block, /An OpenSpec-lane epic owes one more check before it is treated as ready to apply/, platform);
    assert.match(block, /planning is COMPLETE — its proposal, design, specs and tasks all exist and agree with one\s+another/, platform);
    assert.match(block, /finish the planning first/, platform);
  }
});

unitTest("the planning-completeness obligation names NO OpenSpec command or json field (the coupling the page's Tier 3 #4 forbids)", async () => {
  const { rulesBlock } = await import(RULES);
  const block = rulesBlock(null, "standard");
  const start = block.indexOf("An OpenSpec-lane epic owes one more check");
  assert.notEqual(start, -1);
  const paragraph = block.slice(start, block.indexOf("<!-- END", start));
  assert.doesNotMatch(paragraph, /openspec (status|list|validate|show|instructions)|\bisPlanningComplete\b|\bapplyRequires\b|--json|\/opsx:/,
    "it states an obligation, not an invocation: how to check belongs to the installed OpenSpec");
  assert.match(paragraph, /pm names no OpenSpec\s+invocation for it/);
});

unitTest("inSpecSyncScope: a waiver can only REMOVE an epic from scope, never add one", async () => {
  const { inSpecSyncScope } = await import(SPEC_SYNC);
  const base = { id: "x", lane: "openspec", status: "archived", disposition: { outcome: "delivered", recordedAt: "2026-09-25T00:00:00.000Z" } };
  // archivedChangeDir() reads the disk, so a bare record is never in scope on this rung; the in-scope
  // half (and the waiver taking an in-scope epic out) is the file rung, in assert/theme-b3.test.mjs.
  for (const w of [undefined, "", "   ", 7, null, {}, "archived with --skip-specs"]) {
    assert.equal(inSpecSyncScope({ ...base, specDeltasWaived: w }), false, `waiver ${JSON.stringify(w)}`);
  }
  assert.equal(inSpecSyncScope(null), false);
});
