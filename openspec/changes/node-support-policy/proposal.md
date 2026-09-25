# Proposal

## Why

pm states no support policy and tests the wrong Node. CI pins `node-version: "18"`
(`.github/workflows/ci.yml:33`). Node 18 reached end-of-life on 2025-04-30 and Node 20 on 2026-04-30
(nodejs/Release `schedule.json`, fetched 2026-09-24). The README still says "Node 18+"
(`README.md:51`, `:118`), and so do the engine header (`scripts/conductor.mjs:77`) and this repo's
`CLAUDE.md:19`. The actions CI runs on (`actions/checkout@v4`, `actions/setup-node@v4`,
`ci.yml:21`, `:31`) are also out of date. The current majors are `v7.0.1` and `v7.0.0`, and both
declare `using: node24` (`gh api repos/actions/{checkout,setup-node}/releases/latest`, 2026-09-24).

The per-commit suite also carries workarounds for Node versions pm will no longer support, and one
of them is now the slow path. Measured 2026-09-23 on 16 CPUs (clone `61a75a5`, n=3, median wall,
logs in the session scratchpad `node-bench/logs/assert-matrix.txt`):

| Node | process-per-file (`node --test`) | single process (`--test-isolation=none`) |
|---|---|---|
| 22.23.3 | 13.3 s | 27.2 s (`--experimental-test-isolation=none`; 22 has no `--test-isolation`) |
| 24.21.0 | 13.5 s | 27.4 s |
| 26.10.0 | 13.0 s | 24.2 s |

The hook forces single-process mode wherever it can (`.githooks/pre-commit:108-132`). That mode was
0.47.0's design (D5), and on every current Node it is about twice as slow as the runner's default.
The two runs report the same 1,269 tests, and all 1,269 pass in both modes.

Two more workarounds exist only for Node 18:
- the hook parses TWO summary formats (`ℹ` and `#`, `pre-commit:173-177`);
- a `[ -f ]` loop resolves the rung globs before the runner sees them (`pre-commit:160-169`), because
  Node 18 hard-errors on an unmatched literal pattern.

Both are measured unnecessary on 22, 24 and 26 (design D4 and D5).

## What Changes

- **A stated support policy, and one place it lives.** pm supports the oldest Node major that is not
  end-of-life, per `schedule.json`. Today that floor is **22** (EOL 2027-04-30); it becomes **24**
  after that date. 18 and 20 are dropped. The floor is ONE engine constant, updated at release time.
  The engine never fetches the schedule, and the architectural law that the engine opens no network
  connection is unchanged.
- **CI tests every supported LTS line, computed from the schedule rather than typed.**
  - A small job reads `schedule.json` at CI time. It keeps every major where
    `start <= today (UTC) < end` and the entry carries an `lts` key. Today that yields `[22, 24, 26]`.
  - If the fetch fails, the job uses a committed fallback list and prints a visible warning.
  - Whenever the fetch works, the fetched list must equal the committed list.
  - A per-commit test ties the fallback's minimum to the engine's floor constant.
  - Branch protection's required context `test` is kept by an aggregate job of that name.
  - The security workflows stay single-version.
- **BREAKING (contributors only): the single-process test mode is removed.** Both rungs of the
  assertion half run under node's default process-per-file isolation, in the hook and in CI.
  - Removed: the isolation probe, its `pm-isolation-flag` cache file, `$ISOFLAG`, and every line of
    documentation that mandates `--test-isolation=none`.
  - The discipline that a TEST spawns nothing and runs no git stays. The spawn guard and the unit
    rung's filesystem guard both stay. Only the RUNNER parallelizes.
  - Three guards silently weaken when the half stops sharing one process (design D3), and this
    change repairs them:
    - 13 file-rung files never install the git shim;
    - the G-I4 direct check becomes per-process;
    - the shim leaks one temp directory per process.
- **One reporter everywhere a count is read.** `--test-reporter=spec`, with `FORCE_COLOR=0`, is
  forced at the hook, all three CI bucket steps, `certify.mjs` and the release checklist's Real
  Numbers recipe. The `ℹ`/`#` dual parse is deleted.
  - A summary that cannot be parsed becomes a refusal. Today the hook skips its floor and reports
    success in that case (`pre-commit:214`, `:224`).
  - So does a run that reports zero tests.
