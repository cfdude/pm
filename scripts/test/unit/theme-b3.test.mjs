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
    assert.match(block, /planning is COMPLETE — every artifact your OpenSpec schema requires exists and they agree with one\s+another/, platform);
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

unitTest("inSpecSyncScope: a waiver REMOVES an in-scope epic and can never ADD one (in-memory directory resolver, no disk)", async () => {
  const { inSpecSyncScope } = await import(SPEC_SYNC);
  const base = { id: "x", lane: "openspec", status: "archived", disposition: { outcome: "delivered", recordedAt: "2026-09-25T00:00:00.000Z" } };
  const found = () => "2026-09-20-x";
  const none = () => null;
  assert.equal(inSpecSyncScope(base, found), true, "precondition: a delivered openspec-lane epic with an archive directory is in scope");
  // The waiver removes it. Reverting the waiver code makes the next three lines fail.
  assert.equal(inSpecSyncScope({ ...base, specDeltasWaived: "archived with --skip-specs" }, found), false);
  assert.equal(inSpecSyncScope({ ...base, specDeltasWaived: "  folded by hand  " }, found), false);
  // Only a non-blank string waives: every other value leaves the epic in scope.
  for (const w of [undefined, "", "   ", 7, null, {}]) {
    assert.equal(inSpecSyncScope({ ...base, specDeltasWaived: w }, found), true, `waiver ${JSON.stringify(w)} waives nothing`);
  }
  // And a waiver can never ADD an epic the check does not read.
  assert.equal(inSpecSyncScope({ ...base, specDeltasWaived: "why" }, none), false);
  assert.equal(inSpecSyncScope(base, none), false, "no archive directory, not in scope");
  assert.equal(inSpecSyncScope({ ...base, lane: "claude-code" }, found), false);
  assert.equal(inSpecSyncScope({ ...base, disposition: { outcome: "killed", reason: "r" } }, found), false);
  assert.equal(inSpecSyncScope(null, found), false);
});

unitTest("waivedSpecEpics lists exactly the epics carrying a non-blank waiver, and the briefing block names them", async () => {
  const { waivedSpecEpics } = await import(SPEC_SYNC);
  const { specSyncBlock } = await import(new URL("../../lib/briefing.mjs", import.meta.url).href);
  const epics = [{ id: "a", specDeltasWaived: "why" }, { id: "b", specDeltasWaived: " " }, { id: "c" }, { id: "d", specDeltasWaived: "also" }];
  assert.deepEqual(waivedSpecEpics(epics), ["a", "d"]);
  const lines = specSyncBlock({ epics });
  assert.match(lines.join("\n"), /SPEC DELTAS WAIVED \(2\): `a`, `d`/);
  assert.deepEqual(specSyncBlock({ epics: [{ id: "c" }] }), [], "no waiver, no findings: the block stays empty");
});
