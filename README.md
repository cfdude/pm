<p align="center">
  <img src="img/logo.png" alt="Project Manager (PM) — a lightweight harness above OpenSpec & Superpowers" width="900">
</p>

<p align="center">
  <a href="https://github.com/cfdude/pm/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/cfdude/pm/ci.yml?branch=main&style=flat-square&label=CI" /></a>
  <a href="https://github.com/cfdude/pm/blob/main/.claude-plugin/plugin.json"><img alt="version" src="https://img.shields.io/github/package-json/v/cfdude/pm?filename=.claude-plugin%2Fplugin.json&style=flat-square&label=version" /></a>
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square" /></a>
</p>

# Project Manager (PM)

**A lightweight harness above [OpenSpec](https://github.com/Fission-AI/OpenSpec) and
[Superpowers](https://github.com/obra/superpowers) that keeps a Claude Code project on track —
across detours, context compaction, and however many epics are in flight at once.**

It answers the three questions you lose the moment context gets compacted or an interrupt
derails the session:

1. What were we working on before the detour?
2. What work is currently outstanding?
3. What is the next highest-priority item?

It does this **without becoming a second task tracker**. Stories stay wherever they already
live — OpenSpec `tasks.md`, a Superpowers plan, an external issue tracker. PM owns only what
none of those own: cross-epic **priority/ordering**, an explicit **detour stack**, and **epic
links** — including the reconcile relationship where a detour can invalidate the proposal it
interrupted.

## Why Use Project Manager (PM)?

Not a benchmark — real numbers pulled straight from this repo's own history, verifiable in
`git log`:

- **21 hierarchy-child epics** dispatched across two dogfooding batches via worktree-isolated,
  unattended execution — merged back sequentially with **zero data loss** and **zero
  unresolvable conflicts** (every conflict was mechanical: a shared CHANGELOG header, a usage
  string — never a real logic collision).
- **26 releases** shipped end-to-end (spec → build → test → changelog → version bump → release)
  with the plugin managing its own backlog the entire time.
- **189 tests**, **0 dependencies** — the entire engine (`scripts/conductor.mjs`) is Node 18+
  built-ins only, ~2,100 lines, nothing to `npm install`.
- Caught its own bugs mid-flight, live: a stale-cache silent fallback, an archived-child leak in
  hierarchy planning, a false-positive auto-detour heuristic — each found by using the tool on
  itself, logged as a `DF-` finding, and fixed in the same session it was discovered.

If you're managing more than one epic at a time, resuming work after a context compaction, or
running unattended multi-epic batches — this is the layer that remembers what OpenSpec and
Superpowers can't.

> [!IMPORTANT]
> **0.14.0** — `/pm:feedback` (file a bug/feature request as a GitHub issue directly from a
> session), `github-issues` tracker inward sync (pull open issues in as untriaged epics), and a
> CI workflow gating every PR.
>
> **0.13.0** — Worktree-isolated epic-hierarchy dispatch matures: category-based
> `--preauthorize` shorthand, per-epic review-mode escalation, auto-detected minimal detours
> from commit shape, dependency-aware top-level queue ordering, and a reconciler that writes
> its verdict back durably instead of leaving it in the transcript.
>
> See [CHANGELOG.md](CHANGELOG.md) for the full history.

## From Industry-Frontier Practice

PM's design choices aren't novel in isolation — they're borrowed, deliberately, from patterns
that already work at scale elsewhere and adapted to an agentic coding session:

- **Policy-as-code, not policy-as-prose** — `/pm:gate-guard`'s reconcile-owed check is a
  mechanical `PreToolUse` hook, not a rule an agent might forget to re-read after compaction.
  Same idea as an admission controller: the guard blocks the write, it doesn't just ask nicely.
- **Worktree isolation for parallel execution** — epic-hierarchy dispatch runs each child in
  its own git worktree/branch, merges sequentially, and treats the orchestrator as the sole
  writer of shared state — the same shape as isolating parallel CI jobs so they can't stomp on
  each other's output, applied to parallel *agent* execution instead.
- **An explicit interrupt stack, not implicit memory** — the detour stack (PUSH/POP + a
  mandatory reconcile gate on resume) is the same discipline as saving and restoring context
  around a hardware interrupt: the thing that got interrupted doesn't get to just "remember" —
  it gets re-validated before it resumes.
- **Instruction layer, never integration layer** — the engine never opens a network
  connection or calls an external system itself (the one documented exception is the opt-in
  gate-guard hook). External work — GitHub, Jira, Honcho — is always the interactive agent's
  job; the engine only shapes the instructions it emits. Same separation of concerns as a
  scheduler that never touches the resources it schedules.

## What You Can Learn

- **How to make a detour genuinely resumable** — not "remember to come back to this," but a
  structured stack frame with a reason, a link, and a mandatory reconcile gate that a fresh
  agent can re-run cold.
- **How to run multiple epics unattended without a shared-state race** — worktree isolation +
  sole-writer state transitions, discovered as a real gap during the plugin's own first live
  dogfood run (see the 0.12.0 changelog entry) and fixed the way you'd want any real bug fixed:
  in the open, with a design doc, not silently patched over.
- **How to keep a hard architectural law honest** — "the engine never calls an external
  system" is enforced by review discipline, not a technical sandbox, and the CLAUDE.md
  constraints spell out exactly the one documented exception and why.
- **How to turn a preflight scan into a real safety mechanism** — epic-level autonomy's
  decision rule (pre-authorized → proceed; no backup path → hard stop; destructive-but-
  restorable → warn and log; genuine unknown → stop) is designed to be followed by an agent
  mid-task, not just read once at the start.
- **How doc drift actually gets caught** — not by discipline alone (that already failed twice
  this session), but by treating a mismatch between a dispatch table and its own docs as a
  bug with a filed epic, the same as any other bug.

## Installation

Requirements: Node 18+ (already present via OpenSpec/Superpowers). No `npm install`, no other
dependencies — the engine is zero-dependency by hard rule.

This plugin is distributed via the `cfdude-plugins` marketplace:

```bash
/plugin marketplace add cfdude/cfdude-plugins
/plugin install pm@cfdude-plugins
```

## Quick Start

```bash
cd your-project
/pm:init
```

`/pm:init` scaffolds `.conductor/state.json`, registers any existing OpenSpec proposals and
Superpowers plans as epics, writes the managed rules block into your project's `CLAUDE.md`,
and renders `PROJECT.md`. From there:

```bash
/pm:status   # see the current briefing
/pm:next     # decide what to work on
```

## Supported Platforms

| Platform | Status | Notes |
|----------|--------|-------|
| Claude Code | ✅ Supported | The only platform PM runs on today — plugin commands, hooks, and skills all target it directly. |
| Codex | 🗺️ Planned | Tracked under `multi-platform-agent-support`. |
| Gemini CLI | 🗺️ Planned | Tracked under `multi-platform-agent-support`. |
| Grok Build (xAI) | 🗺️ Planned | Tracked under `multi-platform-agent-support`. |
| `AGENTS.md`-based platforms (generic) | 🗺️ Planned | Most non-Claude-Code tools use `AGENTS.md` instead of `CLAUDE.md` for project instructions — supporting that format is the shared unlock for all of the above. |

## Commands

<details>
<summary><code>/pm:init</code> — Initialize the PM conductor in this repo</summary>

Scaffolds `.conductor/state.json`, registers any existing OpenSpec proposals and Superpowers
plans as epics, writes the managed rules block into `CLAUDE.md`, and renders `PROJECT.md`.
Safe to run once per repo; re-running is a no-op if already initialized.

</details>

<details>
<summary><code>/pm:status</code> — Show the current conductor briefing</summary>

The active epic (with lane), the detour stack, the top-priority epics next up, and per-lane
counts. Re-renders `PROJECT.md` from `.conductor/state.json` first.

</details>

<details>
<summary><code>/pm:next</code> — Decide what to work on next</summary>

Resumes the top of the detour stack if non-empty; otherwise picks the highest-priority
`queued` epic (P0→P3), skipping anything starved on an unresolved `depends-on` link and
naming the blocker when it does.

</details>

<details>
<summary><code>/pm:detour [what came up]</code> — Handle a mid-build interruption</summary>

Classifies the interruption as minimal or substantial before doing anything else.

| Flag | Behavior |
|------|----------|
| `--minimal "<what you fixed>"` | Fast-path: log to `.conductor/detours.log` and resume. No proposal, no stack entry. |
| _(none)_ | Substantial: PUSH the current epic onto the detour stack, spin up a new epic in the appropriate lane for the detour. |

</details>

<details>
<summary><code>/pm:resume</code> — Resume a paused epic after a detour</summary>

Pops the detour stack and runs the mandatory **reconcile gate**: a fresh-context `reconciler`
agent re-validates the paused epic against what the detour actually shipped, then writes its
verdict back durably via `record-reconcile` (not just into the conversation transcript).

</details>

<details>
<summary><code>/pm:sync</code> — Register new proposals and plans</summary>

Picks up any new OpenSpec proposals or Superpowers plans not yet tracked as epics. When a
`github-issues` tracker is configured, also pulls open issues in as untriaged epics
(deduplicated by `externalId`).

</details>

<details>
<summary><code>/pm:epic</code> — Register or manage an epic directly</summary>

| Subcommand | Does |
|------------|------|
| `add --id X --title "…" --lane L --priority P [--status S] [--parent ID] [--external-id KEY]` | Register any epic in any lane; optionally nest under a parent or link a tracker issue. |
| `add-many --from <path\|->` | Atomically bulk-create a parent + children from a JSON batch. |
| `update-epic <id> [--title …] [--status …] [--parent …] [--link …] [--review-mode …]` | Write-back path — title corrections, status changes, links, per-epic review-mode escalation. |
| `remove-epic <id> [--cascade]` | Hard-delete; blocked by default if it has children (`--cascade` removes descendants too). Strips dangling links elsewhere. |
| `set-active <id>` / `clear-active` | Set/clear the top-level active epic. |

</details>

<details>
<summary><code>/pm:hierarchy</code> — Run a parent epic's children as a batched, unattended hierarchy</summary>

`plan-hierarchy --parent <id>` computes execution batches from `priority` + sibling
`depends-on` links (topological sort, cycle-rejecting). Dispatch is worktree-isolated: each
child works in its own git worktree/branch, never writes `.conductor/state.json` itself, and
merges back sequentially with the orchestrator as sole writer of state transitions. An
ordinary merge conflict is never a hard stop — it resolves via a tiered ladder before ever
reaching "ask the human."

</details>

<details>
<summary><code>set-autonomy &lt;id&gt;</code> — Grant an epic broad execution trust</summary>

Only after a mandatory preflight risk-scan (full read of the epic's source, not a keyword
grep). See the `conductor` skill's "Epic-level autonomy" section for the full process.

| Flag | Does |
|------|------|
| `--level off\|autonomous` | The trust level itself. |
| `--preauthorize "<action>:<reason>"` | Pre-approve one specific action (repeatable). |
| `--preauthorize "category:<name>:<reason>"` | Pre-approve a whole class of routine actions (`filesystem`, `network`, `schema`, `external-api`) without enumerating each one. |
| `--context "<note>"` | Record background/decisions supplied during preflight (repeatable). |
| `--notify "<what>"` | Durably record a WARN-class decision as it happens, not just for an end-of-epic report. |

</details>

<details>
<summary><code>/pm:review-mode</code> — Set this repo's review-intensity dial</summary>

`off` (self-review only) · `standard` (default — one fresh-context reviewer per gate) ·
`thorough` (two independent reviewers, adjudicated). A single epic can escalate above the
repo's dial via `update-epic <id> --review-mode`, but never de-escalate below it.

</details>

<details>
<summary><code>/pm:gate-guard</code> — Inspect the reconcile-gate guard</summary>

A hard `PreToolUse` guard blocking `Edit`/`Write`/`NotebookEdit` while the active epic still
owes a reconcile — **on by default and unconditional** for that specific case; `set-gate-guard
off` no longer bypasses it.

</details>

<details>
<summary><code>/pm:lane-routing</code> — Per-repo lane-routing overrides</summary>

`set-lane-routing --add "<match>:<lane>" [--add …] | --remove "<match>" | --clear` defines
keyword/glob rules checked before the generic lane heuristic — for when "anything touching
billing always goes through openspec" needs to be a rule, not a CLAUDE.md carve-out.
`suggest-lane "<free text>"` looks one up.

</details>

<details>
<summary><code>/pm:tracker</code> — Make the conductor aware of an external issue tracker</summary>

Detects signals, confirms with you, and records the tracker (Jira/GitHub/Linear) — the engine
never calls the tracker itself; it only shapes the instructions it emits for you to act on.

</details>

<details>
<summary><code>/pm:feedback</code> — File a bug report or feature request</summary>

`/pm:feedback [bug|feature] "<summary>"` posts directly as a GitHub issue on `cfdude/pm` —
searches for a near-duplicate first (comments instead of filing a new issue on a match). All
`gh` calls are agent-invoked; the engine itself never touches GitHub.

</details>

<details>
<summary><code>/pm:changelog</code> — Show what changed in the plugin</summary>

The changelog delta between this repo's stamped `pmVersion` and the currently installed
version.

</details>

<details>
<summary><code>/pm:upgrade</code> — Upgrade this repo's conductor state/rules</summary>

Refreshes the `CLAUDE.md` rules block, runs any pending migrations, re-renders `PROJECT.md`,
and stamps the new `pmVersion`. Idempotent — safe to run more than once. Requires
`/reload-plugins` first if you just updated the plugin (the SessionStart briefing tells you
when).

</details>

## Skills

Installed to `skills/` on `/pm:init`:

| Skill | Description |
|-------|-------------|
| `conductor` | The full discipline — detour classification, PUSH/POP, the reconcile gate, epic-level autonomy's preflight scan, epic-hierarchy orchestration. Triggers on "what were we working on," "this is broken, fix it first," "park this," "resume." |

## Guard & Automation

<details>
<summary>View hooks and agents</summary>

**Hooks** (`hooks/hooks.json`) — dormant until `/pm:init` runs in a project:

| Hook | Purpose |
|------|---------|
| SessionStart (startup / resume / **compact**) | Injects the briefing via `additionalContext` — the index comes back the moment context is summarized away. |
| PreCompact | Snapshots (`render` + `.conductor/brief.txt`) right before the context window collapses. |
| PostToolUse (`git commit`) | Nudges a state update after every commit; also auto-detects an unlogged minimal detour from commit shape. |
| PreToolUse (gate-guard) | Hard-blocks `Edit`/`Write`/`NotebookEdit` while the active epic owes a reconcile — on by default, unconditional for that case. |

**Agents** (`agents/`) — dispatched by name, run in a clean context:

| Agent | Purpose |
|-------|---------|
| `reconciler` | Fresh-context re-validation of a paused epic against what a detour actually shipped, at the reconcile gate. |
| `hierarchy-child-executor` | Executes one child epic from a hierarchy batch, front-loaded with its autonomy grant, in its own worktree. |
| `merge-conflict-resolver` | Second rung of the tiered conflict-resolution ladder — resolves a worktree-merge conflict after a normal `git merge` fails. |

</details>

## Workflow

```
/pm:init  →  /pm:status  →  /pm:next  →  (build the epic in its own lane)  →  /pm:sync
                 ↑                              │
                 └────── /pm:detour ────────────┤
                         (minimal: fix→commit→push→log, resume)
                         (substantial: PUSH → build detour → /pm:resume → RECONCILE GATE → POP)
```

Multi-epic batches: `plan-hierarchy --parent <id>` → dispatch each child (worktree-isolated) →
merge sequentially → orchestrator applies all state transitions as sole writer →
`verify-worktrees` for hygiene.

## Project Structure

```
your-project/
├── .conductor/
│   ├── state.json           # state of record — epics, detour stack, links, autonomy grants
│   ├── detours.log          # append-only trail: timestamp · SHA · kind · epic · note
│   └── honcho-memories.log  # ready-to-copy Honcho memory lines, timestamped
├── CLAUDE.md                # managed rules block (idempotent; delete to opt out)
└── PROJECT.md               # generated view — never hand-edited

pm/ (this repo)
├── .claude-plugin/plugin.json   manifest
├── CHANGELOG.md                 release history (Keep a Changelog + SemVer)
├── commands/                    /pm:init /pm:status /pm:next /pm:detour /pm:resume /pm:sync
│                                 /pm:epic /pm:hierarchy /pm:tracker /pm:feedback /pm:lane-routing
│                                 /pm:review-mode /pm:gate-guard /pm:changelog /pm:upgrade
├── skills/conductor/SKILL.md    the discipline
├── agents/                      reconciler.md · hierarchy-child-executor.md · merge-conflict-resolver.md
├── hooks/hooks.json             SessionStart · PreCompact · PostToolUse · PreToolUse
└── scripts/conductor.mjs        the engine (zero dependencies)
```

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for the dev/main branch workflow, PR requirements, and
CI gate. See [CHANGELOG.md](CHANGELOG.md) for version history.

## Roadmap

Tracked in this repo's own conductor backlog (`PROJECT.md`) rather than a separate board —
`pm` manages its own development. Notable planned items: multi-platform agent support
(Codex, Gemini CLI, Grok Build, generic `AGENTS.md`), an AI feedback loop closing the
`/pm:feedback` ↔ issue-sync cycle, and portfolio-level architecture-consistency scanning
across the backlog.

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=cfdude/pm&type=date)](https://www.star-history.com/#cfdude/pm&Date)

## License

MIT © Rob Sherman
</content>
