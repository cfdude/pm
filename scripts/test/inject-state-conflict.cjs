// A Node PRELOAD (`node --require`) that injects ONE state.json write conflict into an engine
// invocation, from OUTSIDE the engine.
//
// #131 asked for "a conflict-injection seam usable from the black-box test harness without
// shipping a production code path that only tests use". This is that seam and it ships nothing:
// no env var, branch or verb exists in scripts/conductor.mjs or scripts/lib/ for it. It is
// loaded only by scripts/test/conductor-25.test.mjs, via NODE_OPTIONS on the child process.
//
// WHERE IT FIRES. saveState()'s first filesystem call is `fs.mkdirSync(CONDUCTOR_DIR)` — after
// the hook's loadState() and before the `found !== expected` revision comparison. Bumping the
// on-disk `revision` there is precisely "another writer landed between this hook's read and its
// write", inside ONE invocation, which is the window no existing test could reach.
//
// It fires ONCE. The retry's own saveState must be allowed through, or the test would prove the
// engine cannot recover from PERMANENT contention rather than from a single lost race.
//
// The revision is the ONLY field touched: the state stays un-healed, so the retry's reloaded
// state still has something to heal. Bumping anything else would make the retry a no-op and the
// test vacuous in the direction that looks like success.
//
// It is patched on the DEFAULT `fs` export. Every engine module imports it as `import fs from
// "node:fs"` and calls `fs.mkdirSync(...)`, a property lookup at call time; a NAMED core-module
// import would be a live binding this could not reach. Verified mechanically:
//   rg -n 'from "node:fs"' scripts/lib/ scripts/conductor.mjs | rg -v 'import fs from'
// returns nothing.
"use strict";

const fs = require("fs");
const path = require("path");

const dir = process.env.PM_INJECT_CONFLICT_DIR;
const marker = process.env.PM_INJECT_CONFLICT_MARKER;

if (dir) {
  const statePath = path.join(dir, "state.json");
  const realMkdir = fs.mkdirSync;
  let fired = false;

  fs.mkdirSync = function (p, ...rest) {
    const out = realMkdir.call(this, p, ...rest);
    if (!fired && typeof p === "string" && path.resolve(p) === path.resolve(dir)) {
      fired = true;
      try {
        const s = JSON.parse(fs.readFileSync(statePath, "utf8"));
        s.revision = (Number.isInteger(s.revision) ? s.revision : 0) + 1;
        fs.writeFileSync(statePath, JSON.stringify(s, null, 2) + "\n");
        // The marker is the NON-VACUITY proof the test asserts on before it asserts anything
        // else: a seam that silently failed to fire would otherwise make a green run mean
        // "no conflict ever happened".
        if (marker) fs.writeFileSync(marker, `${new Date().toISOString()}\n`);
      } catch {
        // A repo with no state.json yet (`init`) is not a target — leave it alone and let the
        // marker's absence fail the test loudly rather than half-injecting.
        fired = false;
      }
    }
    return out;
  };
}
