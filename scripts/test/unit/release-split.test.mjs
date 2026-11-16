// release-planning-taxonomy 4.2 and 4.3 (spec release-planning): the all-lanes split, the fixed health band, the override reason,
// primaryServed. UNIT rung; the pure readers directly and `board --json` / `release show` through the verbs.

import assert from "node:assert/strict";
import { memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";
import { EPIC_FLAGS, VERB_FLAGS, VERB_POSITIONALS } from "../../lib/constants.mjs";
import { HEALTH_SHARE_MAX, HEALTH_SHARE_MIN, HEALTH_SHARE_TARGET, primaryServedOf, releaseSplit } from "../../lib/release-plan.mjs";
import { OPT_INS } from "../../lib/opt-ins.mjs";

const init = (id) => ({ id, title: id, capability: "c", status: "open", history: [], milestones: [], nextMilestone: 1, nonGoals: [], nextNonGoal: 1 });
const ids = new Set(["boards", "reporting"]);
const epic = (id, over = {}) => ({ id, title: id, priority: "P2", status: "queued", role: "epic", lane: "superpowers", links: [], release: "r1", ...over });
const many = (n, over) => Array.from({ length: n }, (_, i) => epic(`e${i}`, over(i)));
const record = (epics, over = {}) => ({ version: 1, revision: 1, active: null, detourStack: [], epics,
  releases: [{ id: "r1", intent: "i", deferred: [], initiative: "boards" }], initiatives: [init("boards"), init("reporting")], ...over });
const rel = (state) => JSON.parse(memoryEngine(state)(["board", "--json"])).releases[0];

unitTest("every member in any lane counts once: health, initiativeWork or unaligned", () => {
  const members = [
    ...Array.from({ length: 7 }, (_, i) => epic(`w${i}`, { kind: "initiative-work", initiative: "boards" })),
    epic("h1", { kind: "health" }), epic("h2", { kind: "health" }),
    epic("u1"),
  ];
  assert.deepEqual(rel(record(members)).split, { initiativeWork: 7, health: 2, unaligned: 1, healthShare: 0.2, target: 0.2, drift: false });
});

unitTest("the claude-code effective kind: initiative-work with an initiative, else health", () => {
  const split = releaseSplit([epic("a", { lane: "claude-code", initiative: "boards" }), epic("b", { lane: "claude-code" })], ids);
  assert.deepEqual([split.initiativeWork, split.health, split.unaligned], [1, 1, 0]);
  const kinded = releaseSplit([epic("a", { lane: "claude-code", kind: "initiative-work" })], ids);
  assert.deepEqual([kinded.initiativeWork, kinded.health, kinded.unaligned], [0, 0, 1], "a recorded kind wins over the default");
});

unitTest("an offInitiativeReason leaves a member unaligned; a non-claude-code epic naming an initiative counts as initiative work with no kind", () => {
  const s = releaseSplit([epic("a", { kind: "initiative-work", offInitiativeReason: "security fix" }), epic("b", { initiative: "boards" })], ids);
  assert.deepEqual([s.initiativeWork, s.health, s.unaligned], [1, 0, 1]);
});

unitTest("a dangling initiative reference does not count as naming one", () => {
  const s = releaseSplit([epic("a", { kind: "initiative-work", initiative: "gone" })], ids);
  assert.equal(s.unaligned, 1);
});

unitTest("healthShare over all members, null with none, and the fixed target", () => {
  assert.equal(rel(record([])).split.healthShare, null);
  assert.equal(rel(record([])).split.drift, null);
  assert.equal(rel(record(many(4, (i) => (i === 0 ? { kind: "health" } : {})))).split.healthShare, 0.25);
  assert.equal(HEALTH_SHARE_TARGET, 0.2);
  assert.deepEqual([HEALTH_SHARE_MIN, HEALTH_SHARE_MAX], [0.1, 0.3]);
});

unitTest("drift: 0 and 4 of 10 drift; 1, 2 and 3 of 10 do not (the edges are inside the band)", () => {
  const drift = (health) => releaseSplit(many(10, (i) => (i < health ? { kind: "health" } : { kind: "initiative-work", initiative: "boards" })), ids).drift;
  assert.deepEqual([0, 1, 2, 3, 4].map(drift), [true, false, false, false, true]);
  assert.equal(releaseSplit(many(20, (i) => (i < 2 ? { kind: "health" } : {})), ids).drift, false, "2 of 20 is exactly 10%");
  assert.equal(releaseSplit(many(20, (i) => (i < 1 ? { kind: "health" } : {})), ids).drift, true, "1 of 20 is 5%");
  assert.equal(releaseSplit(many(20, (i) => (i < 6 ? { kind: "health" } : {})), ids).drift, false, "6 of 20 is exactly 30%");
  assert.equal(releaseSplit(many(20, (i) => (i < 7 ? { kind: "health" } : {})), ids).drift, true, "7 of 20 is 35%");
});

unitTest("the split counts every member, killed and declined included, and is never stored", () => {
  const e = memoryEngine(record([epic("a", { status: "archived", disposition: { outcome: "declined", reason: "no", recordedAt: "2026-11-01T00:00:00Z" } }), epic("b", { kind: "health" })]));
  assert.equal(JSON.parse(e(["board", "--json"])).releases[0].split.unaligned, 1);
  assert.ok(!("split" in e.store.record().releases[0]), "derived on read, not stored");
});

unitTest("primaryServed: true, false and null", () => {
  assert.equal(primaryServedOf("boards", [epic("a", { initiative: "boards" })]), true);
  assert.equal(primaryServedOf("boards", [epic("a", { secondaryInitiatives: ["boards"] })]), true);
  assert.equal(primaryServedOf("boards", [epic("a", { initiative: "reporting" })]), false);
  assert.equal(primaryServedOf("boards", []), null);
  assert.equal(primaryServedOf(null, [epic("a")]), null);
  const e = memoryEngine(record([epic("a", { initiative: "reporting" }), epic("b", { initiative: "reporting" })]));
  assert.equal(JSON.parse(e(["board", "--json"])).releases[0].primaryServed, false);
  assert.match(e(["release", "show", "r1"]), /warning: no member serves initiative boards/);
});

unitTest("release show prints the split line with its band, DRIFT and the recorded reason", () => {
  const e = memoryEngine(record(many(10, () => ({ kind: "initiative-work", initiative: "boards" }))));
  assert.match(e(["release", "show", "r1"]), /split: 10 initiative work, 0 health, 0 unaligned; health 0% \(target 20%, band 10-30%\), DRIFT/);
  e(["release", "r1", "--split-reason", "platform migration: 80% migration, 20% critical fixes"]);
  assert.match(e(["release", "show", "r1"]), /DRIFT.*platform migration: 80% migration/);
  const ok = memoryEngine(record(many(10, (i) => (i < 2 ? { kind: "health" } : { kind: "initiative-work", initiative: "boards" }))));
  assert.match(ok(["release", "show", "r1"]), /split: 8 initiative work, 2 health, 0 unaligned; health 20% \(target 20%, band 10-30%\)\n/);
  assert.doesNotMatch(ok(["release", "show", "r1"]), /DRIFT/);
});

unitTest("--split-reason: one line of at most 400 characters, cleared by --clear-split-reason, and it changes neither drift nor the split", () => {
  const e = memoryEngine(record(many(10, () => ({ kind: "initiative-work", initiative: "boards" }))));
  const before = rel(e.store.record()).split;
  e(["release", "r1", "--split-reason", "because"]);
  assert.deepEqual(rel(e.store.record()).split, before);
  assert.equal(rel(e.store.record()).splitReason, "because");
  e(["release", "r1", "--clear-split-reason"]);
  assert.equal(rel(e.store.record()).splitReason, null);
  for (const [args, re] of [[["--split-reason", "a\nb"], /one line of at most 400/], [["--split-reason", "x".repeat(401)], /400/],
    [["--split-reason", "x", "--clear-split-reason"], /contradict/]]) {
    const r = e.result(["release", "r1", ...args]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, re);
  }
});

unitTest("nothing turns the report off or changes the target: no flag, verb or OPT_INS row names it", () => {
  const rows = [...EPIC_FLAGS, ...VERB_FLAGS].map(r => r.flag);
  for (const bad of ["target-share", "health-target", "no-split", "split-off", "hide-split", "band", "split", "health-share", "set-split"]) {
    assert.ok(!rows.includes(bad), bad);
  }
  assert.ok(!Object.keys(VERB_POSITIONALS).some(v => /split|health/.test(v)));
  assert.ok(!JSON.stringify(OPT_INS).match(/split|health/i));
});
