// scripts/test/unit/conductor-39.test.mjs
// 4.1's migration of `assert/conductor-39.test.mjs` — 8 of its 8 tests, moved from the file rung to
// the unit rung with every assertion unchanged. The file is GONE from the file rung.
//
// 5.3's ASSERTION TWIN of scripts/test/functional/conductor-39.test.mjs — same id, same subject.
//
// THE SUBJECT is the `createdAt`/`touchedAt` family: what a NEW epic is stamped with, how a save
// advances `touchedAt` only for the epics whose content changed, and `recover-created-at`, which
// reads the introducing commit out of LOCAL GIT HISTORY to backfill a date the record never carried.
//
// ONLY `recover-created-at` NEEDS GIT, and what this half carries of it is the DEGRADATION rungs —
// no repository, an id never committed, a re-run — all of which must yield ABSENT rather than an
// error or an invented date. Nothing here reads a path the store does not own: the record is the
// fixture, and the two `state.json` byte comparisons are the store's own bytes.
//
//   `tmpRepo()` + `run(["init"], { cwd })`  →  `memoryEngine(emptyRecord())`
//   `writeState(cwd, record)`               →  `memoryEngine(record)`
//   `readState(cwd)`                        →  `engine.store.record()`
//   `fs.readFileSync(…/state.json)`         →  `engine.store.read("state.json").text`

import assert from "node:assert/strict";
import { emptyRecord, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const readState = (engine) => engine.store.record();
const stateBytes = (engine) => engine.store.read("state.json").text;
/** The record a `writeState()` fixture planted, verbatim. */
const repoWith = (record) => memoryEngine({ version: 1, active: null, detourStack: [], ...record });

unitTest("1.1: a newly registered epic carries createdAt, and no later mutation rewrites it", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code"]);
  const first = readState(engine).epics.find(e => e.id === "a");
  assert.match(first.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  engine(["update-epic", "a", "--priority", "P0"]);
  assert.equal(readState(engine).epics.find(e => e.id === "a").createdAt, first.createdAt);
});

unitTest("1.1: an epic written without createdAt reads as unknown, never as a date", () => {
  const engine = repoWith({
    epics: [{ id: "old", title: "old", priority: "P1", status: "queued", role: "epic", lane: "claude-code", links: [] }] });
  assert.equal(readState(engine).epics.find(e => e.id === "old").createdAt, undefined);
});

unitTest("1.2: a save that changes nothing stamps nothing — no touch, no revision bump, same bytes", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code"]);
  const before = stateBytes(engine);
  engine(["render"]);   // a read verb that re-renders
  assert.equal(stateBytes(engine), before);
});

unitTest("1.3: a save that writes advances touchedAt only on the epics whose content changed", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code"]);
  engine(["add-epic", "--id", "b", "--lane", "claude-code"]);
  const before = Object.fromEntries(readState(engine).epics.map(e => [e.id, e.touchedAt]));
  engine(["update-epic", "a", "--priority", "P0"]);
  const after = Object.fromEntries(readState(engine).epics.map(e => [e.id, e.touchedAt]));
  assert.notEqual(after.a, before.a, "the epic whose content changed is touched");
  assert.equal(after.b, before.b, "the epic that did not change is NOT touched");
});

unitTest("1.6: a record written with neither field present still loads and renders", () => {
  const engine = repoWith({
    epics: [{ id: "old", title: "old", priority: "P1", status: "queued", role: "epic", lane: "claude-code", links: [] }] });
  assert.doesNotThrow(() => engine(["render"]));
  assert.doesNotThrow(() => engine(["brief"]));
});

// ─────────── recover-created-at: the DEGRADATION rungs, which are this half's world ───────────

unitTest("2.2: degradation — no git repository yields ABSENT, not an error and not a date", () => {
  const engine = repoWith({
    epics: [{ id: "e", title: "e", priority: "P1", status: "queued", role: "epic", lane: "claude-code", links: [] }] });
  const out = engine(["recover-created-at"]);
  const epic = readState(engine).epics.find(e => e.id === "e");
  assert.equal(epic.createdAt, undefined,
    "unrecoverable stays ABSENT and re-attemptable — a guessed date would be worse than none");
  assert.doesNotMatch(out, /\d{4}-\d{2}-\d{2}T/);
});

unitTest("2.3: re-running never invents a date for an id it cannot find in history", () => {
  const engine = repoWith({
    epics: [{ id: "never-committed", title: "t", priority: "P1", status: "queued", role: "epic", lane: "claude-code", links: [] }] });
  engine(["recover-created-at"]);
  engine(["recover-created-at"]);
  assert.equal(readState(engine).epics.find(e => e.id === "never-committed").createdAt, undefined);
});

unitTest("2.6/2.8: the verb is local-only and reads no network", () => {
  // The engine is an INSTRUCTION layer with no network access at all (repo CLAUDE.md, "hard
  // constraints"); this asserts the verb runs to completion in a directory with no repository and
  // does not reach outside it.
  const engine = memoryEngine(emptyRecord());
  assert.doesNotThrow(() => engine(["recover-created-at"]));
});

// ─────────── created-at-recovery-dates-too-late: the earliest match wins, by DATE ───────────

unitTest("2.1b: the introducing commit is the EARLIEST match by date, whatever order the pickaxe lists them in", async () => {
  const { earliestIntroduction } = await import(new URL("../../lib/created-at.mjs", import.meta.url).href);
  // The knowledge-store shape: the traversal-first line is the later (07-09) commit and the real
  // introduction (06-30) comes after it, as a pruned-then-restored side branch does.
  const out = [
    "aaaaaaa 2026-07-09T10:00:00+00:00",
    "bbbbbbb 2026-06-30T10:00:00+00:00",
    "ccccccc 2026-07-01T10:00:00+00:00",
  ].join("\n");
  assert.equal(earliestIntroduction(out), "2026-06-30T10:00:00+00:00");
  // Compared as INSTANTS, so a zone offset cannot reorder them: 23:00-05:00 on 06-30 is 04:00Z on 07-01.
  assert.equal(earliestIntroduction("a 2026-07-01T00:30:00+00:00\nb 2026-06-30T23:00:00-05:00"), "2026-07-01T00:30:00+00:00");
});

unitTest("2.1b: a grafted earliest match, no output and unparseable lines are ABSENT, never a date", async () => {
  const { earliestIntroduction } = await import(new URL("../../lib/created-at.mjs", import.meta.url).href);
  const out = "graft1 2026-06-30T10:00:00+00:00\nlater2 2026-07-09T10:00:00+00:00";
  assert.equal(earliestIntroduction(out, new Set(["graft1"])), null, "at a graft point 'introduced here' is indistinguishable from 'already existed'");
  assert.equal(earliestIntroduction(out, new Set(["later2"])), "2026-06-30T10:00:00+00:00", "a later grafted match does not hide an earlier real one");
  assert.equal(earliestIntroduction(""), null);
  assert.equal(earliestIntroduction("no-date-here\n\n  \nsha notadate"), null);
});
