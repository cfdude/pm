// scripts/test/assert/conductor-27.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/conductor-27.test.mjs — same id, same subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is gh#81 (the PROJECT.md commit loop, the render stamp, and the
// detour log's SHA idempotence) and gh#82 (the root-divergence warning). Almost none of it is git's
// behaviour: the render stamp is a file the engine writes, the divergence warning is a comparison of
// two paths, and the detour log is append-only bookkeeping.
//
// 4.1 (0.48.0) moved EIGHT of this file's eleven tests to `scripts/test/unit/conductor-27.test.mjs`:
// both render-loop tests, the `-`-sha detour-log pair, the stability-under-a-row test, the one-root
// gh#82 negative and the bookkeeping-only-change test. Their observables are PROJECT.md, the render
// stamp and the detour log — all store-owned artifacts.
//
// WHAT REMAINS IS THE TWO-ROOT HALF OF gh#82, and it is a FIXTURE boundary rather than a subject the
// memory store cannot express at all: these three need TWO initialized repos at two PATHS, and their
// assertions name BOTH paths in the emitted warning. A memory store models one root and has no path
// (`resolve()` returns null by design), so "is the target another initialized repo" would answer yes
// regardless of the path and the guard would be vacuous rather than tested.

import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpRepo, run, readState, invokeEngine } from "../fixtures/assert-harness.mjs";

// ─────────────────── gh#82: the root-divergence warning ───────────────────

test("gh#82: writing another initialized repo's conductor warns, names both paths, and still writes", () => {
  const target = tmpRepo(); run(["init"], { cwd: target });
  const here = tmpRepo(); run(["init"], { cwd: here });
  // cwd = here, root = target: the invocation was started somewhere other than the record it writes.
  const r = invokeEngine(["add-epic", "--id", "e1", "--lane", "claude-code"], { cwd: here, env: { CLAUDE_PROJECT_DIR: target } });
  assert.equal(r.status, 0, "the warning is not a refusal");
  const text = r.stdout + r.stderr;
  assert.match(text, /different repository|divergen/i, "it says what is happening");
  assert.ok(text.includes(target) && text.includes(here), "and names BOTH paths, or the reader cannot act");
  assert.deepEqual(readState(target).epics.map(e => e.id), ["e1"], "and the write still lands");
});

test("gh#82: a READ-ONLY verb does not claim to be writing a different repository", () => {
  const target = tmpRepo(); run(["init"], { cwd: target });
  const here = tmpRepo(); run(["init"], { cwd: here });
  const r = invokeEngine(["brief"], { cwd: here, env: { CLAUDE_PROJECT_DIR: target } });
  assert.doesNotMatch(r.stdout + r.stderr, /different repository|divergen/i,
    "the read/write split is read from verb-effects.mjs, not from a second list");
});

test("gh#82: a MUTATING verb in the same fixture still warns — the gate is not a blanket silence", () => {
  const target = tmpRepo(); run(["init"], { cwd: target });
  const here = tmpRepo(); run(["init"], { cwd: here });
  const mutating = invokeEngine(["log-detour", "x"], { cwd: here, env: { CLAUDE_PROJECT_DIR: target } });
  assert.match(mutating.stdout + mutating.stderr, /divergen|different repository/i);
});

// ───────────────────────── the deliberate omission ─────────────────────────
//
// "gh#81: the detour log is idempotent on SHA — the same commit is never logged twice", its control
// ("two different SHAs both get a row"), "a bookkeeping-only commit inside a detour writes no
// DETOUR-COMMIT row" and "a real commit inside a detour is still logged" all need REAL commits in a
// real repository, whose shas the log is keyed on — functional-only by subject (design D5). The `-`
// rows are the same key, in the world where every value is `-`, and they are asserted on the unit
// rung.

// ───────── hooks-not-silent-before-init (code review 0.43.0, C1): dormant means SILENT ─────────
// hooks/README.md promises the hooks are silent until /pm:init. commit-nudge fires on every Bash
// call; with CLAUDE_PROJECT_DIR at a repository pm never initialised it is dormant and writes
// nothing — and still printed "WRITING A DIFFERENT REPOSITORY", a warning about a write that never
// happens. `init` is the exception by construction: it is the one verb that writes into an
// uninitialised root, so it must keep warning when it is about to scaffold the wrong repository.
test("gh#82: a dormant hook in a root pm never initialised does not warn about a write it will not make", () => {
  const target = tmpRepo();                         // never initialised
  const here = tmpRepo(); run(["init"], { cwd: here });
  const r = invokeEngine(["commit-nudge"], { cwd: here, env: { CLAUDE_PROJECT_DIR: target },
    input: JSON.stringify({ tool_input: { command: "ls" } }) });
  assert.equal(r.status, 0);
  assert.equal(r.stdout + r.stderr, "", "a dormant hook prints nothing at all");
});
test("gh#82: `init` into an uninitialised root still warns — it is the one verb that writes there", () => {
  const target = tmpRepo();
  const here = tmpRepo(); run(["init"], { cwd: here });
  const r = invokeEngine(["init"], { cwd: here, env: { CLAUDE_PROJECT_DIR: target } });
  assert.match(r.stdout + r.stderr, /different repository/i);
});
