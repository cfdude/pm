// release-planning-taxonomy 5.1 (spec epic-annotation): an epic's primary and secondary initiatives, kind and the two challenge
// reasons, through add-epic, update-epic and add-many. UNIT rung, through the verbs.

import assert from "node:assert/strict";
import { memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";
import { EPIC_FLAGS, nullableEpicFlags } from "../../lib/constants.mjs";

const init = (id) => ({ id, title: id, capability: "c", status: "open", outcome: null, endedAt: null, createdAt: "2026-11-01T00:00:00Z",
  history: [], milestones: [], nextMilestone: 1, nonGoals: [], nextNonGoal: 1 });
const record = (epics = [{ id: "E", title: "E", priority: "P2", status: "queued", role: "epic", lane: "superpowers", links: [] }]) =>
  ({ version: 1, revision: 1, active: null, detourStack: [], epics, initiatives: [init("boards"), init("reporting"), init("third")] });
const entry = (e, id = "E") => JSON.parse(e(["board", "--json"])).epics.find(x => x.id === id);
const stored = (e, id = "E") => e.store.record().epics.find(x => x.id === id);
const fails = (e, args, re) => {
  const before = JSON.stringify(e.store.record());
  const r = e.result(args);
  assert.notEqual(r.status, 0, args.join(" "));
  assert.match(r.stderr, re);
  assert.equal(JSON.stringify(e.store.record()), before, "a refusal writes nothing");
};

unitTest("primary and secondary initiatives are recorded and read back", () => {
  const e = memoryEngine(record());
  e(["update-epic", "E", "--initiative", "boards", "--secondary-initiative", "reporting"]);
  assert.equal(entry(e).initiative, "boards");
  assert.deepEqual(entry(e).secondaryInitiatives, ["reporting"]);
});

unitTest("a secondary is repeatable, a repeat is ignored, and one equal to the primary is refused naming it", () => {
  const e = memoryEngine(record());
  e(["update-epic", "E", "--initiative", "boards", "--secondary-initiative", "reporting", "--secondary-initiative", "third", "--secondary-initiative", "reporting"]);
  assert.deepEqual(entry(e).secondaryInitiatives, ["reporting", "third"]);
  fails(e, ["update-epic", "E", "--secondary-initiative", "boards"], /boards/);
  const f = memoryEngine(record());
  fails(f, ["update-epic", "E", "--initiative", "boards", "--secondary-initiative", "boards"], /primary/);
  fails(e, ["update-epic", "E", "--initiative", "third"], /secondary/);
});

unitTest("--remove-secondary-initiative is the inverse and leaves the primary; an absent one is refused", () => {
  const e = memoryEngine(record());
  e(["update-epic", "E", "--initiative", "boards", "--secondary-initiative", "reporting"]);
  e(["update-epic", "E", "--remove-secondary-initiative", "reporting"]);
  assert.deepEqual([entry(e).initiative, entry(e).secondaryInitiatives], ["boards", []]);
  fails(e, ["update-epic", "E", "--remove-secondary-initiative", "reporting"], /not a secondary/);
});

unitTest("every initiative-naming flag refuses an unknown id and writes nothing", () => {
  const e = memoryEngine(record());
  fails(e, ["update-epic", "E", "--initiative", "nope"], /nope/);
  fails(e, ["update-epic", "E", "--secondary-initiative", "nope"], /nope/);
  fails(e, ["add-epic", "--id", "nn", "--lane", "claude-code", "--initiative", "nope"], /nope/);
  const r = e.result(["add-many", "--from", "-"], { input: JSON.stringify({ epics: [{ id: "bb", lane: "claude-code", initiative: "nope" }] }) });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /nope/);
  assert.equal(e.store.record().epics.length, 1);
});

unitTest("initiativeJoinedAt: written when the primary changes, kept on a same-value re-set, removed by --clear initiative", async () => {
  const e = memoryEngine(record());
  e(["update-epic", "E", "--initiative", "boards"]);
  const first = stored(e).initiativeJoinedAt;
  assert.ok(Number.isFinite(Date.parse(first)));
  await new Promise(r => setTimeout(r, 5));
  e(["update-epic", "E", "--initiative", "boards"]);
  assert.equal(stored(e).initiativeJoinedAt, first);
  await new Promise(r => setTimeout(r, 5));
  e(["update-epic", "E", "--initiative", "reporting"]);
  assert.ok(Date.parse(stored(e).initiativeJoinedAt) > Date.parse(first));
  assert.equal(entry(e).initiativeJoinedAt, stored(e).initiativeJoinedAt);
  e(["update-epic", "E", "--clear", "initiative"]);
  assert.deepEqual([stored(e).initiative, stored(e).initiativeJoinedAt], [undefined, undefined]);
  assert.deepEqual([entry(e).initiative, entry(e).initiativeJoinedAt], [null, null]);
});

