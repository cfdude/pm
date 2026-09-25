# Design

## Context

See `proposal.md` (Why) for the motivation. This section keeps only the facts the decisions below
rest on. Each was measured or read on 2026-09-24 at `7b222be`, unless a line says otherwise.

**The benchmark behind decision 3** was run 2026-09-23 at clone `61a75a5`.
- The machine had 16 CPUs, darwin-arm64.
- The nodejs.org binaries sit under the session scratchpad at `node-bench/bin/node-v{20.20.2,22.23.3,24.21.0,26.10.0}-darwin-arm64/bin/node`.
- Per-run lines are in `node-bench/logs/assert-matrix.txt`, and raw logs in `node-bench/logs/assert-v*-{P,S}-{1,2,3}.log`.
- `P` is the runner's default process-per-file isolation. `S` is single-process: `--test-isolation=none`, or `--experimental-test-isolation=none` on 22, which refuses the unprefixed flag (`probe-v22.23.3--test-isolation=none.log`: `bad option`).

| Node | P runs (wall, s) | P median | S runs (wall, s) | S median |
|---|---|---|---|---|
| 22.23.3 | 13.742 / 13.270 / 13.246 | **13.270** | 28.142 / 26.809 / 27.151 | **27.151** |
| 24.21.0 | 15.195 / 13.405 / 13.450 | **13.450** | 28.400 / 27.418 / 21.487 | **27.418** |
| 26.10.0 | 14.092 / 12.880 / 13.007 | **13.007** | 24.159 / 21.212 / 26.593 | **24.159** |

Every one of the 18 runs reported `tests=1269 pass=1269 fail=0`. The per-file mode runs the same
tests and passes all of them. It is about half the wall clock on every current major. The bench
never measured a 2–4 core machine.

**CI today** (run `35722337413`, the push of `02ed32e` to `main`, Node 18, per-file isolation):

| Step | Duration |
|---|---|
| `test` job | 4 m 46 s (11:35:57 to 11:40:43 UTC) |
| Assertion half | 16 s |
| Functional half | 3 m 24 s |
| Sweep bucket | 51 s |

CI has never run the single-process mode. `ci.yml:88-98` records that decision, and its closing path
(`openspec/changes/unit-rung-and-fixture-snapshots/node-version-fallback-2.4.txt`, `:98`) dangles:
that change now lives under `archive/2026-09-22-…`.

**The required status check** on `main` is the single context `test`, read via
`gh api repos/cfdude/pm/branches/main/protection`: `"contexts":["test"]`, `strict: true`. A matrix
job reports as `test (22)`, `test (24)` and so on, so a bare matrix would leave every PR waiting on
a check that never reports.

**The main specs were stale, and were restored by `3256cc2`.** 0.48.0's archive rewrote
`openspec/specs/` but its commit (17a1225) staged only `openspec/changes`, and a later hard reset
discarded the spec edits (`docs/lessons/an-archive-writes-outside-the-change-dir.md`). `3256cc2` put
them back: `engine-invocation` +2 requirements (the store seam, CLI-store parity); `suite-certification`
+2 (fixture snapshots, rung membership by observable) and three blocks replaced with 0.48.0's text.
This change's deltas were re-checked against the RESTORED text from disk:
- `suite-certification` lines 11-147 are byte-identical to 0.48.0's archived delta, which is the text
  this change's MODIFIED *"two halves"* block was already written from. The block restates the current
  requirement with one change: "in one invocation of one Node process" becomes "in ONE invocation of
  the test runner", and one scenario is added. All three current scenarios are kept.
- The REMOVED header names the current requirement *"The assertion half spawns no process and runs no
  git"*, and the ADDED restatement carries all of its current scenarios except *"The assertion half
  runs in one process"*.
- No conflict with the two restored ADDED requirements. *"A fixture is built once per file and
  restored per test"* holds under per-file isolation: the template is per FILE, a file is one process,
  and the restore is unchanged (`fixture-snapshot.mjs:112`'s file-level `after()`; its leak test is
  in the 1,269/1,269 per-file runs). *"A rung's membership is decided by what a test observes"* says
  the unit rung's guard scans `scripts/test/unit/` only; that remains true of the FILESYSTEM guard,
  and this change's new shim-install walk is a separate check over both rungs, stated as such in the
  ADDED spawn requirement. *"Every tracked test file has exactly one home"* is untouched; its floor
  still enumerates the rungs the invocation was handed, and this change's count requirement adds only
  that an unreadable or zero count refuses.
- Separately, `openspec/changes/functional-assertion-test-split/` is still a live duplicate of its
  archived copy. That is 0.48.0 task 0.4's finding. This change neither repairs it nor depends on it.

## Goals / Non-Goals

**Goals.**
- One stated support floor, and one place in the engine that declares it.
- CI that proves pm on every supported LTS line, with a computed set that cannot silently come from
  nothing.
- A per-commit gate that is the same command on every supported major.
- A count that is read in one format everywhere, and refused when it cannot be read.
- No guard that silently weakens when the half stops sharing one process.

**Non-Goals.**
- Changing which tests exist, or which rung or half a test lives in.
- Making the functional half faster. It gains three parallel legs in CI, not a faster leg.
- Any engine behaviour on a supported Node. Below the floor there is exactly one extra brief line.
- Homebrew versus nodejs.org Node on the maintainer's machine (proposal, Out of scope).
- The `store-owns-claude-md-managed-block` epic. It is not touched here; D10 makes a recommendation
  about it.

## Decisions

### D1 — The support floor is one engine constant in a new leaf module, kept true by the release procedure

**Vocabulary.** "Support floor" is the lowest supported Node major. It is never shortened to
"floor" in this change's specs, because the suite already has a test-COUNT floor (the hook's
`declared` comparison), and both appear in the same tasks.

