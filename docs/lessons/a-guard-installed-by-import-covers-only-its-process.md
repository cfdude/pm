---
lesson: a-guard-installed-by-import-covers-only-its-process
date: 2026-09-24
trigger: Before changing how a test runner isolates files — dropping a single-process flag, raising concurrency, sharding — list every guard installed as a side effect of an import (a PATH shim, an exit listener, a monkey-patched module, a counter armed at load).
cost: 0.49.0's switch to per-file isolation would have left 13 file-rung files running with the real `git` reachable and nothing counting — they had relied on the unit rung's harness installing the git shim in the one process they shared — and the shim's and the harness's temp directories leaked once per process instead of once per run (4,043 and 6,879 had already accumulated). No test failed; all three guards simply stopped guarding. Found only by reading every import for side effects.
rule: A guard installed by an import covers the PROCESS that imported it, never "the suite". When isolation changes, enumerate every side-effect install, then make each file install what it relies on itself and add a walk that refuses a file which does not. Per-process resources a guard creates must be removed per process.
enforced_in: scripts/test/assert/assert-half-has-no-spawn.test.mjs — "2.1 every file in both rungs installs the git shim itself" walks both rungs and refuses a file that imports neither the shim nor a harness that installs it; scripts/test/assert/git-shim.test.mjs covers the per-process removal. Beyond the git shim, a habit.
tags: [testing, isolation, guards, side-effects]
---

**Cause.** A guard installed at import time is invisible at every call site: nothing in a test file
says "I am protected by the shim another file installed". While the runner shares one process, the
first file to import the harness protects every file after it, so a file that imports nothing gets
the guard for free — and nobody notices it depends on that, because it passes either way.

**What changed when the process boundary moved.** Three guards had been leaning on the shared
process (design D3 of node-support-policy): the git shim's coverage (13 files imported neither the
shim nor a harness), the G-I4 direct check (it read "the half up to this point" and now read one
file), and the shim's temp directory (one per run became one per file). The harness's empty cache had
the same leak shape. None of them failed a test when the isolation changed; each one quietly started
guarding less.

**How it was found.** Not by a failing test — the 1,269 tests passed per-file on 22, 24 and 26. By
listing every rung file whose imports named none of the shim-installing modules, and reading every
module-level `mkdtempSync` and `process.on("exit")`.
