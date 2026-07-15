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
  hand-edit it. After any state change, run `node "$ENGINE" render` (see "Running the engine").

You (Claude) are myopic across compactions. This skill is how you stop losing the thread.

## Running the engine (resolve the path — never version-pin)

When you invoke `conductor.mjs` from a Bash step, resolve it version-independently. Prefer
`$CLAUDE_PLUGIN_ROOT`; if that env var is unset (common outside a slash-command), fall back to the
newest installed copy. **Never** hardcode a versioned cache path like `…/pm/0.6.1/scripts/…` — it
breaks on the next upgrade.

```bash
ENGINE="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/conductor.mjs}"
[ -f "$ENGINE" ] || ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1)
node "$ENGINE" <subcommand>
```

Below, `$ENGINE` means the path resolved this way.

## Commands

`/pm:init` scaffold · `/pm:status` show · `/pm:next` decide · `/pm:detour` park ·
`/pm:resume` resume + reconcile · `/pm:sync` register new proposals and plans ·
`/pm:epic add` register any epic (`--parent`, `--external-id`) · `/pm:epic` → `add-many`
(atomic bulk create) / `update-epic` (write-back, incl. `--title`/`--link`) / `remove-epic`
(hard-delete, `--cascade` for a parent + descendants) · **`set-active <id>` / `clear-active`**
set the top-level active epic · `set-autonomy <id>` grant an epic broad execution trust (see
"Epic-level autonomy" below) · `plan-hierarchy --parent <id>` batched execution plan for a
parent's children (see "Epic-hierarchy orchestration" below) · `verify-worktrees` flag orphaned
hierarchy-dispatch worktrees · `set-review-mode` the repo's bounded review-count dial
(off/standard/thorough) · `/pm:gate-guard` optional opt-in hard reconcile-gate backstop (off by
default) · `/pm:tracker` make the conductor tracker-aware · `/pm:changelog` what changed since
your version · `/pm:upgrade` refresh rules + run migrations + print the changelog delta.

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
`node "$ENGINE" log-detour "<what you fixed>"` (appends a
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
4. Make the detour active with `node "$ENGINE" set-active <detour-id>`. Build it through the
   appropriate lane's workflow,
   then archive/close it.
5. **Write a one-line Honcho memory** ("paused `<parent>` for `<detour>` — <reason>") via
   your Honcho MCP memory/conclusion tool, so the pivot survives outside this repo.

## POP protocol (leaving a detour) — the RECONCILE GATE

The step otherwise lost after compaction. Do not skip it.

1. Confirm the detour epic is archived and committed/deployed.
2. Before popping the frame: if it has `reconcileOnResume: true`, set `reconcileNeeded: true`
   on the paused epic in `.conductor/state.json` (a hand-edited field, like the frame itself) —
   the frame is about to be removed, so this is the only place that obligation survives. Then
   pop the frame and `node "$ENGINE" set-active <paused-id>` to make the paused epic active
   again.
3. If `reconcileOnResume` was true, RECONCILE before writing code: delegate to the
   **reconciler** agent with the paused id + detour id. It re-reads the paused proposal,
   diffs what the detour shipped, and reports validity + stories to amend.
   - Invalidated → amend the proposal + `tasks.md` first, then clear `reconcileNeeded`.
   - Still valid → say so explicitly, clear `reconcileNeeded`, resume.
   - **Optional hard backstop:** if this repo has `set-gate-guard on` set, a PreToolUse hook
     mechanically blocks `Edit`/`Write`/`NotebookEdit` while `reconcileNeeded` is still true —
     off by default, see `/pm:gate-guard`.
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
- Set the active epic with `set-active <id>` (never hand-edit the `.active` pointer); it also
  keeps `status: "active"` in sync and demotes any prior active epic. `clear-active` drops it.
- On PUSH/POP/priority change: edit `state.json` (or use the verbs above), then render.
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

## Epic-level autonomy — the preflight scan

An epic can be granted broad execution trust so it runs through phase transitions and
destructive actions without a human present for each one — but ONLY after a preflight scan, and
autonomy never removes a genuine safety stop. This section defines the scan; the decision rule
and reporting obligations that consume its output are in the rules block re-injected into
CLAUDE.md (see `/pm:epic` → `set-autonomy`).

**When:** before setting any epic's `autonomy.level` to `"autonomous"` (see `set-autonomy` below).

**How to scan an epic (`epicId`):**

1. Read that epic's FULL source, not a summary — whichever is its lane's real progress source:
   - `openspec` lane: `openspec/changes/<epicId>/{proposal,design,tasks}.md` and everything under
     its `specs/` directory.
   - `superpowers` lane: the file at the epic's `planPath`.
   - `claude-code` lane: the epic's inline `stories[]` in `.conductor/state.json`.
   - `external`/tracker-linked: see the tracker-specific addendum below — pull the tracker issue
     first, it IS the source.
2. Reason over the WHOLE document — do not keyword-grep for "DROP"/"migration"/"rm". A shallow
   scan is worse than no scan: it creates false confidence and lets a real risk slip through
   silently. Full read is the only approach approved for this primitive (see the design doc's
   "Approaches considered" table for why keyword-triggered scanning was rejected).
3. Produce exactly two sections:
   - **Destructive-risk points** — anything that changes/deletes/migrates existing data or state
     in a way that could be hard to undo. For each: what it is, why it's risky, and whether a
     backup/restore path is obvious from the plan or not.
   - **Genuine unknowns** — real ambiguities or missing decisions that should NOT just be
     guessed on — things needing explicit human approval or clarification before this epic could
     run start-to-finish unattended.
4. Keep it SHORT and high-signal. If there is nothing destructive, say so plainly. If there is
   no genuine unknown, say so plainly. Padding the output with non-issues defeats the entire
   point — it is exactly what turns autonomous execution into a wall of blockers.
5. Present the findings as ONE batch of questions to the user, before execution starts. Record
   the answers with `set-autonomy <epicId> --preauthorize "<action>:<reason>"` (repeatable, one
   per approved item) and `--context "<note>"` (repeatable, one per piece of background supplied)
   — then, only once recorded, `set-autonomy <epicId> --level autonomous`.

This same read-and-scan process is the one reused, unchanged, by any future work that needs to
scan several epics at once (e.g. a parent epic's children) — it takes one epic id at a time
regardless of caller.

## Epic-hierarchy orchestration

Runs a whole parent epic's children unattended — batched by priority and dependency, each
dispatched as a fresh subagent. Builds on epic-level autonomy above; read that section first if
you haven't. No new persistent state: everything below is recomputed fresh from `parent`,
`priority`, `links`, and each child's `autonomy` block every time.

**When:** the user wants to run an entire hierarchy (a parent epic + its children) unattended,
not just one epic.

**The process:**

1. **Preflight EVERY child up front, not one at a time.** Run the epic-level-autonomy preflight
   scan (above) against every child of the parent. Consolidate all findings into ONE batch of
   questions presented to the user — across the whole hierarchy, not per-child. Record answers
   per child exactly as epic-level autonomy already works: `set-autonomy <child-id>
   --preauthorize "<action>:<reason>"` / `--context "<note>"`, then `set-autonomy <child-id>
   --level autonomous` once a child is cleared.
2. **Get the execution plan:** `node "$ENGINE" plan-hierarchy --parent <id>`. This prints
   `{ parent, batches: [{ batch, epics: [{ id, priority, autonomous, dependsOn }] }] }` —
   `dependsOn` is each epic's list of sibling ids (within this hierarchy) it depends on. If any epic in the
   plan shows `autonomous: false`, that child wasn't cleared in step 1 — resolve that before
   dispatching it (do not dispatch a non-autonomous child; it will immediately hit decision-rule
   item (d), "no context to act on").
   - If `plan-hierarchy` exits non-zero naming a dependency cycle, that's a real data problem
     (two children `depends-on` each other) — fix the `links` before re-running, don't retry
     blindly.
3. **Dispatch batch by batch, in order, each child isolated in its own git worktree.** For each
   batch: create a worktree + branch `hierarchy-child/<epic-id>` per epic in that batch (per
   `superpowers:using-git-worktrees`), then dispatch one `agents/hierarchy-child-executor` per
   epic, working inside its own worktree — **in parallel** (multiple dispatches in the same turn)
   when the batch has more than one epic, since batch membership already means they have no
   dependency on each other. Do **not** start the next batch until every dispatch in the current
   batch has reported back AND its worktree has merged (see below).
   - **Children never write `.conductor/state.json` themselves** — they only return their fixed
     report. You (the orchestrator) are the sole writer of state transitions, applied in one pass
     after the batch (mark each merged child `archived`), not interleaved with dispatch. This is
     what makes parallel dispatch safe for the state file specifically: there's only ever one
     writer, so there's nothing to merge-conflict on `state.json` itself.
   - **Merge each child's worktree branch back sequentially**, one at a time, even though the
     *work* happened in parallel. On an ordinary merge conflict (two children's code genuinely
     touched overlapping lines): this is NOT a stop condition — it's decision-rule item (c)
     (destructive but restorable; git history means it's always recoverable), never item (b).
     Resolve it via this ladder, in order: (1) attempt the merge normally; (2) on conflict,
     dispatch `agents/merge-conflict-resolver` to read both sides + the merge base and resolve it;
     (3) if that agent reports `STATUS: uncertain`, escalate — retry with a more capable model
     (e.g. Opus) and/or consult the `advisor()` tool for a second opinion before finalizing; (4) if
     still genuinely unresolvable, commit the best-effort resolution anyway (still recoverable via
     git history) and **log a new follow-up epic under the same parent** describing the residual
     issue, then continue. Never tell the human "we can't merge this, you handle it" for an
     ordinary code conflict — that outcome is explicitly designed out.
   - Once a child's branch has merged (cleanly or via the ladder above), remove its worktree and
     delete its branch immediately — never leave it dangling. `node "$ENGINE" verify-worktrees`
     cross-references `git worktree list` against epic status and flags any `hierarchy-child/*`
     worktree whose epic is already archived but wasn't cleaned up; run it after a batch if you're
     ever unsure everything was torn down correctly.
   - A dispatch reporting `STATUS: blocked` — check every later epic's `dependsOn` list
     (transitively, since a dependency chain can be more than one hop) for the blocked child's
     id; do not advance any batch containing an epic that depends on it, directly or
     transitively. Batches with no such dependency may still proceed. Flag the blocked child for
     the human in the end-of-hierarchy report; do not auto-retry it.
   - A dispatch reporting `STATUS: stopped-for-genuine-unknown` — this is decision-rule item (d)
     firing correctly, not a bug. Surface it to the human now, same as a single-epic stop would.
4. **After all batches, write ONE consolidated end-of-hierarchy report:** what was asked (the
   step-1 preflight batch), what was done (fold in every dispatch's `DONE`), every `DECISIONS`
   entry across the whole hierarchy, any follow-up epics logged from unresolvable merge conflicts,
   and an explicit **controversial** flag on anything from `CONCERNS` or a WARN-class decision —
   these may affect other backlog items, which is exactly the seed a future portfolio-consistency
   pass would need. The parent epic's own status is **never auto-archived** by this process —
   that stays a human call, same as epic-level autonomy never auto-closes an epic either.

## state.json reference

```
active        : "<epic-id>" | null
pmVersion     : "<semver>" — release that last touched this repo (set by init/upgrade)
tracker?      : { system, instance?, projectKey?, mechanism?, statusIntent? }  — optional; opt-in
reviewMode?   : "off" | "standard" | "thorough" — repo-level dial (default "standard" if unset)
gateGuard?    : boolean — optional opt-in PreToolUse guard (default false/off)
epics[]       : { id, title, priority, status, role, lane, parent?, externalId?, externalUrl?, planPath?, stories[]?, links[], reconcileNeeded?, autonomy? }
autonomy?     : { level: "off"|"autonomous", preAuthorized[], context[], notifications[] } — per epic
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
