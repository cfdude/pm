# Baseline BEFORE (task 0.3)

Measured 2026-09-21 on this machine, Node **v26.9.0**, at `75d34a2` (the Gate-1 commit; the engine is
unchanged from `ab171b7`, which is where the drafting numbers were taken). Every number below was
re-measured on the day. Where a number differs from the drafting figure, BOTH are shown — the
mechanism reproduces and the margin moves with machine load, which is why the acceptance in D10 rests
on the CONTROLLED comparison rather than on an absolute wall clock.

Scratch scripts behind (b), (c), (d) and (f) live in
`.../scratchpad/apply-48/0.3/`; (c) and (d) are re-runnable from the two preloads committed beside
this file (`count-fsync.cjs`, `noop-fsync.cjs`).

## (a) Wall clock — three runs of the whole assertion half

`node --test --test-isolation=none scripts/test/assert/*.test.mjs`

| run | `ℹ duration_ms` | tests | pass | fail |
| --- | --- | --- | --- | --- |
| 1 | **121.6 s** | 1,243 | 1,243 | 0 |
| 2 | **72.3 s** | 1,243 | 1,243 | 0 |
| 3 | **73.2 s** | 1,243 | 1,243 | 0 |

Drafting said 86.0 / 73.8 / 67.8 s. Run 1 is an outlier at 121.6 s (cold page cache on the first
run of the day, and this machine was busy); runs 2 and 3 sit on the drafting range. **The number this
change is measured against is the pair 72.3 / 73.2 s**, and the outlier is reported rather than
dropped because a baseline that keeps only its convenient run is not a baseline.

## (b) Per-test duration distribution

From a fourth run, TAP reporter, top-level tests only (88 files, 1,243 tests).

| statistic | this run | drafting |
| --- | --- | --- |
| median | **67.4 ms** | 51.4 ms |
| p25 / p75 | 40.5 / 109.8 ms | 37.8 / 71.3 ms |
| p90 / p99 | 158.5 / 373.1 ms | 101.5 / 213.7 ms |
| max | **2,138.6 ms** | 1,177.9 ms |
| tests ≥ 100 ms | **378** | 133 |
| tests ≥ 200 ms | **67** | 22 |
| sum of the 1,243 durations | **105.0 s** | 73.7 s |

**The per-file run reproduces the drafting figure exactly**: running each of the 88 files in its OWN
process (`--test-reporter=tap`, one process per file, the process boot included in the wall) sums the
1,243 per-test durations to **73,479 ms — 73.5 s against drafting's 73.7 s**, and totals 85.1 s of
wall clock against the half's 72–73 s. That the SAME quantity lands on the drafting value under a
different process shape is why the 105.0 s above is read as load on the TAP run rather than as a
different half. **The tests ARE the wall clock**: the sum of the individual test durations accounts
for the whole run either way, so this is not setup paid once.

The ordered per-file worklist task 4.1 derives from (b) is `per-file.json` in the scratch dir;
descending, it opens:

| sum of the file's test durations | wall | tests | file |
| --- | --- | --- | --- |
| 7,997 ms | 8,197 ms | 46 | `reconcile-obligation.test.mjs` |
| 6,039 ms | 6,173 ms | 58 | `conductor-33.test.mjs` |
| 2,487 ms | 2,605 ms | 16 | `conductor-25.test.mjs` |
| 2,430 ms | 2,561 ms | 33 | `conductor-16.test.mjs` |
| 2,329 ms | 2,461 ms | 26 | `nullable-clearing.test.mjs` |
| 2,301 ms | 2,423 ms | 27 | `conductor-17.test.mjs` |
| 1,963 ms | 2,083 ms | 26 | `conductor-06.test.mjs` |

## (c) `fsyncSync` calls in one run

`node --require ./openspec/changes/unit-rung-and-fixture-snapshots/count-fsync.cjs --test
--test-isolation=none scripts/test/assert/*.test.mjs`

> `fsyncSync calls in this run: 12524 (fsyncSync 12524, fsync 0, promises.fsync 0)`

**12,524 — the drafting figure reproduces exactly.** That run's own `duration_ms` was 74.7 s. No
async `fsync` and no `fs.promises.fsync` is used anywhere in the half; every flush is the synchronous
one `saveState()` issues.

## (d) The causal control — `fs.fsyncSync` replaced by a no-op

`node --require ./openspec/changes/unit-rung-and-fixture-snapshots/noop-fsync.cjs --test
--test-isolation=none scripts/test/assert/*.test.mjs`

| run | `duration_ms` | tests | pass | fail |
| --- | --- | --- | --- | --- |
| 1 | **12.17 s** | 1,243 | 1,242 | **1** |
| 2 | **12.18 s** | 1,243 | 1,243 | 0 |
| 3 | **15.67 s** | 1,243 | 1,243 | 0 |

