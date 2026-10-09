// scripts/test/unit/spend-attribution.test.mjs
// token-spend-tracking-per-epic, group 3 (3.1, 3.2) — read-time attribution. UNIT rung: `attribute()`
// takes rows, markers, a timeline and a state as plain values, so nothing here names a path.

import assert from "node:assert/strict";
import { unitTest } from "../fixtures/unit-harness.mjs";
import { KNOWN_JOB_ROLES, KNOWN_SPEND_PHASES } from "../../lib/constants.mjs";
import {
  UNATTRIBUTED_REASONS, activeAt, attribute, normalizeTimeline, offIntervals, resolveMarker,
} from "../../lib/spend-attribution.mjs";

const T = (sec) => new Date(Date.UTC(2026, 9, 9, 10, 0, sec)).toISOString();
const state = (...ids) => ({ epics: ids.map((id) => ({ id })) });
const orch = (id, sec) => ({ messageId: id, actor: "orchestrator", agentId: null, at: T(sec), input: 1, cacheCreation: 0, cacheRead: 0, output: 1 });
const sub = (id, sec, agentId) => ({ messageId: id, actor: "subagent", agentId, at: T(sec), input: 1, cacheCreation: 0, cacheRead: 0, output: 1 });
const mk = (epic, role, phase, round = null) => ({ epic, role, phase, round });
const one = (row, markers, timeline, st) => attribute([row], markers, timeline, st)[0];

// ───────────────────────────── 3.1 markers ─────────────────────────────

unitTest("3.1 A marked sub-agent is attributed by its marker: epic, role, phase and round", () => {
  const r = one(sub("s1", 5, "A"), { A: mk("e1", "review", "review", "2") }, [], state("e1"));
  assert.deepEqual([r.epic, r.role, r.phase, r.round, r.attribution, r.reason], ["e1", "review", "review", 2, "marker", null]);
});

unitTest("3.1 an omitted round defaults to 1", () => {
  const r = one(sub("s1", 5, "A"), { A: mk("e1", "implement", "build") }, [], state("e1"));
  assert.equal(r.round, 1);
});

unitTest("3.1 An invalid marker is unattributed, not guessed: bad role, bad phase", () => {
  const st = state("e1");
  assert.equal(one(sub("s", 5, "A"), { A: mk("e1", "wizard", "build") }, [], st).reason, "invalid-marker");
  assert.equal(one(sub("s", 5, "A"), { A: mk("e1", "review", "nonsense") }, [], st).reason, "invalid-marker");
});

unitTest("3.1 A non-integer round is invalid: round=0, round=two, round=1.5, round=-1", () => {
  for (const bad of ["0", "two", "1.5", "-1", "01"]) {
    assert.equal(one(sub("s", 5, "A"), { A: mk("e1", "review", "review", bad) }, [], state("e1")).reason, "invalid-marker", bad);
  }
  assert.equal(one(sub("s", 5, "A"), { A: mk("e1", "review", "review", "12") }, [], state("e1")).round, 12);
});

unitTest("3.1 a marker naming an unknown epic is unattributed with reason unknown-epic", () => {
  assert.equal(one(sub("s", 5, "A"), { A: mk("nope", "review", "review") }, [], state("e1")).reason, "unknown-epic");
});

unitTest("3.1 An epic registered after its dispatch is attributed at the next report, with no re-ingest", () => {
  const row = sub("s", 5, "A");
  const markers = { A: mk("e9", "test", "build") };
  assert.equal(one(row, markers, [], state("e1")).reason, "unknown-epic");
  assert.equal(one(row, markers, [], state("e1", "e9")).epic, "e9");
});

unitTest("3.1 A row whose epic was removed reports as unknown: the input rows are not rewritten", () => {
  const rows = [sub("s", 5, "A")];
  const frozen = JSON.stringify(rows);
  const before = attribute(rows, { A: mk("e1", "review", "review") }, [], state("e1"))[0];
  const after = attribute(rows, { A: mk("e1", "review", "review") }, [], state())[0];
  assert.equal(before.epic, "e1");
  assert.deepEqual([after.epic, after.reason], [null, "unknown-epic"]);
  assert.equal(JSON.stringify(rows), frozen, "attribute() does not mutate its input");
});

unitTest("3.1 A role added to the job-role list is accepted without a ledger change", () => {
  const row = sub("s", 5, "A");
  const markers = { A: mk("e1", "plan", "plan") };
  assert.equal(attribute([row], markers, [], state("e1"))[0].reason, "invalid-marker", "plan is not a job role today");
  const extended = attribute([row], markers, [], state("e1"), { roles: [...KNOWN_JOB_ROLES, "plan"] })[0];
  assert.deepEqual([extended.epic, extended.role, extended.attribution], ["e1", "plan", "marker"]);
  assert.equal(resolveMarker(mk("e1", "plan", "plan"), { epicIds: new Set(["e1"]), roles: [...KNOWN_JOB_ROLES, "plan"] }).ok, true);
});

unitTest("3.1 the default lists are the declared constants, not a second copy", () => {
  for (const role of KNOWN_JOB_ROLES) {
    for (const phase of KNOWN_SPEND_PHASES) {
      assert.equal(resolveMarker(mk("e1", role, phase), { epicIds: new Set(["e1"]) }).ok, true, `${role}/${phase}`);
    }
  }
});

