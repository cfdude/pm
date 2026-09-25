// scripts/test/fixtures/temp-dir.mjs
// 0.49.0, design D3 rows 3 and 3b — THE ONE PLACE A PER-PROCESS TEMP DIRECTORY IS REMOVED.
//
// Two fixtures make a directory once per PROCESS: the git shim (`pm-assert-no-git-*`) and the harness's
// empty version cache (`pm-empty-cache-*`). While the assertion half ran in one process that was one of
// each per run; under the runner's per-file isolation it is one per file, and neither was ever removed
// (4,041 and 6,877 of them sat in `os.tmpdir()` at the Gate 1 fix round). Both are removed at process
// exit through `removeTempDir()`.
//
// A SEPARATE MODULE, NOT THE SHIM, because `fixtures/harness.mjs` is imported by the FUNCTIONAL half as
// well, and importing the shim there would put the git shim first on PATH in a half that runs the real
// git by design. The shim re-exports these, so "the shim's removal function" and "the harness's" are
// one function.

import fs from "node:fs";

/** Remove a temp directory and everything under it. Synchronous, because its callers are `exit`
 *  listeners, and silent on a directory that is already gone, because an exit listener must never
 *  throw. */
export function removeTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

const scheduled = new Set();
let listening = false;

/** Schedule `dir` for removal when this process exits, and hand it back, so a module-level constant
 *  can be created and scheduled in one expression. One `exit` listener serves every scheduled
 *  directory. */
export function removeAtExit(dir) {
  scheduled.add(dir);
  if (!listening) {
    listening = true;
    process.on("exit", () => { for (const d of scheduled) removeTempDir(d); });
  }
  return dir;
}

/** What this process will remove at exit — for a test to assert on, since the removal itself runs
 *  after every test has finished. */
export function scheduledForRemoval() {
  return [...scheduled];
}
