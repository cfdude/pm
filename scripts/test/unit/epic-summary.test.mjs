// scripts/test/unit/epic-summary.test.mjs
// project-boards 2.1 (spec epic-annotation): an epic's one-line `summary` and `whyNow`, set on every epic-writing
// surface, validated, clearable, and a WARNING (never a refusal) when an epic leaves `untriaged` without them.
// UNIT rung: every assertion is a value the engine produced over an in-memory record.

import assert from "node:assert/strict";
import { expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";
import { nullableEpicFlags } from "../../lib/constants.mjs";

const epic = (id, over = {}) => ({
  id, title: `Title of ${id}`, priority: "P2", status: "queued", role: "epic", lane: "claude-code",
  stories: [], links: [], ...over,
});
const record = (epics = []) => ({ version: 1, revision: 1, active: null, detourStack: [], epics });
const onBoard = (engine, id) => JSON.parse(engine(["board", "--json"])).epics.find(e => e.id === id);
const stateOf = (engine) => JSON.stringify(engine.store.record());
const SUMMARY_WARNING = /--summary/;

unitTest("summary: add-epic, update-epic and add-many all persist summary and whyNow, read back through board --json", () => {
  const engine = memoryEngine(record([epic("b")]));
  engine(["add-epic", "--id", "a", "--lane", "claude-code", "--summary", "s", "--why-now", "w"]);
  engine(["update-epic", "b", "--summary", "s2", "--why-now", "w2"]);
  engine(["add-many", "--from", "-"], { input: JSON.stringify({ epics: [{ id: "c", title: "C", lane: "claude-code", summary: "s3", whyNow: "w3" }] }) });
  assert.deepEqual([onBoard(engine, "a").summary, onBoard(engine, "a").whyNow], ["s", "w"]);
  assert.deepEqual([onBoard(engine, "b").summary, onBoard(engine, "b").whyNow], ["s2", "w2"]);
  assert.deepEqual([onBoard(engine, "c").summary, onBoard(engine, "c").whyNow], ["s3", "w3"]);
});

unitTest("summary: setting either never touches description or notes", () => {
  const engine = memoryEngine(record([epic("a", { description: "long rationale", notes: [{ at: "t", text: "n" }] })]));
  engine(["update-epic", "a", "--summary", "s", "--why-now", "w"]);
  const e = engine.store.record().epics[0];
  assert.equal(e.description, "long rationale");
  assert.equal(e.notes.length, 1);
});

unitTest("summary: empty, multi-line and over-limit values are refused on every surface, naming the field and its limit, writing nothing", () => {
  const cases = [
    ["--summary", "", /--summary.*200/],
    ["--summary", "line one\nline two", /summary.*one line.*200/],
    ["--summary", "x".repeat(201), /summary.*200/],
    ["--why-now", "", /--why-now.*300/],
    ["--why-now", "a\nb", /whyNow|why-now.*one line.*300/],
    ["--why-now", "x".repeat(301), /why-?[Nn]ow.*300/],
  ];
  for (const [flag, value, re] of cases) {
    const engine = memoryEngine(record([epic("a")]));
    const before = stateOf(engine);
    const r = engine.result(["update-epic", "a", flag, value]);
    assert.notEqual(r.status, 0, `update-epic ${flag} ${JSON.stringify(value).slice(0, 20)}`);
    assert.match(r.stderr, re);
    assert.equal(stateOf(engine), before, "nothing was written");
    const add = engine.result(["add-epic", "--id", "z", "--lane", "claude-code", flag, value]);
    assert.notEqual(add.status, 0);
    assert.equal(stateOf(engine), before);
  }
  const engine = memoryEngine(record());
  const before = stateOf(engine);
  const many = engine.result(["add-many", "--from", "-"], { input: JSON.stringify({ epics: [{ id: "c", title: "C", lane: "claude-code", summary: "a\nb" }] }) });
  assert.notEqual(many.status, 0);
  assert.match(many.stderr, /summary/);
  assert.equal(stateOf(engine), before);
});

unitTest("summary: the limits are inclusive (200 and 300 characters are accepted)", () => {
  const engine = memoryEngine(record([epic("a")]));
  engine(["update-epic", "a", "--summary", "x".repeat(200), "--why-now", "y".repeat(300)]);
  assert.equal(onBoard(engine, "a").summary.length, 200);
  assert.equal(onBoard(engine, "a").whyNow.length, 300);
});

unitTest("summary: --clear summary and --clear why-now are the inverses, and leave description alone", () => {
  const engine = memoryEngine(record([epic("a", { summary: "s", whyNow: "w", description: "d" })]));
  engine(["update-epic", "a", "--clear", "summary"]);
  assert.equal(onBoard(engine, "a").summary, null);
  assert.equal(onBoard(engine, "a").whyNow, "w");
  engine(["update-epic", "a", "--clear", "why-now"]);
  assert.equal(onBoard(engine, "a").whyNow, null);
  assert.equal(onBoard(engine, "a").description, "d");
});

unitTest("summary: the nullable-field registry declares both fields", () => {
  const flags = nullableEpicFlags("update-epic").map(r => r.flag);
  assert.ok(flags.includes("summary") && flags.includes("why-now"));
  assert.ok(nullableEpicFlags("add-many").some(r => r.key === "whyNow"));
});

unitTest("warning: moving an epic out of untriaged without them warns on stderr, exits 0 and still writes", () => {
  const engine = memoryEngine(record([epic("a", { status: "untriaged" })]));
  const r = engine.result(["update-epic", "a", "--status", "queued"]);
  assert.equal(r.status, 0);
  assert.match(r.stderr, SUMMARY_WARNING);
  assert.match(r.stderr, /--why-now/);
  assert.match(r.stderr, /\ba\b/);
  assert.equal(engine.store.record().epics[0].status, "queued");
  assert.equal(r.stderr.split("\n").filter(l => SUMMARY_WARNING.test(l)).length, 1, "one stderr line");
});

unitTest("warning: names only the missing field", () => {
  const engine = memoryEngine(record([epic("a", { status: "untriaged", summary: "s" })]));
  const r = engine.result(["update-epic", "a", "--status", "queued"]);
  assert.match(r.stderr, /--why-now/);
  assert.doesNotMatch(r.stderr, /--summary/);
});

unitTest("warning: a complete epic does not warn", () => {
  const engine = memoryEngine(record([epic("a", { status: "untriaged", summary: "s", whyNow: "w" })]));
  const r = engine.result(["update-epic", "a", "--status", "queued"]);
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stderr, /--summary|--why-now/);
});

