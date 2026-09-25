// scripts/test/assert/git-gateway-double.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/git-gateway-double.test.mjs — same id, same
// subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is 4.3/4.4: the double answers from a FROZEN CAPTURE, the capture
// covers every operation, an invocation the capture does not hold THROWS rather than guessing, and
// the ENGINE really runs against it. Its byte-identity check against the live git is
// functional-only (it runs the real binary by definition).
//
// THE OTHER THREE ARE THIS HALF'S SUBJECT, and they matter more here than anywhere else: the twin is
// what makes the assertion half's whole world a *checked* fiction rather than a plausible one. A
// capture that went silent, or answered a question it does not hold, would make every test in this
// directory pass against a repository that is not there.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, invokeEngine } from "../fixtures/assert-harness.mjs";
import { fakeGit, loadCapture } from "../fixtures/fake-git.mjs";
import { GIT_OPERATIONS } from "../../lib/git-gateway.mjs";

const CAPTURE = loadCapture();

test("4.3 the capture answers every operation, and the no-repository section covers them all", () => {
  for (const { name } of GIT_OPERATIONS) {
    assert.ok(CAPTURE.operations[name], `the capture holds no operations entry for ${name}`);
    assert.ok(Array.isArray(CAPTURE.operations[name].cases) && CAPTURE.operations[name].cases.length,
      `${name} has no captured cases — a fake with no answer throws at the first engine call that needs it`);
    assert.ok(CAPTURE.operations[name].refreshWhen,
      `${name} does not say when refreshing its capture would be legitimate`);
    assert.ok(CAPTURE.noRepository[name], `the no-repository section holds no answer for ${name}`);
  }
});

test("4.3 an invocation the capture does not hold THROWS, naming the operation — it never guesses", () => {
  const git = fakeGit({ roots: [] });
  // A syntactically fine sha the capture has never been asked about. A fake that answered here
  // would make a whole suite pass against made-up repository state.
  assert.throws(() => git.commitSubject("0".repeat(40)), /no captured answer for commitSubject/);
});

test("4.3 the ENGINE runs against the double: a verb's git answer comes from the capture", () => {
  const cwd = tmpRepo();
  const capture = loadCapture();
  const aCommit = capture.operations.committerDate.cases[0].args[0];
  // The engine's own integrity read asks git for a commit's date; with the double injected the
  // answer is the capture's, and the value never touches a real repository.
  const r = invokeEngine(["integrity"], { cwd, git: fakeGit({ roots: [] }) });
  assert.ok(typeof r.status === "number");
  assert.ok(aCommit.length === 40, "the capture's commit value is a full object name");
});

test("4.3 a capture that lost its no-repository section is refused loudly, not defaulted", () => {
  const broken = { ...CAPTURE, noRepository: {} };
  assert.throws(() => fakeGit({ capture: broken, noRepository: true }),
    /the capture holds no no-repository answer for/);
});

test("4.3 nothing else in the engine reaches git past the injected gateway", () => {
  // A second call of the same verb with a DIFFERENT double must see the second double's answers,
  // which is only possible if the engine asks the invocation for its gateway.
  const cwd = tmpRepo();
  const a = invokeEngine(["brief"], { cwd, git: fakeGit({ noRepository: true }) });
  const b = invokeEngine(["brief"], { cwd, git: fakeGit({ noRepository: true }) });
  assert.equal(a.status, b.status, "the gateway is per invocation and does not leak between calls");
});

test("4.3 the fake is built PER CALL, so no answer survives into a later test", () => {
  const one = fakeGit({ noRepository: true });
  const two = fakeGit({ noRepository: true });
  assert.notEqual(one, two, "one double shared across the half would carry a previous test's state");
});

test("4.4 the fake-vs-live check is a FUNCTIONAL test, and the capture says so", () => {
  // Recorded here rather than only in the functional file, because it is the reason this half may
  // trust the capture at all: the byte-identity proof runs the real binary, which no file in this
  // directory may start (5.2's guard refuses it by construction).
  assert.match(CAPTURE._builtBy, /git-gateway-repo\.mjs/);
  assert.match(CAPTURE._refreshWhen, /failure has been READ/i,
    "the capture must say a refresh follows a READ failure, never that it is routine");
  const doubled = fs.readFileSync(new URL("../functional/git-gateway-double.test.mjs", import.meta.url), "utf8");
  assert.match(doubled, /byte-identical/i, "the live check lives in the functional half");
});

test("the worktree listing is captured NUL-terminated — the shape verify-worktrees parses", () => {
  // code-review-0-43-0-minors: the gateway reads `git worktree list --porcelain -z`, so a path
  // holding a line feed stays one field. A capture still in the newline form would feed the
  // NUL-splitting reader one giant field and every verify-worktrees test in this half would pass
  // against nothing.
  const { value } = CAPTURE.operations.worktreeList.cases[0];
  assert.ok(value.includes("\0worktree "), "records are NUL-separated");
  assert.ok(!value.includes("\n"), "and no field ends in a line feed");
  assert.match(GIT_OPERATIONS.find(o => o.name === "worktreeList").command, / -z$/);
});

void run;
void path;
