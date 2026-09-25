# Tasks

Commit mechanics, which bind every section below:

- **A RED lands in the SAME commit as its GREEN.** The pre-commit hook runs the assertion half, so a
  RED cannot be committed alone. Before that commit, the failing run against the pre-GREEN tree is
  saved in this change directory as `red-<task>.txt`, and the GREEN commit message names that file.
- **REGRESSION GUARD** marks a task that passes as soon as it exists. It is verified by a deliberate
  violation in a SCRATCH COPY, never in the tree, and the result is saved as `mutation-<task>.txt`.
- **The drift script shapes the commits.** It refuses:
  - a staged `scripts/test/functional/<id>.test.mjs` without its twin (`scripts/test/{unit,assert}/<id>.test.mjs`)
    in the same staged diff;
  - a changed certified module, or a changed engine source file, without a fresh record.
  So:
  - Before any commit that touches `scripts/conductor.mjs` or `scripts/lib/*.mjs`, even a comment,
    run `node scripts/test/certify.mjs sweeps`.
  - If the file is a certified module, run `… certify.mjs functional` too. The certified set is
    DERIVED, never named from memory (Gate 1 I9): it is `certifiedModules()` in
    `scripts/test/certification.mjs:190` — every `scripts/lib/*.mjs` whose source calls `gitOps(`,
    minus `invocation.mjs` and `git-gateway.mjs`, plus `scripts/conductor.mjs`. Before each commit,
    run `rg -l '\bgitOps\s*\(' scripts/lib scripts/conductor.mjs` and check the staged engine files
    against it. At drafting it was `conductor.mjs`, `commit-watch.mjs`, `constants.mjs`,
    `created-at.mjs`, `git.mjs`, `subcommands.mjs`, `tool-currency.mjs`, `worktree-hygiene.mjs`.
  - Before any commit that touches a functional test file, run `… certify.mjs functional`.
- **The guards that change when the hook or CI changes**, each re-pointed IN THE COMMIT that changes
  the shape it reads, and each re-point proven by a mutation in a scratch copy:
  - `scripts/test/assert/conductor-09.test.mjs` — the hook's runner line, its `node --test` count,
    the empty-rung abort and the floor's shape;
  - `scripts/test/functional/conductor-09.test.mjs` — the hook, run against fixtures;
  - `scripts/test/assert/ci-workflow.test.mjs` — `ci.yml`'s bucket steps and, from section 4, its
    matrix;
  - `scripts/test/assert/assert-half-has-no-spawn.test.mjs` — the shim coverage walk.
- **Landing order is not section order** (design, Migration Plan): 1.1–1.3, then section 2, then
  1.4–1.5, then sections 3, 4, 5, 7, 8, 9. Section 2 lands before 1.4 so that no commit runs the half
  per-file while the 13 file-rung files still rely on another file's shim. **The PR into `main` opens
  only after 4.3.**
