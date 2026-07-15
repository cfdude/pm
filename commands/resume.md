---
description: Resume a paused epic after a detour — runs the mandatory reconcile gate
allowed-tools: Bash, Read, Edit, Task
---

Resume the epic at the top of the detour stack. This is where context is normally lost, so
be deliberate.

1. Confirm the detour epic is **archived** and its work is committed/deployed. If not, it's
   not time to resume — finish the detour first.

2. **Pop** the top frame from `.conductor/state.json` `detourStack`. Set the paused epic's
   `status` back to `active` and set `active` to it.

3. **RECONCILE GATE** — if that frame had `reconcileOnResume: true`, do NOT write code yet.
   Delegate a clean-context review to the **reconciler** agent (via the Task tool): give it
   the paused epic id and the detour epic id. It re-reads the paused proposal, diffs what
   the detour actually changed, and reports back `VERDICT: valid|invalidated` plus
   `AMENDMENTS:` (stories to add/remove/amend, one per line).
   - **Invalidated** → amend the OpenSpec proposal and `tasks.md` first.
   - **Still valid** → say so explicitly.
   - Either way, **write the verdict back durably** instead of just clearing the flag by
     hand: `node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" record-reconcile <paused-id>
     --detour <detour-id> --verdict <valid|invalidated> --amendments "<a>;<b>;..."`. This
     attaches `{verdict, amendments, reconciledAt}` onto the paused epic's link to the
     detour and clears `reconcileNeeded` in one step.

4. **Write a Honcho memory** for the resume. Get the exact ready-to-copy line via:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" honcho-memory pop <parent-epic-id> "<detour-id>; reconcile = valid | amended: …"
   ```
   Prints `resumed <parent>, reconciled vs <detour-id>; reconcile = valid | amended: …` and
   appends it to `.conductor/honcho-memories.log`. Paste that printed line into your actual
   Honcho MCP memory/conclusion tool call.

5. Re-render: `node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" render`, then state the
   exact next story to build on the resumed epic.
