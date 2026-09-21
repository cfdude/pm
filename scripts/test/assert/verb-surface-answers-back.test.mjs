// scripts/test/assert/verb-surface-answers-back.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/verb-surface-answers-back.test.mjs — same id, same
// subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is four things every verb must be able to say BACK: a timekeeping
// field can be cleared (#181), a Gate 1 verdict records the ARTIFACTS it reviewed (#177), a release
// can be read and its memberships removed with a reason (#178), and a deferral can carry its reason
// inline (#179). NOT ONE OF THEM NEEDS GIT: each is argv plus state.json plus a rendering.
//
// So this is a full port, and it is the half where these answers get checked on every commit — a
// verb that stops echoing what it accepted is exactly the kind of regression only the fast half sees.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, runCombined, readState, expectFail } from "../fixtures/assert-harness.mjs";

const repo = (n = 1) => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  for (let i = 0; i < n; i++) run(["add-epic", "--id", `e${i}`, "--title", `t${i}`, "--lane", "claude-code"], { cwd });
  return cwd;
};
const stateBytes = (cwd) => fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");

// ─────────────────── gh-181: every engine-written field declares its clearability ───────────────────

test("gh-181: `--clear created-at` returns the registration date to ABSENT", () => {
  const cwd = repo(1);
  assert.match(readState(cwd).epics[0].createdAt, /^\d{4}-\d{2}-\d{2}T/);
  run(["update-epic", "e0", "--clear", "created-at"], { cwd });
  assert.equal(readState(cwd).epics[0].createdAt, undefined);
});

test("gh-181: `created-at` is NOT a settable flag — the registry row is clearing-only", () => {
  const cwd = repo(1);
  const before = stateBytes(cwd);
  assert.ok(expectFail(() => run(["update-epic", "e0", "--created-at", "2020-01-01T00:00:00Z"], { cwd })));
  assert.equal(stateBytes(cwd), before);
});

test("gh-181: `--clear touched-at` is refused, carrying the registry's own reason", () => {
  const cwd = repo(1);
  const err = expectFail(() => run(["update-epic", "e0", "--clear", "touched-at"], { cwd }));
  assert.ok(err, "an engine-maintained field that is not clearable must refuse");
  assert.match(String(err.stderr || err.message), /touched-at/);
});

// ─────────────────── gh-177: Gate 1's evidence form is the artifact list ───────────────────

test("gh-177: a Gate 1 pass records the ARTIFACTS it reviewed, with no SHA range", () => {
  const cwd = repo(1);
  run(["record-gate-review", "e0", "--gate", "1", "--verdict", "pass",
    "--artifact", "openspec/changes/x/proposal.md"], { cwd });
  const g1 = readState(cwd).epics[0].gateReview.gate1;
  assert.equal(g1.verdict, "pass");
  assert.deepEqual(g1.artifacts, ["openspec/changes/x/proposal.md"]);
  assert.equal(g1.baseSha, undefined, "no range is recorded, because none was given");
});

test("gh-177: a Gate 1 pass with NO evidence of either kind is refused", () => {
  const cwd = repo(1);
  const before = stateBytes(cwd);
  assert.ok(expectFail(() => run(["record-gate-review", "e0", "--gate", "1", "--verdict", "pass"], { cwd })));
  assert.equal(stateBytes(cwd), before);
});

test("gh-177: a Gate 1 FAIL needs no evidence, exactly as a Gate 2 fail does not", () => {
  const cwd = repo(1);
  run(["record-gate-review", "e0", "--gate", "1", "--verdict", "fail"], { cwd });
  assert.equal(readState(cwd).epics[0].gateReview.gate1.verdict, "fail");
});

test("gh-177: a Gate 2 pass with no range is still refused — the range is Gate 2's evidence form", () => {
  const cwd = repo(1);
  const before = stateBytes(cwd);
  const err = expectFail(() => run(["record-gate-review", "e0", "--gate", "2", "--verdict", "pass"], { cwd }));
  assert.ok(err, "a Gate 2 pass must name the range it covered");
  assert.equal(stateBytes(cwd), before);
});

// ─────────────────── gh-178/gh-179: the release read form and its removals ───────────────────

test("gh-178: `release show <id>` renders intent, target, members, deferrals and the verdict", () => {
  const cwd = repo(3);
  run(["release", "0.27.0", "--intent", "a release", "--target", "2026-09-01"], { cwd });
  run(["release", "0.27.0", "--member", "e0"], { cwd });
  run(["release", "0.27.0", "--defer", "e1", "--reason", "cut for scope"], { cwd });
  const out = run(["release", "show", "0.27.0"], { cwd });
  assert.match(out, /a release/);
  assert.match(out, /2026-09-01/);
  assert.match(out, /e0/);
  assert.match(out, /cut for scope/);
});

