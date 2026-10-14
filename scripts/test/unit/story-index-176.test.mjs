// scripts/test/unit/story-index-176.test.mjs
// gh#176 — `--story <n>` is 1-indexed while `.conductor/state.json`'s `stories[]` is 0-indexed. Two
// halves: the index base is stated where the flag is read (`--help`, the registry's own placeholder),
// and a disposition recorded against the WRONG story has a correction path that keeps the original.

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const epicOf = (engine, id) => engine.store.record().epics.find(e => e.id === id);
const seed = () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code",
    "--add-story", "First", "--add-story", "Second", "--add-story", "Third"]);
  return engine;
};
const errText = (fn) => { const e = expectFail(fn); return String(e.stderr || e.message); };

unitTest("update-epic --help states that --story is 1-indexed", () => {
  const out = String(memoryEngine(emptyRecord())(["update-epic", "--help"]));
  const line = out.split("\n").find(l => /^\s*--story\b/.test(l));
  assert.ok(line, "help lists --story");
  assert.match(line, /1-indexed/);
  assert.doesNotMatch(line, /<a value>/);
});

unitTest("a successful --story write names the story it landed on, so an off-by-one is visible", () => {
  const engine = seed();
  const out = String(engine.combined(["update-epic", "a", "--story", "2", "--wont-do", "retired"]));
  assert.match(out, /story 2 \(1-indexed\)/);
  assert.match(out, /Second/);
});

unitTest("--story <n> --correct-disposition reopens a wrong wont-do and keeps the original beside it", () => {
  const engine = seed();
  engine(["update-epic", "a", "--story", "2", "--wont-do", "reason about the third story"]);
  engine(["update-epic", "a", "--story", "2", "--correct-disposition", "wrong index: meant story 3"]);
  const s = epicOf(engine, "a").stories[1];
  assert.equal(s.done, false);
  assert.equal(s.disposition, undefined, "the live field is cleared");
  assert.equal(s.corrections.length, 1);
  assert.equal(s.corrections[0].reason, "wrong index: meant story 3");
  assert.equal(s.corrections[0].prior.disposition.reason, "reason about the third story");
  assert.match(s.corrections[0].correctedAt, /^\d{4}-\d{2}-\d{2}T/);
});

unitTest("a wrong --done is correctable too, and the correction can re-apply the right mutation in the same call", () => {
  const engine = seed();
  engine(["update-epic", "a", "--story", "1", "--done"]);
  engine(["update-epic", "a", "--story", "1", "--correct-disposition", "meant story 2"]);
  assert.equal(epicOf(engine, "a").stories[0].done, false);
  assert.equal(epicOf(engine, "a").stories[0].corrections[0].prior.done, true);
  engine(["update-epic", "a", "--story", "1", "--done"]);
  assert.equal(epicOf(engine, "a").stories[0].done, true);
  // correct + apply atomically
  engine(["update-epic", "a", "--story", "1", "--correct-disposition", "still wrong", "--wont-do", "right reason"]);
  const s = epicOf(engine, "a").stories[0];
  assert.equal(s.done, false);
  assert.equal(s.disposition.reason, "right reason");
  assert.equal(s.corrections.length, 2, "a second correction is appended, never replaces the first");
});

unitTest("--story --correct-disposition on a story with nothing recorded is refused, nothing written", () => {
  const engine = seed();
  const before = engine.store.read("state.json").text;
  assert.match(errText(() => engine(["update-epic", "a", "--story", "3", "--correct-disposition", "x"])),
    /nothing to correct/);
  assert.equal(engine.store.read("state.json").text, before);
});

unitTest("--story --correct-disposition needs a reason and refuses --status archived beside it", () => {
  const engine = seed();
  engine(["update-epic", "a", "--story", "1", "--done"]);
  assert.match(errText(() => engine(["update-epic", "a", "--story", "1", "--correct-disposition"])),
    /requires a (value|reason)/);
  assert.match(errText(() => engine(["update-epic", "a", "--story", "1", "--correct-disposition", "x",
    "--status", "archived", "--outcome", "killed", "--reason", "r", "--no-deferrals"])),
    /story/i);
});

unitTest("without --correct-disposition the replacement guard still refuses (no relaxation)", () => {
  const engine = seed();
  engine(["update-epic", "a", "--story", "2", "--wont-do", "first"]);
  assert.match(errText(() => engine(["update-epic", "a", "--story", "2", "--wont-do", "second"])),
    /already carries a recorded disposition/);
});

unitTest("the guard's refusal names the correction path", () => {
  const engine = seed();
  engine(["update-epic", "a", "--story", "2", "--wont-do", "first"]);
  assert.match(errText(() => engine(["update-epic", "a", "--story", "2", "--done"])),
    /--correct-disposition/);
});
