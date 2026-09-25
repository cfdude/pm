// scripts/test/unit/refusal-wording.test.mjs
// code-review-0-43-0-minors: two refusals whose text read wrong.
//
//   * The archive gate's handoff refusal said "2 of 1/3 task(s) outstanding" — a count followed by a
//     done/total fraction, which reads as a third number. It now says the count, then what is done.
//   * A state lock that is a special file (a FIFO, socket or device) was described as "a other".
//
// UNIT RUNG: both observables are text the engine produced; describeHolder() is a pure function.

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const STORE = new URL("../../lib/store.mjs", import.meta.url).href;

unitTest("the handoff refusal names the outstanding count, then what is done — never '2 of 1/3'", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "h", "--lane", "claude-code",
    "--add-story", "one", "--add-story", "two", "--add-story", "three"]);
  engine(["update-epic", "h", "--story", "1", "--done"]);
  const err = expectFail(() => engine(["update-epic", "h", "--status", "archived", "--outcome", "delivered",
    "--no-deferrals"]));
  assert.ok(err, "a delivered archive with open stories is refused");
  assert.match(err.stderr, /2 task\(s\) outstanding \(1\/3 done\)/);
  assert.doesNotMatch(err.stderr, /\d+ of \d+\/\d+ task/, "the old wording is gone");
});

unitTest("a lock that is a special file is described as one, not as 'a other'", async () => {
  const { describeHolder } = await import(STORE);
  assert.equal(describeHolder({ kind: "other" }), "not a lock file at all — a special file (a FIFO, socket or device)");
  assert.equal(describeHolder({ kind: "directory" }), "not a lock file at all — a directory");
  assert.equal(describeHolder({ kind: "file" }), "a writer whose lock content could not be read");
});

unitTest("the newer-revision conflict names both ways out: re-run, or --force to overwrite deliberately", async () => {
  // `--force` is accepted on every mutating verb, and the one refusal it answers never mentioned it.
  const { StateConflictError } = await import(STORE);
  const e = new StateConflictError(3, 4);
  assert.match(e.message, /read revision 3, found 4/);
  assert.match(e.message, /re-run the command/);
  assert.match(e.message, /--force only if you mean to overwrite that newer revision/);
  assert.doesNotMatch(new StateConflictError(3, 4, "a lock was held").message, /--force/,
    "a caller's own message is not rewritten — a held lock is not a newer revision --force answers");
});