unitTest("warning: registering an epic at a status other than untriaged or archived warns; at untriaged it does not", () => {
  const engine = memoryEngine(record());
  assert.match(engine.result(["add-epic", "--id", "q", "--lane", "claude-code"]).stderr, SUMMARY_WARNING);
  assert.doesNotMatch(engine.result(["add-epic", "--id", "u", "--lane", "claude-code", "--status", "untriaged"]).stderr, SUMMARY_WARNING);
  assert.match(engine.result(["add-many", "--from", "-"], { input: JSON.stringify({ epics: [{ id: "m", title: "M", lane: "claude-code" }] }) }).stderr, SUMMARY_WARNING);
});

unitTest("warning: every other write that leaves untriaged warns too (set-active)", () => {
  const engine = memoryEngine(record([epic("a", { status: "untriaged" })]));
  const r = engine.result(["set-active", "a"]);
  assert.equal(r.status, 0);
  assert.match(r.stderr, SUMMARY_WARNING);
});

unitTest("warning: archiving never warns, nor does a write that leaves the status unchanged", () => {
  const engine = memoryEngine(record([epic("a", { status: "untriaged" }), epic("b", { status: "queued" })]));
  const archived = engine.result(["update-epic", "a", "--status", "archived", "--outcome", "declined", "--reason", "out of scope", "--no-deferrals"]);
  assert.equal(archived.status, 0, archived.stderr);
  assert.doesNotMatch(archived.stderr, SUMMARY_WARNING);
  const notes = engine.result(["update-epic", "b", "--notes", "x"]);
  assert.equal(notes.status, 0);
  assert.doesNotMatch(notes.stderr, SUMMARY_WARNING);
});

unitTest("warning: an epic already queued, re-sent --status queued, does not warn (status unchanged)", () => {
  const engine = memoryEngine(record([epic("b", { status: "queued" })]));
  assert.doesNotMatch(engine.result(["update-epic", "b", "--status", "queued"]).stderr, SUMMARY_WARNING);
});

unitTest("warning: an unknown flag is still refused (the new flags did not open the surface)", () => {
  expectFail(() => memoryEngine(record([epic("a")]))(["update-epic", "a", "--sumary", "x"]));
});