**Supported means tested (Gate 1 B3).** A major is supported exactly when its schedule entry
`has("lts")` and `start <= today < end` — the same filter CI's matrix uses (D2). The support floor is
the lowest member of that set. Every other major is unsupported, including odd majors above the
support floor (23, 25; 27 once it starts on 2027-04-22 with no `lts` key) and end-of-life ones (18,
20). The engine holds only the constant, not the schedule, so `brief` warns only BELOW the support
floor and says nothing about an unsupported major above it (runtime-support's third requirement).
An earlier draft defined support as "every major from the oldest non-EOL upward", which named 23, 25
and 27 supported while CI never tests them; that contradiction is removed.

`scripts/lib/runtime-support.mjs` (new) exports `NODE_FLOOR_MAJOR = 22` and one pure function that
turns a runtime version into the warning line or `null` (D6).

A leaf module rather than `constants.mjs`, for two reasons:
- `constants.mjs` is 1,600+ lines, and the floor is a policy value, not a path.
- The per-commit guard in D2 imports the constant from a file test code can load without the rest
  of the engine.

**Kept true by three mechanisms, and only one of them is prose:**
1. **Release procedure.** The `release-checklist` skill gains a step at "Engine + tests".
   - Fetch `schedule.json`.
   - Compute the oldest major with `end` after the release date.
   - If it differs from `NODE_FLOOR_MAJOR`, bump the constant, CI's fallback list (D2), the README
     requirement line and the docs-site pages in the same release.
2. **Per-commit test.** `assert/ci-workflow.test.mjs` asserts that the minimum of CI's committed
   fallback list equals `NODE_FLOOR_MAJOR`, and names both values when they differ.
3. **CI check.** CI asserts that the fetched set equals the committed fallback list (D2).
4. **Per-commit doc check (Gate 1 I10).** The support floor is also copied into prose:
   `README.md:51` and `:118` ("Node 18+" today, "Node 22+" after 7.2), and `CLAUDE.md:19`. A file-rung
   test (`assert/support-floor.test.mjs`, task 4.2b) reads each copy's `Node N+` and asserts
   `N === NODE_FLOOR_MAJOR`, naming the file and both values. `CONTRIBUTING.md` carries no support-floor
   number today (its `v26.9.0` is a measurement's Node, not a floor); if 7.1 adds one, the test
   covers it.

So schedule → fallback → constant is a chain of mechanical checks. A schedule event breaks the
first link in CI, and the fix cannot land without also moving the constant.

*Alternative considered:* a date table in the engine (major → end date), so the floor rolls over
without a release. Rejected, for two reasons. The brief says the floor is a constant updated at
release time. And it would make a verb's output depend on the wall clock, so the unit rung would
need a clock seam this change does not otherwise need.

### D2 — CI's matrix is computed from the schedule. On fetch failure: committed fallback, visible warning, and an agreement check

**The shape** (`ci.yml`):
- **`node-majors`** (new) computes the set.
  - `curl -fsSL --retry 3 --max-time 30` fetches
    `https://raw.githubusercontent.com/nodejs/Release/main/schedule.json` to a file; the fetch is the
    ONLY network step and stays in the workflow.
  - **The filter is a committed dev script, not inline `jq` (Gate 1 B5):** `scripts/test/node-majors.mjs`,
    plain Node, no dependency. It takes the schedule file (or the fact that the fetch failed), today's
    UTC date (`date -u +%F`), and `$PM_NODE_FALLBACK`, and it owns every decision in the table below.
    The workflow runs it under `actions/setup-node@v7` with `node-version-file` unset and
    `node-version: ${{ fromJSON(env.PM_NODE_FALLBACK)[0] }}` — the support floor, so the script runs on
    a supported Node.
  - *Why that home.* `scripts/test/` already holds the repository's dev-only, non-test scripts
    (`drift.mjs`, `certify.mjs`, `certification.mjs`); it is not shipped (the parity ledger walks
    `commands/`, `agents/`, `skills/`, `hooks/`, `.claude-plugin/`), and `ci.yml:72`'s syntax loop
    already covers `scripts/test/*.mjs`. It is not a `*.test.mjs` file, so the enrolment rule (every
    TRACKED TEST FILE has one home) does not reach it; its test does, and lives on the file rung.
    `scripts/ci/` was considered and rejected: a new top-level directory for one file, outside the
    syntax loop until someone remembers to add it.
  - *Why a script.* Inline `jq` could not be falsified: on 2026-09-24's data, deleting the start
    clause OR the `lts` clause still yields `[22,24,26]` (27 is excluded by `lts` as well as by start;
    25 by `end` as well as by `lts`), and nothing could assert the step read `$PM_NODE_FALLBACK`. The
    script exports its pure functions, and `assert/support-floor.test.mjs` runs them against a CANNED
    schedule with a future-start `lts` entry, a live entry with no `lts`, and a live entry whose
    `lts` date is still in the future — each condition deciding one entry on its own.
  - Verified 2026-09-24 against the live file: the filter yields `[22,24,26]` (18, 20 past `end`;
    25 no `lts`; 26 `"lts": "2026-10-28"`, a future date, included).
  - The job outputs the array.
- **`test-node`** (renamed from `test`) is `name: test (node ${{ matrix.node }})`.
  - `needs: node-majors`.
  - `strategy.fail-fast: false`.
  - `matrix.node: ${{ fromJSON(needs.node-majors.outputs.majors) }}`.
  - `timeout-minutes` set, as the backstop to D9.
  - Its steps are today's `test` steps.
- **`test`** (new aggregate) keeps the required context's name.
  - `if: always()`.
  - `needs: [node-majors, test-node]`.
  - One step exits 1 unless `needs.node-majors.result == 'success'` AND
    `needs.test-node.result == 'success'`.
  - `always()` is load-bearing. A job whose `needs` failed is SKIPPED, and GitHub treats a skipped
    required check as passing. Without `always()`, a failed compute job would skip every leg and
    the aggregate, and the PR would merge green.

**Fetch-failure mode: option (b).** The committed fallback lives as a workflow-level `env` value in
`ci.yml`: `PM_NODE_FALLBACK: "[22,24,26]"`, one place, readable by the per-commit guard.

| Situation | What CI does |
|---|---|
| Fetch fails (`curl` non-zero) | The job uses the fallback. It prints `::warning::` naming the fallback and appends the same line to `$GITHUB_STEP_SUMMARY`, so the run page says the matrix was not computed. |
| Fetch succeeds, body is not a readable schedule (malformed JSON, or no entry with `start`/`end`) | `::error::` naming the schedule as unreadable, exit 1. It does NOT fall back: the fallback covers an unreachable host, and a readable-looking failure silently becoming the fallback is the "computed from nothing" this design exists to stop. |
| Fetch works | The computed array must equal the fallback. If not: `::error::`, naming both, and exit 1. |
| Either way | An empty array is `::error::` and exit 1. |

**The agreement check runs only when CI runs** — on `push` to `main` and `pull_request` into `main`.
There is no `schedule:` trigger, so a schedule event is noticed at the next PR, not on its date. That
is accepted: the release checklist's step (D1) is the earlier notice, and a nightly run that turns
`main` red with no PR open would page no one.

*Why (b) over (a), failing loudly on a failed fetch:*
- (a) makes a required check depend on a third-party host's availability. An outage of
  `raw.githubusercontent.com` would turn every PR red with no code reason and no local remedy.
- (b) keeps CI deterministic under an outage. The warning keeps the outage visible, so it is not a
  silent fallback.
- The agreement check means the fallback cannot rot unnoticed, because any run with a working fetch
  proves it current.
- (b) is also what gives D1 its mechanical link. With (a) there is no committed list, and nothing
  per-commit can tie the engine's constant to anything.

**The cost of (b), stated rather than discovered.** The per-commit test ties the fallback's minimum
to `NODE_FLOOR_MAJOR`. So on the day a line reaches end-of-life, the required check goes red on
every run until one commit fixes it:
- The next such day is 2027-04-30, when the fetched set becomes `[24,26]`.
- The fixing commit moves the fallback to `[24,26]` and the constant to 24.
- That commit is user-facing, so it is a release.

The schedule publishes these dates years ahead, so the release checklist can see one coming. It is
still a real trade: a strict agreement check buys a list that cannot rot, at the price of a
scheduled red day. The alternative, disagreement as a warning, keeps CI green and lets the list go
stale in silence. **Decided (coordinator, 2026-09-24): disagreement FAILS CI.** It is the mechanism
that makes the floor move, and the fix is a small release.

**Exercising the fallback and mismatch paths** (task 4.5) and the CI-runner timing (task 8.3) run
through a DRAFT PR into `main` from a throwaway branch: `ci.yml` already triggers on `pull_request`
into `main`, so no `workflow_dispatch` trigger is added to the shipped workflow for a one-off. The
draft PR is closed unmerged and the branch deleted, remote and local, afterwards.

**The 404 run's commit, and the guard that pins the URL (Gate 1 I4): option (b).** The throwaway
commit edits BOTH the schedule URL in `ci.yml` AND the URL `ci-workflow.test.mjs` pins, in the same
commit, so the hook passes without `--no-verify`; the branch is never merged, so the edited guard
never reaches `main`. Option (a), an overridable URL, was rejected: it adds a shipped knob whose only
caller is a one-off test, and a knob that can repoint CI's matrix source is a surface the guard could
then no longer pin. The mismatch run needs no guard edit: a fallback of `[22,24]` keeps its minimum
equal to the support floor.

**Security workflows stay single-version.** `security.yml` calls two reusable org workflows pinned
by SHA and runs no `setup-node`. It is untouched.

### D3 — Per-file isolation everywhere; the single-process assumptions are found and each one is answered

**The change.**
- The hook's runner line and CI's assertion step both become the runner's default isolation.
- Deleted from the hook: the probe (`.githooks/pre-commit:108-131`), the cache file
  `$(git rev-parse --git-common-dir)/pm-isolation-flag` (`:117`) and `$ISOFLAG` (`:132`).
- The runner parallelizes up to its default concurrency. The tests do not change.

**The stale cache file is an inverse.** The probe WROTE `pm-isolation-flag` into every existing
clone's git dir. The hook runs `rm -f` on it on every run (idempotent), which is the inverse of the write. It is not left
inert, because an untracked file whose only writer is gone reads as a live mechanism to the next
person who finds it.

**Its sunset (POLISH).** The `rm -f` line is itself legacy: it has work to do only in a clone that ran
a pre-0.49.0 hook. It is removed in the first release after 0.49.0 (0.50.0), recorded as a deferral
at archive (task 6.8), by which time every contributor clone has run the 0.49.0 hook at least once.

**Every place the half assumed one shared process**, derived from:
- `rg -n -i 'isolation|single process|one process|same process|shared process|process-wide|singleton' scripts/test scripts/lib`;
- the imports of every rung file;
- reading each hit.

**No test breaks:** the 18 benchmark runs pass 1,269/1,269 per-file. What changes is whether three
guards still guard.

| # | Where | Assumption | Per-file consequence | Answer |
|---|---|---|---|---|
| 1 | `fixtures/assert-git-shim.mjs:54` (PATH shadow), installed via `assert-harness.mjs:20` / `unit-harness.mjs:28` | The shim installed by ANY file covers EVERY later file in the shared process. The hook hands `unit/` first, and every unit file imports `unit-harness`. | **13 file-rung files import neither harness nor shim** and would run with the real `git` reachable and nothing counting: `ci-workflow`, `conductor-29`, `conductor-37`, `drift-script`, `engine-resolution`, `git-gateway-guard`, `hermetic-git`, `hooks-schema`, `lessons-index`, `no-inline-exit`, `outcome-vocabulary`, `parity`, `store-ownership` (derived by listing every `unit/` and `assert/` file whose imports name none of `assert-harness`, `unit-harness`, `assert-git-shim`). | Each rung file installs the shim itself (one `import "../fixtures/assert-git-shim.mjs"` in the 13). `assert-half-has-no-spawn`'s source walk refuses a rung file that installs it neither directly nor through one of the two harnesses, naming the file. |
| 2 | `assert/assert-half-has-no-spawn.test.mjs:149-168` (G-I4), comment `:158-159` | Its direct `gitSpawns()` read sees "the half up to this point", and the exit listener "makes this hold for the files that run AFTER this one". | The read sees ONE process, its own file. The property is carried entirely by each process's exit listener. | Re-scoped, not deleted. The listener already fails its own file: verified on 22/24/26 that a file whose exit listener sets `exitCode = 1` is reported `✖ <file> … 'test failed'` and the run exits 1. The test's text and comment say that the per-process listener is the mechanism, and the direct read asserts the shim is first on PATH in THIS process. |
| 3 | `fixtures/assert-git-shim.mjs:39` (`mkdtempSync`), `:64-74` (listener) | One process, one temp dir; nothing removes it. | One directory per shim-installing PROCESS. With #1's fix that is every rung file, about 137 per run. `pm-assert-no-git-*` directories in `os.tmpdir()`: 3,501 at drafting, **4,041** at the Gate 1 fix round (2026-09-24). | The exit listener removes `shimDir` after reading the log. A file-rung test exercises the removal function on a scratch directory. |
| 3b | `fixtures/harness.mjs:36` (`EMPTY_CACHE = fs.mkdtempSync(…"pm-empty-cache-")`) — Gate 1 I6 | The same shape: "one empty version cache for the whole process", never removed. | One directory per harness-importing process — measured by the reviewer at 123 per per-file run. **6,877** `pm-empty-cache-*` directories sat in `os.tmpdir()` at the fix round. | Removed at process exit the same way as the shim's (task 2.4b), through the same exported removal function. |
| 4 | `scripts/lib/invocation.mjs:10-13`, `:20-21`, `:67-68` | "the assertion half is a SINGLE process running tests in sequence"; "a stack of one". | Still true PER PROCESS: tests within one file run sequentially. | Comment corrected: the rationale is "an in-process caller may serve many invocations", not the runner mode. Engine source, so the commit needs `certify sweeps`. |
| 5 | `scripts/lib/constants.mjs:14-19` | Per-call roots are "mechanical" because every file shares one process. | Still required: one file still drives several roots in one process (`conformance`, `per-call-roots`, `conductor-12`). | Comment corrected. Engine source, so `certify sweeps`. |
| 6 | `fixtures/helpers.mjs:72-74` (`injectConflictOnce`) | "every file shares [`fs`] under `--test-isolation=none`". | `fs` is still shared by every test in a FILE, so the restore is still required. | Comment corrected; the restore stays. |
| 7 | `fixtures/fs-work-counter.mjs:59` | "the rung runs in one process, sequentially". | Holds per process. Install is idempotent per process (`:85`), and engine modules read `fs` by property at call time, so install order within a file does not matter. | Comment corrected. |
| 8 | `assert/no-inline-exit.test.mjs:8-10`, `:128` | A stray exit "takes every remaining test file down". | It takes down one FILE's remaining tests, and the floor then fires on the shortfall. The rule itself is engine-invocation's (an in-process refusal returns a status) and stands. | Rationale reworded; the guard is unchanged. |
| 9 | `fixtures/fixture-snapshot.mjs:112` (file-level `after()`), `:72` (process-exit backstop) | None that breaks: a file-level hook fires at the file's end in either mode. | Holds. The 1,269/1,269 per-file runs include `fixture-snapshot.test.mjs`'s leak test. | No change. |
| 10 | Prose: `assert-half-has-no-spawn.test.mjs:5-7`, `:143`, `:166`, `:208` (a test TITLE, "lives in one process with the half"); `assert/per-call-roots.test.mjs:11`; `certification.mjs:107`; `assert/delivered-obligations.test.mjs:26`; `.githooks/pre-commit:32-34`, `:48-50` | Wording only. | None. | Reworded. The title change at `:208` is a test-name edit, stated so it is not mistaken for a new test. |
| 11 | Prose the first sweep missed (Gate 1 I8), each with its owning task: `scripts/lib/command-exit.mjs:46-47` and `scripts/lib/git-gateway.mjs:5` (2.5); `fixtures/assert-git-shim.mjs:17-19`, `:23-26` (2.4); `assert/conductor-09.test.mjs:94-128`, including `:120`'s wrapped "Node 18 REFUSES" (1.4); `.githooks/pre-commit:173-175` (1.2); `.claude/skills/release-checklist/SKILL.md:27` and `CONTRIBUTING.md:89`, `:142` (7.4, 7.1) | Wording only. | None. | Reworded by the named task. The first sweep's `rg` is line-based and missed text that wraps; D8's sweep is now multiline. |

**Unit rung and shim, stated so the two rules are not read as colliding (Gate 1 B7).** The shim is
installed at IMPORT time by a harness and removes its directory at process EXIT. Neither is inside a
test's window, which is the only time `fs-work-counter.mjs` watches (`armFsCounter`/`disarmFsCounter`
around each `unitTest`), and the unit rung's source scan reads the test file's own code, never the
harness it imports. So a unit-rung file installing the shim through `unit-harness.mjs` does no
filesystem work in the sense the unit rung forbids.

**The cross-worktree suite lock stays** (`pre-commit:55-75`). Per-file mode puts more load on the
machine per run, not less: up to CPUs−1 workers. The lock exists because overlapping runs once
wedged the machine.

### D4 — One reporter, no colour, one parse; an unreadable or zero count refuses

**Verified on the real binaries** (paths under the session scratchpad, darwin-arm64):
- `node-bench/bin/node-v22.23.3-darwin-arm64/bin/node`
- `node-bench/bin/node-v24.21.0-darwin-arm64/bin/node`
- `node-bench/bin/node-v26.10.0-darwin-arm64/bin/node`

Each was given the same two passing files and the same one failing file, with output to a file
(non-TTY). Scratch in `propose-049/rep/`.

- **Default reporter differs.** 22 prints TAP (`# tests 3`); 24 and 26 print spec (`ℹ tests 3`).
  This is why the dual parse exists.
- **With `--test-reporter=spec`, the summary is identical on all three.** The 8-line summary
  hashes to `ee9e258d6493508de20a8489c96429f810955a30` on each once `duration_ms` is normalized.
  A failing run reads `ℹ tests 3` / `ℹ pass 2` / `ℹ fail 1` on each, exit 1.
- **Colour breaks the anchor.** Under `FORCE_COLOR=1` every summary line begins `ESC[34mℹ`, and
  `^ℹ tests ` matches NOTHING on all three.
- **`NO_COLOR=1` does not rescue it.** `FORCE_COLOR` wins over it.
- **`FORCE_COLOR=0` restores the anchor** on all three.

So every count site runs `FORCE_COLOR=0 node --test --test-reporter=spec …` and parses `^ℹ (tests|pass) ` only:
- the hook's runner;
- `ci.yml`'s three bucket steps;
- `certify.mjs:62`, via `spawnSync`'s `env` and argv;
- the release checklist's Real Numbers recipe.

The `(ℹ|#)` alternation is deleted at `pre-commit:176-177`, `ci.yml:106/:123/:140` and
`certify.mjs:65`. These checks were darwin-arm64. The reporter is JavaScript inside node core, so
there is no platform branch to expect. The first CI run's per-leg `ran N, declared N` lines are the
linux confirmation, and task 8.2 records them.

**The latent defect this exposes.** Today the hook runs its floor only when `total` parsed
(`pre-commit:214`: `[ -n "$total" ] && …`), and otherwise prints "tests passing (summary line not
found)" and exits 0 (`:223-224`). Any colour-forcing environment therefore disables the floor
silently. CI's steps already refuse an empty `total` (`ci.yml:109`); the hook does not. It becomes an
ABORT, and so does `total = 0` (D5). `certify.mjs` records nothing when its counts are `null` or 0.

