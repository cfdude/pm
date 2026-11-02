---
name: mutation-pass
description: Prove every guard a change adds can actually fail — mutate it, watch a test go red, and keep the run as mutation-evidence.txt — and write RED notes relative to a task, not to the release baseline. Use when a change adds a test, a refusal, a gate, a check or any condition meant to protect a rule; before closing the task that adds it; when authoring or applying a task list that carries RED notes ("fails today"); and when a green run is the only evidence a guard works. Triggers "does this test go red", "neuter it and see", "mutation pass", "prove the guard fails", "surviving mutant", "RED note", "fails today", "mutation-evidence".
---

# Mutation pass — prove the guard can fail

This is required task item 8 of the gate procedure ("Prove every guard can fail."). The item is the
obligation; this skill is the method. Both gates read a diff, and a test that cannot go red is invisible
to a diff: it is green before the change, green after it, and says nothing.

Evidence for the rule: operations-ship-their-inverses (0.46.0) neutered every guard it added and saved the
batch. Six mutants, five died, ONE SURVIVED AND WAS A REAL DEFECT. Removing `drop-detour`'s own
`reconcileNeeded` recompute left all 17 tests green, because a later drift heal cleared the flag one write
after, and every assertion read the final value. Nothing in the seven earlier items would have found it.
See `docs/lessons/a-guard-can-check-the-wrong-half.md`.

## The pass, per guard

1. **List the guards.** Every condition, refusal, registry entry, gate or check this change adds, derived from
   the diff (`git diff <base>..HEAD`), not typed from memory. Include the CALL SITE that reaches each one:
   a live helper reached by dead code passes every test of the helper.
2. **Mutate one at a time.** Remove the condition, or invert it (`if (x)` becomes `if (!x)`), or make the
   guarded behaviour a no-op (return early, write nothing). One mutation per run; never two together, because
   a failure then cannot be attributed.
3. **Run the tests that claim to cover it** (the file, then the half). Record: mutant, command, result.
4. **Restore.** `git checkout -- <file>` or `git stash`; confirm `git diff` is empty for that file before the
   next mutant. A mutant left in the tree is the worst outcome of this practice.
5. **Save the run** as `mutation-evidence.txt` beside the change (the OpenSpec change directory) or the plan
   (the plan's folder). A named file lets the gate read the evidence instead of trusting a sentence.

## What counts as a surviving mutant

A mutant SURVIVES when every test is still green with the guard neutered. A surviving mutant is a finding
to fix, never a redundant test to delete and never "covered elsewhere" without naming the test that kills it.
Fix it by strengthening the assertion until the mutant dies; the usual cause is an assertion on a final
value that two different mechanisms both produce. Assert on the intermediate: the verb's own stderr, the
write itself, the first state rather than the healed one. Then re-run the mutant to prove it now dies.

A mutant that dies for the wrong reason (a syntax error, a crash in setup) does not count. Read the failure.

## Evidence file shape

Plain text, one block per mutant, in the order run:

```
mutant 3: remove the reconcileNeeded recompute in drop-detour (scripts/lib/detours.mjs, dropDetour)
run:      node --test scripts/test/unit/detours.test.mjs
result:   SURVIVED (17/17 pass)
action:   asserted on the drop's own stderr; re-run -> KILLED (1 fail: "drop reports the recompute")
```

End with a tally line: `N mutants: K killed, S survived (all S fixed and re-killed)`. A `SURVIVED` with no
`action` line is an open finding.

## RED notes are task-relative (issue #211)

A task list's RED note ("fails today") is written against the release baseline. Earlier tasks in the same
change land before the later task runs, so the behaviour it names as failing may already be green, turned
green by the change's own earlier work. The applier is then forced to weaken the test or silently diverge
from the task text.

- **Write the note relative to a task:** `fails after 2.4` (it fails once 2.4 has landed and not before the
  task that fixes it), or `fails at baseline` (it fails on the pre-change tree and nothing earlier in this
  change touches it). Never a bare "fails today".
- **Re-run the note's named assertion at the START of the task that depends on it.** If it is already green,
  the note is stale: say so in the commit, and either strengthen the test until it is a real RED or record
  that the earlier task delivered the behaviour. Do not weaken the test to turn it red again.

Worked example. Task list:

```
2.4 add the shared allow-path (RED: fails at baseline)
2.7 route the write through it   (RED: fails after 2.4 ... NOT "fails today")
```

At the start of 2.7, re-run 2.7's test. Written "fails today" it would have been true at baseline, and after
2.4 landed it is already green: the applier would face a test that no longer tests the change. Written
"fails after 2.4" and re-run when 2.7 starts, the staleness is legible at once: the test is green, so either
2.7's behaviour was delivered by 2.4 (record it, move on) or the test pins the wrong thing (strengthen it).

## Not in scope

This does not replace a mutation-testing framework and adds no dependency. It is a hand-run pass over the
guards one change adds. A guard that cannot be run from the test suite at all (it needs production) is split
into a real test and a mocked twin by the repository's test policy, and the mutation runs against the twin.