unitTest("3.1 A worktree session takes its agent's marker, keyed by the agent id the directory name gave", () => {
  const row = { ...sub("w1", 5, "X"), source: "-repo--claude-worktrees-agent-X/s.jsonl" };
  const r = one(row, { X: mk("e1", "implement", "build") }, [], state("e1"));
  assert.deepEqual([r.epic, r.attribution], ["e1", "marker"]);
});

unitTest("3.1 A worktree session is never window-attributed: no captured marker means unmarked-subagent, even inside a window", () => {
  const timeline = [{ at: T(0), active: "e1" }];
  const row = { ...sub("w1", 5, "Y"), source: "-repo--claude-worktrees-agent-Y/s.jsonl" };
  const r = one(row, {}, timeline, state("e1"));
  assert.deepEqual([r.actor, r.epic, r.reason], ["subagent", null, "unmarked-subagent"]);
});

// ───────────────────────────── 3.2 window and off-interval ─────────────────────────────

unitTest("3.2 An orchestrator row is attributed by the window: e1 from T1, e2 from T2", () => {
  const timeline = [{ at: T(10), active: "e1" }, { at: T(20), active: "e2" }];
  const st = state("e1", "e2");
  const between = one(orch("o", 15), {}, timeline, st);
  assert.deepEqual([between.epic, between.attribution, between.role, between.phase], ["e1", "window", null, null]);
  assert.equal(one(orch("o", 20), {}, timeline, st).epic, "e2", "an entry covers its own instant");
  assert.equal(one(orch("o", 99), {}, timeline, st).epic, "e2");
});

unitTest("3.2 a row before the first timeline entry is unattributed with reason before-timeline", () => {
  assert.equal(one(orch("o", 1), {}, [{ at: T(10), active: "e1" }], state("e1")).reason, "before-timeline");
  assert.equal(one(orch("o", 1), {}, [], state("e1")).reason, "before-timeline");
});

unitTest("3.2 An orchestrator row with no epic active is unattributed with reason no-active-epic", () => {
  const timeline = [{ at: T(10), active: "e1" }, { at: T(20), active: null }];
  assert.equal(one(orch("o", 25), {}, timeline, state("e1")).reason, "no-active-epic");
});

unitTest("3.2 a window pointing at an epic that no longer exists reports unknown-epic", () => {
  assert.equal(one(orch("o", 15), {}, [{ at: T(10), active: "gone" }], state("e1")).reason, "unknown-epic");
});

unitTest("3.2 An unmarked sub-agent is unattributed, even inside a window", () => {
  const r = one(sub("s", 15, "Z"), {}, [{ at: T(10), active: "e1" }], state("e1"));
  assert.deepEqual([r.epic, r.reason, r.attribution], [null, "unmarked-subagent", null]);
});

unitTest("3.2 Spend made while tracking was off is not credited to an epic: tracking-off beats a marker and a window", () => {
  const timeline = [
    { at: T(0), tracking: "on", active: "e1" },
    { at: T(10), tracking: "off" },
    { at: T(30), tracking: "on", active: "e1" },
  ];
  const markers = { A: mk("e1", "review", "review") };
  const st = state("e1");
  assert.equal(one(orch("in", 20), {}, timeline, st).reason, "tracking-off");
  assert.equal(one(sub("in2", 20, "A"), markers, timeline, st).reason, "tracking-off", "a valid marker does not rescue it");
  assert.equal(one(orch("at-off", 10), {}, timeline, st).reason, "tracking-off", "the off entry covers its own instant");
  assert.equal(one(orch("at-on", 30), {}, timeline, st).epic, "e1", "the on entry ends the interval");
  assert.equal(one(orch("before", 5), {}, timeline, st).epic, "e1");
  assert.equal(one(sub("after", 40, "A"), markers, timeline, st).epic, "e1");
});

unitTest("3.2 an off interval with no later on runs open-ended", () => {
  const timeline = [{ at: T(0), tracking: "on", active: "e1" }, { at: T(10), tracking: "off" }];
  assert.deepEqual(offIntervals(normalizeTimeline(timeline)).map((i) => [i.to === Infinity]), [[true]]);
  assert.equal(one(orch("late", 500), {}, timeline, state("e1")).reason, "tracking-off");
});

unitTest("3.2 a malformed timeline line is skipped, not trusted, and entries are read oldest first", () => {
  const timeline = [null, "x", { at: "not a date", active: "e1" }, { at: T(20), active: "e2" }, { at: T(10), active: "e1" }];
  const entries = normalizeTimeline(timeline);
  assert.equal(entries.length, 2);
  assert.deepEqual(activeAt(entries, Date.parse(T(15))), { active: "e1" });
});

unitTest("3.2 the unattributed reasons are the closed list the spec names", () => {
  assert.deepEqual([...UNATTRIBUTED_REASONS], [
    "tracking-off", "unmarked-subagent", "invalid-marker", "unknown-epic", "no-active-epic", "before-timeline",
  ]);
});

unitTest("3.2 every row is kept: attribute() returns one row per input row", () => {
  const rows = [orch("a", 1), sub("b", 2, "A"), sub("c", 3, "B"), orch("d", 4)];
  assert.equal(attribute(rows, {}, [], state()).length, 4);
});
