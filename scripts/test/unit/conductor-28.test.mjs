// scripts/test/unit/conductor-28.test.mjs
// 4.1's migration of `assert/conductor-28.test.mjs` — 4 of its 23 tests, moved from the file rung to
// the unit rung with every assertion unchanged.
//
// gh-127 + gh-132: two practices invented in this repo that never reached the product.
//
// #127 — the dogfooding rule lived only in `.claude/skills/` and in this repo's CLAUDE.md.
// #132 — the lessons practice lived only in `.claude/skills/` plus a `.claude/hooks/` script
//        wired by `.claude/settings.json`, so the one mode that works without recall — a
//        PreToolUse advisor firing on the SITUATION — reached exactly one repository.
//
// ─────────────── WHAT MOVED, AND WHAT DID NOT ───────────────
//
// FOUR moved: the routing item's presence in GATE_PROCEDURE_ITEMS and its mustSay declaration (both
// pure imports), the no-unresolved-placeholder sweep over the three platform blocks (`rules` prints
// them) and lesson-advice's declared working-tree effect (a lib import).
//
// NINETEEN STAY, and one helper decides eleven of them: `lesson(cwd, slug, fields)` WRITES
// `docs/lessons/<slug>.md`, and that corpus is the advisor's own INPUT — a directory the store does
// not own, walked on every tool call. The remaining eight read SHIPPED files (hooks/hooks.json, the
// two skills and their `.claude/` stubs, the three emitted mirrors, docs/parity-ledger.json) or
// assert a file's ABSENCE. Every one of those is a path read by construction.

import assert from "node:assert/strict";
import { emptyRecord, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";
import { GATE_PROCEDURE_ITEMS } from "../../lib/rules.mjs";

const ROUTING_ITEM = "Route what the work taught you.";

// ─────────────────── 28.6: the rule reaches every repo, as a REQUIRED TASK ITEM ───────────

unitTest("28.6 the routing item is a numbered gate-procedure item, not a prose bullet", () => {
  const titles = GATE_PROCEDURE_ITEMS.map(i => i.title);
  assert.ok(titles.includes(ROUTING_ITEM),
    `the gate procedure must carry "${ROUTING_ITEM}" — measured here, a rule carried by a ` +
    "required task reached 14/14 subsequent changes and the same rule as prose reached 3/15");
});

unitTest("28.6 no `{{pm:…}}` placeholder survives into the rendered block, on any platform", () => {
  const engine = memoryEngine(emptyRecord());
  // The placeholder is new machinery with a silent failure mode: a typo'd name renders
  // LITERALLY into the rules block and nothing else notices. platform.test.mjs catches the
  // resolved-to-the-wrong-form case; this catches the never-resolved-at-all case.
  for (const platform of ["claude-code", "codex", "hermes"]) {
    assert.doesNotMatch(engine(["rules", "--platform", platform]), /\{\{/,
      `an unresolved placeholder reached the ${platform} block`);
  }
});

unitTest("28.6 the item declares mustSay claims, so a mirror cannot contradict the generator", () => {
  const item = GATE_PROCEDURE_ITEMS.find(i => i.title === ROUTING_ITEM);
  assert.ok(item, "the item must exist before its claims can be checked");
  assert.ok(Array.isArray(item.mustSay) && item.mustSay.length >= 2,
    "an item added without mustSay widens the gap conductor-16's 15.5 guard exists to close");
});

// ─────────────────── 28.7: the ledger claims what ships ───────────────────

unitTest("28.7 lesson-advice declares its working-tree effect", async () => {
  const { VERB_EFFECTS } = await import("../../lib/verb-effects.mjs");
  assert.equal(VERB_EFFECTS["lesson-advice"].effect, "read-only",
    "an advisory hook that fires on every tool call must never touch the tree");
});
