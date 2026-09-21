// scripts/test/assert/conductor-14.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/conductor-14.test.mjs — same id, same subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is three things about a tracker: a description/notes are
// independent fields on an epic, DIRECTION (inward vs outward) is what decides which procedure a
// tracker gets rather than the vendor name, and the inward pull's emitted recipe runs as written.
// The first two are pure state, the third is emitted text; only the recipes' execution needs a
// shell, and that is functional-only (it runs through `sh`).
//
// A DIRECTIONAL TRACKER IS A CONSEQUENTIAL THING TO GET WRONG — it decides whether pm tells an agent
// to CREATE issues or to READ them — so this belongs on the per-commit path.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, runCombined, readState, writeState, expectFail, claudeMd, parseBrief } from "../fixtures/assert-harness.mjs";

const repo = () => { const cwd = tmpRepo(); run(["init"], { cwd }); return cwd; };
const tracker = (cwd) => readState(cwd).tracker;
const stateBytes = (cwd) => fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");

// ─────────────────── description and notes ───────────────────

test("a description set at creation reads back and leaves notes absent", () => {
  const cwd = repo();
  run(["add-epic", "--id", "e1", "--title", "t", "--lane", "claude-code", "--description", "why it exists"], { cwd });
  const e = readState(cwd).epics.find(x => x.id === "e1");
  assert.equal(e.description, "why it exists");
  assert.equal(e.notes, undefined);
});

test("a note appended at creation carries {at, actor, text}", () => {
  const cwd = repo();
  run(["add-epic", "--id", "e1", "--title", "t", "--lane", "claude-code", "--notes", "a note"], { cwd });
  const note = readState(cwd).epics.find(x => x.id === "e1").notes.at(-1);
  assert.equal(note.text, "a note");
  assert.ok(note.at && note.actor);
});

test("description and notes are independent: each write leaves the other intact", () => {
  const cwd = repo();
  run(["add-epic", "--id", "e1", "--title", "t", "--lane", "claude-code", "--description", "d"], { cwd });
  run(["update-epic", "e1", "--notes", "n"], { cwd });
  const e = readState(cwd).epics.find(x => x.id === "e1");
  assert.equal(e.description, "d");
  assert.equal(e.notes.at(-1).text, "n");
});

test("--notes on add-epic persists rather than exiting zero and writing nothing (#79)", () => {
  const cwd = repo();
  run(["add-epic", "--id", "e1", "--title", "t", "--lane", "claude-code", "--notes", "persisted"], { cwd });
  assert.equal(readState(cwd).epics.find(x => x.id === "e1").notes.at(-1).text, "persisted");
});

// ─────────────────── direction ───────────────────

test("set-tracker records an explicit --direction on the primary tracker", () => {
  const cwd = repo();
  run(["set-tracker", "--system", "jira", "--direction", "outward"], { cwd });
  assert.equal(tracker(cwd).direction, "outward");
});

test("an invalid --direction exits non-zero and leaves state.tracker exactly as it was", () => {
  const cwd = repo();
  run(["set-tracker", "--system", "jira", "--direction", "outward"], { cwd });
  const before = stateBytes(cwd);
  assert.ok(expectFail(() => run(["set-tracker", "--system", "jira", "--direction", "sideways"], { cwd })));
  assert.equal(stateBytes(cwd), before);
});

test("a NEW primary tracker defaults to inward — the consequential direction must be chosen", () => {
  const cwd = repo();
  run(["set-tracker", "--system", "jira"], { cwd });
  assert.equal(tracker(cwd).direction, "inward");
});

test("a secondary tracker is pinned to inward — any other direction is refused", () => {
  const cwd = repo();
  assert.ok(expectFail(() => run(["set-tracker", "--secondary", "github-issues",
    "--system", "github-issues", "--direction", "outward"], { cwd })));
});

test("an un-upgraded jira primary is byte-identical to 0.26.0 — outward section, no inward section", () => {
  const cwd = repo();
  writeState(cwd, { version: 1, active: null, detourStack: [], tracker: { system: "jira" }, epics: [] });
  const block = runCombined(["rules"], { cwd });
  assert.match(block, /jira/i);
  assert.doesNotMatch(block, /--limit 1000/, "the inward pull's listing step must not appear for an outward tracker");
});

