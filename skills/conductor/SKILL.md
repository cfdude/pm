---
name: conductor
description: >
  Project-management discipline that sits ABOVE OpenSpec and Superpowers. Use whenever
  work spans more than one OpenSpec proposal, when a review or build reveals something
  broken/orphaned/unwired that forces a detour, when deciding what to work on next, or
  when resuming after a context compaction. Keeps a single index of epics (= OpenSpec
  proposals), an explicit detour stack, and epic links so nothing is lost across pivots.
  Triggers: "what were we working on", "what's next", "this is broken, fix it first",
  "park this", "resume", "where did we leave off".
---

# Conductor — the PM layer above OpenSpec + Superpowers

## Mental model (read first)

- An **epic = one OpenSpec proposal** (`openspec/changes/<id>/`). That is the unit of work.
- **Stories/phases** live in that proposal's `tasks.md` as checkboxes. OpenSpec owns them.
  Never copy stories into the conductor — read them from `tasks.md`.
- The conductor owns ONLY what OpenSpec can't: cross-epic **priority/ordering**, the
  **detour stack**, and **epic links** (especially the reconcile relationship).
- State of record is `.conductor/state.json`. `PROJECT.md` is a generated view — never
  hand-edit it. After any state change, run `node "$CLAUDE_PLUGIN_ROOT/scripts/conductor.mjs" render`.

You (Claude) are myopic across compactions. This skill is how you stop losing the thread.

## Commands

`/pm:init` scaffold · `/pm:status` show · `/pm:next` decide · `/pm:detour` park ·
`/pm:resume` resume + reconcile · `/pm:sync` register new proposals.

## When something blocks progress: classify the detour FIRST

Do not start fixing. Decide which kind this is and say so.

**Minimal detour** — small, self-contained, no design ambiguity.
Fix → test → commit → push, then record it so it leaves a trail:
`node "$CLAUDE_PLUGIN_ROOT/scripts/conductor.mjs" log-detour "<what you fixed>"` (appends a
timestamped line + commit SHA to `.conductor/detours.log`). Then resume. No proposal, no
stack entry. Rule of thumb: fits before the next compaction and doesn't change the shape of
the current proposal.

**Substantial detour** — needs its own design, changes shared behavior, or is multi-step.
OpenSpec must not conflate two concerns, so this becomes its OWN proposal. Run PUSH.
When unsure, treat as substantial — a needless stack entry is cheap; a lost thread is the
whole problem we're solving.

## PUSH protocol (entering a substantial detour)

1. Make the current epic's `tasks.md` reflect reality; commit so nothing is uncommitted.
2. In `.conductor/state.json`: set the current epic `status: "paused"`; push a frame onto
   `detourStack`:
   ```json
   { "pausedEpic": "<current>", "pausedAt": "<iso>", "reason": "<why, concretely>",
     "spawnedDetour": "<new-proposal-id>", "reconcileOnResume": true }
   ```
   Set `reconcileOnResume: true` whenever the detour will touch code/behavior the paused
   epic depends on (default true unless certain it won't).
3. Add the detour as an epic (`role: "detour"`, usually `P0`) with links:
   detour `resolves-blocker-for` parent; parent `may-invalidate` detour.
4. Set `active` to the detour. Render. Build it through the normal OpenSpec + Superpowers
   loop (propose → review → apply → review → commit), then `openspec archive <id>`.
5. **Write a one-line Honcho memory** ("paused `<parent>` for `<detour>` — <reason>") via
   your Honcho MCP memory/conclusion tool, so the pivot survives outside this repo.

## POP protocol (leaving a detour) — the RECONCILE GATE

The step otherwise lost after compaction. Do not skip it.

1. Confirm the detour epic is archived and committed/deployed.
2. Pop its frame; set the paused epic back to `active`.
3. If `reconcileOnResume` was true, RECONCILE before writing code: delegate to the
   **reconciler** agent with the paused id + detour id. It re-reads the paused proposal,
   diffs what the detour shipped, and reports validity + stories to amend.
   - Invalidated → amend the proposal + `tasks.md` first, then clear `reconcileNeeded`.
   - Still valid → say so explicitly, clear `reconcileNeeded`, resume.
4. **Write a one-line Honcho memory** ("resumed `<parent>` after `<detour>`; reconcile =
   valid | amended …") via your Honcho MCP memory/conclusion tool.
5. Render. State the exact next story to build.

## Choosing what's next

Resume the **top of the detour stack** first if non-empty. Otherwise the highest-priority
`queued` epic (P0→P3). Surface ties to the user.

## Keeping the index honest (non-blocking enforcement)

- After completing stories: tick `tasks.md` checkboxes (OpenSpec), then render.
- After a commit: the PostToolUse hook reminds you — update `state.json` status, it
  re-renders automatically.
- On PUSH/POP/priority change: edit `state.json`, then render.
- New proposal outside this flow? `/pm:sync` registers it as `untriaged`; then triage.
- `state.json` always wins over `PROJECT.md` — just re-render.

These rules are also installed into the project's `CLAUDE.md` by `/pm:init` and re-injected
by the SessionStart hook (so they survive compaction). Two artifacts back them up: every
commit made while a detour is active is auto-logged to `.conductor/detours.log` by the hook
(deterministic), and minimal detours are logged there by `log-detour` (rule-driven).

## state.json reference

```
active   : "<epic-id>" | null
epics[]  : { id, title, priority, status, role, links[], reconcileNeeded }
detourStack[] : { pausedEpic, pausedAt, reason, spawnedDetour, reconcileOnResume }
status   ∈ active | paused | queued | later | blocked | archived | untriaged
role     ∈ epic | detour          priority ∈ P0 | P1 | P2 | P3 | P?
link.type ∈ resolves-blocker-for | may-invalidate | depends-on | relates-to
```
