// scripts/test/unit/conductor-17.test.mjs
// 4.1's migration of `assert/conductor-17.test.mjs` — ALL of it, moved from the file rung to the
// unit rung with every assertion unchanged. (The file-rung file is gone; nothing in it needed
// bytes on disk.)
//
// gh-101 — dependency ordering across the WHOLE record, effective priority, and manual rank.
//
// The defect this file pins: `orderQueueWithDependencies()` only ever saw `queued`/`untriaged`
// epics, so a `depends-on` edge pointing at a `planned`, `later`, `blocked` or `paused` epic was
// silently inert — the dependent sorted as if nothing were in its way, and the thing that would
// unblock it appeared nowhere near it. Every fixture below therefore puts the blocker in a
// status the old pass could not see; a fixture with a `queued` blocker would pass against the
// pre-existing topological sort and prove nothing.
//
// WHY THE WHOLE FILE COULD MOVE: every observable in it is a VALUE — PROJECT.md's rendered text,
// the brief's rendered text, and the record's fields. PROJECT.md is a store-owned artifact, so
// `projectMd(cwd)` becomes `engine.store.read("PROJECT.md").text`, and `parseBrief(cwd)` becomes the
// `brief` verb's own stdout parsed the same way. There is no `openspec/` fixture, no plugin
// directory, no batch file and no source read anywhere in it. The mechanism that changed:
//
//   `tmpRepo()` + `run(["init"], { cwd })`  →  `memoryEngine(emptyRecord())`
//   `run(args, { cwd })`                    →  `engine(args)`
//   `readState(cwd)`                        →  `engine.store.record()`
//   `projectMd(cwd)`                        →  `engine.store.read("PROJECT.md").text`
//   `parseBrief(cwd)`                       →  `JSON.parse(engine(["brief"]))…additionalContext`

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const readState = (engine) => engine.store.record();
const projectMd = (engine) => engine.store.read("PROJECT.md").text;
const parseBrief = (engine) =>
  JSON.parse(engine(["brief"])).hookSpecificOutput.additionalContext;

/** Two epics that share a priority AND a lane, whose intended order is the REVERSE of
 *  alphabetical. Both halves matter: sharing the lane makes laneRank a no-op, and reversing
 *  alphabetical order means `id.localeCompare` — the tie-break rank exists to replace — cannot
 *  produce the expected answer on its own. A fixture missing either half passes against the
 *  pre-existing sort and proves nothing. */
function tiedBand() {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "alpha", "--lane", "claude-code", "--priority", "P1"]);
  engine(["add-epic", "--id", "bravo", "--lane", "claude-code", "--priority", "P1"]);
  return engine;
}

// ──────── effective priority — computed over the depends-on closure, never stored ────────

unitTest("a planned blocker inherits the effective priority of the queued epic that depends on it", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "blocker", "--lane", "claude-code", "--priority", "P2", "--status", "planned"]);
  engine(["add-epic", "--id", "goal", "--lane", "claude-code", "--priority", "P1", "--status", "queued",
       "--link", "depends-on:blocker:cannot start without it"]);
  const md = projectMd(engine);
  assert.match(md, /\| P2 → P1 \| `blocker`/, "PROJECT.md must show the merit priority AND the inherited effective one");
  assert.doesNotMatch(md, /\| P1 → P1 \| `goal`/, "an epic whose effective priority equals its merit must render one value");
});

unitTest("the Backlog section shows the lift too — it is the line a reader scans for what to pull forward", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "blocker", "--lane", "claude-code", "--priority", "P2", "--status", "planned",
       "--title", "The means"]);
  engine(["add-epic", "--id", "goal", "--lane", "claude-code", "--priority", "P1",
       "--link", "depends-on:blocker:needed"]);
  const backlog = projectMd(engine).split("## Backlog")[1];
  assert.match(backlog, /`blocker` \(P2 → P1, claude-code, planned\)/,
    "the merit-only reading would tell the same fact two ways on two surfaces");
});

unitTest("effective priority is never written back to state.json", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "blocker", "--lane", "claude-code", "--priority", "P2", "--status", "planned"]);
  engine(["add-epic", "--id", "goal", "--lane", "claude-code", "--priority", "P1",
       "--link", "depends-on:blocker:needed"]);
  engine(["render"]);
  const st = readState(engine);
  const blocker = st.epics.find(e => e.id === "blocker");
  assert.equal(blocker.priority, "P2", "merit priority stays legible");
  assert.equal(blocker.effectivePriority, undefined, "effective priority is computed, never stored");
});

