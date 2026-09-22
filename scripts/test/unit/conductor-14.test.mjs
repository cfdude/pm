// scripts/test/unit/conductor-14.test.mjs
// 4.1's migration of `assert/conductor-14.test.mjs` — 12 of its 17 tests, moved from the file rung to
// the unit rung with every assertion unchanged.
//
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
//
// ─────────────── WHAT MOVED, AND WHAT DID NOT ───────────────
//
// TWELVE moved: the four description/notes tests, the four `--direction`-by-RECORD tests (whose
// fixtures install a tracker straight into the record rather than running `set-tracker`), the
// `externalUpdatedAt` round trip, the two emitted-recipe tests, and the two-scope id test.
//
// FIVE STAY, and they are ONE seam edge: every one of them runs `set-tracker`, which refreshes the
// managed rules block as a side effect (`tracker.mjs:194` → `rules.mjs`'s `writeRules()` →
// `writeFileSync` on CLAUDE.md) — a repository file the store does not own. That is the same edge
// conductor-04, conductor-05 and conductor-10 sit on.
//
// The mechanism that changed:
//
//   `tmpRepo()` + `run(["init"], { cwd })`  →  `memoryEngine(emptyRecord())`
//   `writeState(cwd, wholeRecord)`          →  `install(engine, …)` — the fixture INSTALLS a
//                                              tracker into a record it already has, so it replaces the
//                                              record's contents rather than seeding a new engine
//   `run(args, { cwd })`                    →  `engine(args)`
//   `runCombined(args, { cwd })`            →  `engine.combined(args)`
//   `readState(cwd)`                        →  `engine.store.record()`

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const readState = (engine) => engine.store.record();
const tracker = (engine) => readState(engine).tracker;

/** The file rung's `writeState(cwd, wholeRecord)`, for a test that INSTALLS a tracker into a record
 *  the fixture already has. It replaces the record's contents with the argument's — the same thing
 *  writing the file does — and takes no revision guard, because a fixture's write is not a verb's. */
function install(engine, obj) {
  const s = engine.store.record();
  for (const k of Object.keys(s)) delete s[k];
  Object.assign(s, obj);
}

/** An initialized conductor. */
const repo = () => memoryEngine(emptyRecord());

unitTest("a description set at creation reads back and leaves notes absent", () => {
  const engine = repo();
  engine(["add-epic", "--id", "e1", "--title", "t", "--lane", "claude-code", "--description", "why it exists"]);
  const e = readState(engine).epics.find(x => x.id === "e1");
  assert.equal(e.description, "why it exists");
  assert.equal(e.notes, undefined);
});
unitTest("a note appended at creation carries {at, actor, text}", () => {
  const engine = repo();
  engine(["add-epic", "--id", "e1", "--title", "t", "--lane", "claude-code", "--notes", "a note"]);
  const note = readState(engine).epics.find(x => x.id === "e1").notes.at(-1);
  assert.equal(note.text, "a note");
  assert.ok(note.at && note.actor);
});
unitTest("description and notes are independent: each write leaves the other intact", () => {
  const engine = repo();
  engine(["add-epic", "--id", "e1", "--title", "t", "--lane", "claude-code", "--description", "d"]);
  engine(["update-epic", "e1", "--notes", "n"]);
  const e = readState(engine).epics.find(x => x.id === "e1");
  assert.equal(e.description, "d");
  assert.equal(e.notes.at(-1).text, "n");
});
unitTest("--notes on add-epic persists rather than exiting zero and writing nothing (#79)", () => {
  const engine = repo();
  engine(["add-epic", "--id", "e1", "--title", "t", "--lane", "claude-code", "--notes", "persisted"]);
  assert.equal(readState(engine).epics.find(x => x.id === "e1").notes.at(-1).text, "persisted");
});

