// scripts/test/unit/lesson-rejects-brief.test.mjs
// gh-cfdude-pm-228 -- the assertion twin (same id) of scripts/test/functional/lesson-rejects-brief.test.mjs.
// The briefing line for lesson matchers the engine refused. The unit rung owns the line's shape over a
// value passed in; the functional half owns the read of a real docs/lessons/.

import assert from "node:assert/strict";
import { buildBrief } from "../../lib/briefing.mjs";
import { emptyRecord, unitTest } from "../fixtures/unit-harness.mjs";

const rejects = (n) => Array.from({ length: n }, (_, i) => ({ file: `bad-${i}.md`, reason: `reason ${i}` }));

unitTest("228: no rejects, or none passed, prints no line", () => {
  assert.doesNotMatch(buildBrief(emptyRecord()), /lesson matcher/);
  assert.doesNotMatch(buildBrief(emptyRecord(), { lessonRejects: [] }), /lesson matcher/);
  assert.doesNotMatch(buildBrief(emptyRecord(), { lessonRejects: null }), /lesson matcher/);
});

unitTest("228: one reject names the file and the reason", () => {
  const out = buildBrief(emptyRecord(), { lessonRejects: rejects(1) });
  assert.match(out, /⚠ 1 lesson matcher rejected — the lesson-advice hook never fires it/);
  assert.match(out, /  - bad-0\.md: reason 0/);
});

unitTest("228: more than five are capped with a pointer, not listed forever", () => {
  const out = buildBrief(emptyRecord(), { lessonRejects: rejects(8) });
  assert.match(out, /⚠ 8 lesson matchers rejected/);
  assert.match(out, /bad-4\.md/);
  assert.doesNotMatch(out, /bad-5\.md/);
  assert.match(out, /\(\+3 more in docs\/lessons\/\)/);
});

unitTest("228: a reason carrying a newline cannot start a line of the brief", () => {
  const out = buildBrief(emptyRecord(), { lessonRejects: [{ file: "x.md", reason: "bad\n  - forged.md: injected" }] });
  assert.doesNotMatch(out, /^  - forged\.md/m);
  assert.match(out, /x\.md: bad\\u000a/);
});
