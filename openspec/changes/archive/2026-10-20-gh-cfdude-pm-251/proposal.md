# Proposal: gh-cfdude-pm-251

## Why

The spend guard's token ceiling (`set-spend-guard --tokens`) is compared with an epic's attributed
`total`, and `total` includes `cache-read`. Cache-read is re-counted on every assistant message, so the
total grows with context size times message count, not with the work done. GitHub #251 reports it from
a consumer repo (`cfdude/weekly-product-updates`):

- a 1,500,000 ceiling came back `warn` after 5 messages, 99.3% of the count cache-read;
- across that repo's 30 transcripts, the longest session's total was 1,973,048,595 tokens with 95.3%
  cache-read, and the spread on `total` between four sessions was 13x while non-cache-read tracked
  message count far more honestly;
- the reporter guessed 1.5M, over-corrected to 50M, and measured their way to 300M.

This repository's ledger shows the same shape: cache-read is 96.2% of attributed tokens and output 0.34%
(`docs/reviews/pm-0.53.0-backlog-assessment.md` §6). A person cannot pick a first value in the right
range, and a value set in one unit means something different in a long session than in a short one.

## What Changes

- **A defined "work" total, owned by the ledger.** Every `spend` totals object gains
  `work = input + cacheCreation + output`. One term, used by this change, the spend analysis, the
  overhead baseline and the developer session log.
- **The token ceiling is counted in a recorded basis.** `set-spend-guard --token-basis total|work`
  stores `tokenBasis` at the same three layers as the other fields, with an `--unset token-basis`.
  An absent basis reads as `total`, so every ceiling configured on 0.52 keeps its meaning and no
  migration is needed. A basis alone is not a limit.
- **The breakdown is always printed.** `spend-guard` prints the epic's four token classes and its work
  total beside the token signal, text and JSON.
- **A low total-basis ceiling warns.** `set-spend-guard --tokens <n>` with a resolved basis of `total`
  and `n` below 10,000,000 records the value and prints one line explaining cache-read and naming
  `--token-basis work`. The floor is the issue's suggestion, not a measurement.
- **A tokens override is bound to its basis.** The override records the basis its baseline was counted
  in; an override recorded in another basis than the one now resolved is not applied, and `spend-guard`
  says so.
- **A worked example.** `commands/set-spend-guard.md` gives one real ceiling with its provenance.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `spend-ledger`: ADDS "Every totals object carries a work total".
- `spend-guard`: MODIFIES "Guard limits are configured at three layers and resolved most specific
  first" (a fourth field), "Every guard limit has an unset at every layer" (`token-basis`) and "The
  token signal compares attributed spend with the ceiling" (counted in the basis); ADDS the breakdown,
  the low-ceiling warning and the basis-bound override.

## Impact

- Engine (Node built-ins only): `scripts/lib/spend-report.mjs` (the work total),
  `scripts/lib/spend-guard.mjs` (`GUARD_FIELDS`, resolver, token signal),
  `scripts/lib/spend-guard-verbs.mjs` (flag, unset, warning, override basis, report),
  `scripts/lib/constants.mjs` (the `--token-basis` flag row).
- State: additive optional `tokenBasis` on `state.spendGuard`, `state.laneSpendGuards[lane]`,
  `epic.spendGuard`, and `basis` on a tokens override entry. No migration: absent reads as `total`.
- Docs: `commands/set-spend-guard.md`, `commands/spend-guard.md`, `commands/spend.md`, changeset.
- Rob's call recorded in design D1: the default basis for a NEW ceiling.
