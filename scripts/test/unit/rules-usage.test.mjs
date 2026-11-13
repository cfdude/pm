// scripts/test/unit/rules-usage.test.mjs
// gh-cfdude-pm-248, task 1.1 — rulesUsage(state) is the ONE predicate pair behind the usage-conditioned
// rules-block sections (design D2). UNIT rung: a state object in, two booleans out.

import assert from "node:assert/strict";
import { unitTest } from "../fixtures/unit-harness.mjs";
import { FULL_USAGE, rulesUsage } from "../../lib/rules-usage.mjs";

const epic = (id, status, autonomy) => ({ id, status, ...(autonomy !== undefined ? { autonomy } : {}) });
const NONE = { autonomy: false, releaseCandidate: false };

unitTest("1.1 FULL_USAGE is both answers true", () => {
  assert.deepEqual({ ...FULL_USAGE }, { autonomy: true, releaseCandidate: true });
});

unitTest("1.1 no epics and no releases: both false", () => {
  assert.deepEqual(rulesUsage({ epics: [] }), NONE);
  assert.deepEqual(rulesUsage({}), NONE);
  assert.deepEqual(rulesUsage(null), NONE);
  assert.deepEqual(rulesUsage(undefined), NONE);
});

unitTest("1.1 an epic with no autonomy record does not count", () => {
  assert.equal(rulesUsage({ epics: [epic("a", "queued")] }).autonomy, false);
});

unitTest("1.1 a non-archived epic at level autonomous counts", () => {
  assert.equal(rulesUsage({ epics: [epic("a", "queued", { level: "autonomous" })] }).autonomy, true);
});

unitTest("1.1 level off still counts: presence, not level (re-arming restores kept grants)", () => {
  assert.equal(rulesUsage({ epics: [epic("a", "queued", { level: "off" })] }).autonomy, true);
  assert.equal(rulesUsage({ epics: [epic("a", "active", { preAuthorized: [] })] }).autonomy, true);
});

unitTest("1.1 an autonomy record on an archived epic alone does not count", () => {
  assert.equal(rulesUsage({ epics: [epic("a", "archived", { level: "autonomous" })] }).autonomy, false);
});

unitTest("1.1 an archived holder beside a non-archived one: the live one counts", () => {
  const s = { epics: [epic("a", "archived", { level: "off" }), epic("b", "planned", { level: "off" })] };
  assert.equal(rulesUsage(s).autonomy, true);
});

unitTest("1.1 a removed holder stops counting", () => {
  const before = { epics: [epic("a", "queued", { level: "autonomous" })] };
  assert.equal(rulesUsage(before).autonomy, true);
  assert.equal(rulesUsage({ epics: [] }).autonomy, false);
});

unitTest("1.1 a null or non-object autonomy value is not a record", () => {
  assert.equal(rulesUsage({ epics: [epic("a", "queued", null)] }).autonomy, false);
  assert.equal(rulesUsage({ epics: [epic("a", "queued", "autonomous")] }).autonomy, false);
  assert.equal(rulesUsage({ epics: [epic("a", "queued", [])] }).autonomy, false);
});

unitTest("1.1 no releases: releaseCandidate false", () => {
  assert.equal(rulesUsage({ releases: [] }).releaseCandidate, false);
});

unitTest("1.1 one release with no delivered marker: true", () => {
  assert.equal(rulesUsage({ releases: [{ id: "1.0.0" }] }).releaseCandidate, true);
});

unitTest("1.1 one release carrying a delivered marker: false", () => {
  assert.equal(rulesUsage({ releases: [{ id: "1.0.0", delivered: { recordedAt: "2026-11-02T00:00:00Z" } }] }).releaseCandidate, false);
});

unitTest("1.1 one delivered and one undelivered release: true", () => {
  const releases = [{ id: "1.0.0", delivered: { recordedAt: "x" } }, { id: "1.1.0" }];
  assert.equal(rulesUsage({ releases }).releaseCandidate, true);
});

unitTest("1.1 state.releases absent or not an array: false, never a throw", () => {
  assert.equal(rulesUsage({}).releaseCandidate, false);
  assert.equal(rulesUsage({ releases: null }).releaseCandidate, false);
  assert.equal(rulesUsage({ releases: { id: "1.0.0" } }).releaseCandidate, false);
  assert.equal(rulesUsage({ releases: "1.0.0" }).releaseCandidate, false);
});

unitTest("1.1 non-object entries in releases are ignored", () => {
  assert.equal(rulesUsage({ releases: [null, 3, "x"] }).releaseCandidate, false);
});

unitTest("1.1 the two answers are independent", () => {
  const s = { epics: [epic("a", "queued", { level: "off" })], releases: [{ id: "1", delivered: { recordedAt: "x" } }] };
  assert.deepEqual(rulesUsage(s), { autonomy: true, releaseCandidate: false });
});
