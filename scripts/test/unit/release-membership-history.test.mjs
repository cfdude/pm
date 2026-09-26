// scripts/test/unit/release-membership-history.test.mjs
// release-member-moves-silently (0.43.0 review A1, A2) — a release's recorded judgments never
// vanish silently.
//
// Two defects, one mechanism. `release r2 --member e1` MOVED e1 out of r1 and left r1 with no
// record that it had ever held it: `release show r1` read "members (0)", no amendment, nothing on
// stderr. And re-running `--defer` with a new reason overwrote the old one with no history. Both
// now append to the release's existing `amendments[]` trail — the one history a release has — so
// `release show` renders them with the renderer it already had.
//
// UNIT RUNG: every observable is a value — the record, or text the verb printed.

import assert from "node:assert/strict";
import { emptyRecord, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const repo = (n = 2) => {
  const engine = memoryEngine(emptyRecord());
  for (let i = 0; i < n; i++) engine(["add-epic", "--id", `e${i}`, "--title", `t${i}`, "--lane", "claude-code"]);
  return engine;
};
const rec = (engine) => engine.store.record();
const bytes = (engine) => engine.store.read("state.json").text;
const rel = (engine, id) => rec(engine).releases.find(r => r.id === id);
const strip = (a) => { const { at, ...rest } = a; assert.match(at, /^\d{4}-\d{2}-\d{2}T/); return rest; };

// ─────────────────── decision (a): a move is recorded on the release it leaves ───────────────────

unitTest("a cross-release --member records an unmember amendment on the OLD release, naming where it went", () => {
  const engine = repo();
  engine(["release", "r1", "--intent", "one", "--member", "e0"]);
  engine(["release", "r2", "--intent", "two"]);
  engine(["release", "r2", "--member", "e0"]);
  assert.equal(rec(engine).epics.find(e => e.id === "e0").release, "r2", "the move itself still happens");
  assert.deepEqual((rel(engine, "r1").amendments || []).map(strip),
    [{ op: "unmember", epic: "e0", via: "member", to: "r2" }]);
  assert.equal(rel(engine, "r2").amendments, undefined, "nothing is invented on the release it joined");
});

unitTest("a cross-release --member says so on stderr, naming both releases", () => {
  const engine = repo();
  engine(["release", "r1", "--intent", "one", "--member", "e0"]);
  engine(["release", "r2", "--intent", "two"]);
  const out = engine.combined(["release", "r2", "--member", "e0"]);
  assert.match(out, /'e0'.*'r1'.*'r2'/s);
});

unitTest("`release show` of the old release renders the move, not \"no reason given\"", () => {
  const engine = repo();
  engine(["release", "r1", "--intent", "one", "--member", "e0"]);
  engine(["release", "r2", "--intent", "two", "--member", "e0"]);
  const out = engine(["release", "show", "r1"]);
  assert.match(out, /amendments \(1\)/);
  assert.match(out, /unmember `e0` \(via --member\) — moved to `r2`/);
  assert.doesNotMatch(out, /no reason given/);
});

unitTest("re-membering into the SAME release writes nothing", () => {
  const engine = repo();
  engine(["release", "r1", "--intent", "one", "--member", "e0"]);
  const before = bytes(engine);
  const out = engine.combined(["release", "r1", "--member", "e0"]);
  assert.equal(bytes(engine), before);
  assert.doesNotMatch(out, /moved|no longer/);
});

unitTest("a pointer to a release that no longer exists is replaced with a stderr line, and nothing throws", () => {
  const seed = emptyRecord();
  const engine = memoryEngine(seed);
  engine(["add-epic", "--id", "e0", "--title", "t0", "--lane", "claude-code"]);
  engine(["release", "r2", "--intent", "two"]);
  // A hand-edited or legacy record: the epic names a release object that is not there.
  const st = rec(engine);
  st.epics.find(e => e.id === "e0").release = "ghost";
  const legacy = memoryEngine(st);
  const out = legacy.combined(["release", "r2", "--member", "e0"]);
  assert.match(out, /'ghost'/);
  assert.equal(legacy.store.record().epics.find(e => e.id === "e0").release, "r2");
});

unitTest("one --member that undefers on the new release AND moves off the old one records both, on two releases", () => {
  const engine = repo();
  engine(["release", "r1", "--intent", "one", "--member", "e0"]);
  engine(["release", "r2", "--intent", "two", "--defer", "e0:not yet"]);
  // --defer on r2 left r1's pointer alone: the epic is still r1's.
  assert.equal(rec(engine).epics.find(e => e.id === "e0").release, "r1");
  engine(["release", "r2", "--member", "e0"]);
  assert.deepEqual(rel(engine, "r1").amendments.map(strip),
    [{ op: "unmember", epic: "e0", via: "member", to: "r2" }]);
  assert.deepEqual(rel(engine, "r2").amendments.map(strip),
    [{ op: "undefer", epic: "e0", was: "not yet", via: "member" }]);
});

// ─────────────────── decision (b): a re-defer keeps the reason it replaces ───────────────────

unitTest("re-deferring with a NEW reason keeps the old one in the amendments trail", () => {
  const engine = repo();
  engine(["release", "r1", "--intent", "one", "--defer", "e1:depends on X landing"]);
  const first = rel(engine, "r1").deferred[0];
  engine(["release", "r1", "--defer", "e1:cut for scope"]);
  const r = rel(engine, "r1");
  assert.equal(r.deferred.length, 1);
  assert.equal(r.deferred[0].reason, "cut for scope", "deferred[] holds the CURRENT reason");
  assert.deepEqual(r.amendments.map(strip), [{
    op: "redefer", epic: "e1", reason: "cut for scope", was: "depends on X landing",
    wasRecordedAt: first.recordedAt,
  }]);
});

unitTest("a re-defer names the reason it replaced on stderr, and `release show` renders both", () => {
  const engine = repo();
  engine(["release", "r1", "--intent", "one", "--defer", "e1:depends on X landing"]);
  const out = engine.combined(["release", "r1", "--defer", "e1", "--reason", "cut for scope"]);
  assert.match(out, /depends on X landing/);
  const shown = engine(["release", "show", "r1"]);
  assert.match(shown, /redefer `e1` — cut for scope \[it read: depends on X landing\]/);
});

unitTest("re-deferring with the IDENTICAL reason writes nothing — not even a fresh recordedAt", () => {
  const engine = repo();
  engine(["release", "r1", "--intent", "one", "--defer", "e1:depends on X landing"]);
  const before = bytes(engine);
  engine(["release", "r1", "--defer", "e1:depends on X landing"]);
  assert.equal(bytes(engine), before);
});

unitTest("three reasons in a row leave a readable chain: each amendment's `was` is the one before", () => {
  const engine = repo();
  engine(["release", "r1", "--intent", "one", "--defer", "e1:a"]);
  engine(["release", "r1", "--defer", "e1:b"]);
  engine(["release", "r1", "--defer", "e1:c"]);
  assert.deepEqual(rel(engine, "r1").amendments.map(a => [a.op, a.was, a.reason]),
    [["redefer", "a", "b"], ["redefer", "b", "c"]]);
});

// ─────────────────── backward compatibility: a 0.49.0 record needs no migration ───────────────────

unitTest("a 0.49.0-shaped record (no amendments; an old-shape entry) loads, renders, and takes the new entries", () => {
  const legacy = {
    version: 1, revision: 3, active: null, detourStack: [], pmVersion: "0.49.0",
    epics: [
      { id: "e0", title: "t0", priority: "P2", status: "queued", role: "epic", lane: "claude-code", links: [], release: "r1" },
      { id: "e1", title: "t1", priority: "P2", status: "queued", role: "epic", lane: "claude-code", links: [] },
    ],
    releases: [
      { id: "r1", intent: "one", deferred: [{ epic: "e1", reason: "old", recordedAt: "2026-09-01T00:00:00.000Z" }] },
      { id: "r2", intent: "two", deferred: [],
        amendments: [{ op: "unmember", epic: "e9", reason: "legacy why", at: "2026-09-02T00:00:00.000Z" }] },
    ],
  };
  const engine = memoryEngine(legacy);
  assert.match(engine(["release", "show", "r2"]), /unmember `e9` — legacy why/);
  engine(["release", "r2", "--member", "e0"]);
  engine(["release", "r1", "--defer", "e1:new"]);
  const r1 = rel(engine, "r1");
  assert.deepEqual(r1.amendments.map(a => a.op), ["unmember", "redefer"]);
  assert.equal(r1.amendments[1].wasRecordedAt, "2026-09-01T00:00:00.000Z");
  assert.equal(rel(engine, "r2").amendments.length, 1, "the release the epic joined gains nothing");
});
