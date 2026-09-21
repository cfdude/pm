# Tasks

## 0. Before any code

- [x] 0.1 Gate 1 — two fresh-context lenses over these artifacts BY PATH (lens A: is every WHEN/THEN in
      both spec files reachable and testable against today's 0.46.0 engine, and does any of it restate
      a requirement `verb-surface` already owns; lens B: absent edits — every `process.exit(` site that
      the conversion list misses, every `process.argv`/`process.env`/`process.stdout` reader the global
      sweep does not name, the inverse of each new operation, and every existing test that reads engine
      source and would break silently rather than loudly); fix every Critical and Important,
      re-validate with `openspec validate functional-assertion-test-split --strict`, then record
      `record-gate-review functional-assertion-test-split --gate 1 --verdict pass --reviewer "<identity>"
      --artifact openspec/changes/functional-assertion-test-split/proposal.md --artifact
      openspec/changes/functional-assertion-test-split/design.md --artifact
      openspec/changes/functional-assertion-test-split/tasks.md --artifact
      openspec/changes/functional-assertion-test-split/specs/engine-invocation/spec.md --artifact
      openspec/changes/functional-assertion-test-split/specs/suite-certification/spec.md`
- [x] 0.2 **Cross-spec review** (required task item 5) — release 0.47.0 holds this change's two spec
      files — `engine-invocation` and `suite-certification` — counted FLAT, so it qualifies. Run the
      `cross-spec-review` skill against the release's whole spec set (including any sibling change's)
      after Gate 1 and again after any later round of concurrent amendment; ask the six questions and
      record `record-cross-spec-review 0.47.0 --verdict pass|fail --reviewer "<identity>"`. The
      question this release is most exposed to is DOUBLE OWNERSHIP: `engine-invocation` pins the
      equivalence between a returned status and an exited status, while `verb-surface` owns the refusal
      classes themselves — the delta must name them by reference and never restate one

## 1. The conformance set, first

The pre-commit hook runs the whole suite, so a RED test lands in the SAME commit as the GREEN task
that turns it green; a pair is named for EVERY section below, and its two halves are usually in
DIFFERENT sections — a pair is not a section. Before that commit, the failing run against the
pre-GREEN engine is saved in this change directory as `red-<task>.txt`, and the GREEN commit message
names that file. New test files live under `scripts/test/` until section 5 moves them.

Pairs, RED → GREEN: **1.1 → 2.3** (the in-process entry point); **1.2 → 2.2** (the exit sweep);
**3.1 → 3.2/3.3/3.4** (the per-call root and globals); **3.6 → 3.2** (the `showPrefix` symptom);
**5.4 → 6.1/6.2** (twin coverage and the record checks — the drift script is section 6's, so the twin
tests land in the commit that creates it, even though section 5 names them).

Marked `REGRESSION GUARD` rather than `RED` are the tasks that pass as soon as they exist and are
verified by a deliberate violation instead of by failing first: **3.5, 4.1, 5.2, 6.1**. They still land
with the thing they guard. Section 6 has no RED of its own for that reason, and section 4 has none
either — 4.1's set-equality guard is green the moment the gateway it reads exists, which is 4.2.

- [x] 1.1 RED — a table-driven conformance test that runs each invocation BOTH ways: as
      `node scripts/conductor.mjs …` (reading the real process status) and in-process through the
      engine's entry point (reading the returned value), asserting the two are equal. One row per
      class, derived from `scripts/lib/refusal.mjs` plus the executable `process.exit` sites rather
      than typed from memory: success 0; a help token 0; a command-line refusal 1; an unknown verb 1;
      a write conflict 9; an unreadable state file 11; an unreadable state file under `gate-guard` and
      under `commit-nudge` 2; under `brief` 0; a `gate-guard` reconcile block 2; an ambiguous rules
      block 11; the delegated handoff returning its child's status. Fails today: no in-process entry
      point exists
- [x] 1.2 RED — a source-scan guard asserting the engine contains no executable `process.exit(` in
      `scripts/lib/*.mjs` or `scripts/conductor.mjs` (comments and the CLI tail's `process.exitCode`
      are not matches), naming the file and line of each. Fails today: 194 occurrences in
      `scripts/lib` (191 executable: 189 `exit(1)` and 2 `exit(2)`) and 5 in `conductor.mjs`
- [x] 1.3 MUTATION, recorded in this change directory as `red-1.x-mutation-evidence.txt` — for 1.2,
      re-introduce one inline exit by hand and confirm the GUARD goes red (not the suite); for 1.1,
      neuter one class's returned status and confirm only that class's row fails. A guard whose
      failure mode is "the whole process died" proves nothing, and
      `docs/lessons/a-guard-can-check-the-wrong-half.md` is the standing reason to check

## 2. Refusals become values

- [x] 2.1 GREEN — one `die(message, code = 1)` that writes to the injected stderr and throws
      `CommandExit { code }`, and the five existing local `die` helpers
      (`detour-stack.mjs:40`, `claims.mjs:111`, `add-many.mjs:44`, `releases.mjs:42`,
      `purge-logs.mjs:102`) collapse onto it. Verify by 1.2's guard and the full suite
