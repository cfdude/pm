# Design

## Context

0.47.0 split the suite in two and made the assertion half run in ONE process on an injected git
double. It worked, and it left a number behind: the half is still slow, and the reason in circulation
is wrong. Everything below is measured on this machine on 2026-09-21 at `ab171b7` (Node v26.9.0),
in-process through the assertion half's OWN harness and git double (`fixtures/assert-harness.mjs`),
so the numbers are the half's numbers and not a spawn tax reintroduced for the measurement. The
scratch scripts and raw output are in this change directory.

### What the assertion half costs today

| measurement | value |
| --- | --- |
| files / top-level tests | 88 files / 1,243 tests |
| wall clock, three runs | 86.0 s, 73.8 s, 67.8 s (`ℹ duration_ms`) |
| sum of the 1,243 per-test durations | 73.7 s — i.e. the tests ARE the wall clock, serial |
| per-test median / p90 / p99 | 51.4 ms / 101.5 ms / 213.7 ms |
| tests over 100 ms / over 200 ms | 133 / 22 |
| slowest single test | 1,177.9 ms (`gh-84: re-claiming as the SAME session …`) |
| `fsyncSync` calls in one run | **12,524** |
| same run, `fs.fsyncSync` replaced by a no-op | **6.47 s, 1,243/1,243 pass** |

### The causal control, and why the received explanation does not survive it

Replacing one syscall with a no-op — changing nothing else, with all 1,243 tests still passing — takes
the half from 73.8 s to 6.47 s. That is the whole result. The received explanation (`each test rebuilds
a repository; ~6 engine round trips; ~60–95 ms per test`) is not what the numbers show:

| operation | today | with `fsyncSync` a no-op | fsyncs |
| --- | --- | --- | --- |
| `init`, fresh dir | 37.2 ms | 2.62 ms | 8 |
| `add-epic`, 0 epics present | 11.2 ms | 0.92 ms | 2 |
| `add-epic`, 260 epics present | 17.5 ms | — | 2 |
| `owingRepo()` — init + 2 add-epic + set-active + push-detour + pop-detour | 124.9 ms | 6.65 ms | 14 |
| `render`, initialised dir | 0.30 ms | — | 1 |
| `brief`, initialised dir | 0.66 ms | — | 0 |
| `sync`, initialised dir | 0.39 ms | — | 0 |
| `mkdtemp` | 0.32 ms | — | 0 |
| one `open`+`write`+`fsync`+`close` | 3.3 ms (tmpdir) / 3.5 ms (this repo) | — | 1 |

(medians; n=7–20 for the verbs, n=60 for the raw syscall; a separate n=200 run of the raw syscall read
4.88 ms.) So *engine setup* is not the cost: a state load is sub-millisecond and a render is 0.30 ms.
`init` performs EIGHT flushes and `add-epic` two — `saveState()` fsyncs the temp file before its rename
(`scripts/lib/state.mjs:702`) and then fsyncs the directory (`:726`), and every verb in this engine ends
by calling it — and with those flushes removed `init` costs 2.62 ms and `add-epic` 0.92 ms. **The half's
cost is durability paid on tests that assert on a value.**

**Honest arithmetic, because the two figures do not reconcile exactly.** 12,524 flushes at the measured
3.3 ms is 41 s, while the observed delta between the baseline (73.8 s) and the control (6.47 s) is
67 s. The per-syscall median was taken on an idle-ish loop of one call at a time; at 12,524 calls
interleaved with writes, renames and directory opens the effective cost is higher. The CONTROLLED
number — same command, same tests, one syscall replaced — is the load-bearing one; the per-call median
is why it is large, not a prediction of it.

Nothing here proposes weakening that guarantee. It is exactly right for a real invocation and it is
exactly wrong for a test that hands in a state object and reads a result back.

### What the tests actually observe

Sizing the migration from today's disk, because it decides what the seam must own:

| artifact | files | tests in those files |
| --- | --- | --- |
| `.conductor/state.json` | 67 | 1,098 |
| `PROJECT.md` | 30 | 543 |
| `CLAUDE.md` (managed rules block) | 14 | 251 |
| `detours.log` | 7 | 134 |
| activity log | 4 | 79 |
| `write-conflicts.log` | 2 | 72 |
| `honcho-memories.log` | 2 | 61 |
| `render-stamp.json` | 2 | 44 |
| `.changesets/` | 1 | 23 |
| `brief.txt` | 2 | 19 |
| (files that observe no filesystem at all) | 3 | 12 |

