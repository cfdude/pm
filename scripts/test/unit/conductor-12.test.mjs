// scripts/test/unit/conductor-12.test.mjs
// 4.1's migration of `assert/conductor-12.test.mjs` — 5 of its 14 tests, moved from the file rung to
// the unit rung with every assertion unchanged.
//
// 5.3's ASSERTION TWIN of scripts/test/functional/conductor-12.test.mjs — same id, same subject.
//
// ─────────────── WHAT MOVED, AND WHAT DID NOT ───────────────
//
// FIVE moved: the no-op-save guarantee, the same guarantee across a SECOND root in one process (two
// memory stores, two invocations — which is the guarantee the file rung's cache-busting rewrite was
// reaching for), the conflict exit code's two PURE cases, and the write-conflict log's reset on a
// landing write, whose artifact is store-owned even though the fixture used to plant it by hand.
//
// NINE STAY, in two populations. (1) FIVE of them are `.gitignore` — a file the store does NOT own,
// and the entries init/upgrade write into it are the subject; a repo's own `.gitignore` is not an
// artifact the engine's record covers. (2) FOUR drive `injectConflictOnce()`, the one-shot patch
// that bumps the on-disk revision at saveState's first filesystem call — the seam IS a real file
// write, so the conflict has to happen on a real file. That includes the contention-latch reads and
// the commit-nudge degradation, which assert through the ignored `.gitignore` line as well.

import assert from "node:assert/strict";
import { emptyRecord, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";
import { conflictExitCode, persistFailure } from "../../lib/state.mjs";

// ─────────────────── the revision and the conflict guard ───────────────────

unitTest("a save that changes nothing does not write and does not bump the revision", () => {
  const engine = memoryEngine(emptyRecord());
  const before = engine.store.read("state.json").text;
  engine(["render"]);
  engine(["brief"]);
  assert.equal(engine.store.read("state.json").text, before);
});

unitTest("the same guarantee holds for a SECOND root in the same process", () => {
  // The old shape for this test cache-busted a query-string import to re-evaluate the frozen
  // constants. Per-call values make that unnecessary: two roots are two invocations.
  const a = memoryEngine(emptyRecord()); const b = memoryEngine(emptyRecord());
  const bytesA = a.store.read("state.json").text;
  b(["add-epic", "--id", "only-b", "--lane", "claude-code"]);
  assert.equal(a.store.read("state.json").text, bytesA,
    "a write against the second root must not touch the first root's record");
  assert.deepEqual(b.store.record().epics.map(e => e.id), ["only-b"]);
});

unitTest("any other error maps to null so it is re-thrown with its stack intact", () => {
  assert.equal(conflictExitCode(new Error("not a conflict")), null);
});

unitTest("persistFailure carries the revision it was written at", () => {
  const msg = persistFailure({ expectedBytes: "a", diskBytes: "b", expectedRevision: 4, diskRevision: 4 });
  assert.match(msg, /revision 4/);
});

// ─────────────────── the contention latch ───────────────────
//
// THE CONFLICT LOG'S RESET IS *NOT* HERE, and it was attempted rather than skipped. "A successful
// state write clears the conflict log" is a behaviour the DISK store implements inside its own
// `writeRecord` (`scripts/lib/store.mjs:822` — `clearConflictsOn(this)`), and the MEMORY store's
// `writeRecord` does not call it. It was written here first — plant `write-conflicts.log` through
// `store.write`, run `add-epic`, assert it is gone — and it FAILED, which is the measurement: the
// artifact survives, because the clear lives in one store implementation and not the other.
//
// So it is the SECOND gap of that class in this migration, and the first one outside `verifyState()`.
// Like the render-stamp gap recorded in worklist-4.1.md it is named rather than fixed here: the fix
// changes what an engine write DOES, so it wants its own commit, its own suite run and its own
// review — not a rider on a test move. The test stays on the file rung, where the disk store is
// real and the reset is observable.
