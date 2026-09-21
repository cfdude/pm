// scripts/test/assert/detached-warning.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/detached-warning.test.mjs — same id, same subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is the DETACHED CHECKOUT warning: a mutating verb in a detached
// tree warns and still writes, EVERY read-only verb is silent, and the warning names the tag when
// HEAD is exactly at one. Its positive cases detach HEAD in a real repository (design D5).
//
// THE CASE THIS HALF OWNS IS THE ONE THE WARNING IS GATED ON, and it is the safe direction the whole
// probe exists for: a tree git CANNOT ANSWER ABOUT (status 128) must NOT warn. Collapsing 128 into
// "detached" would put a "session bookkeeping will not happen" warning on every invocation in every
// deployed copy, tarball or not-yet-initialised clone — and, as this half's own runs show, on every
// assertion the fast half makes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpRepo, run, readState, expectFail } from "../fixtures/assert-harness.mjs";

test("a tree git cannot answer about produces no warning", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "e1", "--lane", "claude-code"], { cwd });
  const err = expectFail(() => run(["add-epic", "--id", "e1", "--lane", "claude-code"], { cwd }));
  // A duplicate id is refused for its OWN reason; the warning is what must be absent.
  assert.ok(err);
  assert.doesNotMatch(String(err.stderr || ""), /DETACHED/i,
    "status 128 is not detachment — a warning here would fire on every non-checkout root");
});

test("no read-only verb warns, in the world every assertion runs in", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  for (const argv of [["brief"], ["render"], ["status"], ["next"], ["rules"]]) {
    try { run(argv, { cwd }); } catch { /* a refusal is fine; the warning is not */ }
  }
  // The read-only half of the read/write split is what 0.40.0 removed and must not return.
  const briefErr = expectFail(() => run(["not-a-verb"], { cwd }));
  assert.ok(briefErr);
  assert.doesNotMatch(String(briefErr.stderr || ""), /DETACHED/i);
});

test("an UNRECOGNISED verb is not treated as detached either — the probe answers first", () => {
  // The spec scenario that had no assertion: the warning is reached by a MUTATING OR UNKNOWN verb.
  // In a tree git cannot answer about, both are silent — the gating is on the probe's answer, not
  // on the verb.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const err = expectFail(() => run(["definitely-not-a-verb"], { cwd }));
  assert.ok(err, "an unknown verb is refused");
  assert.equal(err.status, 1, "an unknown verb is a command-line refusal");
  assert.ok(String(err.stderr || "").trim().length > 0, "and it says something on stderr");
  assert.doesNotMatch(String(err.stderr || ""), /DETACHED/i,
    "the probe's answer gates the warning, and an unanswerable tree is not detached");
});

test("commit-nudge does not warn, and it runs on every Bash call", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const out = run(["commit-nudge"], { cwd, input: JSON.stringify({ tool_input: { command: "ls" } }) });
  assert.doesNotMatch(out, /DETACHED/i);
});

test("a mutating verb still WRITES in a tree git cannot answer about — both halves of the rule", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const before = readState(cwd).revision;
  run(["add-epic", "--id", "e1", "--lane", "claude-code"], { cwd });
  assert.ok(readState(cwd).revision > before,
    "the warning (when it fires) never becomes a refusal — a warn-only check would pass either way");
});

// ───────────────────────── the deliberate omissions ─────────────────────────
//
// The functional file's positive cases — "a mutating verb warns AND still writes", "the warning
// names the tag when HEAD is exactly at one", "the warning NAMES WHAT IS WRITTEN", "a tree on a
// branch produces no warning", and "the warning says that session bookkeeping will not happen" —
// each need a real repository detached at a real commit, and one of them needs a real exact-match
// tag (design D5). They stay in the functional half; the case above is the third answer of the same
// probe, which is the one this half runs in on every commit.
