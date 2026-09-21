# Proposal

## Why

The suite this repository gates every commit on has become the slowest thing in the repository, and
it got there by measuring the same way a hundred times over. Measured on the engine at 319b05d
(2026-09-20, commands in `impacts.md`-style form at the end of this proposal):

- **80 test files** (`ls scripts/test/*.test.mjs | wc -l`) declaring **1,831 top-level `test()`** and
  2,029 `test()` calls including nested ones.
- **~2,533 static call sites** of the two spawn helpers (`run(` 2,402 + `runCombined(` 131), each of
  which boots a fresh `node` process. A DISPATCHED engine invocation measured **0.22 s (`brief`) and
  0.24 s (`render`) wall, as the MEDIAN OF SEVEN runs** on this machine at load ~7, against a copy of
  this repository's own 261-epic `state.json`, of which ~0.09 s is node's own boot (median of 7,
  `node -e '1'`). `--help` is NOT that measurement and is not cited for it: it is answered before
  dispatch, does none of the work, and measures 0.11 s. **The suite's serial floor follows: 2,533 ×
  ~0.22–0.24 s ≈ 9–10 minutes of process-bound time on its own, plus the 116 fixture builds — a
  ~9-minute serial floor**, stated as a floor because it is one: the wall-clock figure is lower only
  where the runner overlaps files, a single-run reading is not the figure this rests on (a lone `time`
  on a loaded machine reads 0.24–0.27 s and pushes the floor past 10 minutes), and the engine is being
  made to answer in SECONDS, not in fewer minutes. The fixture term is environment-dependent and is
  not the load-bearing one: measured here, one fixture build (`git init` + three commits) costs ~4.7 s
  because this machine's global git template runs secret scanners on every commit — a cost the trigger
  does not remove, and one reason the measured floor is a floor.
- **116 static call sites** of the three git-fixture builders (`gitRepo`, `gitInitWithCommit`,
  `commitFiles`), each running `git init` + several `git commit`s in a throwaway repository.

The cost is not node's test runner. A bake-off run on 2026-09-18 (recorded in
`scratchpad/bakeoff/REPORT.md`, **not present on disk when this proposal was written** — see Open
Questions in `design.md`) measured runner overhead below 1% of suite time and rejected Vitest: with
`isolate:false` it breaks the tests that monkey-patch globals, and its full-suite win came from
disabling exactly the isolation this design needs more of. `node:test` stays.

So the work is not to change runners. It is to stop paying for a process boundary and a git
repository on tests whose subject is neither.

## What Changes

- **The engine gets an in-process entry point.** `scripts/conductor.mjs` exports
  `main(argv, io)` returning an exit code instead of calling `process.exit`. Every refusal becomes a
  thrown `CommandExit { code }` caught at the one dispatch site. The CLI tail exits with what
  `main()` returned, so the binary's behaviour is unchanged.
