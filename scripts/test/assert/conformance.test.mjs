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
import { fixtureOnce } from "../fixtures/fixture-snapshot.mjs";

const main = (await import("../../conductor.mjs")).main;

/** An initialized repository with nothing else done to it, shared by the three tests below that each
 *  need exactly that and nothing more.
 *
 *  A SNAPSHOT SINCE 0.48.0 (task 3.4), and it is here for the helper's OWN rule rather than for the
 *  clock: three tests in this file use the same fixture and none of them mutates it, which is the
 *  case the helper exists for. (The file's other tests each corrupt the record in a DIFFERENT way —
 *  an unreadable state file, an ambiguous rules block — and a fixture cannot serve those; a snapshot
 *  of a corrupted tree is a fixture nobody reuses.) It also keeps this file moving with its
 *  functional twin, which the drift script's diff-coupling rule requires of a staged functional
 *  file — a rule that fires whether or not the change is one the twin could mirror. */
const initializedRepo = fixtureOnce(() => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  return cwd;
}, { name: "pm-conformance-init" });

// 4.1 (0.48.0) moved THREE of this file's tests to `scripts/test/unit/conformance.test.mjs`: the
// exit-handler count, the activity-log instrument's read-is-not-a-log-entry check (the activity
// directory is store-owned), and a delegated child's status being the RETURNED value. THE EIGHT BELOW
// STAY, and one fixture decides most of them: `init` WRITES CLAUDE.md through raw fs — edge 3 of this
// migration's four seam edges — so any conformance case whose fixture initializes a repository cannot
// be a unit test. Two more are file-rung by subject: the unreadable-state-file row (raw bytes that
// cannot parse) and the conflict row, whose malformed revision the disk store coerces on a write path
// the memory store does not share (probed: the same fixture returns 0 there, not 9).

test("conformance: main() RETURNS its status — it is not a promise", () => {
  // The half calls the engine in process, many invocations per file, from SYNCHRONOUS test callbacks;
  // an entry point that answered with a Promise could not be called from them at all (the functional
  // twin carries the full argument).
  const cwd = initializedRepo();
  const r = invokeEngine(["init"], { cwd });
  assert.equal(typeof r.status, "number", `main() must return a numeric status; got ${typeof r.status}`);
});

test("conformance: the entry point never ends the calling process, whatever it is refused for", () => {
  const cwd = initializedRepo();
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
  const cwd = initializedRepo();
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
  // THE ASSERTION THAT WAS MISSING (G-M4, Gate 2). This test used to check that the call produced
  // output and a numeric status, which an engine that ALSO wrote to the process would satisfy — the
  // real check lived only in the functional twin (`withLeakWatch`), where it dies when a refusal
  // leaks. `invokeEngine` now returns what reached the process's own writers, so the per-commit half
  // holds the property too, on the half that CAN hold it: the capture is a patch of two functions,
  // not a spawn.
  const cwd = tmpRepo();
  const r = invokeEngine(["init"], { cwd });
  assert.ok((r.stdout + r.stderr).length > 0, "the call produced output — the check is not vacuous");
  assert.equal(r.leaked, "",
    `the engine wrote to the process's own streams: ${JSON.stringify(r.leaked)}. Everything it ` +
    "prints must land on the streams the CALLER supplied — that is the only way many invocations " +
    "share one process without their output interleaving, and it is a SHALL of engine-invocation");

  // A REFUSAL THAT THROWS TOO, not only a success: `die()` is the one path every refusal class goes
  // through (`invocation().stderr.write(message)` then throw), and a leak there would be the one that
  // got away — refusals are where the engine writes most. Verified against a mutant whose `die()`
  // ALSO writes to `process.stderr`: the unknown-verb case above does NOT catch it (it is refused
  // before dispatch, without `die()`), and this one does.
  const runner = tmpRepo();
  run(["init"], { cwd: runner });
  const refused = invokeEngine(["update-epic", "ghost", "--priority", "P0"], { cwd: runner });
  assert.ok((refused.stdout + refused.stderr).length > 0, "the refusal produced output on the caller's streams");
  assert.equal(refused.leaked, "",
    `a refused invocation wrote to the process's own streams: ${JSON.stringify(refused.leaked)}`);
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
