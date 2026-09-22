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
`assert-half-has-no-spawn.test.mjs` was raised with it in the same commit as this measurement (and again
to 24 in batch 3).

## What the acceptance still needs, restated against the new number

The change's acceptance is **sub-15-second pre-commit for the FULL assertion half**, and the control
that bounds it is 12.2 s with every flush removed against 73.2 s (task 0.3(d), 6.0×). Batch 2 took the
half to ~57 s. **Eleven files of the worklist's first thirty are
migrated — the pilot plus batch 2's ten; the remaining nineteen carry the rest**, and the number is not going to arrive from these alone.

This file is the record of that, and it exists so the shortfall is a measurement rather than an
impression.

## Batch 3 — TEN more files migrated (worklist rows 11–20)

| run | `ℹ duration_ms` | wall | tests | pass | fail |
| --- | --- | --- | --- | --- | --- |
| 1 | 45.59 s | 45.68 s | 1,269 | 1,269 | 0 |
| 2 | 43.21 s | 43.29 s | 1,269 | 1,269 | 0 |
| 3 | 43.17 s | 43.27 s | 1,269 | 1,269 | 0 |

**ELEVEN AND A HALF SECONDS OFF THE SAME SUITE, and the cumulative number is the one that matters
now.** Batch 1 was 72.40–73.56 s; batch 2 took it to 55.36–57.28 s; this batch is 43.17–45.59 s. That is
**~30 s, 41% of the half**, against the control that bounds the acceptance (12.2 s with every flush
removed against 73.2 s, task 0.3(d), 6.0×). Twenty-one files of the worklist's first thirty are
migrated.

**In the worklist's own units:** these ten files carried 15,413 ms of the half's 71,040 ms of per-test
time (21.7%), and 159 of their 230 tests moved — because these files SPLIT heavily in one direction:
conductor-10 moved 7 of 24, conductor-23 11 of 26, conductor-02's batch-2 neighbour similarly. The
migrated 159 tests cost **722 ms of wall clock in total** across ten unit files (43–98 ms each, the
whole ten together costing less than the single most expensive file they came from), with no fsyncSync
anywhere in them.

**The rung now holds 24 files and 414 test declarations** (from 4 files at the pilot), and the FILE rung
is down to 88 files from 91.

**THE BATCH'S FINDING — a reader that bypasses the seam (worklist row 19, `conductor-07`).**
`verifyState()` reads its render stamp with `readJSON(renderStampPath(), null)` and state.json's mtime
with `fs.statSync(statePath())` — raw paths — while `render.mjs` WRITES both through the store
(`store.mtimeMs(ARTIFACT.RECORD)` at `:382`, `store.write(ARTIFACT.RENDER_STAMP, …)` at `:387`). Against
a memory store that is observable in one line: render writes the stamp, `store.exists("render-stamp.json")`
returns true, and `verify-state` still says "no render stamp found". The two success tests were moved
and then MOVED BACK for that reason. It is the class the change's required item 1 exists to catch — a
writer moved behind the seam with an identical sibling reader left untouched — and the fix (read both
through `storeOps()`) is deliberately left to its own commit rather than riding on a test move. Recorded
in worklist-4.1.md.

## What the acceptance still needs, restated against the new number

The change's acceptance is **sub-15-second pre-commit for the FULL assertion half**. Batch 3 puts the
half at ~43 s. **Nine files of the worklist's first thirty remain, and they carry the next largest
blocks of per-test time** (conductor-14 at 1,242 ms down to stored-value-integrity at 949 ms, plus
`flag-parsing` already done) — and the shape of batches 2 and 3 says the split ratio is what decides
each one: the four seam edges decide how much of a file can leave, not the file's cost.

This file is the record of that, and it exists so the shortfall is a measurement rather than an
impression.

## Batch 4 — the last nine files of rows 21–30

| run | `ℹ duration_ms` | wall | tests | pass | fail |
| --- | --- | --- | --- | --- | --- |
| 1 | 38.65 s | 38.73 s | 1,269 | 1,269 | 0 |
| 2 | 38.64 s | 38.72 s | 1,269 | 1,269 | 0 |
| 3 | 37.67 s | 37.76 s | 1,269 | 1,269 | 0 |

