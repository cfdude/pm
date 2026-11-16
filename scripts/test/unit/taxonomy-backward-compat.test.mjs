// release-planning-taxonomy 8.2 (design, Migration Plan): a 0.55.0-shaped record — no `initiatives`, no new release, epic or mission key —
// loads, every read verb succeeds on it, and the load writes nothing. This is the evidence for "no MIGRATIONS entry": every new key is
// additive and absent means today's behaviour.

import assert from "node:assert/strict";
import { memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const v055 = () => ({
  version: 1, revision: 7, active: null, detourStack: [], pmVersion: "0.55.0",
  epics: [
    { id: "a", title: "A", priority: "P1", status: "queued", role: "epic", lane: "superpowers", links: [], release: "r1", number: 1, attributedCommits: [] },
    { id: "b", title: "B", priority: "P2", status: "archived", role: "epic", lane: "claude-code", links: [], release: "r1", number: 2, attributedCommits: [],
      disposition: { outcome: "delivered", recordedAt: "2026-11-01T00:00:00Z" } },
  ],
  releases: [{ id: "r1", intent: "the release", deferred: [], theme: "t", order: 1 }],
  mission: { current: { statement: "Ship it", setAt: "2026-11-01T00:00:00Z", reason: "r" }, history: [], milestoneRelease: "r1", criteria: [], nextCriterion: 1 },
  releasePlan: { here: "r1" },
});

unitTest("a 0.55.0-shaped record: every read verb succeeds and the load writes nothing", () => {
  const e = memoryEngine(v055());
  const before = JSON.stringify(e.store.record());
  const board = JSON.parse(e(["board", "--json"]));
  assert.equal(board.schemaVersion, 1);
  assert.deepEqual(board.initiatives, []);
  assert.deepEqual(board.missionNonGoals, []);
  assert.equal(board.releases[0].initiative, null);
  assert.equal(board.releases[0].maintenance, false);
  assert.equal(board.releases[0].primaryServed, null);
  assert.deepEqual(board.releases[0].split, { initiativeWork: 0, health: 1, unaligned: 1, healthShare: 0.5, target: 0.2, drift: true });
  assert.equal(board.epics[0].kind, null);
  assert.equal(board.epics.find(x => x.id === "b").effectiveKind, "health", "a claude-code epic with no kind and no initiative reads as health");
  assert.match(e(["release", "show", "r1"]), /release `r1`/);
  assert.match(e(["release", "show"]), /r1/);
  assert.match(e(["mission", "show"]), /Ship it/);
  assert.match(e(["initiative", "show"]), /^no initiatives\n$/);
  assert.match(e(["board"]), /open epics: 1/);
  assert.equal(JSON.stringify(e.store.record()), before, "no read verb wrote anything");
});

unitTest("a 0.55.0-shaped record: no integrity finding is added by the new check", () => {
  const e = memoryEngine(v055());
  const out = e.result(["integrity"]);
  assert.doesNotMatch(out.stdout + out.stderr, /dangling-initiative-reference.*[1-9]\d* finding/);
});

unitTest("an ordinary write on a 0.55.0-shaped record adds no planning key to a record that did not ask for one", () => {
  const e = memoryEngine(v055());
  e(["update-epic", "a", "--priority", "P0"]);
  const a = e.store.record().epics.find(x => x.id === "a");
  for (const k of ["initiative", "initiativeJoinedAt", "secondaryInitiatives", "kind", "offMissionReason", "offInitiativeReason", "nonGoals", "releaseJoinedAt"]) {
    assert.ok(!(k in a), `${k} stays absent`);
  }
  assert.ok(!("initiatives" in e.store.record()));
});
