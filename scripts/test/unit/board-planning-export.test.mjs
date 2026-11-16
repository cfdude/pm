// release-planning-taxonomy 1.1 (specs initiative-record, non-goals, release-planning, epic-annotation, board-export):
// `board --json` reads the new planning fields. UNIT rung: every assertion is a VALUE over an in-memory record.

import assert from "node:assert/strict";
import { memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const epic = (id, over = {}) => ({
  id, title: `Title of ${id}`, priority: "P2", status: "queued", role: "epic", lane: "superpowers",
  stories: [], links: [], ...over,
});
const record = (epics = [], over = {}) => ({ version: 1, revision: 1, active: null, detourStack: [], epics, ...over });
const snap = (state) => JSON.parse(memoryEngine(state)(["board", "--json"]));
const byId = (s, id) => s.epics.find(e => e.id === id);
const rel = (s, id) => s.releases.find(r => r.id === id);
const initiative = (id, over = {}) => ({
  id, title: `Initiative ${id}`, capability: `Capability of ${id}`, status: "open", outcome: null, endedAt: null,
  createdAt: "2026-11-01T00:00:00Z", history: [], milestones: [], nextMilestone: 1, nonGoals: [], nextNonGoal: 1, ...over,
});

unitTest("board export: an empty record reads initiatives and missionNonGoals as []", () => {
  const s = snap(record());
  assert.deepEqual(s.initiatives, []);
  assert.deepEqual(s.missionNonGoals, []);
  assert.equal(s.schemaVersion, 1);
});

unitTest("board export: a release with nothing recorded carries every new key at its zero value", () => {
  const s = snap(record([], { releases: [{ id: "r1", intent: "i", deferred: [] }] }));
  const r = rel(s, "r1");
  assert.equal(r.initiative, null);
  assert.equal(r.maintenance, false);
  assert.equal(r.splitReason, null);
  assert.equal(r.primaryServed, null);
  assert.equal(r.planningBaseline, null);
  assert.equal(r.addedSincePlanning, null);
  assert.equal(r.unknownJoinTime, null);
  assert.deepEqual(r.nonGoals, []);
  assert.deepEqual(r.split, { initiativeWork: 0, health: 0, unaligned: 0, healthShare: null, target: 0.2, drift: null });
});

unitTest("board export: an epic with none of the planning fields reads them all null or []", () => {
  const e = byId(snap(record([epic("a")])), "a");
  assert.equal(e.initiative, null);
  assert.equal(e.initiativeJoinedAt, null);
  assert.deepEqual(e.secondaryInitiatives, []);
  assert.equal(e.kind, null);
  assert.equal(e.effectiveKind, null);
  assert.equal(e.releaseJoinedAt, null);
  assert.equal(e.offMissionReason, null);
  assert.equal(e.offInitiativeReason, null);
  assert.deepEqual(e.nonGoals, []);
});

unitTest("board export: a populated record reads every field back", () => {
  const s = snap(record([
    epic("a", {
      initiative: "boards", initiativeJoinedAt: "2026-11-02T00:00:00Z", secondaryInitiatives: ["reporting"], kind: "initiative-work",
      release: "r1", releaseJoinedAt: "2026-11-03T00:00:00Z", offMissionReason: "om", offInitiativeReason: "oi",
      nonGoals: [{ id: "n1", text: "No CSV", addedAt: "2026-11-01T00:00:00Z" }],
    }),
    epic("b", { release: "r1", kind: "health", startedAt: "2026-11-01T00:00:00Z" }),
  ], {
    releases: [{ id: "r1", intent: "i", deferred: [], initiative: "boards", splitReason: "migration", nonGoals: [{ id: "n1", text: "No SSO", addedAt: "t" }] }],
    initiatives: [
      initiative("boards", {
        source: "docs/plan.md", offMissionReason: "kept",
        milestones: [{ id: "m1", text: "Live", addedAt: "t", reachedAt: "2026-11-05T00:00:00Z", evidence: "26 repos", history: [] }],
        nonGoals: [{ id: "n1", text: "No hosted service", addedAt: "t" }],
      }),
      initiative("reporting"),
    ],
    mission: { current: { statement: "S", setAt: "t", reason: "r" }, history: [], criteria: [], nextCriterion: 1,
      nonGoals: [{ id: "n1", text: "No Jira sync", addedAt: "t" }], nextNonGoal: 2 },
  }));
  assert.deepEqual(s.missionNonGoals, [{ id: "n1", text: "No Jira sync" }]);
  assert.deepEqual(s.initiatives.map(i => i.id), ["boards", "reporting"]);
  const b = s.initiatives[0];
  assert.deepEqual(b, {
    id: "boards", title: "Initiative boards", capability: "Capability of boards", status: "open", outcome: null, endedAt: null,
    source: "docs/plan.md", offMissionReason: "kept", nonGoals: [{ id: "n1", text: "No hosted service" }],
    milestones: [{ id: "m1", text: "Live", reachedAt: "2026-11-05T00:00:00Z", evidence: "26 repos" }],
  });
  const a = byId(s, "a");
  assert.equal(a.initiative, "boards");
  assert.equal(a.initiativeJoinedAt, "2026-11-02T00:00:00Z");
  assert.deepEqual(a.secondaryInitiatives, ["reporting"]);
  assert.equal(a.kind, "initiative-work");
  assert.equal(a.effectiveKind, "initiative-work");
  assert.equal(a.releaseJoinedAt, "2026-11-03T00:00:00Z");
  assert.equal(a.offMissionReason, "om");
  assert.deepEqual(a.nonGoals, [{ id: "n1", text: "No CSV" }]);
  const r = rel(s, "r1");
  assert.equal(r.initiative, "boards");
  assert.equal(r.splitReason, "migration");
  assert.deepEqual(r.nonGoals, [{ id: "n1", text: "No SSO" }]);
  assert.equal(r.primaryServed, true);
  assert.equal(r.planningBaseline, "2026-11-01T00:00:00Z");
  assert.equal(r.addedSincePlanning, 1);
  assert.equal(r.unknownJoinTime, 1);
  assert.deepEqual(r.split, { initiativeWork: 1, health: 1, unaligned: 0, healthShare: 0.5, target: 0.2, drift: true });
});

unitTest("board export: an ended initiative reports its outcome and endedAt", () => {
  const s = snap(record([], { initiatives: [initiative("x", { status: "ended", outcome: "delivered", endedAt: "2026-11-09T00:00:00Z" })] }));
  assert.deepEqual([s.initiatives[0].status, s.initiatives[0].outcome, s.initiatives[0].endedAt], ["ended", "delivered", "2026-11-09T00:00:00Z"]);
});

unitTest("board export: removed initiative milestones and non-goals are absent", () => {
  const s = snap(record([epic("a", { nonGoals: [{ id: "n1", text: "gone", removedAt: "t", removeReason: "r" }, { id: "n2", text: "kept" }] })], {
    initiatives: [initiative("boards", {
      milestones: [{ id: "m1", text: "old", removedAt: "t", removeReason: "r" }, { id: "m2", text: "new" }],
      nonGoals: [{ id: "n1", text: "x", removedAt: "t", removeReason: "r" }],
    })],
    mission: { nonGoals: [{ id: "n1", text: "x", removedAt: "t", removeReason: "r" }] },
  }));
  assert.deepEqual(s.initiatives[0].milestones.map(m => m.id), ["m2"]);
  assert.deepEqual(s.initiatives[0].nonGoals, []);
  assert.deepEqual(byId(s, "a").nonGoals, [{ id: "n2", text: "kept" }]);
  assert.deepEqual(s.missionNonGoals, []);
});

unitTest("board export: a malformed initiative id is omitted and rejected with the format reason", () => {
  const s = snap(record([epic("a", { initiative: "Bad Id" })], { initiatives: [initiative("Bad Id"), initiative("ok")] }));
  assert.deepEqual(s.initiatives.map(i => i.id), ["ok"]);
  assert.equal(byId(s, "a").initiative, null);
  const kinds = s.rejected.map(r => [r.kind, r.reason]);
  assert.ok(kinds.some(([k, r]) => k === "initiative" && r === "id format"));
  assert.ok(s.rejected.every(r => Object.keys(r).sort().join() === "field,id,kind,reason,value"));
});

unitTest("board export: a reference naming no initiative reads null and a secondary leaves its list", () => {
  const s = snap(record([epic("a", { initiative: "gone", secondaryInitiatives: ["gone", "ok"], release: "r1" })], {
    releases: [{ id: "r1", intent: "i", deferred: [], initiative: "gone" }], initiatives: [initiative("ok")],
  }));
  assert.equal(byId(s, "a").initiative, null);
  assert.deepEqual(byId(s, "a").secondaryInitiatives, ["ok"]);
  assert.equal(rel(s, "r1").initiative, null);
  assert.deepEqual(s.rejected, [], "a dangling reference is integrity's report, not a rejected entry");
});

unitTest("board export: the claude-code effective kind defaults from the initiative, and a recorded kind wins", () => {
  const s = snap(record([
    epic("c1", { lane: "claude-code", initiative: "boards" }),
    epic("c2", { lane: "claude-code" }),
    epic("c3", { lane: "claude-code", kind: "health", initiative: "boards" }),
    epic("o1", { initiative: "boards" }),
    epic("o2", { kind: "initiative-work" }),
  ], { initiatives: [initiative("boards")] }));
  assert.deepEqual(["c1", "c2", "c3", "o1", "o2"].map(id => byId(s, id).effectiveKind), ["initiative-work", "health", "health", null, "initiative-work"]);
  assert.deepEqual(["c1", "c2", "c3", "o1", "o2"].map(id => byId(s, id).kind), [null, null, "health", null, "initiative-work"]);
});
