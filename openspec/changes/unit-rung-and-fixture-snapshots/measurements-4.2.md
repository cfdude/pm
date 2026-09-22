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
