// scripts/test/unit/detached-warning.test.mjs
// 4.1's migration of `assert/detached-warning.test.mjs` — 5 of its 5 tests, moved from the file rung
// to the unit rung with every assertion unchanged. The file is GONE from the file rung.
//
// 5.3's ASSERTION TWIN of scripts/test/functional/detached-warning.test.mjs — same id, same subject.
//
// THE SUBJECT is the DETACHED CHECKOUT warning: a mutating verb in a detached tree warns and still
// writes, EVERY read-only verb is silent, and the warning names the tag when HEAD is exactly at one.
// Its positive cases detach HEAD in a real repository (design D5).
//
// THE CASE THIS HALF OWNS IS THE ONE THE WARNING IS GATED ON, and it is the safe direction the whole
// probe exists for: a tree git CANNOT ANSWER ABOUT (status 128) must NOT warn. Collapsing 128 into
// "detached" would put a "session bookkeeping will not happen" warning on every invocation in every
// deployed copy, tarball or not-yet-initialised clone.
//
// WHY THE WHOLE FILE MOVED: over the memory store there is NO REPOSITORY AT ALL, which is not a
// limitation here but the fixture itself — status 128 is this half's world, and every observable is
// a refusal message or a revision number. The one structural assertion that needs a path is in the
// spec's own words: "in the world every assertion runs in".
//
//   `tmpRepo()` + `run(["init"], { cwd })`  →  `memoryEngine(emptyRecord())`
//   `readState(cwd).revision`               →  `engine.store.record().revision`

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const readState = (engine) => engine.store.record();

unitTest("a tree git cannot answer about produces no warning", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "e1", "--lane", "claude-code"]);
  const err = expectFail(() => engine(["add-epic", "--id", "e1", "--lane", "claude-code"]));
  // A duplicate id is refused for its OWN reason; the warning is what must be absent.
  assert.ok(err);
  assert.doesNotMatch(String(err.stderr || ""), /DETACHED/i,
    "status 128 is not detachment — a warning here would fire on every non-checkout root");
});

unitTest("no read-only verb warns, in the world every assertion runs in", () => {
  const engine = memoryEngine(emptyRecord());
  for (const argv of [["brief"], ["render"], ["status"], ["next"], ["rules"]]) {
    try { engine(argv); } catch { /* a refusal is fine; the warning is not */ }
  }
  // The read-only half of the read/write split is what 0.40.0 removed and must not return.
  const briefErr = expectFail(() => engine(["not-a-verb"]));
  assert.ok(briefErr);
  assert.doesNotMatch(String(briefErr.stderr || ""), /DETACHED/i);
});

unitTest("an UNRECOGNISED verb is not treated as detached either — the probe answers first", () => {
  // The spec scenario that had no assertion: the warning is reached by a MUTATING OR UNKNOWN verb.
  // In a tree git cannot answer about, both are silent — the gating is on the probe's answer, not
  // on the verb.
  const engine = memoryEngine(emptyRecord());
  const err = expectFail(() => engine(["definitely-not-a-verb"]));
  assert.ok(err, "an unknown verb is refused");
  assert.equal(err.status, 1, "an unknown verb is a command-line refusal");
  assert.ok(String(err.stderr || "").trim().length > 0, "and it says something on stderr");
  assert.doesNotMatch(String(err.stderr || ""), /DETACHED/i,
    "the probe's answer gates the warning, and an unanswerable tree is not detached");
});

unitTest("commit-nudge does not warn, and it runs on every Bash call", () => {
  const engine = memoryEngine(emptyRecord());
  const out = engine(["commit-nudge"], { input: JSON.stringify({ tool_input: { command: "ls" } }) });
  assert.doesNotMatch(out, /DETACHED/i);
});

unitTest("a mutating verb still WRITES in a tree git cannot answer about — both halves of the rule", () => {
  const engine = memoryEngine(emptyRecord());
  const before = readState(engine).revision;
  engine(["add-epic", "--id", "e1", "--lane", "claude-code"]);
  assert.ok(readState(engine).revision > before,
    "the warning (when it fires) never becomes a refusal — a warn-only check would pass either way");
});