**THE FOUR-BATCH TOTAL IS THE NUMBER NOW: 73.2 s → 38.0 s, a 35.2 s (48%) reduction of the FULL assertion
half** — 1,269 tests, two globs, one process, every run green. Row 30 of this batch (`flag-parsing`) was
already migrated in batch 1, so this batch is nine files, not ten; the row is counted once.

**In the worklist's own units:** these nine files carried 9,653 ms of the half's 71,040 ms of per-test
time (13.6%), and 101 of their 155 tests moved — the lowest ratio of any batch, because three of the nine
are files whose SUBJECT is the filesystem: `conductor-20` (the plan-resolution ladder) moved 2 of 19,
`cross-spec-review` 2 of 17, `conductor-20` 2 of 19 and `conductor-23` 11 of 26 in the batch before it.
The migrated 101 tests cost 478 ms of wall clock in total.

**The rung is now 33 files and 515 test declarations**, from 4 files at the pilot. The FILE rung is down
to 85 files from 91.

| batch | files | half's wall (`ℹ duration_ms`, three runs) | delta |
| --- | --- | --- | --- |
| 1 (pilot) | 1 | 72.40 / 73.04 / 73.56 s | — |
| 2 | 10 | 55.36 / 57.15 / 57.28 s | −16.4 s |
| 3 | 10 | 45.59 / 43.21 / 43.17 s | −11.5 s |
| 4 | 9 | 38.65 / 38.64 / 37.67 s | −5.5 s |

**The per-batch deltas are NOT proportional to the files' per-test cost, and the reason is the split
ratio rather than the migration.** Batch 2's ten files carried 39.1% of the half's per-test time and gave
16.4 s; batch 4's nine carried 13.6% and gave 5.5 s. What predicts the delta is how much of each file
the four seam edges allow to leave — and the four edges are: a fixture that writes a path, a file the
store does not own, a VERB whose side effect writes a path, and a subject that really is the filesystem.

## What the acceptance still needs, stated against the new number

The change's acceptance is **sub-15-second pre-commit for the FULL assertion half**, and the control that
bounds it is 12.2 s with every flush removed against 73.2 s (task 0.3(d), 6.0×). Four batches put the half
at **38.0 s — 48% of the way to the control's floor, with 30 of the worklist's 91 files migrated.**

**The remaining 61 files carry the other half of the time, and the four seam edges above are what decide
how much of it can leave.** Two of the four are FIXABLE and neither is fixed here: the store could own
the artifacts those fixtures write (`CLAUDE.md`'s managed block is the largest single one — it is what
keeps `set-tracker`'s and `set-review-mode`'s tests on the file rung), and `verifyState()`'s raw reads
are a two-line change that would move two more tests plus whatever else reaches verify-state.

This file is the record of that, and it exists so the shortfall is a measurement rather than an
impression.

## Batch 5 — ten more files migrated (worklist rows 31–40)

| run | `ℹ duration_ms` | wall | tests | pass | fail |
| --- | --- | --- | --- | --- | --- |
| 1 | 33.49 s | 33.58 s | 1,269 | 1,269 | 0 |
| 2 | 32.00 s | 32.09 s | 1,269 | 1,269 | 0 |
| 3 | 33.09 s | 33.18 s | 1,269 | 1,269 | 0 |

**FIVE MORE SECONDS OFF THE SAME SUITE (38.65/38.64/37.67 → 33.49/32.00/33.09, −5.2 s), and the
cumulative number is the one that matters: 73.2 s → 32.9 s, a 40.3 s (55%) reduction of the FULL
assertion half.** 1,269 tests, two globs, one process, every run green — the same 1,269 as batch 4,
so nothing left the suite and nothing entered it.

**In the worklist's own units:** these ten files carried 7,636 ms of the half's 71,040 ms of per-test
time (10.7%) — the smallest tranche of any batch so far, and they gave the second-largest delta
because the SPLIT RATIO was high rather than the cost: **91 of their 142 tests moved**. Five of the
ten moved WHOLE (conductor-08, disposition-references, conductor-19, archive-gate-order, triage — 68
tests and five files deleted from the file rung outright), and the five that split did so at 4/14
(conductor-12), 5/11 (conductor-30), 6/25 (platform), 15/19 (conductor-29) and 2/14
(state-file-refuses-to-guess).