unitTest("effective priority propagates transitively along depends-on", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "deep", "--lane", "claude-code", "--priority", "P3", "--status", "planned"]);
  engine(["add-epic", "--id", "mid", "--lane", "claude-code", "--priority", "P2", "--status", "planned",
       "--link", "depends-on:deep:needs deep"]);
  engine(["add-epic", "--id", "goal", "--lane", "claude-code", "--priority", "P0",
       "--link", "depends-on:mid:needs mid"]);
  const md = projectMd(engine);
  assert.match(md, /\| P3 → P0 \| `deep`/, "priority must travel the whole closure, not one hop");
  assert.match(md, /\| P2 → P0 \| `mid`/);
});

unitTest("an ARCHIVED dependent does not lift its blocker — a satisfied dependency has nothing left to unblock", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "blocker", "--lane", "claude-code", "--priority", "P3", "--status", "planned"]);
  engine(["add-epic", "--id", "goal", "--lane", "claude-code", "--priority", "P0",
       "--link", "depends-on:blocker:needed"]);
  engine(["update-epic", "goal", "--status", "archived", "--outcome", "delivered", "--no-deferrals"]);
  const md = projectMd(engine);
  assert.doesNotMatch(md, /P3 → /, "an archived dependent must not keep lifting the epic it once needed");
});

unitTest("effective priority reorders the record — a lifted planned blocker sorts above an unrelated P2", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "zzz-blocker", "--lane", "claude-code", "--priority", "P3", "--status", "planned"]);
  engine(["add-epic", "--id", "aaa-unrelated", "--lane", "claude-code", "--priority", "P2"]);
  engine(["add-epic", "--id", "goal", "--lane", "claude-code", "--priority", "P0",
       "--link", "depends-on:zzz-blocker:needed"]);
  const md = projectMd(engine);
  assert.ok(md.indexOf("`zzz-blocker`") < md.indexOf("`aaa-unrelated`"),
    "a P3 lifted to effective P0 must outrank an unrelated P2 despite sorting last alphabetically");
});

unitTest("a dependency cycle among non-queued epics does not hang or crash the render", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code", "--priority", "P1", "--status", "planned"]);
  engine(["add-epic", "--id", "b", "--lane", "claude-code", "--priority", "P2", "--status", "blocked"]);
  engine(["update-epic", "a", "--link", "depends-on:b:cyclic"]);
  engine(["update-epic", "b", "--link", "depends-on:a:cyclic"]);
  const md = projectMd(engine);
  assert.match(md, /`a`/);
  assert.match(md, /`b`/);
});

// ──────── the statement — an inversion a human can act on in seconds ────────

unitTest("the brief names a P1's non-queued, lower-priority dependency instead of offering the P1 as workable", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "gh-79", "--lane", "claude-code", "--priority", "P2", "--status", "planned"]);
  engine(["add-epic", "--id", "gh-95", "--lane", "claude-code", "--priority", "P1",
       "--link", "depends-on:gh-79:the archive gate fires on false positives until then"]);
  const brief = parseBrief(engine);
  assert.match(brief, /`gh-95` \(P1\) depends on `gh-79` \(P2, planned\)/);
  assert.match(brief, /lower-priority and not queued/);
  assert.match(brief, /effective priority P1/);
});

unitTest("a SAME-priority non-queued dependency is reported as not queued and NOT as lower-priority", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "dep", "--lane", "claude-code", "--priority", "P1", "--status", "later"]);
  engine(["add-epic", "--id", "goal", "--lane", "claude-code", "--priority", "P1",
       "--link", "depends-on:dep:needed"]);
  const brief = parseBrief(engine);
  assert.match(brief, /`goal` \(P1\) depends on `dep` \(P1, later\) — the dependency is not queued/);
  assert.doesNotMatch(brief, /lower-priority/, "the reason must be derived per-edge, not a constant string");
});

unitTest("PROJECT.md carries the same dependency warnings the brief does — /pm:next reads PROJECT.md, not the brief", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "dep", "--lane", "claude-code", "--priority", "P2", "--status", "planned"]);
  engine(["add-epic", "--id", "goal", "--lane", "claude-code", "--priority", "P1",
       "--link", "depends-on:dep:needed"]);
  const md = projectMd(engine);
  assert.match(md, /## Dependency warnings/);
  assert.match(md, /`goal` \(P1\) depends on `dep` \(P2, planned\)/);
});

