// scripts/test/assert/recorded-sha-resolvability.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/recorded-sha-resolvability.test.mjs — same id,
// same subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is #142: a recorded sha that becomes unreachable. A squash-merge —
// this repository's ONLY permitted merge method — orphans every commit on the branch, and the next
// `git gc` deletes them; measured on cfdude/pm right after 0.28.0 merged, 36 recorded shas, 0
// reachable from any ref, 36 still in the object store, and EVERY existing check green. Its fixtures
// build real repositories and synthesize the orphan, because the question is one only git can answer
// (design D5) — with one exception, which is this twin's subject.
//
// THAT EXCEPTION IS THE CASE WHOSE FAILURE IS LOUDEST: outside a git repository the check must
// report NOTHING. A check that reported every recorded sha as unresolvable in a tarball, a mirror or
// a fresh clone would fire on every user whose project is not a checkout — and this half's every
// root is exactly that project.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, writeState, readState } from "../fixtures/assert-harness.mjs";

const CHECK = "recorded-sha-the-repository-cannot-resolve";

const epic = (id, extra = {}) => ({
  id, title: id, priority: "P1", status: "queued", role: "epic", lane: "claude-code",
  links: [], attributedCommits: [], ...extra,
});
const withEpics = (cwd, epics) =>
  writeState(cwd, { version: 1, active: null, detourStack: [], platform: "claude-code", epics });

/** The line the report prints for this check, e.g. "<id> — 2 finding(s): ..." */
const countLine = (out) => {
  const m = out.match(new RegExp(`^${CHECK} — (\\d+) finding\\(s\\)`, "m"));
  assert.ok(m, `the report must name ${CHECK} with its count, even at zero:\n${out}`);
  return Number(m[1]);
};

/** A sha that is syntactically a commit and that no repository has ever held. */
const NEVER = "0123456789abcdef0123456789abcdef01234567";
const NEVER2 = "fedcba9876543210fedcba9876543210fedcba98";

test("142: outside a git repository the check reports nothing", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  withEpics(cwd, [epic("e1", { attributedCommits: [NEVER, NEVER2] })]);
  const out = run(["integrity"], { cwd });
  assert.equal(countLine(out), 0,
    "a root git cannot answer about must not report every recorded sha as a disaster — the check " +
    "reports a sha the clone HAS seen and can no longer reach, not one it cannot be asked about");
});

test("142: the check is registered and reports its count even when it finds nothing", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const out = run(["integrity"], { cwd });
  countLine(out);
});

test("142: integrity still writes nothing while asking these questions", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  withEpics(cwd, [epic("e1", { attributedCommits: [NEVER] })]);
  const bytesBefore = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  const projectBefore = fs.readFileSync(path.join(cwd, "PROJECT.md"), "utf8");
  run(["integrity"], { cwd });
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), bytesBefore,
    "a read-only check leaves the record byte-identical");
  assert.equal(fs.readFileSync(path.join(cwd, "PROJECT.md"), "utf8"), projectBefore);
  assert.deepEqual(readState(cwd).epics[0].attributedCommits, [NEVER]);
});

// ───────────────────────── the deliberate omissions ─────────────────────────
//
// Every positive case — "an orphaned attributed commit is reported", "an orphaned gate verdict range
// is reported too", "a reachable recorded sha is not a finding", "a clone that resolves NONE of the
// record is not reported as a disaster", "in a clone that DOES hold the record, a sha it cannot
// resolve is reported as gone", "orphaned and absent are DIFFERENT reports" — asks git whether a
// commit is reachable from any ref, and synthesizes an orphan by moving a ref. That is git's own
// behaviour in a real repository, so they are functional-only (design D5).
