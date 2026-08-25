---
lesson: bind-rules-to-functions-not-enumerations
date: 2026-08-23
trigger: Writing a rule, guard, or invariant that applies "at every place X happens".
cost: Every BLOCKS finding across six review rounds was the same seam. Three paths became four became five; the requirement CLAIMING exhaustiveness was wrong four separate times.
rule: Derive the call-site set mechanically (`rg` for callers) and bind the rule to the FUNCTION, not to an enumeration that goes stale the moment a caller is added.
enforced_in: required task 16.1 of this release; issue #115
tags: [correctness, absent-edit, review]
---

**Cause.** Enumerating call sites from memory, or from the obvious entry points, rather than from the
function's actual callers. One function was invoked from four places, two of them interactive verbs
where the stated rationale ("no agent is present") was simply false.

This is the same defect class the release exists to fix, occurring in the requirements written to fix
it — which is the strongest argument for making the sweep a required task rather than advice.
