// scripts/test/unit/verb-surface-answers-back.test.mjs
// 4.1's migration of `assert/verb-surface-answers-back.test.mjs` — ALL of it, moved from the file
// rung to the unit rung with every assertion unchanged. (The file-rung file is gone; nothing in it
// needed bytes on disk.)
//
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
//
// WHY IT MOVED ENTIRELY: every observable is a VALUE — a field on the record, or text a verb
// PRINTED. There is no `openspec/` fixture, no plan file, no batch file, no plugin directory and no
// source read anywhere in it. The mechanism that changed:
//
//   `tmpRepo()` + `run(["init"], { cwd })`  →  `memoryEngine(emptyRecord())`
//   `run(args, { cwd })`                    →  `engine(args)`
//   `runCombined(args, { cwd })`            →  `engine.combined(args)`
//   `readState(cwd)`                        →  `engine.store.record()`
//   `fs.readFileSync(…/state.json)`         →  `engine.store.read("state.json").text`

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const repo = (n = 1) => {
  const engine = memoryEngine(emptyRecord());
  for (let i = 0; i < n; i++) engine(["add-epic", "--id", `e${i}`, "--title", `t${i}`, "--lane", "claude-code"]);
  return engine;
};
const readState = (engine) => engine.store.record();
const stateBytes = (engine) => engine.store.read("state.json").text;

// ─────────────────── gh-181: every engine-written field declares its clearability ───────────────────

unitTest("gh-181: `--clear created-at` returns the registration date to ABSENT", () => {
  const engine = repo(1);
  assert.match(readState(engine).epics[0].createdAt, /^\d{4}-\d{2}-\d{2}T/);
  engine(["update-epic", "e0", "--clear", "created-at"]);
  assert.equal(readState(engine).epics[0].createdAt, undefined);
});

unitTest("gh-181: `created-at` is NOT a settable flag — the registry row is clearing-only", () => {
  const engine = repo(1);
  const before = stateBytes(engine);
  assert.ok(expectFail(() => engine(["update-epic", "e0", "--created-at", "2020-01-01T00:00:00Z"])));
  assert.equal(stateBytes(engine), before);
});

unitTest("gh-181: `--clear touched-at` is refused, carrying the registry's own reason", () => {
  const engine = repo(1);
  const err = expectFail(() => engine(["update-epic", "e0", "--clear", "touched-at"]));
  assert.ok(err, "an engine-maintained field that is not clearable must refuse");
  assert.match(String(err.stderr || err.message), /touched-at/);
});

// ─────────────────── gh-177: Gate 1's evidence form is the artifact list ───────────────────

unitTest("gh-177: a Gate 1 pass records the ARTIFACTS it reviewed, with no SHA range", () => {
  const engine = repo(1);
  engine(["record-gate-review", "e0", "--gate", "1", "--verdict", "pass",
    "--artifact", "openspec/changes/x/proposal.md"]);
  const g1 = readState(engine).epics[0].gateReview.gate1;
  assert.equal(g1.verdict, "pass");
  assert.deepEqual(g1.artifacts, ["openspec/changes/x/proposal.md"]);
  assert.equal(g1.baseSha, undefined, "no range is recorded, because none was given");
});

unitTest("gh-177: a Gate 1 pass with NO evidence of either kind is refused", () => {
  const engine = repo(1);
  const before = stateBytes(engine);
  assert.ok(expectFail(() => engine(["record-gate-review", "e0", "--gate", "1", "--verdict", "pass"])));
  assert.equal(stateBytes(engine), before);
});

unitTest("gh-177: a Gate 1 FAIL needs no evidence, exactly as a Gate 2 fail does not", () => {
  const engine = repo(1);
  engine(["record-gate-review", "e0", "--gate", "1", "--verdict", "fail"]);
  assert.equal(readState(engine).epics[0].gateReview.gate1.verdict, "fail");
});

unitTest("gh-177: a Gate 2 pass with no range is still refused — the range is Gate 2's evidence form", () => {
  const engine = repo(1);
  const before = stateBytes(engine);
  const err = expectFail(() => engine(["record-gate-review", "e0", "--gate", "2", "--verdict", "pass"]));
  assert.ok(err, "a Gate 2 pass must name the range it covered");
  assert.equal(stateBytes(engine), before);
});

// ─────────────────── gh-178/gh-179: the release read form and its removals ───────────────────

unitTest("gh-178: `release show <id>` renders intent, target, members, deferrals and the verdict", () => {
  const engine = repo(3);
  engine(["release", "0.27.0", "--intent", "a release", "--target", "2026-09-01"]);
  engine(["release", "0.27.0", "--member", "e0"]);
  engine(["release", "0.27.0", "--defer", "e1", "--reason", "cut for scope"]);
  const out = engine(["release", "show", "0.27.0"]);
  assert.match(out, /a release/);
  assert.match(out, /2026-09-01/);
  assert.match(out, /e0/);
  assert.match(out, /cut for scope/);
});