- **Every global the engine reads becomes an injected value rather than a module-scope capture**:
  the root, argv, the output streams, stdin and env. Today `ROOT` is frozen at
  `scripts/lib/constants.mjs:12` with ELEVEN path constants derived from it at module load
  (`:13`, `:14`, `:15`, `:16`, `:17`, `:18`, `:42`, `:43`, `:44`, `:45`, `:46`, `:52` — twelve with
  `:12`'s `ROOT` itself, enumerated by `rg -n 'path\.join\((ROOT|CONDUCTOR_DIR|CHANGES_DIR)'
  scripts/lib/constants.mjs` and not from this list); `scripts/lib` reads `process.argv` at 46 sites,
  `process.env` at 20, and `process.stdout`/`process.stderr` at 278. This is what makes one process
  able to serve many roots — and it is not optional under a single-process suite, where a
  module-scope root would pin whichever root the first test happened to use.
- **All git access moves behind ONE injected gateway.** The brief's count was 19 call sites
  (10 already in `scripts/lib/git.mjs`, 9 strays); the measured set at 319b05d is **23 git
  invocations across 7 modules** — `git.mjs` 11, `created-at.mjs` 3, `subcommands.mjs` 4,
  `commit-watch.mjs` 1 (plus its 3 callers), `worktree-hygiene.mjs` 2, `tool-currency.mjs` 1,
  `constants.mjs` 1. No module imports the gateway directly; callers receive it, so a fake is plain
  injection — not `vi.mock`, not monkey-patching.
- **The suite splits in two.** An *assertion* half runs in ONE node process with
  `--test-isolation=none`, calls the engine in-process, fakes git, spawns nothing, and runs on every
  commit. A *functional* half runs real git through the real gateway against live repositories, and
  runs only when a module the gateway serves has changed. The five hook verbs' end-to-end
  invocations stay real spawns, in that half — it is the half that may spawn and runs on a trigger,
  not the half that runs git.
- **Every tracked test file has exactly one home, and the floor counts what the runner was given.**
  The enumeration covers all of `scripts/test/` — `git ls-files 'scripts/test/*.test.mjs'
  'scripts/test/**/*.test.mjs'`, both arms because git's `**` does not match zero directories — and a
  file in neither half and in neither named bucket is a refusal naming the file, rather than a test
  run by nothing and counted by nothing. The pre-commit gate's test-count floor is re-derived from
  the tracked files of exactly the half its runner was handed, never a superset of them, so the two
  counts agree by construction.
- **The link between the halves can never break.** Every functional test is written with its
  assertion twin, the two sharing an id. A dev-only drift script runs in pre-commit and fails the
  commit when a tracked test file belongs to no bucket, when a functional test changes without its
  twin, when either half is missing, or when a certified module's files changed without a fresh
  functional run.
- **Certification is recorded, not remembered.** A record of "the functional suite passed, for
  module M, over this content" is written by one dev-only runner (`scripts/test/certify.mjs`, plain
  Node, in the test tree and not shipped) and checked mechanically at commit time. Three months
  without touching git costs zero functional runs; the day the reflog handling changes, the gate
  demands one and refuses an assertion as a substitute.
- **The output-integrity sweep moves buckets.** `scripts/test/output-interpolations.test.mjs` is
  25 scenarios that each re-sweep 58 source files; one sweep alone measures **6.7 s wall / 1.5 s CPU**
  for 1,497 interpolations. It certifies a property of the SOURCE and calls no git and no engine, so
  it is neither half's: it moves to `scripts/test/sweeps/`, runs only when engine source changes, and
  its run — `node scripts/test/certify.mjs sweeps` — writes the record entry that gates an
  engine-source edit. Nothing else produces that entry, so the refusal names that command.
- **The three places that run the old suite command are updated**: `.githooks/pre-commit`,
  `.github/workflows/ci.yml`, and the `release-checklist` skill's Real Numbers recipe (which
  computes the published test count from that command). Three more quote it in prose and go stale
  the same way without failing anything: `CONTRIBUTING.md` (three sites), this repository's own
  `CLAUDE.md` (two), and the `pr-workflow` skill (two) — enumerated with
  `rg -n --hidden 'node --test' --glob '!scripts/**'`, which is also why the enumeration needs
  `--hidden`: three of those files live under `.claude/skills/`. `ci.yml` needs a second, separate
  fix — its syntax loop (`for f in scripts/lib/*.mjs scripts/test/*.mjs`, line 32) does not descend
  either, so a file moved under `scripts/test/assert/` stops being syntax-checked altogether.

## Capabilities

### New Capabilities

- `engine-invocation`: what an in-process caller passes the engine, what the engine returns, and the
  guarantee that the status it returns is the status the CLI exits with — for every refusal class the
  engine has.
- `suite-certification`: how the repository's test suite is divided into a per-commit assertion half
  and a triggered functional half, how the two halves are held together by a shared id, and how a
  claim that the functional half passed is recorded and mechanically checked instead of remembered.

### Modified Capabilities

- None. Every existing capability's requirements describe behaviour that does not change: `verb-surface`
  still requires that a refused command line exits 1 and writes nothing, and it still does — the code
  simply arrives at the CLI as a value `main()` returns rather than as a call to `process.exit`.
  `engine-invocation` names that equivalence without restating `verb-surface`'s refusal classes, so
  the two capabilities do not double-own the same behaviour.

## Impact

- **Engine source**: every module under `scripts/lib/` (50 modules import `constants.mjs`; 17
  reference `ROOT`). The conversion is mechanical and large — see `design.md` D2/D3 for the measured
  site counts — and it is the dominant cost of this change.
- **CLI contract**: unchanged. Same verbs, same flags, same exit statuses, same stdout/stderr. `evals/`
  (`observe.py`, `fixtures.py`) and `hooks/hooks.json` keep spawning the binary exactly as today.
- **Repo tooling**: `.githooks/pre-commit`, `.github/workflows/ci.yml`, the `release-checklist` repo
  skill, and two new dev-only files, both in the test tree and neither shipped: the drift script and
  the runner that writes the certification record (`scripts/test/certify.mjs`).
- **Dev-only dependencies**: none. The drift script is plain Node, like the engine.
- **`state.json` schema**: untouched. No migration.

Measurement commands behind the numbers above:

```
ls scripts/test/*.test.mjs | wc -l                                     # 80
rg -c '^test\(' scripts/test/*.test.mjs | awk -F: '{s+=$2} END {print s}'   # 1831
rg -o '\brun\(' scripts/test/*.test.mjs scripts/test/helpers.mjs | wc -l    # 2402
rg -o 'gitRepo\(|gitInitWithCommit\(|commitFiles\(' scripts/test/*.mjs | wc -l  # 116
rg -n --glob '!test/**' -e 'execFileSync\(' -e 'execSync\(' scripts    # 23 git invocations, 7 modules
rg -o 'process\.argv' scripts/lib | wc -l                              # 46
rg -o 'process\.stdout\.write' scripts/lib | wc -l                     # 30
rg -o 'process\.stderr\.write' scripts/lib | wc -l                     # 248
rg -o 'process\.exit\(' scripts/lib | wc -l                            # 194
```

The suite's dynamic spawn count (the brief cites 2,526) is a runtime quantity and was NOT measured
here; only static call sites were. `design.md` records that distinction and does not depend on the
dynamic figure.