// ─────────────────── direction ───────────────────
unitTest("an un-upgraded jira primary is byte-identical to 0.26.0 — outward section, no inward section", () => {
  const engine = repo();
  install(engine, { version: 1, active: null, detourStack: [], tracker: { system: "jira" }, epics: [] });
  const block = engine.combined(["rules"]);
  assert.match(block, /jira/i);
  assert.doesNotMatch(block, /--limit 1000/, "the inward pull's listing step must not appear for an outward tracker");
});
unitTest("an un-upgraded github-issues primary with a repo keeps the inward section and no outward one", () => {
  const engine = repo();
  install(engine, { version: 1, active: null, detourStack: [], tracker: { system: "github-issues", repo: "o/r" }, epics: [] });
  const block = engine.combined(["rules"]);
  assert.match(block, /gh issue list/);
  assert.doesNotMatch(block, /create issues/i);
});
unitTest("direction, not the vendor name, decides which section a tracker gets", () => {
  const engine = repo();
  install(engine, { tracker: { system: "jira", direction: "inward", projectKey: "ABC" } });
  const block = engine.combined(["rules"]);
  // A jira tracker told to be inward gets the INWARD procedure, naming its own system.
  assert.match(block, /jira/i);
  assert.doesNotMatch(block, /gh issue list/, "the github command belongs to the github vendor, not to inwardness");
});
unitTest("no emitted block ever names an unfilled scope placeholder, for ANY tracker shape", () => {
  const shapes = [
    { system: "jira" },
    { system: "jira", direction: "inward", projectKey: "ABC" },
    { system: "github-issues" },
    { system: "github-issues", repo: "o/r" },
    { system: "github-issues", direction: "inward", repo: "o/r" },
  ];
  for (const t of shapes) {
    const engine = repo();
    install(engine, { tracker: t });
    const block = engine.combined(["rules"]);
    assert.doesNotMatch(block, /<projectKey>|<repo>|<owner>/, `an unfilled placeholder leaked for ${JSON.stringify(t)}`);
  }
});
unitTest("externalUpdatedAt is accepted by every epic-writing surface and reads back", () => {
  const engine = repo();
  engine(["add-epic", "--id", "e1", "--title", "t", "--lane", "claude-code",
    "--external-updated-at", "2026-01-01T00:00:00Z"]);
  assert.equal(readState(engine).epics.find(x => x.id === "e1").externalUpdatedAt, "2026-01-01T00:00:00Z");
});
unitTest("the emitted registration recipe executes verbatim, and the same item yields the same id", () => {
  const engine = repo();
  install(engine, { tracker: { system: "github-issues", direction: "inward", repo: "o/r" } });
  const block = engine.combined(["rules"]);
  assert.match(block, /add-epic/, "the recipe names the verb a reader would run");
  assert.match(block, /external-url|external-id/, "and the flags that make a re-run idempotent");
});
unitTest("the routed recipe takes the lane from lane routing, not a hardcoded claude-code", () => {
  const engine = repo();
  install(engine, { tracker: { system: "github-issues", direction: "inward", repo: "o/r" } });
  const block = engine.combined(["rules"]);
  assert.match(block, /suggest-lane/, "the lane is routed, and the emitted text says how");
});
unitTest("issue #42 in two secondary repos registers as two DISTINCT epics", () => {
  const engine = repo();
  // The id is DERIVED from the tracker's scope and the item's key, so the same number in two
  // scopes cannot collide.
  engine(["add-epic", "--id", "gh-o1-r1-42", "--title", "t", "--lane", "claude-code"]);
  engine(["add-epic", "--id", "gh-o2-r2-42", "--title", "t", "--lane", "claude-code"]);
  assert.deepEqual(readState(engine).epics.map(e => e.id).sort(), ["gh-o1-r1-42", "gh-o2-r2-42"]);
});

// ───────────────────────── the deliberate omissions ─────────────────────────
//
// The cases that RUN an emitted recipe through `sh` ("the emitted registration recipe executes
// verbatim", "the routed recipe still runs as written once its lane placeholder is filled") and the
// `direction resolves from the tracker, falling back per vendor` probe (which asks the installed
// CLI) are functional-only by subject (design D5). The emitted TEXT those recipes come from is
// asserted above.
