# Re-baseline: how much of the commit gate's assertion half is init's CLAUDE.md / .gitignore write?

Epic: `pm-overhead-baseline`, tasks 4.1 and 4.2. Gates the decision on `store-owns-claude-md-managed-block`
(epic note 2026-10-14: build only if the tests that write `CLAUDE.md`/`.gitignore` to disk carry 10 s or
more of the file rung; the 10 s figure is a PROPOSAL, not a measurement). Measured 2026-10-20 on `rc/0.53.0`
at `c5257d07`. Machine: MacBook, 16 logical CPUs, macOS 27.0, Node v26.12.0.

## Method

- The command the pre-commit hook runs, unchanged: `node --test scripts/test/unit/*.test.mjs scripts/test/assert/*.test.mjs`
  (2,292 tests: 1,400 unit, 892 file rung), timed with `/usr/bin/time -l`, run alternately, n=3 per arm.
- Instrumented arm: a dev-only `--import` preload (kept in the session scratchpad, not in the repo) that
  (a) registers a root `beforeEach`/`afterEach` to time each test, and (b) wraps `fs.writeFileSync` and
  `fs.appendFileSync`, timing every call whose target's basename is `CLAUDE.md`, `AGENTS.md` or
  `.gitignore`. A test "reaches the write" if it made at least one such call. Rung comes from the test
  file's directory (`unit/` or `assert/`). A watchdog hard-exits any process past 4 GB RSS (none did; peak
  RSS of the whole invocation was 194-205 MB).
- Control arm: the same command with an EMPTY preload, as in the 2026-09-25 profile, to bound the
  instrumentation's own cost.
- Per-test and per-write times are SUMMED across test processes that run in parallel; they are not wall
  time. Wall time is the invocation's.

## Machine state: NOT quiet

The spec asks for a quiet machine. This one was not: `uptime` load averages at the six starts were 6.1,
8.6, 7.9, 9.4, 15.9, 15.1 (1 minute), the iOS simulator runtime and `diagnosticd` were each using 75-80% of
a core, and other agent sessions were open. I did not stop anything. Treat these numbers as "stable under
load 6-16", and rerun on a quiet machine before relying on a sub-second difference.

## Results (n=3 each)

| Run | Load (1 min) | Wall | Unit rung, summed test time | File rung, summed test time | Tests reaching the write: n, summed | Time inside the write calls, summed |
| --- | --- | --- | --- | --- | --- | --- |
| instrumented 1 | 6.1 | 29.07 s | 9.1 s | 330.9 s | 525, 311.9 s | 27.3 s (1,986 calls) |
| instrumented 2 | 7.9 | 30.54 s | 9.2 s | 349.2 s | 525, 327.6 s | 30.2 s (1,986 calls) |
| instrumented 3 | 15.9 | 29.82 s | 9.8 s | 336.5 s | 525, 318.1 s | 27.8 s (1,986 calls) |
| control 1 / 2 / 3 (empty preload) | 8.6 / 9.4 / 15.1 | 30.53 / 30.22 / 30.07 s | n/a | n/a | n/a | n/a |

- Instrumentation cost: instrumented walls 29.07-30.54 s against control 30.07-30.53 s. No difference is
  detectable at this noise (about 1.5 s peak to peak).
- 525 of 892 file-rung tests (59%) reach a write; they carry 94-96% of the file rung's summed test time,
  the same share the 2026-09-25 profile found (96%).
- Time inside the write calls themselves is 8-9% of the file rung's summed time (27.3-30.2 s of 331-349 s).
  The median write call took 14.0 ms (p90 22.2 ms, max 38 ms). An isolated run of one test file measured
  0.1-0.3 ms per call, so the 14 ms is contention from running 15-16 test processes at once with a hot
  `syspolicyd`, not the cost of a write.
- Wall-equivalent of the summed figures: the invocation ran 340-358 s of summed test time in about 30 s of
  wall (about 12x parallelism), so 27-30 s summed inside write calls is roughly 2.3-2.6 s of wall.
- The largest single file-rung tests are not write-bound: `conductor-25` gh-85 takes 9.7 s and is the floor
  the 2026-09-25 note named (it checks bytes and mtimes of the whole tree); it made 60 write calls totalling 0.7 s.

## Against the 10 s gate (a proposal)

Design D7 defines the measure as "the summed time of file-rung tests that reach init's `CLAUDE.md` or
`.gitignore` write", against 10 s. On that measure:

| Measure | Value | Against 10 s |
| --- | --- | --- |
| Summed time of file-rung tests that reach a write (D7's measure) | 312-328 s summed across the three runs; about 26-28 s wall-equivalent (summed divided by the ~12x parallelism observed) | **Met**, by a wide margin, in all three runs |
| Same, as a share of the file rung | 94-96% (525 of 892 tests) | the 2026-09-25 profile found 96% |
| Time spent inside the write calls themselves (a LOWER BOUND on raw I/O only) | 27-30 s summed, about 2.3-2.6 s wall-equivalent | not the measure D7 sets, and not what the change removes (below) |

Why the write-call row is a lower bound and not the gate. What `store-owns-claude-md-managed-block` removes
is not the `writeFileSync` call; it is the need for those tests to be file-rung tests at all: a real
temp directory, `init`, fsync and the on-disk read-back. The 0.48.0 unit-rung migration measured that
difference directly for tests it moved: the same 1,243 tests ran in 12.2 s on an in-memory store against
73.2 s on disk (`scripts/test/fixtures/unit-harness.mjs`). So the write call is the smallest part of what
reaching the write costs a test.

What this measurement does NOT show: how many of the 525 reaching tests could actually move to the unit
rung (some assert bytes on disk and must stay on the file rung; `conductor-25` gh-85, 9.7 s, is the named
floor). The 94-96% share says the population is large, not how much of it moves. That is the number to size
before building, and it is a separate piece of work.

**Verdict on the gate as written: met.** (A proposal for the orchestrator to record on
`store-owns-claude-md-managed-block` and weigh at 0.54.0 grooming; the recommendation to build or decline
there rests on sizing the movable share, which this document does not do.) The not-quiet caveat above
applies: the walls were stable at 29.1-30.5 s across load 6-16, but a quiet-machine rerun is still owed
before relying on a sub-second figure.

## What changed since 2026-09-25 (task R.7's question: load or growth?)

The 2026-09-25 profile found the half at about 15.4 s with 546 file-rung tests. This run's half takes
29-30.5 s with 892 file-rung tests (+63%) and 1,400 unit tests. The wall time moved by under 1.5 s while
the load average ranged from 6 to 16, so load is not what moved it from 15.4 s. Test-count growth fits
(+63% tests, about +95% wall), with the remainder unexplained and the machine not quiet. The 2026-10-14
"loose run" at 28 s was therefore growth, not contention. This is a finding for the orchestrator to route
(item 7): the commit gate has roughly doubled in ten days and the next pm release adds tests of its own.
