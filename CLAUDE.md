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
- This repo IS pm-conductor-managed (`.conductor/state.json` tracks its own backlog) — pm
  dogfoods itself here, mirroring how `cfdude-plugins` did before the extraction.

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
  deliberate, documented exception is the **gate-guard hook** — a local `PreToolUse`
  mechanical block, on by default and unconditional whenever the active epic has
  `reconcileNeeded: true` (`set-gate-guard off` does not bypass that case); see
  `commands/gate-guard.md`.
- **Release discipline.** A feature: (1) bumps `.claude-plugin/plugin.json` `version`; (2) adds
  a `CHANGELOG.md` entry; (3) if the `state.json` schema changes in a way existing data must be
  *transformed* to remain valid, adds a `MIGRATIONS` entry keyed to the new release (additive,
  idempotent, backward-compatible — a state file written by the prior version must still load).
  `state.json` carries `pmVersion`. The user-facing update sequence for any repo using this
  plugin is: update the plugin → `/reload-plugins` (or restart) → `/pm:upgrade` per repo. The
  full end-to-end release procedure (engine, docs, Mintlify site including the Changelog page
  and Real Numbers, the branch dance) is the project-local `release-checklist` skill
  (`.claude/skills/release-checklist/SKILL.md`) — repo-maintenance tooling, not part of what
  the plugin ships to users. Follow it every time `plugin.json`'s version bumps; don't
  re-derive the checklist from memory.
- Engine subcommands are dispatched at the bottom of `conductor.mjs`; every new subcommand needs
  a matching command doc under `commands/` and coverage in `conductor.test.mjs`.
- **State-transition flags are not pure functions of current state.** `reconcileNeeded` in
  particular is set at detour-POP time and must survive until reconciliation completes — POP
  protocol removes the detour-stack frame *before* reconciliation runs, so deriving the flag
  from "is there still a live frame" breaks it at exactly the moment it needs to stay true. See
  `reconcileArchived()`'s comments in `conductor.mjs` before changing this logic again.

## Commits

Conventional commits (`feat|fix|docs|test|chore|refactor`). Never `git commit --no-verify`.

**Documentation currency — check on every PR into `main`, not just at release time.** Before
opening (or updating) a PR into `main`, ask: does this change anything a user or agent would
read about? If a change adds/removes a subcommand, flag, command, epic-level-autonomy behavior,
tracker behavior, or anything else user-facing, both **README.md** and **the Mintlify docs site**
(`pm-plugin.dev`, via the Mintlify MCP) must reflect it in the same PR cycle — follow the
`mintlify-doc-sync` skill for the exact procedure (which pages, how to merge and verify live,
branch cleanup). A change that is genuinely internal (a test, an engine-internal refactor, a
process-only doc fix) does not need either — but say so explicitly rather than silently
skipping the check.

<!-- BEGIN pm-conductor rules (managed by /pm:init — safe to delete this block) -->
## PM Conductor — operating rules

This repo is managed by the `pm` plugin. The conductor sits ABOVE OpenSpec and Superpowers.
Epics are **lane-agnostic** (openspec | superpowers | claude-code | decision | external);
OpenSpec is one lane. Stories come from each epic's source (OpenSpec `tasks.md`, a Superpowers
plan, or a manual list). Follow these rules:

1. **Detours** — when something blocks the active epic, CLASSIFY before fixing:
   - *Minimal* (small, self-contained, no design ambiguity): fix → test → commit → push,
     then run `/pm:detour --minimal "<what>"` so it is recorded in `.conductor/detours.log`.
     Then resume.
   - *Substantial* (own design / changes shared behavior / multi-step): run `/pm:detour`.
     It becomes its own epic in the appropriate lane (OpenSpec proposal, Superpowers plan,
     etc.); PUSH the current epic onto the detour stack in `.conductor/state.json` with a
     concrete reason and `reconcileOnResume`.
2. **State of record is `.conductor/state.json`.** After any change to epics, status,
   priority, or the detour stack, re-render with `/pm:status`. Never hand-edit `PROJECT.md`.
3. **Resuming after a detour** — use `/pm:resume`. If the popped frame had
   `reconcileOnResume`, run the reconcile gate (reconciler agent) BEFORE writing code,
   then write its verdict back durably with `record-reconcile <id> --detour <id>
   --verdict valid|invalidated [--amendments "<a>;<b>"]` — this attaches
   `{verdict, amendments, reconciledAt}` to the paused epic's link to the detour and
   clears `reconcileNeeded`, instead of the judgment only ever living in conversation.
4. **Honcho** — on every PUSH and POP, also write a one-line memory to Honcho
   ("paused X for Y" / "resumed X, reconciled vs Y") so the relationship survives outside
   this repo.
5. **Keep `tasks.md` checkboxes truthful** — they are the source of truth for story progress.
6. **Roadmap as backlog** — work you intend to do but haven't proposed yet can be
   registered now with `/pm:epic add … --status planned` (any lane). Planned epics show
   as ordered backlog in `PROJECT.md` and a `planned: N` count in the briefing, without a
   "no change on disk" warning; `/pm:sync` flips an openspec planned epic to untriaged once
   its change is proposed. Have a roadmap doc? Read it in-session and load each item this way.

## Epic-level autonomy