**The right-hand column, which is what the batch actually measured:**

| # | file | tests | moved | stayed | what decided it |
| --- | --- | --- | --- | --- | --- |
| 31 | `platform` | 25 | 6 | 19 | `write-rules`/`init` WRITE the block through raw fs; `rules-target` READS the chain to resolve first-existing-wins; the shipped-hooks test reads `hooks/hooks.json` |
| 32 | `conductor-08` | 15 | 15 | 0 | file GONE — the honcho log, `laneRouting`, the suggest-lane payload and the detour log are all values |
| 33 | `conductor-30` | 11 | 5 | 6 | ONE edge, six tests: gh-148's `verify-specs` parses a directory walk, and the two `add-many` batch-file tests |
| 34 | `state-file-refuses-to-guess` | 14 | 2 | 12 | the UNREADABLE-FILE family — the memory store holds an object and cannot express bytes that fail to parse (the same boundary as conductor-33's raw-bytes tests); plus a directory's absence |
| 35 | `disposition-references` | 10 | 10 | 0 | file GONE — a stored reference's validation is a value |
| 36 | `conductor-19` | 5 | 5 | 0 | file GONE — the brief is printed and PROJECT.md is store-owned |
| 37 | `archive-gate-order` | 10 | 10 | 0 | file GONE — every case is state and argv |
| 38 | `triage` | 19 | 19 | 0 | file GONE — the fixture is a record and PROJECT.md is store-owned |
| 39 | `conductor-29` | 19 | 15 | 4 | four SOURCE reads: gh#100's own `rg` reproduction, the two drift guards, and `commands/epic.md` |
| 40 | `conductor-12` | 14 | 4 | 10 | five `.gitignore` tests (a file the store does not own) and four `injectConflictOnce()` tests (the seam IS a filesystem write) |

**THE RUNG IS NOW 43 FILES** (33 files / 515 declarations at batch 4), and the FILE rung is down to
**80 files from 85** — five of them deleted outright rather than shrunk. The floor in
`assert-half-has-no-spawn.test.mjs` was raised with this measurement, in the same commit as batch 4's.

### THE SECOND SEAM GAP, and it was FOUND BY ATTEMPTING THE MOVE

`conductor-12`'s "a successful state write clears the conflict log" was written for the unit rung
FIRST and it FAILED — the planted `write-conflicts.log` survived a landing `add-epic`. The reason is
mechanical: `clearConflictsOn(this)` is called inside the **disk** store's own `writeRecord`
(`scripts/lib/store.mjs:822`), and the **memory** store's `writeRecord` does not call it. The reset
is therefore a behaviour of one store implementation and not of the interface, which is the same
class as `verifyState()`'s raw reads — a capability the unit rung structurally cannot test — and it
is the first one this migration has found outside `verifyState()`.

It is named rather than fixed, for the reason the first one was: the fix changes what an engine write
DOES, so it wants its own commit, its own suite run and its own review rather than a rider on a test
move.

**The FIXABLE edges are therefore three, not two**, and they are now the whole of what the remaining
files' `stayed` columns are made of: the store could own `CLAUDE.md`'s managed block (27 tests across
four files), `verifyState()` could read its stamp and mtime through `storeOps()` (2 tests plus
whatever else reaches verify-state), and the memory store could call `clearConflictsOn()` (1 test).

## What the acceptance still needs, stated against the new number

The change's acceptance is **sub-15-second pre-commit for the FULL assertion half**, and the control
that bounds it is 12.2 s with every flush removed against 73.2 s (task 0.3(d), 6.0×). Five batches put
the half at **32.9 s — 40 of the worklist's 91 files migrated, and the reduction is now 55% of the
baseline.**

**The remaining 51 files carry the other 45%, and the five seam edges above are what decide how much
of it can leave** — the four from batch 4's reckoning plus the memory store's missing
`clearConflictsOn()`. Batch 5 is evidence for the shape rather than against it: the batch with the
LEAST per-test cost of any so far gave the second-largest delta, because the files that moved whole
were files whose every observable was already a value.

This file is the record of that, and it exists so the shortfall is a measurement rather than an
impression.

## Batch 6 — ten more files migrated (worklist rows 41–50)

| run | `ℹ duration_ms` | wall | tests | pass | fail |
| --- | --- | --- | --- | --- | --- |
| 1 | 27.40 s | 27.50 s | 1,269 | 1,269 | 0 |
| 2 | 30.12 s | 30.23 s | 1,269 | 1,269 | 0 |
| 3 | 31.16 s | 31.27 s | 1,269 | 1,269 | 0 |

**THE SIX-BATCH TOTAL IS 73.2 s → 29.6 s (the mean of the three runs), a 43.6 s (60%) reduction of the
FULL assertion half**, 1,269 tests, two globs, one process, every run green. The batch's own delta is
−3.3 s against batch 5's 32.86 s mean, and the SPREAD is the honest part of this reading: 3.8 s across
three consecutive runs, the widest of any batch, which is what a small delta on a loaded machine looks
like. The direction is unambiguous over six batches (73 → 57 → 43 → 38 → 33 → 30) and no single run is
being read as the number.

**In the worklist's own units:** these ten files carried 4,963 ms of the half's 71,040 ms of per-test
time (7.0%) — the smallest tranche yet — and 65 of their 135 tests moved. Two of the ten left the file
rung entirely (`conductor-18`, `conductor-39`).

**The right-hand column, per file:**

| # | file | tests | moved | stayed | what decided it |
| --- | --- | --- | --- | --- | --- |
| 41 | `conductor-27` | 11 | 8 | 3 | the two-root half of gh#82: two initialized repos at two PATHS, and the assertion NAMES both in the warning |
| 42 | `conductor-34` | 13 | 5 | 8 | seven tests loop over SHIPPED surfaces (`skills/conductor/SKILL.md`, `commands/*.md`, `README.md`, `agents/*.md`), so splitting the loop would weaken it; the eighth runs `set-tracker` |
| 43 | `conductor-28` | 23 | 4 | 19 | eleven write `docs/lessons/<slug>.md` — the advisor's own INPUT, a directory the store does not own; eight read shipped files |
| 44 | `output-text-integrity` | 11 | 9 | 2 | `CLAUDE.md` unchanged after `set-tracker`, and a SOURCE read of `lib/constants.mjs` |
| 45 | `conductor-18` | 10 | 10 | 0 | **file GONE** — both checks are decided from the record and print a report |
| 46 | `conductor-15` | 17 | 2 | 15 | the checked-in `fixtures/state-0.26.0.json`, which is the point of a migration test, plus the `openspec/changes/archive/**` fixtures `sync` reads |
| 47 | `conductor-35` | 20 | 15 | 5 | the five that read `scripts/conductor.mjs` for the dispatch table, and the network scan over every lib file |
| 48 | `managed-rules-block` | 11 | 1 | 10 | the subject IS the human-owned rules file — its bytes, its CRLF, its markers |
| 49 | `conductor-39` | 8 | 8 | 0 | **file GONE** — createdAt/touchedAt are record values and the degradation rungs are this half's world |
| 50 | `conformance` | 11 | 3 | 8 | **ONE fixture decides it**: `init` writes CLAUDE.md through raw fs, so every case whose fixture initializes a repo stays |

**THE RUNG IS NOW 58 FILES** (43 at batch 5) and the FILE rung is down to **78 files from 80**. The
floor in `assert-half-has-no-spawn.test.mjs` was raised with this measurement, in the same commit.

### THE GENERAL FORM OF WHAT STAYED, AND IT IS WORTH NAMING BEFORE THE LAST ROWS

Across these ten the retained tests fall into four shapes, and only the first is the rule as written:

1. **The subject is a file's bytes** (`managed-rules-block`, `output-text-integrity`'s CLAUDE.md row).
2. **The instrument is a LOOP over shipped surfaces** (`conductor-34`, part of `conductor-28`), where
   splitting the loop to move one value-valued arm would weaken the assertion that is the point.
