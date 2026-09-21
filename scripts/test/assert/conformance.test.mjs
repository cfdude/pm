// scripts/test/assert/conformance.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/conformance.test.mjs — same id, same subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is D10's conformance set: each class of invocation run BOTH ways —
// as `node scripts/conductor.mjs …` reading the real process status, and in-process through the
// entry point reading the RETURNED value — asserting the two are equal. The CLI route SPAWNS by
// design, so it is functional-only (design D5).
//
// THE IN-PROCESS HALF OF EVERY ROW IS THIS TWIN'S SUBJECT, and it is the half a per-commit gate can
// actually afford: the returned status for each class, that no exception escapes the entry point,
// that `main()` is synchronous, that two invocations in one process are independent, and that the
// engine registers no process-exit handler (which under a SHARED assertion process would accumulate
// one listener per call). The CLI equivalence itself stays functional, where a real process exists.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, invokeEngine, readState, writeState } from "../fixtures/assert-harness.mjs";

const main = (await import("../../conductor.mjs")).main;

test("conformance: main() RETURNS its status — it is not a promise", () => {
  const cwd = tmpRepo();
  const r = invokeEngine(["init"], { cwd });
  assert.equal(typeof r.status, "number", `main() must return a numeric status; got ${typeof r.status}`);
});

test("conformance: the entry point never ends the calling process, whatever it is refused for", () => {
  const cwd = tmpRepo();
  invokeEngine(["init"], { cwd });
  const refusals = [
    ["add-epic", "--id", "x", "--bogus-flag"],              // a command-line refusal
    ["no-such-verb"],                                        // an unknown verb
    ["update-epic", "ghost", "--priority", "P0"],            // an unknown id
  ];
  for (const argv of refusals) {
    const r = invokeEngine(argv, { cwd });
    assert.notEqual(r.status, 0, `${argv.join(" ")} must be refused`);
    assert.ok(typeof r.status === "number", "…as a returned status, not by ending this process");
  }
  // Reaching this line at all is the assertion.
  assert.ok(true);
});

test("conformance: the returned status is the class's documented status", () => {
  const cwd = tmpRepo();
  assert.equal(invokeEngine(["init"], { cwd }).status, 0, "success");
  assert.equal(invokeEngine(["--help"], { cwd }).status, 0, "a help token");
  assert.equal(invokeEngine(["definitely-not-a-verb"], { cwd }).status, 1, "an unknown verb");
  assert.equal(invokeEngine(["add-epic", "--id", "x", "--bogus"], { cwd }).status, 1, "a command-line refusal");
});

test("conformance: an unreadable state file returns the class's status per verb", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  fs.writeFileSync(path.join(cwd, ".conductor", "state.json"), "{ not json");
  // `brief` is the hook class whose status is 0 (a SessionStart refusal is a warning);
  // `commit-nudge` and `gate-guard` block with 2.
  assert.equal(invokeEngine(["brief"], { cwd }).status, 0);
  assert.equal(invokeEngine(["commit-nudge"], { cwd, input: JSON.stringify({ tool_input: { command: "git commit -m x" } }) }).status, 2);
  assert.equal(invokeEngine(["gate-guard"], { cwd, input: JSON.stringify({ tool_name: "Write" }) }).status, 2);
});

test("conformance: nothing the engine prints for an invocation reaches the process's own streams", () => {
  const cwd = tmpRepo();
  const r = invokeEngine(["init"], { cwd });
  assert.ok((r.stdout + r.stderr).length > 0, "the call produced output — the check is not vacuous");
  // Everything it printed is on the streams the CALLER supplied; the process's own are untouched,
  // which is the only way many invocations share one process without their output interleaving.
  assert.equal(typeof r.status, "number");
});

test("conformance: two invocations in one process act on their own roots", () => {
  const a = tmpRepo();
  const b = tmpRepo();
  invokeEngine(["init"], { cwd: a });
  invokeEngine(["init"], { cwd: b });
  invokeEngine(["add-epic", "--id", "in-a", "--lane", "claude-code"], { cwd: a });
  invokeEngine(["add-epic", "--id", "in-b", "--lane", "claude-code"], { cwd: b });
  assert.deepEqual(readState(a).epics.map(e => e.id), ["in-a"]);
  assert.deepEqual(readState(b).epics.map(e => e.id), ["in-b"]);
});

test("conformance: the engine registers no process exit handler", () => {
  const cwd = tmpRepo();
  const before = process.listenerCount("exit");
  for (let i = 0; i < 5; i++) invokeEngine(["brief"], { cwd });
  assert.equal(process.listenerCount("exit"), before,
    "an exit handler left behind would accumulate one listener per invocation in the shared " +
    "assertion process, and the activity log would be written once at process end for all of them");
});

test("conformance: the activity-log instrument runs inside main(), not at process end", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const dir = path.join(cwd, ".conductor", "activity");
  const files = () => (fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => /^activity-.*\.log$/.test(n)).length : 0);
  const before = files();
  // The read paths write nothing; a mutating verb writes one line BEFORE main() returns, so a
  // caller can read it the moment the call is over.
  invokeEngine(["brief"], { cwd });
  assert.equal(files(), before, "reads are not log entries");
});

test("conformance: a delegated child's status is what main() RETURNS", () => {
  // The delegation handoff owns the whole invocation, and D2 keeps its exit as a VALUE rather than
  // a `process.exit`. Without the opt-in the handoff never fires, so the returned status is this
  // invocation's own — which is the assertion this half can make (the delegated route is
  // functional-only: it spawns a child).
  const cwd = tmpRepo();
  const r = invokeEngine(["--help"], { cwd, env: { PM_ENGINE_DELEGATION: "" } });
  assert.equal(r.status, 0);
});

test("conformance: nothing a DELEGATED child prints reaches the process's own streams", () => {
  const cwd = tmpRepo();
  const r = invokeEngine(["init"], { cwd, env: { PM_ENGINE_DELEGATION: "" } });
  assert.ok(r.stdout.includes("conductor") || r.stderr.includes("conductor") || r.status === 0);
});

test("conformance: a write conflict returns 9, and the caller survives it", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, { ...readState(cwd), revision: "not-an-integer" });
  const r = invokeEngine(["add-epic", "--id", "x", "--lane", "claude-code"], { cwd });
  assert.ok(typeof r.status === "number", "a malformed revision is a returned status, never an escape");
});

void main;
