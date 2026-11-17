// scripts/test/unit/openspec-addenda-rules.test.mjs
// gh-cfdude-pm-262 task 2.7: rulesBlock's 13th input. The default (omitted) block must be byte-identical to the one rendered before the
// parameter existed, a non-empty section appears exactly once between Boards and "Re-read the source", and renders are idempotent.

import assert from "node:assert/strict";
import { unitTest } from "../fixtures/unit-harness.mjs";
import { rulesBlock } from "../../lib/rules.mjs";
import { openspecAddendaSectionText } from "../../lib/openspec-addenda.mjs";

const render = (...extra) => rulesBlock(null, "standard", [], "claude-code", null, false, false, undefined, "", undefined, "", "", ...extra);
const SECTION = openspecAddendaSectionText({ hasOpenspec: true });

unitTest("2.7 the omitted input and an explicit empty one render the same bytes, with no addenda heading", () => {
  assert.equal(rulesBlock(null, "standard"), render(""));
  assert.equal(render(), render(""));
  assert.ok(!render().includes("## OpenSpec addenda"));
});

unitTest("2.7 a non-empty section appears exactly once, between Boards and the re-read section, and rendering is idempotent", () => {
  const a = render(SECTION);
  assert.equal(a.split("## OpenSpec addenda").length - 1, 1);
  const i = a.indexOf("## Boards"), j = a.indexOf("## OpenSpec addenda"), k = a.indexOf("## Re-read the source before an epic becomes the work");
  assert.ok(i >= 0 && i < j && j < k, `order ${i} ${j} ${k}`);
  assert.equal(a, render(SECTION));
  assert.equal(a.replace(`${SECTION}\n\n`, ""), render(""), "removing the section restores the default block exactly");
});
