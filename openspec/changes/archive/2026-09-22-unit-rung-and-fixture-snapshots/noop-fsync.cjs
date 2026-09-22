// noop-fsync.cjs — THE CAUSAL CONTROL. The same run, with the durability flush replaced by a no-op
// and NOTHING ELSE changed.
//
//   node --require ./openspec/changes/unit-rung-and-fixture-snapshots/noop-fsync.cjs \
//        --test --test-isolation=none scripts/test/assert/*.test.mjs
//
// Replacing exactly one syscall takes the assertion half from ~73 s to ~9 s with all 1,243 tests
// still passing. That is the whole result: the half's cost is durability paid on tests that assert
// on a value, and not engine setup, not the filesystem as such (`mkdtemp` is 0.32 ms).
//
// The flush is removed EVERYWHERE, including in the file rung's genuine writes, so the number is an
// UPPER BOUND on what the migration can reach — see design D10. It is kept beside `count-fsync.cjs`
// so the control is re-runnable rather than quoted.

const fs = require("node:fs");

fs.fsyncSync = function () { return undefined; };
fs.fsync = function (fd, cb) { if (typeof cb === "function") process.nextTick(cb, null); return undefined; };
if (fs.promises && typeof fs.promises.fsync === "function") {
  fs.promises.fsync = async function () { return undefined; };
}