unitTest("--kind accepts initiative-work and health only, and --clear kind is its inverse", () => {
  const e = memoryEngine(record());
  e(["update-epic", "E", "--kind", "health"]);
  assert.equal(entry(e).kind, "health");
  fails(e, ["update-epic", "E", "--kind", "feature"], /initiative-work\|health/);
  e(["update-epic", "E", "--clear", "kind"]);
  assert.equal(entry(e).kind, null);
});

unitTest("the two reasons are one line of at most 300, recorded and cleared", () => {
  const e = memoryEngine(record());
  e(["update-epic", "E", "--off-initiative-reason", "security fix the release cannot wait for", "--off-mission-reason", "tooling"]);
  assert.equal(entry(e).offInitiativeReason, "security fix the release cannot wait for");
  assert.equal(entry(e).offMissionReason, "tooling");
  e(["update-epic", "E", "--clear", "off-initiative-reason", "--clear", "off-mission-reason"]);
  assert.deepEqual([entry(e).offInitiativeReason, entry(e).offMissionReason], [null, null]);
  fails(e, ["update-epic", "E", "--off-initiative-reason", "a\nb"], /one line/);
  fails(e, ["update-epic", "E", "--off-mission-reason", "x".repeat(301)], /300/);
  fails(e, ["update-epic", "E", "--off-initiative-reason", ""], /requires/);
});

unitTest("add-epic and add-many carry the same fields", () => {
  const e = memoryEngine(record());
  e(["add-epic", "--id", "nn", "--lane", "superpowers", "--initiative", "boards", "--secondary-initiative", "reporting", "--kind", "initiative-work",
    "--off-mission-reason", "om", "--off-initiative-reason", "oi"]);
  const n = entry(e, "nn");
  assert.deepEqual([n.initiative, n.secondaryInitiatives, n.kind, n.offMissionReason, n.offInitiativeReason], ["boards", ["reporting"], "initiative-work", "om", "oi"]);
  assert.ok(stored(e, "nn").initiativeJoinedAt);
  e(["add-many", "--from", "-"], { input: JSON.stringify({ epics: [{ id: "bb", lane: "superpowers", initiative: "boards", secondaryInitiatives: ["reporting"], kind: "health",
    offMissionReason: "m", offInitiativeReason: "i" }] }) });
  const b = entry(e, "bb");
  assert.deepEqual([b.initiative, b.secondaryInitiatives, b.kind, b.offMissionReason, b.offInitiativeReason], ["boards", ["reporting"], "health", "m", "i"]);
  assert.ok(stored(e, "bb").initiativeJoinedAt);
});

unitTest("add-many refuses a bad planning field and creates nothing", () => {
  for (const bad of [{ kind: "feature" }, { secondaryInitiatives: "reporting" }, { secondaryInitiatives: ["nope"] }, { initiative: "boards", secondaryInitiatives: ["boards"] },
    { offInitiativeReason: "a\nb" }, { offMissionReason: "x".repeat(301) }, { secondaryInitiatives: [7] }]) {
    const e = memoryEngine(record());
    const before = JSON.stringify(e.store.record());
    const r = e.result(["add-many", "--from", "-"], { input: JSON.stringify({ epics: [{ id: "bb", lane: "superpowers", ...bad }] }) });
    assert.notEqual(r.status, 0, JSON.stringify(bad));
    assert.equal(JSON.stringify(e.store.record()), before);
  }
});

unitTest("the nullable registry: every new scalar row is clearable and the clear path removes it", () => {
  const rows = nullableEpicFlags("update-epic").map(r => r.flag);
  for (const flag of ["initiative", "kind", "off-mission-reason", "off-initiative-reason"]) assert.ok(rows.includes(flag), flag);
  const settable = EPIC_FLAGS.filter(r => r.commands.includes("update-epic") && r.key && !r.valueless && !r.engineWritten && r.flag === "secondary-initiative");
  assert.ok(settable.every(r => r.setOnly), "the secondary list is cleared by its own inverse, and says so");
});
