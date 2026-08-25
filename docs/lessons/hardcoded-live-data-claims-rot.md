---
lesson: hardcoded-live-data-claims-rot
date: 2026-08-23
trigger: Writing a test, task, or spec whose verification names a count drawn from live data.
cost: A task list asserted "four zero-ticked epics" and "68 archived". Within the hour a routine workaround made them five and 69. A correct implementation would have failed the task's own verification.
rule: State verifications relatively. Quote counts as dated snapshots, never as the assertion.
enforced_in: tasks.md authoring brief
tags: [verification, false-signal]
---

**Cause.** A verification naming a count asserts a fact about a repository that keeps changing —
including as a side effect of the work being verified.

The damaging part is the likely response: an implementer who sees a correct build fail a count
assertion weakens the check rather than fixing the number.
