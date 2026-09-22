# Baseline AFTER (task 6.5)

Measured 2026-09-22 on this machine, Node **v26.9.0**, at the change's final commit — `a0e827f`,
the 6.4 commit, which is the last commit that touches anything the suite reads. Every number below
is from this run; the 0.3 baseline it is compared against is `baseline-before.md` beside this file,
taken on the same machine with the same commands.

**The command is the one the pre-commit hook runs** — BOTH rungs in ONE process — which is what
every batch in `measurements-4.2.md` was measured with, so these numbers are comparable with the
73.2 s baseline and with each other:

```
node --test --test-isolation=none scripts/test/unit/*.test.mjs scripts/test/assert/*.test.mjs
```

Task 0.3 named `scripts/test/assert/*.test.mjs` alone, which was the whole half before 0.48.0 gave
the half a second rung. **Three of the instruments are committed beside this file, so the numbers that carry the acceptance
can be re-run rather than quoted:** `count-fsync.cjs` and `noop-fsync.cjs` (the preloads behind (c)
and (d), as `baseline-before.md` left them) and `mem-invocation.mjs` (the memory-store row — the
in-process, n=200 measurement the ~1 ms per-test bound rests on; it reads the repo by absolute path
and writes nothing). The remaining scratch behind (b), (d)'s run logs and (f) lives in
`.../scratchpad/apply-48/6.5/`.

## THE VERDICT, FIRST

| acceptance | target | measured | verdict |
| --- | --- | --- | --- |
| the FULL assertion half, pre-commit | **sub-15 s** | **26.50 s** median of three (26.898 / 26.501 / 26.250) | **MISSED — 1.77× the target** |
| per unit-rung test | ~1 ms | **0.70–0.87 ms** per engine invocation over the memory store (n=200) | **met**, at the unit the figure was stated in |
| the migrated, value-observing population | under 10 s | the unit rung is **3.67 s** for 752 tests | **met** |

**The miss is reported as a miss with the number, and its cause is arithmetic rather than a hedge.**
The control that removes EVERY flush runs **5.15 / 5.37 / 5.22 s** (median 5.22 s), so **26.50 − 5.22 =
21.28 s of the half is durability flushing — 80% of what is left.** The file rung is 74 files and 517
tests and issues **all 3,430** `fsyncSync` calls; the unit rung is 63 files and 752 tests and issues
**none**. So the distance from 26.5 s to 15 s is the file-rung population the four seam edges hold,
and the largest single block of it — **E1, `CLAUDE.md`'s managed rules block, ~27 tests** — needs a
spec change this apply loop was not authorised to make: the `engine-invocation` delta states in bold
that the block is a repository file the store does **not** own, and task 0.2's recorded cross-spec
review names that paragraph as a BLOCK IT FIXED, with hashes over the amended text.

## (a) Wall clock — three runs of the whole assertion half

| run | `ℹ duration_ms` | wall | tests | pass | fail |
| --- | --- | --- | --- | --- | --- |
| 1 | **26.898 s** | 26.995 s | 1,269 | 1,269 | 0 |
| 2 | **26.501 s** | 26.601 s | 1,269 | 1,269 | 0 |
| 3 | **26.250 s** | 26.368 s | 1,269 | 1,269 | 0 |

**Baseline: 72.3 / 73.2 s** (plus one 121.6 s cold-page-cache outlier, reported there rather than
dropped). **26.50 s against 73.2 s is a 63.8% reduction**; against the pair's lower value it is
63.4%. An earlier three-run measurement taken eight minutes before this one, at `f1c0c1d` with the
docs not yet committed, was 27.202 / 27.833 / 27.395 s — i.e. the same half, 0.9 s apart, which is
the machine's load rather than a change. The `ℹ tests` count is **1,269 against the baseline's
1,243**: the 26 extra are this change's own seam, byte-parity, fixture-snapshot and rung-guard tests.

## (b) Per-test duration distribution

From a fourth run, TAP reporter, top-level tests only (137 files, 1,269 tests).

| statistic | after | before |
| --- | --- | --- |
| median | **2.371 ms** | 67.4 ms |
| p25 / p75 | **0.841 / 21.280 ms** | 40.5 / 109.8 ms |
| p90 / p99 | **64.340 / 131.332 ms** | 158.5 / 373.1 ms |
| max | **1,144.5 ms** | 2,138.6 ms |
| tests ≥ 100 ms | **34** | 378 |
| tests ≥ 200 ms | **5** | 67 |
| sum of the 1,269 durations | **26.3 s** | 105.0 s (1,243 tests) |

**The p25 is the migration's signature**: a quarter of the half now completes in under a millisecond,
which no test could do while it paid a durability flush. The p75 and the tail are the file rung, and
the 5 tests over 200 ms are the ones the seam edges hold.