3. **The fixture writes a path nothing's assertion names** (`conductor-15`'s checked-in 0.26.0 fixture,
   `conductor-28`'s lesson corpus) — scenery that had to be a file for the test to be about what it is
   about at all.
4. **The verb's side effect writes a file the store does not own** (`init` and `set-tracker`, deciding
   most of `conformance` and both of `conductor-28`'s excluded arms) — edge 3 of the four in
   worklist-4.1.md, and the largest remaining fixable population.

The third shape is new to this batch and is the one to watch: a checked-in FIXTURE FILE is not the
store's business at all, and no seam change would move it.

## Batch 7 — ten more files migrated (worklist rows 51–60)

| run | `ℹ duration_ms` | wall | tests | pass | fail |
| --- | --- | --- | --- | --- | --- |
| 1 | 28.67 s | 28.78 s | 1,269 | 1,269 | 0 |
| 2 | 29.31 s | 29.43 s | 1,269 | 1,269 | 0 |
| 3 | 29.03 s | 29.18 s | 1,269 | 1,269 | 0 |

**THE SEVEN-BATCH TOTAL IS 73.2 s → 29.0 s, a 44.2 s (60%) reduction of the FULL assertion half**, and
this batch's own delta is **−0.6 s** — the smallest of the seven, and the tightest spread (0.64 s
across three runs).