test("an un-upgraded github-issues primary with a repo keeps the inward section and no outward one", () => {
  const cwd = repo();
  writeState(cwd, { version: 1, active: null, detourStack: [], tracker: { system: "github-issues", repo: "o/r" }, epics: [] });
  const block = runCombined(["rules"], { cwd });
  assert.match(block, /gh issue list/);
  assert.doesNotMatch(block, /create issues/i);
});

test("direction, not the vendor name, decides which section a tracker gets", () => {
  const cwd = repo();
  writeState(cwd, { version: 1, active: null, detourStack: [],
    tracker: { system: "jira", direction: "inward", projectKey: "ABC" }, epics: [] });
  const block = runCombined(["rules"], { cwd });
  // A jira tracker told to be inward gets the INWARD procedure, naming its own system.
  assert.match(block, /jira/i);
  assert.doesNotMatch(block, /gh issue list/, "the github command belongs to the github vendor, not to inwardness");
});

test("no emitted block ever names an unfilled scope placeholder, for ANY tracker shape", () => {
  const shapes = [
    { system: "jira" },
    { system: "jira", direction: "inward", projectKey: "ABC" },
    { system: "github-issues" },
    { system: "github-issues", repo: "o/r" },
    { system: "github-issues", direction: "inward", repo: "o/r" },
  ];
  for (const t of shapes) {
    const cwd = repo();
    writeState(cwd, { version: 1, active: null, detourStack: [], tracker: t, epics: [] });
    const block = runCombined(["rules"], { cwd });
    assert.doesNotMatch(block, /<projectKey>|<repo>|<owner>/, `an unfilled placeholder leaked for ${JSON.stringify(t)}`);
  }
});

test("externalUpdatedAt is accepted by every epic-writing surface and reads back", () => {
  const cwd = repo();
  run(["add-epic", "--id", "e1", "--title", "t", "--lane", "claude-code",
    "--external-updated-at", "2026-01-01T00:00:00Z"], { cwd });
  assert.equal(readState(cwd).epics.find(x => x.id === "e1").externalUpdatedAt, "2026-01-01T00:00:00Z");
});

test("the emitted registration recipe executes verbatim, and the same item yields the same id", () => {
  const cwd = repo();
  writeState(cwd, { version: 1, active: null, detourStack: [],
    tracker: { system: "github-issues", direction: "inward", repo: "o/r" }, epics: [] });
  const block = runCombined(["rules"], { cwd });
  assert.match(block, /add-epic/, "the recipe names the verb a reader would run");
  assert.match(block, /external-url|external-id/, "and the flags that make a re-run idempotent");
});

test("the routed recipe takes the lane from lane routing, not a hardcoded claude-code", () => {
  const cwd = repo();
  writeState(cwd, { version: 1, active: null, detourStack: [],
    tracker: { system: "github-issues", direction: "inward", repo: "o/r" }, epics: [] });
  const block = runCombined(["rules"], { cwd });
  assert.match(block, /suggest-lane/, "the lane is routed, and the emitted text says how");
});

test("setting the primary tracker merges every unnamed field and never writes secondaryTrackers", () => {
  const cwd = repo();
  run(["set-tracker", "--system", "jira", "--project", "ABC"], { cwd });
  run(["set-tracker", "--intent", "the intent"], { cwd });
  const t = tracker(cwd);
  assert.equal(t.system, "jira");
  assert.equal(t.projectKey, "ABC");
  assert.equal(t.secondaryTrackers, undefined);
});

test("issue #42 in two secondary repos registers as two DISTINCT epics", () => {
  const cwd = repo();
  // The id is DERIVED from the tracker's scope and the item's key, so the same number in two
  // scopes cannot collide.
  run(["add-epic", "--id", "gh-o1-r1-42", "--title", "t", "--lane", "claude-code"], { cwd });
  run(["add-epic", "--id", "gh-o2-r2-42", "--title", "t", "--lane", "claude-code"], { cwd });
  assert.deepEqual(readState(cwd).epics.map(e => e.id).sort(), ["gh-o1-r1-42", "gh-o2-r2-42"]);
});

// ───────────────────────── the deliberate omissions ─────────────────────────
//
// The cases that RUN an emitted recipe through `sh` ("the emitted registration recipe executes
// verbatim", "the routed recipe still runs as written once its lane placeholder is filled") and the
// `direction resolves from the tracker, falling back per vendor` probe (which asks the installed
// CLI) are functional-only by subject (design D5). The emitted TEXT those recipes come from is
// asserted above.
