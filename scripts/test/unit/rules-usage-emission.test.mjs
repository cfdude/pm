// scripts/test/unit/rules-usage-emission.test.mjs
// gh-cfdude-pm-248, task 2.2 — rulesBlock()'s trailing `usage` parameter (design D1, D3). UNIT rung:
// rulesBlock is pure over its arguments.
//
// RELATIONAL ON PURPOSE. Nothing here freezes the whole block: the next required gate item
// (`mutation-pass-is-a-required-task-item`) adds text to it. Each test states how two renders relate:
// the default call equals the both-true call, and turning one answer off removes exactly that section
// (plus the tracker paragraph for autonomy) and adds the pointer.

import assert from "node:assert/strict";
import { unitTest } from "../fixtures/unit-harness.mjs";
import { FULL_USAGE } from "../../lib/rules-usage.mjs";
import { PROCEDURES_HEADING, proceduresEmittedOnUseLines, rulesBlock } from "../../lib/rules.mjs";

const POINTER = "Procedures emitted on use";
const AUTONOMY = "Epic-level autonomy";
const RC = "Release candidate";
const TRACKER_PARAGRAPH = "**Epic-level autonomy on tracker-linked epics:**";

const OUTWARD = { system: "github-issues", direction: "outward", repo: "o/n" };
const BOTH = { system: "jira", direction: "both", projectKey: "ABC" };
const INWARD = { system: "github-issues", direction: "inward", repo: "o/n" };
const ON = { autonomy: true, releaseCandidate: true };
const NO_AUTONOMY = { autonomy: false, releaseCandidate: true };
const NO_RC = { autonomy: true, releaseCandidate: false };
const NEITHER = { autonomy: false, releaseCandidate: false };

const render = (usage, { tracker = null, spend = false, guard = false, platform = "claude-code" } = {}) =>
  usage === undefined
    ? rulesBlock(tracker, "standard", [], platform, null, spend, guard)
    : rulesBlock(tracker, "standard", [], platform, null, spend, guard, usage);

/** [{heading, text}] in order, split on `## ` lines. Text before the first heading is dropped. */
function sectionsOf(block) {
  const out = [];
  for (const line of block.split(/(?<=\n)/)) {
    const m = /^## (.*?)\s*$/.exec(line);
    if (m) out.push({ heading: m[1], text: "" });
    if (out.length) out[out.length - 1].text += line;
  }
  return out;
}
const headingsOf = (block) => sectionsOf(block).map((s) => s.heading);
const byHeading = (block) => new Map(sectionsOf(block).map((s) => [s.heading, s.text]));
const sectionStarting = (block, prefix) => sectionsOf(block).find((s) => s.heading.startsWith(prefix));

unitTest("2.2 FULL_USAGE is the parameter's default: a call with no usage equals a call with both true", () => {
  for (const opts of [{}, { tracker: OUTWARD }, { tracker: BOTH, spend: true, guard: true }, { platform: "codex" }]) {
    assert.equal(render(undefined, opts), render(ON, opts));
    assert.equal(render(undefined, opts), render({ ...FULL_USAGE }, opts));
  }
});

unitTest("2.2 the default render carries both sections and no pointer", () => {
  const h = headingsOf(render(undefined));
  assert.ok(h.includes(AUTONOMY) && h.includes(RC));
  assert.ok(!h.includes(POINTER));
});

unitTest("2.2 autonomy off removes exactly the autonomy section and puts the pointer in its slot", () => {
  const full = render(ON), off = render(NO_AUTONOMY);
  const fh = headingsOf(full), oh = headingsOf(off);
  assert.deepEqual(oh, fh.map((h) => (h === AUTONOMY ? POINTER : h)), "the pointer takes the autonomy slot, nothing else moves");
  const f = byHeading(full), o = byHeading(off);
  for (const h of fh.filter((x) => x !== AUTONOMY)) {
    // the pointer sits between Reporting and Execution profile; the section it follows keeps its bytes
    assert.equal(o.get(h), f.get(h), `section '${h}' is byte-identical`);
  }
  assert.ok(!off.includes(`## ${AUTONOMY}`));
});

unitTest("2.2 release candidate off removes exactly that section and adds the pointer", () => {
  const full = render(ON), off = render(NO_RC);
  const fh = headingsOf(full), oh = headingsOf(off);
  assert.ok(!oh.includes(RC) && oh.includes(POINTER));
  assert.deepEqual(oh.filter((h) => h !== POINTER), fh.filter((h) => h !== RC));
  const f = byHeading(full), o = byHeading(off);
  for (const h of oh.filter((x) => x !== POINTER)) assert.equal(o.get(h), f.get(h), `section '${h}' is byte-identical`);
});

unitTest("2.2 both off: neither section, one pointer, every other section byte-identical", () => {
  const full = byHeading(render(ON)), off = byHeading(render(NEITHER));
  assert.ok(!off.has(AUTONOMY) && !off.has(RC) && off.has(POINTER));
  for (const [h, text] of off) if (h !== POINTER) assert.equal(text, full.get(h), `section '${h}'`);
  assert.equal([...off.keys()].filter((h) => h === POINTER).length, 1);
});

