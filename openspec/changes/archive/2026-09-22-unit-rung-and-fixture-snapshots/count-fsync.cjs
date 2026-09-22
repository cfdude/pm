// count-fsync.cjs — a NODE PRELOAD that counts the durability flushes one run performs.
//
//   node --require ./openspec/changes/unit-rung-and-fixture-snapshots/count-fsync.cjs \
//        --test --test-isolation=none scripts/test/assert/*.test.mjs
//
// WHY A PRELOAD AND NOT A PATCH IN THE SUITE. The flush the assertion half pays for is issued deep
// inside `saveState()` (scripts/lib/state.mjs), reached from every verb in the engine. A preload
// installs before any module of the engine is loaded, so it sees every call regardless of which
// module reached it, and it needs no edit to the code under measurement — which is what makes the
// number a measurement of today's engine rather than of a modified one.
//
// `node:fs` is a singleton: `require("node:fs")` here and `import fs from "node:fs"` in an ESM
// module resolve to the SAME mutable object, so replacing a property on it is visible to an engine
// that does `fs.fsyncSync(...)` at call time.
//
// CJS on purpose: a `--require` preload runs before the ESM graph is instantiated, so nothing has
// captured the original function yet.

const fs = require("node:fs");

let calls = 0;
const counters = { fsyncSync: 0, fsync: 0, promisesFsync: 0 };

const realFsyncSync = fs.fsyncSync;
fs.fsyncSync = function (...args) {
  calls++;
  counters.fsyncSync++;
  return realFsyncSync.apply(fs, args);
};

const realFsync = fs.fsync;
fs.fsync = function (...args) {
  calls++;
  counters.fsync++;
  return realFsync.apply(fs, args);
};

if (fs.promises && typeof fs.promises.fsync === "function") {
  const realPromisesFsync = fs.promises.fsync;
  fs.promises.fsync = async function (...args) {
    calls++;
    counters.promisesFsync++;
    return realPromisesFsync.apply(fs.promises, args);
  };
}

process.on("exit", () => {
  process._rawDebug(
    "fsyncSync calls in this run: " + calls +
    " (fsyncSync " + counters.fsyncSync +
    ", fsync " + counters.fsync +
    ", promises.fsync " + counters.promisesFsync + ")"
  );
});
