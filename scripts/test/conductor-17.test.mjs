// gh-101 — dependency ordering across the WHOLE record, effective priority, and manual rank.
//
// The defect this file pins: `orderQueueWithDependencies()` only ever saw `queued`/`untriaged`
// epics, so a `depends-on` edge pointing at a `planned`, `later`, `blocked` or `paused` epic was
// silently inert — the dependent sorted as if nothing were in its way, and the thing that would
// unblock it appeared nowhere near it. Every fixture below therefore puts the blocker in a
// status the old pass could not see; a fixture with a `queued` blocker would pass against the
// pre-existing topological sort and prove nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { run, tmpRepo, parseBrief, projectMd, readState, expectFail } from "./helpers.mjs";

/** Two epics that share a priority AND a lane, whose intended order is the REVERSE of
 *  alphabetical. Both halves matter: sharing the lane makes laneRank a no-op, and reversing
 *  alphabetical order means `id.localeCompare` — the tie-break rank exists to replace — cannot
 *  produce the expected answer on its own. A fixture missing either half passes against the
 *  pre-existing sort and proves nothing. */
function tiedBand(cwd) {
  run(["init"], { cwd });
  run(["add-epic", "--id", "alpha", "--lane", "claude-code", "--priority", "P1"], { cwd });
  run(["add-epic", "--id", "bravo", "--lane", "claude-code", "--priority", "P1"], { cwd });
  return cwd;
}

// ──────── effective priority — computed over the depends-on closure, never stored ────────

test("a planned blocker inherits the effective priority of the queued epic that depends on it", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "blocker", "--lane", "claude-code", "--priority", "P2", "--status", "planned"], { cwd });
  run(["add-epic", "--id", "goal", "--lane", "claude-code", "--priority", "P1", "--status", "queued",
       "--link", "depends-on:blocker:cannot start without it"], { cwd });
  const md = projectMd(cwd);
  assert.match(md, /\| P2 → P1 \| `blocker`/, "PROJECT.md must show the merit priority AND the inherited effective one");
  assert.doesNotMatch(md, /\| P1 → P1 \| `goal`/, "an epic whose effective priority equals its merit must render one value");
});

test("effective priority is never written back to state.json", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "blocker", "--lane", "claude-code", "--priority", "P2", "--status", "planned"], { cwd });
  run(["add-epic", "--id", "goal", "--lane", "claude-code", "--priority", "P1",
       "--link", "depends-on:blocker:needed"], { cwd });
  run(["render"], { cwd });
  const st = readState(cwd);
  const blocker = st.epics.find(e => e.id === "blocker");
  assert.equal(blocker.priority, "P2", "merit priority stays legible");
  assert.equal(blocker.effectivePriority, undefined, "effective priority is computed, never stored");
});

test("effective priority propagates transitively along depends-on", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "deep", "--lane", "claude-code", "--priority", "P3", "--status", "planned"], { cwd });
  run(["add-epic", "--id", "mid", "--lane", "claude-code", "--priority", "P2", "--status", "planned",
       "--link", "depends-on:deep:needs deep"], { cwd });
  run(["add-epic", "--id", "goal", "--lane", "claude-code", "--priority", "P0",
       "--link", "depends-on:mid:needs mid"], { cwd });
  const md = projectMd(cwd);
  assert.match(md, /\| P3 → P0 \| `deep`/, "priority must travel the whole closure, not one hop");
  assert.match(md, /\| P2 → P0 \| `mid`/);
});

test("an ARCHIVED dependent does not lift its blocker — a satisfied dependency has nothing left to unblock", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "blocker", "--lane", "claude-code", "--priority", "P3", "--status", "planned"], { cwd });
  run(["add-epic", "--id", "goal", "--lane", "claude-code", "--priority", "P0",
       "--link", "depends-on:blocker:needed"], { cwd });
  run(["update-epic", "goal", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd });
  const md = projectMd(cwd);
  assert.doesNotMatch(md, /P3 → /, "an archived dependent must not keep lifting the epic it once needed");
});