unitTest("an archived dependency produces no warning at all", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "dep", "--lane", "claude-code", "--priority", "P2", "--status", "planned"]);
  engine(["add-epic", "--id", "goal", "--lane", "claude-code", "--priority", "P1",
       "--link", "depends-on:dep:needed"]);
  engine(["update-epic", "dep", "--status", "archived", "--outcome", "delivered", "--no-deferrals"]);
  const md = projectMd(engine);
  assert.doesNotMatch(md, /## Dependency warnings/);
});

// ──────── `blocked` derived from depends-on, with nothing stored ────────

unitTest("a `blocked` epic with no depends-on edge is reported as recording nothing about what it waits on", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "stuck", "--lane", "claude-code", "--priority", "P1", "--status", "blocked"]);
  const brief = parseBrief(engine);
  assert.match(brief, /`stuck` is `blocked` with no `depends-on` link/);
  assert.match(brief, /update-epic stuck --link "depends-on:/);
});

unitTest("a `blocked` epic WITH an unsatisfied depends-on edge is not reported as recording nothing", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "dep", "--lane", "claude-code", "--priority", "P2", "--status", "planned"]);
  engine(["add-epic", "--id", "stuck", "--lane", "claude-code", "--priority", "P1", "--status", "blocked",
       "--link", "depends-on:dep:waiting on it"]);
  const brief = parseBrief(engine);
  assert.doesNotMatch(brief, /with no `depends-on` link/);
});

unitTest("a `blocked` epic whose only depends-on is ARCHIVED records nothing live — it is reported", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "dep", "--lane", "claude-code", "--priority", "P2"]);
  engine(["add-epic", "--id", "stuck", "--lane", "claude-code", "--priority", "P1", "--status", "blocked",
       "--link", "depends-on:dep:waiting"]);
  engine(["update-epic", "dep", "--status", "archived", "--outcome", "delivered", "--no-deferrals"]);
  const brief = parseBrief(engine);
  assert.match(brief, /`stuck` is `blocked` with no `depends-on` link/);
});

// ──────── manual rank — the LAST key, and the only writer is `reorder` ────────

unitTest("without a rank, two tied epics still sort alphabetically — the arbitrary order this replaces", () => {
  const engine = tiedBand();
  const md = projectMd(engine);
  assert.ok(md.indexOf("`alpha`") < md.indexOf("`bravo`"));
});

unitTest("reorder places tied epics in the given order, against alphabetical", () => {
  const engine = tiedBand();
  engine(["reorder", "bravo", "alpha"]);
  const md = projectMd(engine);
  assert.ok(md.indexOf("`bravo`") < md.indexOf("`alpha`"),
    "an explicit rank must beat id.localeCompare");
});

unitTest("reorder normalises to dense 1..N on every write", () => {
  const engine = tiedBand();
  engine(["reorder", "bravo", "alpha"]);
  const st = readState(engine);
  assert.equal(st.epics.find(e => e.id === "bravo").rank, 1);
  assert.equal(st.epics.find(e => e.id === "alpha").rank, 2);
});

unitTest("rank is the LAST key — it never outranks priority, and never outranks a dependency", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "alpha", "--lane", "claude-code", "--priority", "P0"]);
  engine(["add-epic", "--id", "bravo", "--lane", "claude-code", "--priority", "P0"]);
  engine(["reorder", "bravo", "alpha"]);
  // A P1 ranked first in its own band must not climb above a P0.
  engine(["add-epic", "--id", "charlie", "--lane", "claude-code", "--priority", "P1"]);
  engine(["reorder", "charlie"]);
  const md = projectMd(engine);
  assert.ok(md.indexOf("`bravo`") < md.indexOf("`charlie`"), "rank must not lift a P1 over a P0");
  assert.ok(md.indexOf("`alpha`") < md.indexOf("`charlie`"), "rank must not lift a P1 over a P0");
  // …and a dependency still wins over rank: `bravo` is ranked ahead of `alpha`, but if it
  // depends on `alpha` the topological pass in NEXT UP puts `alpha` first anyway.
  engine(["update-epic", "bravo", "--link", "depends-on:alpha:needs alpha first"]);
  const brief = parseBrief(engine);
  assert.ok(brief.indexOf("`alpha`") < brief.indexOf("`bravo`"),
    "a rank that outranked a dependency would just re-create the inversion with a number defending it");
});