unitTest("gh-178: `release show` is a pure READ — it writes nothing", () => {
  const engine = repo(1);
  engine(["release", "0.27.0", "--intent", "a release"]);
  const before = stateBytes(engine);
  engine(["release", "show", "0.27.0"]);
  assert.equal(stateBytes(engine), before);
});

unitTest("gh-178: `release show` with no id lists every release", () => {
  const engine = repo(1);
  engine(["release", "0.27.0", "--intent", "one"]);
  engine(["release", "0.28.0", "--intent", "two"]);
  const out = engine(["release", "show"]);
  assert.match(out, /0\.27\.0/);
  assert.match(out, /0\.28\.0/);
});

unitTest("gh-178: `release show <unknown>` fails rather than rendering an empty object", () => {
  const engine = repo(1);
  assert.ok(expectFail(() => engine(["release", "show", "9.9.9"])));
});

unitTest("gh-178: `--unmember` removes the membership pointer and RECORDS why", () => {
  const engine = repo(1);
  engine(["release", "0.27.0", "--intent", "a release"]);
  engine(["release", "0.27.0", "--member", "e0"]);
  engine(["release", "0.27.0", "--unmember", "e0", "--reason", "belongs to the next one"]);
  const st = readState(engine);
  assert.equal(st.epics[0].release, undefined);
  const rel = st.releases[0];
  assert.ok(JSON.stringify(rel).includes("belongs to the next one"),
    "removal is recorded, not erased — a correction is a judgment");
});

unitTest("gh-178: `--unmember` requires its reason", () => {
  const engine = repo(1);
  engine(["release", "0.27.0", "--intent", "a release"]);
  engine(["release", "0.27.0", "--member", "e0"]);
  assert.ok(expectFail(() => engine(["release", "0.27.0", "--unmember", "e0"])));
});

unitTest("gh-178: `--undefer` removes the exclusion, keeping both what it used to say and why it ends", () => {
  const engine = repo(1);
  engine(["release", "0.27.0", "--intent", "a release"]);
  engine(["release", "0.27.0", "--defer", "e0", "--reason", "cut on Tuesday"]);
  // The undo needs its own reason, exactly as every other correction does: `--unmember` and
  // `--undefer` both refuse a bare reversal.
  assert.ok(expectFail(() => engine(["release", "0.27.0", "--undefer", "e0"])),
    "an undefer without a reason is refused");
  engine(["release", "0.27.0", "--undefer", "e0", "--reason", "the dependency landed"]);
  const st = readState(engine);
  assert.deepEqual(st.releases[0].deferred, []);
  assert.ok(JSON.stringify(st).includes("cut on Tuesday"),
    "the reason it WAS deferred survives the undoing — an ended exclusion is still a judgment somebody made");
  assert.ok(JSON.stringify(st).includes("the dependency landed"),
    "and the reason it is back is recorded with it");
});

unitTest("gh-178: a release may not be named `show`, which the read form reserves", () => {
  const engine = repo(1);
  assert.ok(expectFail(() => engine(["release", "show", "--intent", "x"])));
});

unitTest("gh-179: `--defer <epicId>:<reason>` carries its reason inline", () => {
  const engine = repo(1);
  engine(["release", "0.27.0", "--intent", "a release"]);
  engine(["release", "0.27.0", "--defer", "e0:depends on #133"]);
  assert.equal(readState(engine).releases[0].deferred[0].reason, "depends on #133");
});

unitTest("gh-179: the out-of-band `--defer <id> --reason \"<why>\"` form still works", () => {
  const engine = repo(1);
  engine(["release", "0.27.0", "--intent", "a release"]);
  engine(["release", "0.27.0", "--defer", "e0", "--reason", "out of band"]);
  assert.equal(readState(engine).releases[0].deferred[0].reason, "out of band");
});

unitTest("gh-179: supplying the reason BOTH ways in one invocation is refused, not resolved", () => {
  const engine = repo(1);
  engine(["release", "0.27.0", "--intent", "a release"]);
  assert.ok(expectFail(() => engine(["release", "0.27.0", "--defer", "e0:inline", "--reason", "out of band"])));
});

unitTest("gh-178: removing an epic sweeps the amendment that names it — no dangling pointer", () => {
  const engine = repo(2);
  engine(["release", "0.27.0", "--intent", "a release"]);
  engine(["release", "0.27.0", "--member", "e0"]);
  engine(["remove-epic", "e0"]);
  assert.doesNotMatch(JSON.stringify(readState(engine)), /"epic":"e0"/);
});

unitTest("gh-178: `release --help` names the read form, not only the seven flags", () => {
  const engine = repo(1);
  const out = engine.combined(["release", "--help"]);
  assert.match(out, /show/);
});
