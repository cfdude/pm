// release-planning-taxonomy 5.2 and 5.3 (spec epic-annotation): the challenge warning on leaving `untriaged`, and the member warning.
// UNIT rung, through the verbs, reading stderr.

import assert from "node:assert/strict";
import { memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";
import { planningWarning } from "../../lib/epic-summary.mjs";

const init = (id, status = "open") => ({ id, title: id, capability: "c", status, outcome: null, endedAt: null, createdAt: "2026-11-01T00:00:00Z",
  history: [], milestones: [], nextMilestone: 1, nonGoals: [], nextNonGoal: 1 });
const epic = (id, over = {}) => ({ id, title: id, priority: "P2", status: "untriaged", role: "epic", lane: "superpowers", links: [], ...over });
const record = (epics, over = {}) => ({ version: 1, revision: 1, active: null, detourStack: [], epics, initiatives: [init("boards"), init("reporting")], ...over });
const warns = (e, args) => { const r = e.result(args); assert.equal(r.status, 0, r.stderr); return r.stderr; };

unitTest("leaving untriaged with nothing recorded warns once, naming --kind and --initiative; exit 0 and the write lands", () => {
  const e = memoryEngine(record([epic("E")]));
  const r = e.result(["update-epic", "E", "--status", "queued"]);
  assert.equal(r.status, 0);
  assert.match(r.stderr, /--kind/);
  assert.match(r.stderr, /--initiative/);
  assert.match(r.stderr, /a warning only/);
  assert.equal(e.store.record().epics[0].status, "queued");
  assert.equal(warns(e, ["update-epic", "E", "--priority", "P1"]).includes("--kind"), false, "an unchanged status does not warn again");
});

unitTest("a decline never warns: untriaged to archived", () => {
  const e = memoryEngine(record([epic("E")]));
  const err = warns(e, ["update-epic", "E", "--status", "archived", "--outcome", "declined", "--reason", "no", "--no-deferrals"]);
  assert.doesNotMatch(err, /--kind|--initiative/);
});

unitTest("a recorded off-initiative reason silences it, as do kind health, a full set, the claude-code lane and no open initiative", () => {
  const quiet = (over, state) => {
    const e = memoryEngine(state || record([epic("E", over)]));
    return !/--kind|--initiative|--off-initiative-reason/.test(warns(e, ["update-epic", "E", "--status", "queued"]));
  };
  assert.equal(quiet({ kind: "initiative-work", offInitiativeReason: "security" }), true);
  assert.equal(quiet({ offInitiativeReason: "security" }), true, "a reason alone answers the challenge");
  assert.equal(quiet({ kind: "health" }), true);
  assert.equal(quiet({ kind: "initiative-work", initiative: "boards" }), true);
  assert.equal(quiet({ lane: "claude-code" }), true);
  assert.equal(quiet({}, record([epic("E")], { initiatives: [init("boards", "ended")] })), true, "no initiative is open");
  assert.equal(quiet({}, record([epic("E")], { initiatives: [] })), true);
});

unitTest("what it names depends on what is missing", () => {
  const e = memoryEngine(record([epic("A", { kind: "initiative-work" }), epic("B", { initiative: "boards" })]));
  const a = warns(e, ["update-epic", "A", "--status", "queued"]);
  assert.doesNotMatch(a, /--kind/);
  assert.match(a, /--initiative/);
  const b = warns(e, ["update-epic", "B", "--status", "queued"]);
  assert.match(b, /--kind/);
  assert.doesNotMatch(b, /--initiative <id>/, "it already has one");
});

unitTest("registration into a live status warns through add-epic and add-many; an untriaged registration does not", () => {
  const e = memoryEngine(record([]));
  assert.match(warns(e, ["add-epic", "--id", "nn", "--lane", "superpowers", "--status", "queued"]), /--kind/);
  assert.doesNotMatch(warns(e, ["add-epic", "--id", "uu", "--lane", "superpowers", "--status", "untriaged"]), /--kind/);
  const many = e.result(["add-many", "--from", "-"], { input: JSON.stringify({ epics: [{ id: "bb", lane: "superpowers" }] }) });
  assert.match(many.stderr, /--kind/);
});

unitTest("the pure planningWarning: only on the transition, never for archive, never for claude-code", () => {
  const state = record([]);
  assert.equal(planningWarning(epic("E", { status: "queued" }), "untriaged", state).includes("--kind"), true);
  assert.equal(planningWarning(epic("E", { status: "queued" }), "queued", state), null);
  assert.equal(planningWarning(epic("E", { status: "archived" }), "untriaged", state), null);
  assert.equal(planningWarning(epic("E", { status: "queued", lane: "claude-code" }), "untriaged", state), null);
  assert.equal(planningWarning(epic("E", { status: "queued" }), "untriaged", undefined), null, "no record to consult: nothing to warn about");
});

unitTest("every sink that warns about a missing summary passes the record, so the planning warning reaches it", () => {
  const e = memoryEngine(record([epic("E")]));
  const r = e.result(["set-active", "E"]);
  assert.equal(r.status, 0);
  assert.match(r.stderr, /--kind/);
});

unitTest("release --member warns for an epic not serving the release's primary, still writes, and never for maintenance or no primary", () => {
  const base = () => record([epic("E", { status: "queued", kind: "initiative-work", initiative: "reporting" })],
    { releases: [{ id: "r1", intent: "i", deferred: [], initiative: "boards" }, { id: "m1", intent: "m", deferred: [], maintenance: true }, { id: "n1", intent: "n", deferred: [] }] });
  const e = memoryEngine(base());
  const err = warns(e, ["release", "r1", "--member", "E"]);
  assert.match(err, /boards/);
  assert.match(err, /--off-initiative-reason/);
  assert.equal(e.store.record().epics[0].release, "r1");
  assert.doesNotMatch(warns(memoryEngine(base()), ["release", "m1", "--member", "E"]), /--off-initiative-reason/);
  assert.doesNotMatch(warns(memoryEngine(base()), ["release", "n1", "--member", "E"]), /--off-initiative-reason/);
});

unitTest("the member warning is silent for health, claude-code, a recorded reason, and an epic serving the primary", () => {
  for (const over of [{ kind: "health" }, { lane: "claude-code" }, { offInitiativeReason: "security" }, { initiative: "boards" }, { secondaryInitiatives: ["boards"], initiative: "reporting" }]) {
    const e = memoryEngine(record([epic("E", { status: "queued", ...over })], { releases: [{ id: "r1", intent: "i", deferred: [], initiative: "boards" }] }));
    assert.doesNotMatch(warns(e, ["release", "r1", "--member", "E"]), /--off-initiative-reason/, JSON.stringify(over));
  }
});
