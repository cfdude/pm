// scripts/test/assert/conductor-09.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/conductor-09.test.mjs — same id, same subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is the reconciler's write-back, the gate-review record and the
// archive gate it feeds, two doc-drift walks over the dispatch table, the pre-commit hook's own
// text, sync's plan filter and the help short-circuit. ONLY TWO THINGS IN IT NEED GIT: every
// `--base-sha/--head-sha` case resolves real commits (`fixtureCommits`), and the three
// `.githooks/pre-commit` tests SPAWN a shell — neither may live in this half (design D5, and the
// spawn guard 5.2 enforces it).
//
// So the twin carries everything else, and for the gate-review family it uses the OTHER evidence
// kind gh-177 added: a Gate 1 pass records the ARTIFACTS it reviewed with no SHA range, which is
// exactly the shape this half can produce. Where a behaviour is reachable only through a resolved
// commit range, the omission is named at the bottom.
//
// ─────────────── 4.1 SPLIT THIS FILE, AND THIS IS THE FILE-RUNG HALF ───────────────
//
// SEVENTEEN of its twenty-one tests moved to `scripts/test/unit/conductor-09.test.mjs` — the whole
// record-reconcile family, the whole record-gate-review family, both openspec-archive enforcement
// tests, and all three `--help` tests.
//
// FOUR STAY, and each reads a FILE rather than a value: two doc-drift walks over `conductor.mjs`,
// `skills/conductor/SKILL.md` and `README.md`; `sync`'s README/INDEX filter, whose fixture writes
// `docs/superpowers/plans/*.md`; and the pre-commit hook's SHAPE, which asserts its runner line by
// exact equality — the source-shape guard the change's own task 5.1 names, and the one guard in this
// file whose subject is the per-commit gate itself.
//
// No assertion changed in either direction.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, readState, expectFail, ENGINE } from "../fixtures/assert-harness.mjs";

// ---------- doc drift: SKILL.md "Commands" vs the real dispatch table ----------

const HOOK = path.join(path.dirname(ENGINE), "..", ".githooks", "pre-commit");

/** The dispatch table's keys, extracted from conductor.mjs EXACTLY as the functional file extracts
 *  them — the `}({ … }[cmd]` object literal, re-pointed for the `main(argv, io)` wrapper. Kept
 *  identical so the two halves cannot disagree about what the table holds. */
function dispatchKeys(engineSrc) {
  const dispatchMatch = engineSrc.match(/\(\{\n([\s\S]*?)\n\s*\}\[cmd\]/m);
  assert.ok(dispatchMatch, "could not locate the dispatch table object in conductor.mjs");
  const body = dispatchMatch[1];
  const keys = new Set();
  for (const m of body.matchAll(/^\s*"([a-z-]+)"\s*:/gm)) keys.add(m[1]);
  for (const m of body.matchAll(/^\s*([a-zA-Z][\w-]*)\s*:/gm)) keys.add(m[1]);
  for (const m of body.matchAll(/^\s*([a-zA-Z][\w-]*),?\s*$/gm)) keys.add(m[1]);
  assert.ok(keys.size > 10, `expected many dispatch keys, only extracted ${keys.size}`);
  return keys;
}

test("every dispatch-table subcommand is mentioned somewhere in skills/conductor/SKILL.md", () => {
  const keys = dispatchKeys(fs.readFileSync(ENGINE, "utf8"));
  const skillText = fs.readFileSync(path.join(path.dirname(ENGINE), "..", "skills", "conductor", "SKILL.md"), "utf8");
  const missing = [...keys].filter(k => !skillText.includes(k));
  assert.deepEqual(missing, [],
    `SKILL.md's Commands section (or elsewhere in the doc) is missing a mention of: ${missing.join(", ")}`);
});
test("every dispatch-table subcommand is mentioned somewhere in README.md", () => {
  const keys = dispatchKeys(fs.readFileSync(ENGINE, "utf8"));
  const readmeText = fs.readFileSync(path.join(path.dirname(ENGINE), "..", "README.md"), "utf8");
  const missing = [...keys].filter(k => !readmeText.includes(k));
  assert.deepEqual(missing, [],
    `README.md's Commands section (or elsewhere in the doc) is missing a mention of: ${missing.join(", ")}`);
});

// ──────────────── openspec gate enforcement: record-gate-review ────────────────
test("sync ignores README.md/INDEX.md in the plans directory — they are not plans", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const plans = path.join(cwd, "docs", "superpowers", "plans");
  fs.mkdirSync(plans, { recursive: true });
  fs.writeFileSync(path.join(plans, "README.md"), "# Superpowers Plans — Active\n\nThis directory holds only active plans.\n");
  fs.writeFileSync(path.join(plans, "INDEX.md"), "# Index\n");
  fs.writeFileSync(path.join(plans, "2026-01-01-real-plan.md"), "# A Real Plan\n\n- [ ] step one\n");

  run(["sync"], { cwd });
  const ids = readState(cwd).epics.map(e => e.id);

  assert.ok(ids.includes("2026-01-01-real-plan"), "a genuine plan must still register");
  assert.ok(!ids.includes("README"), `README.md registered as an epic: ${ids.join(", ")}`);
  assert.ok(!ids.includes("INDEX"), `INDEX.md registered as an epic: ${ids.join(", ")}`);
});