**CI can pass a bucket that ran zero tests (Gate 1 B1).** Each CI bucket step's check is
`[ -z "$total" ] || [ "$total" -lt "$declared" ]` (`ci.yml:109`, `:126`, `:143`), which is green at
`0/0` — the reviewer measured it on Node 24. Each step therefore gains
`[ "$total" -eq 0 ]` → `::error::` naming the bucket, `exit 1`, independent of `declared`. The
release checklist's Real Numbers recipe is a `| grep` pipe with no refusal at all; it gains a stop
line: if the `ℹ tests` line is missing or reads 0, stop and do not publish a number. So every count
site both FORCES the format and REFUSES an unreadable or zero count — task 6.1(a) checks both.

**The pipeline guard must see the new shape (Gate 1 I5).** `ci-workflow.test.mjs:86` and `:97`
refuse `total=$(node --test …|…)`, and neither pattern matches `total=$(FORCE_COLOR=0 node --test …|…)`,
so the exact regression G-C1 exists for would slip past with an env prefix. Both patterns accept any
`NAME=value` prefixes before `node --test`, and a mutation with that shape is added (task 4.2/4.3).

### D5 — The `[ -f ]` loop is deleted; the empty-rung abort is re-keyed to the count

**Verified on the real binaries** with a pattern that matches nothing, passed literally the way
`/bin/sh` passes it:

