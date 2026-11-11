// scripts/test/unit/project-boards-compat.test.mjs
// project-boards 7.3 (design, Migration Plan): backward compatibility. A state file written by 0.54.0 has none of the
// keys this change adds (`mission`, `releasePlan`, `boards`, release plan fields, an epic `summary` or `whyNow`), and it
// must load unchanged: `board --json`, `release show` and `mission show` all succeed on it. That is the evidence for
// "MIGRATIONS: none (additive)". Whether an OLDER engine tolerates NEWER keys is not claimed here (design, Migration Plan).
// UNIT rung: every assertion is a value the engine produced over an in-memory record.

import assert from "node:assert/strict";
import { memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

/** The shape 0.54.0 wrote: top-level keys only the older engine knew, a release with intent/target/deferred/delivered, epics
 *  with and without a disposition, a Superpowers-style story list, and not one of the 0.55.0 keys. */
const state054 = () => ({
  version: 1, revision: 17, pmVersion: "0.54.0", active: "queued-one", detourStack: [],
  platform: "claude-code", reviewMode: "standard", syncIgnore: [],
  tracker: { system: "github-issues", direction: "inward" },
  executionProfile: { review: "standard" }, spendTracking: { enabled: false }, spendGuard: { enabled: false },
  releases: [
    { id: "0.54.0", intent: "the previous release", target: "2026-11-01", deferred: [{ epic: "later-one", reason: "not this release" }], delivered: { at: "2026-11-02T00:00:00Z", by: "agent" } },
    { id: "0.55.0", intent: "the next release", deferred: [] },
  ],
  epics: [
    { id: "queued-one", title: "A queued epic", priority: "P1", status: "queued", role: "epic", lane: "claude-code", links: [], release: "0.55.0", reconcileNeeded: false, stories: [], createdAt: "2026-10-01T00:00:00Z" },
    { id: "later-one", title: "A later epic", priority: "P2", status: "later", role: "epic", lane: "superpowers", links: [{ type: "relates-to", target: "queued-one", reason: "same area" }], reconcileNeeded: false, stories: [{ id: "s1", title: "story", done: false }] },
    { id: "done-one", title: "A delivered epic", priority: "P1", status: "archived", role: "epic", lane: "openspec", links: [], release: "0.54.0", reconcileNeeded: false, stories: [],
      disposition: { outcome: "delivered", recordedAt: "2026-11-01T00:00:00Z", reason: "shipped" }, completedAt: "2026-11-01T00:00:00Z" },
    { id: "old-archived", title: "Archived before dispositions existed", priority: "P3", status: "archived", role: "epic", lane: "claude-code", links: [], reconcileNeeded: false, stories: [] },
  ],
});

unitTest("0.54.0 state: the fixture really has none of the 0.55.0 keys", () => {
  const s = state054();
  for (const k of ["mission", "releasePlan", "boards"]) assert.equal(k in s, false, k);
  for (const e of s.epics) for (const k of ["summary", "whyNow"]) assert.equal(k in e, false, `${e.id}.${k}`);
  for (const r of s.releases) for (const k of ["theme", "rationale", "exit", "order", "size"]) assert.equal(k in r, false, `${r.id}.${k}`);
});

unitTest("0.54.0 state: `board --json` succeeds, boards read as on, and the new fields read as null", () => {
  const engine = memoryEngine(state054());
  const r = engine.result(["board", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const b = JSON.parse(r.stdout);
  assert.equal(b.schemaVersion, 1);
  assert.equal(b.boardsEnabled, true, "an absent setting reads as on");
  assert.equal(b.mission, null);
  assert.equal(b.milestone, null);
  assert.equal(b.plan.here, null);
  assert.deepEqual(b.rejected, []);
  assert.deepEqual(b.releases.map(x => x.id).sort(), ["0.54.0", "0.55.0"]);
  const e = (id) => b.epics.find(x => x.id === id);
  assert.equal(e("queued-one").summary, null);
  assert.equal(e("queued-one").whyNow, null);
  assert.equal(e("done-one").delivered, true);
  assert.equal(e("old-archived").delivered, null, "an archived epic with no disposition is never delivered");
  assert.equal(b.releases.find(x => x.id === "0.54.0").theme, null);
  assert.equal(b.releases.find(x => x.id === "0.54.0").criticalPath, null, "no milestone, so no critical path");
});

unitTest("0.54.0 state: `release show` and `mission show` succeed and write nothing", () => {
  const s = state054();
  const before = JSON.stringify(s);
  const engine = memoryEngine(s);
  for (const args of [["release", "show"], ["release", "show", "0.55.0"], ["mission", "show"], ["mission", "show", "--history"]]) {
    const r = engine.result(args);
    assert.equal(r.status, 0, `${args.join(" ")}: ${r.stderr}`);
  }
  assert.match(engine(["mission", "show"]), /no mission/i);
  assert.match(engine(["release", "show", "0.55.0"]), /0\.55\.0/);
  assert.equal(JSON.stringify(s), before, "reading a 0.54.0 record leaves it byte-identical");
});
