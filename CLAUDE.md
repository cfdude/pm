# CLAUDE.md

> Project memory for **`pm`** — a Claude Code plugin: a project-management conductor that sits
> above OpenSpec and Superpowers. Extracted from `cfdude/cfdude-plugins` on 2026-07-14
> (`git subtree split --prefix=plugins/pm`, full history preserved). Referenced from that
> marketplace via a `github` source (`cfdude/pm`, `ref: main`) — this repo is now the sole
> source of truth for pm's code, tests, and release history.

## What this repo is

- A single Claude Code plugin: `.claude-plugin/plugin.json`, `commands/`, `skills/`, `hooks/`,
  `scripts/`, `agents/` — all at the repo root (no `plugins/pm/` nesting, unlike when this lived
  inside the marketplace repo).
- Not itself pm-conductor-managed yet (no `.conductor/state.json`) — set up with `/pm:init` if
  you want to dogfood pm on its own development here, mirroring how `cfdude-plugins` did before
  the extraction.

## The `pm` engine — hard constraints (must follow)

- **`scripts/conductor.mjs` is ZERO-DEPENDENCY.** Node 18+ built-ins only (`node:fs`,
  `node:path`, `node:os`, `node:child_process`, `node:url`). **Never** add an npm package or a
  `package.json` dependency. If a format needs parsing, prefer JSON (native) over pulling a
  parser.
- **Tests:** `node --test scripts/conductor.test.mjs`. All tests pass before any commit — no
  exceptions, no `--no-verify`.
- **Architectural law — `pm` is an INSTRUCTION layer, never an INTEGRATION layer.** It emits
  instructions for the interactive Claude agent to act on (the managed `CLAUDE.md` rules block,
  the SessionStart/PreCompact brief, command-doc markdown). It must **never** open a network
  connection or call an external system (Jira, GitHub, Linear, …) itself. External tracker sync
  is the *agent's* job; the engine's only role is to know a tracker is in use and shape the
  instructions it already emits. No code path in the engine talks to a tracker. The one
  deliberate, documented exception is the **optional, opt-in gate-guard hook**
  (`set-gate-guard on`) — a local `PreToolUse` mechanical block, off by default, never a silent
  default; see `commands/gate-guard.md`.
- **Release discipline.** A feature: (1) bumps `.claude-plugin/plugin.json` `version`; (2) adds
  a `CHANGELOG.md` entry; (3) if the `state.json` schema changes in a way existing data must be
  *transformed* to remain valid, adds a `MIGRATIONS` entry keyed to the new release (additive,
  idempotent, backward-compatible — a state file written by the prior version must still load).
  `state.json` carries `pmVersion`. The user-facing update sequence for any repo using this
  plugin is: update the plugin → `/reload-plugins` (or restart) → `/pm:upgrade` per repo.
- Engine subcommands are dispatched at the bottom of `conductor.mjs`; every new subcommand needs
  a matching command doc under `commands/` and coverage in `conductor.test.mjs`.
- **State-transition flags are not pure functions of current state.** `reconcileNeeded` in
  particular is set at detour-POP time and must survive until reconciliation completes — POP
  protocol removes the detour-stack frame *before* reconciliation runs, so deriving the flag
  from "is there still a live frame" breaks it at exactly the moment it needs to stay true. See
  `reconcileArchived()`'s comments in `conductor.mjs` before changing this logic again.

## Commits

Conventional commits (`feat|fix|docs|test|chore|refactor`). Never `git commit --no-verify`.