| Node | Unmatched literal + one real file | Unmatched literal alone |
|---|---|---|
| 20.20.2 | `Could not find '…/nope/*.test.mjs'`, exit 1 | same |
| 22.23.3 | `ℹ tests 2`, exit 0 | `ℹ tests 0`, exit 0 — the runner does NOT fall back to default discovery, because it was given a path |
| 24.21.0 | same as 22 | same as 22 |
| 26.10.0 | same as 22 | same as 22 |

Node 22+ expands a `--test` glob itself. A directory holding only a dotfile test (`d/.hidden.test.mjs`)
matches nothing under node's glob on 22, 24 and 26, exactly as under `sh`. So G-I1's fixture — a
dotfile declared by the index and unreachable by the glob — still fires the floor.

**Every floor version tolerates an unmatched pattern, so the loop (`pre-commit:160-169`) goes.** The
runner line carries the two globs literally. The argument list therefore can never be empty, and the
default-discovery hazard the abort was written for cannot be reached through it.

**The empty-rung abort stays, re-keyed, and ordered AFTER the count floor (Gate 1 B6).** The hook
checks, in order:
1. no parseable summary → ABORT, "the count could not be read" (D4);
2. `total < declared` → the existing shortfall ABORT naming both counts — this includes `total = 0`
   while the index still declares tests, which is a COLLAPSED run, not an empty rung;
