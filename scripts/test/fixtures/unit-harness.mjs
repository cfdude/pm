// scripts/test/fixtures/unit-harness.mjs
// THE UNIT RUNG'S BINDING (0.48.0, design D4/D7).
//
// WHAT A UNIT TEST IS HERE. A test whose observable is a VALUE the engine produced — a verb's
// result, a refusal, or any value the record holds — obtained through an IN-MEMORY store the test
// supplies. No tmpdir, no fsync, no render to disk. The rung exists because the assertion half spent
// 12,524 `fsyncSync` calls per run (task 0.3(c)) on tests that read a value back out of an object,
// and with those flushes removed the SAME 1,243 tests pass in 12.2 s against 73.2 s.
//
// THE TWO GUARDS ARE BOTH REQUIRED, and each covers what the other cannot:
//   * the SOURCE SCAN (assert-half-has-no-spawn.test.mjs) refuses a unit FILE that names the
//     filesystem — it is what makes the rung's membership rule LOUD for the direction that would
//     otherwise be a silently slow test;
//   * the RUN-TIME COUNTER (fixtures/fs-work-counter.mjs) catches a call reached three modules away,
//     which no scan of the test file can see.
//
// THE COUNTER IS SCOPED PER TEST, which is why every unit test goes through `unitTest()` rather than
// calling node:test directly: the reset-before and assert-after pair is the mechanism, and a test
// that did the reset itself could forget the assert.
//
// THE GIT DOUBLE IS THE ASSERTION HALF'S, because the unit rung IS the assertion half — a rung, not
// a third half (design D2). So a unit test also inherits the no-spawn and no-real-git properties,
// and `assert-half-has-no-spawn.test.mjs`'s source scan walks this directory too.

import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { invokeEngine } from "./assert-harness.mjs";
import { armFsCounter, disarmFsCounter, describeFsWork } from "./fs-work-counter.mjs";
import { memoryStore } from "../../lib/store.mjs";

/** A CWD THAT NEED NOT EXIST, and that is the point. A memory-store invocation has no path to write
 *  to, so its working directory is a value the engine reads and never a directory anything touches.
 *  A `tmpRepo()` here would put `mkdtempSync` inside the very window the counter is watching. */
const VIRTUAL_ROOT = "/pm-unit-rung/no-such-directory";

/** One in-process invocation over an in-memory record.
 *
 *  Returns the memory store as well as the invocation, so a test reads the values a verb wrote back
 *  out of the object it supplied — which is the `engine-invocation` scenario, not a convenience. */
export function memoryEngine(seed) {
  const store = memoryStore(seed);
  const invoke = (args) => invokeEngine(args, { cwd: VIRTUAL_ROOT, store });
  invoke.store = store;
  return invoke;
}

/** The record a unit test starts from: an initialised conductor with no epics. */
export const emptyRecord = () => ({ version: 1, revision: 0, active: null, epics: [], detourStack: [] });

/** A record carrying one epic, which is what most verb tests need. `over` merges onto it. */
export function recordWithEpic(over = {}) {
  return {
    version: 1, revision: 1, active: null, detourStack: [],
    epics: [{
      id: "e1", title: "E1", priority: "P2", status: "queued", role: "epic",
      lane: "claude-code", links: [], ...over,
    }],
  };
}

/** The file that CALLED `unitTest()`, taken from the stack rather than passed in — a test cannot
 *  forget to declare itself, and a declared path could be wrong. */
function callingTestFile() {
  const stack = new Error().stack || "";
  const line = stack.split("\n").find((l) => /scripts\/test\/unit\/[^/]+\.test\.mjs/.test(l));
  const m = line && line.match(/(\/[^)\s]*scripts\/test\/unit\/[^/]+\.test\.mjs)/);
  return m ? m[1] : null;
}

/** A unit test. The counter is armed around the body and DISARMED after it, and what it reports
 *  must be empty — whatever the body did, including throwing, which is why the assertion runs before
 *  the body's own error is re-thrown rather than being skipped by it.
 *
 *  TWO ASSERTIONS, and each covers what the other cannot (the reasoning is in fs-work-counter.mjs):
 *  no WRITE or FLUSH from anywhere, and no READ from the test's own code at any depth. */
export function unitTest(name, fn) {
  // AT CALL TIME, NOT INSIDE THE BODY: `test()` runs its callback LATER, from the runner's own
  // frame, so a stack read inside the body no longer contains the file that declared the test.
  const actor = callingTestFile();
  assert.ok(actor, `${name}: unitTest() could not identify the calling test file — it is called ` +
    "from scripts/test/unit/<id>.test.mjs, and the counter keys its read check on that path");
  test(name, async (t) => {
    armFsCounter([actor]);
    let bodyError = null;
    try {
      await fn(t);
    } catch (e) {
      bodyError = e;
    }
    const work = disarmFsCounter();
    assert.deepEqual(work,
      { writes: [], ownReads: [] },
      `${name}: a unit-rung test performed filesystem work — ${describeFsWork(work)}. The rung exists ` +
      "because the assertion half's cost IS durability flushing on tests that assert on a value; a " +
      "test that reads or writes a path belongs on the FILE rung (scripts/test/assert/), where the " +
      "half's floors and fixtures live. See design D4 — this is the run-time half of the guard, and " +
      "the source scan next door cannot see a call reached through a helper.");
    if (bodyError) throw bodyError;
  });
}
