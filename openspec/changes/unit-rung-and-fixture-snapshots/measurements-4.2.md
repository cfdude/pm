# Task 4.2 — the migration measured AS IT GOES

Recorded at the end of each batch of ten files, in this change directory, so a regression is
attributed to the batch that caused it rather than discovered at Gate 2. The command is the one the
pre-commit hook runs — **both rungs in ONE process**, in the order the hook's floor enumerates them:

```
node --test --test-isolation=none scripts/test/unit/*.test.mjs scripts/test/assert/*.test.mjs
```

## Batch 1 — ONE file migrated (`flag-parsing`, 14 tests)

| run | `ℹ duration_ms` | wall | tests | pass | fail |
| --- | --- | --- | --- | --- | --- |
| 1 | 72.40 s | 72.48 s | 1,266 | 1,266 | 0 |
| 2 | 73.04 s | 73.12 s | 1,266 | 1,266 | 0 |
| 3 | 73.56 s | 73.65 s | 1,266 | 1,266 | 0 |

**The half has NOT moved, and that is the honest reading rather than a disappointment.** Batch 1
migrated 937 ms of per-test time (worklist-4.1.md) out of 71,040 ms — 1.3% — against a run whose
own spread across three runs is 1.2 s. A single file's worth of movement is inside the noise, and
saying "it got faster" on these numbers would be reading a signal that is not there.

**What IS measurable, per invocation, and it is the unit that matters:**

| measurement | value |
| --- | --- |
| one engine invocation over the memory store (n=200, in-process) | **0.70–0.84 ms** |
| the migrated file's 14 tests, sum of per-test durations | **~20 ms** (was 937 ms) |
| a `tmpRepo()` + `init` build, for comparison (task 0.3(f)) | 55.9 ms, 8 `fsyncSync` calls |
| `fsyncSync` calls performed by the migrated file | **0** |

The per-test figures are the SUM OF PER-TEST DURATIONS, not `duration_ms / tests`: in this rung the
runner's own per-test machinery costs ~0.7 ms for an empty test and ~27 ms of a file's wall clock is
the harness rather than the tests (measured in task 2.5's work), so dividing the run's total by its
count charges the rung for the runner.

## What the acceptance still needs, stated with the same precision

The change's acceptance is **sub-15-second pre-commit for the FULL assertion half**, and the control
that bounds it is 12.2 s with every flush removed against 73.2 s (task 0.3(d), 6.0×). Batch 1 is 1.3%
of the population. **The remaining 90 files carry the other 98.7%, and the number is not going to
arrive from a single file** — it needs the migration tasks 4.1 lists, in worklist order, one commit
per file.

This file is the record of that, and it exists so the shortfall is a measurement rather than an
impression.

## Batch 2 — TEN files migrated (worklist rows 1–10)

| run | `ℹ duration_ms` | wall | tests | pass | fail |
| --- | --- | --- | --- | --- | --- |
| 1 | 55.36 s | 55.44 s | 1,269 | 1,269 | 0 |
| 2 | 57.15 s | 57.24 s | 1,269 | 1,269 | 0 |
| 3 | 57.28 s | 57.38 s | 1,269 | 1,269 | 0 |

**THE HALF MOVED THIS TIME, and the reading is honest about what moved it.** Batch 1 was 72.40 / 73.04
/ 73.56 s; these three runs average 56.60 s, which is **16.4 s (22%) off the same suite** — the same
1,269 tests, the same two globs, the same one process. That is twelve times the within-batch spread
(1.92 s), so it is a signal rather than noise, which batch 1's single file could not produce.

**Where the 16.4 s came from, in the units the worklist is ordered by.** The ten files carried
27,771 ms of the half's 71,040 ms of per-test time (39.1%). They did NOT all leave: these files SPLIT,
and 233 of their 310 tests moved (conductor-02 moved 13 of 28; conductor-25 6 of 16; conductor-05 19
of 30). The migrated 233 tests now cost **2.73 s of wall clock in total** across the ten unit files —
conductor-33 alone is 1.29 s of that, and reconcile-obligation 0.54 s — against per-file sums of
2,398–5,967 ms each on the file rung. The arithmetic does not need to balance to the millisecond:
`duration_ms` charges the run for one Node boot and the runner's own machinery, and the per-test sums
do not. The claim the numbers support is the one stated: the half lost 16.4 s, and the ten files are
where the worklist said the time was.

**Per test, still the unit that matters:**

| measurement | value |
| --- | --- |
| one engine invocation over the memory store (n=200, in-process, task 0.3) | **0.70–0.84 ms** |
| the ten migrated files' 233 tests, sum of per-file wall clocks | **2.73 s** |
| `fsyncSync` calls performed by the migrated files | **0** |
| the half's own spread across three consecutive runs, this batch | 1.92 s (was 1.16 s) |

**The rung grew from 4 files to 14**, and now holds 255 test declarations, so the floor in
`assert-half-has-no-spawn.test.mjs` was raised with it in the same commit as this measurement.

## What the acceptance still needs, restated against the new number

The change's acceptance is **sub-15-second pre-commit for the FULL assertion half**, and the control
that bounds it is 12.2 s with every flush removed against 73.2 s (task 0.3(d), 6.0×). Batch 2 took the
half to ~57 s. **Eleven files of the worklist's first thirty are
migrated — the pilot plus batch 2's ten; the remaining nineteen carry the rest**, and the number is not going to arrive from these alone.

This file is the record of that, and it exists so the shortfall is a measurement rather than an
impression.
