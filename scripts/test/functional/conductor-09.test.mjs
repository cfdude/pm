import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tmpRepo, run, readState, writeState, expectFail, runHookAgainstFixture, ENGINE, fixtureCommits, hookedRepo, hookedGit, seedAgreeingEntry } from "../fixtures/functional-harness.mjs";
import { removeAtExit } from "../fixtures/temp-dir.mjs";
import { hookMachinery } from "../fixtures/hook-machinery.mjs";

// ──────────────── reconciler structured writeback: record-reconcile ────────────────

test("record-reconcile writes a structured verdict onto the paused epic's link to the detour, and clears reconcileNeeded", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "paused-epic", "--lane", "claude-code"], { cwd });
  run(["add-epic", "--id", "detour-epic", "--lane", "claude-code"], { cwd });
  // The obligation is ARMED by the push and owed after the pop (gates-bind-to-verified-evidence).
  // This used to hand-add the link with --link and set the flag in state.json — a link a verdict
  // can no longer answer, because a hand-supplied may-invalidate link is never armed.
  run(["set-active", "paused-epic"], { cwd });
  run(["push-detour", "paused-epic", "--detour", "detour-epic", "--reason", "blocked", "--reconcile"], { cwd });
  run(["pop-detour", "paused-epic"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "paused-epic").reconcileNeeded, true);

  run(["record-reconcile", "paused-epic", "--detour", "detour-epic",
    "--verdict", "invalidated", "--amendments", "rewrite story 2;drop story 4"], { cwd });

  const epic = readState(cwd).epics.find(e => e.id === "paused-epic");
  assert.equal(epic.reconcileNeeded, false);
  const link = epic.links.find(l => l.epic === "detour-epic");
  assert.ok(link, "link to the detour should still exist");
  assert.equal(link.reconciled.verdict, "invalidated");
  assert.deepEqual(link.reconciled.amendments, ["rewrite story 2", "drop story 4"]);
  assert.ok(link.reconciled.reconciledAt);
  assert.match(link.reconciled.reconciledAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("record-reconcile NEVER creates a link: a detour the epic was not paused for is refused, and nothing is written", () => {
  // INVERTED by gates-bind-to-verified-evidence. This test pinned the behaviour that was the
  // bypass: the verb pushed a may-invalidate link to whatever --detour named and cleared the flag,
  // so a verdict against an unrelated epic answered an obligation owed against a real detour.
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "paused-epic", "--lane", "claude-code"], { cwd });
  run(["add-epic", "--id", "detour-epic", "--lane", "claude-code"], { cwd });
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");

  const err = expectFail(() => run(["record-reconcile", "paused-epic", "--detour", "detour-epic", "--verdict", "valid"], { cwd }));
  assert.ok(err, "a verdict against a detour nobody armed is refused");
  assert.match(String(err.stderr || err.message), /owes no reconcile verdict/);
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before, "nothing was written");
  const epic = readState(cwd).epics.find(e => e.id === "paused-epic");
  assert.equal((epic.links || []).some(l => l.epic === "detour-epic"), false, "no link was created");
});

test("record-reconcile rejects an unknown verdict", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "paused-epic", "--lane", "claude-code"], { cwd });
  run(["add-epic", "--id", "detour-epic", "--lane", "claude-code"], { cwd });
  assert.ok(expectFail(() => run(
    ["record-reconcile", "paused-epic", "--detour", "detour-epic", "--verdict", "maybe"], { cwd })));
});

test("record-reconcile on an unknown epic id exits non-zero and writes nothing", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "detour-epic", "--lane", "claude-code"], { cwd });
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  assert.ok(expectFail(() => run(
    ["record-reconcile", "ghost", "--detour", "detour-epic", "--verdict", "valid"], { cwd })));
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before);
});

test("record-reconcile on an unknown detour id exits non-zero and writes nothing", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "paused-epic", "--lane", "claude-code"], { cwd });
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  const err = expectFail(() => run(
    ["record-reconcile", "paused-epic", "--detour", "ghost-detour", "--verdict", "valid"], { cwd }));
  assert.ok(err);
  // Named as a missing epic, not diagnosed as an unarmed detour (gates-bind-to-verified-evidence
  // kept this refusal; without the assertion the arming refusal made the test pass vacuously).
  assert.match(String(err.stderr || err.message), /detour epic 'ghost-detour' not found/);
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before);
});

// ---------- doc drift: SKILL.md "Commands" vs the real dispatch table ----------

test("every dispatch-table subcommand is mentioned somewhere in skills/conductor/SKILL.md", () => {
  const engineSrc = fs.readFileSync(ENGINE, "utf8");
  // 0.47.0 (task 2.3) wrapped the module body in `main(argv, io)`, so the table is no longer a
  // bare `({` at the start of a line and its closing `}[cmd]` is indented. The extractor is
  // re-pointed rather than loosened into uselessness: it still requires the object literal to be
  // the one indexed by `[cmd]`.
  const dispatchMatch = engineSrc.match(/\(\{\n([\s\S]*?)\n\s*\}\[cmd\]/m);
  assert.ok(dispatchMatch, "could not locate the dispatch table object in conductor.mjs — " +
    "has the dispatch section been restructured? update this test's extraction regex");
  const dispatchBody = dispatchMatch[1];

  // Each dispatch entry key is either a bare identifier (`init,`) or a quoted string
  // (`"set-active": setActive,`). Extract both forms.
  const keys = new Set();
  for (const m of dispatchBody.matchAll(/^\s*"([a-z-]+)"\s*:/gm)) keys.add(m[1]);
  for (const m of dispatchBody.matchAll(/^\s*([a-zA-Z][\w-]*)\s*:/gm)) keys.add(m[1]);
  for (const m of dispatchBody.matchAll(/^\s*([a-zA-Z][\w-]*),?\s*$/gm)) keys.add(m[1]);
  assert.ok(keys.size > 10, `expected many dispatch keys, only extracted ${keys.size}: ${[...keys]}`);

  // No entries are excluded: `snapshot` and `write-rules` are hook/init-only invocations
  // (not run directly by a user/agent) but are still real, documentable subcommands, so
  // they are asserted like everything else rather than excluded.
  const UNDOCUMENTED_INTERNAL = new Set([
    // (currently empty — every dispatch subcommand is expected to be mentioned in SKILL.md)
  ]);

  const skillPath = path.join(path.dirname(ENGINE), "..", "skills", "conductor", "SKILL.md");
  const skillText = fs.readFileSync(skillPath, "utf8");

  const missing = [];
  for (const key of keys) {
    if (UNDOCUMENTED_INTERNAL.has(key)) continue;
    if (!skillText.includes(key)) missing.push(key);
  }
  assert.deepEqual(missing, [],
    `SKILL.md's Commands section (or elsewhere in the doc) is missing a mention of: ${missing.join(", ")}`);
});

// ──────────────── openspec gate enforcement: record-gate-review ────────────────

test("record-gate-review writes a structured verdict for the given gate onto an openspec-lane epic", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  const [a, b] = fixtureCommits(cwd, ["a", "b"]);
  run(["add-epic", "--id", "spec-epic", "--lane", "openspec"], { cwd });

  run(["record-gate-review", "spec-epic", "--gate", "1", "--verdict", "pass",
    "--base-sha", a, "--head-sha", b,
    "--reviewer", "fresh-context review of proposal.md"], { cwd });

  const epic = readState(cwd).epics.find(e => e.id === "spec-epic");
  assert.ok(epic.gateReview);
  assert.equal(epic.gateReview.gate1.verdict, "pass");
  // `--reviewer` used to land in `note`, which is the legacy shape and is now read-only:
  // reviewer identity is its own field so an audit over reviewers cannot pick up other prose.
  assert.equal(epic.gateReview.gate1.reviewer, "fresh-context review of proposal.md");
  assert.ok(epic.gateReview.gate1.reviewedAt);
  assert.match(epic.gateReview.gate1.reviewedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("record-gate-review supports gate 2 independently of gate 1", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  const [a, b] = fixtureCommits(cwd, ["a", "b"]);
  run(["add-epic", "--id", "spec-epic", "--lane", "openspec"], { cwd });

  run(["record-gate-review", "spec-epic", "--gate", "2", "--verdict", "pass", "--base-sha", a, "--head-sha", b], { cwd });

  const epic = readState(cwd).epics.find(e => e.id === "spec-epic");
  assert.equal(epic.gateReview.gate2.verdict, "pass");
  assert.equal(epic.gateReview.gate1, undefined);
});

test("record-gate-review ACCEPTS a non-openspec-lane epic (#163)", () => {
  // INVERTED DELIBERATELY. This asserted the refusal that #163 removes: a verdict was recordable
  // only on an openspec-lane epic, while `set-review-mode` is lane-agnostic and its own table
  // names "a Superpowers task review" — so pm told every lane to run reviews and could record the
  // verdict for one of them. Evidence for other lanes became `--notes` prose that nothing
  // compares, so it could never read stale, and `integrity` (which keys off `gateReview`) could
  // not see it at all.
  //
  // The property this test actually protected — that a refusal writes nothing — is not lost: it
  // moves to the refusals that remain (unknown epic id, bad gate, a pass with no range), each
  // covered by its own test in this file. What is gone is the refusal itself.
  const cwd = tmpRepo(); run(["init"], { cwd });
  const [a, b] = fixtureCommits(cwd, ["a", "b"]);
  run(["add-epic", "--id", "cc-epic", "--lane", "claude-code"], { cwd });
  run(["record-gate-review", "cc-epic", "--gate", "1", "--verdict", "pass",
       "--base-sha", a, "--head-sha", b], { cwd });
  const epic = readState(cwd).epics.find(e => e.id === "cc-epic");
  assert.equal(epic.gateReview.gate1.verdict, "pass");
  assert.equal(epic.gateReview.gate1.baseSha, a);
});

test("recording a verdict adds NO archive obligation to a non-openspec lane (#163)", () => {
  // The other half, and the one that would hurt if it broke: letting evidence be recorded where
  // reviews happen must not make a lane un-archivable without it. A claude-code epic carrying no
  // verdict at all archives exactly as it always has.
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "cc2", "--lane", "claude-code"], { cwd });
  run(["update-epic", "cc2", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "cc2").status, "archived");
});

test("record-gate-review rejects an unknown epic id", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  const [a, b] = fixtureCommits(cwd, ["a", "b"]);
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  assert.ok(expectFail(() => run(
    ["record-gate-review", "ghost", "--gate", "1", "--verdict", "pass", "--base-sha", a, "--head-sha", b], { cwd })));
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before);
});

test("record-gate-review rejects an invalid gate number", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  const [a, b] = fixtureCommits(cwd, ["a", "b"]);
  run(["add-epic", "--id", "spec-epic", "--lane", "openspec"], { cwd });
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  assert.ok(expectFail(() => run(
    ["record-gate-review", "spec-epic", "--gate", "3", "--verdict", "pass", "--base-sha", a, "--head-sha", b], { cwd })));
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before);
});

