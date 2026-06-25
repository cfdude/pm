# pm — a project-management conductor for OpenSpec + Superpowers

`pm` is a lightweight Claude Code plugin that sits **above** [OpenSpec](https://github.com/Fission-AI/OpenSpec)
and [Superpowers](https://github.com/obra/superpowers). It tracks work across all execution
lanes — not just OpenSpec proposals. It answers the three questions you lose after a detour
and a context compaction:

1. What were we working on before the detour?
2. What work is currently outstanding?
3. What is the next highest-priority item?

It does this **without becoming a second task tracker**. Stories stay in OpenSpec
(`tasks.md` checkboxes). The conductor only owns what OpenSpec doesn't: cross-epic
**priority/ordering**, an explicit **detour stack**, and **epic links** — including the
reconcile relationship where a detour can invalidate the proposal it interrupted.

## The model

| Scrum | Here | Owned by |
|-------|------|----------|
| Epic | any backlog item, tagged by lane (see below) | the conductor |
| Story / phase | a `tasks.md` checkbox, plan checkbox, or inline `stories[]` | OpenSpec / plan file / state.json |
| Backlog ordering, detours, dependencies | the conductor index | **this plugin** |

- **State of record:** `.conductor/state.json` (structured; you and Claude edit it).
- **Human view:** `PROJECT.md` — fully generated, never hand-edited.
- **Story progress:** derived live at render time from the best available source (see Lanes).

### Lanes

Epics carry a `lane` tag recording how the work is executed. OpenSpec is one lane, not the
only one:

| Lane | When to use | Progress source |
|------|------------|-----------------|
| `openspec` | full spec-driven proposal (`openspec/changes/<id>/`) | `tasks.md` checkboxes |
| `superpowers` | Superpowers-driven work with a plan file | `planPath` checkboxes |
| `claude-code` | single-session Claude Code work, no external spec | inline `stories[]` or `—` |
| `decision` | architectural / research decisions | `—` |
| `external` | dependency, third-party, or human-owned work | `—` |

An epic missing `lane` is treated as `openspec` (backward-compatible with pre-0.3.0 repos).

### Epic statuses

| Status | Meaning |
|--------|---------|
| `active` | Currently being worked on |
| `paused` | Pushed onto the detour stack |
| `queued` | Ready to start; included in NEXT UP |
| `later` | Intentionally deferred; excluded from NEXT UP |
| `blocked` | Waiting on an external dependency |
| `untriaged` | Newly registered; needs priority and lane assignment |
| `planned` | Roadmap item — known and sequenced, not yet ready to start. Excluded from NEXT UP and the lanes rollup; shown in PROJECT.md epics table. Use for importing a roadmap. |
| `archived` | Done or abandoned |

### Epic fields (`.conductor/state.json`)

```jsonc
{
  "id": "refactor-auth",
  "title": "Refactor auth client",
  "priority": "P1",
  "status": "queued",
  "role": "epic",
  "lane": "superpowers",                          // optional; defaults to "openspec"
  "parent": "sprint-2026-06-25",                  // optional: nest under a parent epic (tree)
  "externalId": "JOB-498",                        // optional: linked tracker issue key
  "externalUrl": "https://onvex.example/JOB-498", // optional: direct link to the issue
  "planPath": "docs/superpowers/plans/auth.md",   // optional: progress source for superpowers lane
  "stories": [{ "title": "vend token", "done": false }], // optional: inline progress
  "links": []
}
```

### Hierarchy

Epics form a single-parent tree via the optional `parent` field. `PROJECT.md` renders children
indented (`└─`) beneath their parent, groups each family ordered by the parent's priority, and
shows an `X/Y children archived` rollup on the parent. Grouping is render-only — NEXT UP keeps the
global priority order, so a P0 child of a P2 parent still surfaces at P0. Create with
`/pm:epic add … --parent <id>` (validated: the parent must exist, no self-parent, no cycle), or
build a whole sprint at once with `add-many` (below).

### External-tracker awareness (Jira / GitHub / Linear)

The conductor can be made *aware* that a project mirrors its epics to an external tracker, without
the plugin ever talking to that tracker — it remains an **instruction layer, not an integration
layer**. An optional `tracker` block in `state.json` records the system:

```jsonc
"tracker": {
  "system": "jira", "instance": "onvex", "projectKey": "JOB", "mechanism": "mcp",
  "statusIntent": { "active": "in-progress", "paused": "todo", "archived": "done" }
}
```

`statusIntent` maps conductor lifecycle to a *semantic* target — never a literal transition name;
the interactive agent resolves the real workflow transition itself. When a tracker is configured:

- the CLAUDE.md rules block gains an "External tracker sync" section assigning **you (the agent)**
  ownership: create the issue for an unmirrored epic and record its key with `update-epic`;
  transition the linked issue toward the `statusIntent` target on each status change; create a
  parent epic as a tracker epic and link its children;
- the briefing's `TRACKER SYNC` line lists only honestly-computable drift — active-work epics with
  no `externalId`. It does **not** fabricate transition drift (the engine can't see tracker state).

Configure with `/pm:tracker` (it detects signals, confirms with you, and calls `set-tracker`).
Record an issue key after creating it with `/pm:epic` → `update-epic <id> --external-id <KEY>`.

## Detours

- **Minimal** — fix, commit, push, resume. No proposal, no stack entry.
- **Substantial** — becomes its own **epic in the appropriate lane**. The conductor PUSHes
  the current epic onto the detour stack (with reason + link), you build and archive the
  detour, then POP — which triggers the **reconcile gate**: re-validate the paused proposal
  against what the detour actually changed before resuming. That gate is the thing Claude
  otherwise forgets after compaction.

## How it survives compaction (non-blocking enforcement)

- **SessionStart** (startup | resume | **compact**) injects the briefing via
  `additionalContext` — so the index comes *back* the moment context is summarized away.
- **PreCompact** snapshots (`render` + `.conductor/brief.txt`) right before the window
  collapses (it can't inject, only side-effect).
- **PostToolUse(Bash)** nudges after a `git commit` to update state, then re-renders.

The plugin's hooks run at user scope but stay **dormant** until a project runs `/pm:init`
(they no-op when there's no `.conductor/`), exactly like OpenSpec before `openspec init`.

### Rules (the semantic enforcement layer)

Hooks are deterministic but blind to intent; rules cover what a hook can't decide. `/pm:init`
writes a clearly-marked, idempotent **rules block into the project's `CLAUDE.md`** (delete the
block to opt out; `write-rules` refreshes it), and the SessionStart hook **re-injects a compact
version of those rules after every compaction**. The rules mandate: classify detours before
fixing, keep `state.json` current, never skip the reconcile gate, and mirror PUSH/POP to Honcho.

### Detour trail (`.conductor/detours.log`)

Append-only, tab-separated (`timestamp · SHA · kind · epic · note`). Two writers:

- **Deterministic** — when a `git commit` lands while a detour is active (the hook reads
  `state.json` to know), the commit is logged automatically as `DETOUR-COMMIT`.
- **Rule-driven** — minimal detours (which create no stack frame) are logged as `MINIMAL`
  by `/pm:detour --minimal "<what>"` → `log-detour`.

The last few entries also surface in `PROJECT.md` under "Recent detours."

### Honcho bridge

On every PUSH and POP, the rules instruct Claude to also write a one-line memory via your
Honcho MCP tool ("paused X for Y" / "resumed X, reconciled vs Y"), so the relationship
survives outside the repo. Tool-agnostic — works with whatever Honcho memory/conclusion tool
you have connected.

## Commands

| Command | Does |
|---------|------|
| `/pm:init` | Scaffold `.conductor/state.json`, register existing proposals and Superpowers plans, render `PROJECT.md` |
| `/pm:status` | Show the briefing — active epic (with lane), detour stack, top-5 next up + per-lane counts |
| `/pm:next` | Decide what to work on next (resume a detour, or top-priority epic) |
| `/pm:detour [what came up]` | Classify minimal vs substantial; park current work if needed |
| `/pm:detour --minimal "<what>"` | Fast-path: log a minimal detour to `detours.log` and move on |
| `/pm:resume` | Pop the detour stack and run the reconcile gate |
| `/pm:sync` | Register new OpenSpec proposals and Superpowers plans as epics |
| `/pm:epic add --id X --title "…" --lane L --priority P [--status S] [--parent ID] [--external-id KEY]` | Register any epic directly (all lanes); optionally nest under a parent or link a tracker issue |
| `/pm:epic` → `add-many --from <path\|->` | Atomically bulk-create a parent + children from a JSON batch |
| `/pm:epic` → `update-epic <id> [--external-id …] [--parent …] [--status …]` | Update an existing epic (write-back path for recording tracker keys) |
| `/pm:tracker` | Make the conductor aware of an external tracker (Jira/GitHub/Linear); detect → confirm → `set-tracker` |
| `/pm:upgrade` | Refresh CLAUDE.md rules, run migrations (lanes, 0.5.0 link normalization), update `pmVersion` |

Plus a `conductor` skill (the reasoning) and a `reconciler` agent (clean-context
re-validation at the reconcile gate).

## Importing an existing roadmap

If you have a roadmap document (any markdown — a notion export, a spec, a bullet list), you
can register each item in the conductor without the conductor parsing the file automatically.

In an interactive Claude Code session:

1. Read your roadmap document: tell Claude to read the file and list the items.
2. For each item, register it with:
   ```
   /pm:epic add --id <slug> --title "…" --lane <lane> --priority P2 --status planned
   ```
   Choose the execution lane that fits: `openspec` for spec-driven work, `superpowers` for
   plan-file work, `claude-code` for single-session work, `decision` for research or
   architecture, `external` for third-party dependencies.
3. After all items are registered, run `/pm:status` to see the full backlog.
4. Triage: set priorities and promote items to `queued` as you're ready to start them.

**Key behaviour:**
- `planned` items appear in the PROJECT.md epics table so the full backlog is visible but
  stay out of NEXT UP and the lanes rollup — the briefing stays compact.
- When you run `/pm:sync` after creating an OpenSpec change for a `planned` epic, the
  conductor auto-transitions it to `untriaged` so it enters the normal triage flow.
- The conductor does **not** parse roadmap files automatically. The import is a one-time
  interactive step.

## Install

This plugin is distributed via the cfdude-plugins marketplace. From Claude Code:

```
/plugin marketplace add cfdude/cfdude-plugins
/plugin install pm@cfdude-plugins
```

Then, in any project you want to manage:

```
/pm:init
```

Requirements: Node 18+ (already present via OpenSpec). No npm install, no other deps.

## Updating pm in your projects

When a new version of pm ships, follow this sequence every time:

1. **Update the plugin.** Pull the latest marketplace and update pm — either via the
   marketplace auto-update or `/plugin update pm@cfdude-plugins` in Claude Code.

2. **`/reload-plugins` or restart Claude Code — required.** Claude Code loads all
   plugin commands, hooks, and the conductor engine at session start. Without a reload,
   `/pm:upgrade` runs the *old* engine even though the new files are on disk. The
   SessionStart briefing will tell you an upgrade is available; that is your signal to
   reload before proceeding.

3. **`/pm:upgrade` in each project that uses pm.** Run this once per repo after the
   reload. It is idempotent — running it a second time is harmless. It applies any pending
   migrations, refreshes the CLAUDE.md rules block with current wording, re-renders
   `PROJECT.md`, and stamps the new version into `state.json` so the upgrade nudge stops
   appearing.

The SessionStart nudge (shown in every briefing until resolved) names the full sequence and
repeats on each session start until you complete it in that repo.

> **Note:** the staleness guard (introduced in 0.4.1) refuses to run if the engine version
> and the installed version don't match, and prints the reload reminder instead of silently
> re-stamping an old version. This means from 0.4.1 onward every upgrade is self-guarding.
> The first upgrade *into* 0.4.1 still runs the old 0.4.0 engine until you reload —
> that one requires the manual sequence above.

## Companions (not bundled, on purpose)

- **OpenSpec** — optional (not required). It's an npm CLI, not a plugin, so it can't be a
  plugin dependency; install it separately if you use the `openspec` lane. `/pm:init` works
  in repos with zero OpenSpec changes.
- **Superpowers** — recommended. The conductor manages *what* and *in what order*;
  Superpowers drives *how well* each epic is built. Plans in `docs/superpowers/plans/` are
  auto-imported as `superpowers`-lane epics on `sync`/`init`.
- **Honcho** — your long-term memory. The conductor is the live working set; optionally
  mirror each PUSH/POP to a one-line Honcho memory so the relationship survives outside the
  repo.

## Layout

```
.claude-plugin/plugin.json   manifest (name: pm)
commands/                    /pm:init /pm:status /pm:next /pm:detour /pm:resume /pm:sync /pm:epic /pm:tracker /pm:upgrade
skills/conductor/SKILL.md    the discipline (detour classification, PUSH/POP, reconcile)
agents/reconciler.md         fresh-context re-validation of a paused proposal
hooks/hooks.json             SessionStart inject · PreCompact snapshot · PostToolUse nudge
scripts/conductor.mjs        the engine (zero dependencies)
```

## License

MIT © Rob Sherman
