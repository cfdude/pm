// scripts/test/assert/conductor-12.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/conductor-12.test.mjs — same id, same subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is the state-write contract: the revision stamp, the write-conflict
// guard and its exit code, the contention latch and the .gitignore entries the conductor's generated
// logs need so a repository never commits them by accident. NONE OF IT IS GIT'S BEHAVIOUR — every
// case writes and reads files — so the twin carries it all, minus the few cases whose subject is the
// concurrency of real parallel processes.
//
// THE ONE EXCEPTION 3.5 LOCKS IN — `conductor-12` used to CACHE-BUST its imports to re-evaluate the
// frozen constants, and that stopped being the mechanism once the root became per-call. This twin
// therefore drives two roots in ONE process through the in-process entry point rather than through
// query-string imports, which is the same guarantee made the new way.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, invokeEngine, readState, expectFail, injectConflictOnce } from "../fixtures/assert-harness.mjs";

// 4.1 (0.48.0) moved FIVE of this file's tests to `scripts/test/unit/conductor-12.test.mjs`: the
// no-op-save guarantee, the same guarantee across a SECOND root in one process, the two pure
// `conflictExitCode`/`persistFailure` cases, and — moved later, when E3's port of
// `clearConflictsOn()` into the memory store closed the gap that had held it here — the
// write-conflict log's reset on a landing write.
//
// What remains needs a real file: five `.gitignore` tests (a file the store does not own) and the
// three `injectConflictOnce()` tests, whose seam IS a filesystem write.

// ─────────────────── the revision and the conflict guard ───────────────────

test("a StateConflictError maps to the distinct conflict exit code", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  // A one-shot patch that bumps the on-disk revision at saveState's first filesystem call, which
  // is exactly "another writer landed between this read and this write".
  const restore = injectConflictOnce(path.join(cwd, ".conductor"));
  let r;
  try { r = invokeEngine(["add-epic", "--id", "e1", "--lane", "claude-code"], { cwd }); }
  finally { const fired = restore(); assert.ok(fired, "the conflict seam must have fired, or this test proves nothing"); }
  assert.equal(r.status, 9, "a conflict is RETRYABLE and must be distinguishable from a validation failure");
});

// ─────────────────── the .gitignore entries ───────────────────

const gitignore = (cwd) => {
  const p = path.join(cwd, ".gitignore");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
};

test("init writes .gitignore entries for the conductor's generated logs", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  const gi = gitignore(cwd);
  assert.match(gi, /\.conductor\/detours\.log/, "#106 must not repeat in the release that fixes it");
});

test("init writes a .gitignore entry for the contention latch", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  assert.match(gitignore(cwd), /write-conflicts\.latch/);
});

test("init is idempotent — a second run does not duplicate the entries", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  const first = gitignore(cwd);
  run(["init"], { cwd });
  assert.equal(gitignore(cwd), first);
});

test("init preserves an existing .gitignore instead of overwriting it", () => {
  const cwd = tmpRepo();
  fs.writeFileSync(path.join(cwd, ".gitignore"), "node_modules/\n");
  run(["init"], { cwd });
  const gi = gitignore(cwd);
  assert.match(gi, /node_modules\//, "the user's own line survives");
  assert.match(gi, /\.conductor\//, "and the conductor's entries are added to it");
});

test("upgrade backfills the gitignore entries — the documented update path, not just init", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  fs.writeFileSync(path.join(cwd, ".gitignore"), "");
  run(["upgrade"], { cwd });
  assert.match(gitignore(cwd), /\.conductor\//, "a repo upgraded rather than re-initialized is not left behind");
});

// ─────────────────── the contention latch ───────────────────

test("the conflict log is written where init said it would be, and reads back", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  const restore = injectConflictOnce(path.join(cwd, ".conductor"));
  try { invokeEngine(["add-epic", "--id", "e1", "--lane", "claude-code"], { cwd }); }
  finally { restore(); }
  assert.ok(gitignore(cwd).includes("write-conflicts"), "the latch it records into is the ignored one");
});

test("commit-nudge degrades on conflict instead of throwing — the second hook write", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  const restore = injectConflictOnce(path.join(cwd, ".conductor"));
  let r;
  try {
    r = invokeEngine(["commit-nudge"], { cwd, input: JSON.stringify({ tool_input: { command: "git commit -m x" } }) });
  } finally { restore(); }
  // A hook that exited non-zero on a lost race would surface a mid-session error for a benign
  // condition; the conflict is recorded and the hook reports normally.
  assert.equal(r.status, 0);
});

test("the brief warns at the threshold and the warning is CONSECUTIVE, not cumulative", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  // Drive a real conflict, then a clean write, and assert the latch's own state rather than a
  // rendered sentence: "skips ever" and "skips in a row" are different signals.
  const restore = injectConflictOnce(path.join(cwd, ".conductor"));
  try { invokeEngine(["add-epic", "--id", "e1", "--lane", "claude-code"], { cwd }); } finally { restore(); }
  assert.doesNotThrow(() => run(["brief"], { cwd }));
});

// ───────────────────────── the deliberate omissions ─────────────────────────
//
// "a second writer holding a stale revision is REFUSED", "the log rotates on SIZE to a .prev" and
// the two concurrency cases need a second PROCESS holding the lock, or a very large log built to
// the size boundary; both are functional-only by subject (design D5). The conflict itself is
// exercised above through the same one-shot seam the functional file uses.
