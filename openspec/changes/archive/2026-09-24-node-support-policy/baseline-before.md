# Baseline — BEFORE any code (task 0.3)

Measured 2026-09-24 at `9fa4163` (HEAD of `dev`, before the first code commit), in a hermetic clone
under the session scratchpad (`apply-49/baseline/clone`), never in this checkout. Machine: darwin-arm64,
16 CPUs (`sysctl -n hw.ncpu`). The Node the hook resolves: `command -v node` = `/opt/homebrew/bin/node`,
`node --version` = `v26.9.0`.

## (a) + (b) The hook, end to end, both modes

Each run is `sh <hook>` from the clone's root with nothing staged: secret scan, the suite lock, the
drift script, the runner and the floor. Wall clock is `Date.now()` before and after the hook.

The two scratch copies of the hook differ from the committed hook in ONE added line after the runner
(`cp "$tmpfile" "$PM_BENCH_LOG"`), so the runner's own summary could be read. The per-file copy also
has `ISOFLAG=""` in place of `ISOFLAG=$(cat "$ISOFLAGFILE")`. One warm-up run went first and was
discarded; it paid the one-time probe, which cached `--test-isolation=none`.

| Mode | Run | Hook wall (ms) | runner `ℹ duration_ms` | `ℹ tests` | hook's line |
|---|---|---|---|---|---|
| single-process (hook as it is) | 1 | 33,551 | 27,107.6 | 1269 | `pre-commit: 1269/1269 passing` |
| single-process | 2 | 33,470 | 26,661.0 | 1269 | same |
| single-process | 3 | 34,570 | 28,016.7 | 1269 | same |
| per-file (`$ISOFLAG` forced empty) | 1 | 22,035 | 14,736.9 | 1269 | same |
| per-file | 2 | 22,002 | 14,555.0 | 1269 | same |
| per-file | 3 | 21,772 | 14,299.5 | 1269 | same |

Medians: single-process **33.55 s** hook wall, 27.11 s runner; per-file **22.00 s** hook wall, 14.56 s
runner. The ~7 s between the two columns in each mode is the hook's own work outside the runner
(drift script, the `declared` enumeration, the lock).

## (c) The last CI `test` job on `main`

`gh run list --repo cfdude/pm --workflow ci.yml --branch main --limit 1` → run `35722337413`
(`02ed32e`, 2026-09-22, success). From `gh run view 35722337413 --json jobs`, Node 18:

| Step | Start → end (UTC) | Duration |
|---|---|---|
| `test` job | 11:35:57 → 11:40:43 | 4 m 46 s |
| Assertion half | 11:36:11 → 11:36:27 | 16 s |
| Functional half | 11:36:27 → 11:39:51 | 3 m 24 s |
| Sweep bucket | 11:39:51 → 11:40:42 | 51 s |

## (d) Leaked temp directories

`os.tmpdir()` = `/var/folders/ng/9xps42_d057g6wm_glhntjhw0000gn/T`, counted BEFORE the bench runs
above: **4,043** `pm-assert-no-git-*` and **6,879** `pm-empty-cache-*`.

This file lands in the 1.1 + 1.2 + 1.3 commit, the first commit of the landing order.