(overlapping; a file appears once per artifact it reads.) A seam that covered `state.json` alone would
reach under half the half. That table is the reason the store below is the `.conductor/` store and not
a state-file wrapper.

### What 0.47.0 already established, and what must not move

`openspec/specs/suite-certification/spec.md` and `openspec/specs/engine-invocation/spec.md` are the
two main specs the previous change shipped. Every constraint below is taken from them rather than
restated: the assertion half runs in one process, spawns nothing and runs no git; every tracked test
file has exactly one home; the floor counts what the runner was GIVEN; every functional id has an
assertion twin and the converse is deliberately not a refusal; the git double is byte-certified; the
certification record is keyed on content, not age. `main(argv, io)` is synchronous and returns its
status; the CLI's observable behaviour is unchanged; the double's certification test stays as it is.

## Goals / Non-Goals

**Goals.** Give the assertion half a rung whose tests cost what their subject costs; stop paying a
durability flush per assertion on tests that assert on a value; keep the fixture-shaped tests fast
without weakening what they observe; drive the pre-commit gate under ten seconds; document the inner
loop so a contributor's first run is fast by default; leave CI's buckets, floors and triggers exactly
as they are except where the new rung forces a name to be added.

**Non-Goals.** Making the functional half faster (its cost is real git and its trigger is right).
Rewriting `main(argv, io)` or the CLI contract. Converting the 1,243 tests by hand in one commit.
Making the engine's persistence lazy, optional, or weaker for real invocations. Introducing a test
runner, a mocking library, or any dependency — the engine stays zero-runtime-dependency and this
change adds no dev dependency either.

## Decisions

### D1 — The seam is a STORE, injected per call, and it is the `.conductor/` store

The same move the git gateway made in 0.47.0: the engine stops reaching its persistence through
module-scope paths and receives it from the invocation instead. `invocation()` already carries the
per-call context (`scripts/lib/invocation.mjs`); the store joins it beside `git`.

One module, `scripts/lib/store.mjs`, owns the interface and the disk implementation. What it owns,
derived from the write sites rather than listed from memory:

| artifact | written today at |
| --- | --- |
| `.conductor/state.json` | `scripts/lib/state.mjs:630` (`saveState`), read `:258`/`:272` |
| `PROJECT.md` | `scripts/lib/render.mjs:325` |
| `.conductor/render-stamp.json` | `scripts/lib/render.mjs:366` |
| `.conductor/detours.log` | `scripts/lib/git.mjs:134`, `:193` (append) |
| `.conductor/write-conflicts.log` (+ `.latch`) | `scripts/lib/write-conflicts.mjs:48`, `:98` |
| `.conductor/honcho-memories.log` | `scripts/lib/subcommands.mjs:1037` |
| `.conductor/activity/*` | `scripts/lib/activity-log.mjs:171` |
| `.conductor/brief.txt` | `scripts/lib/subcommands.mjs:156` (the `snapshot` verb) |

**What the store does NOT own, stated so the omission is deliberate and not an oversight**: `CLAUDE.md`
and its managed rules block (written by `scripts/lib/rules.mjs`; it is a repository file and not part
of the conductor record), `.gitignore` line management (`scripts/lib/platform.mjs`), `.changesets/`,
and every read of the repo the engine performs rather than writes (openspec `tasks.md` checkboxes,
`docs/lessons/`, plugin metadata). Those 251 CLAUDE.md-observing tests and the 23 `.changesets/` ones
therefore stay on the file rung — they are a minority and they are genuinely integration-shaped.

**What changes signature.** The seam is a `Store` value carried by the invocation, and the ~20 verb
modules change ONE thing: how they obtain it. Concretely, the functions that keep their names and
change where their I/O comes from:

- `scripts/lib/state.mjs`: `loadState()` `:272`, `saveState(state, opts)` `:630`, `readStateFile(p)`
  `:258` — every call site stops reading `getPaths()` (`:21`) and takes the store's record operations.
  **137 call sites of `loadState()`/`saveState()`** across `scripts/lib/` and `conductor.mjs` (19 in
  `update-epic.mjs`, 11 in `subcommands.mjs`, 9 in `detour-stack.mjs`), derived with
  `rg -c -e '\bloadState\(\)' -e '\bsaveState\('`.