## (c) `fsyncSync` calls in one run

```
node --require ./openspec/changes/unit-rung-and-fixture-snapshots/count-fsync.cjs --test \
  --test-isolation=none scripts/test/unit/*.test.mjs scripts/test/assert/*.test.mjs
```

> `fsyncSync calls in this run: 3430 (fsyncSync 3430, fsync 0, promises.fsync 0)`

**3,430 against the baseline's 12,524 — 72.6% of the flushes are gone**, and the run's own
`duration_ms` was 28.43 s. **SPLIT BY RUNG, because the split is the finding:**

| rung | files | tests | `ℹ duration_ms` | `fsyncSync` calls |
| --- | --- | --- | --- | --- |
| `scripts/test/unit/` | 63 | 752 | **3.67 s** | **0** |
| `scripts/test/assert/` | 74 | 517 | **24.28 s** | **3,430** |

The unit rung does **zero** filesystem work — that is its guard's whole rule, and this is the
measurement that says the guard is doing its job rather than merely passing. **Every remaining
flush in the half belongs to the file rung**, which is down from 91 files. Still no async `fsync` and
no `fs.promises.fsync` anywhere.

## (d) The causal control — `fs.fsyncSync` replaced by a no-op

| run | `duration_ms` | tests | pass | fail |
| --- | --- | --- | --- | --- |
| 1 | **5.372 s** | 1,269 | 1,269 | 0 |
| 2 | **5.145 s** | 1,269 | 1,269 | 0 |
| 3 | **5.219 s** | 1,269 | 1,269 | 0 |

Median **5.22 s, every test passing**, against this run's 26.50 s = **5.1×**. The baseline's control
was 12.17 / 12.18 / 15.67 s against 72.3 / 73.2 s = **≈ 6.0×**.

**The control itself got 2.3× faster, and that is the mechanism reproducing rather than a surprise:**
the control's job is to remove the flush TERM, and the migration removed 9,094 of the term's 12,524
calls, so there is less left for the control to remove. Both readings agree on the cause: at the
baseline the flush term was 73.2 − 12.18 = **61.0 s of 73.2 s (83%)**; now it is 26.50 − 5.22 =
**21.28 s of 26.50 s (80%)**. The half's cost is still overwhelmingly durability flushing — what
changed is how much of the half is still paying it.

**THE BASELINE'S ONE FAILURE DID NOT REPRODUCE, and it is worth stating rather than quietly
dropping.** `baseline-before.md` recorded 1 failure in 3 control runs —
`conductor-36.test.mjs:97`, whose assertion ("a correction re-asserts, so the timestamp moves")
rests on `assertedAt` being a millisecond-resolution `new Date().toISOString()`
(`scripts/lib/disposition.mjs:288`) while the two stamps are set by two invocations. The baseline
predicted the migration would make that INTERMITTENT. **It has not been observed to:** this control
is 0 failures in all three runs, and the test was hammered directly — `--test-name-pattern="the
correction path still works"`, forty consecutive runs on the unit rung — for **0 failures in 40**.
The premise is intact (`assertedAt` is still a raw ISO stamp with no monotonic guard), so this is a
rate that was not reached rather than a flake that was fixed: the two stamps are set by two full
invocations with assertions between them, and that gap stays above a millisecond on this machine.
It is recorded as an open low-rate risk, not as repaired.

## (e) The pre-commit hook's wall clock, end to end

