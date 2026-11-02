// scripts/test/unit/overhead-usage.test.mjs
// gh-cfdude-pm-248, task 4.1 — overhead counts what the hypothetical uses (design D6). UNIT rung: reports are
// values computed in memory from a state handed in.

import assert from "node:assert/strict";
import { unitTest } from "../fixtures/unit-harness.mjs";
import {
  SURFACE_FEATURES, buildHypotheticalReport, buildReport, collectSurfaces, hypotheticalState, rulesBlockFor,
} from "../../lib/overhead.mjs";
import { FULL_USAGE } from "../../lib/rules-usage.mjs";

const base = () => ({ version: 1, revision: 1, active: null, detourStack: [], epics: [] });
const inputs = { listings: [], hooks: ["brief", "snapshot"], lessons: [] };
const ids = (r) => r.surfaces.map((s) => s.id);
const byId = (r) => Object.fromEntries(r.surfaces.map((s) => [s.id, s]));
const AUTONOMY = "rules:epic-level-autonomy", RC = "rules:release-candidate", POINTER = "rules:procedures-emitted-on-use";

const inUse = () => ({
  ...base(),
  epics: [{ id: "e", status: "queued", autonomy: { level: "off" } }],
  releases: [{ id: "1.0.0" }],
});

unitTest("4.1 the pointer is a core surface in the map", () => {
  assert.equal(SURFACE_FEATURES[POINTER], "core");
});

unitTest("4.1 the real report on a fresh repo lists the pointer and neither usage-conditioned section", () => {
  const r = buildReport(base(), inputs);
  assert.ok(!ids(r).includes(AUTONOMY) && !ids(r).includes(RC));
  assert.equal(byId(r)[POINTER].feature, "core");
  assert.ok(byId(r)[POINTER].bytes > 0 && byId(r)[POINTER].bytes <= 400);
});

unitTest("4.1 the real report reads the repo's usage: a record and an open release bring the sections and drop the pointer", () => {
  const r = buildReport(inUse(), inputs);
  assert.ok(ids(r).includes(AUTONOMY) && ids(r).includes(RC));
  assert.ok(!ids(r).includes(POINTER));
});

unitTest("4.1 --all-features counts both sections under the hypothetical and lists no pointer", () => {
  const r = buildHypotheticalReport(base(), inputs);
  assert.ok(ids(r).includes(AUTONOMY) && ids(r).includes(RC));
  assert.ok(!ids(r).includes(POINTER));
  assert.equal(byId(r)[AUTONOMY].feature, "core");
  assert.equal(byId(r)[RC].feature, "core");
});

unitTest("4.1 the hypothetical seeds no epic and no release, so the brief's bytes do not move", () => {
  const hyp = hypotheticalState(base());
  assert.deepEqual(hyp.epics, []);
  assert.equal(hyp.releases, undefined);
  const viaReport = byId(buildHypotheticalReport(base(), inputs)).brief.bytes;
  const direct = byId(buildReport(hyp, { ...inputs, usage: FULL_USAGE })).brief.bytes;
  assert.equal(viaReport, direct);
});

unitTest("4.1 the hypothetical ignores the real state's usage: a repo already using both reports the same two sections", () => {
  const r = buildHypotheticalReport(inUse(), inputs);
  assert.equal(byId(r)[AUTONOMY].bytes, byId(buildHypotheticalReport(base(), inputs))[AUTONOMY].bytes);
});

unitTest("4.1 rulesBlockFor takes the usage as a parameter; the default is the state's own answers", () => {
  const fresh = rulesBlockFor(base());
  assert.ok(!fresh.includes("## Epic-level autonomy") && fresh.includes("## Procedures emitted on use"));
  const full = rulesBlockFor(base(), "claude-code", FULL_USAGE);
  assert.ok(full.includes("## Epic-level autonomy") && full.includes("## Release candidate"));
  assert.ok(!full.includes("## Procedures emitted on use"));
  assert.equal(rulesBlockFor(inUse()), rulesBlockFor(inUse(), "claude-code", FULL_USAGE));
});

unitTest("4.1 collectSurfaces accepts the usage in its inputs", () => {
  const surfaces = collectSurfaces(base(), { ...inputs, usage: FULL_USAGE }).map((s) => s.id);
  assert.ok(surfaces.includes(AUTONOMY) && !surfaces.includes(POINTER));
});