- [x] 2.2 GREEN — the 189 inline `process.stderr.write(...); process.exit(1);` pairs in `scripts/lib`
      convert to `die(...)`, module by module, with the whole suite green between modules; the two
      `process.exit(2)` hook blocks in `gate-guard.mjs:389,397` become `die(msg, 2)`. Verify: 1.2
      green, 1.1 green, and `rg -n 'process\.exit\(' scripts/lib` empty of executable hits
- [x] 2.3 GREEN — `conductor.mjs` exports `main(argv, io)` returning a status: `io` carries
      `{ cwd, env, stdin, stdout, stderr }`; four of the five executable exits convert (`:368` to
      `die`; `:172`, `:180` to a returned 0; `:147` to the delegated child's status, returned by
      `main()`); **`:191` is the pre-dispatch refusal and it RETURNS its code** — it does not become
      `die`, because it sits ABOVE dispatch's `try`, so a throw there would escape the only `catch`
      that maps `CommandExit` and the refusal would leave `main()` as an exception instead of a
      status; its stdin drain at `:190` still happens before the return; dispatch's existing `catch`
      (`:370`) maps `CommandExit` and delegates everything else to `refusalFor()`. Verify: 1.1 green
      across every class
- [x] 2.4 GREEN — the CLI tail: `process.exitCode = await main(process.argv.slice(2), …)` with no
      `process.exit`, preserving the truncation reason recorded at `conductor.mjs:378–381`. Verify: the
      five hook verbs still exit with their documented statuses, run as the processes
      `hooks/hooks.json` registers (six command registrations over five verbs)
- [x] 2.5 GREEN — the activity-log instrumentation moves from `process.on("exit")`
      (`conductor.mjs:268–284`) into `main()`'s own control flow, running exactly once per invocation
      before it returns, and the comment block at `:257–260` is rewritten to say why the exit-handler
      shape is no longer needed (a refusal now throws and is caught, so a `finally` no longer drops
      the mutating-verb case). Verify: an activity-log test asserts one line per invocation and none
      at process end
