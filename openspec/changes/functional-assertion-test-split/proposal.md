# Proposal

## Why

The suite this repository gates every commit on has become the slowest thing in the repository, and
it got there by measuring the same way a hundred times over. Measured on the engine at 319b05d
(2026-09-20, commands in `impacts.md`-style form at the end of this proposal):

- **80 test files** (`ls scripts/test/*.test.mjs | wc -l`) declaring **1,831 top-level `test()`** and
  2,029 `test()` calls including nested ones.
- **~2,533 static call sites** of the two spawn helpers (`run(` 2,402 + `runCombined(` 131), each of
  which boots a fresh `node` process. One engine invocation measured **0.68–0.72 s wall** on this
  machine (`time node scripts/conductor.mjs --help`), of which ~0.38 s is node's own boot
  (`time node -e '1'`).
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
  `scripts/lib/constants.mjs:12` with six path constants derived from it at module load
  (`:13`, `:42`, `:43`, `:44`, `:46`, `:52`); `scripts/lib` reads `process.argv` at 46 sites,
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
  invocations stay real spawns.
- **The link between the halves can never break.** Every functional test is written with its
  assertion twin, the two sharing an id. A dev-only drift script runs in pre-commit and fails the
  commit when a functional test changes without its twin, when either half is missing, or when a
  certified module's files changed without a fresh functional run.
- **Certification is recorded, not remembered.** A record of "the functional suite passed, for
  module M, over this content" is written by the functional runner and checked mechanically at
  commit time. Three months without touching git costs zero functional runs; the day the reflog
  handling changes, the gate demands one and refuses an assertion as a substitute.
- **The output-integrity sweep moves buckets.** `scripts/test/output-interpolations.test.mjs` is
  25 scenarios that each re-sweep 58 source files; one sweep alone measures **6.7 s wall / 1.5 s CPU**
  for 1,497 interpolations. It certifies a property of the SOURCE, so it runs when engine source
  changes, not on every commit.
- **The three places that run the old suite command are updated**: `.githooks/pre-commit`,
  `.github/workflows/ci.yml`, and the `release-checklist` skill's Real Numbers recipe (which
  computes the published test count from that command).

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
  skill, and the new dev-only drift script.
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
