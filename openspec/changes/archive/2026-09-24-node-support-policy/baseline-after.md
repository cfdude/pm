# Baseline — AFTER (tasks 8.1, 8.2, 8.3)

Against `baseline-before.md` (0.3, measured at `9fa4163`).

## 8.1 — the hook on this machine, end to end

Measured 2026-09-24 at `cd093fe` (the last commit that changes anything the hook runs), in a
hermetic clone under the session scratchpad (`apply-49/after/clone`), never in this checkout. Same
machine (darwin-arm64, 16 CPUs), same Node the hook resolves (`/opt/homebrew/bin/node`, `v26.9.0`),
same method as 0.3: `sh <hook>` from the clone root with nothing staged — secret scan, suite lock,
drift script, the runner and the floor, all of it — timed by `Date.now()` around the hook, with one
added `cp "$tmpfile" "$PM_BENCH_LOG"` line so the runner's summary could be read. One warm-up run
discarded. The hook now has ONE mode: per-file, no probe.

| Run | Hook wall, end to end (ms) | runner `ℹ duration_ms` | `ℹ tests` | hook's line |
|---|---|---|---|---|
| 1 | 22,688 | 14,216.7 | 1298 | `pre-commit: 1298/1298 passing` |
| 2 | 24,006 | 15,714.8 | 1298 | same |
| 3 | 25,340 | 16,983.9 | 1298 | same |

Median **24.0 s** end to end (runner 15.7 s), against 0.3's **33.55 s** for the hook as it was
(single-process, runner 27.1 s): **−9.5 s, −28 %** at the hook. 0.3's per-file scratch copy of the
old hook measured 22.0 s; the committed hook is within run-to-run noise of it (it runs 29 more tests,
1298 against 1269, and the drift step and the floor are unchanged). About 8 s of every run is the
hook's own work outside the runner (drift script, the `declared` enumeration, the lock).

**Design D10's outcome, in one line: NOT under 15 s — the end-to-end hook is 24.0 s median on this
16-CPU machine.** So `store-owns-claude-md-managed-block`'s premise (0.48.0's missed sub-15 s
acceptance for the HOOK) stands unchanged; this change does not edit, re-scope or disposition that
epic.

**(d) Leaked temp directories.** After 2.6's cleanup, `os.tmpdir()` held **0** `pm-assert-no-git-*`
and **0** `pm-empty-cache-*` before these four hook runs and **0 / 0** after them — and still 0 after
every commit hook and every `certify` run since 2.6. Against 0.3(d)'s 4,043 / 6,879 and their growth
of about 137 / 123 per per-file run.

## 8.2 — CI per matrix leg, against 0.3(c)

From this change's own run on the throwaway draft PR (`ci-verify-4.5.txt`, run 36089089608, branch
head `85670f8`, ubuntu-latest), against run 35722337413 (Node 18, one job):

| | Job | Syntax | Assertion half | Functional half | Sweep bucket |
|---|---|---|---|---|---|
| **0.3(c): Node 18, one job** | 4 m 46 s | 6 s | 16 s | 3 m 24 s | 51 s |
| `test (node 22)` | 4 m 18 s | 7 s | 14 s | 3 m 03 s | 43 s |
| `test (node 24)` | 4 m 18 s | 7 s | 14 s | 3 m 12 s | 38 s |
| `test (node 26)` | 3 m 38 s | 6 s | 15 s | 2 m 35 s | 31 s |

No leg is slower than the Node 18 baseline, in the job or in any bucket step. The legs run in
parallel, so the required check's wall clock is the slowest leg plus the compute job (6 s) and the
aggregate (4 s): the PR's CI finished 4 m 35 s after it was created (03:07:42 → 03:12:17 UTC), against
4 m 46 s for the single Node 18 job — three majors tested for about the price of one.

## 8.3 — per-file against single-process ON A CI RUNNER

Run 36089977671 on the same throwaway draft PR (#221, closed unmerged, branch deleted remote and
local; `git ls-remote origin ci-verify-049` empty). A throwaway `bench` job on ubuntu-latest,
Node v24.21.0, **`nproc` = 4**, ran the assertion half six times, interleaved, as
`FORCE_COLOR=0 node --test --test-reporter=spec [--test-isolation=none] scripts/test/unit/*.test.mjs scripts/test/assert/*.test.mjs`:

| Mode | Run 1 | Run 2 | Run 3 | Median wall | `ℹ tests` |
|---|---|---|---|---|---|
| per-file (default) | 14,549 ms | 14,490 ms | 14,395 ms | **14.49 s** | 1294, all pass |
| single-process (`--test-isolation=none`) | 11,314 ms | 11,364 ms | 11,333 ms | **11.33 s** | 1294, all pass |

**Per-file is SLOWER on a 4-core CI runner: +3.2 s, +28 %.** On this 16-CPU machine it is the other
way round (0.3: 14.6 s per-file against 27.1 s single-process for the runner). The parallel win needs
cores; the per-process boot cost does not. The decision to drop single-process stands (Rob,
2026-09-24): one command on every supported major, a failure attributed to the file that failed, and
no probe. The number is recorded so the trade is known — on a 2–4 core machine the half now costs
about 3 s more per run than it would single-process.