- `scripts/lib/render.mjs`: `render()` `:32`, `writeRenderStamp()` `:354` — the render becomes
  "produce the artifact's text from this state", and the store decides whether it lands on disk, in
  memory, or nowhere. The text-producing code is unchanged, which is what makes the byte-parity
  requirement in this change's `engine-invocation` delta checkable.
- the four append-only logs (`git.mjs`, `write-conflicts.mjs`, `subcommands.mjs`, `activity-log.mjs`)
  become store appends.

Bodies are otherwise untouched. That is the point: a seam that required rewriting 20 verbs would be a
different, much larger change, and the verbs' logic is precisely what the unit rung exists to test.

### D2 — The unit rung is `scripts/test/unit/`, a fourth home inside the assertion half

Not a third half. It runs in the same process, on the same per-commit trigger, as `assert/`. Reasons:

- The spec's two-halves division is about TRIGGERS, and this rung needs no trigger of its own — it is
  cheap enough to run every commit, which is the assertion half's defining property.
- No twin obligation is created. The twin rule is one-directional and bound to the functional half; a
  rung that demanded functional twins would either invent empty ones or drag the whole rung into the
  triggered half.
- The change to the specs is then three MODIFIED requirements and two ADDED ones, rather than a
  re-foundation of the taxonomy.

`scripts/test/certification.mjs:63`'s `homeOf()` regex —
`/^scripts\/test\/(assert|functional|sweeps)\/[^/]+\.test\.mjs$/` — gains `unit` as a fourth
alternative and nothing else. `EXCLUSIONS` (`:53`) stays empty; the claim that every tracked test file
has a home is what makes the new directory mandatory rather than optional.

### D3 — The floor's declared set becomes a LIST of rungs, and the invariant is the same one

`suite-certification` states the invariant precisely: what the floor compares is what the runner RAN
against what the runner was GIVEN, never a superset. Today the hook enumerates one rung from
`git ls-files 'scripts/test/assert/*.test.mjs'` (`/.githooks/pre-commit:154`). If the per-commit
runner is handed two globs in ONE invocation — which is the right shape, because it is one Node
process — then the declared count is the tracked files of exactly those two globs:

```
declared=$(git ls-files 'scripts/test/unit/*.test.mjs' 'scripts/test/assert/*.test.mjs' \
  | while IFS= read -r f; do grep -c '^test(' "$f" || true; done | awk '{s+=$1} END {print s+0}')
```

This is NOT the shape the hook's own comment forbids (`/.githooks/pre-commit:144`: enumerating over
BOTH HALVES aborts every commit). That trap is enumerating a set the runner was not given; here the
set IS what the runner was given, so the two counts agree by construction on a healthy tree and can
disagree only in the direction the floor exists to catch. The distinction is written into the
requirement's new text and into a new scenario so a later reader cannot re-derive the wrong rule.

Two consequences to accept deliberately: a file RENAMED from `assert/` to `unit/` does not change the
declared count (correct — it still runs), and a file renamed OUT of both still drops from both sides
of the floor, which is exactly why `drift.mjs`'s enrolment check (check 1) is the real backstop and
must stay.

### D4 — The unit rung's guard: no filesystem work, enforced at the source and at run time

`scripts/test/assert/assert-half-has-no-spawn.test.mjs` already has the two shapes this needs, and
both are reused rather than reinvented:

- **A source scan** (`violations()`, `:76`) over the rung's directory, extended with a second
  predicate: an import of the filesystem module, or a bare call to a write/open/create/remove/flush
  name. It keeps the existing properties that made the first guard survivable — comments are stripped
  (`stripComments`, `:52`) so documenting the rule is not a violation, and the forbidden tokens are
  BUILT FROM PARTS so the guard is not its own first violation.