- **The twin must be EDITED, not merely present.** `couplingRefusals()`
  (`scripts/test/certification.mjs:163-176`) passes a staged `functional/<id>.test.mjs` only when
  `scripts/test/{unit,assert}/<id>.test.mjs` is itself in the STAGED set (`git diff --cached
  --name-only --no-renames`), i.e. carries a change in the same commit. An existing twin, or one
  `git add`ed unchanged, does not count. Every commit in the landing order that stages a
  functional file, checked against that rule:
  | Commit (landing order) | Functional file staged | Twin EDITED in the same commit |
  |---|---|---|
  | 1.1 + 1.2 + 1.3 | `functional/conductor-09` (1.1's RED fixture, 1.2's stub-`node` fixture, 1.3's empty-rungs fixture) | `assert/conductor-09` — `RUNNER_LINE` re-point and the unreadable-count text guard |
  | 2.1 + 2.2 | none | — |
  | 2.3 + 2.4 | none | — (`assert/git-shim` created) |
  | 2.4b + 2.4c | `functional/git-shim` (new) | `assert/git-shim` — 2.4b's `EMPTY_CACHE` removal case |
  | 2.5 | none (every file it names is lib, fixture or assert) | — |
  | 1.4 + 1.5 | `functional/conductor-09` (`:411-450` narrative, 1.5's cache-file fixture) | `assert/conductor-09` — the runner-line, one-`node --test` and zero-count re-points |
  | 3.1 + 3.2 | `functional/runtime-support` (new) | `unit/runtime-support` (new) |
  | 3.3; 4.2b; 4.2 + 4.3; 4.4 | none | — |
  | 5.1 + 5.2 | `functional/state-file-refuses-to-guess` (`spawnAll`) | `assert/state-file-refuses-to-guess` — 5.1's source scan |
  | 7.x | none | — |
  Every functional-touching commit also runs `certify.mjs functional` first.

## 0. Before any code

- [x] 0.1 **Gate 1**, under review mode `thorough`: two fresh-context lenses over these artifacts BY
      PATH.
      - Lens A: is every WHEN/THEN in the three spec files reachable and testable against today's
        0.48.0 engine and CI? Does any of it restate what `suite-certification` or
        `engine-invocation` already owns?
      - Lens B: absent edits. Look for:
        - every place that runs `node --test` for a count that D4 does not name;
        - every single-process assumption D3's table misses;
        - every Node-version claim D8 misses;
        - the inverse of each new operation.
      Fix every Critical and Important and re-run
      `openspec validate node-support-policy --strict`. Then record
      `record-gate-review node-support-policy --gate 1 --verdict pass --reviewer "<identity>"`, with
      one `--artifact` each for `proposal.md`, `design.md`, `tasks.md`,
      `specs/suite-certification/spec.md`, `specs/engine-invocation/spec.md` and
      `specs/runtime-support/spec.md`, all under `openspec/changes/node-support-policy/`.
      Verify: the verdict appears in `node scripts/conductor.mjs status`.
- [x] 0.2 **Cross-spec review** (required task item 5). Release 0.49.0 holds THREE spec files,
      counted flat: `suite-certification`, `engine-invocation`, `runtime-support`.
      - Run the `cross-spec-review` skill after Gate 1 with two lenses (mode `thorough`), and again
        after any later round of concurrent amendment.
      - Ask the six questions.
      - Record `record-cross-spec-review 0.49.0 --verdict pass|fail --reviewer "<identity>"`.
      Where this release is most exposed:
      - **Double ownership.** `engine-invocation` owns ONLY that the runtime version is a per-call
        value, and `runtime-support` owns what is done with it. Neither may restate the other.
      - **Vocabulary fork.** "count", "summary" and "runner" in `suite-certification`'s new count
        requirement against "the test job" and "per-major run" in `runtime-support`.
      - **Contradiction.** Do `runtime-support`'s "a per-major run that did not run counts as a
        failure" and `suite-certification`'s "a run of zero tests refuses" state one rule or two?
      Verify: the verdict is recorded and not rendered stale.
- [x] 0.3 **BASELINE, measured BEFORE any code lands**, written to `baseline-before.md` in this
      directory. Each number is measured on the day and never carried forward from `design.md`.
      - (a) The hook's end-to-end wall clock, three runs, in a hermetic clone of `HEAD` under the
        session scratchpad, never in this checkout. Record `command -v node` and `node --version` for
        the Node the hook resolves.
        - Once with the hook as it is (single-process where the probe allows it).
        - Once with a scratch copy of the hook whose `$ISOFLAG` is forced empty (process-per-file).
      - (b) The half's own `ℹ duration_ms` and `ℹ tests` in both modes, from the same runs.
      - (c) The last CI `test` job on `main`, from `gh run list --repo cfdude/pm --workflow ci.yml --branch main --limit 1`
        and `gh run view <id> --json jobs`: the job duration, and each bucket step's duration. At
        drafting: run `35722337413` — job 4 m 46 s; assertion half 16 s, functional 3 m 24 s, sweeps
        51 s; Node 18.
      - (d) `ls -d "$(node -p 'require("os").tmpdir()')"/pm-assert-no-git-* | wc -l` — at drafting
        3,501 — so that 2.4's delta is measured against a real starting count.
      Report which commit this file lands in.
- [x] 0.4 **The stale main specs — DONE in `3256cc2`** (by the coordinator, before Gate 1).
      0.48.0's deltas had not reached `openspec/specs/` (its archive commit staged only
      `openspec/changes`; a later hard reset discarded the spec edits). `3256cc2` restored them:
      `engine-invocation` +2 requirements, `suite-certification` +2 and three blocks replaced with
      0.48.0's text. That commit is 0.48.0's lifecycle bookkeeping and is NOT attributed to this epic.
      This change's deltas were then re-checked against the restored text (design, Context): the
      MODIFIED *"two halves"* block restates the current requirement with this change applied, the
      REMOVED header names the current *"The assertion half spawns no process and runs no git"*, and
      neither conflicts with the restored *"A fixture is built once per file"* or *"A rung's
      membership is decided by what a test observes"*. `openspec validate node-support-policy --strict`
      passed after the re-check.

## 1. The hook: one reporter, a count that must be read, no probe, no loop

- [x] 1.1 RED — `functional/conductor-09.test.mjs` gains a fixture run of the hook with
      `FORCE_COLOR=1` in its environment, over a passing two-test fixture. It asserts the hook
      prints `pre-commit: 2/2 passing`, which proves the floor compared a count.
      - It fails today on the machine's Node 24+: the spec reporter colours its summary, `^ℹ tests `
        matches nothing, the hook prints `tests passing (summary line not found)` and exits 0 with
        the floor skipped (`.githooks/pre-commit:214`, `:223-224`).
      - It reproduces only on Node 24+, whose default non-TTY reporter is spec; on 20/22 the default
        is TAP, which is never coloured. `red-1.1.txt` records `node --version` of the Node the
        hook resolved when it was captured.
      - Save `red-1.1.txt`.
      - Twin: `assert/conductor-09.test.mjs` is staged in the same commit, since 1.2 re-points it.
      - Run `certify.mjs functional` before the commit.
- [x] 1.2 GREEN — the hook's runner becomes
      `FORCE_COLOR=0 node --test --test-reporter=spec $ISOFLAG $RUNG_FILES`, still with the probe at
      this step.
      - `total` and `passed` are parsed from `^ℹ ` only, and the `#` branch is deleted.
      - The checks run in the order design D5 fixes: (1) no parseable summary → ABORT, "the count
        could not be read" — no longer "tests passing (summary line not found)"; (2) `total <
        declared` → the existing shortfall ABORT naming both counts, `total = 0` included; (3)
        `declared = 0` → the empty-rung ABORT. The empty-rung message is NEVER shown while the index
        still declares tests (Gate 1 B6).
      - The hook's prose at `:173-175` (the dual-reporter comment) is rewritten (Gate 1 I8).
      - `assert/conductor-09.test.mjs:129`'s `RUNNER_LINE` is re-pointed in this commit, and a TEXT
        guard is added there: the hook holds the unreadable-count ABORT and parses `^ℹ` only.
      - **A durable test for the unreadable-count refusal (Gate 1 I2):** `functional/conductor-09.test.mjs`
        gains a fixture whose PATH holds a stub `node` first — a shell script that exits 0 and
        prints no summary — and asserts the hook ABORTs with "the count could not be read" rather
        than passing. The stub also answers the hook's `drift.mjs` call; the test asserts the
        runner's refusal, not drift's. Its twin is `assert/conductor-09.test.mjs`, staged in this
        commit; run `certify.mjs functional` first.
      Mutation proofs in scratch copies of the hook, saved to `mutation-1.2.txt`:
      - (i) the reporter flag swapped for `--test-reporter=tap` → the hook ABORTs on an unreadable
        count rather than passing;
      - (ii) `FORCE_COLOR=0` removed, run with `FORCE_COLOR=1` → ABORT, not pass;
      - (iii) the re-pointed `conductor-09` guard, fed a hook text whose runner line lacks
        `--test-reporter=spec` → the guard fails.
- [x] 1.3 REGRESSION GUARD — `functional/conductor-09.test.mjs` gains a fixture whose two rung
      directories hold only `.keep`.
      - The hook must refuse, naming both rungs.
      - The output must carry no line from the fixture's functional marker, so default discovery was
        never reached.
      - It passes today, through the loop's empty-list abort, and must still pass after 1.4 removes
        the loop.
      - **Lands in the 1.1 + 1.2 commit** (it passes today, so it has no RED of its own): a
        separate commit would stage `functional/conductor-09` with no `assert/conductor-09` edit,
        which the drift script's coupling check refuses.
- [x] 1.4 GREEN — delete the single-process machinery and the Node-18 loop (design D3, D5).
      - Delete the probe block (`pre-commit:108-131`), `ISOFLAGFILE` (`:117`) and `ISOFLAG` (`:132`).
      - Add `rm -f "$(git rev-parse --git-common-dir)/pm-isolation-flag"`, the inverse of the probe's
        write.
      - Delete the `[ -f ]` loop (`:160-169`). The runner line carries the two rung globs literally:
        `FORCE_COLOR=0 node --test --test-reporter=spec scripts/test/unit/*.test.mjs scripts/test/assert/*.test.mjs`.
      - The empty-rung abort is the THIRD check of 1.2's order — `declared = 0` — and keeps its
        message "neither rung of the assertion half holds a *.test.mjs file". A run with `total = 0`
        and `declared > 0` is the shortfall ABORT, never this message.
      - One rung matching nothing while the other matches is NOT a refusal. The existing
        `functional/conductor-09.test.mjs:411-450` fixture (unit rung holds only `.keep`, assert rung
        holds one file) is suite-certification's *"One rung that matches nothing does not stop the
        other"* scenario; it stays and is cited as such.
      - Rewrite the hook's prose at `:32-34`, `:48-50` and `:134-159`, and `assert/conductor-09.test.mjs:94-128`'s
        narrative, including `:120`'s wrapped "Node 18 REFUSES" (Gate 1 I8).
      Re-point `assert/conductor-09.test.mjs`:
      - `RUNNER_LINE` (`:129`);
      - exactly ONE `node --test` line, replacing the runner-plus-probe count at `:134-143`;
      - the runner line names exactly the two rung globs, unit first. This replaces the enumeration
        assertions at `:130` and `:147-157`;
      - the zero-count abort, replacing `[ -z "$RUNG_FILES" ]` at `:162-166`;
      - no `--test-isolation` anywhere in the hook.
      Rewrite `functional/conductor-09.test.mjs:411-450`'s Node-18 narrative as history, keeping
      its assertions.
      Run the functional `conductor-09` file under each bench binary (PATH-prefixed 22.23.3,
      24.21.0 and 26.10.0) and save the three summaries to `verify-1.4.txt`. G-I1's dotfile case
      must still fire the floor on each.
      Mutation proofs, saved to `mutation-1.4.txt`:
      - (i) `--test-isolation=none` re-added to a copy → `conductor-09` fails;
      - (ii) `scripts/test/functional/*.test.mjs` added to the runner line → it fails;
      - (iii) the zero-count abort removed → 1.3's fixture fails;
      - (iv) the checks re-ordered so the empty-rung message precedes the floor → a fixture whose
        index declares tests but whose runner reports 0 shows the empty-rung message, and the test
        asserting the shortfall message fails.
- [x] 1.5 REGRESSION GUARD — `functional/conductor-09.test.mjs`: a fixture whose git dir holds a
      stale `pm-isolation-flag` has none after one hook run. This proves the inverse shipped.
      Mutation: the `rm -f` line removed from a copy → red. Save to `mutation-1.5.txt`.
      **Lands in the 1.4 commit**, whose `assert/conductor-09` re-points are the twin edit the
      coupling check requires; alone it would stage the functional file with no twin edit.

## 2. The git shim in every process, and its temp directory removed (design D3 rows 1–3)

- [x] 2.1 RED — `assert/assert-half-has-no-spawn.test.mjs` gains a walk over both rungs.
      - Every rung file must install the shim: a direct `import "../fixtures/assert-git-shim.mjs"`,
        or an import of `fixtures/assert-harness.mjs` or `fixtures/unit-harness.mjs`.
      - A file that does neither is refused by name.
      - A discrimination test feeds it one source per shape, and one that names the shim only in a
        comment, which is NOT an install. One sample is a TWO-LINE import, in the shape of
        `assert/conductor-33.test.mjs:39-40` (`import { … ,\n  … } from "../fixtures/assert-harness.mjs"`),
        so a line-based match cannot pass it by accident.
      - Fails today naming the 13 file-rung files: `ci-workflow`, `conductor-29`, `conductor-37`,
        `drift-script`, `engine-resolution`, `git-gateway-guard`, `hermetic-git`, `hooks-schema`,
        `lessons-index`, `no-inline-exit`, `outcome-vocabulary`, `parity`, `store-ownership`.
      - Save `red-2.1.txt`.
- [x] 2.2 GREEN — each of the 13 gains `import "../fixtures/assert-git-shim.mjs";` as its first
      import.
      - Verify: 2.1 is green, and the half's `ℹ tests` is unchanged from 0.3(b).
      - **If any of the 13 goes red, that file was reaching the real `git` undetected.** That is a
        FINDING, not a regression. The test moves to the functional half with a twin, and it is
        named in this task rather than exempted.
- [x] 2.3 RED — a file-rung test calls the shim module's exported directory-removal function on a
      scratch directory, then asserts the directory is gone.
      - Fails today: the module exports no such function, and `assert-git-shim.mjs:64-74` removes
        nothing.
      - Save `red-2.3.txt`.
- [x] 2.4 GREEN — `assert-git-shim.mjs`'s exit listener reads the log and then removes `shimDir`
      through that function.
      - The G-I4 test (`assert-half-has-no-spawn.test.mjs:149-168`) is re-scoped per design D3
        row 2. Its comment says the per-process listener is the mechanism, and its direct check is
        that the shim is first on PATH in THIS process.
      - The shim's prose at `:17-19` and `:23-26` (Gate 1 I8) and the old-requirement-name
        citation at `:69` (6.2) are rewritten in this commit.
      - Verify: the `pm-assert-no-git-*` count from 0.3(d) is unchanged across one full run of the
        half. Save `verify-2.4.txt` with before and after.
- [x] 2.4b GREEN — the SECOND per-process leak (design D3 row 3b, Gate 1 I6):
      `fixtures/harness.mjs:36`'s `EMPTY_CACHE` directory is removed at process exit through the same
      removal function as 2.4's. RED in the same commit: the 2.3 test file gains a case asserting the
      harness registers the removal (the directory is created by `mkdtemp`, so the check is that the
      exported path is scheduled for removal, exercised on a scratch directory). Verify: the
      `pm-empty-cache-*` count is unchanged across one full run. Save `verify-2.4b.txt`.
- [x] 2.4c REGRESSION GUARD — *"A real git call in any file's process fails the run"* gets a durable
      test (Gate 1 I3). New `functional/git-shim.test.mjs` writes a fixture test file that imports
      the shim and runs `git --version` through `execFileSync`, runs `node --test --test-reporter=spec`
      on it with `FORCE_COLOR=0`, and asserts exit 1, `ℹ fail 1`, and the listener's report naming
      the argv. Its twin is `assert/git-shim.test.mjs`, 2.3's file (the removal test). **It lands in
      2.4b's commit**, because 2.4b EDITS `assert/git-shim.test.mjs` (its `EMPTY_CACHE` case), and the
      coupling check needs the twin edited, not merely present. Run `certify.mjs functional` first. Mutation: the
      listener's `process.exitCode = 1` removed in a scratch copy → the functional test fails.
      Save `mutation-2.4c.txt`.
- [x] 2.5 Comments and one test title that state the retired mode as the rationale (design D3 rows
      4–8 and 10):
      - `scripts/lib/invocation.mjs:10-13`, `:20-21`, `:67-68`;
      - `scripts/lib/constants.mjs:14-19`;
      - `fixtures/helpers.mjs:72-74`;
      - `fixtures/fs-work-counter.mjs:59`;
      - `assert/no-inline-exit.test.mjs:8-10`, `:128`;
      - `assert/per-call-roots.test.mjs:11`;
      - `certification.mjs:107`;
      - `assert/delivered-obligations.test.mjs:26`;
      - `assert-half-has-no-spawn.test.mjs:5-7`, `:143`, `:166`, and the test title at `:208`;
      - `scripts/lib/command-exit.mjs:46-47` and `scripts/lib/git-gateway.mjs:5` (Gate 1 I8).
      Engine source is touched, so run `certify.mjs sweeps` before the commit. `constants.mjs` is a
      CERTIFIED module (it calls `gitOps(`), so run `certify.mjs functional` too (Gate 1 I9).
      Verify: `rg -n -i 'isolation=none|single process|one process|shared process' scripts/lib scripts/test`
      returns only lines about an in-process caller serving several invocations. Each surviving line
      is listed with that reason in `verify-2.5.txt`.
- [x] 2.6 One-time cleanup of the directories already leaked on this machine: at the fix round,
      4,041 `pm-assert-no-git-*` and 6,877 `pm-empty-cache-*` under `os.tmpdir()`. After 2.4 and
      2.4b land, remove them with
      `rm -rf "$(node -p 'require("os").tmpdir()')"/pm-assert-no-git-* "$(node -p 'require("os").tmpdir()')"/pm-empty-cache-*`,
      while no suite is running (the cross-worktree lock is free). This is a machine action, not a
      repository change, and it commits nothing. Verify both counts read 0 afterwards, and record
      before and after in `verify-2.6.txt`.

## 3. The engine: the support floor, the runtime-version seam, the brief line (design D1, D6)

- [x] 3.1 A new unit-rung file, `scripts/test/unit/runtime-support.test.mjs`, driven through
      `memoryEngine()` with `nodeVersion`. It is split by what fails TODAY (Gate 1 I1):
      **RED** (fails today — no seam, no line; save `red-3.1.txt`):
      - `brief` in an initialized record under `v20.20.2` → the `additionalContext` starts with one
        line naming `20.20.2` and `22`, and the status equals the `v22.23.3` run's;
      - two invocations in one process under two DIFFERENT below-support-floor versions, `v20.20.2`
        and `v18.20.8` → each line names its own version (two versions that both produce no line
        could not tell the invocations apart);
      - no `nodeVersion` supplied → a store whose `read` records `runtimeVersion()` at the moment
        `brief` loads the record sees exactly `process.version` (Gate 1 B2; "no line" alone would
        pass with an absent value).
      **REGRESSION GUARDS** (pass today, because nothing prints a line yet), each with a mutation in a
      scratch copy of `runtime-support.mjs` or `subcommands.mjs` after 3.2, saved to `mutation-3.1.txt`:
      - under `v22.23.3`, `v25.0.0` and `v26.10.0` → no line (mutation: the line emitted always);
      - under `garbage` → no line (mutation: an unparseable major read as 0);
      - not initialized → no output (mutation: the line emitted before `brief()`'s dormancy return);
      - `render`'s PROJECT.md artifact and `snapshot`'s brief artifact under `v20.20.2` → neither
        contains the line (mutation: the line built in `buildBrief()` instead of `brief()`).
- [x] 3.2 GREEN — the engine side.
      - New `scripts/lib/runtime-support.mjs`: `NODE_FLOOR_MAJOR = 22`, and a pure function from a
        version to the line or `null`.
      - `invocation.mjs`: `PROCESS_CONTEXT` gains a live `nodeVersion` getter, and a
        `runtimeVersion()` accessor is added.
      - `conductor.mjs`'s `runInvocation` context gains `nodeVersion: io.nodeVersion ?? process.version`.
      - `subcommands.mjs`'s `brief()` prepends the line.
      - `fixtures/harness.mjs`'s `invokeEngine` (`:60`) passes `nodeVersion` through, AND
        `fixtures/unit-harness.mjs`'s `memoryEngine` (`:65-67`), whose `result()` forwards only
        `{ cwd, store, env, input }` today, gains it (Gate 1 I7).
      - `runtimeVersion(ctx)` returns `ctx.nodeVersion ?? process.version`, so a context installed
        with `setInvocation({ … })` and no `nodeVersion` (`assert/gate-artifact-evidence.test.mjs:32`,
        `assert/delivered-obligations.test.mjs:31`, `fixtures/assert-harness.mjs:42`) behaves like
        the process.
      - **The command-line path (Gate 1 B2):** new `functional/runtime-support.test.mjs`, twin
        `unit/runtime-support.test.mjs` (3.1's file). It spawns
        `node --import <preload> scripts/conductor.mjs brief --platform claude-code` in an
        initialized repository, where the preload runs
        `Object.defineProperty(process, "version", { value: "v20.20.2" })` (verified:
        `process.version` is `configurable: true`), and asserts the warning line; without the
        preload, it asserts none. Run `certify.mjs functional` first.
      - The version is interpolated through `escapeControls`, and the output-interpolation sweep is
        green: escape or judge `<N>` as the sweep requires.
      - `conductor.mjs:77`'s "Node 18+" is corrected in the same commit.
      Run `certify.mjs sweeps` and `certify.mjs functional` before the commit.
      Verify:
      - 3.1 is green;
      - `rg -n 'process\.version' scripts/lib scripts/conductor.mjs` returns only the context
        defaults;
      - `assert/conductor-35.test.mjs:117-126`'s no-network walk covers the new module, which it
        does by construction because it reads every `scripts/lib/*.mjs`.
- [ ] 3.3 REGRESSION GUARD — the no-network walk. `conductor-35`'s forbidden set is `fetch(`,
      `node:http(s)` and `require('http(s)')`. It does not name `node:net`, `node:tls` or
      `node:dgram`. Decide, and record here, whether to widen it in this change. Recommended: widen
      it, because this change adds a module whose subject is an external schedule, which is exactly
      the temptation the law guards against. Mutation: add
      `import net from "node:net"` to a scratch copy of `runtime-support.mjs` → refused. Save
      `mutation-3.3.txt`.

## 4. CI: the schedule matrix, the aggregate check, one reporter, current actions (design D2, D4, D7)

- [ ] 4.1 Read `actions/checkout`'s and `actions/setup-node`'s v5, v6 and v7 release notes.
      - Record every changed default in `actions-notes-4.1.md`.
      - Confirm `fetch-depth: 0` (`ci.yml:28`) keeps its meaning.
      - Re-confirm the latest tags with `gh api repos/actions/{checkout,setup-node}/releases/latest`.
        At drafting they were `v7.0.1` and `v7.0.0`, both `using: node24`.
- [ ] 4.2 RED (same commit as 4.3, after 4.2b) — `assert/ci-workflow.test.mjs` gains pure functions over `ci.yml`'s text, with tests.
      They assert:
      - (a) a job named `test`, with `if: always()`, needing the compute job and the matrix job;
      - (b) its step fails unless both `needs.*.result` equal `success`;
      - (c) the matrix job has `fail-fast: false`, `timeout-minutes`, and
        `matrix.node: ${{ fromJSON(needs.<compute>.outputs.majors) }}`;
      - (d) the compute step fetches the pinned schedule URL with `curl`, and runs
        `node scripts/test/node-majors.mjs` handing it the fetched file (or the fetch's failure),
        `date -u +%F`, and `$PM_NODE_FALLBACK` — the step must name `PM_NODE_FALLBACK` in the
        script's arguments or environment, so a step that ignores the committed list is refused
        (Gate 1 B5);
      - (e) the minimum of the workflow's `PM_NODE_FALLBACK` equals `NODE_FLOOR_MAJOR`, imported
        from `scripts/lib/runtime-support.mjs`, and a mismatch names both values;
      - (f) every bucket step's runner carries `--test-reporter=spec` and `FORCE_COLOR=0`, and its
        parse names `ℹ` and not `#`;
      - (f2) every bucket step refuses a ZERO count on its own — a `"$total" -eq 0` (or equivalent)
        `::error::` plus `exit 1` independent of `declared` — because `[ "$total" -lt "$declared" ]`
        is green at 0/0 (Gate 1 B1);
      - (g) `actions/checkout@v7` and `actions/setup-node@v7`, and no `node-version: "18"`.
      Also re-point `runnerLine()` (`:59`) so flags between `--test` and the globs are allowed, and
      update the G-C1 fixture strings (`:149-190`). And re-point the pipeline patterns at `:86` and
      `:97`, which match `total=$(node --test …` but not `total=$(FORCE_COLOR=0 node --test …`, so
      they accept any `NAME=value` prefixes before `node --test` (Gate 1 I5).
      Fails today on every one. Save `red-4.2.txt`.
      **4.2 and 4.3 are ONE commit** (the RED lands with its GREEN), and it lands AFTER 4.2b's
      commit: 4.2(d) asserts the compute step calls `scripts/test/node-majors.mjs`, which 4.2b
      creates, and 4.2(e) imports `NODE_FLOOR_MAJOR`, which 3.2 creates.
- [ ] 4.2b RED then GREEN, one commit — the schedule filter as a committed dev script (design D2,
      Gate 1 B5) and the support-floor copies (Gate 1 I10).
      - New `scripts/test/node-majors.mjs`: plain Node, no dependency, not shipped, not a test file
        (so outside the enrolment rule; `ci.yml:72`'s syntax loop already covers `scripts/test/*.mjs`).
        It exports pure functions — `supportedMajors(schedule, today)` and
        `decide({ fetched, body, today, fallback })` — and a CLI tail that prints the JSON array or
        exits 1 with `::error::` / prints `::warning::`, per design D2's table.
      - New file-rung test `scripts/test/assert/support-floor.test.mjs` (it installs the shim, per
        2.1's rule). Against a CANNED schedule it asserts: an `lts`-bearing entry whose `start` is
        after today is excluded; a live entry with no `lts` is excluded; an `lts`-bearing entry that
        has started and whose `end` is on or before today is excluded; a live entry whose `lts` date
        is in the future is included — each of the three clauses deciding one entry alone. And `decide()`:
        fetch failed → the fallback plus a warning; body not JSON, or JSON with no entry holding
        `start`/`end` → an ERROR, not the fallback; computed ≠ fallback → an error naming both;
        computed empty → an error.
      - The same test asserts every documented copy of the support floor equals `NODE_FLOOR_MAJOR`:
        `README.md`'s `Node N+` at `:51` and `:118`, and `CLAUDE.md:19`'s, naming the file and both
        values on a mismatch. It runs after 7.2/7.3 rewrite those lines; until then the README and
        CLAUDE.md cases are written against the 7.2/7.3 text and land in that commit instead.
        `CONTRIBUTING.md` carries no support-floor number today (`v26.9.0` at `:82` is a
        measurement's Node); if 7.1 adds one, it is added here.
      - Save `red-4.2b.txt`. Mutations in scratch copies, saved to `mutation-4.2b.txt`: the start
        clause removed; the `lts` clause removed; the `end` clause removed; a malformed body routed to the fallback — each
        refused by the canned-schedule test.
- [ ] 4.3 GREEN — rewrite `ci.yml` per design D2.
      - Jobs: `node-majors` (runs 4.2b's script under `actions/setup-node@v7` at the support
        floor), `test-node` (matrix) and the `test` aggregate.
      - `PM_NODE_FALLBACK: "[22,24,26]"`.
      - v7 actions.
      - Every bucket step as `FORCE_COLOR=0 node --test --test-reporter=spec …`, with `^ℹ` parses and
        a zero-count `::error::` plus `exit 1`.
      - The comment block at `:88-98`, dangling path included, replaced by what is true now.
      - The security workflow untouched.
      Mutation proofs, each a scratch copy of `ci.yml` fed to 4.2's functions and saved in
      `mutation-4.3.txt`, each refused for its stated reason:
      - `always()` dropped;
      - an aggregate that ignores `test-node`'s result;
      - `fail-fast: true`;
      - a fallback of `[20,22,24,26]`;
      - the `::warning::` removed;
      - the mismatch `exit 1` removed;
      - the empty-set check removed;
      - one step without the reporter;
      - a `#` alternation re-added;
      - one step's zero-count check removed (Gate 1 B1);
      - a step rewritten as `total=$(FORCE_COLOR=0 node --test … | grep … | awk …)` — the G-C1
        pipeline shape with an env prefix (Gate 1 I5);
      - the compute step no longer passing `$PM_NODE_FALLBACK` to the script (Gate 1 B5).
- [ ] 4.4 RED then GREEN, one commit — `scripts/test/certify.mjs`.
      - Export the count parser.
      - RED: a file-rung test asserts the exported parser returns `null` for a TAP summary
        (`# tests 3`) and for a coloured spec summary. It fails today: the parser is not exported,
        and the regex at `:65` accepts `#`. Save `red-4.4.txt`.
      - GREEN:
        - `spawnSync` passes `--test-reporter=spec` and `env: { ...process.env, FORCE_COLOR: "0" }`;
        - it parses `^ℹ` only;
        - it records NOTHING and exits non-zero when `tests` is `null` or `0`;
        - the header comment at `:57-59` is corrected.
- [ ] 4.5 VERIFY IN CI, on this change's PR run. Record in `ci-verify-4.5.txt`:
      - the `node-majors` output (`[22,24,26]` expected);
      - three legs named `test (node 22|24|26)`;
      - the aggregate reported under the context `test`, satisfying branch protection with no
        settings change;
      - each leg's `ran N, declared N` line, which is D4's linux confirmation.
      The fallback and mismatch paths are exercised ONCE each, through a **DRAFT PR** into `main` from
      a throwaway branch (allowed: coordinator, 2026-09-24). `ci.yml` triggers only on `push` to
      `main` and `pull_request` into `main`, so a draft PR runs the branch's own `ci.yml` with NO
      trigger added; `workflow_dispatch` is deliberately not added, because it would persist in the
      shipped workflow for a one-off. The branch is never merged:
      - schedule URL pointed at a 404 → the legs run on the fallback with the warning visible.
        **The throwaway commit edits BOTH the URL in `ci.yml` AND the URL 4.2(d) pins in
        `ci-workflow.test.mjs`** (design D2, option (b)), so the pre-commit hook passes on its own
        terms — `--no-verify` stays banned. The branch is never merged, so the edited guard never
        reaches `main`;
      - fallback edited to `[22,24]` → red naming both sets. No guard edit is needed: its minimum
        still equals the support floor.
      Record both run ids. Then close the draft PR without merging (`gh pr close <n> --repo cfdude/pm`)
      and DELETE the branch, remote and local
      (`git push origin --delete <branch>` and `git branch -D <branch>`), and confirm
      `git ls-remote origin <branch>` returns nothing.

## 5. cfdude/pm#220 — a bounded wait on every awaited child (design D9)

- [ ] 5.1 RED — `assert/state-file-refuses-to-guess.test.mjs`, the functional file's twin, gains
      a source scan.
      - Every ASYNCHRONOUS wait on a child's `"close"` or `"exit"` under `scripts/test/**/*.mjs`, in
        all three forms — `.on(…)`, `.once(…)`, and the events module's `once(child, …)` promise form
        (bare or `events.once`) — must sit in a function that also arms a timer that kills the child
        (Gate 1 B4). Synchronous spawns are out of scope by the requirement's own text (design D9).
      - It is discriminated against an unbounded sample of EACH form (all refused) and a bounded one
        (not refused).
      - The token it searches for, and both samples, are BUILT FROM PARTS
        (`assert-half-has-no-spawn.test.mjs:42-45`'s pattern). A scan whose own source spells the
        token would refuse itself, and exempting it by name is the first exemption of many.
      - Fails today naming `functional/state-file-refuses-to-guess.test.mjs:299`.
      - Save `red-5.1.txt`.
- [ ] 5.2 GREEN, in the same commit as 5.1 (the drift script's coupling requires the twin staged
      anyway).
      - `spawnAll` (`functional/state-file-refuses-to-guess.test.mjs:291-301`) arms a 30 s timer per
        child. That is the bound `verb-surface.test.mjs:611` already uses. On expiry the timer
        `SIGKILL`s the child and resolves `{ timedOut: true }`.
      - Every caller asserts `timedOut` is false, with a message naming the child's argv and the
        bound.
      - Run `certify.mjs functional` before the commit.
      - Verify: the functional file passes on the three bench binaries.
- [ ] 5.3 MUTATION — a scratch copy of the file whose `spawnAll` is handed one never-exiting child
      (`node -e "setInterval(() => {}, 1e9)"`).
      - The test must fail within the bound, naming the argv.
      - The run must continue to the file's next test.
      - Save `mutation-5.3.txt`.

## 6. Required task items

- [ ] 6.1 **Call-site completeness sweep** (required task item 1). Enumerate MECHANICALLY and record
      in `call-site-sweep-6.1.txt`. For each part, state where the rule holds, where it does not,
      and the justification for each omission.
      - (a) **Every place that runs `node --test` for a COUNT**, from
        `rg -n --hidden -e 'node --test' -e '"--test"' --glob '!openspec/changes/**' --glob '!docs/superpowers/**' --glob '!.conductor/**' --glob '!CHANGELOG.md' --glob '!.git/**'`.
        At drafting the count sites were:
        - the hook runner (`.githooks/pre-commit:172`), plus the probe at `:126`, deleted in 1.4;
        - `ci.yml:101`, `:118`, `:135`;
        - `certify.mjs:62`;
        - the release checklist's Real Numbers recipe (`.claude/skills/release-checklist/SKILL.md:63-64`).
        Non-count mentions, each classified:
        - the "tests green" commands in `CONTRIBUTING.md`, `CLAUDE.md` and `pr-workflow`;
        - `functional/conductor-09`'s fixtures, which run the hook;
        - `scripts/wt-preflight.sh:22`, a `pgrep`;
        - `docs/lessons/filter-at-read-time-not-at-capture-time.md`, a record.
        Every count site BOTH forces the reporter and `FORCE_COLOR=0` AND refuses an unreadable or
        zero count (Gate 1 B1) — including the Real Numbers recipe's new stop line (7.4) — or the
        omission is justified.
      - (b) Every reader AND every WRITER of the runtime version (Gate 1 I7): readers from
        `rg -n 'runtimeVersion\(|process\.version'`; writers from `rg -n 'nodeVersion' scripts` —
        `conductor.mjs`'s `runInvocation`, `invocation.mjs`'s `PROCESS_CONTEXT`,
        `fixtures/harness.mjs`'s `invokeEngine`, `fixtures/unit-harness.mjs`'s `memoryEngine`, and
        every `setInvocation({ … })` that omits it (named, with the fallback that covers it).
      - (c) Every reader of `NODE_FLOOR_MAJOR`.
      - (d) Every rung file against the shim install (2.1's walk is the mechanism; list its
        output).
      - (e) Every awaited child `close`, plus every `spawnSync`/`execFileSync` in `scripts/test`
        without a `timeout`, NAMED as design D9's separate class.
      - (f) D8's version-claim `rg`, re-run on the final tree BOTH line-based and multiline
        (`rg -U` with `\s+` for each literal space), because wrapped text escapes the line-based form
        (Gate 1 I8).
- [ ] 6.2 **Data references** (required task item 1). `PM_NODE_FALLBACK` is a data reference to
      `NODE_FLOOR_MAJOR`. Record where each is written, where it is read, and where it is removed:
      - `ci.yml`'s env;
      - `ci-workflow.test.mjs`;
      - `runtime-support.mjs`;
      - the release-checklist step;
      - the documented copies of the support floor (Gate 1 I10): `README.md:51`, `:118`,
        `CLAUDE.md:19` — each held true by 4.2b's per-commit assertion.
      Also record the `pm-isolation-flag` file: its writer is deleted (1.4), and its removal is
      shipped (1.4, proven in 1.5).
      **A REQUIREMENT NAME IS A DATA REFERENCE TOO.** This change REMOVES *"The assertion half spawns
      no process and runs no git"* and restates it as *"No test in the assertion half spawns a
      process or runs git"*. `openspec validate --strict` refused both alternatives:
      - a MODIFIED block that drops a scenario the main spec holds;
      - REMOVED and ADDED under one header ("Requirement present in both ADDED and REMOVED").
      Every live citation of the old name is re-pointed in the commit that touches its file. They
      are derived with
      `rg -n -U --hidden 'spawns no\s*(//\s*)?process and runs no' --glob '!openspec/changes/**' --glob '!.git/**' --glob '!.conductor/**' --glob '!CHANGELOG.md'`,
      a multiline pattern, because one citation wraps. At drafting there were three:
      - `scripts/test/assert/assert-half-has-no-spawn.test.mjs:2-3`;
      - `:197` in the same file;
      - `scripts/test/fixtures/assert-git-shim.mjs:69` — text the exit listener PRINTS at run time,
        so it re-points in 2.4's commit.
      The main spec's own header is rewritten by the archive. Verify: re-run the `rg` on the final
      tree. It returns only records and the archived change.
- [ ] 6.3 **Every operation has an inverse** (required task item 1). Name each, shipped or not,
      with its reason:
      - the probe cache's write against its `rm -f`: **shipped**;
      - the shim's `mkdtemp` against its removal: **shipped**, in 2.4;
      - raising the floor against lowering it: **not shipped**. The policy only moves the floor up.
        A lowered floor would claim support for an end-of-life Node;
      - emitting the warning against suppressing it: **not shipped**. It is one line, only below the
        floor. The remedy is upgrading Node, and a switch to hide it would hide an end-of-life
        runtime;
      - a matrix major added against one removed: **both computed**, by the same schedule filter;
      - `spawnAll`'s kill: no inverse applies. Say so.
- [ ] 6.4 **Verify against the commit, not the working tree** (required task item 2). For every task
      above, run `git show --stat <sha>`. Assert that every file the task claims to change is in
      THAT commit. Pay particular attention to:
      - 2.2's thirteen files;
      - 2.5's comment set;
      - 3.2's engine files and BOTH harnesses — `fixtures/harness.mjs` and
        `fixtures/unit-harness.mjs` (Gate 1 I7).
      Record in `commit-verification-6.4.txt`.
- [ ] 6.5 **Declare lifecycle bookkeeping** (required task item 3). The archive task, 9.2, carries
      `<!-- pm:lifecycle -->` on its task line. It was marked when this source was authored.
      `3256cc2`'s sync of 0.48.0's deltas is 0.48.0's bookkeeping, recorded as done in 0.4. It is
      not a task of this change's work.
- [ ] 6.6 **Attribute every commit to its epic** (required task item 4). Run
      `update-epic node-support-policy --attribute-commit <sha>` as each commit is made. It is NOT
      attributed for:
      - the commit that moves this change under `archive/`;
      - 2.6's machine cleanup, which is not a commit at all;
      - `3256cc2`, the 0.48.0 spec sync (task 0.4).
- [ ] 6.7 **Review the release's specs against each other** (required task item 5). This is 0.2,
      re-run after any amendment made at Gate 1 or at Gate 2. (0.4's sync, `3256cc2`, landed before 0.2
      runs, so 0.2 already reviews against the restored text.) The verdict must not
      render stale at archive time.
- [ ] 6.8 **End by recording a disposition** (required task item 6). 9.2 archives with
      `--outcome delivered` and either `--no-deferrals` or one `--deferral`/`--declined-deferral`
      per item actually deferred. Candidates to decide at that point:
      - widening `conductor-35`'s network set, if 3.3 declines it;
      - bounding the synchronous spawns D9 names;
      - the hook's `rm -f pm-isolation-flag` line's sunset: removed in 0.50.0 (design D3), recorded
        as `--deferral` against an epic registered for it, or declined with a reason.
      `store-owns-claude-md-managed-block` is NOT dispositioned by this change (design D10).
- [ ] 6.9 **Route what the work taught you** (required task item 7). Name each finding as one of
      three kinds before the change closes. Candidates carried in from drafting:
      - **FRICTION**: 0.48.0 was archived and its spec deltas never reached `openspec/specs/`, and
        nothing in pm's archive gate noticed. File it: `/pm:feedback bug "…"`, with the `rg` counts
        from design's Context.
      - **PROCESS**: three guards depended on the runner sharing one process, and nothing said so
        (design D3). Write a `docs/lessons/` file:
        - trigger: "before changing how a test runner isolates files, list every guard installed as
          a side effect of an import";
        - cost: 13 files unguarded and 3,501 leaked directories;
        - `enforced_in`: 2.1's walk.
        Check `docs/lessons/` for an existing lesson first.
      - **PRACTICE**: a CI matrix computed from an upstream schedule, with a committed fallback, an
        agreement check, and a per-commit tie to an engine constant. Decide whether this is an epic
        for pm's users, and register it with its evidence if so.
      - **FRICTION**: `openspec validate --strict` refuses a MODIFIED block that drops a scenario, so
        a requirement whose scenario became false had to be REMOVED and restated under a new name.
        Decide whether that is worth an upstream filing.

## 7. Docs

- [ ] 7.1 `CONTRIBUTING.md`.
      - Update the commands and prose at `:9-12`, `:53`, `:70`, `:89` ("Both rungs in one
        process"), `:92`, `:100`, `:103-105`, `:142` ("The assertion half is one Node process",
        Gate 1 I8) and `:239-241`.
      - `:103-105`'s "`--test-isolation=none` is not optional" becomes a note on
        `--test-concurrency` for throttling.
      - Re-measure the quickstart claim at `:82-85` (`v26.9.0`, 26.1 s) on the support-floor Node and on the
        machine's Node, by RUNNING the quickstart in a fresh clone.
      - The required-check description at `:8-12` names the aggregate and the matrix.
      Verify: every command in the file runs as written.
- [ ] 7.2 `README.md:51` and `:118` get the policy wording: "Node 22+ — pm supports the oldest Node
      LTS line that is not end-of-life". In the same commit, 4.2b's README support-floor assertion
      lands (it could not before, while the README said 18). `:51`'s "1,116 tests" is left to the release cut's Real Numbers
      recompute, and that is stated here so it is not mistaken for a miss. The change is
      user-facing, so the documentation-currency check is answered YES.
- [ ] 7.3 `CLAUDE.md`.
      - `:19-20`: "Node 18+ built-ins" becomes the policy wording, and the list becomes the derived
        seven (design D8): `node:child_process`, `node:crypto`, `node:fs`, `node:os`, `node:path`,
        `node:tty`, `node:url`.
      - `:27-38`: the `Tests:` bullet loses `--test-isolation=none` and "in ONE process". The
        property it keeps is that tests spawn nothing and run no git.
      - 4.2b's `CLAUDE.md:19` support-floor assertion lands in this commit.
      Verify: `rg -n 'isolation|Node 18' CLAUDE.md` returns nothing.
- [ ] 7.4 The repo skills.
      - `.claude/skills/pr-workflow/SKILL.md`:
        - `:22` and `:97`: the commands;
        - `:3` and `:8`: the `test` check is now an aggregate over the matrix legs.
      - `.claude/skills/release-checklist/SKILL.md`:
        - `:26`: the step-1 command, and `:27`'s "BOTH rungs of the assertion half, one process"
          (Gate 1 I8);
        - `:63-64`: the Real Numbers recipe, with `FORCE_COLOR=0` and `--test-reporter=spec`, the
          `grep` corrected to what it parses, and a STOP line after it (Gate 1 B1): if the
          `ℹ tests` line is missing or reads 0, stop — do not publish a number;
        - a NEW step at "Engine + tests": the support-floor check against `schedule.json` (design D1),
          naming the constant, `PM_NODE_FALLBACK`, the README line and the docs-site pages as one
          unit.
      Verify: `rg -n 'isolation' .claude/skills` returns nothing.
- [ ] 7.5 `CHANGELOG.md` gets an entry under `## [Unreleased]`:
      - Changed: support policy and floor; CI matrix; per-file mode, with 0.3's and 8.1's numbers;
        one reporter; actions v7.
      - Added: the brief warning.
      - Fixed: #220; the hook's skipped floor on an unreadable count; the shim's temp-dir leak.
      - Removed: the isolation probe and the Node-18 loop.
      The release cut folds it into `0.49.0`.
- [ ] 7.6 The docs site belongs to the release cut via `mintlify-doc-sync`, not to this change. Hand
      it this list, re-derived at the cut:
      - `installation.md` `:7`, `:9`, `:14`
      - `index.md` `:15`, `:107`
      - `introduction.md` `:64`
      - `llms.txt` `:7`
      - the Changelog page
      - Introduction's Real Numbers
      Verify: the list is carried into the release cut's checklist run.
- [ ] 7.7 Parity ledger. Confirm on the commits, not on intent: run
      `git diff --stat <base>..HEAD -- commands/ agents/ skills/ hooks/ .claude-plugin/`.
      - Expected: empty.
      - The plugin version bump belongs to the release cut.
      - `scripts/test/assert/parity.test.mjs` stays green.
- [ ] 7.8 **Close `docs/lessons/an-archive-writes-outside-the-change-dir.md`.** In
      `.claude/skills/release-checklist/SKILL.md`, the step that archives a change (today the skill
      names no archive step at all: `rg -n -i archive .claude/skills/release-checklist/SKILL.md`
      returns nothing, so the line lands where the release's changes are archived, beside the
      branch dance) must say, in these words: "stage openspec/ whole (or everything
      `git status --short openspec/` lists) — the archive rewrites openspec/specs too".
      In the SAME commit:
      - the lesson's `enforced_in:` (frontmatter, currently "Retrieval only, until 0.49.0's docs
        tasks add the staging line…") names the release-checklist step;
      - `docs/lessons/README.md`'s enforced-in row for this lesson (`:93`, currently "retrieval
        only, until 0.49.0 adds the staging line…") says the same. `:35`'s summary row carries no
        enforced-in text and is left as is.
      Verify: `rg -n 'stage openspec/ whole' .claude/skills/release-checklist/SKILL.md` returns one
      hit, and `rg -n 'until 0.49.0' docs/lessons/` returns nothing. This change's own archive (9.2)
      follows the new line.

