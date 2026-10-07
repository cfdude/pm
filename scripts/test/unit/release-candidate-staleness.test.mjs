// scripts/test/unit/release-candidate-staleness.test.mjs
// converged-release-candidate-review 3.2 — the ASSERTION TWIN of
// scripts/test/functional/release-candidate-staleness.test.mjs (same id, same subject).
//
// THE FUNCTIONAL FILE'S SUBJECT is D2's claim: a converged verdict needs no new verb, because it is N
// ordinary Gate 2 records and the existing staleness rule already checks each. The scenario itself —
// record at head H, attribute a fix commit F descending from H, see the verdict stale and a `delivered`
// archive refused naming F, re-record at a head that reaches F — resolves commit ancestry through git,
// and the git double answers from a FROZEN capture of one fixed repository, so it cannot model a
// candidate's history. That scenario is therefore functional-only, exactly as unit/conductor-09 names for
// `--base-sha/--head-sha` (its omission 1).
//
// WHAT THIS HALF PINS is everything D2 rests on that needs no commit graph:
//   1. there is NO release-level record path — no such verb in the dispatch table, no `--release` flag on
//      the per-member verb, no release flag on `release` that stores a verdict;
//   2. the per-member refusals apply unchanged to a candidate member (a pass with no range is refused and
//      writes nothing);
//   3. the staleness rule's shape branch, which needs no commit graph, applies to a member's record exactly
//      as to any change's (read through `render`): a malformed attributed commit makes a Gate 2 verdict
//      render stale, and an epic that attributed and then withdrew everything is not offered as a clean pass.

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const CONSTANTS = new URL("../../lib/constants.mjs", import.meta.url).href;

unitTest("D2: there is no release-level way to record a verdict — no verb, no flag", async () => {
  const c = await import(CONSTANTS);
  const releaseLevel = Object.keys(c.VERB_POSITIONALS).filter(v => /release/.test(v) && v !== "release");
  assert.deepEqual(releaseLevel, [],
    "no verb is named for a release-level record (`record-release-review`, `release-gate` …): a release-level Gate 2 verb would be a second write path");
  const gate = [...c.EPIC_FLAGS, ...c.VERB_FLAGS].filter(f => f.commands.includes("record-gate-review")).map(f => f.flag);
  assert.ok(!gate.includes("release"), "record-gate-review stores no release id on the verdict (a data reference D2 rejected)");
  const releaseVerb = [...c.EPIC_FLAGS, ...c.VERB_FLAGS].filter(f => f.commands.includes("release")).map(f => f.flag);
  assert.ok(!releaseVerb.some(f => /verdict|gate|review/.test(f)), "and `release` has no flag that records a verdict");
});

unitTest("a candidate member's Gate 2 pass with no range is refused and writes nothing", () => {
  const engine = memoryEngine({ ...emptyRecord(), releases: [{ id: "r1", intent: "x", deferred: [] }],
    epics: [{ id: "a", title: "a", priority: "P1", status: "queued", role: "epic", lane: "openspec", links: [], reconcileNeeded: false, release: "r1", attributedCommits: [] }] });
  const before = engine.store.read("state.json").text;
  assert.ok(expectFail(() => engine(["record-gate-review", "a", "--gate", "2", "--verdict", "pass"])));
  assert.equal(engine.store.read("state.json").text, before);
});

const entry = { verdict: "pass", baseSha: "a".repeat(40), headSha: "b".repeat(40), reviewedAt: "2026-09-29T00:00:00Z", reviewer: "rc" };
const member = (extra) => ({ id: "a", title: "a", priority: "P1", status: "active", role: "epic", lane: "openspec", links: [], reconcileNeeded: false,
  release: "r1", gateReview: { gate2: entry }, ...extra });
const rendered = (epic) => {
  const engine = memoryEngine({ ...emptyRecord(), releases: [{ id: "r1", intent: "x", deferred: [] }], epics: [epic] });
  engine(["render"]);
  return engine.store.read("PROJECT.md").text;
};

unitTest("the staleness rule's shape branch applies to a member's record: a malformed attributed commit renders stale", () => {
  assert.match(rendered(member({ attributedCommits: ["not-a-commit"] })), /⚠ stale/);
});

unitTest("an epic that attributed and then withdrew everything is not rendered as a clean pass", () => {
  const md = rendered(member({ attributedCommits: [], withdrawnCommits: [{ sha: "c".repeat(40), reason: "x", withdrawnAt: "2026-09-29T00:00:00Z" }] }));
  assert.match(md, /pass \(a{40}\.\.b{40}\) · rc ⚠ attribution withdrawn/, "the verdict carries the withdrawal warning, never a bare pass");
});