**WHY IT IS SMALL, AND THIS IS THE BATCH'S FINDING RATHER THAN A DISAPPOINTMENT.** These ten files
carried 2,661 ms of the half's 71,040 ms of per-test time — **3.7%** — and 45 of their ~80 tests moved.
The worklist is ordered by cost, so the migration has reached the cheap tail: **the thirty rows that
remain carry 1,795 ms between them, 2.5% of the baseline.** ARITHMETIC, stated plainly because it is
the acceptance's real bound:

* migrating EVERY remaining row perfectly, deleting every remaining file from the file rung, could
  take the half to roughly **27 s** at best;
* the change's acceptance is **sub-15 s**, and the control that bounds it is **12.2 s with every flush
  removed** (task 0.3(d)).

**So the remaining worklist rows CANNOT reach the acceptance on their own, and the measurement says so
before Gate 2 has to.** What stands between 29.0 s and 12.2 s is not unmigrated files — it is the
fsync-bearing tests RETAINED inside the thirty-one files already migrated plus the twenty-eight never
touched, every one of them held there by a seam edge. The three FIXABLE edges (worklist-4.1.md) are
therefore not a tidy-up: they are the only path to the change's own acceptance criterion.

**In the worklist's own units, per file:**

| # | file | tests | moved | stayed | what decided it |
| --- | --- | --- | --- | --- | --- |
| 51 | `gate-guard-write-paths` | 33 | 27 | 6 | 1.3's two source scans, 2.5's three (raw conflict-marked bytes), and 3.1 (shipped hooks.json) |
| 52 | `commit-observation` | 10 | 6 | 4 | hooks.json; raw bytes; `commit-observe.json` — not in the store's ARTIFACT table, so its absence is not expressible |
| 53 | `verb-surface` | 8 | 2 | 6 | `dispatchKeys()` plus `WATCHED`, a four-path snapshot including CLAUDE.md |
| 54 | `commit-resolution` | 7 | 5 | 2 | an absolute path OUTSIDE the repository (`/tmp/pm-should-never-exist`), and a source scan |
| 55 | `conductor-26` | 6 | 5 | 1 | raw unparseable bytes |
| 56 | `unconsidered-outcomes` | 16 | 15 | 1 | 47 unticked-task PLAN FILES — the fixture that produces the number |
| 57 | `detached-warning` | 5 | 5 | 0 | **file GONE** |
| 58 | `hook-verbs-e2e` | 4 | **0** | 4 | **THE FIRST ROW WITH NOTHING TO MOVE**: every test derives the registration set by READING `hooks/hooks.json` and drives it against an `init`ed tree |
| 59 | `detached-suppression` | 5 | 5 | 0 | **file GONE** |
| 60 | `head-attachment` | 3 | 3 | 0 | **file GONE** |
| 61 | `positional-and-help-tokens` | 5 | 5 | 0 | **file GONE** (row 61 of batch 8, migrated in the same run) |

**THE RUNG IS NOW 63 FILES** (58 at batch 6) and the FILE rung is down to **74 files from 78**. The
floor in `assert-half-has-no-spawn.test.mjs` was raised with this measurement, in the same commit.

### ROW 58 — THE FIRST FILE WITH NOTHING TO MOVE, AND WHY THAT IS A RESULT

