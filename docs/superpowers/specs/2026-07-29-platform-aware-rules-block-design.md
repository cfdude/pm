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

### 1. The host declares itself — pm does not sniff for it

The framing that unlocked this: **pm never runs on its own.** Every engine invocation is
triggered by a host agent, either through a hook that agent fired or a command that agent ran.
So the question is not "what files suggest a platform" but "which agent am I running inside
right now" — and the host can simply be made to say.

pm already ships a **separate hook configuration per platform**, because each platform's format
differs (`hooks/hooks.json` for Claude Code, an `(event, matcher, command)` triple for Hermes,
`.codex/hooks.json` for Codex). In all three, **the command string is authored by pm**. So the
platform is known at packaging time, not runtime:

| Platform | pm-authored hook command |
|---|---|
| claude-code | `node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" brief --platform claude-code` |
| hermes | `node ".../scripts/conductor.mjs" brief --platform hermes` |
| codex | `node "${PLUGIN_ROOT}/scripts/conductor.mjs" brief --platform codex` |

This is **deterministic — no heuristics, no filesystem archaeology, no marker precedence to get
wrong.** It also scales: adding a platform means authoring its hook file with its own
`--platform` value, which the port epic is already doing.

Rejected — env-var sniffing. Claude Code does set a reliable marker (`CLAUDECODE=1`, verified in
a live session), but Hermes does not: its shell-hook runner calls `subprocess.run` with **no
`env=`** (`agent/shell_hooks.py:463`), so hooks inherit whatever launched Hermes and carry no
guaranteed `HERMES_*` marker. Sniffing could therefore detect Claude Code but could not
distinguish Hermes from Codex. It survives only as a fallback rung below.

Rejected — writing every target unconditionally. Claude Code does not read `AGENTS.md` and Codex
does not read `CLAUDE.md`, so writing both leaves a dead file in most repos, and a project is
normally driven by one agent.

### 2. Resolution order, with a default that can never be silent

`--platform` covers every hook-driven invocation. A human running the engine directly from a
terminal is the remaining case, so resolution is a chain:

1. explicit `--platform <id>` (every pm-authored hook path)
2. the value recorded in `state.json` (see §3)
3. `CLAUDECODE=1` in the environment → `claude-code`
4. **default `claude-code`** — the base platform and today's behavior

Detection's dangerous failure is resolving to nothing and writing nothing: pm would appear
installed while contributing no rules block, failing silently — the same class of bug as the
precedence trap above. Hence a terminal default rather than an error, and `init`/`upgrade`
**reports which platform and which file it chose**. A visible wrong guess is recoverable; a
silent no-op is not.

### 3. Record the active platform in `state.json`; refresh it at session start

`state.json` is already the state of record, so the active platform belongs there: **written
once at session start, read once at session start.** That makes the choice auditable in the same
file everything else lives in, and it survives between invocations.

It also enables the case that matters most: **platform switching.** If the recorded platform is
`claude-code` and the current session declares `hermes`, pm knows the project changed hands. It
can then look at the artifacts the previous platform left behind and faithfully recreate the
equivalents the new platform supports, rather than silently leaving a repo half-configured for
an agent that is no longer driving it.

Because this adds a field existing state files lack, it needs a `MIGRATIONS` entry keyed to the
release — additive and idempotent, with a state file written by the prior version still loading.

### 4. Guarantee the written file wins the platform's precedence chain

For the detected platform, pm must write to the file that platform will actually consult given
what is already on disk — not merely a file it could consult. Concretely, for Hermes, writing
`CLAUDE.md` is correct only when no `HERMES.md` or `AGENTS.md` exists; otherwise the block must
go to the file at the head of the chain.

**Decision: pm writes to the head of the detected platform's chain, and reports which file it
chose and why.** Refusing to write was considered and rejected — it would leave pm
non-functional in the repo, trading a silent failure for a loud one rather than fixing it.

Note this is per-platform, not global. Claude Code has no chain: it reads `CLAUDE.md`
regardless of what else is present, so a stray `AGENTS.md` is simply irrelevant there. The rule
only bites for platforms that resolve by precedence, which today means Hermes.

### 5. The block body stays platform-neutral; only command strings vary

The rules-block body — detour classification, the autonomy decision rule, tracker instructions,
the review-mode table — is platform-neutral and stays a single source of text. Nothing in it is
Claude-Code-specific once the command strings are parameterized, and forking the body per
platform would create exactly the drift the parity mechanism exists to prevent.

**Only the command strings are per-platform.** That keeps the substitution surface as small as
it can be: one command-form table, not N copies of the instructions.

### 6. Command syntax: namespaced slash command, per-platform form

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

## Resolved during design

The three questions that were open when this spec was first drafted are now settled and folded
into the sections above:

1. **How the platform is identified** → §1. The host declares itself via a `--platform` flag in
   the hook command pm authors for that platform. No marker detection.
2. **Where the choice lives** → §3. `state.json`, written and read once per session start, with
   a `MIGRATIONS` entry. Enables the platform-switch case.
3. **Per-platform body?** → §5. No. Body stays neutral; only command strings vary.

## Open questions for the plan

1. What does pm do concretely on a detected platform *switch* (§3)? Recreating the new
   platform's artifacts is the intent, but the boundary between "pm refreshes its own managed
   block" and "pm regenerates a whole artifact tree" belongs to the port epics, not here. This
   spec should settle only the rules-block half and state where the line falls.
2. Does `--platform` validate against a known list and reject an unknown value, or fall through
   to the default? Rejecting is more honest for a typo in a hand-authored hook; falling through
   is more forgiving. Leaning reject-with-message, consistent with how `add-epic` treats an
   unknown `--lane`.
