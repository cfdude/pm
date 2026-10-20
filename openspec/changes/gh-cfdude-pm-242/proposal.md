# Proposal: gh-cfdude-pm-242

## Why

`spend` credits a sub-agent's tokens to an epic only when its dispatch prompt begins with a valid
`pm-spend:` marker. A marker whose phase is outside `KNOWN_SPEND_PHASES` (`plan|build|review|docs|release`)
is rejected as `invalid-marker` (`scripts/lib/spend-attribution.mjs:75`), and the report says only that
tokens are unattributed under that reason. It never names the value it rejected or the set it accepts.

Measured in this repository (`docs/reviews/pm-0.53.0-backlog-assessment.md` §6, verified by joining
`.conductor/spend/rows.jsonl` with `markers.json`): 24,509,352 tokens of real 0.52 work, 17% of a
141.2M-token ledger, were dispatched with `phase=spec` or `phase=gate-1`. Every role was valid, only
the phase was wrong. It was noticed only because attribution read 68.1% (GitHub #242).

## What Changes

- `spend` (text and `--json`) lists every distinct invalid marker it holds, with the field that failed,
  the rejected value, the accepted set for that field, the number of agents carrying it and their
  tokens. Example line: `invalid pm-spend marker: phase "gate-1" is not one of plan|build|review|docs|release — <n> agents, <t> tokens`.
- Strict validation stays. No alias is accepted (`spec` is not mapped to `plan`): the issue explicitly
  declines aliases, and a guessed attribution is worse than a legible refusal.
- Stored markers are already raw and attribution is computed at read time, so a corrected vocabulary
  or a corrected epic re-attributes rows without a re-ingest. Nothing changes there.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `spend-ledger`: adds one requirement, "An invalid marker is reported with the rejected value and the
  accepted set". No existing requirement changes.

## Impact

- Engine (Node built-ins only): `scripts/lib/spend-attribution.mjs` (carry the failing field and value
  out of the validity check), `scripts/lib/spend-report.mjs` (text and JSON).
- No state change, no migration, no new verb or flag.
- Docs: `commands/spend.md`, a changeset fragment. README and Mintlify if the report section is
  documented there.
