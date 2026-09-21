// scripts/test/assert/head-attachment.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/head-attachment.test.mjs — same id, same subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is the probe whose EXIT STATUS is the whole answer: 0 attached,
// 1 detached, and 128 "not a repository" — and only status 1 may suppress a write. Its cases all
// build a real repository and detach HEAD, which this half cannot do (design D5).
//
// BUT THE THIRD CASE IS THIS HALF'S WHOLE WORLD: every invocation's root here is a fresh temporary
// directory with no `git init` anywhere above it, so the double answers 128 for `headRef`. That is
// the case the functional file calls the SAFE DIRECTION — "status 128 is 'git cannot answer', and a
// false SUPPRESSION silently disables the trail" — and it is the one a pre-commit gate most needs to
// see break, because turning it into a suppression would silently stop every write in a repository
// that is merely not a checkout (a deployed copy, a tarball, a fresh clone before git init).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, readState } from "../fixtures/assert-harness.mjs";

const hasState = (cwd) => fs.existsSync(path.join(cwd, ".conductor", "state.json"));

test("a directory that is not a repository is `unknown`, NOT detached — every write still lands", () => {
  const cwd = tmpRepo();
  run(["init", "--platform", "claude-code"], { cwd });
  run(["add-epic", "--id", "e1", "--title", "t", "--lane", "claude-code"], { cwd });
  assert.deepEqual(readState(cwd).epics.map(e => e.id), ["e1"],
    "status 128 must not be read as detached: a false suppression is invisible where a false " +
    "record is visible and removable");
  // A second mutating verb, so the property is not one verb's accident.
  run(["set-active", "e1"], { cwd });
  assert.equal(readState(cwd).active, "e1");
});

test("the probe answers about the invocation's ROOT, not the process's cwd", () => {
  const a = tmpRepo();
  const b = tmpRepo();
  run(["init"], { cwd: a });
  assert.ok(hasState(a) && !hasState(b));
  run(["add-epic", "--id", "only-a", "--lane", "claude-code"], { cwd: a });
  assert.deepEqual(readState(a).epics.map(e => e.id), ["only-a"]);
  assert.equal(hasState(b), false, "the second root's record was never written");
  // And the non-initialized root still refuses for ITS OWN reason rather than reading a's record.
  const err = (() => { try { run(["add-epic", "--id", "x", "--lane", "claude-code"], { cwd: b }); return null; }
    catch (e) { return e; } })();
  assert.ok(err, "a non-conductor root refuses");
  assert.match(String(err.stderr), /run \/pm:init first/);
});

test("two roots in one process, one invocation each — no captured answer crosses between them", () => {
  const a = tmpRepo();
  run(["init"], { cwd: a });
  const b = tmpRepo();
  run(["init"], { cwd: b });
  run(["add-epic", "--id", "in-a", "--lane", "claude-code"], { cwd: a });
  run(["add-epic", "--id", "in-b", "--lane", "claude-code"], { cwd: b });
  assert.deepEqual(readState(a).epics.map(e => e.id), ["in-a"]);
  assert.deepEqual(readState(b).epics.map(e => e.id), ["in-b"],
    "a per-process answer about the first root would have been served to the second");
});

// ───────────────────────── the deliberate omissions ─────────────────────────
//
// The functional file's three POSITIVE cases — a branch checkout is `attached`, a detached HEAD is
// `detached`, and an unborn HEAD is `attached` — each need a real repository and a real `git
// symbolic-ref` answer, which this half does not have (design D5). They are the functional file's
// subject and stay there; the case above is the third answer, which is this half's world.
