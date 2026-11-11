// scripts/test/unit/board-export.test.mjs
// project-boards 1.2 (spec board-export): `board --json`, the read-only snapshot the boards read.
// UNIT rung: every assertion is a VALUE the engine produced, over an in-memory record. The pure half
// (`boardSnapshot(state, resolved)`) is called directly for what the verb's disk read cannot be handed
// (an unregistered on-disk change); everything else goes through the verb.

import assert from "node:assert/strict";
import { expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";
import { boardSnapshot } from "../../lib/board.mjs";
import { orderResolved } from "../../lib/epic-progress.mjs";
import { VERB_EFFECTS } from "../../lib/verb-effects.mjs";

const epic = (id, over = {}) => ({
  id, title: `Title of ${id}`, priority: "P2", status: "queued", role: "epic", lane: "claude-code",
  stories: [], links: [], ...over,
});
const record = (epics = [], over = {}) => ({ version: 1, revision: 1, active: null, detourStack: [], epics, ...over });
const snap = (state, args = []) => JSON.parse(memoryEngine(state)(["board", "--json", ...args]));
const byId = (s, id) => s.epics.find(e => e.id === id);
const disp = (outcome, over = {}) => ({ outcome, reason: "r", recordedAt: "2026-11-01T00:00:00Z", recordedBy: "agent", ...over });
const archivedEpic = (id, over = {}) => epic(id, { status: "archived", disposition: disp("delivered"), ...over });

unitTest("board: an empty record has every top-level key, null mission/milestone/plan.here and empty lists", () => {
  const s = snap(record());
  assert.deepEqual(Object.keys(s).sort(), [
    "asOf", "boardsEnabled", "counts", "epics", "milestone", "mission", "plan", "pmVersion", "project", "rejected", "releases", "schemaVersion",
  ]);
  assert.equal(s.schemaVersion, 1);
  assert.equal(s.mission, null);
  assert.equal(s.milestone, null);
  assert.equal(s.plan.here, null);
  assert.deepEqual([s.releases, s.epics, s.rejected], [[], [], []]);
  assert.deepEqual(s.project, { name: null, key: null }, "nothing is derived: unset stays null");
  assert.equal(s.boardsEnabled, true);
  assert.ok(Number.isFinite(Date.parse(s.asOf)));
});

unitTest("board: boardsEnabled is false only when the switch is recorded off", () => {
  assert.equal(snap(record([], { boards: { enabled: false } })).boardsEnabled, false);
  assert.equal(snap(record([], { boards: { enabled: true } })).boardsEnabled, true);
});

unitTest("board: the mission, milestone and plan shapes", () => {
  const s = snap(record([], {
    releases: [{ id: "r1", intent: "i", order: 1, deferred: [] }, { id: "r2", intent: "j", order: 2, deferred: [] }],
    mission: {
      current: { statement: "Ship it", setAt: "2026-11-01T00:00:00Z", reason: "why" }, history: [],
      milestoneRelease: "r2", nextCriterion: 4,
      criteria: [
        { id: "c2", text: "two", needsHuman: true },
        { id: "c1", text: "one", check: "npm test" },
        { id: "c3", text: "gone", removedAt: "2026-11-02T00:00:00Z" },
      ],
    },
    releasePlan: { here: "r1", hereText: "now", nextText: "next" },
  }));
  assert.deepEqual(s.mission, { statement: "Ship it", setAt: "2026-11-01T00:00:00Z", reason: "why" });
  assert.deepEqual(s.milestone, { release: "r2", criteria: [
    { id: "c1", text: "one", check: "npm test", needsHuman: false },
    { id: "c2", text: "two", check: null, needsHuman: true },
  ] });
  assert.deepEqual(s.plan, { here: "r1", hereText: "now", nextText: "next" });
});

unitTest("board: open epics come in the resolveEpics() order, with position, and carry rank and both priorities", () => {
  const s = snap(record([epic("a", { priority: "P1", rank: 2 }), epic("b", { priority: "P2" }), epic("c", { priority: "P1", rank: 1 })]));
  assert.deepEqual(s.epics.map(e => [e.id, e.position]), [["c", 0], ["a", 1], ["b", 2]]);
  assert.equal(byId(s, "a").rank, 2);
  assert.equal(byId(s, "b").rank, null);
  const sorted = orderResolved([epic("a", { priority: "P1", rank: 2 }), epic("b"), epic("c", { priority: "P1", rank: 1 })]);
  assert.deepEqual(sorted.map(e => e.id), s.epics.map(e => e.id));
});

unitTest("board: a lifted blocker shows its effective and merit priorities", () => {
  const s = snap(record([
    epic("a", { priority: "P1", links: [{ type: "depends-on", epic: "b", reason: "r" }] }),
    epic("b", { priority: "P3" }),
  ]));
  assert.equal(byId(s, "b").priority, "P1");
  assert.equal(byId(s, "b").meritPriority, "P3");
});

unitTest("board: an unregistered change is counted and not listed", () => {
  const state = record([epic("a")]);
  const resolved = orderResolved([
    { ...epic("a"), lane: "claude-code" },
    { id: "ghost", title: "ghost", priority: "P?", status: "untriaged", role: "epic", links: [], lane: "openspec" },
  ]);
  const s = boardSnapshot(state, resolved);
  assert.deepEqual(s.epics.map(e => e.id), ["a"]);
  assert.equal(s.counts.unregisteredChanges, 1);
});

unitTest("board: time fields come from the record, each null when absent", () => {
  const s = snap(record([
    archivedEpic("done", { createdAt: "2026-10-01T00:00:00Z" }),
    epic("open", { touchedAt: "2026-11-01T00:00:00Z" }),
    epic("bare"),
    archivedEpic("old", { disposition: undefined, completedAt: "2026-09-01T00:00:00Z" }),
  ]));
  assert.equal(byId(s, "done").createdAt, "2026-10-01T00:00:00Z");
  assert.equal(byId(s, "done").endedAt, "2026-11-01T00:00:00Z");
  assert.equal(byId(s, "open").endedAt, null);
  assert.equal(byId(s, "open").updatedAt, "2026-11-01T00:00:00Z");
  assert.equal(byId(s, "bare").updatedAt, null);
  assert.equal(byId(s, "old").endedAt, "2026-09-01T00:00:00Z");
});

unitTest("board: every field is carried and a non-string where a string is expected reads null", () => {
  const e = byId(snap(record([epic("a", { summary: "s", whyNow: "w", description: "d", title: 7 })])), "a");
  assert.deepEqual(Object.keys(e).sort(), [
    "createdAt", "delivered", "dependsOn", "description", "endedAt", "externalUrl", "id", "key", "lane", "meritPriority", "number",
    "outcome", "outcomeReason", "position", "priority", "rank", "release", "status", "summary", "title", "updatedAt", "whyNow",
  ]);
  assert.equal(e.summary, "s");
  assert.equal(e.whyNow, "w");
  assert.equal(e.title, null);
});

unitTest("board: delivered has three states, all five cases", () => {
  const stamp = { outcome: "unknown", recordedAt: "2026-11-01T00:00:00Z", recordedBy: "archive-backfill" };
  const s = snap(record([
    archivedEpic("yes"),
    archivedEpic("no", { disposition: disp("declined", { reason: "out of scope" }) }),
    archivedEpic("stamp", { disposition: stamp }),
    archivedEpic("none", { disposition: undefined }),
    epic("open"),
  ]));
  assert.equal(byId(s, "yes").delivered, true);
  assert.equal(byId(s, "no").delivered, false);
  assert.equal(byId(s, "no").outcome, "declined");
  assert.equal(byId(s, "no").outcomeReason, "out of scope");
  assert.equal(byId(s, "stamp").outcome, "unknown");
  assert.equal(byId(s, "stamp").delivered, null);
  assert.equal(byId(s, "none").outcome, null);
  assert.equal(byId(s, "none").delivered, null);
  assert.equal(byId(s, "open").delivered, false);
});

unitTest("board: an engine stamp carrying delivered reads true", () => {
  const stamp = { outcome: "delivered", recordedAt: "2026-11-01T00:00:00Z", recordedBy: "archive-backfill" };
  assert.equal(byId(snap(record([archivedEpic("m", { disposition: stamp })])), "m").delivered, true);
});

const sixty = () => Array.from({ length: 60 }, (_, i) =>
  archivedEpic(`z${String(i).padStart(2, "0")}`, { disposition: disp("delivered", { recordedAt: `2026-10-${String(1 + (i % 28)).padStart(2, "0")}T00:00:${String(i).padStart(2, "0")}Z` }) }));

unitTest("board: the ended-epic window defaults to 50, most recently ended first, after the open epics", () => {
  const s = snap(record([...sixty(), epic("open")]));
  assert.equal(s.epics.filter(e => e.status === "archived").length, 50);
  assert.equal(s.epics[0].id, "open");
  const times = s.epics.slice(1).map(e => Date.parse(e.endedAt));
  assert.deepEqual(times, [...times].sort((a, b) => b - a));
  assert.equal(s.counts.delivered, 60, "counts cover the whole record, not the window");
});

unitTest("board: epics that ended with no time come last, ordered by id", () => {
  const s = snap(record([
    archivedEpic("b", { disposition: undefined }), archivedEpic("a", { disposition: undefined }), archivedEpic("t"),
  ]));
  assert.deepEqual(s.epics.map(e => e.id), ["t", "a", "b"]);
});

unitTest("board: --archived <n> sets the window and --archived all includes everything", () => {
  assert.equal(snap(record(sixty()), ["--archived", "3"]).epics.length, 3);
  assert.equal(snap(record(sixty()), ["--archived", "all"]).epics.length, 60);
});

unitTest("board: a bad --archived bound is refused, names the accepted values and prints no JSON", () => {
  for (const bad of ["0", "-2", "1.5", "banana"]) {
    const r = memoryEngine(record()).result(["board", "--json", "--archived", bad]);
    assert.notEqual(r.status, 0, bad);
    assert.match(r.stderr, /a positive integer or all/);
    assert.equal(r.stdout, "");
  }
});

unitTest("board: dependsOn resolves depends-on links only, in order and without duplicates", () => {
  const s = snap(record([
    epic("a", { links: [
      { type: "depends-on", epic: "b", reason: "r" }, { type: "relates-to", epic: "c", reason: "r" },
      { type: "depends-on", epic: "b", reason: "again" },
    ] }),
    epic("b"), epic("c"),
  ]));
  assert.deepEqual(byId(s, "a").dependsOn, ["b"]);
  assert.deepEqual(s.rejected, []);
});

unitTest("board: a dangling depends-on target is left out and reported", () => {
  const s = snap(record([epic("a", { links: [{ type: "depends-on", epic: "gone", reason: "r" }] })]));
  assert.deepEqual(byId(s, "a").dependsOn, []);
  assert.deepEqual(s.rejected, [{ kind: "link", id: "a", field: "dependsOn", value: "gone", reason: "dangling depends-on" }]);
});

unitTest("board: a malformed epic id is excluded and named, and the exit code is 0", () => {
  const bad = 'a"><img src=x>';
  const r = memoryEngine(record([epic("ok"), epic(bad)])).result(["board", "--json"]);
  assert.equal(r.status, 0);
  const s = JSON.parse(r.stdout);
  assert.deepEqual(s.epics.map(e => e.id), ["ok"]);
  assert.deepEqual(s.rejected, [{ kind: "epic", id: bad, field: "id", value: bad, reason: "id format" }]);
});

unitTest("board: a malformed reference is nulled and named, for the epic's release and plan.here alike", () => {
  const bad = 'r1"><b>';
  const s = snap(record([epic("ok", { release: bad })], { releasePlan: { here: bad } }));
  assert.equal(byId(s, "ok").release, null);
  assert.equal(s.plan.here, null);
  assert.deepEqual(s.rejected.map(x => [x.kind, x.field, x.reason]).sort(), [
    ["epic", "release", "id format"], ["plan", "plan.here", "id format"],
  ]);
});

unitTest("board: a malformed release member and a malformed dependsOn target leave their lists", () => {
  const bad = "x y";
  const s = snap(record([epic("ok", { release: "r1", links: [{ type: "depends-on", epic: bad, reason: "r" }] }), epic(bad, { release: "r1" })],
    { releases: [{ id: "r1", intent: "i", deferred: [] }] }));
  assert.deepEqual(s.releases[0].members, ["ok"]);
  assert.deepEqual(byId(s, "ok").dependsOn, []);
  assert.ok(s.rejected.some(x => x.kind === "release" && x.field === "members" && x.value === bad));
  assert.ok(s.rejected.some(x => x.kind === "link" && x.field === "dependsOn" && x.reason === "id format"));
});

unitTest("board: id format wins over a stale plan.here, which yields exactly one entry", () => {
  const s = snap(record([], { releasePlan: { here: "bad id" } }));
  assert.deepEqual(s.rejected.map(x => [x.field, x.reason]), [["plan.here", "id format"]]);
});

unitTest("board: a plan.here naming no release, and a milestone naming no release, are reported and nulled", () => {
  const s = snap(record([], { releasePlan: { here: "gone" }, mission: { milestoneRelease: "gone2", criteria: [] } }));
  assert.equal(s.plan.here, null);
  assert.equal(s.milestone, null);
  assert.deepEqual(s.rejected.map(x => [x.kind, x.field, x.reason]).sort(), [
    ["milestone", "milestone.release", "milestone names no release"], ["plan", "plan.here", "here names no release"],
  ]);
});

unitTest("board: externalUrl is emitted only for http and https, else null and reported", () => {
  const s = snap(record([
    epic("js", { externalUrl: "javascript:alert(1)" }), epic("ok", { externalUrl: "https://github.com/o/r/issues/1" }),
    epic("rel", { externalUrl: "/just/a/path" }), epic("data", { externalUrl: "data:text/html,x" }), epic("none"),
  ]));
  assert.equal(byId(s, "js").externalUrl, null);
  assert.equal(byId(s, "ok").externalUrl, "https://github.com/o/r/issues/1");
  assert.equal(byId(s, "rel").externalUrl, null);
  assert.equal(byId(s, "none").externalUrl, null);
  assert.deepEqual(s.rejected.find(x => x.id === "js"),
    { kind: "url", id: "js", field: "externalUrl", value: "javascript:alert(1)", reason: "url scheme" });
  assert.equal(s.rejected.filter(x => x.reason === "url scheme").length, 3);
});

unitTest("board: control characters in a rejected value are escaped", () => {
  const s = snap(record([epic("a", { externalUrl: "javascript:x\nforged" })]));
  assert.equal(s.rejected[0].value, "javascript:x\\u000aforged");
});

unitTest("board: releases are listed in plan order with their plan fields, absent fields null", () => {
  const s = snap(record([epic("m", { release: "r2" })], { releases: [
    { id: "r2", intent: "two", order: 2, theme: "t", rationale: "why", exit: "e", size: "minor", deferred: [{ epic: "m", reason: "cut" }] },
    { id: "r1", intent: "one", order: 1, deferred: [] },
    { id: "rx", deferred: [] },
  ] }));
  assert.deepEqual(s.releases.map(r => r.id), ["r1", "r2", "rx"]);
  assert.deepEqual(s.releases[1], {
    id: "r2", intent: "two", target: null, theme: "t", rationale: "why", exit: "e", order: 2, size: "minor",
    status: "planned", delivered: false, criticalPath: null, progress: { done: 0, total: 1 }, members: ["m"],
    deferred: [{ epic: "m", reason: "cut" }],
  });
  assert.equal(s.releases[2].intent, null);
});

unitTest("board: release status is derived, never read from the record", () => {
  const rel = (over = {}) => ({ id: "r1", intent: "i", deferred: [], ...over });
  const status = (epics, r) => snap(record(epics, { releases: [r] })).releases[0].status;
  assert.equal(status([epic("a", { release: "r1" })], rel({ delivered: { recordedAt: "2026-11-01T00:00:00Z" } })), "shipped");
  assert.equal(status([epic("a", { release: "r1", status: "active" })], rel()), "in-progress");
  assert.equal(status([archivedEpic("a", { release: "r1" })], rel()), "in-progress");
  assert.equal(status([], rel()), "planned");
  assert.equal(status([epic("a", { release: "r1" })], rel({ status: "shipped" })), "planned");
});

unitTest("board: critical path follows order from the milestone", () => {
  const releases = [{ id: "r3", order: 3, deferred: [] }, { id: "r1", order: 1, deferred: [] }, { id: "r2", order: 2, deferred: [] }];
  const withMilestone = snap(record([], { releases, mission: { milestoneRelease: "r2", criteria: [] } }));
  assert.deepEqual(withMilestone.releases.map(r => [r.id, r.criticalPath]), [["r1", true], ["r2", true], ["r3", false]]);
  const without = snap(record([], { releases }));
  assert.deepEqual(without.releases.map(r => r.criticalPath), [null, null, null]);
});

unitTest("board: counts partition the archived epics and the open ones", () => {
  const s = snap(record([
    archivedEpic("d1"), archivedEpic("d2"), archivedEpic("d3"),
    archivedEpic("n1", { disposition: disp("declined") }), archivedEpic("n2", { disposition: disp("killed") }),
    archivedEpic("u1", { disposition: { outcome: "unknown", recordedAt: "2026-11-01T00:00:00Z", recordedBy: "archive-backfill" } }),
    archivedEpic("u2", { disposition: undefined }),
    epic("o1", { priority: "P1", release: "r1" }), epic("o2", { priority: "P?" }), epic("o3", { priority: "P1" }),
  ], { releases: [{ id: "r1", intent: "i", deferred: [] }] }));
  assert.equal(s.counts.delivered, 3);
  assert.equal(s.counts.notPursued, 2);
  assert.equal(s.counts.unknownOutcome, 2);
  assert.equal(s.counts.open, 3);
  assert.equal(s.counts.unassigned, 2);
  assert.deepEqual(s.counts.byPriority, { P0: 0, P1: 2, P2: 0, P3: 0, "P?": 1 });
});

unitTest("board: plain board prints the open count, the here release (or none) and the mission (or no mission)", () => {
  const plain = memoryEngine(record([epic("a")]))(["board"]);
  assert.match(plain, /open epics: 1/);
  assert.match(plain, /here: none/);
  assert.match(plain, /mission: no mission/);
  const set = memoryEngine(record([], {
    releases: [{ id: "r1", deferred: [] }], releasePlan: { here: "r1" }, mission: { current: { statement: "Ship it", setAt: "t", reason: "r" } },
  }))(["board"]);
  assert.match(set, /here: r1/);
  assert.match(set, /mission: Ship it/);
});

unitTest("board: the verb is declared read-only with an exercise list", () => {
  assert.equal(VERB_EFFECTS.board.effect, "read-only");
  assert.deepEqual(VERB_EFFECTS.board.exercise, ["--json"]);
});

unitTest("board: an unknown flag is refused", () => {
  expectFail(() => memoryEngine(record())(["board", "--json", "--nonsense", "1"]));
});

// ─────────── project-boards 8.4: project, number, key, progress ───────────

unitTest("project: name and key are emitted as recorded, null while unset, and nothing is derived", () => {
  assert.deepEqual(snap(record([], { projectName: "Project Manager", projectKey: "PM" })).project, { name: "Project Manager", key: "PM" });
  assert.deepEqual(snap(record([], { projectKey: "PM" })).project, { name: null, key: "PM" });
  assert.deepEqual(snap(record([epic("pm-thing")])).project, { name: null, key: null }, "an id or a directory name is not a project name");
});

unitTest("project: an invalid stored name or key is nulled and named with the closed reason `project format`", () => {
  const s = snap(record([epic("a", { number: 3 })], { projectKey: "pm<x", projectName: "x".repeat(61) }));
  assert.deepEqual(s.project, { name: null, key: null });
  assert.deepEqual(s.rejected.map(x => [x.kind, x.id, x.field, x.reason]).sort(), [
    ["project", null, "projectKey", "project format"], ["project", null, "projectName", "project format"],
  ]);
  assert.equal(byId(s, "a").key, null, "an invalid key is never joined to a number");
  const t = snap(record([], { projectName: "a\nb", projectKey: "A" }));
  assert.equal(t.project.name, null);
  assert.equal(t.project.key, null);
  assert.equal(snap(record([], { projectName: "a<b" })).project.name, null);
});

unitTest("epic number and key: number as recorded, key = projectKey-number, both null while missing", () => {
  const s = snap(record([epic("a", { number: 256 }), epic("b"), epic("c", { number: 0 }), epic("d", { number: 1.5 }), epic("e", { number: "7" })], { projectKey: "PM" }));
  assert.deepEqual([byId(s, "a").number, byId(s, "a").key], [256, "PM-256"]);
  for (const id of ["b", "c", "d", "e"]) assert.deepEqual([byId(s, id).number, byId(s, id).key], [null, null], id);
  const unset = snap(record([epic("a", { number: 256 })]));
  assert.deepEqual([byId(unset, "a").number, byId(unset, "a").key], [256, null], "no project key, no displayed key");
});

unitTest("epic key: changing the project key renames every key and rewrites no epic", () => {
  const engine = memoryEngine(record([epic("a", { number: 256 })], { projectKey: "PM" }));
  assert.equal(byId(JSON.parse(engine(["board", "--json"])), "a").key, "PM-256");
  const before = JSON.stringify(engine.store.record().epics);
  engine(["set-project", "--key", "PX"]);
  assert.equal(byId(JSON.parse(engine(["board", "--json"])), "a").key, "PX-256");
  assert.equal(JSON.stringify(engine.store.record().epics), before);
});

unitTest("release progress: delivered over every non-declined member, from the same values the epic rows carry", () => {
  const s = snap(record([
    archivedEpic("d1", { release: "r1" }), archivedEpic("d2", { release: "r1" }),
    epic("open", { release: "r1" }),
    archivedEpic("no", { release: "r1", disposition: disp("declined") }),
    archivedEpic("killed", { release: "r1", disposition: disp("killed") }),
  ], { releases: [{ id: "r1", intent: "i", deferred: [] }, { id: "r2", intent: "empty", deferred: [] }] }));
  assert.deepEqual(s.releases.find(r => r.id === "r1").progress, { done: 2, total: 4 });
  assert.deepEqual(s.releases.find(r => r.id === "r2").progress, { done: 0, total: 0 });
  const done = s.epics.filter(e => e.release === "r1" && e.delivered === true).length;
  assert.equal(done, s.releases.find(r => r.id === "r1").progress.done, "progress cannot disagree with the epic rows");
});

unitTest("release progress: members outside the ended-epic window still count", () => {
  const epics = ["a", "b", "c"].map((id, i) => archivedEpic(id, { release: "r1", disposition: disp("delivered", { recordedAt: `2026-10-0${i + 1}T00:00:00Z` }) }));
  const s = snap(record(epics, { releases: [{ id: "r1", intent: "i", deferred: [] }] }), ["--archived", "1"]);
  assert.equal(s.epics.length, 1);
  assert.deepEqual(s.releases[0].progress, { done: 3, total: 3 });
});

unitTest("release progress: an ended epic with an unknown outcome is in the total and not in done", () => {
  const s = snap(record([archivedEpic("u", { release: "r1", disposition: { outcome: "unknown", reason: "r", recordedAt: "2026-11-01T00:00:00Z", recordedBy: "engine:archive-backfill" } })],
    { releases: [{ id: "r1", intent: "i", deferred: [] }] }));
  assert.deepEqual(s.releases[0].progress, { done: 0, total: 1 });
});

unitTest("board: schemaVersion stays 1 — the project, number, key and progress keys are additive", () => {
  assert.equal(snap(record()).schemaVersion, 1);
});
