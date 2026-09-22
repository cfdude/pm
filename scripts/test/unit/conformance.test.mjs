// scripts/test/unit/conformance.test.mjs
// 4.1's migration of `assert/conformance.test.mjs` — 3 of its 11 tests, moved from the file rung to
// the unit rung with every assertion unchanged.
//
// 5.3's ASSERTION TWIN of scripts/test/functional/conformance.test.mjs — same id, same subject.
//
// THE SUBJECT is D10's conformance set: each class of invocation run BOTH ways — as a spawned CLI
// reading the real process status, and in-process through the entry point reading the RETURNED
// value — asserting the two are equal. The CLI route SPAWNS by design, so it is functional-only.
// The IN-PROCESS half is this twin's subject.
//
// ─────────────── WHAT MOVED, AND WHAT DID NOT ───────────────
//
// THREE moved: the exit-handler count (five `brief` invocations in one process), the activity-log
// instrument's "a read is not a log entry" (the activity directory is STORE-owned, so its file count
// is `store.list("activity/")`), and a delegated child's status being the RETURNED value.
//
// EIGHT STAY, and ONE fixture decides all of them: `init` WRITES `CLAUDE.md` through raw fs — this
// migration's edge 3 — so any conformance case whose fixture runs `init` cannot be a unit test. That
// is most of the file by construction: the status classes, the refusal classes, the two-roots
// independence test, the two delegated-child tests and the conflict test all begin by initializing a
// repository. Two more are file-rung by subject rather than by fixture: the unreadable-state-file row
// (raw bytes that cannot parse) and the stream-leak test, whose second half needs a refusal to have
// run against an initialized tree.
//
//   `tmpRepo()` + `run(["init"], { cwd })`  →  `memoryEngine(emptyRecord())`
//   `.conductor/activity/` walk             →  `store.list("activity/")`

import assert from "node:assert/strict";
import { emptyRecord, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

unitTest("conformance: the engine registers no process exit handler", () => {
  const engine = memoryEngine(emptyRecord());
  const before = process.listenerCount("exit");
  for (let i = 0; i < 5; i++) engine(["brief"]);
  assert.equal(process.listenerCount("exit"), before,
    "an exit handler left behind would accumulate one listener per invocation in the shared " +
    "assertion process, and the activity log would be written once at process end for all of them");
});

unitTest("conformance: the activity-log instrument runs inside main(), not at process end", () => {
  const engine = memoryEngine(emptyRecord());
  const files = () => engine.store.list("activity/").filter(n => /^activity-.*\.log$/.test(n)).length;
  const before = files();
  // The read paths write nothing; a mutating verb writes one line BEFORE main() returns, so a
  // caller can read it the moment the call is over.
  engine(["brief"]);
  assert.equal(files(), before, "reads are not log entries");
});

unitTest("conformance: a delegated child's status is what main() RETURNS", () => {
  // The delegation handoff owns the whole invocation, and D2 keeps its exit as a VALUE rather than
  // a `process.exit`. Without the opt-in the handoff never fires, so the returned status is this
  // invocation's own — which is the assertion this half can make (the delegated route is
  // functional-only: it spawns a child).
  const engine = memoryEngine(emptyRecord());
  const r = engine.result(["--help"], { env: { PM_ENGINE_DELEGATION: "" } });
  assert.equal(r.status, 0);
});