test("record-gate-review rejects an invalid verdict", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "spec-epic", "--lane", "openspec"], { cwd });
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  assert.ok(expectFail(() => run(
    ["record-gate-review", "spec-epic", "--gate", "1", "--verdict", "maybe"], { cwd })));
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before);
});

test("update-epic blocks archiving an openspec-lane epic without a passing gate2 review", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "spec-epic", "--lane", "openspec"], { cwd });
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  assert.ok(expectFail(() => run(["update-epic", "spec-epic", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd })));
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before);
});

test("update-epic blocks archiving an openspec-lane epic with a gate2 fail verdict", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "spec-epic", "--lane", "openspec"], { cwd });
  run(["record-gate-review", "spec-epic", "--gate", "2", "--verdict", "fail"], { cwd });
  assert.ok(expectFail(() => run(["update-epic", "spec-epic", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd })));
});

test("update-epic allows archiving an openspec-lane epic once gate2 has a passing verdict", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  const [a, b] = fixtureCommits(cwd, ["a", "b"]);
  run(["add-epic", "--id", "spec-epic", "--lane", "openspec"], { cwd });
  run(["record-gate-review", "spec-epic", "--gate", "1", "--verdict", "pass", "--base-sha", a, "--head-sha", b], { cwd });
  run(["record-gate-review", "spec-epic", "--gate", "2", "--verdict", "pass", "--base-sha", a, "--head-sha", b], { cwd });

  run(["update-epic", "spec-epic", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd });

  const epic = readState(cwd).epics.find(e => e.id === "spec-epic");
  assert.equal(epic.status, "archived");
});

test("update-epic archiving a non-openspec-lane epic is unaffected by gate-review enforcement", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "cc-epic", "--lane", "claude-code"], { cwd });

  run(["update-epic", "cc-epic", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd });

  const epic = readState(cwd).epics.find(e => e.id === "cc-epic");
  assert.equal(epic.status, "archived");
});

// ---------- doc drift: README.md "Commands" vs the real dispatch table ----------

