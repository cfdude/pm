---
lesson: a-guard-can-check-the-wrong-half
date: 2026-08-27
trigger: About to rely on an existing test as proof that a behaviour holds — especially a guard someone wrote to protect a rule, and most especially one you or a teammate wrote recently.
cost: Three instances in one day. A drift guard that compared only titles while a mirror's body could contradict the generator. A file-preservation check that matched no delimiter and silently compared whole files, reporting 24 of 24 repos as damaged. A registry guard that proved a flag was DECLARED while an implementation that parsed and discarded it passed green.
rule: A guard proves the half it asserts, not the half it is named for. Before trusting one, neuter the behaviour it claims to protect and watch it fail — and read the assertion itself, not the test's name or its comment.
enforced_in: habit — the neuter-before-trust step; no mechanism
tags: [verification, false-signal, testing]
---

**Cause.** A test's name states an intention; its assertions state what it can actually detect.
The gap between those is invisible in a green run, and it widens exactly where the author was
most confident — because a test written to protect a rule you believe in is a test nobody
re-reads.

**The shape that recurs: checking registration instead of behaviour.** A guard walked a field
registry and asserted every source-artifact field was declared as a settable flag on all three
write commands. Its name said the field family could not drift. What it proved was that a *table*
listed a *name*. An implementation where the flag parsed cleanly, matched the registry, and then
wrote nothing at all passed it — the exact exit-0-write-nothing shape a prior release had already
been filed for. It was found only when the next author tried to rely on it and checked.

Sibling shapes, same family:

| The guard asserts | What it cannot see |
|---|---|
| the item is registered / declared | whether anything honours it |
| titles match between generator and mirror | whether the mirror's body contradicts the generator |
| the operation returned no error | whether it persisted |
| the check reported nothing | whether the check could report anything |

**Why "it passes" is not evidence.** A green test distinguishes nothing unless you know it can go
red. Where a check confirms what you already expect, that is the moment to doubt the check — see
[[hardcoded-live-data-claims-rot]] for the same principle applied to numbers, and
[[local-only-git-objects]] where a correct three-valued answer went quiet precisely when
everything broke at once.

**The step.** Before citing a test as proof: **neuter the behaviour and watch that test fail.**
Not the suite — that test. If it stays green, it was never covering what its name says. This costs
about a minute and it is the only thing that separates coverage from decoration.

Mutation-test guards you *write*, too, and mutate the **call site** as well as the helper: a live
helper reached by dead code passes every test of the helper. That one has surfaced twice here.
