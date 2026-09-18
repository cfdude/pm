---
lesson: a-surviving-mutant-can-be-a-second-mechanism-not-a-weak-test
date: 2026-09-18
trigger: You are mutation-checking a guard whose write is followed, in the same command, by a self-healing or normalising pass over the same field — a render, a reconcile, a recompute, a migration, a formatter.
cost: operations-ship-their-inverses task 3.6. Neutering `drop-detour`'s own `reconcileNeeded` recompute left all 17 tests green. The flag still read false afterwards, because `render()` runs after the save and the drift heal cleared it a write later — which is precisely the intermediate state the capability's spec says the engine cannot produce. Every assertion in the file read the FINAL value, so nothing could tell the two mechanisms apart. Found only because the mutation pass was run at all; four more mutants in the same batch died correctly, which is what made the survivor look like noise.
rule: When a mutant survives, first ask WHO ELSE writes that field on the same code path — not whether the test is weak. Where a downstream heal repairs what the mutation broke, the assertion must observe the STEP, not the end state: assert on the mutated command's own output, or read the file between the two writes. An end-state assertion cannot distinguish "the guard did it" from "something else fixed it afterwards".
enforced_in: habit; scripts/test/detour-frame-drop.test.mjs's "3.6: a render after the drop neither re-arms nor re-clears anything" asserts the drop's OWN stderr carries no heal line, as the worked example
tags: [testing, verification, false-signal, mutation]
---

**Cause.** A self-healing pass exists precisely to make a field's value correct however it got
wrong. That is the same thing a guard does, so on the happy path the two are indistinguishable by
their result — and a guard's test almost always asserts the result. The heal is usually invoked one
line after the write it would cover, inside the same verb, so the window in which the record is
wrong never reaches the filesystem the test inspects.

**Why the surviving mutant reads as noise.** The batch around it behaves perfectly: remove the
stamp, a test fails; leave the link armed, four tests fail; select the wrong frame, a test fails.
Against that, one green run looks like a test that is merely redundant — "the other assertions
already cover it" — and the cheap conclusion is to delete the mutation or shrug. The expensive and
correct conclusion is that a *second* mechanism is holding the invariant up, and nothing in the
suite knows which one is load-bearing. Remove the guard for real and the record passes through a
state the spec forbids, briefly, on every call.

**The tell is usually an announcement.** A heal that repairs something generally says so — pm's
prints `cleared the reconcile obligation on '<id>'`. That line is the cheapest possible
discriminator: assert the guarded command does **not** print it. Where the heal is silent, the
alternatives are to read the state file between the two writes, or to assert on the field the heal
does *not* touch (here, the link's `dropped` stamp).

**Related.** [[a-guard-can-check-the-wrong-half]] is the general form — a guard proves the half it
asserts, not the half it is named for. This is its sharpest instance, because here the guard's name
and its assertion agree and a *third* party is what makes the assertion pass.
