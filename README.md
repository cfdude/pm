# pm — a project-management conductor for OpenSpec + Superpowers

`pm` is a lightweight Claude Code plugin that sits **above** [OpenSpec](https://github.com/Fission-AI/OpenSpec)
and [Superpowers](https://github.com/obra/superpowers). It answers the three questions you
lose after a detour and a context compaction:

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
| Epic | one OpenSpec proposal (`openspec/changes/<id>/`) | OpenSpec |
| Story / phase | a `tasks.md` checkbox | OpenSpec |
| Backlog ordering, detours, dependencies | the conductor index | **this plugin** |

- **State of record:** `.conductor/state.json` (structured; you and Claude edit it).
- **Human view:** `PROJECT.md` — fully generated, never hand-edited.
- **Story progress:** derived live from `tasks.md` at render time, so the two can't drift.

## Detours

- **Minimal** — fix, commit, push, resume. No proposal, no stack entry.
- **Substantial** — becomes its own OpenSpec proposal. The conductor PUSHes the current
  epic onto the detour stack (with reason + link), you build and archive the detour, then
  POP — which triggers the **reconcile gate**: re-validate the paused proposal against what
  the detour actually changed before resuming. That gate is the thing Claude otherwise
  forgets after compaction.

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
| `/pm:init` | Scaffold `.conductor/state.json`, register existing proposals, render `PROJECT.md` |
| `/pm:status` | Show the briefing — active epic, detour stack, next up |
| `/pm:next` | Decide what to work on next (resume a detour, or top-priority epic) |
| `/pm:detour [what came up]` | Classify minimal vs substantial; park current work if needed |
| `/pm:detour --minimal "<what>"` | Fast-path: log a minimal detour to `detours.log` and move on |
| `/pm:resume` | Pop the detour stack and run the reconcile gate |
| `/pm:sync` | Register new OpenSpec proposals as epics |

Plus a `conductor` skill (the reasoning) and a `reconciler` agent (clean-context
re-validation at the reconcile gate).

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

## Companions (not bundled, on purpose)

- **OpenSpec** — required in practice (epics = its proposals). It's an npm CLI, not a
  plugin, so it can't be a plugin dependency; install it separately. `/pm:init` works even
  before any proposals exist.
- **Superpowers** — recommended. The conductor manages *what* and *in what order*;
  Superpowers drives *how well* each epic is built.
- **Honcho** — your long-term memory. The conductor is the live working set; optionally
  mirror each PUSH/POP to a one-line Honcho memory so the relationship survives outside the
  repo.

## Layout

```
.claude-plugin/plugin.json   manifest (name: pm)
commands/                    /pm:init /pm:status /pm:next /pm:detour /pm:resume /pm:sync
skills/conductor/SKILL.md    the discipline (detour classification, PUSH/POP, reconcile)
agents/reconciler.md         fresh-context re-validation of a paused proposal
hooks/hooks.json             SessionStart inject · PreCompact snapshot · PostToolUse nudge
scripts/conductor.mjs        the engine (zero dependencies)
```

## License

MIT © Rob Sherman