- **A run-time counter**, the same trick as the git PATH shim (`fixtures/assert-git-shim.mjs`): a
  preload (or a shim module imported by the unit rung's harness) that wraps `fs`'s write-side entry
  points and fails the run when the count is not zero. The source scan cannot see a write reached
  three modules away — that is exactly the hole 0.47.0's Gate 2 found in the git guard (`G-I4`, the
  reason the run-time shim exists at all) — so the same two-layer answer is used here, and the
  reasoning is not re-derived from scratch.
- **Discrimination** as a test, not a hope: the guard's check is exercised directly against a source
  that imports `node:fs`, one that calls a write, and one that only names either in a comment. 0.47.0
  wrote this lesson down (`docs/lessons/a-guard-can-check-the-wrong-half.md`); this change inherits it.

`fs` is a singleton across the whole single-process half (`helpers.mjs:73` says so in as many words,
which is why `injectConflictOnce` has to restore it), so the counter is process-wide and its
assertion has to be read the same way the git shim's is: as a fact about the run, plus a listener that
fails the half.

### D5 — Fixture snapshots: build once per file, restore by copy

`owingRepo()` is defined three times — `assert/gate-guard-write-paths.test.mjs:277`,
`assert/reconcile-obligation.test.mjs:48`, `functional/conformance.test.mjs:60` — and each rebuilds a
four-verb repository per call. Measured: **124.9 ms** per build today, **6.65 ms** with the flushes
removed but the engine still running, and **8.80 ms** median (min 1.79, p90 14.57, n=20) to restore a
built six-file, 34,607-byte fixture with `fs.cpSync`.

The design is a `fixtureOnce()` helper in `scripts/test/fixtures/`:

- built **once per file**, lazily, on first use;
- the built tree kept in a `mkdtemp` *template*, never mutated;
- each test gets a fresh copy — `fs.cpSync(template, dst, { recursive: true })` — and the previous
  test's copy removed;
- restore performs no `fsync` and starts no engine, which is what the requirement pins.

**Why a copy and not an in-process state object.** The tests on this rung assert on FILES — 1,098 of
them read `state.json`, 543 read `PROJECT.md` — so the restored thing has to BE a filesystem, not a
state value. That is precisely why the two goals are different mechanisms and not one: the unit rung
replaces the filesystem with a store, and the snapshot rung keeps the filesystem but stops rebuilding
it.

**The mutation-leak hazard is the same in both.** A template that a test can mutate corrupts every
later test in the file, and it does so silently — the later tests pass against a mutated premise. So
the template is never handed out directly, and a test asserts exactly that: two tests in one file, the
first mutating the restored fixture, the second reading the fixture's original values. (The same
hazard exists for the in-memory store: a state object SHARED between unit tests leaks the same way,
which is why the memory store hands out a fresh copy or is re-seeded per test, and why that has its
own scenario.)

**Cost discipline.** A template is ~35 KB today and grows with the managed rules block; the helper
SHALL NOT be used where a file builds one repository and uses it once, since the copy would cost more
than the build. The rule is "a fixture used by more than one test in a file", not "every fixture".

### D6 — The migration of the 1,243 tests is PER FILE, chosen by observable, and not a codemod

A codemod is the wrong tool and the numbers say why. The mechanical part of the change is the SEAM,
which is engine-side and lands once. The test-side move is a judgment per file: which of this file's
tests observe a value and which observe a file. A regex that rewrote `run([...])` into a store call
would produce files that compile and assert less — the failure this whole repository's lesson set is
about — and it would do so 88 times in one commit with no per-file review.

So: **one file per commit**, its tests sorted into the two rungs by observable, its assertions
UNCHANGED. Two ordering constraints make that safe:

1. The unit rung and the store land FIRST, with a small number of hand-written proofs (D7), so the
   seam is exercised before anything migrates onto it.
2. The fixture helper lands BEFORE the file rung's rebuilds are converted, so the snapshot rung is
   proven on one file before 87 depend on it.

The work is mechanical AFTER the rung exists but it is not MECHANISABLE, and the change says so
instead of promising a big-bang rewrite. A file's rung membership is a decision per test, which is
also what makes the `suite-certification` requirement "a test whose observable changes moves rungs in
the same commit" a rule a contributor can actually follow.

### D7 — A small number of tests prove the seam before anything migrates

The seam's own tests are hand-written and few: one per verb family that uses the store (a state verb,
a render verb, an append-only log verb), each asserting that the same invocation produces the same
status and the same record through the memory store and the disk store. Their job is to make the seam
provable to a reviewer in one screen, which is what lets the 88 per-file commits be small.

