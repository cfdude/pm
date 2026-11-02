// scripts/test/unit/rules-conditional-coverage.test.mjs
// gh-cfdude-pm-248, task 3.4 — the coverage guard. Render rulesBlock() over EVERY combination of the
// spend-tracking, spend-guard, autonomy and release-candidate inputs (tracker absent). Every heading that is
// present in some combination and absent in another MUST be a row of CONDITIONAL_SECTIONS or the always-on
// pointer, so a future conditional section cannot be left out of the refresh and the appearance notice.
// Tracker sections are out of scope: their headings are parameterised and every tracker verb refreshes the
// block through its own writeRules() call (design D4).

import assert from "node:assert/strict";
import { unitTest } from "../fixtures/unit-harness.mjs";
import { rulesBlock } from "../../lib/rules.mjs";
import { CONDITIONAL_SECTIONS } from "../../lib/rules-usage.mjs";

const POINTER = "Procedures emitted on use";
const headingsOf = (block) => new Set([...block.matchAll(/^## (.*?)\s*$/gm)].map((m) => m[1]));

function renders() {
  const out = [];
  for (const spend of [false, true]) for (const guard of [false, true])
    for (const autonomy of [false, true]) for (const releaseCandidate of [false, true]) {
      out.push({ inputs: { spend, guard, autonomy, releaseCandidate },
        headings: headingsOf(rulesBlock(null, "standard", [], "claude-code", null, spend, guard, { autonomy, releaseCandidate })) });
    }
  return out;
}

unitTest("3.4 every heading that varies across the 16 combinations is a CONDITIONAL_SECTIONS row or the pointer", () => {
  const all = renders();
  assert.equal(all.length, 16);
  const union = new Set(all.flatMap((r) => [...r.headings]));
  const known = new Set([...CONDITIONAL_SECTIONS.map((row) => row.heading), POINTER]);
  const varying = [...union].filter((h) => all.some((r) => !r.headings.has(h)));
  const missing = varying.filter((h) => !known.has(h));
  assert.deepEqual(missing, [], `conditional headings with no CONDITIONAL_SECTIONS row: ${missing.join(", ")}`);
});

unitTest("3.4 the converse: every row varies with its own input, and the table holds exactly the four", () => {
  assert.deepEqual(CONDITIONAL_SECTIONS.map((r) => r.heading), ["Spend tracking", "Spend guard", "Epic-level autonomy", "Release candidate"]);
  const all = renders();
  const flag = { "Spend tracking": "spend", "Spend guard": "guard", "Epic-level autonomy": "autonomy", "Release candidate": "releaseCandidate" };
  for (const row of CONDITIONAL_SECTIONS) {
    for (const r of all) assert.equal(r.headings.has(row.heading), r.inputs[flag[row.heading]], `${row.heading} under ${JSON.stringify(r.inputs)}`);
  }
});

unitTest("3.4 each row's predicate answers from a record image the way its flag does", () => {
  const rec = {
    spendTracking: { enabled: true }, spendGuard: { maxFailedRounds: 2 },
    epics: [{ id: "e", status: "queued", autonomy: { level: "off" } }], releases: [{ id: "1.0.0" }],
  };
  for (const row of CONDITIONAL_SECTIONS) assert.equal(Boolean(row.shown(rec)), true, row.heading);
  for (const row of CONDITIONAL_SECTIONS) assert.equal(Boolean(row.shown({ epics: [] })), false, row.heading);
});

unitTest("3.4 the pointer is present exactly when a usage row is absent", () => {
  for (const r of renders()) {
    assert.equal(r.headings.has(POINTER), !(r.inputs.autonomy && r.inputs.releaseCandidate), JSON.stringify(r.inputs));
  }
});