## 8. The AFTER measurement

- [ ] 8.1 Re-run 0.3(a), (b) and (d) on the final commit. Write `baseline-after.md` beside
      `baseline-before.md`, with the hook's end-to-end wall clock (drift + lock + runner + floor)
      named at both ends.
      State design D10's outcome in one line: under 15 s, or not. Do NOT edit
      `store-owns-claude-md-managed-block`. The evidence goes in this file and in the CHANGELOG
      entry.
- [ ] 8.2 Each matrix leg's `test` duration and each bucket step's duration, from this change's PR
      run (`gh run view <id> --json jobs`), against 0.3(c). A leg slower than the Node-18 baseline
      is reported as slower with the number.
- [ ] 8.3 Per-file against single-process ON A CI RUNNER, where the parallel win is unmeasured.
      - Use a **DRAFT PR** into `main` from a throwaway branch whose `ci.yml` runs the half both ways
        (the same mechanism and the same no-new-trigger reason as 4.5). Never merged: afterwards close
        the draft PR (`gh pr close <n> --repo cfdude/pm`), DELETE the branch remote and local
        (`git push origin --delete <branch>`, `git branch -D <branch>`), and confirm
        `git ls-remote origin <branch>` returns nothing.
      - Node 24, the assertion half three times each way, `nproc` recorded.
      - Record in `baseline-after.md`.
      If per-file is slower there, say so. The decision to drop single-process stands (Rob,
      2026-09-24), and the number is recorded so the trade is known.