An epic's `autonomy` block (`.conductor/state.json`) can grant it broad execution trust —
`level: "off"` by default (today's behavior, unchanged). Setting `level: "autonomous"`
removes the need to ask before each phase transition, but NEVER removes a genuine safety stop.
This is development-time only — it never covers actions with irreversible EXTERNAL side
effects (sending email/Slack, deploying to production, third-party API calls, pushing to a
shared branch); those are out of scope regardless of autonomy level.

1. **Preflight before flipping the switch** — see the `conductor` skill's
   "Epic-level autonomy — the preflight scan" section for the full process. In short: read
   the epic's full source, produce a short batch of destructive-risk-points +
   genuine-unknowns questions, get the user's answers, THEN record them:
   `set-autonomy <id> --preauthorize "<action>:<reason>"` / `--context "<note>"`, and only
   then `set-autonomy <id> --level autonomous`. For routine, repeated categories of action
   instead of enumerating each one, use the shorthand
   `--preauthorize "category:<filesystem|network|schema|external-api>:<reason>"` — see the
   `conductor` skill's "Epic-level autonomy" section for the exact keyword heuristic each
   category matches at decision-rule time.
2. **Execution-time decision rule** — check every destructive action against these, in
   order, before treating it as a stop:
   a. Already pre-authorized in the preflight — either an exact `action` match or the
      action falls under a granted `category` (per the category heuristic)? → proceed,
      record via `--notify`.
   b. No backup/restore path exists? → STOP regardless of autonomy level.
   c. Destructive but restorable (backed up first)? → WARN — `--notify` it immediately, proceed.
   d. No context to act on? → STOP — a real gap, not a false stall.
   e. Consequential and not yet notified? → `--notify` it immediately, then proceed.
3. **Notify incrementally, not at the end** — `--notify` writes durably to `state.json`'s
   `notifications[]` the moment a WARN-class (c) or consequential (e) decision is made. Do this
   AS EACH DECISION HAPPENS, not batched — a session can be compacted or interrupted mid-epic,
   and anything not yet `--notify`'d is lost when that happens.
4. **End-of-epic report** — on completion, read back the accumulated `notifications[]` and
   report what was asked, what was done, and the decisions made in the user's absence (drawn
   from that log, not from memory), with an explicit "are you OK with these?" checkpoint, THEN
   run tests. Leave room to iterate — including rewriting code — if the user is not satisfied.

## Review mode

Review intensity is a bounded dial, not a free-form call each time — set via
`set-review-mode --mode <off|standard|thorough>` (default: `standard` if never set).

| Mode | Reviewer budget | Trigger |
|------|-----------------|---------|
| `off` | none — self-review only | tiny, low-risk, single-file claude-code tweaks |
| `standard` | one fresh-context reviewer per gate | the default: OpenSpec Gate 1/Gate 2, a Superpowers task review |
| `thorough` | two independent fresh-context reviewers per gate; adjudicate any disagreement yourself | schema/migration changes, security-sensitive work, or anything explicitly flagged high-stakes |

Current mode: **standard**.

## Feedback — don't let friction stay silent

If you hit a bug, a missing CLI verb, an unexpected limitation, or repeated friction
working with this plugin — in this repo or any repo using it — don't just work around it
and move on. File it: `/pm:feedback [bug|feature] "<summary>"` against `cfdude/pm`, or ask
the user "want me to file this as feedback?" if you're not sure it's worth it. The failure
mode this guards against is silent: hand-editing `.conductor/state.json` to flip a story's
`done` flag (no CLI verb exists for it) recurred across several separate sessions before
anyone reported it, even though `/pm:feedback` existed the whole time. A filed issue is
cheap; an unreported recurring papercut is not — silent pain is where a product fails its
users.

## GitHub issue sync (cfdude/pm)

This tracker is inward: open GitHub issues become conductor epics, same pattern as the
OpenSpec/Superpowers auto-registration `sync` already does for on-disk changes/plans. The
pm plugin NEVER calls `gh` itself — as part of running `/pm:sync`, YOU (the interactive
agent) do:
1. `gh issue list --repo cfdude/pm --state open --json number,title,url,labels`.
2. For each issue, check whether an epic with that issue number as `externalId` already
   exists (`/pm:epic list` or read `.conductor/state.json`) — if so, skip it (already
   mirrored; re-running sync must never create a duplicate epic for the same issue).
3. Otherwise register a new untriaged epic: `add-epic --status untriaged --external-id
   <issue-number> --external-url <issue-url> --lane claude-code --priority P2`, unless a
   `P0`/`P1`/`P2`/`P3` label is present on the issue, in which case use that label's
   priority instead of the P2 default. `add-epic` itself rejects a duplicate `--external-id`
   as a second line of defense, so a stale local view can't produce a duplicate either.
4. Set `--title` from the issue title so the epic is legible before you triage it further.

## Sync after completing tracker-linked work

After you close/transition a tracker-linked issue as part of completing an epic (the
writeback steps above), immediately re-sync with your tracker(s) — run `/pm:sync` — to pull
in anything new that appeared while you were heads-down. You're already doing tracker I/O
for this epic, so this is the cheapest moment to catch it; this applies whether you have one
tracker or several (primary + secondary) configured.
<!-- END pm-conductor rules -->
