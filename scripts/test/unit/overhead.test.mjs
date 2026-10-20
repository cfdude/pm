// scripts/test/unit/overhead.test.mjs
// pm-overhead-baseline 1.1-1.5. Surface sizes, the surface-to-feature map, subtotals, the hypothetical state
// and both output forms are VALUES computed in memory: the unit rung. Plugin FILES (listings, hooks.json) are
// handed in as fixtures here; reading them is the file rung's job (assert/overhead.test.mjs).

import assert from "node:assert/strict";
import { unitTest } from "../fixtures/unit-harness.mjs";
import {
  DOWNSTREAM_LINE, SPEND_MARKER_LINE, SURFACE_FEATURES, buildHypotheticalReport, buildReport, collectSurfaces,
  featureIds, featureOf, frontmatterDescription, hypotheticalState, overheadText, rulesBlockFor, slug,
} from "../../lib/overhead.mjs";
import { OPT_INS } from "../../lib/opt-ins.mjs";
import { measureRulesBlock } from "../../lib/session-cost.mjs";

const base = () => ({ version: 1, revision: 1, active: null, detourStack: [], epics: [] });
const listings = [
  { file: "commands/spend.md", name: "spend", description: "Show token spend per epic" },
  { file: "skills/lessons/SKILL.md", name: "lessons", description: "Keep a repository's process knowledge" },
  { file: "agents/reconciler.md", name: "reconciler", description: "Re-validates a paused proposal" },
];
const inputs = { listings, hooks: ["brief", "snapshot", "commit-nudge", "gate-guard", "lesson-advice"], lessons: [] };
const byId = (r) => Object.fromEntries(r.surfaces.map((s) => [s.id, s]));

unitTest("1.1 every rules section is a surface whose bytes equal what `rules --sections` measures", () => {
  const state = base();
  const expected = measureRulesBlock(rulesBlockFor(state)).sections;
  const rules = collectSurfaces(state, inputs).filter((s) => s.id.startsWith("rules:"));
  assert.equal(rules.length, expected.length);
  for (const sec of expected) {
    const hit = rules.find((s) => s.title === sec.heading);
    assert.ok(hit, `section ${sec.heading} is a surface`);
    assert.equal(hit.bytes, sec.bytes);
  }
});

unitTest("1.1 a section the verb has never heard of still appears as a surface (enumerated, not typed)", () => {
  // A tracker adds sections the base block lacks; none of them is named in the verb.
  const state = { ...base(), tracker: { system: "github-issues", repo: "o/r" } };
  const ids = collectSurfaces(state, inputs).map((s) => s.id);
  assert.ok(ids.includes("rules:github-issue-sync"));
  assert.ok(!collectSurfaces(base(), inputs).map((s) => s.id).includes("rules:github-issue-sync"));
});

unitTest("1.1 the brief, the snapshot, the hooks and each listing are surfaces", () => {
  const ids = collectSurfaces(base(), inputs).map((s) => s.id);
  for (const id of ["brief", "snapshot", "hook:gate-guard", "hook:commit-nudge", "hook:lesson-advice",
    "listing:commands/spend.md", "listing:skills/lessons/SKILL.md", "listing:agents/reconciler.md"]) {
    assert.ok(ids.includes(id), id);
  }
});

unitTest("1.2 EVERY surface in every configuration has exactly one feature, naming the surface when it has none", () => {
  const hyp = hypotheticalState({ ...base(), secondaryTrackers: [{ system: "jira", projectKey: "ABC" }, { system: "linear", team: "T" }] });
  for (const state of [base(), hyp, { ...base(), tracker: { system: "jira", projectKey: "ABC" } }]) {
    for (const s of collectSurfaces(state, inputs)) {
      assert.ok(featureIds().includes(featureOf(s.id)), `surface ${s.id} is assigned a feature that exists`);
      assert.equal(s.feature, featureOf(s.id));
    }
  }
});

unitTest("1.2 an unassigned surface id maps to null, which the sweep above turns into a failure naming it", () => {
  assert.equal(featureOf("rules:a-section-nobody-assigned"), null);
  assert.equal(featureOf("listing:commands/anything.md"), "listings");
});

unitTest("1.2 the map names only features that exist, and no id is mapped twice", () => {
  for (const [id, f] of Object.entries(SURFACE_FEATURES)) assert.ok(featureIds().includes(f), `${id} -> ${f}`);
  assert.equal(new Set(Object.keys(SURFACE_FEATURES)).size, Object.keys(SURFACE_FEATURES).length);
});

unitTest("1.2 every OPT_INS id is a feature, and core splits into named surfaces", () => {
  for (const o of OPT_INS) assert.ok(featureIds().includes(o.id));
  const r = buildReport(base(), inputs);
  assert.equal(byId(r)["rules:intake"].feature, "core");
  assert.equal(byId(r)["rules:execution-profile"].feature, "core");
});

unitTest("1.2 per-feature subtotals hold on, bytes, estimated tokens and the surface list; an off feature is 0", () => {
  const r = buildReport(base(), inputs);
  for (const id of featureIds()) {
    const f = r.features[id];
    assert.deepEqual(Object.keys(f).filter((k) => ["on", "bytes", "estimatedTokens", "surfaces"].includes(k)).sort(),
      ["bytes", "estimatedTokens", "on", "surfaces"]);
  }
  assert.equal(r.features.spendTracking.on, false);
  assert.equal(r.features.spendTracking.bytes, 0);
  assert.equal(r.features.tracker.bytes, 0);
  assert.equal(r.features.listings.on, true);
  assert.ok(r.features.core.bytes > 0);
});

