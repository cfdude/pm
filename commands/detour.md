---
description: Handle a mid-build interruption — classify it, and park current work if needed
argument-hint: "[what came up]"
allowed-tools: Bash, Read, Edit
---

Something came up mid-build: **$ARGUMENTS**

Do NOT start fixing yet. Follow the `conductor` skill's detour protocol.

1. **Classify out loud:**
   - **Minimal** — small, self-contained, no design ambiguity, fits before the next
     compaction, doesn't reshape the current proposal → fix → test → commit → push, then
     **record it** so it leaves a trail:
     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" log-detour "<what you fixed>"
     ```
     (Appends a timestamped line + commit SHA to `.conductor/detours.log`.) Then resume.
     No proposal, no stack entry. If invoked as `/pm:detour --minimal "<what>"`, do exactly
     this and stop.
   - **Substantial** — needs its own design, changes shared behavior, or is multi-step →
     it becomes its OWN OpenSpec proposal. Run PUSH below. When unsure, treat as substantial.

2. **PUSH (substantial only):**
   - Make the current epic's `tasks.md` reflect reality; commit so nothing is uncommitted.
   - In `.conductor/state.json`: set the current epic `status: "paused"`; push a frame:
     `{ "pausedEpic", "pausedAt", "reason", "spawnedDetour": "<new-id>", "reconcileOnResume": true }`.
     Default `reconcileOnResume: true` whenever the detour will touch code the paused epic
     depends on.
   - Add the new detour as an epic (`role: "detour"`, usually `P0`) and record the links:
     detour `resolves-blocker-for` parent; parent `may-invalidate` detour.
   - Set `active` to the detour. Then create the OpenSpec proposal for it and build through
     your normal propose → review → apply → review → commit → archive loop.

3. **Write a Honcho memory** for the pivot: one line, e.g. "Paused `<parent>` to handle
   `<detour>` — <reason>." Use your Honcho MCP memory/conclusion tool. This keeps the
   relationship recoverable even outside this repo.

4. Re-render: `node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" render`.

When the detour is archived, use `/pm:resume` — do not skip the reconcile gate.
