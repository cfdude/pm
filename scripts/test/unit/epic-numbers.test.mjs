// scripts/test/unit/epic-numbers.test.mjs
// project-boards 8.1 (spec board-export, "Board redesign"): every epic carries an integer `number`, assigned at registration
// by the ONE creation sink (pushEpic), and the project's `nextEpicNumber` counter only ever advances. UNIT rung over an
// in-memory record; the sync registration paths read disk and are on the file rung (assert/epic-numbers-files.test.mjs).

import assert from "node:assert/strict";
import { expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";
import { assignEpicNumber, epicKey, externalNumberOf } from "../../lib/epic-number.mjs";

const epic = (id, over = {}) => ({
  id, title: `Title of ${id}`, priority: "P2", status: "queued", role: "epic", lane: "claude-code",
  stories: [], links: [], ...over,
});
const record = (epics = [], over = {}) => ({ version: 1, revision: 1, active: null, detourStack: [], epics, ...over });
const rec = (engine) => engine.store.record();
const numberOf = (engine, id) => rec(engine).epics.find(e => e.id === id).number;
const add = (engine, id, ...extra) => engine(["add-epic", "--id", id, "--title", `T ${id}`, "--lane", "claude-code", ...extra]);

unitTest("number: an epic with no tracker number takes the counter, which starts at 1 and advances", () => {
  const engine = memoryEngine(record());
  add(engine, "a"); add(engine, "b"); add(engine, "c");
  assert.deepEqual(["a", "b", "c"].map(id => numberOf(engine, id)), [1, 2, 3]);
  assert.equal(rec(engine).nextEpicNumber, 4);
});

unitTest("number: a positive-integer externalId that is free becomes the number, and the counter moves past it", () => {
  const engine = memoryEngine(record());
  add(engine, "tracked", "--external-id", "256");
  add(engine, "plain");
  assert.equal(numberOf(engine, "tracked"), 256);
  assert.equal(numberOf(engine, "plain"), 257);
  assert.equal(rec(engine).nextEpicNumber, 258);
});

unitTest("number: a held externalId number falls back to the counter (two trackers can both say 5)", () => {
  const engine = memoryEngine(record());
  add(engine, "gh5", "--external-id", "5", "--external-url", "https://github.com/o/r/issues/5");
  add(engine, "jira5", "--external-id", "5", "--external-url", "https://example.atlassian.net/browse/X-5");
  assert.equal(numberOf(engine, "gh5"), 5);
  assert.equal(numberOf(engine, "jira5"), 6, "5 is held, so the counter (already past 5) hands out 6");
});

unitTest("number: an externalId that is not a plain positive integer never becomes a number", () => {
  for (const [i, ext] of ["PROJ-12", "007", "0", "-4", "12abc", "1.5", "9007199254740993", " 8"].entries()) {
    const engine = memoryEngine(record());
    add(engine, `e${i}`, "--external-id", ext);
    assert.equal(numberOf(engine, `e${i}`), 1, `externalId ${JSON.stringify(ext)} is not a number`);
  }
  assert.equal(externalNumberOf({ externalId: "42" }), 42);
  assert.equal(externalNumberOf({ externalId: 42 }), null, "a stored number is not the string the tracker verbs write");
  assert.equal(externalNumberOf({}), null);
});

unitTest("number: the counter never lands on a number another epic holds (tracker #300 first, counter reaches 300 later)", () => {
  const engine = memoryEngine(record([epic("held", { number: 300 })], { nextEpicNumber: 299 }));
  add(engine, "x"); add(engine, "y"); add(engine, "z");
  assert.deepEqual(["x", "y", "z"].map(id => numberOf(engine, id)), [299, 301, 302]);
  const all = rec(engine).epics.map(e => e.number);
  assert.equal(new Set(all).size, all.length, "no two epics share a number");
});

unitTest("number: a counter that sits ON a held number (an older engine, a hand edit) still skips it", () => {
  const engine = memoryEngine(record([epic("held", { number: 300 })], { nextEpicNumber: 300 }));
  add(engine, "x");
  assert.equal(numberOf(engine, "x"), 301);
});

unitTest("number: taking a tracker number never moves the counter back", () => {
  const engine = memoryEngine(record([epic("a", { number: 1 }), epic("b", { number: 2 })], { nextEpicNumber: 10 }));
  add(engine, "tracked", "--external-id", "5");
  assert.equal(numberOf(engine, "tracked"), 5);
  assert.equal(rec(engine).nextEpicNumber, 10, "5 is below the counter, so the counter stays at 10");
  add(engine, "plain");
  assert.equal(numberOf(engine, "plain"), 10);
});

unitTest("number: with no counter recorded, the next number is one past the largest held", () => {
  const engine = memoryEngine(record([epic("a", { number: 4 }), epic("b", { number: 9 }), epic("c")]));
  add(engine, "d");
  assert.equal(numberOf(engine, "d"), 10);
  assert.equal(rec(engine).nextEpicNumber, 11);
});

unitTest("number: removing an epic never frees its number for a plain registration", () => {
  const engine = memoryEngine(record());
  add(engine, "a"); add(engine, "b");
  engine(["remove-epic", "b"]);
  add(engine, "c");
  assert.equal(numberOf(engine, "c"), 3, "the counter is persisted, so 2 is not handed out again");
});

unitTest("number: a number is never reassigned — update-epic --external-id does not renumber, and an archived epic keeps its own", () => {
  const engine = memoryEngine(record());
  add(engine, "a");
  engine(["update-epic", "a", "--external-id", "77"]);
  assert.equal(numberOf(engine, "a"), 1);
  engine(["update-epic", "a", "--status", "archived", "--outcome", "killed", "--reason", "r", "--no-deferrals"]);
  assert.equal(numberOf(engine, "a"), 1);
});

unitTest("number: add-many numbers every entry in order and never trusts a `number` it was handed", () => {
  const engine = memoryEngine(record());
  const batch = JSON.stringify({ epics: [{ id: "m1", lane: "claude-code" }, { id: "m2", lane: "claude-code", externalId: "40" }, { id: "m3", lane: "claude-code" }] });
  engine(["add-many", "--from", "-"], { input: batch });
  assert.deepEqual(["m1", "m2", "m3"].map(id => numberOf(engine, id)), [1, 40, 41]);
  const refused = engine.result(["add-many", "--from", "-"], { input: JSON.stringify({ epics: [{ id: "m4", lane: "claude-code", number: 99 }] }) });
  assert.notEqual(refused.status, 0, "`number` is not a batch key");
  assert.equal(rec(engine).epics.some(e => e.id === "m4"), false);
});

unitTest("number: assignEpicNumber keeps a number the epic already carries (a replayed record is not re-numbered) and advances the counter past it", () => {
  const state = record([], { nextEpicNumber: 3 });
  const e = epic("replayed", { number: 50 });
  assignEpicNumber(state, e);
  assert.equal(e.number, 50);
  assert.equal(state.nextEpicNumber, 51);
  const bad = epic("bad", { number: -2 });
  assignEpicNumber(state, bad);
  assert.equal(bad.number, 51, "an invalid stored number is replaced, not kept");
});

unitTest("key: projectKey and the number, or null while either is missing", () => {
  assert.equal(epicKey({ projectKey: "PM" }, { number: 256 }), "PM-256");
  assert.equal(epicKey({}, { number: 256 }), null);
  assert.equal(epicKey({ projectKey: "PM" }, {}), null);
  assert.equal(epicKey({ projectKey: "pm" }, { number: 1 }), null, "an invalid key is never joined");
  assert.equal(epicKey({ projectKey: "PM" }, { number: 0 }), null);
});

unitTest("number: the verb surface does not grow a way to set a number (no --number flag on any epic verb)", () => {
  const engine = memoryEngine(record([epic("a")]));
  for (const verb of [["add-epic", "--id", "z", "--title", "t", "--lane", "claude-code"], ["update-epic", "a"]]) {
    const r = engine.result([...verb, "--number", "5"]);
    assert.notEqual(r.status, 0);
  }
  expectFail(() => engine(["update-epic", "a", "--clear", "number"]));
});