- [x] 2.6 GREEN — the FIVE things that today run at MODULE LOAD move behind `main(argv, io)`, so no
      caller pays for them once per process against the real env and the real streams: the delegation
      handoff (`:146–147`, which spawns a child and exits — it becomes a value `main()` acts on), the
      root-divergence warning (`:225`), **the detached-tree warning (`:234`)** — `isDetachedTree()`
      probes the real git at load (`git.mjs:51–63` runs `git symbolic-ref` with `cwd` set to the
      FROZEN `ROOT`, so it is a module-load git invocation as well as a stderr write) and
      `warnDetachedTree` (`scripts/lib/constants.mjs:1620–1627`) then writes FOUR lines to real
      stderr; both move behind `main()` and behind the injected gateway of 4.2 — the engine banner
      (`:244–249`, whose three `process.env` keys come from `io.env`) and the activity-log exit
      handler (2.5). Each writes to `io.stderr`, and `:146`'s `delegateToCheckout({ selfPath })`
      keeps the reason its comment records. Verify, with TWO commands, because the first four are
      gated on `VERB_EFFECTS[cmd]?.effect !== "read-only"` (`:221`) and the detached warning is
      reached by a MUTATING or unknown verb only: (a) a refused verb invoked with `io.stderr` supplied
      prints NOTHING to the process's own stderr — against 0.46.0, `env -u CLAUDE_PROJECT_DIR node
      scripts/conductor.mjs not-a-verb` prints the banner to the real stderr with nothing dispatched,
      which is the behaviour this task removes, while `--help` is already silent there (`:170–173`
      exits above both); (b) in a DETACHED checkout, a mutating verb invoked with `io.stderr` supplied
      prints NOTHING to the process's own stderr either — against 0.46.0 in a detached throwaway
      checkout, `env -u CLAUDE_PROJECT_DIR node scripts/conductor.mjs add-epic --id x --title t`
      writes four `conductor: ⚠ DETACHED CHECKOUT …` lines to the real stderr before dispatch
      (reproduced), which is the path a read-only verb or `--help` never reaches

## 3. Globals become per-call values

- [x] 3.1 RED — a two-roots-in-one-process test: `main()` called twice in one process against two
      temporary roots, the first initialized and the second not, asserting each call's read and write
      land under the root it was given. Fails today: `ROOT` is captured at `constants.mjs:12`
- [x] 3.2 GREEN — ALL TWELVE frozen path constants become functions of a current root, following
      `git.mjs`'s `headAttachment(root = ROOT)` shape; `main()` sets the invocation's root. **The set
      is DERIVED, never typed — seven is wrong and this list was it**:
      `rg -n 'path\.join\((ROOT|CONDUCTOR_DIR|CHANGES_DIR)' scripts/lib/constants.mjs` returns
      `:13 CONDUCTOR_DIR`, `:14 STATE_PATH`, `:15 BRIEF_PATH`, `:16 RENDER_STAMP_PATH`, `:17
      DETOURS_LOG`, `:18 WRITE_CONFLICTS_LOG`, `:42 PROJECT_MD`, `:43 CLAUDE_MD`, `:44 CHANGES_DIR`,
      `:45 ARCHIVE_DIR`, `:46 PLANS_DIR`, `:52 SPECS_DIR` — eleven derived, twelve with `:12`'s `ROOT`.
      Sweep each CONSTANT's consumers (not `ROOT`'s alone: the tokens `ROOT`, `STATE_PATH` and
      `CONDUCTOR_DIR` reach none of `BRIEF_PATH`, `RENDER_STAMP_PATH`, `DETOURS_LOG`,
      `WRITE_CONFLICTS_LOG`, `ARCHIVE_DIR`, `PROJECT_MD`, `CLAUDE_MD`, `CHANGES_DIR`, `PLANS_DIR` or
      `SPECS_DIR`, and five of those are WRITTEN — `render.mjs:324,365`, `subcommands.mjs:155`,
      `git.mjs:114,175`, `write-conflicts.mjs:33,46,63`), module by module, with the suite green
      between modules. 98 `ROOT` references across 17 modules; 48 `STATE_PATH`/`CONDUCTOR_DIR`
      matching lines across 7 (`created-at.mjs`'s `STATE_PATHSPEC` is a different constant).
      **`state.mjs` is swept like any other module**: `getPaths()` at `:15–19` stays PER-CALL — do not
      freeze it into a captured value — but it re-derives from `process.env.CLAUDE_PROJECT_DIR ||
      process.cwd()`, process globals, so it takes the invocation's env and cwd rather than the
      process's (the exemption this task used to carry is what would make 3.1 fail).
      **`subcommands.mjs:178`'s `let showPrefix = null` moves out of module scope in this task**, into
      the per-call/gateway scope of the `changedFiles()` call that caches it: its comment states the
      invariant "ROOT does not move under a running invocation", and this task is what makes that
      false. Verify: 3.1 and 3.6 green
- [x] 3.3 GREEN — the 46 `process.argv` reads in `scripts/lib`, the 23 `process.env` reads
      (`scripts/lib` 20, `conductor.mjs` 3; seven distinct keys) and the nine
      `process.env.CLAUDE_PROJECT_DIR || process.cwd()` root derivations (`constants.mjs:12`,
      `state.mjs:17,501,506`, `write-conflicts.mjs:15`, `claims.mjs:72`, `purge-logs.mjs:34`,
      `lessons.mjs:42`, `activity-log.mjs:41` — derived by `rg -n 'process\.cwd\(\)' scripts/lib`, not
      from this list) go through the invocation's values; `constants.mjs:1568`'s `rootDivergence` is
      the shape the rest take. Verify: 3.1 green, and a test asserting the engine neither reads nor
      mutates the calling process's own `process.argv` or `process.cwd`
- [x] 3.4 GREEN — the 288 direct `process.stdout.write` / `process.stderr.write` calls (278 in
      `scripts/lib` — 30 + 248 — plus TEN in `conductor.mjs` at
      `:171,179,187,246,344,354,364,367,377,381`) go through the invocation's streams, **and the
      invocation's STDIN does too**: `state.mjs:28`'s `readStdin()` reads fd 0 globally and is reached
      from `gate-guard.mjs:330`, `lessons.mjs:129`, `subcommands.mjs:298` and `add-many.mjs:28`, and
      `conductor.mjs:190`'s refusal path tests `isatty(0)` — so this task gives `io.stdin` its
      implementation and routes all five sites (four drains plus the tty test) through it, rather than
      leaving `io.stdin` declared in 2.3's `io` and read by nobody. Verify: a test asserting a warning
      and a result land on caller-supplied streams and that the process's own stdout and stderr stay
      empty, and a test that drives a hook verb in-process with a payload on a caller-supplied stdin
      while the process's own stdin is a terminal
- [x] 3.5 REGRESSION GUARD + MUTATION — the assertion half's shared process must not observe a
      captured root, so mutate one module back to a module-scope root and confirm 3.1's test fails
      rather than some unrelated test flaking. `git.mjs`'s `headAttachment` comment records gh#175,
      this repository's own instance of the same defect
- [x] 3.6 RED — the `showPrefix` symptom, which is a DIFFERENT failure from 3.1's and survives 3.2's
      sweep if only the constants move: `main()` called twice in one process against two roots whose
      `git rev-parse --show-prefix` answers differ (the second a subdirectory of the first), asserting
      each call's `changedFiles()`/`headChangedFiles()` result is stripped against the root THAT call
      was given. Fails on 0.46.0 for the same reason 1.1 does — `conductor.mjs` exports nothing
      (`rg -n '^export' scripts/conductor.mjs` is empty), so the two-invocation call cannot be made at
      all — and it would still fail on an engine with per-call roots and `subcommands.mjs:178`'s
      `let showPrefix = null` left at module scope: the cache computes once per PROCESS, so invocation
      2 reuses invocation 1's prefix and mis-strips, corrupting every `CONDUCTOR_OWN_FILES` comparison
      the root-divergence and bookkeeping-commit logic rests on. Pairs with 3.2

## 4. One git gateway, injected

- [x] 4.1 REGRESSION GUARD — derive the call-site set MECHANICALLY at apply time
      (`rg -n --glob '!test/**' -e 'execFileSync\(' -e 'execSync\(' scripts` filtered to git argv) and
      assert it against the gateway's operations, so a call site added later fails the guard. This
      document measures 23 invocations across 7 modules (`git.mjs` 11, `created-at.mjs` 3,
      `subcommands.mjs` 4, `commit-watch.mjs` 1 helper + 3 callers, `worktree-hygiene.mjs` 2,
      `tool-currency.mjs` 1, `constants.mjs` 1); the brief said 19. The disagreement is the reason the
      set is derived rather than typed
- [x] 4.2 GREEN — the gateway module exposes one operation per invocation, and no module imports it;
      every caller receives it. Verify: 4.1 green, the full suite green
- [x] 4.3 GREEN — the fake, injected in the assertion half. Its canned answers for the gateway's
      operations are FROZEN CAPTURES committed under `scripts/test/fixtures/`, each saying when it
      would be legitimate to refresh it — not derived at test time from the machine's git, per
      `docs/lessons/a-fixture-reconstructed-from-live-data-dies-when-the-data-improves.md`
- [x] 4.4 GREEN — the fake-versus-live check in the functional half: for each gateway operation, one
      functional test asserts the fake's canned output is byte-identical to the real git's output for
      the same invocation, and names the differing field on failure. Verify: mutate one byte of the
      fake and confirm the check fails and names the field
- [x] 4.5 GREEN — the git-version question is decided and stated: a live output that changes with the
      git version FAILS the check loudly rather than being absorbed, and refreshing the capture is a
      deliberate edit the drift script then re-certifies

## 5. The split

- [x] 5.1 GREEN — `scripts/test/assert/` runs in ONE process
      (`node --test --test-isolation=none scripts/test/assert/*.test.mjs`) and `scripts/test/functional/`
      runs real git through the real gateway; shared fixtures move to `scripts/test/fixtures/`. **AMENDED AT APPLY TIME: the
      third bucket's directory IS created here, with its one member in it.** The plan named the
      sweeps bucket's home in THIS task and left the directory to 6.3; leaving `output-interpolations`
      at the top level instead would have landed a commit in which 19 tests are run by no runner and
      counted by no floor — the exact silence this section exists to remove, and the reason the
      rationale given ((a bucket with no member is never on disk)) does not apply here: it HAS a
      member. 6.3 keeps (b) the runner and (c) the record entry, and its (a) is already on disk.
      ORIGINAL TEXT, kept so the change is visible: the
      third bucket's directory was NOT created here — it belongs to the sweep
      that occupies it (6.3), so that a bucket with no member is never on disk. Verify: both
      invocations run and report
- [x] 5.2 REGRESSION GUARD — the assertion-half guard: a test that walks `scripts/test/assert/` and
      fails, naming the file, when a file spawns a child process or invokes git. It is a guard, not a
      RED: it passes the moment the directory it walks exists, so it lands with 5.1 rather than with a
      GREEN elsewhere. Verify: add one `spawnSync` by hand and confirm the guard names that file
- [x] 5.3 GREEN — **COMPLETE: the migration, the re-point, the per-half floor, the inline
      enrolment check AND the 44 assertion twins are all on disk.** See `dispositions-5.3.md` in
      this change directory for every file's home, its disposition and its gateway operations.
      **THE 44 TWINS LANDED IN TWO COMMITS** — the first 19, then the remaining 25 — because the
      pre-commit hook runs the whole assertion half and one commit carrying all 44 would have been
      a single unreviewable step. Each twin carries every behaviour of its functional counterpart
      that needs no repository, and names at its foot the behaviour it deliberately does not carry
      (a real commit, a detached checkout, a spawned shell — design D5's placement rule). Where a
      behaviour could be reached through the frozen capture's answers, the twin drives it: the
      arg-keyed double (`fakeGit({ roots: [] })`) makes the fixture's git answers available
      in-process, which is what the twins for the gate-review and integrity families use.
      migrate the existing 85 test files by SUBJECT (design D5: git's behaviour →
      functional; git as scenery → assertion with the fake). Each migrated file is recorded in this
      change directory as a disposition line, and the vocabulary is the one the spec's twin rule
      admits (design D6): **`kept whole`** (stays in `scripts/test/assert/` as one file — no functional
      twin is required of it), **`paired`** (lands in `scripts/test/functional/`, and its assertion
      twin is WRITTEN in this same task, because a functional id with no twin is a refusal), or
      **`split into a pair`** (an existing file whose tests divide between the halves, keeping one id
      on both sides). A bare "moved into the functional half" is NOT a disposition and must not be
      recorded as one: it would create a functional id with no twin, which the drift script refuses by
      construction. An unmentioned file is visibly unclassified rather than quietly dropped. Verify:
      the assertion half contains no spawn, the functional half covers every gateway operation, every
      functional id has an assertion file of the same name, and the total declared test count across
      both halves is not below the 1,852 top-level declarations HEAD carries (`git ls-files
      'scripts/test/*.test.mjs' 'scripts/test/**/*.test.mjs' | xargs grep -Hc '^test('`, DERIVED at apply
      time — this document said 1,831 against 80 files and both were stale) LESS the 19 the sweep
      carries (`rg -c '^test\(' scripts/test/output-interpolations.test.mjs`), which moves to its own
      bucket in 6.3 — so the floor across the two halves is >= 1,833, with the sweep's 19 counted in
      its own bucket rather than lost
      **THE RE-POINT LANDS IN THIS COMMIT, NOT IN SECTION 6.** `.githooks/pre-commit:69` and `:81` and
      `.github/workflows/ci.yml:32` and `:35` all name `scripts/test/*.test.mjs`; the shell does not
      recurse, so the moment the first file moves under `scripts/test/assert/` the hook's suite is a
      SUBSET of the suite, and the floor's `declared` is computed from the SAME glob and shrinks with
      it — reproduced against 0.46.0's hook with eight test files, four of them under
      `scripts/test/assert/`: `grep -m1 -E '^(ℹ|#) tests '` reads 4, `declared` reads 4, the floor
      does not fire, and the hook exits 0 having run half the assertions. So the first migrated file,
      both of the hook's globs, ci.yml's syntax loop (`for f in scripts/lib/*.mjs scripts/test/*.mjs`
      — it does not descend either) and ci.yml's suite step land in ONE commit, and no commit exists
      between the move and the re-point. **The floor's `declared` is re-derived in that same commit,
      and the ONE invariant it is derived from is: the floor compares what the runner RAN against what
      the runner was GIVEN, never against a superset of it.** So `declared` is enumerated from the
      TRACKED files of exactly the half (or halves) the runner is handed in that invocation —
      `git ls-files 'scripts/test/assert/*.test.mjs' | xargs grep -Hc '^test('` for the hook, whose
      runner is handed only the assertion half; the same pair per bucket in CI, which runs all three —
      and NEVER from the shell's expansion of the runner's own pattern. The two counts then agree by
      construction, and a collapsed half reports `total < declared` and fires instead of the two sides
      shrinking in lockstep. **Enumerating over BOTH halves for the hook's floor is the shape that must
      not be written**: it is a superset of what that runner was given and aborts on every commit that
      has a functional half (reproduced in a scratch repository with three files per half against a
      0.46.0-shaped hook: `total=6 declared=15` → ABORT). 6.4 then adds the drift script and
      re-verifies the floor still fires. This is not a hypothetical: the already-registered epic
      `commit-gate-tests-working-tree-not-index` records the same mechanism in the guard as it stands
      ("the declared count uses the same glob as the runner, so renaming a test out of the glob drops
      it from both"), and the split doubles it.
      **The floor is not the whole guard, and this task is where every tracked test file gets a home**
      (design D5's table; the spec's enrolment requirement). The floor only compares two counts over
      the files a runner was handed, so a test file in NEITHER half is invisible to it — run by
      nothing and counted by nothing (reproduced in a scratch repository with six half files and one
      `scripts/test/leftover.test.mjs`: both halves ran 15 tests, the floor compared 15 against 15,
      and the hook exited 0 while the leftover's two tests never ran). So this task also assigns the
      files that exist today: the 85 files' top-level declarations move by subject under the vocabulary
      above, and the files whose home is NOT a subject judgement are named here rather than left
      unclassified — `output-interpolations.test.mjs` and its two helper modules go to the
      change-triggered bucket `scripts/test/sweeps/` (6.3 moves them, names the runner and writes the
      record entry), the conformance set (1.1) and the hook verbs' end-to-end invocations (5.5) are
      functional-half files that run no git but do spawn (each with its assertion twin, per 5.4), and
      the non-test modules in `scripts/test/` — `helpers.mjs`, `hermetic-git.mjs`, `parity-helpers.mjs`,
      `inject-state-conflict.cjs`, `fixtures/` — are outside the enumeration entirely (it matches
      `*.test.mjs`) and move to `scripts/test/fixtures/` in 5.1. The enumeration is
      `git ls-files 'scripts/test/*.test.mjs' 'scripts/test/**/*.test.mjs'` — BOTH arms, because git's
      `**` does not match zero directories (verified: the `**` arm matched six nested files and missed
      the seventh at the top level) — and the drift script refuses any enumerated file that is in
      neither half and in neither of the two named buckets.
      **The re-point commit carries that enumeration with it, and not section 6.** The migration runs
      across 5.3–5.7, so between the first re-point and the drift script's arrival there are commits in
      which some files sit under a half and others are still at `scripts/test/` top level — a file left
      there is run by no runner and counted by no floor, which is the exact silence this section
      exists to remove. So the same commit that re-points the hook gains the check INLINE (one
      `git ls-files` over both arms, refusing by name any tracked test file outside the two halves and
      the sweeps bucket, which does not exist yet), and 6.4 REMOVES that inline form as it hands the
      check to the drift script — one implementation at a time, never two.
- [x] 5.4 RED — twin coverage (design D6, ONE direction): every functional id has an assertion file
      of the same id, and a staged change to a functional file requires its twin in the same staged
      diff. There is deliberately no converse check — an assertion-only file is not a refusal — and
      the drift script implements exactly this pair of checks. Verify: delete one assertion partner
      and confirm the refusal names the id (the drift script itself is 6.1; these tests land with it)
- [x] 5.5 GREEN — the five hook verbs' end-to-end invocations become the functional half's real-spawn
      tests (six registrations in `hooks/hooks.json`). They are functional-half files that run NO git —
      the half is the half that MAY spawn and runs on a trigger, not the half that runs git — so each
      lands with its assertion twin like any other functional id, per 5.4 and design D5's table.
      Verify: each hook command still exits with its documented status through the real binary, and
      each has an assertion twin of the same id
- [x] 5.6 GREEN — repair the source-reading guards to the new shape, each in the task that changes
      what it reads: `conductor-25`'s dispatch-object read and its `}[cmd]` anchor (`:349–380`),
      `save-report-surface`'s `saveState` call-site scan, `conductor-15`, `conductor-16`,
      `conductor-18`, `conductor-28`, `conductor-31`, `emitted-invocations`, `output-interpolations`,
      and `conductor-12`'s cache-busting imports (which stop being the mechanism once the root is
      per-call). Verify: each guard still fails on a deliberate mutation of the thing it guards — a
      repair that only makes it green is the failure this list exists to catch
- [x] 5.7 GREEN — narrow `hermetic-git.test.mjs`'s "every file containing the string git imports the
      hermetic module" predicate to the halves that can run git, with the narrowing justified in the
      test body (assertion-half files will contain the string without ever running git)

## 6. Certification and the drift script

- [x] 6.1 REGRESSION GUARD — the drift script's FOUR checks, each with a test that deliberately
      violates it and is refused with the module, id or file named: a tracked test file in neither half
      and in neither named bucket; a functional id with no assertion twin; a staged change touching one
      half only; a certified module's staged content with no matching `contentHash` in the record. It
      is a guard and not a RED — it passes as soon as the script it tests exists, which is this task —
      so it is verified by its four violations rather than by failing first. The script reads files and
      spawns nothing (the capability forbids it running the functional half, driving git or spawning
      the engine), and it implements exactly these four — including 5.4's two — and no converse of the
      twin rule
- [x] 6.2 GREEN — the dev-only runner `scripts/test/certify.mjs` writes the record (design D7): per
      module, the files, a content hash over their bytes, the functional ids that cover it, the result,
      the timestamp, and the engine sha as provenance. It is the same runner 6.3 uses for the sweep
      bucket (`node scripts/test/certify.mjs functional` / `… sweeps`), so there is one record writer
      rather than one per bucket, and it lives in the test tree, never in a shipped directory (8.4).
      **The certified set includes `conductor.mjs`, and the functional ids recorded for it are the
      CONFORMANCE SET's (1.1)** — the in-process/CLI status equivalence lives there
      (`conductor.mjs:147,191,366–383`), it is not derivable from the git sweep 4.1 runs, and without
      this entry the whole conformance set is uncertified and a change to the entry point is gated by
      nothing. The record lives under `$(git rev-parse --git-common-dir)`, beside the existing
      `pm-suite.lock`, and is never committed. Verify: a fresh clone has no record and the first
      commit touching a certified module demands a run; and a one-line edit to `conductor.mjs` with no
      fresh conformance entry is refused
- [x] 6.3 GREEN — the sweep bucket and its `engine-source` record (design D9). Three things land
      together, because a trigger with no producer is a refusal nobody can satisfy: (a) the move —
      `scripts/test/output-interpolations.test.mjs` and its two helper modules
      (`output-interpolations.mjs`, `output-interpolations.judged.mjs`) become
      `scripts/test/sweeps/`, creating the bucket 5.3 assigned them to; (b) the runner — the same
      dev-only runner 6.2 names, `node scripts/test/certify.mjs sweeps`, which runs
      `node --test scripts/test/sweeps/*.test.mjs` and writes the entry on a pass; (c) the entry — an
      `engine-source` kind in the SAME record file under `$(git rev-parse --git-common-dir)`, hashing
      `scripts/conductor.mjs` plus `scripts/lib/**/*.mjs`, and no second rule in the drift script. A
      refusal that demands this entry NAMES `node scripts/test/certify.mjs sweeps` (6.4), or the
      engine-source edit is refused with no command able to satisfy it. This entry is DISJOINT from the
      `conductor.mjs` certified-set entry 6.2 adds: an edit to `conductor.mjs` changes both hashes, so
      it demands a fresh conformance run AND a fresh sweep run, and neither substitutes for the other.
      Verify: a one-line engine edit with no record for the new content is refused and the refusal
      names the sweep run; an unrelated commit is not; and a fresh
      `node scripts/test/certify.mjs sweeps` satisfies the one that was refused
- [x] 6.4 GREEN — `.githooks/pre-commit` runs the drift script inside the existing suite lock, then
      runs the assertion half; **it does NOT run the functional half**, and the drift script's refusal
      instead NAMES the command the developer runs to produce the missing record. Running the
      functional half here would contradict the capability twice over: the check must be produced by
      reading files with no engine process and no git fixture started by it, and the drift script runs
      BEFORE the suite, so a check that demanded a record its own later step would write refuses one
      step too early to ever be satisfied. CI is where the functional half runs on the trigger, with
      no record present (6.5). The test-count floor (`grep -Hc '^test('`) was already re-derived with
      the re-point in 5.3, and this task confirms it holds the invariant 5.3 states — `declared`
      enumerated from the tracked files of the SAME half the runner was handed, never a superset of it
      (the hook's runner is handed the assertion half only, so its `declared` covers the assertion half
      only) — and this task also retires 5.3's inline enrolment check into the drift script's check 1,
      so the hook stops carrying two implementations of one rule. Verify: neuter the assertion half's
      glob and confirm the floor still fires (`total < declared`, because the declaration came from the
      tracked files rather than from that glob); confirm a tracked test file placed at the top level is
      refused by the script with the file named, in the same commit 5.3's inline copy is removed; and
      confirm a commit that changes a certified module with no record is refused with the run named,
      and no functional process was started by the hook
- [ ] 6.5 GREEN — `.github/workflows/ci.yml` runs all THREE buckets — this is the one place the
      functional half and the sweep bucket run on their triggers, with the record absent and none
      substitutable — and each bucket's floor is enumerated from that bucket's own tracked files (6.4's
      invariant, applied per bucket; enumerating both halves at once here is the superset the invariant
      forbids). The syntax loop at `:32`
      (`for f in scripts/lib/*.mjs scripts/test/*.mjs`) was re-pointed with 5.3's re-point, which had
      to happen in that commit: it does not descend, so every file moved under `scripts/test/assert/`
      or `scripts/test/functional/` stops being syntax-checked the moment it moves. Verify
      `node --test --test-isolation=none` on the version CI pins (`node-version: "18"` today — the flag
      is VERIFIED present on this machine's Node v26.9.0 and UNVERIFIED on 18, which has no binary here
      and whose registry fetch failed). Either bump `node-version` to a version that takes the flag, or
      fall back to per-file isolation for CI only; state which in the workflow comment. Verify: CI green
      on the PR
- [ ] 6.6 GREEN — the five other places that name the old single-glob command, each re-pointed in this
      task rather than left to go stale: the `release-checklist` repo skill's **Real Numbers recipe**
      (`.claude/skills/release-checklist/SKILL.md:57`, which derives the published test count from the
      old command) and its **green step** (`:25` — the Real Numbers line is the one this task's
      sibling covers, this is the "run it green" line), `CONTRIBUTING.md:9,48,126`, this repo's own
      `CLAUDE.md:27` (the `Tests:` line) and `:60` (the required test coverage location), and
      `.claude/skills/pr-workflow/SKILL.md:22,94`. Verify: run the Real Numbers recipe and confirm it
      produces a count — a recomputation, not an estimate

## 7. Required task items

- [ ] 7.1 **Call-site completeness sweep** (required task item 1) — for each rule this change
      introduces, enumerate ALL call sites MECHANICALLY rather than from this document's lists: (a) the
      no-`process.exit` rule over `scripts/lib/*.mjs` and `scripts/conductor.mjs`; (b) the injected-global
      rule over `process.argv`, `process.env`, `process.cwd()`, `process.stdout`, `process.stderr`,
      **stdin (`fs.readFileSync(0)` / `isatty(0)`)**, `ROOT` and **each of the twelve path constants**
      — `STATE_PATH` and `CONDUCTOR_DIR` are two of twelve, and the pattern
      `ROOT|STATE_PATH|CONDUCTOR_DIR` reaches neither `BRIEF_PATH`, `RENDER_STAMP_PATH`,
      `DETOURS_LOG`, `WRITE_CONFLICTS_LOG`, `ARCHIVE_DIR`, `PROJECT_MD`, `CLAUDE_MD`, `CHANGES_DIR`,
      `PLANS_DIR` nor `SPECS_DIR`; (c) the injected-gateway rule over every git argv site, including
      the three shell-string `execSync` calls (`subcommands.mjs:222`, `git.mjs:10`,
      `worktree-hygiene.mjs:35`); (d) the no-spawn/no-git rule over `scripts/test/assert/`; (e) the
      ENROLMENT rule — every tracked `scripts/test/*.test.mjs` and `scripts/test/**/*.test.mjs`
      (BOTH arms; git's `**` matches no zero directories) has exactly one home, and its consumers are
      every place that enumerates the suite: the hook's floor, the hook's 5.3 inline refusal, the
      drift script's check 1 that replaces it in 6.4, the twin-id walk over `scripts/test/functional/`,
      and ci.yml's three per-bucket enumerations — a consumer added later that enumerates a different
      set is the FINDING this item exists to catch. State where
      each rule holds and where it does not, and justify every omission — a site left unguarded beside
      an identical guarded sibling is a FINDING, and both gates are diff-scoped and structurally
      cannot see it
- [ ] 7.2 **DATA references are call sites** (required task item 1) — the certification record holds
      the module ids it certifies and the functional ids that cover it. Enumerate every place those
      ids are WRITTEN, READ and REMOVED, and prove a module renamed or a functional test deleted
      cannot leave a record pointing at something that no longer exists. **`covers` is the field this
      is most exposed on**: the `conductor.mjs` entry's `covers` holds the conformance set's ids
      (6.2), so deleting a conformance row or renaming its file must refuse rather than leave a module
      reading as certified by a functional id that no longer exists. Verify: rename one module in the
      gateway set and confirm the record is refused rather than silently not covering it; then delete
      one conformance id and confirm the same for the `conductor.mjs` entry
- [ ] 7.3 **Every operation has an inverse** (required task item 1) — enumerate the inverse of each
      new operation and name each one deliberately not shipped: `main()`'s entry point against the CLI
      tail (both shipped — the tail is the inverse's only caller); the record written by a passing run
      against its removal (say whether a run can invalidate a record, and if not, why a stale record
      is refused by content rather than deleted); the split's two directories against a merge back
      (not shipped — say why); the drift script's refusal against a bypass (not shipped — say why, and
      name the CI backstop instead)
- [ ] 7.4 **Verify against the commit, not the working tree** (required task item 2) — for every task
      above, run `git show --stat <that task's sha>` and assert every file the task claims to change
      appears in THAT commit. An engine file claiming to have lost its `process.exit` but absent from
      the commit FAILS, and the working tree will hold the intended edit while both gates are green.
      Verify: the check is run per task, and its output is kept with the disposition lines from 5.3
- [ ] 7.5 **Attribute every commit to its epic** (required task item 4) — `update-epic
      functional-assertion-test-split --attribute-commit <sha>` as each commit is made. The commit
      that moves this change under `archive/` is lifecycle bookkeeping and is NOT attributed
- [ ] 7.6 **Route what the work taught you** (required task item 7) — name which of the three each
      finding is, before the change closes: a PRACTICE (the twin-link and certification discipline, if
      it earned its place) becomes its own epic with the evidence that made it necessary; FRICTION (a
      guard that read engine source and had to be repaired by hand, or the test-count floor's second
      copy) is filed with `/pm:feedback`; a PROCESS FAILURE goes to `docs/lessons/` with a `trigger`
      written as the situation BEFORE the mistake and an `enforced_in` naming where its rule binds. In
      particular: `a-one-off-sweep-certifies-only-the-day-it-ran` is the lesson this change
      instantiates, and if the work shows the certification record is the mechanism that lesson lacked,
      say so there rather than only in this change
- [ ] 7.7 **Declare lifecycle bookkeeping** (required task item 3) — the archive task below carries the
      literal `<!-- pm:lifecycle -->` marker on its own line, marked at the moment this source was
      authored

## 8. Docs (after Gate 2)

- [ ] 8.1 `CONTRIBUTING.md` and/or `README.md` — how to run each half AND the sweep bucket, what the
      drift script refuses (including a test file in neither half), and how to satisfy a certification
      demand, naming `node scripts/test/certify.mjs functional` and `… sweeps` as the two commands that
      produce one. Say explicitly whether this is user-facing (it is not) so the
      documentation-currency check is answered rather than skipped. **The other docs that
      quote the old command are checked here as a set, not one at a time** —
      `rg -n --hidden 'node --test' --glob '!scripts/**'` is the enumeration (`--hidden` is required:
      three of them live under `.claude/skills/`, and a sweep that skips dot-directories misses them)
      (`CONTRIBUTING.md:9,48,126`, this repo's `CLAUDE.md:27,60`, `.claude/skills/pr-workflow/SKILL.md:22,94`,
      `.claude/skills/release-checklist/SKILL.md:25,57`), and 6.6 is the task that re-points them; this
      task states each one's new shape and where its text now lives
- [ ] 8.2 `skills/conductor/SKILL.md` and the command docs — only if any engine-facing instruction
      changes; the CLI contract does not, so expect none, and say so
- [ ] 8.3 `CHANGELOG.md` — an `## [Unreleased]` entry (the file has no such section today). The release
      cut folds it into `0.47.0`; Mintlify's Changelog page and Introduction's Real Numbers table
      belong to that cut via the `release-checklist` skill, not to this change
- [ ] 8.4 Confirm `docs/parity-ledger.json` still claims every touched path and adds none — no new file
      under `commands/`, `agents/`, `skills/`, `hooks/` or `.claude-plugin/` is expected, and neither
      the drift script nor the runner (`scripts/test/certify.mjs`) may be added to a shipped directory:
      both are dev tooling and both live in the test tree

## 9. Close

- [ ] 9.1 Gate 2 — two fresh-context lenses over the committed range (lens A: spec alignment and real
      tests, including that the conformance set is proven to discriminate; lens B: absent edits — the
      unguarded global reader, the un-inverted operation, error and edge handling, the honesty of every
      refusal message). Fix Critical and Important, then record
      `record-gate-review functional-assertion-test-split --gate 2 --verdict pass --reviewer "<identity>"
      --base-sha <parent of the first attributed commit> --head-sha <the last attributed commit>`
- [ ] 9.2 <!-- pm:lifecycle --> Archive — `/opsx:archive functional-assertion-test-split`, then
      `update-epic functional-assertion-test-split --status archived --outcome delivered --reason
      "the suite runs in-process on every commit and its functional half is certified by content rather
      than remembered" --no-deferrals`. The commit that moves `openspec/changes/<id>/` under `archive/`
      is NOT attributed