They also carry the **byte-parity check**: render the same record through both stores and compare the
bytes. That is the one regression the seam can hide best — a render that changed because it now reads
from an injected object rather than a path — and it is the failure mode named in this change's own
risk list.

### D8 — The drift script gains exactly one check, and the enumeration moves in one place

`drift.mjs`'s four checks (`:111`, and the header's table at `:16`) are enrolment, twin coverage, diff
coupling and record freshness. The new rung needs **no new check** — it is a member of the assertion
half, so twin coverage and record freshness do not reach it, and the diff-coupling rule is keyed on
the functional half. What the rung changes is one CONSTANT: `homeOf()`'s regex
(`certification.mjs:63`), which is the single derivation both `drift.mjs` and its tests read.

What it DOES need is a **guard that the rung did not silently empty**. Check 1 refuses a file with no
home; it does not notice a rung that has become empty, and an empty rung runs zero tests while every
floor passes, because the declared count is enumerated from the same empty set. 0.47.0 already met
this exact failure in the spawn guard, whose first assertion is
`assert.ok(files.length > 40, "a walk over an empty or nearly-empty directory is not a check")`
(`assert/assert-half-has-no-spawn.test.mjs:94`). The same non-vacuity assertion is added for the unit
rung, with its floor raised as the rung fills — a number in the test, not a rule in a document.

### D9 — CI: add the rung's step, and probe the isolation flag on the pinned Node first

`ci.yml` runs three buckets with a floor each (`:74`, `:98`, `:115`), each enumerated from its own
tracked files. The unit rung is part of the per-commit assertion half, so CI runs it in the SAME step
as the assertion half — one runner invocation given both globs, one floor over both, exactly as the
hook does. That keeps CI's shape ("each bucket's floor is enumerated from that bucket's own tracked
files") while honouring the floor's actual invariant (the set the runner was given).

CI also carries 0.47.0's deliberate deferral: `--test-isolation=none` is in the hook and NOT in CI,
pinned to `node-version: "18"`, because that binary could not be probed. The comment at `ci.yml:75`
says the fix is to bump the version and add the flag in the same commit once probed. This change
probes it, and either bumps-and-adds or leaves it and says so — but it does not leave a `TODO` whose
author is gone. CI's wall clock is the reason it matters: per-file isolation means one Node boot per
file per bucket.

### D10 — The measurement is a task, and the number is the acceptance

The change's own acceptance is a number, and both ends of it are captured in this change directory:

- **before**: the three wall-clock runs above, the 1,243-per-test duration distribution (median
  51.4 ms, p90 101.5 ms, 133 tests over 100 ms), the fsync count (12,524), and the no-op control
  (6.47 s);
- **after**: the same four measurements, plus the hook's wall clock (today: the drift script is
  0.115 s, and the half is 67.8–86.0 s, so the hook is the half).

The target is **sub-10-second pre-commit** and **~1 ms unit tests**. The 6.47 s control says the target
is reachable without changing a single assertion, which is why it is stated as an acceptance rather
than an aspiration. The commit that reports each measurement is named in `tasks.md`.

### D11 — The dev inner loop is documented, not built

`CONTRIBUTING.md` gains the loop and `CLAUDE.md`'s `Tests:` bullet (`:27`) is re-pointed at it, because
those two are the surfaces a contributor and an agent actually read. `node --test --watch` on the
assertion half is the natural loop once the half is fast; naming a single file is the loop before that
lands. The quickstart (clone → `npm i` → test) is verified by running it, not by describing it —
`package.json` does not exist in this repository today (the certify runner's header says so at
`scripts/test/certify.mjs:5`), so if the quickstart needs one, adding it is a decision this change
makes explicitly rather than a step it assumes.

## Risks / Trade-offs

1. **The seam hides a render regression.** The highest-probability defect: `PROJECT.md`'s bytes change
   because the render now reads an injected object. Mitigated by D7's byte-parity check across both
   stores, and by the fact that `render()`'s markdown-building code is not edited — only where its
   output goes.