## 9. Close

- [ ] 9.1 **Gate 2**, mode `thorough`: two fresh-context lenses over the committed range.
      - Lens A: spec alignment and real tests. Every guard re-pointed in this change has been SEEN
        to fail on its mutation.
      - Lens B: absent edits:
        - a count site without the forced reporter;
        - a rung file without the shim;
        - a version claim left behind;
        - an inverse not shipped.
      Fix Critical and Important. Then record `record-gate-review node-support-policy --gate 2
      --verdict pass --reviewer "<identity>" --base-sha <parent of the first attributed commit>
      --head-sha <the last attributed commit>`.
- [ ] 9.2 <!-- pm:lifecycle --> Archive — run `/opsx:archive node-support-policy`, then
      `update-epic node-support-policy --status archived --outcome delivered --reason "pm supports
      the oldest non-EOL Node, CI proves it on every supported LTS line computed from the schedule,
      and the per-commit gate is one command on every supported major" --no-deferrals`. Replace
      `--no-deferrals` per 6.8 if anything was deferred. The move under `archive/` is not
      attributed. Stage `openspec/` WHOLE for the archive commit (7.8's rule: the archive rewrites
      `openspec/specs/` too). Afterwards, confirm `openspec list` no longer reports this change, and that
      `openspec/specs/runtime-support/spec.md` exists with its Purpose.
