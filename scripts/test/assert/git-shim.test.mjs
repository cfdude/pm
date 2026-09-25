// scripts/test/assert/git-shim.test.mjs
// 0.49.0 task 2.3 — THE SHIM'S TEMP DIRECTORY IS REMOVED, and the removal is a function a test can
// call.
//
// WHY THIS EXISTS. `fixtures/assert-git-shim.mjs` makes one `pm-assert-no-git-*` directory per process
// that imports it, and until 0.49.0 nothing removed it. While the assertion half ran in ONE process
// that was one directory per run; under the runner's per-file isolation it is one per rung file,
// about 137 per run (design D3 row 3). At drafting 3,501 of them sat in `os.tmpdir()`, and 4,041 at
// the Gate 1 fix round. The exit listener now removes the directory after it has read the log, through
// ONE exported function, and this file exercises that function on a scratch directory — the exit
// listener itself runs after every test has finished, where no test can observe it.
//
// It is the ASSERTION TWIN of `functional/git-shim.test.mjs` (task 2.4c), which runs a fixture file
// in its own `node --test` process to prove that a real git call in ANY file's process fails the run.

// Installs the run-time git counter in THIS process (0.49.0, D3 row 1), and hands back the module.
import * as shim from "../fixtures/assert-git-shim.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EMPTY_CACHE } from "../fixtures/harness.mjs";

test("2.3 the shim module exports a directory-removal function, and it removes a directory tree", () => {
  assert.equal(typeof shim.removeTempDir, "function",
    "fixtures/assert-git-shim.mjs exports no removeTempDir(): nothing can remove the directory the shim " +
    "creates, so every process that installs it leaks one pm-assert-no-git-* directory");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-shim-removal-"));
  fs.mkdirSync(path.join(dir, "nested"));
  fs.writeFileSync(path.join(dir, "git-spawns.log"), "");
  fs.writeFileSync(path.join(dir, "nested", "stub"), "#!/bin/sh\nexit 128\n");
  shim.removeTempDir(dir);
  assert.equal(fs.existsSync(dir), false, `removeTempDir() left ${dir} behind`);
  // And removing what is already gone is not an error: the exit listener must never throw.
  assert.doesNotThrow(() => shim.removeTempDir(dir), "removing an absent directory must not throw");
});

test("2.4b the harness's per-process EMPTY_CACHE is scheduled for removal at exit, through the same function", () => {
  // THE SECOND PER-PROCESS LEAK (design D3 row 3b, Gate 1 I6). `fixtures/harness.mjs` makes one
  // `pm-empty-cache-*` directory per process that imports it — 6,877 of them sat in `os.tmpdir()` at
  // the Gate 1 fix round — and nothing removed it. It is now registered for removal at process exit,
  // and the removal is `removeTempDir()`, the shim's own. The directory is live for the rest of this
  // process, so the check is that it is SCHEDULED; the scheduling itself is exercised on a scratch
  // directory, and the removal on one by the test above.
  assert.equal(typeof shim.removeAtExit, "function",
    "no removeAtExit(): a per-process temp directory has no way to be scheduled for removal");
  assert.equal(typeof shim.scheduledForRemoval, "function",
    "no scheduledForRemoval(): nothing can show what a process will remove at exit");
  assert.ok(shim.scheduledForRemoval().includes(EMPTY_CACHE),
    `the harness's EMPTY_CACHE (${EMPTY_CACHE}) is not scheduled for removal at exit, so every process ` +
    "that imports the harness leaks one pm-empty-cache-* directory");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-shim-schedule-"));
  try {
    assert.equal(shim.removeAtExit(dir), dir, "removeAtExit() hands back the directory it scheduled");
    assert.ok(shim.scheduledForRemoval().includes(dir), "a scheduled scratch directory is not listed");
  } finally {
    shim.removeTempDir(dir);
  }
});
