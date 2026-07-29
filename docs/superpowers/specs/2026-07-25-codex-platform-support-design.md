# Design: Codex CLI platform support

**Epic:** `codex-platform-support` — child of `multi-platform-agent-support`
**Date:** 2026-07-25
**Depends on (all three must land first):** `platform-parity-mechanism`,
`edd-harness-agent-behavior-testing`, `rules-block-hardcodes-claude-slash-commands`

> This is the *fourth* child of the `multi-platform-agent-support` parent epic and is
> deliberately sequenced last. Claude Code is the permanent base platform; every other
> platform is held to parity with it. The three sibling epics build the machinery that
> makes that parity enforceable — structural, procedural, and semantic — *before* a second
> platform exists, so drift never gets an unobserved window. Each sibling gets its own
> design doc; this one covers only the Codex port itself.

## Problem

`pm` runs only on Claude Code. Its engine (`scripts/conductor.mjs`) is platform-neutral
already — zero-dependency Node 18+, invoked by shelling out — but everything that makes pm
*automatic* is Claude-Code-shaped: `hooks/hooks.json`, 16 `commands/*.md`,
`skills/conductor/SKILL.md`, `agents/*.md`, and a rules block written to `CLAUDE.md`.

## Scope decision: one platform, fully

This epic supports **Codex CLI only**, to real parity. It deliberately does **not** build a
universal multi-platform abstraction.

Rationale: designing an abstraction across four platforms from secondary sources produced
directly contradictory answers (see Research below) — two research methods disagreed on
whether Codex hooks even exist. Building one complete, empirically-verified integration
teaches the real shape of the problem. Because other tools visibly mimic Codex's conventions
(AGENTS.md is already a shared cross-tool spec), a working Codex port is the cheapest path to
the second and third platforms. A tool that turns out to be genuinely different gets its own
investigation when it's picked up.

Codex was chosen because it is widely adopted, already installed on the maintainer's machine
with an active account, and therefore testable immediately.

## Research: secondary sources were wrong; hands-on verification decided it

Two independent research passes contradicted each other on the load-bearing question:

| Claim | Blog posts (WebSearch) | Perplexity |
|---|---|---|
| Codex lifecycle hooks | Yes — v0.114.0, 2 events, feature-flagged, experimental | "No documented public lifecycle-hook API as of July 2026" |
| Codex custom slash commands | (unstated) | "Built-in slash commands only; no custom registration" |

**Both were wrong.** Verified directly against Codex CLI **0.145.0** installed locally:

- `codex features list` reports `hooks` → **stable, enabled by default**. Also `multi_agent`
  → stable/true, `skill_search` → stable/true. (`plugin_hooks` is a separate, *removed*
  feature — not the general hook system.)
- `openai/codex` ships `docs/skills.md` and `docs/slash_commands.md`, so both exist.
- `codex plugin marketplace add <local path | owner/repo[@ref] | Git URL>` plus
  `codex plugin add PLUGIN@MARKETPLACE` — a Git-sourced plugin marketplace closely
  mirroring how Claude Code installs pm today.

**Standing lesson: verify agent-platform capabilities against the installed CLI.** This
ecosystem moves faster than either blogs or search-synthesis tools track.

## The hook port is near-trivial

Codex's hook config is structurally the same as Claude Code's — same nesting, same `matcher`,
same `hooks` array of `{ type: "command", command: … }` — and lives at `.codex/hooks.json`
(project) or `~/.codex/hooks.json` (user), with a TOML-in-`config.toml` equivalent.

Mapping pm's four hooks:

| pm hook (Claude Code) | Codex equivalent | Change |
|---|---|---|
| `SessionStart`, matcher `startup\|resume\|compact`, emits `hookSpecificOutput.additionalContext` | `SessionStart`; valid sources `startup`/`resume`/`clear`/`compact`; identical `additionalContext` schema | **None** |
| `PreCompact`, matcher `auto\|manual` | `PreCompact`, matcher filters `trigger` = `manual`/`auto` | **None** |
| `PostToolUse`, matcher `Bash` | `PostToolUse`, matcher filters `tool_name` | Confirm Codex's shell tool name |
| `PreToolUse`, matcher `Edit\|Write\|NotebookEdit`, blocks via `process.exit(2)` | `PreToolUse`; **exit code 2 = block, reason read from stderr** | Remap matcher to Codex's edit tool (`apply_patch`) |

Consequences:

- **The engine's hook *contract* needs no changes.** `brief`, `snapshot`, and `gate-guard`
  already emit exactly what Codex expects, including the `exit 2` blocking convention that
  `gateGuardCheck()` uses and the `additionalContext` injection shape.
- **One engine detail needs empirical confirmation, not assumption:** `commitNudge()` extracts
  the command via `tool_input.command || tool_input.cmd`. Codex uses the same `tool_input`
  envelope, but whether its shell tool nests the command under `command`, `cmd`, or another
  key is unverified. pm already handles two candidates defensively; if Codex uses a third, that
  is a one-line addition. Confirm from a live payload (see Build order step 2).
