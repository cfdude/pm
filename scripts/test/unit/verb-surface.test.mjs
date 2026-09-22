// scripts/test/unit/verb-surface.test.mjs
// 4.1's migration of `assert/verb-surface.test.mjs` — 2 of its 8 tests, moved from the file rung to
// the unit rung with every assertion unchanged.
//
// 5.3's ASSERTION TWIN of scripts/test/functional/verb-surface.test.mjs — same id, same subject.
//
// THE SUBJECT is what every dispatched verb accepts on its command line, and the guarantee that a
// REFUSED command line leaves every file exactly as it was. Its population is the DISPATCH TABLE read
// out of conductor.mjs, never a list typed here.
//
// ─────────────── WHAT MOVED, AND WHAT DID NOT ───────────────
//
// TWO moved, and they are the two whose observable is a REFUSAL ALONE: a read-only verb refusing an
// undeclared flag and `--force`, and an id given as a flag being diagnosed as the positional. Neither
// reads a file, and both are argv in and status/stderr out.
//
// SIX STAY, and every one of them derives its population from `dispatchKeys()` — the dispatch table
// read out of `conductor.mjs` — and then asserts over `WATCHED`, a four-path snapshot that includes
// `CLAUDE.md`, which the store does not own. The three sweeps are the reason: "every dispatched verb
// refuses an undeclared flag and writes nothing" is not assertable without watching the paths a
// refusal must leave alone. The dormancy guard asserts a DIRECTORY's absence, and the batch-key test
// writes a batch FILE, which is what that test is about.
//
//   `tmpRepo()` + `run(["init"], { cwd })`  →  `memoryEngine(emptyRecord())`
//   `invokeEngine(argv, { cwd })`           →  `engine.result(argv)`

import assert from "node:assert/strict";
import { emptyRecord, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const initialized = () => memoryEngine(emptyRecord());

unitTest("A read-only verb refuses an undeclared flag, and refuses --force", () => {
  const engine = initialized();
  for (const argv of [["brief", "--bogus"], ["brief", "--force"], ["status", "--force"]]) {
    const r = engine.result(argv);
    assert.notEqual(r.status, 0, `${argv.join(" ")} must be refused`);
  }
});

unitTest("An id given as a flag is diagnosed as the positional", () => {
  const engine = initialized();
  engine(["add-epic", "--id", "e1", "--lane", "claude-code"]);
  const r = engine.result(["update-epic", "--id=e1", "--priority", "P1"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /update-epic e1 --priority P1/, "the diagnosis rewrites the line the caller meant");
});