test("effective priority reorders the record — a lifted planned blocker sorts above an unrelated P2", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "zzz-blocker", "--lane", "claude-code", "--priority", "P3", "--status", "planned"], { cwd });
  run(["add-epic", "--id", "aaa-unrelated", "--lane", "claude-code", "--priority", "P2"], { cwd });
  run(["add-epic", "--id", "goal", "--lane", "claude-code", "--priority", "P0",
       "--link", "depends-on:zzz-blocker:needed"], { cwd });
  const md = projectMd(cwd);
  assert.ok(md.indexOf("`zzz-blocker`") < md.indexOf("`aaa-unrelated`"),
    "a P3 lifted to effective P0 must outrank an unrelated P2 despite sorting last alphabetically");
});

test("a dependency cycle among non-queued epics does not hang or crash the render", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code", "--priority", "P1", "--status", "planned"], { cwd });
  run(["add-epic", "--id", "b", "--lane", "claude-code", "--priority", "P2", "--status", "blocked"], { cwd });
  run(["update-epic", "a", "--link", "depends-on:b:cyclic"], { cwd });
  run(["update-epic", "b", "--link", "depends-on:a:cyclic"], { cwd });
  const md = projectMd(cwd);
  assert.match(md, /`a`/);
  assert.match(md, /`b`/);
});

// ──────── the statement — an inversion a human can act on in seconds ────────

test("the brief names a P1's non-queued, lower-priority dependency instead of offering the P1 as workable", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "gh-79", "--lane", "claude-code", "--priority", "P2", "--status", "planned"], { cwd });
  run(["add-epic", "--id", "gh-95", "--lane", "claude-code", "--priority", "P1",
       "--link", "depends-on:gh-79:the archive gate fires on false positives until then"], { cwd });
  const brief = parseBrief(cwd);
  assert.match(brief, /`gh-95` \(P1\) depends on `gh-79` \(P2, planned\)/);
  assert.match(brief, /lower-priority and not queued/);
  assert.match(brief, /effective priority P1/);
});

test("a SAME-priority non-queued dependency is reported as not queued and NOT as lower-priority", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "dep", "--lane", "claude-code", "--priority", "P1", "--status", "later"], { cwd });
  run(["add-epic", "--id", "goal", "--lane", "claude-code", "--priority", "P1",
       "--link", "depends-on:dep:needed"], { cwd });
  const brief = parseBrief(cwd);
  assert.match(brief, /`goal` \(P1\) depends on `dep` \(P1, later\) — the dependency is not queued/);
  assert.doesNotMatch(brief, /lower-priority/, "the reason must be derived per-edge, not a constant string");
});

test("PROJECT.md carries the same dependency warnings the brief does — /pm:next reads PROJECT.md, not the brief", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "dep", "--lane", "claude-code", "--priority", "P2", "--status", "planned"], { cwd });
  run(["add-epic", "--id", "goal", "--lane", "claude-code", "--priority", "P1",
       "--link", "depends-on:dep:needed"], { cwd });
  const md = projectMd(cwd);
  assert.match(md, /## Dependency warnings/);
  assert.match(md, /`goal` \(P1\) depends on `dep` \(P2, planned\)/);
});

test("an archived dependency produces no warning at all", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "dep", "--lane", "claude-code", "--priority", "P2", "--status", "planned"], { cwd });
  run(["add-epic", "--id", "goal", "--lane", "claude-code", "--priority", "P1",
       "--link", "depends-on:dep:needed"], { cwd });
  run(["update-epic", "dep", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd });
  const md = projectMd(cwd);
  assert.doesNotMatch(md, /## Dependency warnings/);
});

// ──────── `blocked` derived from depends-on, with nothing stored ────────

test("a `blocked` epic with no depends-on edge is reported as recording nothing about what it waits on", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "stuck", "--lane", "claude-code", "--priority", "P1", "--status", "blocked"], { cwd });
  const brief = parseBrief(cwd);
  assert.match(brief, /`stuck` is `blocked` with no `depends-on` link/);
  assert.match(brief, /update-epic stuck --link "depends-on:/);
});