- Hook commands reference `${PLUGIN_ROOT}` (Codex) rather than `${CLAUDE_PLUGIN_ROOT}`.
- pm's core value proposition — briefing re-injected after context compaction — ports intact,
  because Codex's `SessionStart` fires with `source=compact`.

## Architecture: per-platform directories, shared engine

```
pm/
  scripts/                  # SHARED — already platform-neutral, unchanged
    conductor.mjs
    lib/*.mjs
  .claude-plugin/           # Claude Code manifest (existing, untouched)
  hooks/ commands/ skills/ agents/    # Claude Code artifacts (existing, untouched)
  .codex-plugin/            # NEW — Codex manifest
  codex/                    # NEW — Codex artifacts
    hooks.json
    skills/
    commands/
```

Each platform's installer sees only its own tree. The working Claude Code plugin is never at
risk from Codex work, and the engine is written once.

Rejected alternative: generating per-platform artifacts from a single neutral source at
release time. It would prevent drift across duplicated command docs, but it adds a build step
to a repo that deliberately has none, and the right generator shape is unknowable before the
second platform exists. Revisit when a third platform lands and the duplication is real
rather than hypothetical.

## Build order: prove the hard part first

The riskiest assumption is not the code — it is whether Codex's hooks fire and inject context
as documented. That gets tested before any artifact-layout work.

1. **Empirical probe (throwaway).** A scratch project wiring `conductor.mjs brief` to a real
   Codex `SessionStart` hook. Confirm the briefing text actually reaches the model's context.
   Then confirm `gate-guard`'s `exit 2` genuinely blocks an edit. If either fails, the epic
   changes shape — at a cost of an hour, not a week.
2. **Resolve tool names empirically.** Capture real `PreToolUse`/`PostToolUse` payloads to get
   Codex's actual `tool_name` values instead of guessing from doc examples.
3. **Rules block to `AGENTS.md`** (blocked on `rules-block-hardcodes-claude-slash-commands`;
   see Dependency).
4. **Codex artifact tree + manifest**, layout per above.
5. **Skills and slash commands**, using `docs/skills.md` / `docs/slash_commands.md` formats.
6. **Install end-to-end from the marketplace** into a clean project and verify every pm
   workflow works there.

## Dependencies

**Claude Code is the permanent base platform.** Every capability originates there and every
other platform is held to parity with it. Three sibling epics build the enforcement machinery
and must land first:

1. **`platform-parity-mechanism`** — the structural gate: a machine-parseable parity ledger
   plus a CI test that fails when a Claude Code artifact has no per-platform counterpart and
   no explicit exemption. The Codex port is done *under* this gate, so the ledger is populated
   as the port proceeds rather than reconstructed afterward. Any capability that genuinely
   cannot work on Codex becomes a documented exemption row with a stated reason — never a
   silent omission.
2. **`edd-harness-agent-behavior-testing`** — the semantic gate. A structural test can prove a
   counterpart file exists; it can never prove the Codex version *behaves* the same. That gap
   is closed by evaluation-driven development: author a scenario corpus, bless a **Claude Code
   baseline**, then run the identical scenarios against Codex and compare. This ordering is
   structurally necessary — the baseline must exist before there is anything for a Codex run
   to be measured against.
3. **`rules-block-hardcodes-claude-slash-commands`** — `rulesBlock()` hardcodes Claude Code
   slash-command syntax (`/pm:status`, `/pm:detour --minimal`, the
   `Manage with /pm:status · /pm:next · …` footer). On a platform whose command surface
   differs, that text instructs the agent to run commands that may not exist. Codex *does*
   have slash commands, so the fix may be a per-platform command prefix rather than a full
   CLI-form fallback — settled in that epic.

## Out of scope

- Antigravity CLI, Grok Build, OpenCode, and generic AGENTS.md platforms. Each gets its own
  investigation, informed by what Codex teaches.
- A universal per-platform artifact-map abstraction (see Architecture).
- Porting `agents/*.md` (subagents). Codex reports `multi_agent` as stable, so this is likely
  feasible, but pm's subagent dispatch is driven by skill instructions rather than a packaged
  artifact; it is deferred until the four primary artifact types work.

## Open questions to resolve during implementation

1. Codex's real `tool_name` values for its shell and file-edit tools (doc examples show
   `Bash` and `apply_patch`; verify against live payloads), and the inner key its shell tool
   uses inside `tool_input` (see the `commitNudge()` note above).
2. The `.codex-plugin/` manifest schema — no published spec was found; derive it from
   `codex plugin` behavior against a local marketplace.
3. Whether Codex slash commands can be namespaced (`/pm:status`) or only flat (`/pm-status`),
   which determines the rules-block phrasing fix.
4. Whether one Git repo can serve both a Claude Code marketplace and a Codex marketplace
   without the manifests colliding.
