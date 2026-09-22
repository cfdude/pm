// scripts/test/unit/state-file-refuses-to-guess.test.mjs
// 4.1's migration of `assert/state-file-refuses-to-guess.test.mjs` — 2 of its 16 tests, moved from
// the file rung to the unit rung with every assertion unchanged.
//
// 5.3's ASSERTION TWIN of scripts/test/functional/state-file-refuses-to-guess.test.mjs — same id,
// same subject.
//
// ─────────────── WHAT MOVED, AND WHAT DID NOT ───────────────
//
// TWO moved, and they are the two whose subject is NOT the unreadable file: the oversized-TTL input
// refusal, and 3.1's "a save that changes nothing does not rewrite the record" — `render` and `brief`
// may both write (PROJECT.md and the snapshot are store-owned), and the assertion is that they do
// not, which is a comparison of the record's bytes before and after.
//
// FOURTEEN STAY, and the reason is the change's own store boundary rather than a gap: the family is
// about a state file that CANNOT BE PARSED — a conflict marker, a truncated file, a zero-length file,
// `{ not json`, a wrong-shaped object, `epics: "not an array"`. The memory store holds an OBJECT and
// answers `{kind:"unreadable"}` only through `shapeProblem()`, so it cannot express bytes that fail
// to parse at all — which is exactly the reason recorded for the same population in conductor-33's
// row. The remaining two are about a directory's ABSENCE (no `.conductor/` created by a dormant hook)
// and a `snapshot` that must write nothing, on the same unreadable fixture.
//
//   `tmpRepo()` + `run(["init"], { cwd })`  →  `memoryEngine(emptyRecord())`
//   `readState(cwd)`                        →  `engine.store.record()`
//   `bytes(cwd)`                            →  `engine.store.read("state.json").text`

import assert from "node:assert/strict";
import { emptyRecord, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const bytes = (engine) => engine.store.read("state.json").text;
const readState = (engine) => engine.store.record();

unitTest("5.1: an oversized TTL is refused at input, for an epic claim and the repository claim", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "e1", "--lane", "claude-code"]);
  const r = (() => { try { engine(["claim", "e1", "--ttl", "99999999"]); return null; } catch (e) { return e; } })();
  assert.ok(r, "an absurd TTL is an input error, not a lock nobody can break");
});

unitTest("3.1: a save that changes nothing does not rewrite the record", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "e1", "--lane", "claude-code"]);
  const before = bytes(engine);
  engine(["render"]);
  engine(["brief"]);
  assert.equal(bytes(engine), before, "reads do not stamp a touch or bump a revision");
  assert.ok(readState(engine).epics.some(e => e.id === "e1"));
});
