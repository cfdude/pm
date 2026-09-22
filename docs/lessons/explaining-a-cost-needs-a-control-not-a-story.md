---
title: Explaining WHY something is slow needs the control that removes the suspected term, not a plausible story about it
lesson: explaining-a-cost-needs-a-control-not-a-story
date: 2026-09-22
trigger: You are about to write down, in a proposal, a design document or a commit message, the REASON a suite, a build or a pipeline is slow — before running the control that removes the term you are blaming.
cost: One release's design argued from a mechanism nobody had measured. 0.47.0 removed the process boundary from the assertion half and left the half at 86.0 / 73.8 / 67.8 s, and the explanation on record was "each test rebuilds a repository: init + N add-epic + render ≈ 6 engine round trips, ~60–95 ms". Every one of those numbers was real; the CONCLUSION did not survive measurement. Measured through the half's own harness: a state load is sub-millisecond, a render is 0.30 ms, `mkdtemp` is 0.32 ms — the engine was never the cost. The cost was the DURABILITY FLUSH: 12,524 `fsyncSync` calls per run, and replacing that one syscall with a no-op takes the same 1,243 tests from 73.9 s to 9.11 s. The next change was drafted against the wrong mechanism because the story was convincing, and a wrong mechanism sends the work at the wrong layer.
rule: Before explaining a cost, remove the term you are blaming and measure the difference. One syscall, one layer, nothing else changed — if the number does not move, the story is wrong. A plausible decomposition ("it does six round trips per test") is not evidence; it is a hypothesis, and it is the one most likely to be believed because it is detailed.
enforced_in: The unit-rung-and-fixture-snapshots change (0.48.0) — task 0.3 captures a BASELINE at both ends, including the no-op-flush CONTROL as a committed, re-runnable script (`openspec/changes/unit-rung-and-fixture-snapshots/noop-fsync.cjs`), and task 6.5 re-runs it on the final commit. The acceptance is a measured number rather than a claim.
tags: [measurement, process, false-signal, performance]
---

## What happened

0.47.0 split the test suite in two and made the assertion half run in one process. It worked, and
the half was still slow. The explanation that went into the record was that each test rebuilds a
repository — init, N `add-epic`, render — at six engine round trips per test.

Every ingredient of that story is true. A test DOES rebuild a repository. Those verbs DO exist. The
per-test cost DOES land in the 60–95 ms range. What the story never checked is whether the rebuilds
are where the TIME goes, and the answer is no:

| operation | today | with `fsyncSync` a no-op | flushes |
| --- | --- | --- | --- |
| `init`, fresh dir | 55.9 ms | 2.79 ms | 8 |
| `add-epic`, 0 epics present | 16.6 ms | 1.66 ms | 2 |
| `render`, initialised dir | 0.55 ms | 0.34 ms | **0** |
| `brief`, initialised dir | 0.35 ms | 0.24 ms | **0** |
| `mkdtemp` | 0.10 ms | 0.06 ms | **0** |

The engine's own work is sub-millisecond. `init` costs what it costs because `saveState()` fsyncs the
temp file before its rename and then fsyncs the directory, and every verb in the engine ends by
calling it. The whole half is durability paid on tests that assert on a value: **12,524 flushes per
run**, and with that ONE syscall replaced by a no-op the same 1,243 tests pass in 9.11–12.2 s
against 72–74 s.

**Why the wrong story is worse than no story.** It is actionable. "Each test rebuilds a repository"
sends the work at repository rebuilding — fixtures, caching, shared setup — which is a real
optimisation that would have moved the number by a few percent and left the fsyncs in place. The
control pointed at a seam instead: separate the engine's DECISIONS from its PERSISTENCE and a test
that reads a value back out of an object stops paying for a power-loss guarantee it does not need.

**And the margin itself had to be re-measured.** The change's own first draft carried a 6.47 s /
≥10× control. Gate 1 ran the control and got 9.11 s — the same mechanism, a smaller margin — and the
acceptance was restated against the reproducible number rather than the flattering one. A control
that is run once and quoted forever is the same defect one level down.

## The rule

**Remove the term and measure.** Before writing "this is slow because X", delete X — stub the
syscall, cut the layer, skip the step — change nothing else, and run it. If the number moves, you
have a mechanism. If it does not, you have a hypothesis, and the detailed ones are exactly the ones
that get believed.

The control belongs WITH the claim, as a runnable script and a recorded number at both ends of the
work. A control that lives only in the conversation that produced it is a control nobody can re-run
when the machine changes.

## Why this declares NO `detect:` matcher

The situation is "about to explain a cost", and that is recognisable — but only by reading a draft's
argument, not by matching text. A matcher on words like "slow" or "because" fires on every
performance note including the well-evidenced ones, and a hook that is wrong seven times in eight
trains everyone to ignore the one time it is right. This lesson stays RETRIEVAL-ONLY: the `lessons`
skill opens it when the situation is described, and nothing fires it automatically. (Declaring no
matcher is a design choice and not an omission — `lessons-index.test.mjs` says so in as many words.)