3. `declared = 0` (and so `total = 0`) → ABORT, "neither rung of the assertion half holds a
   *.test.mjs file".
The first draft printed the empty-rung message whenever `total` was 0, which would have reported a
collapsed run as an empty one. One rung matching nothing while the other matches is NOT a refusal:
the other rung runs and the floor compares (suite-certification's new scenario).

**Guards to re-point, each with a mutation proof in a scratch copy of the hook** (see tasks):
- `assert/conductor-09.test.mjs:129` `RUNNER_LINE` equality;
- `:134-143`, the "two node --test lines, one is the probe" count, which becomes exactly one;
- `:130` and `:147-157`, the enumeration line, which is gone;
- `:162-166`, `[ -z "$RUNG_FILES" ]` and its message, which become the zero-count abort's text;
- `functional/conductor-09.test.mjs:411-450` stays as a regression guard. An unresolved glob must
  still never fail the commit. Its Node-18 narrative becomes history, and it now asserts the property
  on the running major.

### D6 — The warning is `brief`'s, and only `brief`'s; the version comes through the invocation

**Which surface.**
- **`brief` IS the SessionStart hook** (`hooks/hooks.json`: SessionStart → `conductor.mjs brief`;
  `verb-effects.mjs:45`: "prints the SessionStart additionalContext JSON"). It is the one surface
  that reaches a session.
- **The rendered project document is excluded.** `buildBrief()` is also embedded in `PROJECT.md` by
  `render.mjs:302`, a tracked file. A line built there would write one machine's Node version into
  every contributor's diff.
- **The PreCompact snapshot is excluded.** `snapshot` (the PreCompact hook) writes `.conductor/brief.txt`,
  which "NOTHING reads back" (`subcommands.mjs:147-153`), so a line there reaches no one.
- **So the line is built in `brief()` itself** (`subcommands.mjs:129-137`). It is prepended to the
  `additionalContext` string ahead of `buildBrief()`'s output, at the top for the reason
  `briefing.mjs:88-92` gives for the currency lines.

**Other rules for the line.**
- Dormancy is unchanged: `brief()` returns before it when the repo is not initialized.
- It is not written to stderr: a SessionStart hook's stderr does not reach the session.

**The seam.**
- The invocation context gains `nodeVersion`:
  - `runInvocation()` (`conductor.mjs:188-211`) sets `nodeVersion: io.nodeVersion ?? process.version`;
  - `PROCESS_CONTEXT` (`invocation.mjs:41-51`) gains a live getter returning `process.version`;
  - a `runtimeVersion(ctx = invocation())` accessor follows `currentEnv`'s shape.
- No engine module reads `process.version` today (`rg -n 'process\.version' scripts` returns
  nothing). After this change exactly two do, both context defaults: `PROCESS_CONTEXT`'s getter and `runInvocation`'s `io.nodeVersion ?? process.version`.
- **Every writer of the field is named (Gate 1 I7).** `fixtures/harness.mjs`'s `invokeEngine`
  (`:60`) passes `io.nodeVersion` through, AND `fixtures/unit-harness.mjs`'s `memoryEngine`
  (`:65-67`), whose `result()` today forwards only `{ cwd, store, env, input }`, gains `nodeVersion`
  — without it every unit test would silently run under the process's own version. Task 3.2 edits
  both, and 6.4 checks both are in its commit.
- **Contexts built without the entry point fall back (POLISH).** Several tests install a context
  directly with `setInvocation({ … })` and no `nodeVersion` — `assert/gate-artifact-evidence.test.mjs:32`,
  `assert/delivered-obligations.test.mjs:31`, `fixtures/assert-harness.mjs:42`,
  `functional/per-call-roots.test.mjs:116`. `runtimeVersion(ctx)` therefore returns
  `ctx.nodeVersion ?? process.version`, so such a context behaves like the process, which is what the
  engine-invocation requirement states for "a context installed directly".
- **The "no supplied version" scenario is made falsifiable (Gate 1 B2).** An absent value would also
  produce no line on a supported Node, so "no line" proves nothing. The unit test instead hands
  `memoryEngine` a store whose read records `runtimeVersion()` at the moment `brief` loads the record,
  and asserts it equals `process.version`. The command-line path is a functional test
  (`functional/runtime-support.test.mjs`, twin `unit/runtime-support.test.mjs`): it spawns
  `node --import <preload> scripts/conductor.mjs brief --platform claude-code` in an initialized repo,
  where the preload redefines `process.version` to `v20.20.2` — verified: `process.version` is
  `configurable: true`, and `node --import` of a one-line `Object.defineProperty` preload prints
  `v20.20.2` — and asserts the warning line appears; without the preload it asserts none.

**The stdout exception, stated (POLISH).** `engine-invocation`'s main requirement *"The command-line
binary's observable behaviour is unchanged"* promises the same bytes on stdout. `brief`'s one line
below the support floor is the single exception, and the new engine-invocation requirement names it,
so the two do not silently disagree.

**Not a MODIFIED of "Every global the engine reads is supplied per call" (POLISH, declined).** That
fold is possible, but 0.48.0 made the same call for the store and chose an ADDED requirement so the
existing requirement's scenarios stay true unchanged (0.48.0 proposal, *engine-invocation*). This
change follows that precedent; the ADDED requirement cites the same rule by name.

**The line.**
- `⚠ Node <v> is below pm's support floor (Node <N>, the oldest supported LTS line) — pm still runs, but this Node no longer receives security fixes; upgrade it.`
- `<v>` passes through `escapeControls` (`constants.mjs:1081`), because the output-integrity sweep
  refuses an unescaped caller-supplied interpolation.
- Whether `<N>` (a module constant) needs escaping or a judgment is the sweep's call at
  implementation.
- A version whose major cannot be parsed (`/^v?(\d+)\./`) yields `null`, so no line: "cannot tell" is
  not "below", the rule `tool-currency.mjs` already follows.

**Spec ownership, deliberately split so nothing is owned twice:**
- `engine-invocation` owns ONLY that the version is a per-call value;
- `runtime-support` owns what is done with it.

### D7 — Actions move to their current majors

Verified with `gh api repos/actions/{checkout,setup-node}/releases/latest` and each repo's
`action.yml`:

| Action | Latest release | Published | Runtime |
|---|---|---|---|
| `actions/checkout` | `v7.0.1` | 2026-07-20 | `using: node24` |
| `actions/setup-node` | `v7.0.0` | 2026-07-14 | `using: 'node24'` |

`@v4` runs on the node20 action runtime, which is itself past end-of-life. The bump is to the
floating major tags (`@v7`), the same form as today's `@v4`.

Before bumping, task 4.1 reads both actions' v5, v6 and v7 release notes and records every changed
default. `fetch-depth: 0` (`ci.yml:28`) is load-bearing for the integrity tests and must survive the
bump.

### D8 — Every stale version claim, re-derived rather than trusted

The inventory table in the brief was not trusted. It was re-derived with the line-based `rg`
below — which MISSES text that wraps across a line break (Gate 1 I8 found `assert/conductor-09.test.mjs:120`'s
"Node\n18 REFUSES" that way). The sweep at 6.1(f) therefore runs it again with `-U` and `\s+` in
place of each literal space (`node\s*1[0-9]`, `test-\s*isolation`), and D3 row 11 lists the wrapped
sites found by reading:

```
rg -n -i --hidden 'node ?1[0-9]\b|node 18|node18|node-version|test-isolation|v1[0-9]\.[0-9]+\.[0-9]+|v2[0-9]\.[0-9]+\.[0-9]+' \
  --glob '!openspec/changes/**' --glob '!.conductor/**' --glob '!.git/**' --glob '!CHANGELOG.md' \
  --glob '!docs/superpowers/**' --glob '!scripts/test/fixtures/*.json' --glob '!PROJECT.md' \
  --glob '!docs/reviews/**' --glob '!docs/feedback/**' --glob '!evals/.edd/**'
```

Excluded as RECORDS, which are not rewritten:
- archived changes, `CHANGELOG.md` history, the conductor record, review and feedback documents,
  fixture JSON;
- `docs/lessons/worktrees-with-claude-agents.md:17`, which records a past incident.

| File | Lines | Disposal |
|---|---|---|
| `README.md` | `:51`, `:118` | "Node 18+" becomes the policy wording. `:51`'s "1,116 tests" is also stale; the release cut's Real Numbers recompute owns that number, not this change. |
| `CLAUDE.md` | `:19-20` | "Node 18+ built-ins" becomes "supported-Node built-ins", and the list is re-derived (below). |
| `CLAUDE.md` | `:27-38` | The `Tests:` bullet's mandated `--test-isolation=none` command goes. |
| `scripts/conductor.mjs` | `:77` | Header "Node 18+" (engine source: `certify sweeps` and `certify functional`). |
| `scripts/lib/invocation.mjs` | `:11` | D3 row 4 |
| `scripts/lib/constants.mjs` | `:17` | D3 row 5 |
| `scripts/test/certify.mjs` | `:57-59` | Comment naming "the CI runner's Node 18" |
| `.github/workflows/ci.yml` | `:33`, `:88-98` | The pin; the comment block, including the dangling path at `:98` |
| `.githooks/pre-commit` | `:32-34`, `:48-50`, `:108-131`, `:134-169`, `:173-177` | D3, D4, D5 |
| `CONTRIBUTING.md` | `:9-12`, `:53`, `:70`, `:82-85` (the `v26.9.0` / 26.1 s quickstart claim), `:92`, `:100`, `:103-105`, `:239-241` | Commands and prose |
| `.claude/skills/pr-workflow/SKILL.md` | `:22`, `:97` | Commands; plus the required-check wording at `:3` and `:8` — the check is now an aggregate |
| `.claude/skills/release-checklist/SKILL.md` | `:26`, `:63-64` | The step-1 command; the Real Numbers recipe (D4). Gains D1's floor step. |
| `scripts/test/**` | `assert/conductor-09.test.mjs:106-111`, `:159`; `functional/conductor-09.test.mjs:411-450`; `assert/no-inline-exit.test.mjs:9`; `assert/per-call-roots.test.mjs:11`; `fixtures/assert-git-shim.mjs:19`; `fixtures/helpers.mjs:74` | D3, D5 |

**The engine's built-in set is re-derived, not patched by two names.** It was derived with
`rg -o --no-filename 'from "node:[a-z_/]+"|import\("node:[a-z_/]+"\)' scripts/conductor.mjs scripts/lib/*.mjs | sort | uniq -c`:

| Built-in | Import sites |
|---|---|
| `node:child_process` | 3 |
| `node:crypto` | 2: `store.mjs:64`, `cross-spec-review.mjs:20` |
| `node:fs` | 23 |
| `node:os` | 2 |
| `node:path` | 21 |
| `node:tty` | 1: `invocation.mjs:29` |
| `node:url` | 2 |

`CLAUDE.md:20` names five of the seven. It omits `node:crypto` and `node:tty`.

**The docs site is the release cut's**, via `mintlify-doc-sync`. From the inventory, re-derived at the
cut:
- `installation.md` `:7`, `:9`, `:14`
- `index.md` `:15`, `:107`
- `introduction.md` `:64`
- `llms.txt` `:7`

### D9 — #220: the unbounded wait gets a bound, and the class gets a source guard

**`spawnAll`** (`functional/state-file-refuses-to-guess.test.mjs:291-301`) resolves only on `close`
(`:299`). The fix:
- A 30 s timer per child — the bound `verb-surface.test.mjs:611` already uses for the same shape —
  `SIGKILL`s the child and resolves `{ timedOut: true }`.
- The callers assert `timedOut` is false, with a message naming the child's argv and the bound.

**The requirement is narrowed to ASYNCHRONOUS waits (Gate 1 B4).** The first draft covered every
child and every wait; the reviewer counted 39 of 43 test files with synchronous spawns carrying no
`timeout`, so that requirement would have been false the day it was archived. It now binds a test
that waits on a child's `close` or `exit` EVENT. Synchronous spawns are declared out of scope in the
requirement itself, bounded in CI by the job's `timeout-minutes`.

**The sibling sweep, mechanical:** `rg -n 'on\("close"' scripts/test` returns exactly two sites.
- `state-file-refuses-to-guess.test.mjs:299` — unbounded, fixed here.
- `verb-surface.test.mjs:612` — already bounded (`:611`, 30 s, `SIGKILL`).

`rg -n '(?<![\w.])spawn\(' -P scripts/test` finds one async `spawn` besides it: `:293`, the same
helper.

**Synchronous spawns without a `timeout` are a different class.** A hung `spawnSync` blocks one test
file's process, not an awaited promise. The sweep NAMES that class rather than fixing it here:
- `certify.mjs:62` is one — a full functional run legitimately takes minutes;
- CI's new `timeout-minutes` bounds all of them there.

**The guard lives in the twin**, which the drift script's diff coupling requires to be staged with
the functional file anyway. `assert/state-file-refuses-to-guess.test.mjs` gains a file-rung source
scan:
- It covers every wait on a child's `"close"` or `"exit"` under `scripts/test/**/*.mjs`, in all three
  forms: `.on("close"|"exit", …)`, `.once("close"|"exit", …)`, and the events module's
  `once(child, "close"|"exit")` promise form (bare or `events.once`).
- Each such site must sit in a function that also arms a timer which kills the child.
- It is exercised against an unbounded sample of EACH form, all refused, and a bounded one, which is
  not.
- Its search tokens and samples are built from parts, so the scan does not refuse its own source.

It reads files and spawns nothing, so it belongs on the file rung.

### D10 — Measurement is a task at both ends, and one epic's premise is re-examined, not touched

The measurements, at both ends:

| When | What |
|---|---|
| **Before** (task 0.3) | Hook wall on this machine, per-file against single-process; the half's `ℹ duration_ms`; the last CI `test` job and its three bucket steps (above) |
| **After** (task 8.1) | Hook wall, end to end: drift + lock + runner + floor |
| **After** (task 8.2) | Each matrix leg's step durations |
| **Separately** (task 8.3) | Per-file against single-process ON A CI RUNNER, because 2–4 cores is where the parallel win is unmeasured |

**`store-owns-claude-md-managed-block` (P3, planned) exists to close 0.48.0's missed sub-15 s
acceptance.** That acceptance was 26.50 s single-process (`archive/2026-09-22-…/tasks.md` 6.5).
- Per-file mode measures about 13 s for the runner on this machine.
- So this change likely MEETS that acceptance by another route.
- But 13 s is a property of 16 CPUs, not of the suite, and the acceptance was stated for the HOOK,
  which adds the drift script and the lock.

**Recommendation.** If task 8.1's end-to-end hook wall is under 15 s, that epic's stated reason is
satisfied. It should then be re-justified on what remains true of it: the file rung's ~3,430 flushes
are still real cost, and a 2–4 core machine will still pay them. Or it should be dispositioned.
Either way the evidence should be recorded on it. If 8.1 is at or above 15 s, its premise stands
unchanged. This change does not edit, re-scope or disposition that epic.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| A matrix silently loses its required check (a skipped aggregate reads as passing). | `if: always()` plus an explicit result test in the aggregate. `ci-workflow.test.mjs` asserts both, with mutation proofs. |
| Scheduled red day: a line reaching end-of-life turns CI red until a release moves the floor (D2). | The dates are published years ahead, and the release-checklist step looks one release ahead. Accepted deliberately (decided: a failure, D2). |
| Per-file isolation hides a cross-file coupling that single-process exposed, or the reverse. | 1,269/1,269 on 22, 24 and 26 per-file (context table). The shim coverage fix (D3 row 1) closes the one GUARD that depended on the coupling. |
| The reporter differs on linux-x64. | Verified on darwin-arm64 only. The reporter is JavaScript in node core. The first CI run's per-leg count lines confirm it (task 8.2). A mismatch shows up as a refused count, never as a pass, because of D4. |
| More parallel load per hook run on a developer machine. | The existing cross-worktree lock (D3). CONTRIBUTING names `--test-concurrency` for anyone who needs to throttle. |
| A Node below the support floor running the hook hits a D5 unmatched-pattern refusal in the degenerate empty-rung case. | Out of support by policy. The session is warned by `brief` (D6). CI never runs such a Node. |
| An intermediate commit leaves the 13 file-rung files unguarded (per-file mode landed before the shim install). | Landing order (Migration Plan): section 2 lands BEFORE 1.4. |

## Scope: requirements versus tasks

Some of this change is TASKS-ONLY scope and deliberately has no requirement, because nothing about
it is a behaviour a user or a gate relies on beyond the task that performs it:
- the actions bump to v7 (D7);
- the "Node 18+" claim corrections and the built-in list (D8), apart from the support-floor copies
  runtime-support's first requirement guards;
- the one-time cleanup of the already-leaked temp directories (task 2.6);
- the runner's tolerance of an unmatched pattern (D5) is observed behaviour of Node 22+; the
  requirement states only what the GATE does with it.

## Migration Plan

**Landing order**, which is not the section order (Gate 1 POLISH, dependency order):
1. 1.1–1.3 (hook: reporter, colour, unreadable-count abort, the empty-rung guard) — still
   single-process, so the shared-process shim still covers every file.
2. Section 2 (every rung file installs the shim; both temp-dir leaks closed; prose).
3. 1.4–1.5 (per-file mode: probe and loop deleted). Only now does each file get its own process, and
   by now each file installs the shim itself.
4. Section 3 (engine: support-floor constant, seam, brief line). Section 4 imports the constant.
5. Section 4 (CI, certify). **The PR into `main` opens only after 4.3** — before that, CI on the PR
   would still be the Node 18 pin and would fail the node-side-glob hook tests.
6. Section 5 (#220), section 7 (docs).
7. Section 8 (the AFTER measurement), then section 9 (Gate 2 and archive).

Each GREEN lands with its RED in one commit, because the hook runs the suite.

**Rollback.** Each section is revertible on its own, with one coupling: reverting section 4 restores
Node 18 CI, which fails the hook tests that assume node-side globbing (1.4). Revert 1.4 and section 4
together.

**For users.** Nothing to migrate. `/pm:upgrade` is not required for this change, because no
schema moves.
