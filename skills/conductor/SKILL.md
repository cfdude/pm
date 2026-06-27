---
name: conductor
description: >
  Project-management discipline that sits ABOVE OpenSpec and Superpowers. Use whenever
  work spans more than one epic, when a review or build reveals something
  broken/orphaned/unwired that forces a detour, when deciding what to work on next, or
  when resuming after a context compaction. Keeps a single lane-agnostic index of epics,
  an explicit detour stack, and epic links so nothing is lost across pivots.
  Triggers: "what were we working on", "what's next", "this is broken, fix it first",
  "park this", "resume", "where did we leave off".
---

# Conductor — the PM layer above OpenSpec + Superpowers

## Mental model (read first)

- An **epic** is any backlog item, tagged by `lane` — `openspec | superpowers | claude-code
  | decision | external`. OpenSpec proposals are one lane, not the only one.
- **Stories/phases** live in the best available source: `tasks.md` checkboxes (openspec),
  `planPath` checkboxes (superpowers), inline `stories[]` (claude-code), or `—` (decision /
  external). Never copy these into `state.json` manually unless using inline `stories[]`.
- The conductor owns ONLY what no lane-specific tool can: cross-epic **priority/ordering**,
  the **detour stack**, and **epic links** (especially the reconcile relationship).
- State of record is `.conductor/state.json`. `PROJECT.md` is a generated view — never
  hand-edit it. After any state change, run `node "$CLAUDE_PLUGIN_ROOT/scripts/conductor.mjs" render`.

You (Claude) are myopic across compactions. This skill is how you stop losing the thread.

## Commands

`/pm:init` scaffold · `/pm:status` show · `/pm:next` decide · `/pm:detour` park ·
`/pm:resume` resume + reconcile · `/pm:sync` register new proposals and plans ·
`/pm:epic add` register any epic (`--parent`, `--external-id`) · `/pm:epic` → `add-many`
(atomic bulk create) / `update-epic` (write-back) · `/pm:tracker` make the conductor
tracker-aware · `/pm:changelog` what changed since your version · `/pm:upgrade` refresh rules +
run migrations + print the changelog delta.

## Hierarchy & external trackers

- **Hierarchy:** epics form a single-parent tree via `parent`. Nest with `--parent <id>`
  (validated: parent exists, no self/cycle) or bulk-create a parent + children atomically with
  `add-many --from <json>`. PROJECT.md indents children and rolls up `X/Y children archived`;
  NEXT UP keeps global priority order (grouping is render-only).
- **Tracker awareness (instruction layer ONLY — never call the tracker yourself from the
  engine):** if a `tracker` block is set (via `/pm:tracker`), the rules block + brief tell YOU
  to mirror epics to Jira/GitHub/Linear with your own tooling — create an issue for any epic
  lacking `externalId` then record the key with `update-epic --external-id`, and transition the
  linked issue toward the `statusIntent` semantic target on each status change. The brief lists
  only unmirrored epics; it never fabricates transition drift.

## When something blocks progress: classify the detour FIRST

Do not start fixing. Decide which kind this is and say so.

**Minimal detour** — small, self-contained, no design ambiguity.
Fix → test → commit → push, then record it so it leaves a trail:
`node "$CLAUDE_PLUGIN_ROOT/scripts/conductor.mjs" log-detour "<what you fixed>"` (appends a
timestamped line + commit SHA to `.conductor/detours.log`). Then resume. No proposal, no
stack entry. Rule of thumb: fits before the next compaction and doesn't change the shape of
the current proposal.

**Substantial detour** — needs its own design, changes shared behavior, or is multi-step.
This becomes its own **epic in the appropriate lane** (openspec, superpowers, or claude-code
as fits the scope). Run PUSH. When unsure, treat as substantial — a needless stack entry is
cheap; a lost thread is the whole problem we're solving.

## PUSH protocol (entering a substantial detour)

1. Make the current epic's progress source reflect reality; commit so nothing is uncommitted.
2. In `.conductor/state.json`: set the current epic `status: "paused"`; push a frame onto
   `detourStack`:
   ```json
   { "pausedEpic": "<current>", "pausedAt": "<iso>", "reason": "<why, concretely>",
     "spawnedDetour": "<new-epic-id>", "reconcileOnResume": true }
   ```
   Set `reconcileOnResume: true` whenever the detour will touch code/behavior the paused
   epic depends on (default true unless certain it won't).
3. Add the detour as an epic (`role: "detour"`, `lane` = appropriate lane, usually `P0`)
   with links: detour `resolves-blocker-for` parent; parent `may-invalidate` detour.
   Use `/pm:epic add` or edit `state.json` directly.
4. Set `active` to the detour. Render. Build it through the appropriate lane's workflow,
   then archive/close it.
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
- Archived an OpenSpec change? The conductor self-heals — `sync`/`commit-nudge` clear the
  `active` pointer and stamp `archived` automatically (OpenSpec's date-prefixed archive dirs are
  detected), so `/pm:next` advances without hand-editing `state.json`.
- `state.json` always wins over `PROJECT.md` — just re-render.

These rules are also installed into the project's `CLAUDE.md` by `/pm:init` and re-injected
by the SessionStart hook (so they survive compaction). Two artifacts back them up: every
commit made while a detour is active is auto-logged to `.conductor/detours.log` by the hook
(deterministic), and minimal detours are logged there by `log-detour` (rule-driven).

## Importing an existing roadmap

If you have a roadmap doc (any markdown), register each item interactively — the conductor
does **not** parse roadmap files automatically.

1. Read the roadmap file; list the items for the user to confirm.
2. For each item: `/pm:epic add --id <slug> --title "…" --lane <lane> --priority P2 --status planned`
   - Choose lane: `openspec` | `superpowers` | `claude-code` | `decision` | `external`
3. `planned` items appear in PROJECT.md but are excluded from NEXT UP and lanes rollup.
4. When you create an OpenSpec change for a `planned` epic and run `/pm:sync`, it
   auto-transitions to `untriaged` and enters the normal triage flow.
5. Triage the backlog: set priorities, promote items to `queued` as work becomes ready.

`/pm:epic add` validates `--status` — unknown values are rejected with a clear error.

## state.json reference

```
active        : "<epic-id>" | null
pmVersion     : "<semver>" — release that last touched this repo (set by init/upgrade)
tracker?      : { system, instance?, projectKey?, mechanism?, statusIntent? }  — optional; opt-in
epics[]       : { id, title, priority, status, role, lane, parent?, externalId?, externalUrl?, planPath?, stories[]?, links[], reconcileNeeded? }
detourStack[] : { pausedEpic, pausedAt, reason, spawnedDetour, reconcileOnResume }
status   ∈ active | paused | queued | later | blocked | archived | untriaged | planned
role     ∈ epic | detour
lane     ∈ openspec | superpowers | claude-code | decision | external   (default: openspec)
priority ∈ P0 | P1 | P2 | P3 | P?
parent        : id of another epic — single-parent tree (validated: exists, no self/cycle)
externalId/externalUrl : link to a tracker issue (system comes from the tracker block)
tracker.statusIntent   : { <conductor-status>: "<semantic target>" } — NOT a literal transition
link.type ∈ resolves-blocker-for | may-invalidate | depends-on | relates-to
planPath      : repo-relative path to a markdown plan (progress source for superpowers lane)
stories[]     : [{ title, done }] — inline progress (highest-priority source)
```
