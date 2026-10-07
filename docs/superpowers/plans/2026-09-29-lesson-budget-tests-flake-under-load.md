# lesson-budget-tests-flake-under-load — plan

**Epic:** `lesson-budget-tests-flake-under-load` (superpowers lane, release 0.51.0, P3).
**Goal:** the lesson-detect budget tests check the PROPERTY — per-regex budget, per-call ceiling,
fail-closed on an exhausted budget, and that the real `node:vm` timeout interrupts a catastrophic
regex — as VALUES, with no assertion that depends on wall-clock time under load. Timeouts are not
widened.

## Premise, as verified against today's code

- Tests: `scripts/test/unit/lesson-detect-rules.test.mjs` — four tests use the REAL clock and the
  REAL `vm` watchdog: "cut off inside the budget", "a runaway lesson listed FIRST…", "the whole hook
  call is bounded by REGEX_CEILING_MS…", "a suppression regex that runs out of budget…". Each
  asserts `performance.now()` deltas (`< REGEX_BUDGET_MS + 1900`, `< 1500`).
- Engine: `scripts/lib/lessons.mjs` `boundedTester(budgetMs, ceilingMs)` reads `performance.now()`
  directly and runs `re.test(s)` in a `vm` context with `timeout: left`. No seam for a clock.
- **Reproduced (RED):** the unit file run at `nice -n 20` against 32 normal-priority busy-loop
  processes (load average ~150) failed 1/10: "a runaway lesson listed FIRST…" got `[]`, expected
  `['z-good.md']`, in 299 ms total. A direct probe at load ~600 missed the benign lesson 1/20 with
  its worst call at 696 ms — BELOW the 1000 ms ceiling. So the ceiling did not starve `^a`: its own
  50 ms `vm` watchdog fired while the main thread was descheduled. Any test that expects a HIT
  through the real default budget can flake, not just the ones with time bounds.

## Tasks

### Task 1 — inject the clock and the regex runner; test allocation deterministically

- Engine: `matchLessons(event, lessons, { budgetMs, ceilingMs, now, runRegex })`. `now` defaults to
  `performance.now` and feeds BOTH the deadline and each `left`; `runRegex(re, text, timeoutMs)`
  defaults to the exported `boundedRegexTest` (the existing `vm` body, context still lazy).
  Production behaviour is byte-identical.
- RED: new unit tests using a fake clock + a recording fake runner (a runaway advances the clock by
  the grant and returns `null`; a benign regex returns `true` with no advance) fail before the seam
  exists (options ignored → real vm → grant log empty).
- GREEN assertions (grant sequences, not elapsed time):
  - `[bad, good]` at 50/1000 → grants `[50, 50]`, good fires.
  - three runaways at 50/120 → grants `[50, 50, 20]`.
  - twelve runaways at 300/100 → grants `[100]`, runner called once.
  - a `commandLacks` returning `null` suppresses.
- REGRESSION GUARD, mutation proof (each must turn a test red, then revert):
  - shared budget (`deadline = now() + budgetMs`) → good misses.
  - drop the ceiling clip (`left = budgetMs`) → grants of 300.
  - `commandLacks … !== false` → `=== false` → the suppressed lesson fires.

### Task 2 — real `vm` coverage as a value; drop the wall-clock assertions

- `boundedRegexTest(/^(a|a)*$/, "a"*25+"!", 50)` returns `null` (load only delays it).
  Mutation: drop `timeout` → returns `false` after ~10 s → test fails on the value, not a hang.
- End-to-end through the real defaults: `[bad]` → `[]`, suppression runaway → `[]` (both hold under
  any load, because an exhausted budget is a non-match).
- Tests whose subject is NOT the budget (`MATCH_TEXT_CAP`, the old positive-hit cases) pass a budget
  that cannot bind, `{ budgetMs: 60_000, ceilingMs: 60_000 }`, with a comment saying why.
- Never assert a benign real-`vm` hit with a small timeout.
- Verify: the same load harness at N/N green.

## Required task items (CLAUDE.md "The gate procedure")

1. **Call-site sweep.** `rg -n "matchLessons|boundedTester|boundedRegexTest|REGEX_BUDGET_MS" scripts`
   — the one production caller is `lessonAdvice()` (defaults only); the rest are this unit file.
   Hook-level positive-hit tests (`assert/conductor-28`, `assert/lesson-detect-corpus`,
   `functional/output-text-integrity`) run the real default budget through the hook and cannot take
   options: named as residual exposure, not fixed here (an engine knob for tests is out of scope).
2. **Inverses.** The seam adds an option, not a write operation; its inverse is omitting it
   (defaults), covered by the end-to-end real-default tests. Nothing to revoke.
3. **Verify against the commit.** `git show --stat <sha>` after each task commit.
4. Lifecycle / attribution / archive: the orchestrator attributes commits after merge.
