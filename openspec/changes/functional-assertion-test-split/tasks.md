# Tasks

## 0. Before any code

- [ ] 0.1 Gate 1 — two fresh-context lenses over these artifacts BY PATH (lens A: is every WHEN/THEN in
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
- [ ] 0.2 **Cross-spec review** (required task item 5) — release 0.47.0 holds this change's two spec
      files — `engine-invocation` and `suite-certification` — counted FLAT, so it qualifies. Run the
      `cross-spec-review` skill against the release's whole spec set (including any sibling change's)
      after Gate 1 and again after any later round of concurrent amendment; ask the six questions and
      record `record-cross-spec-review 0.47.0 --verdict pass|fail --reviewer "<identity>"`. The
      question this release is most exposed to is DOUBLE OWNERSHIP: `engine-invocation` pins the
      equivalence between a returned status and an exited status, while `verb-surface` owns the refusal
      classes themselves — the delta must name them by reference and never restate one

## 1. The conformance set, first

The pre-commit hook runs the whole suite, so a RED test lands in the SAME commit as the GREEN task
that turns it green; pairs are named per section. Before that commit, the failing run against the
pre-GREEN engine is saved in this change directory as `red-<task>.txt`, and the GREEN commit message
names that file. New test files live under `scripts/test/` until section 5 moves them.

Pairs: 1.1 and 1.2 land together.

- [ ] 1.1 RED — a table-driven conformance test that runs each invocation BOTH ways: as
      `node scripts/conductor.mjs …` (reading the real process status) and in-process through the
      engine's entry point (reading the returned value), asserting the two are equal. One row per
      class, derived from `scripts/lib/refusal.mjs` plus the executable `process.exit` sites rather
      than typed from memory: success 0; a help token 0; a command-line refusal 1; an unknown verb 1;
      a write conflict 9; an unreadable state file 11; an unreadable state file under `gate-guard` and
      under `commit-nudge` 2; under `brief` 0; a `gate-guard` reconcile block 2; an ambiguous rules
      block 11; the delegated handoff returning its child's status. Fails today: no in-process entry
      point exists
- [ ] 1.2 RED — a source-scan guard asserting the engine contains no executable `process.exit(` in
      `scripts/lib/*.mjs` or `scripts/conductor.mjs` (comments and the CLI tail's `process.exitCode`
      are not matches), naming the file and line of each. Fails today: 194 occurrences in
      `scripts/lib` (191 executable: 189 `exit(1)` and 2 `exit(2)`) and 5 in `conductor.mjs`
- [ ] 1.3 MUTATION, recorded in this change directory as `red-1.x-mutation-evidence.txt` — for 1.2,
      re-introduce one inline exit by hand and confirm the GUARD goes red (not the suite); for 1.1,
      neuter one class's returned status and confirm only that class's row fails. A guard whose
      failure mode is "the whole process died" proves nothing, and
      `docs/lessons/a-guard-can-check-the-wrong-half.md` is the standing reason to check

## 2. Refusals become values

- [ ] 2.1 GREEN — one `die(message, code = 1)` that writes to the injected stderr and throws
      `CommandExit { code }`, and the five existing local `die` helpers
      (`detour-stack.mjs:40`, `claims.mjs:111`, `add-many.mjs:44`, `releases.mjs:42`,
      `purge-logs.mjs:102`) collapse onto it. Verify by 1.2's guard and the full suite
- [ ] 2.2 GREEN — the 189 inline `process.stderr.write(...); process.exit(1);` pairs in `scripts/lib`
      convert to `die(...)`, module by module, with the whole suite green between modules; the two
      `process.exit(2)` hook blocks in `gate-guard.mjs:389,397` become `die(msg, 2)`. Verify: 1.2
      green, 1.1 green, and `rg -n 'process\.exit\(' scripts/lib` empty of executable hits
- [ ] 2.3 GREEN — `conductor.mjs` exports `main(argv, io)` returning a status: `io` carries
      `{ cwd, env, stdin, stdout, stderr }`; the five executable exits convert (`:191`, `:368` to
      `die`; `:172`, `:180` to a returned 0; `:147` to the delegated child's status, returned by
      `main()`); the pre-dispatch refusal path returns its code instead
      of exiting; dispatch's existing `catch` (`:370`) maps `CommandExit` and delegates everything else
      to `refusalFor()`. Verify: 1.1 green across every class
- [ ] 2.4 GREEN — the CLI tail: `process.exitCode = await main(process.argv.slice(2), …)` with no
      `process.exit`, preserving the truncation reason recorded at `conductor.mjs:378–381`. Verify: the
      five hook verbs still exit with their documented statuses, run as the processes
      `hooks/hooks.json` registers (six command registrations over five verbs)
- [ ] 2.5 GREEN — the activity-log instrumentation moves from `process.on("exit")`
      (`conductor.mjs:268–284`) into `main()`'s own control flow, running exactly once per invocation
      before it returns, and the comment block at `:257–260` is rewritten to say why the exit-handler
      shape is no longer needed (a refusal now throws and is caught, so a `finally` no longer drops
      the mutating-verb case). Verify: an activity-log test asserts one line per invocation and none
      at process end

