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

2. **PUSH (substantial only)** — `push-detour` does the whole transition. **Do not hand-edit
   `.conductor/state.json`**: this used to be a documented hand-edit, and none of the engine's
   guarantees applied to it (no validation, no write-conflict guard, no read-back verification,
   no record that the transition happened).
   - Make the current epic's `tasks.md` reflect reality; commit so nothing is uncommitted.
   - Register the detour as an epic FIRST — it has to exist before a frame can name it:
     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" add-epic --id <new-id> \
       --title "<what it is>" --lane <openspec|superpowers|claude-code> --priority P0
     ```
   - Then push:
     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" push-detour <parent-epic-id> \
       --detour <new-id> --reason "<why, concretely>" (--reconcile | --no-reconcile)
     ```
     In one guarded write it sets the parent to `paused`, pushes the frame
     (`pausedEpic` / `pausedAt` / `reason` / `spawnedDetour` / `reconcileOnResume`), records both
     protocol links (detour `resolves-blocker-for` parent; parent `may-invalidate` detour), makes
     the detour active, re-renders, and prints the Honcho line — so step 3 below is no longer a
     separate step.
   - **Exactly one of `--reconcile` / `--no-reconcile` is required.** There is no default:
     whether the detour can invalidate the paused epic's plan is a judgment, and a default would
     make an absent decision look like a considered one. Say `--reconcile` unless you are certain
     the detour touches nothing the paused epic depends on.
   - Then create the OpenSpec proposal for the detour and build it through your normal
     propose → review → apply → review → commit → archive loop.

3. **Paste the Honcho memory.** `push-detour` printed `paused <parent> for <reason>` on stdout
   and appended it to `.conductor/honcho-memories.log`. Paste that printed line into your actual
   Honcho MCP memory/conclusion tool call — the engine only formats and logs it, it never calls
   Honcho itself. This keeps the relationship recoverable even outside this repo.
   (`honcho-memory push <parent-epic-id> "<reason>"` still exists for a pivot you are recording
   after the fact.)

When the detour is archived, use `/pm:resume` — do not skip the reconcile gate.
