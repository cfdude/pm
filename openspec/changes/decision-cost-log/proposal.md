# Proposal: decision-cost-log

## Why

Rob, 2026-10-06: a postmortem should say not only where tokens went but what DECISIONS they bought —
"this decision was made and cost about 750,000 tokens" — as self-reflection that finds process
improvements, not as raw spend. The spend ledger (`spend-ledger`) attributes tokens to epics, phases and
roles; nothing records the decisions themselves, so the cost of reaching one cannot be read back.

## What Changes

- **`record-decision <epicId> --what "<decision>" --why "<why>" --since <iso> [--until <iso>] [--alternative "<alt>"]… [--phase <phase>]`**
  appends a numbered decision to `epic.decisions`: what was decided, why, the alternatives considered,
  the phase, and the window of work that reached it.
- **The cost is computed, never typed.** At read time the decision's cost is the epic's attributed
  `work` and `total` (as `spend` reports them) inside its window. pm does not ask the agent for a number
  it cannot check.
- **`decisions <epicId> [--json] [--no-ingest]`** prints them with their costs, and
  `spend-analysis --epic <id>` includes the same section in its postmortem.
- **Off with the rest of the spend feature.** `record-decision` is refused while spend tracking is off,
  naming `set-spend-tracking on`. Turning tracking off later deletes nothing; costs then read
  "not computed".
- **Its inverse.** `record-decision <epicId> --withdraw <n> --reason "<why>"` marks a decision withdrawn
  and keeps it.

## Capabilities

### New Capabilities

- `decision-cost-log`: recording, withdrawing, costing and rendering an epic's decisions, including the
  postmortem section of the spend analysis.

### Modified Capabilities

None.

## Impact

- Engine (Node built-ins only): a new `scripts/lib/decision-log.mjs`; `constants.mjs` (two verbs, their
  flags in the shared allowlist); `verb-effects.mjs`; `conductor.mjs` dispatch and `USAGE`; it reads the
  ledger through `spend`'s ingest → attribute → report pipeline, never a second reader.
- State: additive optional `epic.decisions`. No migration.
- Docs: `commands/record-decision.md`, `commands/decisions.md` (parity-ledger claims in the same
  commit), changeset, README, Mintlify.
- Depends on `token-spend-analysis-and-recommendations` (its section renders inside that verb's output)
  and on `gh-cfdude-pm-251` (`work`). Lane note: registered `superpowers`; now an OpenSpec change.