test("a `blocked` epic WITH an unsatisfied depends-on edge is not reported as recording nothing", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "dep", "--lane", "claude-code", "--priority", "P2", "--status", "planned"], { cwd });
  run(["add-epic", "--id", "stuck", "--lane", "claude-code", "--priority", "P1", "--status", "blocked",
       "--link", "depends-on:dep:waiting on it"], { cwd });
  const brief = parseBrief(cwd);
  assert.doesNotMatch(brief, /with no `depends-on` link/);
});

test("a `blocked` epic whose only depends-on is ARCHIVED records nothing live — it is reported", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "dep", "--lane", "claude-code", "--priority", "P2"], { cwd });
  run(["add-epic", "--id", "stuck", "--lane", "claude-code", "--priority", "P1", "--status", "blocked",
       "--link", "depends-on:dep:waiting"], { cwd });
  run(["update-epic", "dep", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd });
  const brief = parseBrief(cwd);
  assert.match(brief, /`stuck` is `blocked` with no `depends-on` link/);
});

// ──────── manual rank — the LAST key, and the only writer is `reorder` ────────

test("without a rank, two tied epics still sort alphabetically — the arbitrary order this replaces", () => {
  const cwd = tiedBand(tmpRepo());
  const md = projectMd(cwd);
  assert.ok(md.indexOf("`alpha`") < md.indexOf("`bravo`"));
});

test("reorder places tied epics in the given order, against alphabetical", () => {
  const cwd = tiedBand(tmpRepo());
  run(["reorder", "bravo", "alpha"], { cwd });
  const md = projectMd(cwd);
  assert.ok(md.indexOf("`bravo`") < md.indexOf("`alpha`"),
    "an explicit rank must beat id.localeCompare");
});

test("reorder normalises to dense 1..N on every write", () => {
  const cwd = tiedBand(tmpRepo());
  run(["reorder", "bravo", "alpha"], { cwd });
  const st = readState(cwd);
  assert.equal(st.epics.find(e => e.id === "bravo").rank, 1);
  assert.equal(st.epics.find(e => e.id === "alpha").rank, 2);
});

test("rank is the LAST key — it never outranks priority, and never outranks a dependency", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "alpha", "--lane", "claude-code", "--priority", "P0"], { cwd });
  run(["add-epic", "--id", "bravo", "--lane", "claude-code", "--priority", "P0"], { cwd });
  run(["reorder", "bravo", "alpha"], { cwd });
  // A P1 ranked first in its own band must not climb above a P0.
  run(["add-epic", "--id", "charlie", "--lane", "claude-code", "--priority", "P1"], { cwd });
  run(["reorder", "charlie"], { cwd });
  const md = projectMd(cwd);
  assert.ok(md.indexOf("`bravo`") < md.indexOf("`charlie`"), "rank must not lift a P1 over a P0");
  assert.ok(md.indexOf("`alpha`") < md.indexOf("`charlie`"), "rank must not lift a P1 over a P0");
  // …and a dependency still wins over rank: `bravo` is ranked ahead of `alpha`, but if it
  // depends on `alpha` the topological pass in NEXT UP puts `alpha` first anyway.
  run(["update-epic", "bravo", "--link", "depends-on:alpha:needs alpha first"], { cwd });
  const brief = parseBrief(cwd);
  assert.ok(brief.indexOf("`alpha`") < brief.indexOf("`bravo`"),
    "a rank that outranked a dependency would just re-create the inversion with a number defending it");
});

test("an UNRANKED epic sorts after every ranked one in its band", () => {
  const cwd = tiedBand(tmpRepo());
  run(["add-epic", "--id", "aaa-later", "--lane", "claude-code", "--priority", "P1"], { cwd });
  run(["reorder", "bravo", "alpha", "aaa-later"], { cwd });
  // Now add a fourth, unranked, whose id sorts FIRST alphabetically.
  run(["add-epic", "--id", "aaa-new", "--lane", "claude-code", "--priority", "P1"], { cwd });
  const md = projectMd(cwd);
  assert.ok(md.indexOf("`aaa-later`") < md.indexOf("`aaa-new`"),
    "a newly registered epic must not jump the ranked prefix just because its id sorts first");
});