test("gh-178: `release show` is a pure READ — it writes nothing", () => {
  const cwd = repo(1);
  run(["release", "0.27.0", "--intent", "a release"], { cwd });
  const before = stateBytes(cwd);
  run(["release", "show", "0.27.0"], { cwd });
  assert.equal(stateBytes(cwd), before);
});

test("gh-178: `release show` with no id lists every release", () => {
  const cwd = repo(1);
  run(["release", "0.27.0", "--intent", "one"], { cwd });
  run(["release", "0.28.0", "--intent", "two"], { cwd });
  const out = run(["release", "show"], { cwd });
  assert.match(out, /0\.27\.0/);
  assert.match(out, /0\.28\.0/);
});

test("gh-178: `release show <unknown>` fails rather than rendering an empty object", () => {
  const cwd = repo(1);
  assert.ok(expectFail(() => run(["release", "show", "9.9.9"], { cwd })));
});

test("gh-178: `--unmember` removes the membership pointer and RECORDS why", () => {
  const cwd = repo(1);
  run(["release", "0.27.0", "--intent", "a release"], { cwd });
  run(["release", "0.27.0", "--member", "e0"], { cwd });
  run(["release", "0.27.0", "--unmember", "e0", "--reason", "belongs to the next one"], { cwd });
  const st = readState(cwd);
  assert.equal(st.epics[0].release, undefined);
  const rel = st.releases[0];
  assert.ok(JSON.stringify(rel).includes("belongs to the next one"),
    "removal is recorded, not erased — a correction is a judgment");
});

test("gh-178: `--unmember` requires its reason", () => {
  const cwd = repo(1);
  run(["release", "0.27.0", "--intent", "a release"], { cwd });
  run(["release", "0.27.0", "--member", "e0"], { cwd });
  assert.ok(expectFail(() => run(["release", "0.27.0", "--unmember", "e0"], { cwd })));
});

test("gh-178: `--undefer` removes the exclusion, keeping both what it used to say and why it ends", () => {
  const cwd = repo(1);
  run(["release", "0.27.0", "--intent", "a release"], { cwd });
  run(["release", "0.27.0", "--defer", "e0", "--reason", "cut on Tuesday"], { cwd });
  // The undo needs its own reason, exactly as every other correction does: `--unmember` and
  // `--undefer` both refuse a bare reversal.
  assert.ok(expectFail(() => run(["release", "0.27.0", "--undefer", "e0"], { cwd })),
    "an undefer without a reason is refused");
  run(["release", "0.27.0", "--undefer", "e0", "--reason", "the dependency landed"], { cwd });
  const st = readState(cwd);
  assert.deepEqual(st.releases[0].deferred, []);
  assert.ok(JSON.stringify(st).includes("cut on Tuesday"),
    "the reason it WAS deferred survives the undoing — an ended exclusion is still a judgment somebody made");
  assert.ok(JSON.stringify(st).includes("the dependency landed"),
    "and the reason it is back is recorded with it");
});

test("gh-178: a release may not be named `show`, which the read form reserves", () => {
  const cwd = repo(1);
  assert.ok(expectFail(() => run(["release", "show", "--intent", "x"], { cwd })));
});

test("gh-179: `--defer <epicId>:<reason>` carries its reason inline", () => {
  const cwd = repo(1);
  run(["release", "0.27.0", "--intent", "a release"], { cwd });
  run(["release", "0.27.0", "--defer", "e0:depends on #133"], { cwd });
  assert.equal(readState(cwd).releases[0].deferred[0].reason, "depends on #133");
});

test("gh-179: the out-of-band `--defer <id> --reason \"<why>\"` form still works", () => {
  const cwd = repo(1);
  run(["release", "0.27.0", "--intent", "a release"], { cwd });
  run(["release", "0.27.0", "--defer", "e0", "--reason", "out of band"], { cwd });
  assert.equal(readState(cwd).releases[0].deferred[0].reason, "out of band");
});

test("gh-179: supplying the reason BOTH ways in one invocation is refused, not resolved", () => {
  const cwd = repo(1);
  run(["release", "0.27.0", "--intent", "a release"], { cwd });
  assert.ok(expectFail(() => run(["release", "0.27.0", "--defer", "e0:inline", "--reason", "out of band"], { cwd })));
});

test("gh-178: removing an epic sweeps the amendment that names it — no dangling pointer", () => {
  const cwd = repo(2);
  run(["release", "0.27.0", "--intent", "a release"], { cwd });
  run(["release", "0.27.0", "--member", "e0"], { cwd });
  run(["remove-epic", "e0"], { cwd });
  assert.doesNotMatch(JSON.stringify(readState(cwd)), /"epic":"e0"/);
});

test("gh-178: `release --help` names the read form, not only the seven flags", () => {
  const cwd = repo(1);
  const out = runCombined(["release", "--help"], { cwd });
  assert.match(out, /show/);
});