`hook-verbs-e2e` is four tests and none of them could leave. Every one derives the registration set by
READING `hooks/hooks.json` — the derivation is the subject, because "the fast half learns everything
about the registrations except the boundary itself" is what the file is FOR — and then drives those
argv against an `init`ed tree. Both halves of every test are file-rung by construction: the source read
and the `init`. Its row is recorded as **moved 0**, which the worklist's own preamble authorises: "a
file with a large sum and no value-observing tests stays on the file rung by design, and its presence
here is the record of a decision that was made rather than skipped." No commit was made for it, and
none should be: a commit whose only content was a comment would be bookkeeping wearing a migration's
name.

## Batch 8 — the three FIXABLE seam edges worked, and only one of them landed as written

Not a batch of migrated files: 4.1's ordered worklist is exhausted at row 61, and the thirty rows that
remain (62–91) carry **1,795 ms — 2.5% of the baseline — between them**, so none of them holds tests
whose time is material and none were migrated. What was worked instead is the three edges the batch-7
measurement named as the only path to the acceptance.

| run | `ℹ duration_ms` | wall | tests | pass | fail |
| --- | --- | --- | --- | --- | --- |
| 1 | 29.22 s | 29.28 s | 1,269 | 1,269 | 0 |
| 2 | 28.45 s | 28.51 s | 1,269 | 1,269 | 0 |
| 3 | 29.40 s | 29.46 s | 1,269 | 1,269 | 0 |

**Median 29.22 s**, against batch 7's 29.03 s — a **+0.19 s** movement, inside the spread of these
three runs (0.95 s) and inside batch 7's (0.64 s). **The half has not moved, and the honest reading is
that it could not have:** three tests migrating from the file rung to the unit rung, where the same
three cost ~10 ms in total, cannot show up in a 29 s run. Reported as a number rather than as a
direction, because it is not one.

**Command note.** The command above is the pre-commit hook's — BOTH rungs in ONE process — which is
what every batch in this file is measured with, so these numbers stay comparable with the 73.2 s
baseline and with each other. Task 0.3(a) named `scripts/test/assert/*.test.mjs` alone, which was the
whole half before 0.48.0 gave the half a second rung.

### THE THREE EDGES, AND WHAT EACH COST

| edge | outcome | tests | commit |
| --- | --- | --- | --- |
| E2 — `verifyState()`'s raw reads (`worktree-hygiene.mjs:120`/`:130`) | **SHIPPED** | 2 | `ee6778e` |
| E3 — `clearConflictsOn()` absent from the memory store's `writeRecord` | **SHIPPED** | 1 | `ba918da` |
| E1 — the `CLAUDE.md` managed rules block | **BLOCKED — needs a spec change** | ~27 | — |
| E3, second half — `commit-observe.json` in the `ARTIFACT` table | **BLOCKED — design D1's NOT-OWNED row** | 2 | — |

Each shipped edge is its own commit and each carries the test(s) it unblocks; the RED for each is
saved in this directory (`red-E2.txt`, `red-E3a.txt`) and named in its commit message.

**E1 AND E3's SECOND HALF ARE STOPS, NOT SKIPS**, and worklist-4.1.md carries the evidence for both.
E1 would amend the `engine-invocation` delta's boundary paragraph — the one the recorded cross-spec
review (task 0.2) lists as a BLOCK it FIXED, and whose hashes that verdict was recorded over — so
amending it stales the verdict and the artifacts Gate 1 reviewed. E3's second half would reverse design
D1's explicit NOT-OWNED row for `commit-observe.json`, on a mechanical rationale (the record is written
under an O_EXCL lock whose identity is an inode and a nonce, broken by an mtime stale-age rule).

**AND THE CONSEQUENCE FOR THE ACCEPTANCE, STATED PLAINLY: sub-15 s is NOT reached.** 29.22 s against a
29.03 s batch-7 median is 60.1% below the 73.2 s baseline and 2.0× the 12.2 s all-flush-removed control
— the control remains an upper bound that removes the file rung's flushes too, so it never licensed a
sub-15 s claim for the whole half. The gap between 29.2 s and 12.2 s is E1's ~27 tests, and E1 needs a
spec decision this apply loop is not authorised to make. A miss is reported as a miss with the number.