2. **A `--force`/revision-guard bypass.** `saveState()` reads `currentArgv()` directly for `--force`
   (`state.mjs:663`). A memory store that does not reproduce the revision comparison would let a unit
   test assert behaviour no real invocation has. Mitigated by the memory store implementing the SAME
   revision and no-op comparisons — it is a different sink, not a weaker engine — and by one seam test
   asserting that a stale revision is refused through it.
3. **Two rungs make the rung boundary arguable.** A test can be described both ways ("it reads the
   state object, which is what the file holds"). The rule is the observable, stated in the spec, and
   the unit rung's guard makes the wrong side LOUD for one direction. The other direction is a slow
   test, not a wrong one.
4. **The snapshot's template is a shared mutable premise.** Covered by D5's copy discipline and its
   leak test, but it is a new hazard that did not exist when every test built its own tree. It is the
   same class of bug as the `fs` singleton trap `helpers.mjs:73` already documents, which is why the
   guard is written rather than trusted.
5. **Per-file migration takes 88 commits.** Slow, and honestly stated rather than compressed. The
   counter-argument for a big-bang codemod is D6: it would rewrite assertions it does not read.
6. **The new rung can drift into being a second file rung.** Mitigated by D4's two-layer guard and
   D8's non-vacuity assertion. A rung that becomes slow is not detected by any floor — the floor counts
   tests, not time — which is why D10 makes the number a task rather than a hope.
7. **A `fs`-wrapping counter is process-global.** Same shape as the existing git shim, same mitigation
   (assert the fact directly AND fail the process at the end), same known limit: a write reached
   through a module that captured `fs`'s functions before the wrapper was installed would be missed.
   Named rather than claimed closed.

## Migration Plan

1. **The store seam** (engine-side, no test moves): `scripts/lib/store.mjs`, the invocation carrying
   it, the ~20 verbs reading it, the four append-only logs, `state.mjs` and `render.mjs`. CLI contract
   untouched. The seam's own handful of tests (D7) plus the byte-parity check land here.
2. **The unit rung's home and guard**: `scripts/test/unit/`, `homeOf()`'s fourth alternative, the
   no-filesystem guard and its discrimination test, the non-vacuity assertion, the two-glob floor in
   the hook and in CI (D3, D4, D8, D9).
3. **The fixture snapshot helper** (D5), proven on ONE file before anything else uses it.
4. **Per-file migration**, one file per commit, in descending order of the file's contribution to the
   half's wall clock — the 133 tests over 100 ms and the 22 over 200 ms are the ordered worklist, and
   each migrated file's diff shows its assertions unchanged.
5. **Docs** (D11), `CHANGELOG.md`'s `## [Unreleased]`, and the Mintlify sync left to the release cut.
6. **Archive**, with the lifecycle marker on the archive task.

## Open Questions

1. **Does the memory store ship, or does it live in the test tree?** The engine is zero-runtime-
   dependency and the store is internal either way, but the memory implementation is only ever used by
   tests. Shipping it under `scripts/lib/` is simpler (one module, one seam) and adds a shipped code
   path with no production caller; putting it in `scripts/test/fixtures/` keeps the shipped surface
   exactly as it is today and splits the seam across two trees. The parity ledger does not reach
   either path, so nothing forces the answer. Recommend: ship it beside the interface, because a seam
   whose test implementation is not next to the interface is a seam nobody finds — and say so in the
   release notes so the shipped-surface change is deliberate.

2. **`CLAUDE.md`'s managed rules block: 251 tests.** It is 30,911 of a built fixture's 34,607 bytes and
   it is written by `rules.mjs`, not the store. Giving it a seam too would move those 251 tests into
   the unit rung; leaving it on the file rung costs ~0.9 MB of copy per restored fixture. Neither
   dominates. Recommend: leave it — it is a repository file the engine writes to the repo, not into
   the record, and widening the store to include it re-opens exactly the "what does the store own"
   boundary D1 just closed.

3. **Does `reconcile-obligation.test.mjs` split?** It is 46 tests at 7.84 s (170 ms/test — the highest
   per-test cost measured in the half, and 27% of its per-test duration above the half's own median).
   Its tests assert on files AND on the reconcile obligation, so some will move rungs and some will
   snapshot. It is named here because it is the file where "one file per commit" will be hardest, and
   the decision of whether it is one commit or three belongs to whoever reads it, not to this document.