Against 72.3 / 73.2 s this is **≈ 6.0×**. (Drafting's 9.11 s / 8.1× against 73.9 s was taken on a
less loaded machine; `noop-fsync.cjs` is committed so the control can be re-run rather than quoted.
The margin is load-dependent; the MECHANISM — one syscall, and the half drops by most of its wall
clock — is unchanged.)

**Run 1's single failure is a FLAKE THE CONTROL ITSELF EXPOSES, and it is reported as a finding, not
rounded away.** `scripts/test/assert/conductor-36.test.mjs:97` asserts
`assert.notEqual(after.assertedAt, first, "a correction re-asserts, so the timestamp moves")`, where
`assertedAt` is a `new Date().toISOString()` with **millisecond** resolution
(`conductor-36.test.mjs:106`). With the flushes removed the two commands land inside the SAME
millisecond and the assertion fails on `'2026-09-22T05:30:07.423Z' === '2026-09-22T05:30:07.423Z'`.
It is not a defect in the engine and not a defect in this change's seam: it is a test whose premise
("the clock moved between two calls") is true only while the calls are slow. It reproduced in 1 of
these 3 control runs at 12.2 s and 0 of 3 at 72–75 s.

**CONSEQUENCE FOR THE ACCEPTANCE, stated before the work rather than discovered at Gate 2**: the
migration makes the half fast, and a fast half will make this test INTERMITTENT. It is not in this
change's task list, it is a pre-existing test in the population the migration touches, and the
migration is instructed to keep assertions unchanged — so it is raised here as a finding for
whoever owns the acceptance, rather than silently repaired (which would be an assertion weakened in
a commit that claims not to touch it).

## (e) The pre-commit hook's wall clock, end to end

| component | measured |
| --- | --- |
| `node scripts/test/drift.mjs --root "$PWD"` | **0.25 / 0.27 / 0.24 s** (drafting: 0.115 s) |
| the assertion half (the hook's runner step) | 72.3–73.2 s |
| the isolation-flag probe | cached per clone; not paid on a warm clone |

**The hook IS the half**: drift is under 0.3 s and the floor and the lock add nothing measurable, so
the per-commit gate is 72–73 s today and the change's acceptance (sub-15 s for the FULL half) is a
statement about the test run alone. The lock is worth naming separately because it is the one part
of the hook a measurement cannot see on an idle machine: several worktrees share one lock and wait
for each other, so the OBSERVED cost of a commit under concurrency is a multiple of the number above.

## (f) Per-verb table, re-measured on the day

In-process through the assertion half's own harness and git double, exactly as design.md's Context
table was. Medians; n = 12–20 for the verbs, n = 60 for the raw syscall.

| operation | today | `fsyncSync` a no-op | fsyncs | drafting |
| --- | --- | --- | --- | --- |
| `init`, fresh dir | **55.91 ms** | **2.79 ms** | **8** | 37.2 / 2.62 ms / 8 |
| `add-epic` (0 epics present) | **16.57 ms** | **1.66 ms** | **2** | 11.2 / 0.92 ms / 2 |
| `add-epic` (260 epics present) | **28.17 ms** | 14.66 ms | **2** | 17.5 ms / — |
| `owingRepo()` — init + 2 add-epic + set-active + push + pop | **133.31 ms** | **9.94 ms** | **18** | 124.9 / 6.65 ms / 18 |
| `render` (initialised dir) | **0.55 ms** | 0.34 ms | **0** | 0.30 ms / 0 |
| `brief` (initialised dir) | **0.35 ms** | 0.24 ms | **0** | 0.66 ms / 0 |
| `sync` (initialised dir) | **0.77 ms** | 0.52 ms | **0** | 0.39 ms / 0 |
| `mkdtemp` | **0.10 ms** | 0.06 ms | **0** | 0.32 ms / 0 |
| one open+write+fsync+close (tmpdir) | **6.94 ms** | 0.17 ms | **1** | 3.3 ms |
| one open+write+fsync+close (this repo) | **5.96 ms** | 0.05 ms | **1** | 3.5 ms |

**The fsync counts reproduce EXACTLY — 8, 2, 2, 18, 0, 0, 0, 0 — and they are structural, not
sampled.** The millisecond column is uniformly higher than the drafting medians (this machine's
load), and the *ratio* is what carries: `init` 20×, `add-epic` 10×, `owingRepo()` 13×, a single
raw `open+write+fsync+close` 25× at the syscall level. The engine's own work is sub-millisecond
underneath it — `render` 0.34 ms, `brief` 0.24 ms, `sync` 0.52 ms, `mkdtemp` 0.06 ms with the flush
removed — which is the whole finding: **the half's cost is the durability term, not the engine and
not the filesystem.**

## The change's GOAL 4 and this file's commit

This file, `count-fsync.cjs` and `noop-fsync.cjs` land in the **task 0.3 commit** (the commit whose
message is `chore(openspec): 0.3 capture the assertion half's baseline before any code`). The
commit is attributed to `unit-rung-and-fixture-snapshots`.
