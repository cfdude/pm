# Proposal: pm-overhead-baseline

## Why

Rob, 2026-10-13: before any feature gets an off switch, pm needs a baseline of its own per-session token
overhead with every feature on — the rules block, the brief, hook injections, the command, skill and agent
listings — including the overhead of spend tracking itself ("if turning it on adds ~5,000 tokens a session
I must be able to see that and shut it off"), and a view of whether the tracking and record-keeping pm
does make downstream work cheaper.

What is known today is partial and hand-measured:

- `docs/rules-block-session-cost.md` (2026-10-07): the managed rules block was 40,087 bytes (~10,022
  tokens at bytes/4) and the uncapped SessionStart brief 78,275 bytes before 0.52 capped it.
- `rules --sections` at `c78c6828` reports 42,242 bytes, ~10,561 tokens, with the Spend tracking section
  880 bytes and the Spend guard section 806 bytes.
- Across the ledger, cache-read is 96.2% of attributed tokens (assessment §6): every byte pm injects is
  re-read on every message, so a static byte count is the number that multiplies.

Nothing measures the hooks, the plugin listings or the "every feature on" case, and nothing ties a surface
to the feature that emits it, which `feature-switches-audit` needs.

The epic also carries the decision gate for `store-owns-claude-md-managed-block` (epic note, 2026-10-14):
the assertion half measured ~28 s (up from 15.4 s at the 2026-09-25 profile), the file rung ~26.7 s on a
loose machine (load 4.6–5.5), and that epic is built only if the tests that write `CLAUDE.md`/`.gitignore`
to disk carry 10 s or more of the file rung. That threshold is a proposal, not a measurement.

## What Changes

- **`overhead [--json] [--all-features]`**, a read-only verb: every surface pm injects into a session, its
  bytes, a token estimate labelled `bytes/4`, and the ONE feature that emits it. `--all-features` computes
  the same in memory as if every opt-in were on, writing nothing.
- **The surface-to-feature map** (`core` or an `OPT_INS` id) is owned here; `feature-switches-audit` and
  `developer-session-log` read it.
- **Spend tracking's own cost** is reported as its own feature: its rules sections and the per-dispatch
  marker line.
- **The verb never claims a downstream saving.** It says downstream efficiency is not measured by it.
- **Two measurement stories recorded under `docs/measurement/`**: (1) a calibration of the bytes/4
  estimate against real first-message token counts, and (2) the downstream-efficiency question stated as
  what the ledger can and cannot show, with a protocol for Rob to approve before any counterfactual run.
- **The re-baseline story** for `store-owns-claude-md-managed-block`: an n=3 quiet-machine measurement
  with an empty-preload control, reporting the time disk-write tests carry, and a recommendation against
  the 10 s gate.

## Capabilities

### New Capabilities

- `pm-overhead`: the overhead verb, the surface-to-feature map and the labelling rules for its numbers.

### Modified Capabilities

None.

## Impact

- Engine (Node built-ins only): a new `scripts/lib/overhead.mjs` reusing `rulesBlock()`, the brief
  builder and the hook verbs' text builders in-process (no subprocess); `constants.mjs`, `verb-effects.mjs`
  (`reads`), `conductor.mjs`.
- Reads plugin files `commands/*.md`, `skills/*/SKILL.md`, `agents/*.md` frontmatter from the installed
  plugin root. Reads no transcript, no ledger, no network.
- Docs: `commands/overhead.md` with its parity-ledger claim; `docs/measurement/2026-10-pm-overhead-baseline.md`;
  `docs/measurement/2026-10-commit-gate-rebaseline.md`; changeset; README.
- No state change, no migration.
