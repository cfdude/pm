---
description: Decide what to work on next (resume a detour, or the top-priority epic)
allowed-tools: Bash, Read
---

Determine the next thing to work on and state it clearly.

Read the current state (`node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" render` then
`PROJECT.md`), and apply this order:

1. **If the detour stack is non-empty** → the next action is to finish/resume the TOP
   frame. If its detour epic is already archived, this is a `/pm:resume` (which triggers
   the reconcile gate). Do not start new work while a detour is unresolved.
2. **Otherwise** → the highest-priority epic with status `queued` (P0 → P3). If the active
   epic still has open stories, that is the default next action.
3. Surface ties or ambiguity to the user instead of guessing.

End with a single, concrete recommendation: "Next: \<epic\> — \<the specific story/phase\>."