| component | measured after | measured before |
| --- | --- | --- |
| `node scripts/test/drift.mjs --root "$PWD"` | **0.110 / 0.111 / 0.122 s** | 0.24 / 0.27 / 0.24 s |
| the assertion half (the hook's runner step) | **26.50 s** | 72.3–73.2 s |
| the isolation-flag probe | cached per clone (`.git/pm-isolation-flag`) | cached per clone |

**The hook IS the half**, and it is now **~26.6 s of components against 72–73 s**. One end-to-end
observation: the 6.3 commit in this run took **28.79 s** wall for the whole `git commit` — drift,
the half, the hook's own bookkeeping and git's own work included. The lock is still worth naming
separately for the same reason it was in the baseline: several worktrees share one lock and wait for
each other, so the OBSERVED cost of a commit under concurrency is a multiple of the number above.

## (f) Per-verb table, re-measured on the day

In-process through the assertion half's own harness and git double, exactly as design.md's Context
table was. Medians; n = 12–20 for the verbs, n = 60 for the raw syscall.

| operation | after | before | `fsyncSync` a no-op | fsyncs |
| --- | --- | --- | --- | --- |
| `init`, fresh dir | **47.03 ms** | 55.91 ms | **2.55 ms** | **8** |
| `add-epic` (0 epics present) | **16.35 ms** | 16.57 ms | **1.37 ms** | **2** |
| `add-epic` (260 epics present) | **19.84 ms** | 28.17 ms | 9.70 ms | **2** |
| `owingRepo()` — init + 2 add-epic + set-active + push + pop | **127.21 ms** | 133.31 ms | **7.49 ms** | **18** |
| `render` (initialised dir) | **0.33 ms** | 0.55 ms | 0.33 ms | **0** |
| `brief` (initialised dir) | **0.23 ms** | 0.35 ms | 0.22 ms | **0** |
| `sync` (initialised dir) | **0.36 ms** | 0.77 ms | 0.39 ms | **0** |
| `mkdtemp` | **0.32 ms** | 0.10 ms | 0.28 ms | **0** |
| one open+write+fsync+close (tmpdir) | **5.25 ms** | 6.94 ms | 0.25 ms | **1** |
| one open+write+fsync+close (this repo) | **4.91 ms** | 5.96 ms | 0.06 ms | **1** |

**THE FILE RUNG'S UNIT COST IS UNCHANGED, and the table is here to say so rather than to show
progress.** The flush counts reproduce EXACTLY — 8, 2, 2, 18, 0, 0, 0, 0 — and the millisecond
column is within this machine's load of the baseline's. A raw `open+write+fsync+close` is still
4.9–5.3 ms against 0.06–0.25 ms with the flush removed: **~20–80× per call**. That is the term the
migration could not remove from tests that need bytes, and it is why the acceptance is missed.

## The memory-store row — the unit rung's own unit

The unit rung's acceptance ("~1 ms per unit-rung test") is measured at the INVOCATION, because a
unit test is one or more of them and the test-level figure would charge the rung for its fixture.
In-process, over `memoryStore()`, n = 200:

| operation | median | p25 / p75 | p90 | max |
| --- | --- | --- | --- | --- |
| `add-epic` over an empty record | **0.775 ms** | 0.750 / 0.862 | 0.981 | 5.145 |
| `brief` over a 5-epic record | **0.733 ms** | 0.710 / 0.788 | 0.884 | 5.916 |
| `add-epic` over a 5-epic record | **0.850 ms** | 0.832 / 0.875 | 0.996 | 1.320 |
| `owingRepo()` — 9 invocations, the unit rung's most expensive fixture (n = 60) | **6.519 ms** | 6.413 / 6.673 | 6.961 | 8.206 |

**A second run of the same committed instrument gives 0.695 / 0.766 / 0.834 ms and `owingRepo()`
6.705 ms**, so the row's honest statement is **medians in 0.70–0.87 ms over two runs** — which
reproduces the 0.70–0.84 ms `measurements-4.2.md` has carried since batch 1. The number the
acceptance rests on is a measurement that repeats rather than one that was taken once.
`owingRepo()` over the memory store is **6.5–6.7 ms against the file rung's 127.21 ms — ≈19×**, and
the same nine invocations issue 18 `fsyncSync` calls on disk and none here.

`init` is deliberately absent from that table: it calls `ensureGitignore()`, which writes
`.gitignore` through raw `fs` (`scripts/lib/subcommands.mjs:90`), so it CANNOT run over the memory
store at all — `store.resolve()` is `null` and the write throws `ENOENT`. That is one of the seam
edges the migration's `stayed` columns are made of, and the reason the unit rung's own `repo()`
helper seeds `emptyRecord()` and calls `add-epic` instead of initializing a directory.

## What the acceptance needs next, stated as the measurement rather than as a wish

**Sub-15 s needs roughly 1,800 of the 3,430 remaining flushes to go** (at the measured ~6.2 ms each,
15 − 5.22 = 9.78 s of flush budget against 21.28 s spent). They are exactly the file-rung tests the
four seam edges hold, and the largest single block of them is E1 — `CLAUDE.md`'s managed rules
block, ~27 tests across four files — which is a STOP rather than a skip because it needs a spec
decision: amending `engine-invocation`'s boundary paragraph would stale the cross-spec verdict task
0.2 recorded over its hashes. E3's second half (`commit-observe.json` in the `ARTIFACT` table) is the
other recorded STOP, on design D1's explicit NOT-OWNED row.

The 30 un-migrated worklist rows (62–91) are not the answer and were measured to be not the answer:
they carry **1,795 ms, 2.5% of the baseline**, between them.

**This file is the change's acceptance record, and the acceptance is a MISS.** It is written that
way on purpose: a number that fails its own target belongs in the file that reports it, with the
arithmetic that says what would have to change.

## This file's commit

`baseline-after.md` lands in the **task 6.5 commit**, whose message reports the change's headline
number and which is attributed to `unit-rung-and-fixture-snapshots`. The CHANGELOG's
`## [Unreleased]` entry quotes the same measurement, corrected in this commit from the
pre-docs run's 27.40 s to this run's **26.50 s** so that the two documents carry one number rather
than two.