test("reorder refuses a band it was not given in full, and names what is missing", () => {
  const cwd = tiedBand(tmpRepo());
  const err = expectFail(() => run(["reorder", "bravo"], { cwd }));
  assert.ok(err, "an incomplete band must be refused");
  assert.match(String(err.stderr), /alpha/, "the refusal must name the epic that was left out");
  assert.equal(readState(cwd).epics.find(e => e.id === "bravo").rank, undefined,
    "a refused reorder writes nothing");
});

test("reorder refuses ids from two different priority bands", () => {
  const cwd = tiedBand(tmpRepo());
  run(["add-epic", "--id", "charlie", "--lane", "claude-code", "--priority", "P2"], { cwd });
  assert.ok(expectFail(() => run(["reorder", "alpha", "bravo", "charlie"], { cwd })));
});

test("reorder refuses a duplicate id, an unknown id, and an archived id", () => {
  const cwd = tiedBand(tmpRepo());
  assert.ok(expectFail(() => run(["reorder", "alpha", "alpha", "bravo"], { cwd })));
  assert.ok(expectFail(() => run(["reorder", "alpha", "bravo", "ghost"], { cwd })));
  run(["update-epic", "alpha", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd });
  assert.ok(expectFail(() => run(["reorder", "alpha", "bravo"], { cwd })),
    "an archived epic is not part of any band — ranking it would be ranking finished work");
  run(["reorder", "bravo"], { cwd });   // the band is now just `bravo`
  assert.equal(readState(cwd).epics.find(e => e.id === "bravo").rank, 1);
});

test("reorder with no ids is refused rather than silently clearing the band", () => {
  const cwd = tiedBand(tmpRepo());
  assert.ok(expectFail(() => run(["reorder"], { cwd })));
});

test("changing an epic's priority CLEARS its rank — a placement among peers is meaningless among new ones", () => {
  const cwd = tiedBand(tmpRepo());
  run(["reorder", "bravo", "alpha"], { cwd });
  run(["update-epic", "bravo", "--priority", "P2"], { cwd });
  const st = readState(cwd);
  assert.equal(st.epics.find(e => e.id === "bravo").rank, undefined,
    "a rank carried into another band would collide with that band's own numbering");
  assert.equal(st.epics.find(e => e.id === "alpha").rank, 2, "the band it LEFT is untouched");
});

test("re-stating the SAME priority does not clear a rank", () => {
  const cwd = tiedBand(tmpRepo());
  run(["reorder", "bravo", "alpha"], { cwd });
  run(["update-epic", "bravo", "--priority", "P1", "--title", "still P1"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "bravo").rank, 1);
});

// The SIBLING call site the diff never touched. `plan-hierarchy` asks the same question —
// how do two epics that tie on priority order? — and answered it with `id.localeCompare` in
// exactly the same way. A rank that held in PROJECT.md and vanished in a hierarchy batch would
// be a deliberate order the tool honours on one surface and discards on another.
test("plan-hierarchy orders a batch by rank too, not just alphabetically", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "par", "--lane", "claude-code", "--priority", "P1"], { cwd });
  run(["add-epic", "--id", "alpha", "--lane", "claude-code", "--priority", "P1", "--parent", "par"], { cwd });
  run(["add-epic", "--id", "bravo", "--lane", "claude-code", "--priority", "P1", "--parent", "par"], { cwd });
  run(["reorder", "par", "bravo", "alpha"], { cwd });
  const plan = JSON.parse(run(["plan-hierarchy", "--parent", "par"], { cwd }));
  const batch0 = plan.batches[0].epics.map(e => e.id);
  assert.deepEqual(batch0, ["bravo", "alpha"],
    "an explicit rank must beat id.localeCompare inside a hierarchy batch as well");
});

test("rank is optional — a state.json written before it existed loads and renders unchanged", () => {
  const cwd = tiedBand(tmpRepo());
  const st = readState(cwd);
  assert.ok(st.epics.every(e => e.rank === undefined), "rank is absent until reorder writes it");
  assert.match(projectMd(cwd), /`alpha`/);
});
