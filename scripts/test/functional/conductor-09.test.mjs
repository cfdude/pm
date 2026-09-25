import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tmpRepo, run, readState, writeState, expectFail, runHookAgainstFixture, ENGINE, fixtureCommits } from "../fixtures/functional-harness.mjs";

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
  // spec's "A commit that touches nothing certified runs the assertion half only" scenario): the
  // functional half is the triggered half, and running it on every commit is exactly the cost the
  // split exists to remove. It was held by nothing — adding the functional glob to the hook's runner
  // left the whole assertion half green AND the hook's own functional tests green (Gate 2, G-I3).
  //
  // So the functional half of the FIXTURE holds a marker test that fails the moment it runs, and the
  // assertion is that the run never reaches it. Its assertion twin is written too — the drift script
  // refuses a functional id with no twin, and a fixture that tripped the drift check would be
  // testing the wrong refusal.
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
  // must never appear.
  const r = runHookAgainstFixture("", {
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