unitTest("1.2 listings belong to their own feature, with spend tracking off the spend command is under listings", () => {
  const r = buildReport(base(), inputs);
  assert.ok(r.features.listings.surfaces.includes("listing:commands/spend.md"));
  assert.equal(r.features.spendTracking.bytes, 0);
  assert.equal(r.features.spendTracking.perDispatchBytes, 0);
});

unitTest("1.5 spend tracking's own cost: its rules section and the per-dispatch marker line, spend guard its section", () => {
  const on = { ...base(), spendTracking: { enabled: true }, spendGuard: { maxFailedRounds: 2 } };
  const r = buildReport(on, inputs);
  assert.equal(r.features.spendTracking.on, true);
  assert.ok(r.features.spendTracking.surfaces.includes("rules:spend-tracking"));
  assert.ok(r.features.spendTracking.bytes > 0);
  assert.equal(r.features.spendTracking.perDispatchBytes, Buffer.byteLength(SPEND_MARKER_LINE));
  assert.ok(r.features.spendGuard.surfaces.includes("rules:spend-guard"));
  assert.ok(r.features.spendGuard.bytes > 0);
});

unitTest("1.3 conditional surfaces are marked and kept out of the session total, which says so", () => {
  const r = buildReport(base(), inputs);
  const s = byId(r);
  for (const id of ["hook:lesson-advice", "hook:gate-guard", "hook:commit-nudge", "snapshot"]) assert.equal(s[id].conditional, true, id);
  const unconditional = r.surfaces.filter((x) => !x.conditional && !x.perDispatch).reduce((a, x) => a + x.bytes, 0);
  assert.equal(r.total.bytes, unconditional);
  assert.match(r.total.note, /unconditional surfaces only/);
  // a lesson-advice surface carries its size when it fires
  const withLesson = byId(buildReport(base(), { ...inputs, lessons: [{ rule: "Never do the thing", file: "x.md" }] }));
  assert.ok(withLesson["hook:lesson-advice"].bytes > 0);
});

unitTest("1.4 --all-features: the hypothetical is named, every feature is on, and it does not touch its argument", () => {
  const state = { ...base(), reviewMode: "standard" };
  const frozen = JSON.stringify(state);
  const r = buildHypotheticalReport(state, inputs);
  assert.equal(JSON.stringify(state), frozen, "the input record is untouched");
  assert.equal(r.hypothetical.name, "all-features");
  for (const id of featureIds()) assert.equal(r.features[id].on, true, id);
  assert.ok(r.features.tracker.wouldAddBytes > 0);
  assert.ok(r.features.spendTracking.wouldAddBytes > 0);
  assert.equal(r.features.reviewMode.realOn, true, "reviewMode was already set");
});

unitTest("1.4 --all-features in a repo with only reviewMode set reports the bytes every other feature would add", () => {
  const r = buildHypotheticalReport({ ...base(), reviewMode: "thorough" }, inputs);
  const off = Object.entries(r.features).filter(([, f]) => !f.realOn).map(([id]) => id);
  assert.ok(off.includes("tracker") && off.includes("spendTracking") && off.includes("spendGuard"));
  assert.equal(r.features.core.wouldAddBytes >= 0, true);
});

unitTest("1.5 every token figure in the text report is labelled, and the downstream line names spend-analysis and no docs path", () => {
  for (const r of [buildReport(base(), inputs), buildHypotheticalReport(base(), inputs)]) {
    const text = overheadText(r);
    for (const line of text.split("\n")) {
      const figures = line.match(/~\d+ tokens/g) || [];
      for (const _ of figures) assert.match(line, /\(bytes\/4, estimate\)/, line);
    }
    assert.ok(text.includes("downstream efficiency: not measured by this verb"));
    assert.ok(text.includes("spend-analysis"));
    assert.ok(!/docs\//.test(text), "no pm-repository path is named");
    assert.equal(r.downstream, DOWNSTREAM_LINE);
  }
});

unitTest("1.5 --json surfaces carry bytes, estimatedTokens and method bytes/4", () => {
  for (const s of buildReport(base(), inputs).surfaces) {
    assert.equal(s.method, "bytes/4");
    assert.ok("bytes" in s && "estimatedTokens" in s);
    if (s.bytes !== null) assert.equal(s.estimatedTokens, Math.ceil(s.bytes / 4));
  }
});

unitTest("slug drops the repo a tracker heading carries and keeps the stem", () => {
  assert.equal(slug("GitHub issue sync (cfdude/pm)"), "github-issue-sync");
  assert.equal(slug("Intake — triage an ask"), "intake");
  assert.equal(slug("Execution profile"), "execution-profile");
});

unitTest("frontmatterDescription reads plain, quoted and folded-block descriptions", () => {
  assert.equal(frontmatterDescription("---\ndescription: Plain one\n---\nbody"), "Plain one");
  assert.equal(frontmatterDescription("---\ndescription: \"Quoted\"\n---\n"), "Quoted");
  assert.equal(frontmatterDescription("---\ndescription: >\n  folded\n  text\nmodel: x\n---\n"), "folded text");
  assert.equal(frontmatterDescription("no frontmatter"), "");
});
