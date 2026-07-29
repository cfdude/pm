# Design: platform-aware rules block

**Epic:** `rules-block-hardcodes-claude-slash-commands` — child of `multi-platform-agent-support`
**Date:** 2026-07-29
**Blocks:** `hermes-platform-support`, `codex-platform-support`, `edd-observe-hardcodes-claude-md`

## Problem

`rulesBlock()` hardcodes two Claude-Code-specific things, and the second is worse than the
epic title suggests:

1. **Command syntax** — `/pm:status`, `/pm:detour --minimal`, and the
   `Manage with /pm:status · /pm:next · …` footer.
2. **The target filename** — `constants.mjs:14` defines `CLAUDE_MD` and `rules.mjs:309` is the
   only writer. pm can only ever write `CLAUDE.md`.

Claude Code is the permanent base platform; every other platform is held to parity with it.
Neither hardcode survives contact with a second platform.

## The finding that reshaped this design

Hermes does not simply "read `AGENTS.md`". It resolves project context through a
**first-match-wins precedence chain** (`agent/prompt_builder.py:2073-2077`):

```
HERMES.md  →  AGENTS.md  →  CLAUDE.md  →  .cursorrules
```

Two consequences, both load-bearing:

- Hermes **does** read `CLAUDE.md` — so in a clean repo, pm's existing rules block already
  reaches a Hermes session unchanged. Hermes support is far cheaper than assumed.
- But if the repo already contains `AGENTS.md` or `HERMES.md` — e.g. from a prior Codex or
  Hermes attempt — Hermes reads **that** and never looks at `CLAUDE.md`. pm's rules block
  becomes **silently invisible**: no error, no warning, just an agent operating without the
  conductor's instructions.

**Writing to a file the platform is capable of reading is not sufficient. The file must win
that platform's precedence chain.** This is the single most important requirement here, and it
is why "detect the platform, write one file" is necessary but not sufficient on its own.

Codex, by contrast, reads `AGENTS.md` and does not read `CLAUDE.md` at all.

## Verified platform facts

Established against the installed CLIs (per the standing platform-verification procedure), not
from documentation or search:

| | Claude Code | Hermes v0.19.0 | Codex 0.145.0 |
|---|---|---|---|
| Instruction file | `CLAUDE.md` | chain above | `AGENTS.md` |
| Reads `CLAUDE.md`? | yes | **only if `HERMES.md` + `AGENTS.md` absent** | no |
| Namespaced slash cmd | `/pm:status` | **`/pm:status` — `:` survives** | **no — `/pm-status`** |

**Hermes command evidence.** Plugins register in-session commands via `register_command()`
(`hermes_cli/plugins.py:548`). Normalization is
`name.lower().strip().lstrip("/").replace(" ", "-")` — it never strips `:` — and
`resolve_command()` (`hermes_cli/commands.py:299`) is a whole-key dict lookup that does not
split on `:`. So `/pm:status` works end to end.

Critically, **a name that collides with a built-in is silently skipped** — `logger.warning`
then `return` (`plugins.py:583-590`). Hermes ships a built-in `status`. A bare `/status` from
pm would therefore be **dropped with no user-visible signal**. The `pm:` namespace is not
cosmetic; it is what prevents silent loss.

**Codex command evidence.** Custom commands are files in `~/.codex/prompts/*.md`, named from
the filename stem. The maintainer's own directory is the proof: `opsx-apply.md`,
`opsx-archive.md`, `opsx-propose.md` — the same OpenSpec commands invoked as `/opsx:apply`
under Claude Code. That is a direct A/B on one plugin, and it settles the Codex design's open
question #3: Codex is flat and hyphenated.

## Design

### 1. Detect the platform; write exactly one file

Rejected: writing every target unconditionally. Claude Code does not read `AGENTS.md` and Codex
does not read `CLAUDE.md`, so writing both leaves a dead file in most repos. A project is
normally driven by one agent.

Detection resolves to a single platform, and the platform resolves to a single target file.

### 2. Default to `claude-code` when detection is ambiguous or empty — and say so

Detection has one dangerous failure mode: finding nothing and writing nothing. pm would appear
installed while contributing no rules block at all — failing silently, which is the worst
available outcome and the same class of bug as the precedence trap above.

Therefore: **an unresolved detection falls back to `claude-code`**, the base platform and
today's behavior, and `init`/`upgrade` **reports the target it chose**. A visible wrong guess
is recoverable; a silent no-op is not.

### 3. Guarantee the written file wins the platform's precedence chain

For the detected platform, pm must write to the file that platform will actually consult given
what is already on disk — not merely a file it could consult. Concretely, for Hermes, writing
`CLAUDE.md` is correct only when no `HERMES.md` or `AGENTS.md` exists; otherwise the block must
go to the file at the head of the chain.

Where pm finds a foreign instruction file that outranks its target, it must not silently write
the losing file. Options are to write the winning file instead, or to refuse and report — to be
settled in the plan, but silence is not among them.

### 4. Command syntax: namespaced slash command, per-platform form

The namespace is retained on every platform that supports one, because it is what prevents the
silent collision documented above.

| Platform | Form |
|---|---|
| claude-code | `/pm:status` |
| hermes | `/pm:status` |
| codex | `/pm-status` |

This is a per-platform command *form*, not a prefix substitution — Codex changes the separator,
not just the prefix.

## Explicitly deferred

- **CLI fallback** for a platform with no slash commands or an unavoidable collision — filed as
  `rules-block-cli-fallback` (P3, planned). Deferred deliberately: a CLI fallback changes *who
  the instruction addresses* (a slash command is for the user; `node scripts/conductor.mjs` is
  realistically for the agent), which is a design fork rather than longer text. Registered as a
  planned epic rather than a code `TODO`, because a comment resurfaces to nobody while a planned
  epic appears in `PROJECT.md` and the briefing.
- **Adopting a pre-existing foreign instruction file** (reading an `AGENTS.md` left by a prior
  agent to inform initialization) — filed as `init-detects-foreign-agent-instruction-files`
  (P3, planned). Note this is *distinct* from §3: §3 is a correctness requirement that must ship
  now; the P3 item is the richer "read it and learn from it" behavior.
- **`SOUL.md`** — loaded by Hermes from `HERMES_HOME` only, not from the project directory, so
  it is not a project-instruction target and is out of scope here.
- **`.cursorrules`** — last in Hermes' chain; no pm platform targets it.

## Out of scope

- The Codex and Hermes ports themselves. This epic only makes the rules block platform-aware;
  the ports consume it.
- Per-platform artifact trees (`codex/`, `.codex-plugin/`) — owned by the port epics.

## Consequences for `edd-observe-hardcodes-claude-md`

That epic is re-sequenced as `depends-on` this one. `evals/observe.py` hardcodes `CLAUDE.md`,
which is **correct today** because the engine only writes `CLAUDE.md`; parameterizing the
observer first would abstract over a filename nothing produces. Once the engine writes a
per-platform target, `observe()` follows, and one eval proves both halves together.

## Open questions for the plan

1. What concrete markers identify each platform, and in what precedence? (`.claude/` vs
   `.codex/` vs a Hermes project marker; a repo may carry several.)
2. Does the detected target belong in `state.json` — recorded once at `init` and stable
   thereafter — or re-detected on every `write-rules`? Recording it is more predictable and
   makes the choice auditable; re-detecting adapts when a repo changes hands. If recorded, this
   needs a `MIGRATIONS` entry.
3. Does the rules block need a per-platform *body*, or only per-platform command strings? The
   tracker/review-mode text appears platform-neutral, but this should be confirmed rather than
   assumed.