// ---------- a help flag must never have a side effect (#91 family) ----------
test(".githooks/pre-commit exists, is executable, and runs the assertion half and the drift script", () => {
  assert.ok(fs.existsSync(HOOK), ".githooks/pre-commit is missing");
  assert.ok(fs.statSync(HOOK).mode & 0o111, ".githooks/pre-commit is not executable");
  const hookText = fs.readFileSync(HOOK, "utf8");
  // RE-POINTED WITH THE SPLIT (5.3), in the same commit as the glob it reads. The hook runs the
  // ASSERTION HALF now — one process, one file set — and this assertion is about the half it runs
  // and the isolation it runs it under, not about the literal pattern that used to be there.
  //
  // EXACT-LINE, NOT A MATCH (G-I1c). `assert.match` on a substring is satisfied by a runner line
  // that ALSO hands the functional half to the same process — the shape that makes the per-commit
  // gate pay the cost the trigger exists to avoid, and the one the spec's "does not run the
  // functional half" scenario forbids. Boundary characters can be slipped past a substring test;
  // they cannot be slipped past an equality. If the runner's flags or its redirection change, this
  // fails and is re-pointed deliberately, which is the correct cost for a line this load-bearing.
  // The pattern is ANCHORED at the start of a command line, so the hook's own prose about
  // `node --test` (there are three such comments, and one of them says a directory argument does NOT
  // work) is not mistaken for a second runner.
  // 0.47.0's Node-18 fallback added a PROBE -- a `node --test` whose subject is one tiny file,
  // run at most once per clone (its answer is cached in the git dir) to learn whether
  // --test-isolation exists on this binary. The probe is not a runner: it runs no half and no
  // glob, and it must never be widened into one. So the guard counts RUNNERS -- lines whose
  // subject is the assert GLOB -- and asserts exactly one, while separately asserting the probe,
  // if present, is the tiny-file probe and nothing else.
  // RE-POINTED WITH THE TWO-GLOB RUNNER (0.48.0 task 2.3), in the same commit as the shape it reads
  // — the rule this guard exists to enforce about itself. The half now carries TWO RUNGS, so the
  // runner line names two globs; the property is unchanged and is asserted the same way: ONE runner,
  // EXACTLY, and both its globs are the assertion half's.
  const runnerLines = hookText.split("\n").filter((l) => /^\s*(?:if\s+)?node --test.*scripts\/test\/(?:unit|assert)\/\*\.test\.mjs/.test(l));
  assert.equal(runnerLines.length, 1,
    `the hook must run exactly ONE test runner over the assertion half's rungs, and it runs ${runnerLines.length}: ${runnerLines.join(" | ")}`);
  assert.equal(runnerLines[0].trim(),
    'if node --test $ISOFLAG scripts/test/unit/*.test.mjs scripts/test/assert/*.test.mjs >"$tmpfile" 2>&1; then',
    "the hook's runner must name exactly the assertion half's TWO RUNGS through $ISOFLAG — one " +
    "process, one half, no third glob, and the unit rung first because that is the order the " +
    "floor's `git ls-files` list names them in");
  // AND NOTHING ELSE MAY RIDE ALONG: a third glob here would be the functional half or a bucket,
  // which is the shape the exact-line assertion above catches one level down and this one catches
  // by counting them.
  const globsInRunner = runnerLines[0].match(/scripts\/test\/[a-z]+\/\*\.test\.mjs/g) || [];
  assert.deepEqual(globsInRunner.slice().sort(), ["scripts/test/assert/*.test.mjs", "scripts/test/unit/*.test.mjs"],
    "the runner is handed exactly the assertion half's two rungs");
  const probeLines = hookText.split("\n").filter((l) => /^\s*(?:if\s+)?node --test/.test(l) && !/^\s*(?:if\s+)?node --test.*scripts\/test\/assert\/\*\.test\.mjs/.test(l));
  for (const probe of probeLines) {
    assert.match(probe, /lessons-index\.test\.mjs/,
      `the hook's only other node --test must be the isolation PROBE on a single tiny file, never a second runner: ${probe}`);
  }
  assert.match(hookText, /set -e/, ".githooks/pre-commit does not fail the commit on a non-zero exit");
  // The floor makes partial-suite runs possible in a way the single file did not, so the hook must
  // cross-check the ran count against the declared count. WHAT IT MUST BE DERIVED FROM is the whole
  // invariant and the reason the old `grep -Hc` assertion is gone: `declared` has to come from the
  // TRACKED files of the half the runner was GIVEN (the index, via git ls-files), never from the
  // shell's expansion of the runner's own pattern — the two shrinking in lockstep is exactly how a
  // file renamed out of the glob used to drop from both sides at once and leave the floor blind.
  assert.match(hookText, /declared=\$\(git ls-files 'scripts\/test\/unit\/\*\.test\.mjs' 'scripts\/test\/assert\/\*\.test\.mjs'/,
    ".githooks/pre-commit's floor does not enumerate the tracked files of the RUNG SET its runner " +
    "was given — and the set is a LIST now, so a floor still naming one rung would count a subset");
  assert.doesNotMatch(hookText, /declared=\$\(grep /,
    "the floor's declared count must not be the shell's expansion of the runner's own pattern");
  // THE SUPERSET SHAPE (G-I1b): `declared` must enumerate the half the runner was given and NOTHING
  // ELSE. Adding the functional half's glob was invisible to every existing check — the shape
  // assertion above is a prefix match, so it still passed — while in the real repository it aborts
  // every commit that has a functional half at all. This is the invariant D8 states, asserted in the
  // direction that breaks the commit rather than the direction that only mis-counts.
  assert.doesNotMatch(hookText, /declared=\$\(git ls-files[^\n]*functional/,
    "the hook's floor enumerates the functional half as well as the assertion half: it is a superset " +
    "of what this runner was given, and it aborts every commit that has a functional half at all");
  assert.doesNotMatch(hookText, /declared=\$\(git ls-files[^\n]*sweeps/,
    "the hook's floor enumerates the sweep bucket as well — same superset, same refusal");
  // The enrolment check landed INLINE in 5.3, because a file in neither half is run by nothing and
  // counted by nothing and the floor alone cannot see it. 6.4 RETIRED THAT COPY, handing all four
  // checks to the drift script so one rule has one implementation — so this pins the handover, and
  // pins BOTH halves of "one implementation at a time, never two".
  assert.match(hookText, /node scripts\/test\/drift\.mjs/,
    "the hook does not run the drift script, so nothing checks enrolment, the twin pairing, the " +
    "diff coupling or the record's freshness on this commit");
  assert.doesNotMatch(hookText, /grep -v -E '\^scripts\/test\//,
    "the hook has taken the enrolment check back inline — the drift script owns it, and two " +
    "implementations of one rule is the shape 6.4 exists to remove");
});
