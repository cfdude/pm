// scripts/test/assert/per-call-roots.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/per-call-roots.test.mjs — same id, same subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is 3.1 and 3.6: TWO ROOTS IN ONE PROCESS, and the two ways the old
// engine could not do it — a root captured at module load, and `subcommands.mjs`'s module-scope
// `showPrefix` cache. 3.1 needs no repository at all and is ported here whole; 3.6 drives two
// invocations whose `git rev-parse --show-prefix` answers genuinely DIFFER (a conductor at the git
// root, another in a subdirectory), which needs a real repository (design D5).
//
// 3.1 is the guarantee the whole split rests on, and it is the one that must fail LOUDLY on every
// commit if a module-scope root ever comes back: every test in a file shares one module graph, and
// this file drives several roots in one process, so a captured root would make every later test in
// it write into the first test's directory.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, invokeEngine, readState } from "../fixtures/assert-harness.mjs";

const ids = (cwd) => readState(cwd).epics.map(e => e.id).sort();
const hasState = (cwd) => fs.existsSync(path.join(cwd, ".conductor", "state.json"));

test("3.1 two roots in one process: the first initialized, the second not — each call lands under its own", () => {
  const first = tmpRepo();
  // `init` through the same in-process route the assertions use, so the first root's record is
  // written by the engine and not by the test.
  const i = invokeEngine(["init", "--platform", "claude-code"], { cwd: first });
  assert.equal(i.status, 0, `init must succeed against the first root: ${i.stderr}`);
  const second = tmpRepo();   // deliberately NOT initialized

  const a = invokeEngine(["add-epic", "--id", "alpha", "--lane", "claude-code"], { cwd: first });
  assert.equal(a.status, 0, `the first call must succeed against the first root: ${a.stderr}`);
  assert.deepEqual(ids(first), ["alpha"], "the write landed under the root that call was given");

  const b = invokeEngine(["add-epic", "--id", "beta", "--lane", "claude-code"], { cwd: second });
  assert.equal(b.status, 1, "the second root is not a conductor, so the same verb refuses there");
  assert.match(b.stderr, /run \/pm:init first/,
    "and it refuses for the SECOND root's reason, not by reading the first root's record");
  assert.equal(hasState(second), false, "the second call wrote nothing under its root");

  assert.deepEqual(ids(first), ["alpha"],
    "and the first root's record is exactly what the first call left — a module-scope root would " +
    "have had the second call read, or write, THIS repository");
});

test("3.1 the argument list is the one the caller passed, not the running process's", () => {
  const cwd = tmpRepo();
  invokeEngine(["init", "--platform", "claude-code"], { cwd });
  const own = [...process.argv];
  const r = invokeEngine(["add-epic", "--id", "from-caller", "--lane", "claude-code"], { cwd });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(ids(cwd), ["from-caller"], "the epic the caller named, not one from this process's argv");
  assert.deepEqual(process.argv, own, "and the calling process's own arguments are untouched");
});

test("3.1 each invocation's output lands on the streams THAT call was given", () => {
  const a = tmpRepo();
  invokeEngine(["init"], { cwd: a });
  const b = tmpRepo();
  invokeEngine(["init"], { cwd: b });
  const ra = invokeEngine(["brief"], { cwd: a });
  const rb = invokeEngine(["brief"], { cwd: b });
  assert.equal(ra.status, 0);
  assert.equal(rb.status, 0);
  assert.ok(!ra.stdout.includes("beta") && !rb.stdout.includes("alpha"),
    "neither call's output can carry the other's record");
});

// ───────────────────────── the deliberate omission ─────────────────────────
//
// 3.6 — `showPrefix` shipped a module-scope cache under a comment stating "ROOT does not move under
// a running invocation", and per-call roots are precisely what makes that false. Its test needs two
// invocations whose `git rev-parse --show-prefix` answers DIFFER (the git root vs a subdirectory of
// it), which requires a real repository this half does not have (design D5). The comment's
// invariant is asserted where it can still be broken loudly: `scripts/test/functional/per-call-roots.test.mjs`.
