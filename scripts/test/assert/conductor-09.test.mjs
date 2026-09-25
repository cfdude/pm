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

/** A `node --test` COMMAND line of the hook — anchored at the start of a command, optionally after
 *  `if`, and after any `NAME=value` environment assignments (0.49.0: the runner carries
 *  `FORCE_COLOR=0`). Prose that merely mentions `node --test` is not matched. */
const NODE_TEST_LINE = /^\s*(?:if\s+)?(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*node --test/;

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
  // THE RUNNER LINE, BY EQUALITY (G-I1c). `assert.match` on a substring is satisfied by a runner line
  // that ALSO hands the functional half to the runner — the shape that makes the per-commit gate pay
  // the cost the trigger exists to avoid, and the one the spec's "does not run the functional half"
  // scenario forbids. Boundary characters can be slipped past a substring test; they cannot be slipped
  // past an equality. If the runner's flags or its redirection change, this fails and is re-pointed
  // deliberately, in the same commit as the shape it reads, which is the correct cost for a line this
  // load-bearing.
  //
  // ITS HISTORY, because each re-point was the shape moving under it: the split (5.3) made it the
  // assertion half's glob; 0.48.0 (task 2.3) two rung globs; 0.48.x a list resolved by a `[ -f ]`
  // loop, because `/bin/sh` leaves an unmatched pattern as a literal and Node 18 refused such a
  // literal; 0.49.0 task 1.2 one forced reporter and no colour (design D4). 0.49.0 task 1.4 is the
  // fifth: the single-process probe and the Node-18 loop are gone (design D3, D5). Every supported
  // Node runs an unmatched literal pattern as zero files, so the runner's command line carries the two
  // rung globs themselves again, and runs them under the runner's default per-file isolation.
  //
  // WHAT THIS GUARD KEEPS:
  //   * exactly ONE runner line, matched by equality;
  //   * exactly ONE `node --test` command line in the whole hook — the probe that was the only other
  //     one is deleted, and an env prefix does not hide a second (NODE_TEST_LINE accepts `NAME=value`
  //     assignments before `node --test`);
  //   * the runner names exactly the assertion half's two rungs, unit first, and nothing else;
  //   * a run that declares nothing is refused on the COUNT (check 3), AFTER the floor (check 2);
  //   * no `--test-isolation` anywhere in the hook.
  const RUNNER_LINE =
    'if FORCE_COLOR=0 node --test --test-reporter=spec scripts/test/unit/*.test.mjs scripts/test/assert/*.test.mjs >"$tmpfile" 2>&1; then';
  const runnerLines = hookText.split("\n").filter((l) => l.trim() === RUNNER_LINE);
  assert.equal(runnerLines.length, 1,
    `the hook must run exactly ONE test runner over the assertion half's rungs, and it runs ${runnerLines.length}`);
  const nodeTestLines = hookText.split("\n").filter((l) => NODE_TEST_LINE.test(l));
  assert.equal(nodeTestLines.length, 1,
    `the hook's only node --test command line is its runner, and it has ${nodeTestLines.length}: ` +
    nodeTestLines.join(" | "));
  const globsInRunner = runnerLines[0].match(/scripts\/test\/[a-z]+\/\*\.test\.mjs/g) || [];
  assert.deepEqual(globsInRunner,
    ["scripts/test/unit/*.test.mjs", "scripts/test/assert/*.test.mjs"],
    "the runner is handed exactly the assertion half's two rungs, unit first — the order the " +
    "floor's `git ls-files` list names them in — and nothing else may ride along");
  assert.doesNotMatch(hookText, /--test-isolation/,
    "the hook still names --test-isolation: the single-process mode and its probe are retired (0.49.0, D3)");
  // THE ZERO-COUNT ABORT, AND ITS PLACE. With both patterns unmatched the runner is still given paths,
  // so it never falls back to default discovery (which walks the tree and would reach the triggered
  // halves); it runs zero files, and zero is refused. Keyed on `declared = 0` and placed AFTER the
  // floor, so a COLLAPSED run — the index declares tests, the runner reports 0 — is the shortfall
  // naming both counts and never "neither rung holds a test file" (Gate 1 B6).
  assert.match(hookText, /if \[ "\$declared" -eq 0 \]; then/,
    "the hook no longer refuses a run whose rungs declare no test");
  assert.match(hookText, /neither rung of the assertion half holds a \*\.test\.mjs file/,
    "the empty-rung refusal must name what it could not find");
  const floorAt = hookText.indexOf('if [ "$total" -lt "$declared" ]; then');
  const emptyAt = hookText.indexOf('if [ "$declared" -eq 0 ]; then');
  assert.ok(floorAt > 0 && emptyAt > floorAt,
    "the floor (total < declared) must be checked BEFORE the empty-rung refusal, or a collapsed run is " +
    "reported as an empty rung");
  // THE RETIRED PROBE'S CACHE FILE IS REMOVED — the inverse of the write the old probe made (0.49.0,
  // task 1.4; the functional twin proves it on a fixture, task 1.5).
  assert.match(hookText, /^rm -f "\$\(git rev-parse --git-common-dir\)\/pm-isolation-flag"$/m,
    "the hook no longer removes the retired probe's pm-isolation-flag from existing clones");
  assert.match(hookText, /set -e/, ".githooks/pre-commit does not fail the commit on a non-zero exit");
  // A COUNT THAT CANNOT BE READ IS REFUSED, AND ONLY ONE FORMAT IS READ (0.49.0 task 1.2, design D4).
  // Until 0.49.0 an unparsed summary printed "tests passing (summary line not found)" and exited 0
  // with the floor skipped. The refusal must be present, the old pass-through must be gone, and the
  // parse must name `ℹ` and never the TAP `#` — a second format read is a second format that can
  // silently stop matching.
  assert.match(hookText, /pre-commit: ABORT -- the count could not be read/,
    "the hook no longer refuses a run whose count it cannot read — the floor would be skipped silently");
  assert.doesNotMatch(hookText, /summary line not found/,
    "the hook still reports an unreadable count as passing");
  const parseLines = hookText.split("\n").filter((l) => /^\s*(?:total|passed)=\$\(grep/.test(l));
  assert.equal(parseLines.length, 2, `the hook must parse exactly total and passed: ${parseLines.join(" | ")}`);
  for (const l of parseLines) {
    assert.match(l, /'\^ℹ (?:tests|pass) '/, `the count parse must anchor on ℹ: ${l}`);
    assert.doesNotMatch(l, /#/, `the count parse must not read the TAP '#' format: ${l}`);
  }
  // The floor makes partial-suite runs possible in a way the single file did not, so the hook must
  // cross-check the ran count against the declared count. WHAT IT MUST BE DERIVED FROM is the whole
  // invariant and the reason the old `grep -Hc` assertion is gone: `declared` has to come from the
  // TRACKED files of the half the runner was GIVEN (the index, via git ls-files), never from the
  // shell's expansion of the runner's own pattern — the two shrinking in lockstep is exactly how a
  // file renamed out of the glob used to drop from both sides at once and leave the floor blind.
  // RE-POINTED IN 0.50.0: the list is read from the index git HANDED the hook
  // (`GIT_INDEX_FILE="$INDEX_FILE" git -C "$ROOT" ls-files …`), because the hook now runs from inside
  // its index snapshot, and `.git/index` is stale under `commit -a` and `commit <path>`.
  assert.match(hookText, /declared=\$\(GIT_INDEX_FILE="\$INDEX_FILE" git -C "\$ROOT" ls-files 'scripts\/test\/unit\/\*\.test\.mjs' 'scripts\/test\/assert\/\*\.test\.mjs'/,
    ".githooks/pre-commit's floor does not enumerate the tracked files of the RUNG SET its runner " +
    "was given — and the set is a LIST now, so a floor still naming one rung would count a subset");
  assert.doesNotMatch(hookText, /declared=\$\(grep /,
    "the floor's declared count must not be the shell's expansion of the runner's own pattern");
  // THE SUPERSET SHAPE (G-I1b): `declared` must enumerate the half the runner was given and NOTHING
  // ELSE. Adding the functional half's glob was invisible to every existing check — the shape
  // assertion above is a prefix match, so it still passed — while in the real repository it aborts
  // every commit that has a functional half at all. This is the invariant D8 states, asserted in the
  // direction that breaks the commit rather than the direction that only mis-counts.
  // `[^\n]*` BEFORE `ls-files` since 0.50.0 — the line now opens with the index env assignment, and a
  // pattern anchored on `declared=$(git ls-files` would match nothing and pass vacuously.
  assert.doesNotMatch(hookText, /declared=\$\([^\n]*ls-files[^\n]*functional/,
    "the hook's floor enumerates the functional half as well as the assertion half: it is a superset " +
    "of what this runner was given, and it aborts every commit that has a functional half at all");
  assert.doesNotMatch(hookText, /declared=\$\([^\n]*ls-files[^\n]*sweeps/,
    "the hook's floor enumerates the sweep bucket as well — same superset, same refusal");
  // The enrolment check landed INLINE in 5.3, because a file in neither half is run by nothing and
  // counted by nothing and the floor alone cannot see it. 6.4 RETIRED THAT COPY, handing all four
  // checks to the drift script so one rule has one implementation — so this pins the handover, and
  // pins BOTH halves of "one implementation at a time, never two".
  // RE-POINTED IN 0.50.0: the hook runs the SNAPSHOT's drift.mjs (`node "$DRIFT"`, DRIFT set from $SNAP).
  assert.match(hookText, /^DRIFT="\$SNAP\/scripts\/test\/drift\.mjs"$[\s\S]*node "\$DRIFT" --root/m,
    "the hook does not run the drift script, so nothing checks enrolment, the twin pairing, the " +
    "diff coupling or the record's freshness on this commit");
  assert.doesNotMatch(hookText, /grep -v -E '\^scripts\/test\//,
    "the hook has taken the enrolment check back inline — the drift script owns it, and two " +
    "implementations of one rule is the shape 6.4 exists to remove");
});

test("IX the hook verifies the INDEX: captured before the scrub, exported with checkout-index, and run from the export", () => {
  // THE SHAPE HALF of the functional IX-a…IX-f fixtures (0.50.0, commit-gate-tests-working-tree-not-index).
  // Those fixtures prove the behaviour through a real shell; this pins the lines that produce it, on
  // the per-commit path, so a hook edit that quietly goes back to the working tree fails here first.
  const lines = fs.readFileSync(HOOK, "utf8").split("\n");
  const at = (re) => lines.findIndex((l) => re.test(l));
  const RUNNER_AT = at(/^if FORCE_COLOR=0 node --test /);
  assert.ok(RUNNER_AT > 0, "the runner line was not found");

  // 1. THE INDEX IS CAPTURED BEFORE THE SCRUB. After `unset GIT_INDEX_FILE` the value git handed the
  //    hook is gone, and `.git/index` is STALE under `commit -a` and `commit <path>`.
  const captureAt = at(/^INDEX_FILE=\$\{GIT_INDEX_FILE:-\}$/);
  const unsetAt = at(/^unset [^\n]*\bGIT_INDEX_FILE\b/);
  assert.ok(captureAt >= 0 && unsetAt > captureAt, "GIT_INDEX_FILE must be captured BEFORE the hook unsets it");
  assert.equal(at(/^case "\$INDEX_FILE" in "" \| \/\*\) ;; \*\) INDEX_FILE="\$PWD\/\$INDEX_FILE" ;; esac$/), captureAt + 1,
    "a relative GIT_INDEX_FILE (a plain commit's `.git/index`) must be made absolute against the cwd git gave the hook");
  assert.ok(at(/^\[ -n "\$INDEX_FILE" \] \|\| INDEX_FILE=\$\(git rev-parse --path-format=absolute --git-path index\)$/) > unsetAt,
    "with no GIT_INDEX_FILE the hook must fall back to the repository's own index, absolutely");

  // 2. THE INDEX IS EXPORTED, AND THE RUNNER RUNS FROM THE EXPORT.
  const snapAt = at(/^SNAP=\$\(mktemp -d /);
  const exportAt = at(/^if ! GIT_INDEX_FILE="\$INDEX_FILE" git checkout-index -a --prefix="\$SNAP\/"; then$/);
  const cdAt = at(/^cd "\$SNAP"$/);
  assert.ok(exportAt > 0, "the hook must export the captured index with `git checkout-index -a --prefix=\"$SNAP/\"`");
  assert.ok(snapAt < exportAt && exportAt < cdAt && cdAt < RUNNER_AT,
    "the order must be snapshot dir → export → cd into the snapshot → runner, or the runner reads the working tree");
  assert.match(lines[snapAt], /^SNAP=\$\(mktemp -d "\$\{TMPDIR:-\/tmp\}\/pm-precommit-index\.XXXXXX"\)$/,
    "the snapshot must be a private temp dir under $TMPDIR");

  // 3. THE RUNNER NEVER SEES THE INDEX VARIABLE — the leak the scrub exists to stop. (Its line is pinned
  //    by equality in the test above; this names the property.) The drift script does see it.
  assert.doesNotMatch(lines[RUNNER_AT], /GIT_INDEX_FILE/, "the test runner must never inherit GIT_INDEX_FILE");
  const driftAt = at(/^if ! GIT_INDEX_FILE="\$INDEX_FILE" node "\$DRIFT" --root "\$ROOT"; then$/);
  assert.ok(driftAt > 0,
    "the drift script reads the index too, so it must be handed the one this commit is made from");
  // AND IT IS THE COMMIT'S drift.mjs (branch review, minor 2): the snapshot is exported BEFORE drift
  // runs, and DRIFT names the snapshot's copy, falling back to the working tree's only when the index
  // holds none (a hook fixture that copies the script in untracked).
  assert.ok(exportAt < driftAt, "the snapshot must exist before drift runs, so drift can be the commit's copy");
  assert.equal(at(/^DRIFT="\$SNAP\/scripts\/test\/drift\.mjs"$/) + 1, at(/^\[ -f "\$DRIFT" \] \|\| DRIFT="\$ROOT\/scripts\/test\/drift\.mjs"$/),
    "DRIFT must be the snapshot's copy, with the working tree's used only when the index holds none");
  // THE MERGE-BLOCKING TEMP-DIR RULE (branch review): every temp dir the functional twin's IX
  // fixtures make is wrapped in removeAtExit(), so a failed assertion cannot leak one.
  const functionalSrc = fs.readFileSync(path.join(path.dirname(HOOK), "..", "scripts", "test", "functional", "conductor-09.test.mjs"), "utf8");
  const ixSection = functionalSrc.slice(functionalSrc.indexOf("the hook verifies the INDEX, never the working tree"));
  const unwrapped = ixSection.split("\n").filter((l) => /\bmkdtempSync\(/.test(l) && !/removeAtExit\(\s*fs\.mkdtempSync\(/.test(l));
  assert.deepEqual(unwrapped, [], "an IX fixture makes a temp dir that is not scheduled with removeAtExit()");

  // 4. `declared` COUNTS THE SNAPSHOT'S BYTES, never the working tree's copy of a partially staged file.
  assert.ok(lines.some((l) => l.includes(`grep -cE '^(test|unitTest)\\(' "$SNAP/$f"`)),
    "the floor's per-file count must read the snapshot's copy ($SNAP/$f)");

  // 5. NOTHING THE USER OWNS IS WRITTEN, AND THE CLEANUP REACHES EVERYTHING IT CREATED.
  const text = lines.join("\n");
  assert.doesNotMatch(text, /^[^#\n]*\bgit stash\b/m,
    "the hook must not stash: a stash writes the working tree, fails before the first commit, and uses a stack every worktree shares");
  // (`checkout-index --prefix=` writes only under the prefix, so it is excluded by the lookahead.)
  assert.doesNotMatch(text, /^[^#\n]*\bgit (?:checkout|reset|restore|apply)(?![-\w])/m,
    "the hook must not rewrite the working tree or the index");
  assert.match(text, /^LOCKDIR="\$\(git rev-parse --path-format=absolute --git-common-dir\)\/pm-suite\.lock"$/m,
    "the lock path must be absolute — the cleanup runs from inside the snapshot");
  assert.match(text, /^  if \[ -n "\$SNAP" \]; then rm -rf "\$SNAP"; fi$/m, "the cleanup must remove the snapshot");
  for (const [sig, code] of [["INT", 130], ["TERM", 143], ["HUP", 129]]) {
    assert.match(text, new RegExp(`^trap 'exit ${code}' ${sig}$`, "m"), `${sig} must become an exit so the EXIT cleanup runs`);
  }
});
