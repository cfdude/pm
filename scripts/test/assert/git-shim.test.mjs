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
