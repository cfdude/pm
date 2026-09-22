# Proposal

## Why

0.47.0 removed the process boundary from the assertion half and left a number it did not explain: the
half still takes **86.0 s, 67.8 s and 75.2 s** across three runs today (Node v26.9.0, this machine;
`node --test --test-isolation=none scripts/test/assert/*.test.mjs`, `ℹ duration_ms`), for **88 files
and 1,243 tests**. That is ~55–70 ms per test with no `node` boot and no real git anywhere in it — and
the explanation in circulation (`each test rebuilds a repository: init + N add-epic + render ≈ 6 engine
round trips, ~60–95 ms`) does not survive measurement.

**What the time actually is: `fsync`. One run performs 12,524 `fsyncSync` calls.** With
`fs.fsyncSync` replaced by a no-op as a causal control, the SAME 1,243 tests all pass in **9.11 s**
against a **73.9 s** baseline — **8.1×** — and the only thing changed was the syscall. (The **6.47 s
/ ≥10×** first written here does NOT reproduce; Gate 1 measured the control twice and got 9.11 s. See
design D10 for what that does to the acceptance.) On this machine one
write+`fsync`+close costs a median **3.3 ms in a tmpdir and 3.5 ms in this repo's own directory**
(n=60 each), so the 12,524 calls are the wall clock and the engine's decisions are not.

The engine's own verbs confirm it, and the picture is the opposite of the one assumed:

| operation | as it runs today | with `fsyncSync` no-op'd | fsyncs |
|---|---|---|---|
| `init`, fresh dir | 37.2 ms | 2.62 ms | 8 |
| `add-epic` (0 epics present) | 11.2 ms | 0.92 ms | 2 |
| `add-epic` (260 epics present) | 17.5 ms | — | 2 |
| `owingRepo()` — init + 2 add-epic + set-active + push + pop | 124.9 ms | 6.65 ms | 18 |
| `render` / `brief` / `sync`, initialised dir | 0.30 / 0.66 / 0.39 ms | — | 0 / 0 / 0 |
| `mkdtemp` | 0.32 ms | — | 0 |

(medians, n=7–20, in-process through the assertion half's own harness and git double.) **A state load,
a render and a PROJECT.md write are sub-millisecond.** So the cost is not "engine setup re-done
thousands of times" and not the filesystem as such — `mkdtemp` is 0.32 ms, as 0.47.0 already found.
It is specifically the **durability** term: `saveState()` fsyncs the temp file before its rename and
then fsyncs the directory (`scripts/lib/state.mjs:702`, `:726`), and every verb in this engine ends by
calling it. A test asserting on the shape of a state object pays for a power-loss guarantee it does
not need, 12,524 times a run.

0.47.0 made the cheap fix (no process) and exposed the expensive one. This change takes the expensive
one.

## What Changes

- **A UNIT RUNG — a fourth home, `scripts/test/unit/`, for tests whose observable is a VALUE the
  engine produced — a verb's result, a refusal, or any value the record holds.** The
  engine's DECISIONS are separated from its PERSISTENCE by a **store seam**, the same dependency-
  injection move the git gateway made in 0.47.0: a verb reads a state object, produces a result, and
  the layer that loads / saves / renders is **injected** rather than reached through module-scope
  paths. A unit test hands in a state object and gets a result back — no tmpdir, no `fsync`, no
  render, no disk. An in-memory store is the seam's test implementation, and it is why the rung's
  tests cost ~1 ms instead of ~70. **The rung's home is the record's VALUES, not its file** (C1):
  **60 of the assertion half's 88 files — 1,016 of its 1,243 tests, 82% — assert on the values in
  `state.json`**, and a file-rung rule that named "the `.conductor/` record" would strand all of them
  on disk with their fsyncs intact.
- **FIXTURE SNAPSHOTS for what stays integration-shaped.** A repository is built ONCE per file
  (`owingRepo()` and friends), its state captured, and restored per test. Measured: restoring a built
  six-file fixture of **≈34.7 KB** (34,711–34,712 bytes across runs — the count moves with the
  timestamps the fixture records) with `fs.cpSync` costs a median **~1.0 ms** (measured 1.03–1.15,
  min 0.78, p90 1.26, n=20) against **124.9 ms** to rebuild it — and rebuilding it is what the 1,200
  tests do today. (The **34,607 bytes / 8.80 ms** first written here did not reproduce; the
  re-measurement favours the design.) Restore is a copy: no `fsync`, no engine, no render.
- **The store seam is the `.conductor/` store, not just `state.json`.** Sizing the migration from
  today's disk shows why a state-only seam would strand the half: of 1,243 tests, **1,098 live in
  files that read `.conductor/state.json`** (67 files), **543 read `PROJECT.md`** (30), **251 read
  `CLAUDE.md`** (14), 134 read `detours.log` (7), 79 the activity log (4), 72 `write-conflicts.log`
  (2), 61 `honcho-memories.log` (2), 44 `render-stamp.json` (2), 23 `.changesets/` (1), 19 `brief.txt`
  (2). A seam that covered only `state.json` would reach under half of them. So the store owns every
  file the engine WRITES into the record directory plus `PROJECT.md` — including the three the first
  pass of the ownership table missed (C1/I1): **`.conductor/session-claim.json`**
  (`claims.mjs:104-110`), **`.conductor/commit-observe.json` and its `.lock`**
  (`commit-watch.mjs:191`, `:242-243`), and **`.conductor/write-conflicts.log.prev`**
  (`write-conflicts.mjs:35`) — and a statement of what it does NOT own (below).
- **The unit rung is a home, not a third half.** Its files run in the SAME single Node process and on
  the SAME per-commit trigger as the assertion half, so nothing about the two-halves contract or the
  functional trigger moves. What changes is the enrolment enumeration (four directories, not three), the
  pre-commit floor's declared set (now two globs the runner was genuinely given), and CI's switch to
  `--test-isolation=none` — which 0.47.0 left unverified on Node 18 because it could not probe that
  binary, and which this change probes on the pinned version before relying on it.
- **The failure modes are guarded, not assumed.** The no-spawn/no-git guard gains a sibling: a unit-rung
  file SHALL do no filesystem work at all (no `node:fs`, no write, no `fsync`), so the rung cannot
  quietly drift back into being an assertion test. The store seam carries its own conformance check —
  the store the CLI actually uses SHALL produce byte-identical `PROJECT.md` to the one produced before
  the seam, which is the regression the seam can most easily hide.

Measured results this change commits to, both captured in this change directory: the assertion half's
per-file and per-test baseline BEFORE, and the same table AFTER, with the pre-commit hook's wall time
named at both ends. The acceptance is **sub-15-second pre-commit for the FULL assertion half** and
unit-rung tests at **~1 ms**, with the value-observing population that migrates expected under 10 s
on its own (design D10 — the reproducible control is 9.11 s, 8.1×, and it is an UPPER bound because it
removes every flush, so it does not license a sub-10 s target for the whole half).

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `suite-certification`: the suite is divided into two halves, and this change gives the ASSERTION half
  two rungs — a unit rung whose tests observe values and touch no disk, and the existing assertion rung
  whose tests observe files. Three requirements change: *"The suite has two halves with different
  triggers and different costs"* (the per-commit trigger now runs both rungs, and the assertion half's
  on-disk shape is stated as rungs rather than one directory); *"Every tracked test file has exactly one
  home, and the floor counts what the runner was given"* (the home enumeration gains `scripts/test/unit/`
  as a fourth name, and the floor's declared set is restated for an invocation given two globs); and
  *"The assertion half spawns no process and runs no git"* (the guard's scope gains the unit rung, whose
  extra prohibition is filesystem work of any kind). Two requirements are ADDED: the fixture snapshot,
  and the end-to-end reporting of the half's wall clock as a recorded number rather than a remembered
  one.