test("every dispatch-table subcommand is mentioned somewhere in README.md", () => {
  const engineSrc = fs.readFileSync(ENGINE, "utf8");
  // 0.47.0 (task 2.3) wrapped the module body in `main(argv, io)`, so the table is no longer a
  // bare `({` at the start of a line and its closing `}[cmd]` is indented. The extractor is
  // re-pointed rather than loosened into uselessness: it still requires the object literal to be
  // the one indexed by `[cmd]`.
  const dispatchMatch = engineSrc.match(/\(\{\n([\s\S]*?)\n\s*\}\[cmd\]/m);
  assert.ok(dispatchMatch, "could not locate the dispatch table object in conductor.mjs — " +
    "has the dispatch section been restructured? update this test's extraction regex");
  const dispatchBody = dispatchMatch[1];

  const keys = new Set();
  for (const m of dispatchBody.matchAll(/^\s*"([a-z-]+)"\s*:/gm)) keys.add(m[1]);
  for (const m of dispatchBody.matchAll(/^\s*([a-zA-Z][\w-]*)\s*:/gm)) keys.add(m[1]);
  for (const m of dispatchBody.matchAll(/^\s*([a-zA-Z][\w-]*),?\s*$/gm)) keys.add(m[1]);
  assert.ok(keys.size > 10, `expected many dispatch keys, only extracted ${keys.size}: ${[...keys]}`);

  // No entries are excluded — same precedent as the SKILL.md drift test: hook/init-only
  // subcommands (commit-nudge, snapshot, write-rules) are still real and documentable, so
  // they're asserted like everything else rather than silently excluded.
  const UNDOCUMENTED_INTERNAL = new Set([
    // (currently empty — every dispatch subcommand is expected to be mentioned in README.md)
  ]);

  const readmePath = path.join(path.dirname(ENGINE), "..", "README.md");
  const readmeText = fs.readFileSync(readmePath, "utf8");

  const missing = [];
  for (const key of keys) {
    if (UNDOCUMENTED_INTERNAL.has(key)) continue;
    if (!readmeText.includes(key)) missing.push(key);
  }
  assert.deepEqual(missing, [],
    `README.md's Commands section (or elsewhere in the doc) is missing a mention of: ${missing.join(", ")}`);
});

// ---------- pre-commit hook: THE THREE TESTS THAT MUST SPAWN ----------
//
// THE HOOK'S SHAPE IS ASSERTED IN THE ASSERTION TWIN, and it moved there in 6.4: the test
// that checked the hook EXISTS, is EXECUTABLE, runs the assertion half in one runner invocation, derives
// the floor's `declared` from the index and hands the enrolment rule to the drift script reads
// FILES AND SPAWNS NOTHING — so by D5's placement rule it belongs on the per-commit path, and
// the fast half is where a hook that lost its drift step or took the enrolment check back
// inline is caught first. What is left here is the part whose subject IS a shell: the hook run
// against a fixture repository.

test("G-I1 the floor FIRES when the runner's glob cannot reach a file the half still declares", () => {
  // THE FIRING DIRECTION, which nothing held (Gate 2, G-I1). The test above pins the floor's
  // PRECISION — it must not fire on a non-test .mjs file — and the shape assertion in the assertion
  // twin pins the hook's TEXT. Neither of them makes the floor fire, so neutering it left the whole
  // suite green: `if [ "$total" -lt "$declared" ]; then` → `if false; then` was invisible.
  //
  // The shape reproduced here is the real one, and it is git's: `git ls-files 'scripts/test/assert/
  // *.test.mjs'` matches `/` AND a leading dot, while `/bin/sh`'s expansion of the SAME pattern
  // matches neither. So a file sitting in that directory behind a dot is DECLARED (it is in the
  // index) and UNREACHABLE (the runner is handed a shell-expanded list that omits it) — which is
  // exactly `total < declared`, produced by construction rather than by a doctored count.
  const r = runHookAgainstFixture(
    `test("the one the runner reaches", () => { assert.ok(true); });`,
    {
      extraFiles: {
        "scripts/test/assert/.collapsed.test.mjs":
          'import { test } from "node:test";\nimport assert from "node:assert/strict";\n' +
          'test("declared, and unreachable by the runner\'s own glob", () => { assert.ok(true); });\n',
      },
    },
  );
  const combined = (r.stdout || "") + (r.stderr || "");
  assert.notEqual(r.status, 0,
    `the floor must abort the commit: the file is declared and never ran. Output was: ${combined}`);
  assert.match(combined, /pre-commit: ABORT -- the assertion half ran 1 tests but 2 are declared in/,
    "the ABORT must name BOTH counts — a refusal that says only 'fewer' cannot be diagnosed");
  assert.match(combined, /A test file is not being picked up/,
    "and it must say what a shortfall means, because the symptom is a passing suite");
});

test("G-I3 the hook does NOT run the functional half — a marker file there is never picked up", () => {
  // "THE HOOK DOES NOT RUN THE FUNCTIONAL HALF" IS A REQUIREMENT, NOT A STYLE (design D8, and the
  // spec's "A commit that touches a certified module requires a fresh functional result" scenario —
  // "It does not start that run itself" — and "The gate stays fast"): the functional half is the
  // triggered half, and running it on every commit is exactly the cost the split exists to remove. It was held by nothing — adding the functional glob to the hook's runner
  // left the whole assertion half green AND the hook's own functional tests green (Gate 2, G-I3).
  //
  // So the functional half of the FIXTURE holds a marker test that fails the moment it runs, and the
  // assertion is that the run never reaches it. Its assertion twin is written too — the drift script
  // refuses a functional id with no twin, and a fixture that tripped the drift check would be
  // testing the wrong refusal. For the same reason the fixture SEEDS an agreeing functional entry
  // (certification-record-redesign 2.4): the staged marker is in the functional subject, so without
  // one drift would refuse for freshness before the suite step this test observes.
  const r = runHookAgainstFixture(
    `test("the one the runner reaches", () => { assert.ok(true); });`,
    {
      extraFiles: {
        "scripts/test/functional/marker.test.mjs":
          'import { test } from "node:test";\nimport assert from "node:assert/strict";\n' +
          'test("G-I3 MARKER the hook must never run this functional file", () => {\n' +
          '  assert.fail("the hook ran the functional half");\n});\n',
        "scripts/test/assert/marker.test.mjs":
          'import { test } from "node:test";\nimport assert from "node:assert/strict";\n' +
          'test("the marker\'s assertion twin", () => { assert.ok(true); });\n',
      },
      seed: ["functional"],
    },
  );
  const combined = (r.stdout || "") + (r.stderr || "");
  assert.equal(r.status, 0, `the hook must run only the passing assertion half: ${combined}`);
  assert.doesNotMatch(combined, /G-I3 MARKER the hook must never run this functional file/,
    "the hook ran a file from scripts/test/functional/ — the triggered half ran on a commit, which " +
    "is the cost this change exists to remove");
  assert.doesNotMatch(combined, /the hook ran the functional half/,
    "the marker's failure reached the hook's output");
  assert.match(combined, /pre-commit: 2\/2 passing/,
    "and the run must be the assertion half's own two tests — a marker that never ran must not have " +
    "changed the count either");
});

test(".githooks/pre-commit aborts when the glob runs FEWER tests than are declared", () => {
  // The failure mode the glob introduces: a test file that stops being picked up. The suite
  // still passes -- on a subset. Simulated here by declaring tests in a file the hook's glob
  // cannot match (.mjs without the .test infix), so declared > ran.
  const r = runHookAgainstFixture(
    `test("one that does run", () => { assert.ok(true); });`,
    { extraFiles: { "scripts/test/orphan.mjs": 'test("never picked up", () => {});\ntest("nor this", () => {});\n' } },
  );
  const combined = (r.stdout || "") + (r.stderr || "");
  // orphan.mjs is not matched by *.test.mjs, so it contributes nothing to either count -- the
  // guard must not false-positive here. This pins the guard's precision, not just its presence.
  assert.equal(r.status, 0, `guard must not fire on a non-test .mjs file: ${combined}`);
  assert.match(combined, /pre-commit: 1\/1 passing/);
});

test(".githooks/pre-commit is quiet on success -- one summary line, no per-test noise, no engine banner", () => {
  const passingTests = `
    import { test } from "node:test";
    import assert from "node:assert/strict";
    test("a passing test", () => { assert.ok(true); });
    test("another passing test", () => { assert.ok(true); });
  `;
  const r = runHookAgainstFixture(passingTests);
  assert.equal(r.status, 0, `expected the hook to exit 0 on a passing suite: ${r.stdout}${r.stderr}`);
  const combined = (r.stdout || "") + (r.stderr || "");
  assert.match(combined, /pre-commit: 2\/2 passing/, "expected a one-line N/N passing summary");
  assert.doesNotMatch(combined, /✔/, "should not dump individual per-test pass lines on success");
});

test(".githooks/pre-commit dumps full node --test output and fails the commit when a test actually fails", () => {
  const failingTests = `
    import { test } from "node:test";
    import assert from "node:assert/strict";
    test("a passing test", () => { assert.ok(true); });
    test("a FAILING test", () => { assert.ok(false, "boom"); });
  `;
  const r = runHookAgainstFixture(failingTests);
  assert.notEqual(r.status, 0, "expected the hook to exit non-zero on a failing suite");
  const combined = (r.stdout || "") + (r.stderr || "");
  assert.match(combined, /a FAILING test/, "full test output (including the failure) must be dumped on failure");
  assert.doesNotMatch(combined, /^pre-commit: \d+\/\d+ passing/m, "must not print the success summary on failure");
});

test(".githooks/pre-commit runs the half when a rung holds no test file — one unmatched rung does not stop the other", () => {
  // SUITE-CERTIFICATION'S "ONE RUNG THAT MATCHES NOTHING DOES NOT STOP THE OTHER" (0.49.0), and the
  // test that has guarded it since it was a Node-18 bug. The fixture's unit rung holds only `.keep`,
  // so `/bin/sh` hands `scripts/test/unit/*.test.mjs` to the runner as a LITERAL (POSIX sh has no
  // nullglob), while the file rung's pattern expands to one real file.
  //
  // ITS HISTORY. Found on CI (PR #217) and reproduced against v18.20.8: Node 18 REFUSED the literal —
  // `Could not find '/tmp/…/scripts/test/unit/*.test.mjs'`, exit 1 — so the commit failed with a
  // message that blamed the suite, while v26.9.0 ran the files that did match. 0.48.x answered it with
  // a `[ -f ]` loop that resolved the file set before the runner saw it. 0.49.0 dropped Node 18 and 20
  // and deleted the loop: every supported Node (22, 24, 26, measured on the real binaries) runs an
  // unmatched literal pattern as zero files, so the runner's command line carries the two globs again.
  // The assertions are unchanged, and they now hold on whatever supported major runs them: no
  // `Could not find`, exit 0, and the file that exists still ran.
  //
  // THE FIXTURE'S TREE IS A SHAPE THE SUITE ALREADY CALLS LEGITIMATE. certification.mjs's `testIdsIn`
  // states it: "A MISSING DIRECTORY IS AN EMPTY ONE, not a crash … the functional half's hook tests
  // build a throwaway tree with only the directories their subject needs". So the rung directory here
  // EXISTS and holds no test file, which is the sharper of the two cases: the property is that the
  // PATTERN resolves, never that the directory is present.
  const r = runHookAgainstFixture(
    `test("the one that does exist", () => { assert.ok(true); });`,
    { extraFiles: { "scripts/test/unit/.keep": "" } },
  );
  const combined = (r.stdout || "") + (r.stderr || "");
  assert.doesNotMatch(combined, /Could not find/,
    "a rung glob that resolves to nothing made the runner refuse: on a supported Node an unmatched " +
    "pattern runs as zero files, and one empty rung must not stop the other. " +
    `Output was: ${combined}`);
  assert.equal(r.status, 0, `the hook must run the half that exists: ${combined}`);
  assert.match(combined, /pre-commit: 1\/1 passing/,
    "and the file that DOES exist must still have run — the fix must not be 'run nothing'");
});

test("1.1 the floor compares a count when the environment forces colour — FORCE_COLOR=1 does not skip it", () => {
  // THE LATENT DEFECT 0.49.0 FOUND (design D4). The spec reporter colours its summary when the
  // environment forces colour, every summary line then begins `ESC[34mℹ`, and a `^ℹ tests ` anchor
  // matches NOTHING. The old hook read that as "summary line not found", printed "tests passing" and
  // exited 0 WITH THE FLOOR SKIPPED — so any colour-forcing environment disabled the floor silently.
  // It reproduces only where the runner's default non-TTY reporter is spec (Node 24+); on 22 the
  // default is TAP, which is never coloured. The hook now forces the reporter AND `FORCE_COLOR=0`, so
  // the count is read — which is what `2/2 passing` proves: the line prints only from a parsed count.
  const r = runHookAgainstFixture(
    `test("a passing test", () => { assert.ok(true); });\ntest("another passing test", () => { assert.ok(true); });`,
    { env: { FORCE_COLOR: "1" } },
  );
  const combined = (r.stdout || "") + (r.stderr || "");
  assert.equal(r.status, 0, `the hook must pass a passing half under FORCE_COLOR=1: ${combined}`);
  assert.match(combined, /pre-commit: 2\/2 passing/,
    "under FORCE_COLOR=1 the hook did not read the runner's count, so the floor compared nothing — " +
    `the colour setting disabled the gate. Output was: ${combined}`);
});

test("1.2 a runner that exits 0 and prints no summary is REFUSED — 'the count could not be read'", () => {
  // THE UNREADABLE-COUNT REFUSAL, durable (Gate 1 I2). A stub `node` goes first on PATH: a shell
  // script that exits 0 and prints nothing. It answers the drift step too (exit 0, so drift passes),
  // which is why the assertion is on the RUNNER's refusal text and never on the exit status alone —
  // a non-zero exit from drift would satisfy "non-zero" and prove nothing about the floor.
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-stub-node-"));
  try {
    fs.writeFileSync(path.join(stubDir, "node"), "#!/bin/sh\nexit 0\n");
    fs.chmodSync(path.join(stubDir, "node"), 0o755);
    const r = runHookAgainstFixture(
      `test("a passing test", () => { assert.ok(true); });`,
      { pathPrepend: stubDir },
    );
    const combined = (r.stdout || "") + (r.stderr || "");
    assert.notEqual(r.status, 0,
      `a runner whose count cannot be read must not pass the commit. Output was: ${combined}`);
    assert.match(combined, /pre-commit: ABORT -- the count could not be read/,
      `the refusal must say the COUNT could not be read, not that the tests failed. Output was: ${combined}`);
    assert.doesNotMatch(combined, /tests passing/,
      "the hook reported the tests as passing on a run it could not count");
  } finally {
    fs.rmSync(stubDir, { recursive: true, force: true });
  }
});

test("1.3 both rungs empty is REFUSED naming both rungs, and default discovery is never reached", () => {
  // REGRESSION GUARD, and it passes before 1.4 through the resolved-list loop's empty-list abort.
  // After 1.4 there is no loop: the runner is handed the two globs literally, runs zero files, and the
  // hook refuses on the COUNT — `declared = 0` — with the same message. Either way the property is
  // the one the spec names: at no point does `node --test` run without a path, because its default
  // discovery walks the tree and would reach the triggered buckets. The marker sits in the sweep
  // bucket (a functional-half marker would need an assertion twin, and that twin would be a rung file,
  // which is the one thing this fixture must not hold); default discovery would run it, and its title
  // must never appear. The marker is in the sweeps subject, so the fixture SEEDS an agreeing sweeps
  // entry (certification-record-redesign 2.4): a drift ABORT would pre-empt the suite step's refusal.
  const r = runHookAgainstFixture("", {
    seed: ["sweeps"],
    withFixture: false,
    extraFiles: {
      "scripts/test/unit/.keep": "",
      "scripts/test/assert/.keep": "",
      "scripts/test/sweeps/marker.test.mjs":
        'import { test } from "node:test";\nimport assert from "node:assert/strict";\n' +
        'test("1.3 MARKER default discovery ran a triggered bucket", () => {\n' +
        '  assert.fail("default discovery reached the sweep bucket");\n});\n',
    },
  });
  const combined = (r.stdout || "") + (r.stderr || "");
  assert.notEqual(r.status, 0, `two empty rungs must refuse the commit: ${combined}`);
  assert.match(combined, /neither rung of the assertion half holds a \*\.test\.mjs file/,
    `the refusal must say neither rung holds a test file. Output was: ${combined}`);
  assert.match(combined, /scripts\/test\/unit\//, "the refusal must name the unit rung");
  assert.match(combined, /scripts\/test\/assert\//, "the refusal must name the file rung");
  assert.doesNotMatch(combined, /1\.3 MARKER/,
    "default discovery ran: the marker in a triggered bucket reached the hook's output");
});

test("1.4 a COLLAPSED run — the index declares tests, the runner reports 0 — is a shortfall, not an empty rung", () => {
  // SUITE-CERTIFICATION'S "A collapsed run is a shortfall, not an empty rung" (Gate 1 B6). The only
  // test file sits in the file rung behind a dot, so it is DECLARED (git ls-files matches a leading
  // dot) and UNREACHABLE (neither the shell's glob nor node's matches it): the runner reports 0 while
  // the index declares 1. The floor is checked FIRST, so the refusal names both counts, and the
  // empty-rung message — which is for an index that declares nothing — never appears.
  const r = runHookAgainstFixture("", {
    withFixture: false,
    extraFiles: {
      "scripts/test/unit/.keep": "",
      "scripts/test/assert/.collapsed.test.mjs":
        'import { test } from "node:test";\nimport assert from "node:assert/strict";\n' +
        'test("declared, and unreachable by either glob", () => { assert.ok(true); });\n',
    },
  });
  const combined = (r.stdout || "") + (r.stderr || "");
  assert.notEqual(r.status, 0, `a run of zero tests against a declared count must refuse: ${combined}`);
  assert.match(combined, /pre-commit: ABORT -- the assertion half ran 0 tests but 1 are declared in/,
    `a collapsed run must be the shortfall naming both counts. Output was: ${combined}`);
  assert.doesNotMatch(combined, /neither rung of the assertion half holds/,
    "a collapsed run was reported as an empty rung — the floor must be compared before that message");
});

test("1.5 the retired probe's pm-isolation-flag is removed from a clone that still holds one", () => {
  // THE INVERSE OF THE OLD PROBE'S WRITE (0.49.0 task 1.5, design D3). Until 0.49.0 the hook cached
  // its isolation probe's answer in `$(git rev-parse --git-common-dir)/pm-isolation-flag`. The probe
  // is gone; one hook run must leave no such file behind in a clone that ran the old hook.
  let flag;
  const r = runHookAgainstFixture(
    `test("a passing test", () => { assert.ok(true); });`,
    {
      setup: (cwd) => {
        flag = path.join(cwd, ".git", "pm-isolation-flag");
        fs.writeFileSync(flag, "stale answer from a pre-0.49.0 hook");
      },
    },
  );
  const combined = (r.stdout || "") + (r.stderr || "");
  assert.equal(r.status, 0, `the hook must pass a passing half: ${combined}`);
  assert.ok(flag, "the fixture's setup never ran, so there was no stale file to remove");
  assert.equal(fs.existsSync(flag), false,
    `the hook left the retired probe's cache file behind at ${flag}`);
});

// ---------- the hook verifies the INDEX, never the working tree (commit-gate-tests-working-tree-not-index) ----------
//
// THE COMMIT IS THE UNIT OF VERIFICATION (required item 2), and until 0.50.0 the per-commit gate broke
// it: the hook ran the suite over the CHECKOUT, so a failing test staged and a passing copy restored
// unstaged committed green while HEAD held the failing test. The hook now exports the commit's index
// with `git checkout-index -a --prefix=<snapshot>/` into a private temp dir and runs the half THERE,
// never writing the working tree or the index. Every fixture below asserts BOTH directions it can:
// what ran, and that the user's bytes are exactly as they were.
//
// Setup git calls are hermetic — no global or system config reaches them.

const HERMETIC_GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
delete HERMETIC_GIT_ENV.GIT_INDEX_FILE;
const IX_FILE = "scripts/test/assert/fixture.test.mjs";
const IX_HEADER = 'import { test } from "node:test";\nimport assert from "node:assert/strict";\n';
const IX_PASSING = IX_HEADER + 'test("IX the working-tree copy that passes", () => { assert.ok(true); });\n';
const IX_FAILING = IX_HEADER + 'test("IX the STAGED copy that fails", () => { assert.fail("staged bytes ran"); });\n';
const ixGit = (cwd, args, env = HERMETIC_GIT_ENV) => execFileSync("git", args, { cwd, env, encoding: "utf8" });
const ixOut = (r) => (r.stdout || "") + (r.stderr || "");
/** A private TMPDIR per fixture, so "the hook left nothing behind" is observable. */
const ixTmpdir = () => removeAtExit(fs.mkdtempSync(path.join(os.tmpdir(), "pm-ix-tmpdir-")));

test("IX-a a STAGED failing test with a PASSING copy unstaged ABORTS the commit, and the tree is untouched", () => {
  // THE EPIC'S REPRODUCTION, as a fixture that must abort. The fixture's body is the failing copy and
  // is what `runHookAgainstFixture` stages; `setup` then overwrites the working tree with a passing
  // copy and leaves it unstaged. The old hook ran the working tree: 1/1 passing, exit 0.
  const r = runHookAgainstFixture(IX_FAILING, {
    setup: (cwd) => fs.writeFileSync(path.join(cwd, IX_FILE), IX_PASSING),
  });
  const combined = ixOut(r);
  assert.notEqual(r.status, 0,
    `the index holds a failing test, so the commit must abort — the hook ran the working tree. Output: ${combined}`);
  assert.match(combined, /IX the STAGED copy that fails/, "the failure reported must be the STAGED test's");
  assert.doesNotMatch(combined, /^pre-commit: \d+\/\d+ passing/m, "a failing index must never print the success line");
  assert.equal(fs.readFileSync(path.join(r.cwd, IX_FILE), "utf8"), IX_PASSING,
    "the unstaged working-tree copy was changed by the hook");
  assert.equal(ixGit(r.cwd, ["show", `:${IX_FILE}`]), IX_FAILING, "the index was changed by the hook");
});

test("IX-b the converse: a STAGED passing test with a FAILING copy unstaged passes, and the tree is untouched", () => {
  // PRECISION. A failure that exists only in the working tree is not in the commit, so it must not
  // block it — the hook verifies the commit, not the checkout, in both directions.
  const r = runHookAgainstFixture(IX_PASSING, {
    setup: (cwd) => fs.writeFileSync(path.join(cwd, IX_FILE), IX_FAILING),
  });
  const combined = ixOut(r);
  assert.equal(r.status, 0, `the index holds only a passing test: ${combined}`);
  assert.match(combined, /pre-commit: 1\/1 passing/);
  assert.equal(fs.readFileSync(path.join(r.cwd, IX_FILE), "utf8"), IX_FAILING,
    "the unstaged working-tree copy was changed by the hook");
});

test("IX-c an UNTRACKED failing test file in a rung never runs, and is still on disk afterwards", () => {
  // An untracked file is not in the commit: it must neither block it nor be counted, and the hook must
  // not move, stash or delete it to get it out of the way.
  const untracked = "scripts/test/assert/untracked.test.mjs";
  const body = IX_HEADER + 'test("IX-c UNTRACKED MARKER", () => { assert.fail("an untracked file ran"); });\n';
  const r = runHookAgainstFixture(IX_PASSING, {
    setup: (cwd) => fs.writeFileSync(path.join(cwd, untracked), body),
  });
  const combined = ixOut(r);
  assert.equal(r.status, 0, `an untracked file is not in the commit: ${combined}`);
  assert.doesNotMatch(combined, /IX-c UNTRACKED MARKER/, "the untracked test file ran");
  assert.match(combined, /pre-commit: 1\/1 passing/, "and it must not have been counted either");
  assert.equal(fs.readFileSync(path.join(r.cwd, untracked), "utf8"), body, "the untracked file was moved or changed");
});

test("IX-d the index git HANDS the hook is the one verified — `commit -a` / `commit <path>` use their own", () => {
  // Measured with git 2.55: `git commit -a` runs the hook with GIT_INDEX_FILE=<abs>/.git/index.lock and
  // `git commit <path>` with GIT_INDEX_FILE=<abs>/.git/next-index-<pid>.lock, while `.git/index` still
  // holds the STALE content. The hook scrubs GIT_INDEX_FILE (so the suite's child gits cannot reach the
  // outer repo) — so it must capture it FIRST. Here `.git/index` holds the passing copy and the index
  // git hands the hook holds the failing one; the path is RELATIVE, as git gives it for a plain commit,
  // so the capture must also be absolutised before the hook moves into its snapshot.
  const alt = ".git/alt-index";
  const r = runHookAgainstFixture(IX_PASSING, {
    env: { GIT_INDEX_FILE: alt },
    setup: (cwd) => {
      fs.copyFileSync(path.join(cwd, ".git", "index"), path.join(cwd, alt));
      fs.writeFileSync(path.join(cwd, IX_FILE), IX_FAILING);
      ixGit(cwd, ["add", "--", IX_FILE], { ...HERMETIC_GIT_ENV, GIT_INDEX_FILE: alt });
      fs.writeFileSync(path.join(cwd, IX_FILE), IX_PASSING);
    },
  });
  const combined = ixOut(r);
  assert.equal(ixGit(r.cwd, ["show", `:${IX_FILE}`]), IX_PASSING, "fixture: .git/index must hold the passing copy");
  assert.notEqual(r.status, 0,
    `the index git handed the hook holds a failing test; the hook verified .git/index instead. Output: ${combined}`);
  assert.match(combined, /IX the STAGED copy that fails/);
});

test("IX-g a PARTIALLY staged test file is counted by its STAGED half — the floor reads the snapshot", () => {
  // The index holds one test; the working tree adds a second, unstaged. The runner runs the index's
  // one, so the floor's `declared` must be read from the index's bytes too — counting the working
  // tree's copy would declare 2 against 1 ran and refuse a correct commit as a shortfall.
  const twoTests = IX_PASSING + 'test("IX-g an UNSTAGED second test", () => { assert.ok(true); });\n';
  const r = runHookAgainstFixture(IX_PASSING, {
    setup: (cwd) => fs.writeFileSync(path.join(cwd, IX_FILE), twoTests),
  });
  const combined = ixOut(r);
  assert.equal(r.status, 0, `the index declares and runs one test: ${combined}`);
  assert.match(combined, /pre-commit: 1\/1 passing/);
  assert.doesNotMatch(combined, /IX-g an UNSTAGED second test/, "the unstaged half ran");
  assert.equal(fs.readFileSync(path.join(r.cwd, IX_FILE), "utf8"), twoTests, "the working tree was changed");
});

test("IX-h the floor's `declared` list is read from the index git HANDS the hook, not `.git/index`", () => {
  // The commit's index adds a test file the runner's glob cannot reach (a dotfile — the G-I1 shape),
  // and `.git/index` does not hold it. The floor must count it from the COMMIT's index and refuse the
  // shortfall. A list read from `.git/index` omits the file, declares 1 against 1 ran, and passes.
  // (Counts are read from the snapshot either way, so only a file whose presence in the LIST differs
  // between the two indexes can tell them apart — which is why an earlier variant of this test, an
  // extra file in `.git/index` only, could not: it counted 0 from a snapshot that did not hold it.)
  const alt = ".git/alt-index";
  const hidden = "scripts/test/assert/.ix-h-hidden.test.mjs";
  const r = runHookAgainstFixture(IX_PASSING, {
    env: { GIT_INDEX_FILE: alt },
    setup: (cwd) => {
      fs.copyFileSync(path.join(cwd, ".git", "index"), path.join(cwd, alt));
      fs.writeFileSync(path.join(cwd, hidden), IX_HEADER + 'test("IX-h declared, unreachable", () => { assert.ok(true); });\n');
      ixGit(cwd, ["add", "--", hidden], { ...HERMETIC_GIT_ENV, GIT_INDEX_FILE: alt });
      fs.rmSync(path.join(cwd, hidden));
    },
  });
  const combined = ixOut(r);
  assert.notEqual(r.status, 0, `the commit's index declares a test the runner never reached: ${combined}`);
  assert.match(combined, /pre-commit: ABORT -- the assertion half ran 1 tests but 2 are declared in/,
    `the shortfall must be counted from the commit's index: ${combined}`);
});

test("G1 the floor counts a test file whose name git would quote — its list is read NUL-delimited", () => {
  // Gate 2 G1. `declared` is enumerated with `git ls-files`; without `-z` a non-ASCII name comes back
  // C-quoted (`"scripts/test/assert/.n\303\251.test.mjs"` under core.quotePath, set true here so the case
  // does not depend on the machine), the per-file count finds no such file, and the file is declared as
  // ZERO tests. The IX-h shape isolates it: a dotfile the runner's glob cannot reach, declared in the
  // index, must be counted and refused as a shortfall.
  const hidden = `scripts/test/assert/.n${String.fromCodePoint(0xe9)}.test.mjs`;
  const r = runHookAgainstFixture(IX_PASSING, {
    setup: (cwd) => {
      ixGit(cwd, ["config", "core.quotePath", "true"]);
      fs.writeFileSync(path.join(cwd, hidden), IX_HEADER + 'test("G1 declared, unreachable", () => { assert.ok(true); });\n');
      ixGit(cwd, ["add", "--", hidden]);
      assert.match(ixGit(cwd, ["ls-files", "scripts/test/assert"]), /"scripts\/test\/assert\/\.n\\303\\251\.test\.mjs"/,
        "precondition: without -z git prints this name C-quoted");
    },
  });
  const combined = ixOut(r);
  assert.notEqual(r.status, 0, `the index declares a test the runner never reached: ${combined}`);
  assert.match(combined, /pre-commit: ABORT -- the assertion half ran 1 tests but 2 are declared in/,
    `the non-ASCII file must be counted: ${combined}`);
});

test("IX-i the drift script is handed the index git HANDS the hook — an unpaired functional file staged there refuses", () => {
  // The commit's index adds a functional test with no assertion twin; `.git/index` and the working
  // tree do not hold it at all. Only a drift run that reads THIS commit's index can see it.
  const alt = ".git/alt-index";
  const lone = "scripts/test/functional/ix-lone.test.mjs";
  const r = runHookAgainstFixture(IX_PASSING, {
    env: { GIT_INDEX_FILE: alt },
    setup: (cwd) => {
      fs.copyFileSync(path.join(cwd, ".git", "index"), path.join(cwd, alt));
      fs.writeFileSync(path.join(cwd, lone), IX_HEADER + 'test("lone", () => { assert.ok(true); });\n');
      ixGit(cwd, ["add", "--", lone], { ...HERMETIC_GIT_ENV, GIT_INDEX_FILE: alt });
      fs.rmSync(path.join(cwd, lone));
    },
  });
  const combined = ixOut(r);
  assert.notEqual(r.status, 0, `an unpaired functional id is in the commit: ${combined}`);
  assert.match(combined, /no assertion twin[\s\S]*ix-lone/, `the refusal must name the id: ${combined}`);
});

test("IX-j drift judges the STAGED engine: a module staged and deleted from disk still demands its buckets", () => {
  // Found at branch review: drift took its certified set, its engine-source set and its test ids from
  // `fs` reads, so a module staged into scripts/lib/ that CALLS the gateway, then removed from disk,
  // was invisible to it — drift exited 0 and an uncertified engine module could be committed. Every
  // set drift judges is now read from the index; only the certification record is read from disk.
  const probe = "scripts/lib/zz-probe.mjs";
  const r = runHookAgainstFixture(IX_PASSING, {
    extraFiles: { [probe]: "export const probe = () => gitOps([\"status\"]);\n" },
    setup: (cwd) => fs.rmSync(path.join(cwd, probe)),
  });
  const combined = ixOut(r);
  assert.equal(ixGit(r.cwd, ["ls-files", "--", probe]).trim(), probe, "fixture: the module must be staged");
  assert.equal(fs.existsSync(path.join(r.cwd, probe)), false, "fixture: the module must be absent from disk");
  assert.notEqual(r.status, 0, `a staged, uncertified engine module must refuse the commit: ${combined}`);
  assert.match(combined, /drift: ABORT/, `the refusal must be the drift script's: ${combined}`);
  assert.match(combined, /zz-probe\.mjs/, `the refusal must name the module: ${combined}`);
  // WHICH BUCKETS REFUSE (certification-record-redesign 3.3, design D7): from L3 the functional
  // subject is what the half OBSERVES, and nothing in this fixture imports, executes or names the probe
  // — so only the SWEEPS bucket demands (`engineSourceFiles()`), naming the module, and the FUNCTIONAL
  // bucket demands nothing. At L2 its `gitOps(` call put it in both.
  assert.match(combined, /the sweeps bucket's subject changed \([^)]*zz-probe\.mjs[^)]*\)/,
    `a SWEEPS freshness demand naming the module: ${combined}`);
  assert.doesNotMatch(combined, /the functional bucket's subject changed/,
    `and NO functional demand — nothing the functional half observes changed: ${combined}`);
});

test("IX-k the drift script that judges a commit is the COMMIT's copy — an unstaged edit to drift.mjs cannot pass it", () => {
  // The script and its machinery are TRACKED here (as in this repository), and the commit stages an
  // unpaired functional file that drift must refuse. The working tree's drift.mjs is then replaced,
  // unstaged, by a script that exits 0 — a drift run from the working tree would wave the commit through.
  // WHICH scripts are tracked is DERIVED (`hookMachinery()`, hook-fixtures-couple-to-every-hook-step): a
  // missing one would fail the snapshot's drift at import, refusing the commit for the wrong reason.
  const repoRoot = path.join(path.dirname(ENGINE), "..");
  const real = (rel) => fs.readFileSync(path.join(repoRoot, rel), "utf8");
  const r = runHookAgainstFixture(IX_PASSING, {
    extraFiles: {
      ...Object.fromEntries(hookMachinery().map((rel) => [rel, real(rel)])),
      "scripts/test/functional/ix-lone.test.mjs": IX_HEADER + 'test("lone", () => { assert.ok(true); });\n',
    },
    setup: (cwd) => fs.writeFileSync(path.join(cwd, "scripts", "test", "drift.mjs"), "process.exit(0);\n"),
  });
  const combined = ixOut(r);
  assert.notEqual(r.status, 0, `the commit's own drift.mjs must judge it, and it refuses: ${combined}`);
  assert.match(combined, /no assertion twin[\s\S]*ix-lone/, `the refusal must be the staged drift's: ${combined}`);
});

test("IX-e the hook leaves nothing behind — no snapshot, no temp file, no suite lock — after a pass AND a failure", () => {
  for (const [label, body, ok] of [["pass", IX_PASSING, true], ["failure", IX_FAILING, false]]) {
    const tmp = ixTmpdir();
    try {
      const r = runHookAgainstFixture(body, { env: { TMPDIR: tmp } });
      assert.equal(r.status === 0, ok, `${label}: unexpected hook status ${r.status}: ${ixOut(r)}`);
      assert.deepEqual(fs.readdirSync(tmp), [], `${label}: the hook left files in TMPDIR`);
      // THE LOCK IS REMOVED AFTER THE HOOK HAS MOVED INTO ITS SNAPSHOT, so its path must be absolute:
      // in a main checkout `git rev-parse --git-common-dir` prints the RELATIVE `.git`.
      assert.equal(fs.existsSync(path.join(r.cwd, ".git", "pm-suite.lock")), false,
        `${label}: the suite lock outlived the hook`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
});

test("IX-f an INTERRUPTED hook (SIGTERM mid-suite) leaves the tree, the index, TMPDIR and the lock clean", () => {
  // A stub `node` goes first on PATH. Given `--test` it signals its parent — the hook — and exits;
  // anything else (the drift step) is handed to the real node, so the hook reaches its suite.
  const stubDir = removeAtExit(fs.mkdtempSync(path.join(os.tmpdir(), "pm-stub-node-")));
  const tmp = ixTmpdir();
  try {
    fs.writeFileSync(path.join(stubDir, "node"),
      `#!/bin/sh\nif [ "$1" = "--test" ]; then kill -TERM "$PPID"; exit 0; fi\nexec "${process.execPath}" "$@"\n`);
    fs.chmodSync(path.join(stubDir, "node"), 0o755);
    const r = runHookAgainstFixture(IX_FAILING, {
      pathPrepend: stubDir,
      env: { TMPDIR: tmp },
      setup: (cwd) => fs.writeFileSync(path.join(cwd, IX_FILE), IX_PASSING),
    });
    const combined = ixOut(r);
    assert.notEqual(r.status, 0, `an interrupted hook must not pass the commit: ${combined}`);
    assert.doesNotMatch(combined, /passing/, "an interrupted hook reported a pass");
    assert.equal(fs.readFileSync(path.join(r.cwd, IX_FILE), "utf8"), IX_PASSING, "the working tree was changed");
    assert.equal(ixGit(r.cwd, ["show", `:${IX_FILE}`]), IX_FAILING, "the index was changed");
    assert.deepEqual(fs.readdirSync(tmp), [], "the interrupted hook left files in TMPDIR");
    assert.equal(fs.existsSync(path.join(r.cwd, ".git", "pm-suite.lock")), false, "the interrupted hook left its lock");
  } finally {
    fs.rmSync(stubDir, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------- coupling in the commit-msg hook, with a declared exemption (certification-record-redesign 4.3, design D4) ----------
//
// Check 3 (diff coupling) left the pre-commit run: only commit-msg can read the message, and the
// message is where `Twin-Unchanged: <id> — <reason>` declares a subject-free change. Every case below
// commits through BOTH real hooks with a real `git commit` (`hookedRepo()`/`hookedGit()`), so git hands
// each hook the index and message file it would hand them in this repository.
//
// EVERY CASE SEEDS (Gate 1 round 3, R2). Each stages a functional file, which is in the functional
// subject, so pre-commit's freshness check refuses it — and commit-msg never runs — unless the record
// agrees. The seed is `seedAgreeingEntry()` over the index THAT commit is made from.
//
// EVERY REFUSAL PROVES WHICH HOOK REFUSED (Gate 1 round 4, T2): pre-commit's success line was printed
// (so the seed agreed and pre-commit passed), and the refusal after it is commit-msg's coupling line
// naming the id and the twin's path — never a freshness refusal. A seed that silently disagreed fails
// the first half rather than passing as a coupling refusal.

const HK_ALPHA = "scripts/test/functional/alpha.test.mjs";
const HK_TWIN = "scripts/test/assert/alpha.test.mjs";
const hkGit = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const hkTouch = (cwd, rel, marker) => fs.appendFileSync(path.join(cwd, rel), `// ${marker}\n`);
const hkHead = (cwd) => hkGit(cwd, "rev-parse", "HEAD");
const hkIndex = (cwd) => hkGit(cwd, "rev-parse", "--path-format=absolute", "--git-path", "index");
const hkGitDir = (cwd) => hkGit(cwd, "rev-parse", "--path-format=absolute", "--git-dir");
const hkWithIndex = (cwd, idx, ...args) =>
  execFileSync("git", args, { cwd, env: { ...process.env, GIT_INDEX_FILE: idx }, stdio: ["ignore", "pipe", "pipe"] });
/** The index `git commit -a` is made from: a copy of the index, updated with `add -u`. */
function hkIndexForAll(cwd) {
  const idx = path.join(hkGitDir(cwd), "seed-index-all");
  fs.copyFileSync(hkIndex(cwd), idx);
  hkWithIndex(cwd, idx, "add", "-u");
  return idx;
}
/** The index `git commit <path>` is made from: `read-tree HEAD` plus `add <path>`. */
function hkIndexForPath(cwd, rel) {
  const idx = path.join(hkGitDir(cwd), "seed-index-path");
  hkWithIndex(cwd, idx, "read-tree", "HEAD");
  hkWithIndex(cwd, idx, "add", "--", rel);
  return idx;
}
const hkSeed = (cwd, indexFile = hkIndex(cwd)) => seedAgreeingEntry(cwd, "functional", { indexFile });
const HK_PASS = /^pre-commit: (\d+)\/\1 passing$/m;
/** commit-msg's coupling line for an undeclared unpaired id: the id, the functional path, the twin's. */
const hkCoupling = (id) => new RegExp(
  `^  ${id} — scripts/test/functional/${id}\\.test\\.mjs is staged, scripts/test/(?:assert|unit)/${id}\\.test\\.mjs is not$`, "m");
/** A message file outside the repository, so it is never staged. */
const hkMsgDir = removeAtExit(fs.mkdtempSync(path.join(os.tmpdir(), "pm-hk-msg-")));
let hkMsgSeq = 0;
function hkMsg(text) {
  const f = path.join(hkMsgDir, `${++hkMsgSeq}.txt`);
  fs.writeFileSync(f, text);
  return f;
}
/** The declarations git parses from a commit's message — what Gate 2's audit reads. */
const hkTrailers = (cwd, rev = "HEAD") =>
  hkGit(cwd, "log", "-1", "--format=%(trailers:key=Twin-Unchanged,valueonly)", rev).split("\n").filter(Boolean);

/** T2: the commit was refused, by commit-msg, for coupling — and pre-commit passed first. */
function hkRefusedByCommitMsg(r, cwd, headBefore, refusal, label) {
  assert.notEqual(r.status, 0, `${label}: the commit must be refused: ${r.out}`);
  assert.equal(hkHead(cwd), headBefore, `${label}: a refused commit must not move HEAD`);
  const pass = HK_PASS.exec(r.out);
  assert.ok(pass, `${label}: pre-commit's success line was not printed — the seed did not agree, or pre-commit refused: ${r.out}`);
  const before = r.out.slice(0, pass.index);
  const after = r.out.slice(pass.index);
  assert.match(before, /^drift: ok — /m, `${label}: the pre-commit phase's drift must pass before its suite: ${r.out}`);
  assert.doesNotMatch(before, /is staged, |Twin-Unchanged|coupling/i, `${label}: pre-commit's output mentions coupling: ${before}`);
  assert.match(after, refusal, `${label}: the refusal must be commit-msg's coupling line: ${after}`);
  assert.match(after, /^commit-msg: ABORT/m, `${label}: the refusal must be the commit-msg hook's: ${after}`);
  assert.doesNotMatch(after, /subject changed/, `${label}: a freshness refusal is pre-commit's, never commit-msg's: ${after}`);
}
/** The commit was made; returns the declarations the accepting drift run printed. */
function hkAccepted(r, cwd, headBefore, label) {
  assert.equal(r.status, 0, `${label}: the commit must be accepted: ${r.out}`);
  assert.notEqual(hkHead(cwd), headBefore, `${label}: an accepted commit moves HEAD`);
  assert.match(r.out, HK_PASS, `${label}: pre-commit passed: ${r.out}`);
  return [...r.out.matchAll(/^drift: coupling exemption (.+)$/gm)].map((m) => m[1]);
}
/** A linked worktree of `cwd` in a scheduled temp dir; removed and pruned by the caller's `finally`. */
function hkWorktree(cwd, branch, start = "HEAD") {
  const wt = path.join(removeAtExit(fs.mkdtempSync(path.join(os.tmpdir(), "pm-hk-wt-"))), "wt");
  hkGit(cwd, "worktree", "add", "-q", "-b", branch, wt, start);
  return wt;
}
function hkRemoveWorktree(cwd, wt) {
  execFileSync("git", ["worktree", "remove", "--force", wt], { cwd, stdio: "ignore" });
  execFileSync("git", ["worktree", "prune"], { cwd, stdio: "ignore" });
  assert.equal(hkGit(cwd, "worktree", "list", "--porcelain").split("\n").filter((l) => l.startsWith("worktree ")).length, 1,
    "only the main worktree may remain");
}
/** A branch `feat` whose one commit changed alpha WITHOUT its twin under a Twin-Unchanged trailer. */
function hkExemptedBranch(cwd) {
  const base = hkHead(cwd);
  hkGit(cwd, "checkout", "-q", "-b", "feat");
  hkTouch(cwd, HK_ALPHA, "feat");
  hkGit(cwd, "add", "--", HK_ALPHA);
  hkSeed(cwd);
  const r = hookedGit(cwd, ["commit", "-m", "change alpha on feat", "-m", "Twin-Unchanged: alpha — a comment-only edit"]);
  assert.deepEqual(hkAccepted(r, cwd, base, "feat"), ["alpha — a comment-only edit"]);
  hkGit(cwd, "checkout", "-q", "main");
  return base;
}

test("4.3 plain commit: a functional file staged without its twin or a trailer is refused by commit-msg, and pre-commit never mentions coupling", () => {
  const cwd = hookedRepo();
  hkTouch(cwd, HK_ALPHA, "plain");
  hkGit(cwd, "add", "--", HK_ALPHA);
  hkSeed(cwd);
  const head = hkHead(cwd);
  hkRefusedByCommitMsg(hookedGit(cwd, ["commit", "-m", "change alpha, no trailer"]), cwd, head, hkCoupling("alpha"), "plain");
});

test("4.3 plain commit with a Twin-Unchanged trailer is accepted, and the exemption is printed as git's audit reads it", () => {
  const cwd = hookedRepo();
  hkTouch(cwd, HK_ALPHA, "declared");
  hkGit(cwd, "add", "--", HK_ALPHA);
  hkSeed(cwd);
  const head = hkHead(cwd);
  const printed = hkAccepted(hookedGit(cwd, ["commit", "-m", "change alpha", "-m", "Twin-Unchanged: alpha — a comment-only edit"]),
    cwd, head, "declared");
  assert.deepEqual(printed, ["alpha — a comment-only edit"], "the accepting run names the exempted id and the reason");
  assert.deepEqual(hkTrailers(cwd), printed, "drift read exactly the declarations Gate 2's %(trailers) audit reads");
});

test("4.3 `commit -a` is judged by its OWN index: the working-tree change it sweeps in is refused though .git/index stages nothing", () => {
  const cwd = hookedRepo();
  hkTouch(cwd, HK_ALPHA, "all");
  hkSeed(cwd, hkIndexForAll(cwd));
  assert.equal(hkGit(cwd, "diff", "--cached", "--name-only"), "", "fixture: .git/index stages nothing, so a hook reading it would pass");
  const head = hkHead(cwd);
  hkRefusedByCommitMsg(hookedGit(cwd, ["commit", "-a", "-m", "change alpha with -a"]), cwd, head, hkCoupling("alpha"), "commit -a");
});

test("4.3 `commit <path>` is judged by its OWN index: the path alone is refused though .git/index pairs it with its twin", () => {
  const cwd = hookedRepo();
  hkTouch(cwd, HK_ALPHA, "path");
  hkTouch(cwd, HK_TWIN, "path");
  hkGit(cwd, "add", "--", HK_ALPHA, HK_TWIN);
  hkSeed(cwd, hkIndexForPath(cwd, HK_ALPHA));
  const head = hkHead(cwd);
  hkRefusedByCommitMsg(hookedGit(cwd, ["commit", "-m", "change alpha by path", "--", HK_ALPHA]), cwd, head, hkCoupling("alpha"), "commit <path>");
});

test("4.3 a linked worktree's commit is judged by the worktree's index, not the main checkout's", () => {
  const cwd = hookedRepo();
  const wt = hkWorktree(cwd, "wt");
  try {
    hkTouch(cwd, HK_ALPHA, "main");
    hkTouch(cwd, HK_TWIN, "main");
    hkGit(cwd, "add", "--", HK_ALPHA, HK_TWIN);   // the MAIN index pairs them: a hook reading it would pass
    hkTouch(wt, HK_ALPHA, "wt");
    hkGit(wt, "add", "--", HK_ALPHA);
    hkSeed(wt);
    const head = hkHead(wt);
    hkRefusedByCommitMsg(hookedGit(wt, ["commit", "-m", "change alpha in a worktree"]), wt, head, hkCoupling("alpha"), "linked worktree");
  } finally {
    hkRemoveWorktree(cwd, wt);
  }
});

test("4.3 a declaration that exempts nothing staged, and one with no reason, are each refused by commit-msg naming the id", () => {
  const cwd = hookedRepo();
  hkTouch(cwd, HK_ALPHA, "decl");
  hkTouch(cwd, HK_TWIN, "decl");
  hkGit(cwd, "add", "--", HK_ALPHA, HK_TWIN);
  hkSeed(cwd);
  const head = hkHead(cwd);
  hkRefusedByCommitMsg(hookedGit(cwd, ["commit", "-m", "pair", "-m", "Twin-Unchanged: beta — a stale claim"]), cwd, head,
    /^  beta — declared Twin-Unchanged, but scripts\/test\/functional\/beta\.test\.mjs is not staged/m, "not staged");
  hkGit(cwd, "reset", "-q", "--", HK_TWIN);
  hkSeed(cwd);
  hkRefusedByCommitMsg(hookedGit(cwd, ["commit", "-m", "alpha", "-m", "Twin-Unchanged: alpha"]), cwd, head,
    /^  alpha — declared Twin-Unchanged with no reason/m, "no reason");
});

test("4.3 a --no-ff merge of an exempted change is accepted; a squash of the same change without the trailer is refused", () => {
  const cwd = hookedRepo();
  const base = hkExemptedBranch(cwd);
  const head = hkHead(cwd);
  const m = hookedGit(cwd, ["merge", "--no-ff", "-m", "merge feat", "feat"]);
  assert.equal(m.status, 0, `a merge is not judged by the coupling check: ${m.out}`);
  assert.equal(hkGit(cwd, "rev-list", "--parents", "-n", "1", "HEAD").split(" ").length, 3, "a merge commit was made");
  assert.notEqual(hkHead(cwd), head);
  assert.match(m.out, /^drift: ok — a merge commit/m, `the commit-msg hook ran on the merge and did not judge it: ${m.out}`);
  hkGit(cwd, "checkout", "-q", "-b", "sq", base);
  hkGit(cwd, "merge", "--squash", "feat");
  hkSeed(cwd);
  const sq = hkHead(cwd);
  hkRefusedByCommitMsg(hookedGit(cwd, ["commit", "-m", "squash feat"]), cwd, sq, hkCoupling("alpha"), "squash");
});

test("4.3 the same --no-ff merge made IN A LINKED WORKTREE is accepted — MERGE_HEAD is found through --git-path", () => {
  const cwd = hookedRepo();
  const base = hkExemptedBranch(cwd);
  const wt = hkWorktree(cwd, "m2", base);
  try {
    const head = hkHead(wt);
    const m = hookedGit(wt, ["merge", "--no-ff", "-m", "merge feat in a worktree", "feat"]);
    assert.equal(m.status, 0, `a merge in a linked worktree is not judged either: ${m.out}`);
    assert.notEqual(hkHead(wt), head);
    assert.equal(hkGit(wt, "rev-list", "--parents", "-n", "1", "HEAD").split(" ").length, 3, "a merge commit was made");
    assert.match(m.out, /^drift: ok — a merge commit/m, `the commit-msg hook ran on the merge and did not judge it: ${m.out}`);
  } finally {
    hkRemoveWorktree(cwd, wt);
  }
});

test("4.3 trailer parsing is git's: subject-only, prose-paragraph and after-the-scissors declarations declare nothing; above the scissors does", () => {
  const cwd = hookedRepo();
  hkTouch(cwd, HK_ALPHA, "parse");
  hkGit(cwd, "add", "--", HK_ALPHA);
  hkSeed(cwd);
  const head = hkHead(cwd);
  // An editor for `commit -v`: it puts HK_TOP above the template and HK_BOTTOM after its diff, i.e.
  // after the scissors line. git runs commit-msg BEFORE it strips that tail, so the hook sees it.
  const editor = path.join(hkMsgDir, "editor.mjs");
  fs.writeFileSync(editor, 'import fs from "node:fs";\nconst f = process.argv[2];\n' +
    'fs.writeFileSync(f, (process.env.HK_TOP || "") + fs.readFileSync(f, "utf8") + (process.env.HK_BOTTOM || ""));\n');
  const GIT_EDITOR = `"${process.execPath}" "${editor}"`;
  hkRefusedByCommitMsg(hookedGit(cwd, ["commit", "-m", "change alpha"]), cwd, head, hkCoupling("alpha"), "subject only");
  hkRefusedByCommitMsg(hookedGit(cwd, ["commit", "-F",
    hkMsg("change alpha\n\nA paragraph of prose that goes on.\nTwin-Unchanged: alpha — in the prose\n")]),
  cwd, head, hkCoupling("alpha"), "prose paragraph");
  hkRefusedByCommitMsg(hookedGit(cwd, ["commit", "-v"], {
    env: { GIT_EDITOR, HK_TOP: "change alpha\n", HK_BOTTOM: "\nTwin-Unchanged: alpha — after the scissors\n" },
  }), cwd, head, hkCoupling("alpha"), "after the scissors");
  const printed = hkAccepted(hookedGit(cwd, ["commit", "-v"], {
    env: { GIT_EDITOR, HK_TOP: "change alpha\n\nTwin-Unchanged: alpha — above the scissors\n", HK_BOTTOM: "" },
  }), cwd, head, "above the scissors");
  assert.deepEqual(printed, ["alpha — above the scissors"]);
  assert.deepEqual(hkTrailers(cwd), printed, "drift read exactly the declarations Gate 2's %(trailers) audit reads");
});

test("4.3 the `---` divider: before the trailer paragraph it is accepted, after it refused — and drift agrees with %(trailers)", () => {
  // The same messages committed with `git commit -F` in a repository with NO hooks installed
  // (trailer-divider-probe.log): what git's own `%(trailers)` reads there is what drift must read.
  const hookless = tmpRepo();
  hkGit(hookless, "init", "-q", "-b", "main");
  hkGit(hookless, "config", "user.email", "test@example.com");
  hkGit(hookless, "config", "user.name", "Test");
  hkGit(hookless, "config", "commit.gpgsign", "false");
  let n = 0;
  const hooklessTrailers = (msgFile) => {
    fs.writeFileSync(path.join(hookless, "f.txt"), `${++n}\n`);
    hkGit(hookless, "add", "--", "f.txt");
    hkGit(hookless, "commit", "-q", "-F", msgFile);
    return hkTrailers(hookless);
  };
  const cwd = hookedRepo();
  hkTouch(cwd, HK_ALPHA, "divider");
  hkGit(cwd, "add", "--", HK_ALPHA);
  hkSeed(cwd);
  const head = hkHead(cwd);
  const after = hkMsg("change alpha\n\nTwin-Unchanged: alpha — a divider after the trailers\n\n---\nmore text\n");
  hkRefusedByCommitMsg(hookedGit(cwd, ["commit", "-F", after]), cwd, head, hkCoupling("alpha"), "divider after");
  assert.deepEqual(hooklessTrailers(after), [], "git's %(trailers) reads no declaration there either");
  const before = hkMsg("change alpha\n\n---\n\nTwin-Unchanged: alpha — a divider above the trailers\n");
  const printed = hkAccepted(hookedGit(cwd, ["commit", "-F", before]), cwd, head, "divider before");
  assert.deepEqual(printed, ["alpha — a divider above the trailers"]);
  assert.deepEqual(hooklessTrailers(before), printed, "drift read what git's %(trailers) reads in a hookless repository");
});

test("4.3 the working-tree fallback: the snapshot's drift judges when the index holds one, the working tree's when it holds none", () => {
  // (a) The index holds drift.mjs (and what it imports); the working tree's copy is replaced, UNSTAGED,
  //     by a script that exits 0. A commit-msg run of the working tree's copy would wave the commit through.
  const tracked = hookedRepo();
  fs.writeFileSync(path.join(tracked, "scripts", "test", "drift.mjs"), "process.exit(0);\n");
  hkTouch(tracked, HK_ALPHA, "snapshot");
  hkGit(tracked, "add", "--", HK_ALPHA);
  hkSeed(tracked);
  const head = hkHead(tracked);
  hkRefusedByCommitMsg(hookedGit(tracked, ["commit", "-m", "change alpha"]), tracked, head, hkCoupling("alpha"), "snapshot drift");
  // (b) The index holds no drift.mjs (the `runHookAgainstFixture` shape): the working tree's copy runs.
  const untracked = hookedRepo({ trackMachinery: false });
  assert.equal(hkGit(untracked, "ls-files", "--", "scripts/test/drift.mjs"), "", "fixture: the index holds no drift.mjs");
  hkTouch(untracked, HK_ALPHA, "fallback");
  hkGit(untracked, "add", "--", HK_ALPHA);
  hkSeed(untracked);
  const head2 = hkHead(untracked);
  hkRefusedByCommitMsg(hookedGit(untracked, ["commit", "-m", "change alpha"]), untracked, head2, hkCoupling("alpha"), "working-tree drift");
});

test("4.4 coupling is enforced in EXACTLY ONE place: pre-commit passes the unpaired file, and only commit-msg names the refusal", () => {
  // REGRESSION GUARD (certification-record-redesign 4.4; suite-certification, "Coupling is enforced in
  // exactly one place"). With both hooks installed and an agreeing entry seeded, a staged functional file
  // without its twin is refused ONCE, by commit-msg. Re-enabling coupling in the pre-commit phase fails
  // this on pre-commit's missing success line — git runs no commit-msg after pre-commit exits non-zero,
  // so the refusal is never reported twice — and disabling it in commit-msg fails it because nothing
  // refuses and the commit is made (mutation-4.4.txt).
  const cwd = hookedRepo();
  hkTouch(cwd, HK_ALPHA, "one place");
  hkGit(cwd, "add", "--", HK_ALPHA);
  hkSeed(cwd);
  const head = hkHead(cwd);
  const r = hookedGit(cwd, ["commit", "-m", "change alpha, no trailer"]);
  hkRefusedByCommitMsg(r, cwd, head, hkCoupling("alpha"), "one place");
  assert.equal([...r.out.matchAll(new RegExp(hkCoupling("alpha").source, "gm"))].length, 1,
    `the coupling refusal must be reported exactly once: ${r.out}`);
});

// ---------- sync must not register a directory's own index file as a plan (#87) ----------

test("sync ignores README.md/INDEX.md in the plans directory — they are not plans", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const plans = path.join(cwd, "docs", "superpowers", "plans");
  fs.mkdirSync(plans, { recursive: true });
  // The index file, with an H1 that sync would otherwise adopt as an epic title.
  fs.writeFileSync(path.join(plans, "README.md"), "# Superpowers Plans — Active\n\nThis directory holds only active plans.\n");
  fs.writeFileSync(path.join(plans, "INDEX.md"), "# Index\n");
  // A real plan alongside it, to prove the filter is not simply skipping the whole directory.
  fs.writeFileSync(path.join(plans, "2026-01-01-real-plan.md"), "# A Real Plan\n\n- [ ] step one\n");

  run(["sync"], { cwd });
  const ids = readState(cwd).epics.map(e => e.id);

  assert.ok(ids.includes("2026-01-01-real-plan"), "a genuine plan must still register");
  assert.ok(!ids.includes("README"), `README.md registered as an epic: ${ids.join(", ")}`);
  assert.ok(!ids.includes("INDEX"), `INDEX.md registered as an epic: ${ids.join(", ")}`);
});

// ---------- a help flag must never have a side effect (#91 family) ----------

test("--help on a mutating subcommand prints usage and writes nothing", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");

  // log-detour is where the damage was visible: --help was consumed as the detour DESCRIPTION
  // and appended a real MINIMAL row to an append-only log with no verb to remove it.
  // #158 CHANGED WHICH ANSWER this prints — it is now log-detour's own flag surface rather than
  // the global 48-verb usage line — and deliberately did NOT change the property this test exists
  // for. The short-circuit still fires BEFORE dispatch, so a help flag still reaches no
  // subcommand and still cannot be consumed as data. Both no-write assertions below are the
  // original ones, untouched.
  const out = run(["log-detour", "--help"], { cwd });
  assert.match(out, /conductor\.mjs log-detour/);
  assert.ok(!out.includes("init|render|brief"),
    "a named verb must get ITS help, not the global usage blob");

  const logPath = path.join(cwd, ".conductor", "detours.log");
  const logged = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8").trim() : "";
  assert.equal(logged, "", `--help wrote a detour entry: ${logged}`);
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before,
    "--help must not mutate state.json either");
});

test("-h is handled the same as --help", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  assert.match(run(["log-detour", "-h"], { cwd }), /conductor\.mjs log-detour/);
  const logPath = path.join(cwd, ".conductor", "detours.log");
  assert.ok(!fs.existsSync(logPath) || fs.readFileSync(logPath, "utf8").trim() === "");
});

test("a bare invocation with no subcommand prints usage and exits 0", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  assert.match(run([], { cwd }), /usage: conductor\.mjs/);
});

// ---------- git-secrets on the commit MESSAGE: commit-msg and prepare-commit-msg (minimal detour, 0.51.0 L5 5.9) ----------
//
// `core.hooksPath .githooks` sends git to THIS repository's hooks instead of `.git/hooks`, where
// `~/.git-templates` installs `git secrets --commit_msg_hook` and `--prepare_commit_msg_hook`. So each
// message hook here carries the same guarded first block `.githooks/pre-commit` carries for its own
// case, or commit-message secret scanning is off in every clone that follows CONTRIBUTING.
//
// A `git-secrets` SHIM put in front of PATH stands in for the scanner: git resolves `git secrets` to
// the first `git-secrets` on PATH, so the shim is what each hook's block runs. It refuses ONLY the mode
// under test and passes every other, so a refusal proves THAT hook's block ran. The absent case builds
// a PATH that resolves no `git-secrets` at all — every directory holding one is replaced by a mirror of
// its other entries — so the `command -v` guard is exercised, not assumed.

/** A directory holding a `git-secrets` shim that exits 1 for `mode` alone, printing a marker. */
function gsShim(mode) {
  const dir = removeAtExit(fs.mkdtempSync(path.join(os.tmpdir(), "pm-gs-shim-")));
  const shim = path.join(dir, "git-secrets");
  fs.writeFileSync(shim, `#!/bin/sh\nif [ "$1" = "${mode}" ]; then echo "gs-shim: refused ${mode}"; exit 1; fi\nexit 0\n`);
  fs.chmodSync(shim, 0o755);
  return dir;
}
/** PATH with every directory that holds a `git-secrets` replaced by a mirror of its other entries. */
function gsPathWithout() {
  const mirror = removeAtExit(fs.mkdtempSync(path.join(os.tmpdir(), "pm-gs-absent-")));
  return (process.env.PATH || "").split(path.delimiter).map((dir, i) => {
    if (!dir || !fs.existsSync(path.join(dir, "git-secrets"))) return dir;
    const sub = path.join(mirror, String(i));
    fs.mkdirSync(sub);
    for (const name of fs.readdirSync(dir)) {
      if (name !== "git-secrets") fs.symlinkSync(path.join(dir, name), path.join(sub, name));
    }
    return sub;
  }).join(path.delimiter);
}
const gsPath = (dir) => `${dir}${path.delimiter}${process.env.PATH || ""}`;
/** A plain, uncoupled commit's content: a file in no bucket's subject and no rung. */
function gsStage(cwd, marker) {
  fs.writeFileSync(path.join(cwd, "notes.txt"), `${marker}\n`);
  hkGit(cwd, "add", "--", "notes.txt");
}

test("L5 5.9 commit-msg runs git-secrets' commit_msg_hook first: a scanner that refuses the message refuses the commit", () => {
  const cwd = hookedRepo();
  gsStage(cwd, "commit-msg");
  const head = hkHead(cwd);
  const r = hookedGit(cwd, ["commit", "-m", "a message the scanner refuses"], { env: { PATH: gsPath(gsShim("--commit_msg_hook")) } });
  assert.notEqual(r.status, 0, `the commit must be refused: ${r.out}`);
  assert.equal(hkHead(cwd), head, "a refused commit must not move HEAD");
  assert.match(r.out, /^gs-shim: refused --commit_msg_hook$/m, `commit-msg's git-secrets block must have run: ${r.out}`);
  assert.doesNotMatch(r.out, /^commit-msg: ABORT/m, `the refusal is the scanner's, not drift's: ${r.out}`);
});

test("L5 5.9 prepare-commit-msg runs git-secrets' prepare_commit_msg_hook: a scanner that refuses it refuses the commit", () => {
  const cwd = hookedRepo();
  gsStage(cwd, "prepare-commit-msg");
  const head = hkHead(cwd);
  const r = hookedGit(cwd, ["commit", "-m", "prepared"], { env: { PATH: gsPath(gsShim("--prepare_commit_msg_hook")) } });
  assert.notEqual(r.status, 0, `the commit must be refused: ${r.out}`);
  assert.equal(hkHead(cwd), head, "a refused commit must not move HEAD");
  assert.match(r.out, /^gs-shim: refused --prepare_commit_msg_hook$/m, `prepare-commit-msg's git-secrets block must have run: ${r.out}`);
});

test("L5 5.9 a machine with no git-secrets still commits through all three hooks", () => {
  const cwd = hookedRepo();
  gsStage(cwd, "absent");
  const PATH = gsPathWithout();
  // Any non-zero status means "not found": bash and zsh exit 1, dash (Ubuntu's sh) exits 127.
  const probe = spawnSync("sh", ["-c", "command -v git-secrets"], { env: { ...process.env, PATH }, encoding: "utf8" });
  assert.ok(probe.status !== 0 && probe.stdout === "",
    `fixture: the built PATH must resolve no git-secrets (status ${probe.status}, resolved ${JSON.stringify(probe.stdout)})`);
  const head = hkHead(cwd);
  const r = hookedGit(cwd, ["commit", "-m", "no scanner installed"], { env: { PATH } });
  assert.equal(r.status, 0, `the commit must be accepted: ${r.out}`);
  assert.notEqual(hkHead(cwd), head, "an accepted commit moves HEAD");
});

// ---------- an amend is judged against HEAD's PARENT (hook-friction-0-51, item 3) ----------
//
// `git commit --amend` stages nothing of its own: the index already holds the amended commit, so measured
// against HEAD the staged set was empty and a `Twin-Unchanged` trailer on a reworded amend was refused as
// "declared … but not staged". The commit-msg hook now tells drift it is an amend (read from its parent's
// command line) and drift measures against HEAD^ — or, for a root commit, against nothing. EVERY CASE commits
// through both real hooks, so the detection is exercised through git itself.

const hkAlphaWithTrailer = (cwd, marker) => {
  hkTouch(cwd, HK_ALPHA, marker);
  hkGit(cwd, "add", "--", HK_ALPHA);
  hkSeed(cwd);
  const base = hkHead(cwd);
  hkAccepted(hookedGit(cwd, ["commit", "-m", "change alpha", "-m", "Twin-Unchanged: alpha — a comment-only edit"]), cwd, base, marker);
};

test("AM an amend that rewords a Twin-Unchanged commit is accepted though it stages nothing of its own", () => {
  const cwd = hookedRepo();
  hkAlphaWithTrailer(cwd, "to be amended");
  const head = hkHead(cwd);
  assert.equal(hkGit(cwd, "diff", "--cached", "--name-only"), "", "fixture: the amend stages nothing against HEAD");
  const r = hookedGit(cwd, ["commit", "--amend", "-m", "change alpha, reworded", "-m", "Twin-Unchanged: alpha — a comment-only edit"]);
  assert.equal(r.status, 0, `the amend must be accepted: ${r.out}`);
  assert.notEqual(hkHead(cwd), head, "an accepted amend replaces HEAD");
  assert.match(r.out, /^drift: coupling exemption alpha — a comment-only edit$/m, `the exemption is printed: ${r.out}`);
  assert.deepEqual(hkTrailers(cwd), ["alpha — a comment-only edit"], "the amended commit carries the declaration Gate 2 audits");
});

test("AM an amend declaring Twin-Unchanged for a file the amended commit does NOT change is still refused", () => {
  const cwd = hookedRepo();
  hkTouch(cwd, "scripts/test/assert/fixture.test.mjs", "an unrelated change");
  hkGit(cwd, "add", "--", "scripts/test/assert/fixture.test.mjs");
  hkSeed(cwd);
  const base = hkHead(cwd);
  hkAccepted(hookedGit(cwd, ["commit", "-m", "touch the fixture"]), cwd, base, "unrelated");
  const head = hkHead(cwd);
  const r = hookedGit(cwd, ["commit", "--amend", "-m", "touch the fixture", "-m", "Twin-Unchanged: alpha — a comment-only edit"]);
  hkRefusedByCommitMsg(r, cwd, head, /alpha — declared Twin-Unchanged, but scripts\/test\/functional\/alpha\.test\.mjs is not staged/, "amend, unrelated");
});

test("AM an amend that drops the twin from a commit that paired it is refused, which HEAD-relative judging missed", () => {
  const cwd = hookedRepo();
  hkTouch(cwd, HK_ALPHA, "paired");
  hkTouch(cwd, HK_TWIN, "paired");
  hkGit(cwd, "add", "--", HK_ALPHA, HK_TWIN);
  hkSeed(cwd);
  const base = hkHead(cwd);
  hkAccepted(hookedGit(cwd, ["commit", "-m", "change alpha with its twin"]), cwd, base, "paired");
  hkGit(cwd, "checkout", "HEAD^", "--", HK_TWIN);
  hkSeed(cwd);
  const head = hkHead(cwd);
  hkRefusedByCommitMsg(hookedGit(cwd, ["commit", "--amend", "-m", "change alpha, twin dropped"]), cwd, head, hkCoupling("alpha"), "amend dropping the twin");
});

test("AM amending the ROOT commit has no parent: everything in the index is what it adds, so a paired alpha is accepted", () => {
  const cwd = hookedRepo();
  assert.equal(spawnSync("git", ["rev-parse", "--verify", "-q", "HEAD^"], { cwd }).status, 1, "fixture: HEAD is a root commit");
  const head = hkHead(cwd);
  const r = hookedGit(cwd, ["commit", "--amend", "-m", "baseline, reworded"]);
  assert.equal(r.status, 0, `a root amend must be accepted: ${r.out}`);
  assert.notEqual(hkHead(cwd), head);
});

test("AM a message that merely MENTIONS --amend is not an amend: an undeclared alpha is refused as before", () => {
  const cwd = hookedRepo();
  hkTouch(cwd, HK_ALPHA, "mentions amend");
  hkGit(cwd, "add", "--", HK_ALPHA);
  hkSeed(cwd);
  const head = hkHead(cwd);
  hkRefusedByCommitMsg(hookedGit(cwd, ["commit", "-m", "docs: explain how --amend behaves"]), cwd, head, hkCoupling("alpha"), "mentions --amend");
});

// ---------- amend detection reads the argv, not its words (review of 32a3f588, findings 3 and 4) ----------
// The hook reads `ps`, which joins argv and drops the quoting. `--amend` counts anywhere in any order and as an
// unambiguous long-option prefix; the value of -m (detached, or attached as `-mfoo`) is a value, never a flag.

const amendCase = (extraArgs) => {
  const cwd = hookedRepo();
  hkAlphaWithTrailer(cwd, "to be amended");
  const head = hkHead(cwd);
  const r = hookedGit(cwd, ["commit", ...extraArgs]);
  assert.equal(r.status, 0, `the amend must be accepted (${extraArgs.join(" ")}): ${r.out}`);
  assert.notEqual(hkHead(cwd), head, "an accepted amend replaces HEAD");
  assert.deepEqual(hkTrailers(cwd), ["alpha — a comment-only edit"]);
};
const TRAILER = "Twin-Unchanged: alpha — a comment-only edit";

test("AM --amend AFTER -m is still an amend", () => amendCase(["-m", "change alpha, reworded", "-m", TRAILER, "--amend"]));
test("AM --amend after a bundled -am is still an amend", () => amendCase(["-am", "change alpha, reworded", "-m", TRAILER, "--amend"]));
test("AM the unambiguous prefix --amen is an amend", () => amendCase(["--amen", "-m", "change alpha, reworded", "-m", TRAILER]));
test("AM --amend after an ATTACHED -m value is an amend", () => amendCase([`-mchange alpha, reworded`, `-m${TRAILER}`, "--amend"]));

test("AM an ATTACHED -m value that mentions --amend is not an amend: HEAD^ must not excuse a twin-less alpha", () => {
  const cwd = hookedRepo();
  hkTouch(cwd, HK_ALPHA, "paired");
  hkTouch(cwd, HK_TWIN, "paired");
  hkGit(cwd, "add", "--", HK_ALPHA, HK_TWIN);
  hkSeed(cwd);
  const base = hkHead(cwd);
  hkAccepted(hookedGit(cwd, ["commit", "-m", "change alpha with its twin"]), cwd, base, "paired");
  hkTouch(cwd, HK_ALPHA, "alpha alone");
  hkGit(cwd, "add", "--", HK_ALPHA);
  hkSeed(cwd);
  const head = hkHead(cwd);
  // `ps` shows this as `commit -mfix alpha, see --amend`: judged against HEAD^ it would be excused by HEAD's twin.
  hkRefusedByCommitMsg(hookedGit(cwd, ["commit", "-mfix alpha, see --amend"]), cwd, head, hkCoupling("alpha"), "attached -m mentioning --amend");
  hkRefusedByCommitMsg(hookedGit(cwd, ["commit", "-m", "fix alpha, see --amend"]), cwd, head, hkCoupling("alpha"), "detached -m mentioning --amend");
});
