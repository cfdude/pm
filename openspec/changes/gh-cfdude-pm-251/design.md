# Design: gh-cfdude-pm-251

## Context

`spend-guard.mjs` resolves `GUARD_FIELDS = ["maxFailedRounds", "tokenCeiling", "warnAt"]` epic → lane →
project, and the token signal compares the `total` that `buildReport({filters:{epic}})` returns with
`tokenCeiling`. `spend --json` totals hold `input`, `cacheCreation`, `cacheRead`, `output`, `total`.

## Goals / Non-Goals

**Goals:** a ceiling that can measure work; the first value someone picks lands in the right range;
no configured 0.52 ceiling silently changes meaning.

**Non-Goals:**
- Changing `--max-failed-rounds` (the issue explicitly does not ask).
- Weighting token classes by price. Cost stays notional; `spend` computes none.
- Refusing a low ceiling. The issue offers "refuse or warn"; a refusal would block a value someone
  measured on purpose.

## Decisions

- **D1 — Absent basis reads as `total`.** Alternatives:
  (a) flip the unit to `work` everywhere — silently re-means every configured ceiling (the issue's own
  300M is a `total` value and would almost never trip);
  (b) default NEW ceilings to `work` and stamp `tokenBasis: "total"` on existing layers through a
  `MIGRATIONS` entry — honest, but a migration for a field nobody has to set.
  Chosen: absent = `total`, docs and the low-ceiling warning steer to `work`. **Rob's call:** whether to
  take (b) instead. The specs below are written for the chosen option; (b) changes only the "absent
  basis" scenario and adds a migration task.
- **D2 — `work` is defined once, in the ledger** (`spend-ledger` ADDED requirement), as
  `input + cacheCreation + output`, and every consumer reads it from the totals object. No second sum.
- **D3 — The basis is a fourth guard field resolved like the others**, so a lane can count `work` while
  the project counts `total`. `warnAt` applies to whichever basis resolves.
- **D4 — An override's `basis`.** A tokens override's `baseline` is a count in one basis. Comparing it
  with a count in another is meaningless, so an override whose `basis` differs from the resolved basis is
  ignored, and `spend-guard` prints that it was recorded in another basis. An override recorded before
  this release has no `basis` and reads as `total` (D1).
- **D5 — Floor of 10,000,000, total basis only.** The issue's suggestion, labelled as such in the warning
  and in `commands/set-spend-guard.md`. A work-basis ceiling gets no floor: there is no measured range yet.
- **D6 — The worked example** is the issue's: `--tokens 300000000` (total basis) for one epic in
  `cfdude/weekly-product-updates`, arrived at by measuring 30 transcripts, with the cache-read shares.

## Risks / Trade-offs

- Two bases make the guard report longer. Mitigated: the breakdown is one line.
- A user who sets `--token-basis work` on a lane and keeps a total-sized ceiling there gets a ceiling
  that never trips. The report prints both totals, so the mismatch is visible.