- `engine-invocation`: the store is a value the caller supplies per call, like the argument list, the
  working directory and the streams. This is ADDED as its own requirement rather than woven into
  *"Every global the engine reads is supplied per call"*, so that requirement's existing scenarios stay
  true unchanged — and the CLI contract itself is untouched: `main(argv, io)` is still synchronous, and
  the store the binary builds is the disk store.

## Impact

- **Engine source**: a new `scripts/lib/store.mjs` (the seam and the disk implementation) plus the
  memory implementation used by tests; `scripts/lib/state.mjs` (`saveState`/`loadState`/`readStateFile`,
  `:258`, `:272`, `:630`), `scripts/lib/render.mjs` (`:32`, `:325`, `:366`), `scripts/lib/subcommands.mjs`
  (`:1037`), `scripts/lib/git.mjs` (`:134`, `:193`), `scripts/lib/write-conflicts.mjs` (`:48`, `:98`),
  `scripts/lib/activity-log.mjs` (`:171`), and the ~20 verb modules that call `loadState()`/`saveState()`
  — **137 call sites of `loadState()`/`saveState()`** across `scripts/lib/` and `conductor.mjs`, of
  which 19 are in `update-epic.mjs`, 12 in `subcommands.mjs` and 9 in `detour-stack.mjs` (derived with
  `rg -o -e '\bloadState\(\)' -e '\bsaveState\('`, not typed — `-o`, not `-c`, which counts LINES and
  reports 135 and 11 respectively).
- **CLI contract**: unchanged. Same verbs, same flags, same exit statuses, same bytes. `main(argv, io)`
  stays synchronous and keeps returning its status (`openspec/specs/engine-invocation/spec.md`).
- **Repo tooling**: `.githooks/pre-commit` (a second glob and its floor), `.github/workflows/ci.yml`
  (a fourth bucket step plus the isolation flag), `scripts/test/certification.mjs` (`homeOf`'s regex and
  the enrolment claim), `scripts/test/drift.mjs` (whatever check the new rung needs), `CONTRIBUTING.md`
  (the dev inner loop), `CLAUDE.md`'s `Tests:` bullet, and the `pr-workflow` and `release-checklist`
  skills.
- **Test tree**: `scripts/test/unit/` (new), `scripts/test/fixtures/` (the snapshot helper and a memory
  store the unit rung binds), plus the per-test migration of the existing assertion half.
- **Dev-only dependencies**: none. The store seam and the snapshot helper are plain Node.
- **`state.json` schema**: untouched. No migration.

Measurement commands behind every number above, all run 2026-09-21 at `ab171b7`:

```
node --test --test-isolation=none scripts/test/assert/*.test.mjs        # tests 1243, duration_ms 86000/67759
preload: fs.fsyncSync = wrapped counter; then the same command          # fsyncSync calls in this run: 12524
preload: fs.fsyncSync = () => {};       then the same command          # duration_ms 9112, 1243/1243 pass
node scripts/test/drift.mjs --root "$PWD"                              # 0.115 s wall
```

The preloads, the per-verb timings, the observable census and the `cpSync` measurement are kept in
this change directory rather than restated from memory.
