// scripts/test/unit/conductor-30.test.mjs
// 4.1's migration of `assert/conductor-30.test.mjs` — 5 of its 11 tests, moved from the file rung to
// the unit rung with every assertion unchanged.
//
// 5.3's ASSERTION TWIN of scripts/test/functional/conductor-30.test.mjs — same id, same subject.
//
// ─────────────── WHAT MOVED, AND WHAT DID NOT ───────────────
//
// FIVE moved, and they are all of gh-149's and gh-152's argv family: a value-bearing flag with no
// value is refused, the refusal is per OCCURRENCE rather than per flag, it lands BEFORE any state is
// loaded, and nothing is written. The observable is the refusal text, the exit status and the record's
// bytes — values, every one of them, so `stateBytes(cwd)` becomes `store.read("state.json").text`.
//
// SIX STAY, and gh-148 is why: `verify-specs` WALKS `openspec/` — an absent root, a metadata block,
// a directory of spec documents are all things it looks for on disk, and the fixture that builds
// them writes paths. The two `add-many` tests stay for the batch file all the `add-many` fixtures
// share. That is the seam edge "a fixture that writes a path" plus this verb's own subject.
//
//   `tmpRepo()` + `run(["init"], { cwd })`  →  `memoryEngine(emptyRecord())`
//   `repo()` (init + one epic)              →  `memoryEngine(emptyRecord())` + one `add-epic`
//   `readState(cwd)`                        →  `engine.store.record()`
//   `stateBytes(cwd)`                       →  `engine.store.read("state.json").text`

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const repo = () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "e1", "--title", "t", "--lane", "claude-code"]);
  return engine;
};
const stateBytes = (engine) => engine.store.read("state.json").text;
const readState = (engine) => engine.store.record();

// ─────────────────── gh-149: a valueless occurrence is refused ───────────────────

unitTest("gh-149: add-epic --plan with no value is refused — the asymmetry this issue is about", () => {
  const engine = memoryEngine(emptyRecord());
  const before = stateBytes(engine);
  const err = expectFail(() => engine(["add-epic", "--id", "e1", "--title", "t", "--lane", "claude-code", "--plan"]));
  assert.ok(err, "a value-bearing flag with no value must refuse, not silently take nothing");
  assert.match(String(err.stderr || ""), /--plan requires/);
  assert.equal(stateBytes(engine), before, "and it refuses BEFORE any state is written");
});

unitTest("gh-149: every value-bearing flag on add-epic refuses a valueless occurrence", () => {
  // The population is short and named here, because the sweep over EVERY registered flag lives in
  // the functional half; these are the ones whose refusal text the sharpest cases depend on.
  const engine = memoryEngine(emptyRecord());
  for (const flag of ["--title", "--lane", "--priority", "--notes", "--description"]) {
    const err = expectFail(() => engine(["add-epic", "--id", "e1", flag]));
    assert.ok(err, `${flag} with no value must be refused`);
    assert.match(String(err.stderr || ""), new RegExp(`${flag} requires`));
  }
});

unitTest("gh-149: a REPEATABLE flag is refused when ANY occurrence is valueless, not just the first", () => {
  const engine = repo();
  const before = stateBytes(engine);
  const err = expectFail(() => engine(["update-epic", "e1", "--add-story", "one", "--add-story"]));
  assert.ok(err, "the SECOND occurrence is what makes this a sweep rather than a first-token check");
  assert.equal(stateBytes(engine), before);
});

unitTest("gh-149: the refusal lands BEFORE any state is loaded or written, on every surface", () => {
  for (const argv of [
    ["add-epic", "--id", "e1", "--title"],
    ["update-epic", "e1", "--priority"],
    ["set-autonomy", "e1", "--level"],
    ["release", "1.0", "--intent"],
  ]) {
    const engine = repo();
    const before = stateBytes(engine);
    const err = expectFail(() => engine(argv));
    assert.ok(err, `${argv.join(" ")} must be refused`);
    assert.equal(stateBytes(engine), before, `${argv[0]} wrote state while refusing`);
  }
});

unitTest("gh-152's sharpest case: `set-autonomy --level` with no value writes no autonomy block", () => {
  const engine = repo();
  assert.ok(expectFail(() => engine(["set-autonomy", "e1", "--level"])));
  assert.equal(readState(engine).epics.find(e => e.id === "e1").autonomy, undefined);
});
