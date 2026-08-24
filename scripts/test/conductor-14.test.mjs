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