## 3. Globals become per-call values

- [ ] 3.1 RED — a two-roots-in-one-process test: `main()` called twice in one process against two
      temporary roots, the first initialized and the second not, asserting each call's read and write
      land under the root it was given. Fails today: `ROOT` is captured at `constants.mjs:12`
- [ ] 3.2 GREEN — the seven frozen path constants become functions of a current root
      (`constants.mjs:12, :13, :42, :43, :44, :46, :52`), following `git.mjs`'s
      `headAttachment(root = ROOT)` shape; `main()` sets the invocation's root. Sweep every reference
      mechanically (`rg` for `ROOT`, `STATE_PATH`, `CONDUCTOR_DIR` — 98 and 48 references across 17
      and 7 modules), module by module, with the suite green between modules. **Do not touch
      `state.mjs`**: `getPaths()` at `:15–19` is already per-call and must stay that way
- [ ] 3.3 GREEN — the 46 `process.argv` reads in `scripts/lib` and the 23 `process.env` reads
      (`scripts/lib` 20, `conductor.mjs` 3; seven distinct keys) go through the invocation's values.
      Verify: 3.1 green, and a test asserting the engine neither reads nor mutates the calling
      process's own `process.argv`
- [ ] 3.4 GREEN — the 278 direct `process.stdout.write` / `process.stderr.write` calls (30 + 248) go
      through the invocation's streams. Verify: a test asserting a warning and a result land on
      caller-supplied streams and that the process's own stdout and stderr stay empty
- [ ] 3.5 REGRESSION GUARD + MUTATION — the assertion half's shared process must not observe a
      captured root, so mutate one module back to a module-scope root and confirm 3.1's test fails
      rather than some unrelated test flaking. `git.mjs`'s `headAttachment` comment records gh#175,
      this repository's own instance of the same defect

## 4. One git gateway, injected

- [ ] 4.1 REGRESSION GUARD — derive the call-site set MECHANICALLY at apply time
      (`rg -n --glob '!test/**' -e 'execFileSync\(' -e 'execSync\(' scripts` filtered to git argv) and
      assert it against the gateway's operations, so a call site added later fails the guard. This
      document measures 23 invocations across 7 modules (`git.mjs` 11, `created-at.mjs` 3,
      `subcommands.mjs` 4, `commit-watch.mjs` 1 helper + 3 callers, `worktree-hygiene.mjs` 2,
      `tool-currency.mjs` 1, `constants.mjs` 1); the brief said 19. The disagreement is the reason the
      set is derived rather than typed
- [ ] 4.2 GREEN — the gateway module exposes one operation per invocation, and no module imports it;
      every caller receives it. Verify: 4.1 green, the full suite green
- [ ] 4.3 GREEN — the fake, injected in the assertion half. Its canned answers for the gateway's
      operations are FROZEN CAPTURES committed under `scripts/test/fixtures/`, each saying when it
      would be legitimate to refresh it — not derived at test time from the machine's git, per
      `docs/lessons/a-fixture-reconstructed-from-live-data-dies-when-the-data-improves.md`
- [ ] 4.4 GREEN — the fake-versus-live check in the functional half: for each gateway operation, one
      functional test asserts the fake's canned output is byte-identical to the real git's output for
      the same invocation, and names the differing field on failure. Verify: mutate one byte of the
      fake and confirm the check fails and names the field
- [ ] 4.5 GREEN — the git-version question is decided and stated: a live output that changes with the
      git version FAILS the check loudly rather than being absorbed, and refreshing the capture is a
      deliberate edit the drift script then re-certifies

## 5. The split

- [ ] 5.1 GREEN — `scripts/test/assert/` runs in ONE process
      (`node --test --test-isolation=none scripts/test/assert/*.test.mjs`) and `scripts/test/functional/`
      runs real git through the real gateway; shared fixtures move to `scripts/test/fixtures/`. Verify:
      both invocations run and report
- [ ] 5.2 RED — the assertion-half guard: a test that walks `scripts/test/assert/` and fails, naming
      the file, when a file spawns a child process or invokes git. Verify: add one `spawnSync` by hand
      and confirm the guard names that file
- [ ] 5.3 GREEN — migrate the existing 80 test files by SUBJECT (design D5: git's behaviour →
      functional; git as scenery → assertion with the fake). Each migrated file is recorded in this
      change directory as a disposition line — moved, split into a pair, or kept whole — so an
      unmentioned file is visibly unclassified rather than quietly dropped. Verify: the assertion half
      contains no spawn, the functional half covers every gateway operation, and the total declared
      test count across both halves is not below today's 1,831 top-level declarations
- [ ] 5.4 RED — the twin-id checks (design D6): id sets equal across the halves, and a staged change
      to one half's file requiring the other half's file in the same staged diff. Verify: delete one
      assertion partner and confirm the refusal names the id
- [ ] 5.5 GREEN — the five hook verbs' end-to-end invocations become the functional half's real-spawn
      tests (six registrations in `hooks/hooks.json`). Verify: each hook command still exits with its
      documented status through the real binary