unitTest("an UNRANKED epic sorts after every ranked one in its band", () => {
  const engine = tiedBand();
  engine(["add-epic", "--id", "aaa-later", "--lane", "claude-code", "--priority", "P1"]);
  engine(["reorder", "bravo", "alpha", "aaa-later"]);
  // Now add a fourth, unranked, whose id sorts FIRST alphabetically.
  engine(["add-epic", "--id", "aaa-new", "--lane", "claude-code", "--priority", "P1"]);
  const md = projectMd(engine);
  assert.ok(md.indexOf("`aaa-later`") < md.indexOf("`aaa-new`"),
    "a newly registered epic must not jump the ranked prefix just because its id sorts first");
});

unitTest("reorder refuses a band it was not given in full, and names what is missing", () => {
  const engine = tiedBand();
  const err = expectFail(() => engine(["reorder", "bravo"], { engine }));
  assert.ok(err, "an incomplete band must be refused");
  assert.match(String(err.stderr), /alpha/, "the refusal must name the epic that was left out");
  assert.equal(readState(engine).epics.find(e => e.id === "bravo").rank, undefined,
    "a refused reorder writes nothing");
});

unitTest("reorder refuses ids from two different priority bands", () => {
  const engine = tiedBand();
  engine(["add-epic", "--id", "charlie", "--lane", "claude-code", "--priority", "P2"]);
  assert.ok(expectFail(() => engine(["reorder", "alpha", "bravo", "charlie"])));
});

unitTest("reorder refuses a duplicate id, an unknown id, and an archived id", () => {
  const engine = tiedBand();
  assert.ok(expectFail(() => engine(["reorder", "alpha", "alpha", "bravo"])));
  assert.ok(expectFail(() => engine(["reorder", "alpha", "bravo", "ghost"])));
  engine(["update-epic", "alpha", "--status", "archived", "--outcome", "delivered", "--no-deferrals"]);
  assert.ok(expectFail(() => engine(["reorder", "alpha", "bravo"])),
    "an archived epic is not part of any band — ranking it would be ranking finished work");
  engine(["reorder", "bravo"]);   // the band is now just `bravo`
  assert.equal(readState(engine).epics.find(e => e.id === "bravo").rank, 1);
});

unitTest("reorder with no ids is refused rather than silently clearing the band", () => {
  const engine = tiedBand();
  assert.ok(expectFail(() => engine(["reorder"])));
});

unitTest("changing an epic's priority CLEARS its rank — a placement among peers is meaningless among new ones", () => {
  const engine = tiedBand();
  engine(["reorder", "bravo", "alpha"]);
  engine(["update-epic", "bravo", "--priority", "P2"]);
  const st = readState(engine);
  assert.equal(st.epics.find(e => e.id === "bravo").rank, undefined,
    "a rank carried into another band would collide with that band's own numbering");
  assert.equal(st.epics.find(e => e.id === "alpha").rank, 2, "the band it LEFT is untouched");
});

unitTest("re-stating the SAME priority does not clear a rank", () => {
  const engine = tiedBand();
  engine(["reorder", "bravo", "alpha"]);
  engine(["update-epic", "bravo", "--priority", "P1", "--title", "still P1"]);
  assert.equal(readState(engine).epics.find(e => e.id === "bravo").rank, 1);
});

// The SIBLING call site the diff never touched. `plan-hierarchy` asks the same question —
// how do two epics that tie on priority order? — and answered it with `id.localeCompare` in
// exactly the same way. A rank that held in PROJECT.md and vanished in a hierarchy batch would
// be a deliberate order the tool honours on one surface and discards on another.
unitTest("plan-hierarchy orders a batch by rank too, not just alphabetically", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "par", "--lane", "claude-code", "--priority", "P1"]);
  engine(["add-epic", "--id", "alpha", "--lane", "claude-code", "--priority", "P1", "--parent", "par"]);
  engine(["add-epic", "--id", "bravo", "--lane", "claude-code", "--priority", "P1", "--parent", "par"]);
  engine(["reorder", "par", "bravo", "alpha"]);
  const plan = JSON.parse(engine(["plan-hierarchy", "--parent", "par"]));
  const batch0 = plan.batches[0].epics.map(e => e.id);
  assert.deepEqual(batch0, ["bravo", "alpha"],
    "an explicit rank must beat id.localeCompare inside a hierarchy batch as well");
});

unitTest("rank is optional — a state.json written before it existed loads and renders unchanged", () => {
  const engine = tiedBand();
  const st = readState(engine);
  assert.ok(st.epics.every(e => e.rank === undefined), "rank is absent until reorder writes it");
  assert.match(projectMd(engine), /`alpha`/);
});