- **The `[ -f ]` loop is deleted.** Node 22, 24 and 26 each run an unmatched pattern as zero files,
  verified on the real binaries. The empty-rung abort stays, keyed on a run that reports no tests.
- **An end-of-life warning in the SessionStart brief.** When the running Node's major is below the
  floor, `brief` prints ONE warning line. It is a warning, not a refusal. The running version is
  supplied through the invocation seam, so the unit rung tests both sides without an old Node.
- **CI actions bumped** to `actions/checkout@v7` and `actions/setup-node@v7`.
- **Every "Node 18+" claim corrected**, re-derived mechanically (design D8). The docs-site pages go
  to the release cut's Mintlify sync.
- **cfdude/pm#220 fixed.** `spawnAll`
  (`scripts/test/functional/state-file-refuses-to-guess.test.mjs:291`) awaits a child's `close` with
  no bound, so a hung child hangs the functional half forever; on Node 18 one hung for about 13 min.
  It gains a bound that kills the child and fails the test by name. Every sibling is swept.

## Capabilities

### New Capabilities

- `runtime-support`: covers three things:
  - which Node majors pm supports and where the floor lives;
  - that CI tests every supported LTS line, computed from Node's schedule with a committed fallback;
  - that the SessionStart brief warns when the running Node is below the floor.

### Modified Capabilities

- `suite-certification`:
  - MODIFIED: *"The suite has two halves with different triggers and different costs"*. A commit
    runs both rungs in one runner invocation, no longer "in one Node process".
  - REMOVED and restated as ADDED: *"The assertion half spawns no process and runs no git"* becomes
    *"No test in the assertion half spawns a process or runs git"*. The single-process sentence and
    its scenario go. The prohibition now binds the TESTS, not the runner. The run-time git counter is
    required in every process the runner starts. (A REMOVED plus an ADDED, not a MODIFIED:
    `openspec validate --strict` refuses a MODIFIED block that drops a scenario the main spec holds,
    and *"The assertion half runs in one process"* is exactly the scenario that must go. REMOVED
    plus ADDED under the SAME header is refused too. So the name changes, and task 6.2 re-points
    its three live citations.)
  - ADDED: every run the suite is counted from uses one reporter, and an unreadable or zero count
    refuses.
  - ADDED: a test that awaits a child process bounds the wait.
- `engine-invocation`: ADDED. The runtime version the engine consults is supplied per call, the
  same way as the store, the git gateway, the root and the streams.

## Impact

- **Engine source:**
  - a new leaf module `scripts/lib/runtime-support.mjs` (the floor constant and the warning line);
  - `scripts/lib/invocation.mjs` (a `nodeVersion` on the context, plus its accessor);
  - `scripts/conductor.mjs` (`io.nodeVersion` into the context, and the `:77` header);
  - `scripts/lib/subcommands.mjs` (`brief()`);
  - comments in `scripts/lib/constants.mjs:17`.
  Each is an engine-source edit, so each commit needs `certify sweeps`. `conductor.mjs` and
  `subcommands.mjs` are also certified modules, so those commits need `certify functional` too.
- **CLI contract:** unchanged. The same verbs, flags and exit statuses. `brief` prints one extra line
  only on a Node below the floor.
- **Repo tooling:**
  - `.githooks/pre-commit`
  - `.github/workflows/ci.yml`
  - `scripts/test/certify.mjs`
  - `scripts/test/fixtures/assert-git-shim.mjs`
  - 13 rung files gain one import each
  - the guards `assert/conductor-09`, `assert/ci-workflow` and `assert/assert-half-has-no-spawn`
  - `functional/conductor-09` and `functional/state-file-refuses-to-guess`, each with its twin
- **Docs:** `README.md`, `CLAUDE.md`, `CONTRIBUTING.md`, the `pr-workflow` and `release-checklist`
  skills, and `CHANGELOG.md`. The docs site is listed for the release cut.
- **Dependencies:** none, runtime or dev. **`state.json` schema:** untouched, so no migration.
- **Out of scope:** Rob's machine keeps Homebrew Node. It measured about 2× slower at engine cold
  start (107.7 ms against 49.9 ms for the nodejs.org 26.10 build, `coldstart.txt`), but he relies on
  Homebrew for other work. No machine configuration changes.