unitTest("2.2 the pointer sits after Reporting and before Execution profile", () => {
  const h = headingsOf(render(NEITHER));
  const i = h.indexOf(POINTER);
  assert.ok(h[i - 1].startsWith("Reporting") && h[i + 1] === "Execution profile", h.join(" | "));
});

unitTest("2.2 the gate procedure, Intake and Reporting are emitted under every usage answer, byte-identical", () => {
  const keep = (b) => sectionsOf(b).filter((s) => /^(The gate procedure|Intake|Reporting)/.test(s.heading));
  const base = keep(render(ON));
  assert.equal(base.length, 3);
  for (const u of [NO_AUTONOMY, NO_RC, NEITHER]) assert.deepEqual(keep(render(u)), base);
});

unitTest("2.2 the pointer names only the absent procedures", () => {
  const both = proceduresEmittedOnUseLines(NEITHER).join("\n");
  assert.match(both, /set-autonomy/);
  assert.match(both, /Epic-level autonomy — the preflight scan/);
  assert.match(both, /release-candidate` skill/);

  const onlyRelease = proceduresEmittedOnUseLines(NO_RC).join("\n");
  assert.match(onlyRelease, /release-candidate` skill/);
  assert.doesNotMatch(onlyRelease, /preflight scan|set-autonomy/);

  const onlyAutonomy = proceduresEmittedOnUseLines(NO_AUTONOMY).join("\n");
  assert.match(onlyAutonomy, /preflight scan/);
  assert.doesNotMatch(onlyAutonomy, /release-candidate/);
});

unitTest("2.2 the pointer is absent when both sections are carried, and is at most 400 bytes otherwise", () => {
  assert.deepEqual(proceduresEmittedOnUseLines(ON), []);
  assert.deepEqual(proceduresEmittedOnUseLines(), []);
  for (const u of [NO_AUTONOMY, NO_RC, NEITHER]) {
    const section = sectionStarting(render(u), POINTER).text;
    assert.ok(Buffer.byteLength(section.trimEnd(), "utf8") <= 400, `${Buffer.byteLength(section, "utf8")} bytes`);
  }
  assert.equal(PROCEDURES_HEADING, `## ${POINTER}`);
});

unitTest("2.2 the pointer ends with the line saying the omitted section joins the block when the feature is in use", () => {
  const text = proceduresEmittedOnUseLines(NEITHER).join("\n");
  assert.match(text, /joins this block once its feature is in use/);
});

unitTest("2.2 an outward tracker's autonomy paragraph follows usage.autonomy, and nothing else in the tracker section moves", () => {
  for (const tracker of [OUTWARD, BOTH]) {
    const on = render(ON, { tracker }), off = render(NO_AUTONOMY, { tracker });
    assert.ok(on.includes(TRACKER_PARAGRAPH));
    assert.ok(!off.includes(TRACKER_PARAGRAPH));
    const onSection = sectionStarting(on, "External tracker sync").text;
    const offSection = sectionStarting(off, "External tracker sync").text;
    const start = onSection.indexOf(`\n${TRACKER_PARAGRAPH}`);
    assert.notEqual(start, -1);
    const end = onSection.indexOf("silently absorbs.\n", start) + "silently absorbs.\n".length;
    assert.equal(onSection.slice(0, start) + onSection.slice(end), offSection,
      "removing the paragraph from the full section yields the autonomy-off section");
  }
});

unitTest("2.2 release candidate off leaves the tracker paragraph alone", () => {
  assert.ok(render(NO_RC, { tracker: OUTWARD }).includes(TRACKER_PARAGRAPH));
});

unitTest("2.2 an inward-only tracker never carried the paragraph, under any usage", () => {
  for (const u of [ON, NO_AUTONOMY, NEITHER]) assert.ok(!render(u, { tracker: INWARD }).includes(TRACKER_PARAGRAPH));
});

unitTest("2.2 no line emitted while the autonomy section is absent points at it", () => {
  for (const tracker of [null, OUTWARD, BOTH, INWARD]) {
    const off = render(NO_AUTONOMY, { tracker });
    const outsidePointer = sectionsOf(off).filter((s) => s.heading !== POINTER).map((s) => s.text).join("");
    assert.ok(!/## Epic-level autonomy/.test(off));
    assert.ok(!/decision-rule\s+item \(d\)/.test(outsidePointer), "the paragraph that cites item (d) is gone");
    assert.ok(!outsidePointer.includes("Epic-level autonomy —"), "no 'see the section' reference outside the pointer");
  }
});

unitTest("2.2 the usage answers are independent of the spend toggles", () => {
  const h = headingsOf(render(NEITHER, { spend: true, guard: true }));
  assert.ok(h.includes("Spend tracking") && h.includes("Spend guard") && h.includes(POINTER));
  assert.ok(!h.includes(AUTONOMY) && !h.includes(RC));
});

unitTest("2.2 every platform renders exactly one copy of the pointer", () => {
  for (const platform of ["claude-code", "codex", "hermes"]) {
    const block = render(NEITHER, { platform });
    assert.equal(headingsOf(block).filter((h) => h === POINTER).length, 1, platform);
  }
});
