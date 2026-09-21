---
lesson: a-one-off-sweep-certifies-only-the-day-it-ran
date: 2026-09-17
trigger: You are running a sweep inside a change — a script under the change directory or a scratchpad, never added to the suite — over a whole class of output (every emitted command, every doc invocation, every call site), and you are about to record its zero-findings result as a claim about the product.
cost: 0.44.0's `every-verb-refuses-what-it-does-not-read` swept 487 emitted lines through `checkCommandLine()` and recorded "no emitted line needed correcting" in its archived call-site-sweep.md. It checked argv SHAPE only, once, and was archived with the change. The next release found four remedies the engine printed and then refused, tracker recipes that could not be filled or ran the wrong command, and docs teaching refused gate forms — every one a well-formed line the sweep passed. When `emitted-commands-run-as-written` made the sweep a permanent test that EXECUTES each remedy, its first run against the pre-change engine had 38 of 63 Layer B tests RED (some because the registries the harness reads were not yet exported), and fixing the class took a full OpenSpec change with four Gate 2 rounds.
rule: A sweep over a class of output is a test, so make it one. Put it in the suite, where every later edit of that class re-runs it; a script that lives in a change directory stops checking the day the change archives. And state its zero-findings result as exactly what it checked ("every line passes the argv check"), never as the property it was run for ("every emitted command works").
enforced_in: scripts/test/emitted-invocations.test.mjs — the permanent Layer A/B/C sweep that replaced the one-off, including the source scan that fails when a printed-invocation template is reached by no fixture. AND, since 0.47.0, for a sweep that is too slow to run per commit: scripts/test/drift.mjs check 4 + scripts/test/certify.mjs — a certification record keyed by CONTENT, which the pre-commit hook reads on every commit and refuses when a certified module's staged content has no matching `contentHash`. Beyond those, a habit; no mechanism notices a sweep left out of the suite.
tags: [verification, false-signal, testing, sweeps]
---

**Cause.** Two failures compound. The first is the one `a-guard-can-check-the-wrong-half` names: a
check proves the half it asserts. An argv check can say a line is well-formed; it cannot say the
engine accepts it once domain logic runs, or that running it clears the condition that printed it.

The second is what this lesson adds: **a one-off check has no future.** The 0.44.0 sweep was right
about the day it ran, and its result was written into an archived document as a sentence about
the product. Every remedy, recipe and doc line edited after that day was checked by nothing, while
the archived sentence kept saying the class was clean. A later reader citing it had no way to tell
a finding from a fossil.

**The step.** When a sweep is worth running once over a whole class, it is worth running on every
commit: move it into `scripts/test/` in the same change, derive its population from the code (never
from a list typed into the test), and word its result as what it measured. If it cannot be made
permanent, date the claim and name what it did not check.

**The mechanism this lesson was missing, added 2026-09-21 by `functional-assertion-test-split`
(0.47.0).** "Move it into `scripts/test/`" answers the sweep that is FAST enough to run per commit.
It says nothing about the sweep that is not — the output sweep here re-reads 61 source files and
takes ~18 s, which is not a cost the per-commit gate can pay on every keystroke. That gap is the
one this lesson named and did not close: a sweep that must run on a trigger is, from the commit
gate's point of view, indistinguishable from the one-off it replaced — it ran, and nothing connects
that fact to the next edit of the thing it swept.

THE CERTIFICATION RECORD IS THAT CONNECTION, and the difference from the one-off is three
properties, not one. It is **machine-readable** (`$(git rev-parse --git-common-dir)/pm-suite-certification.json`
— a claim nobody has to remember reading). It is **keyed on CONTENT**, not on a commit or a date,
so it goes stale the moment a byte of the swept subject moves and NOT when the change archives —
which is precisely how the 0.44.0 sentence became a fossil. And it is **CHECKED ON EVERY COMMIT**
by a script that spawns nothing but four git index reads (`.githooks/pre-commit` → `scripts/test/drift.mjs`,
check 4), which refuses with the run's own name rather than starting it: *"the certified
change-triggered bucket 'engine-source' changed (scripts/lib/rank.mjs), and the record covers
DIFFERENT content — it was written before this change. Run `node scripts/test/certify.mjs sweeps`
to certify the new content."*

The trigger boundary is also now stated rather than assumed: CI is where the triggered buckets
actually run, with no record present and none substitutable, so the record is a convenience for the
developer and never the only thing standing between a change and an unrun sweep.