- [ ] 5.6 GREEN — repair the source-reading guards to the new shape, each in the task that changes
      what it reads: `conductor-25`'s dispatch-object read and its `}[cmd]` anchor (`:349–380`),
      `save-report-surface`'s `saveState` call-site scan, `conductor-15`, `conductor-16`,
      `conductor-18`, `conductor-28`, `conductor-31`, `emitted-invocations`, `output-interpolations`,
      and `conductor-12`'s cache-busting imports (which stop being the mechanism once the root is
      per-call). Verify: each guard still fails on a deliberate mutation of the thing it guards — a
      repair that only makes it green is the failure this list exists to catch
- [ ] 5.7 GREEN — narrow `hermetic-git.test.mjs`'s "every file containing the string git imports the
      hermetic module" predicate to the halves that can run git, with the narrowing justified in the
      test body (assertion-half files will contain the string without ever running git)

## 6. Certification and the drift script

- [ ] 6.1 RED — the drift script's three checks, each with a test that fails on a real violation: the
      twin id sets differ; a staged change touches one half only; a certified module's staged content
      has no matching `contentHash` in the record. The script reads files and spawns nothing. Verify:
      each check's deliberate violation is refused with the module or id named
- [ ] 6.2 GREEN — the functional runner writes the record (design D7): per module, the files, a
      content hash over their bytes, the functional ids that cover it, the result, the timestamp, and
      the engine sha as provenance. It lives under `$(git rev-parse --git-common-dir)`, beside the
      existing `pm-suite.lock`, and is never committed. Verify: a fresh clone has no record and the
      first commit touching a certified module demands a run
- [ ] 6.3 GREEN — the output-integrity sweep gets the `engine-source` trigger (design D9), hashing
      `scripts/conductor.mjs` plus `scripts/lib/**/*.mjs`; the drift script learns no second rule.
      Verify: a one-line engine edit with no record for the new content is refused, and an unrelated
      commit is not
- [ ] 6.4 GREEN — `.githooks/pre-commit` runs the drift script inside the existing suite lock, then
      runs the assertion half, then runs the functional half only when the trigger demands it; the
      test-count floor (`grep -Hc '^test('`) is re-derived per half so a collapsed glob still aborts.
      Verify: neuter one half's glob and confirm the floor still fires
- [ ] 6.5 GREEN — `.github/workflows/ci.yml` runs both halves. Verify `node --test --test-isolation=none`
      on the version CI pins (`node-version: "18"` today — the flag is VERIFIED present on this
      machine's Node v26.9.0 and UNVERIFIED on 18, which has no binary here and whose registry fetch
      failed). Either bump `node-version` to a version that takes the flag, or fall back to per-file
      isolation for CI only; state which in the workflow comment. Verify: CI green on the PR
- [ ] 6.6 GREEN — the `release-checklist` repo skill's Real Numbers recipe, which derives the published
      test count from the old single-glob command, is re-pointed so the published number stays a
      recomputation rather than an estimate. Verify: run the recipe and confirm it produces a count

## 7. Required task items

- [ ] 7.1 **Call-site completeness sweep** (required task item 1) — for each rule this change
      introduces, enumerate ALL call sites MECHANICALLY rather than from this document's lists: (a) the
      no-`process.exit` rule over `scripts/lib/*.mjs` and `scripts/conductor.mjs`; (b) the injected-global
      rule over `process.argv`, `process.env`, `process.stdout`, `process.stderr`, `ROOT`,
      `STATE_PATH`, `CONDUCTOR_DIR`; (c) the injected-gateway rule over every git argv site; (d) the
      no-spawn/no-git rule over `scripts/test/assert/`. State where each rule holds and where it does
      not, and justify every omission — a site left unguarded beside an identical guarded sibling is a
      FINDING, and both gates are diff-scoped and structurally cannot see it
- [ ] 7.2 **DATA references are call sites** (required task item 1) — the certification record holds
      the module ids it certifies and the functional ids that cover it. Enumerate every place those
      ids are WRITTEN, READ and REMOVED, and prove a module renamed or a functional test deleted
      cannot leave a record pointing at something that no longer exists. Verify: rename one module in
      the gateway set and confirm the record is refused rather than silently not covering it
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

- [ ] 8.1 `CONTRIBUTING.md` and/or `README.md` — how to run each half, what the drift script refuses,
      and how to satisfy a certification demand. Say explicitly whether this is user-facing (it is
      not) so the documentation-currency check is answered rather than skipped
- [ ] 8.2 `skills/conductor/SKILL.md` and the command docs — only if any engine-facing instruction
      changes; the CLI contract does not, so expect none, and say so
- [ ] 8.3 `CHANGELOG.md` — an `## [Unreleased]` entry (the file has no such section today). The release
      cut folds it into `0.47.0`; Mintlify's Changelog page and Introduction's Real Numbers table
      belong to that cut via the `release-checklist` skill, not to this change
- [ ] 8.4 Confirm `docs/parity-ledger.json` still claims every touched path and adds none — no new file
      under `commands/`, `agents/`, `skills/`, `hooks/` or `.claude-plugin/` is expected, and the drift
      script must NOT be added to a shipped directory

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
