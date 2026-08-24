// scripts/test/conductor-14.test.mjs
// conductor-tells-the-truth, groups 10–12: tracker direction (two predicates, six governed
// emitters), the freshness watermark + single activation door, and the epic annotation surface.
//
// A NEW file rather than growth of conductor-13: three capabilities land here concurrently and
// the split keeps each one's fixtures readable.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { run, readState, writeState, tmpRepo, expectFail } from "./helpers.mjs";

// ─────────────────────── group 12: epic annotation ───────────────────────
//
// `description` is durable rationale, replaced when set again. `notes` is an append-only trail
// of {at, actor, text}. They are DISTINCT: notes look like activity and a description does not,
// and writing one never touches the other.

test("a description set at creation reads back and leaves notes absent", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "e1", "--lane", "claude-code", "--description", "why this exists"], { cwd });
  const e = readState(cwd).epics.find(x => x.id === "e1");
  assert.equal(e.description, "why this exists");
  assert.equal(e.notes, undefined);
});

test("a note appended at creation carries {at, actor, text}", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "e1", "--lane", "claude-code", "--notes", "first note"], { cwd });
  const e = readState(cwd).epics.find(x => x.id === "e1");
  assert.equal(e.notes.length, 1);
  assert.equal(e.notes[0].text, "first note");
  assert.ok(e.notes[0].actor, "a note entry must record an actor");
  assert.ok(!Number.isNaN(Date.parse(e.notes[0].at)), "a note entry must record when it was written");
});

test("description and notes are independent: each write leaves the other intact", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "e1", "--lane", "claude-code", "--description", "first rationale"], { cwd });
  run(["update-epic", "e1", "--notes", "note one"], { cwd });
  let e = readState(cwd).epics.find(x => x.id === "e1");
  assert.equal(e.description, "first rationale", "appending a note must not touch the description");
  assert.equal(e.notes.length, 1);

  // Setting a description leaves notes unchanged.
  run(["update-epic", "e1", "--description", "second rationale"], { cwd });
  e = readState(cwd).epics.find(x => x.id === "e1");
  assert.equal(e.description, "second rationale", "a description is REPLACED when set again");
  assert.equal(e.notes.length, 1, "replacing the description must not drop a note");
  assert.equal(e.notes[0].text, "note one");

  // Appending a second note preserves the first entry's text verbatim.
  run(["update-epic", "e1", "--notes", "note two"], { cwd });
  e = readState(cwd).epics.find(x => x.id === "e1");
  assert.equal(e.notes.length, 2, "notes APPEND — they never replace");
  assert.equal(e.notes[0].text, "note one", "the earlier entry's text must survive verbatim");
  assert.equal(e.notes[1].text, "note two");

  // Replacing the description afterwards leaves every note present.
  run(["update-epic", "e1", "--description", "third rationale"], { cwd });
  e = readState(cwd).epics.find(x => x.id === "e1");
  assert.equal(e.description, "third rationale");
  assert.deepEqual(e.notes.map(n => n.text), ["note one", "note two"]);
});

test("--notes on add-epic persists rather than exiting zero and writing nothing (#79)", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "e1", "--lane", "claude-code", "--notes", "the payload that used to vanish"], { cwd });
  const e = readState(cwd).epics.find(x => x.id === "e1");
  assert.equal(e.notes[0].text, "the payload that used to vanish");
});

// ─────────────────────── group 10: tracker direction ───────────────────────
//
// TWO resolved values, computed once in constants.mjs and consumed by every emitter:
// `outwardApplies` and `inwardProcedureEmittable`. They are SEPARATE tests — direction alone
// must never turn a section on, or pm emits a command with an unfilled scope placeholder.

const CONSTANTS_14 = new URL("../lib/constants.mjs", import.meta.url).href;

test("direction resolves from the tracker, falling back per vendor without any migration", async () => {
  const { directionOf } = await import(CONSTANTS_14);
  // The fallback is load-bearing INDEPENDENTLY of the migration: /pm:upgrade lags the plugin
  // update by design, so a repo runs this engine for weeks with no `direction` recorded.
  assert.equal(directionOf({ system: "github-issues", repo: "o/n" }), "inward");
  assert.equal(directionOf({ system: "github-issues" }), "inward");
  assert.equal(directionOf({ system: "jira", projectKey: "JOB" }), "outward");
  assert.equal(directionOf({ system: "linear" }), "outward");
  // An explicitly recorded direction always wins over the fallback.
  for (const d of ["inward", "outward", "both"]) {
    assert.equal(directionOf({ system: "jira", projectKey: "JOB", direction: d }), d);
    assert.equal(directionOf({ system: "github-issues", repo: "o/n", direction: d }), d);
  }
  // A secondary tracker is pull-only by definition — it resolves inward whatever its vendor.
  assert.equal(directionOf({ system: "jira", projectKey: "ABC", role: "secondary" }), "inward");
  assert.equal(directionOf(null), null);
  assert.equal(directionOf({}), null);
});

test("the two predicates are SEPARATE: a scope-less inward tracker emits no inward procedure", async () => {
  const { outwardApplies, inwardProcedureEmittable } = await import(CONSTANTS_14);
  const rows = [
    // tracker,                                                   outward, inwardEmittable
    [{ system: "github-issues", repo: "o/n" },                     false,  true],
    // THE case that makes "inward iff direction includes inward" unsafe: direction resolves
    // `inward` and there is still nothing to list, so no inward section may be emitted.
    [{ system: "github-issues" },                                  false,  false],
    [{ system: "github-issues", direction: "inward" },             false,  false],
    [{ system: "github-issues", repo: "o/n", direction: "outward" }, true,  false],
    [{ system: "github-issues", repo: "o/n", direction: "both" },  true,   true],
    [{ system: "jira", projectKey: "JOB" },                        true,   false],
    [{ system: "jira" },                                           true,   false],
    [{ system: "jira", projectKey: "JOB", direction: "inward" },   false,  true],
    [{ system: "jira", direction: "inward" },                      false,  false],
    [{ system: "jira", repo: "o/n", direction: "inward" },         false,  true],
    [{ system: "jira", projectKey: "JOB", direction: "both" },     true,   true],
    [{ system: "linear", projectKey: "L", direction: "both" },     true,   true],
    [null,                                                          false,  false],
  ];
  for (const [tracker, outward, inward] of rows) {
    assert.equal(outwardApplies(tracker), outward, `outwardApplies ${JSON.stringify(tracker)}`);
    assert.equal(inwardProcedureEmittable(tracker), inward, `inwardProcedureEmittable ${JSON.stringify(tracker)}`);
  }
});

test("an inward procedure is emittable repo-wide when ANY configured tracker has one", async () => {
  const { anyInwardProcedureEmittable } = await import(CONSTANTS_14);
  const outwardPrimary = { system: "jira", projectKey: "JOB" };
  assert.equal(anyInwardProcedureEmittable(outwardPrimary, []), false);
  assert.equal(
    anyInwardProcedureEmittable(outwardPrimary, [{ system: "github-issues", repo: "a/b", role: "secondary" }]),
    true, "a secondary tracker is inward by definition, so the repo has an inward procedure");
  assert.equal(anyInwardProcedureEmittable(null, []), false);
});
