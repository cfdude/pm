## Why

A gate verdict is the one record in `.conductor/state.json` with no inverse.

`record-gate-review` can **replace** a verdict (re-recording keeps the prior entry under
`superseded`), but nothing can say *this verdict does not belong on this epic at all*. A verdict on
the wrong epic is not a wrong verdict. It is a verdict in the wrong place, and nothing can move it.

`update-epic --withdraw-commit` already exists for the neighbouring field, and its own rationale is
the argument (0.38.0): *"cannot be reordered" is a different claim from "can never be corrected",
and the second was inherited rather than decided.* The same distinction applies one field over.

**How it bit (cfdude/pm#192).** Closing `#175`, the tracker-mirror epic was `openspec`-lane, so the
archive gate refused it without a Gate 2 of its own. The gates lived on the change epic. Copying both
verdicts onto the mirror satisfied the gate, and `integrity` immediately (and correctly) reported
`gate-recorded-as-bookkeeping`: the two verdicts were recorded **2192 ms apart**. That finding broke
`conductor-15`'s "every live finding is explained in the record" assertion, so the suite went red,
and the one lever that would have cleared it did not exist. It was recoverable **only because the
write was still uncommitted** (`git checkout HEAD -- .conductor/state.json`, then re-applying the
legitimate operations through verbs). Committed, it would have been permanent.

The upstream mistake was the copying: the right disposition was `superseded`, which is exempt from
the Gate 2 demand. But the tool made the wrong path easy and offered no way back. The engine's own
emitted gate procedure (required task item 1) names an operation shipped without its inverse as a
finding, and this field predates that rule.

## What Changes

- **New repeatable flag `update-epic <id> --withdraw-gate-review <1|2> --withdrawal-reason "<why>"`.**
  The withdrawn entry, `superseded` history included, moves out of `gateReview.gateN` into
  `withdrawnGateReviews[]` as `{gate, entry, reason, withdrawnAt}`. **Recorded, not erased.** The
  record keeps the whole entry rather than the issue's suggested `{verdict, reviewedAt}`, because an
  audit of a withdrawal needs the range, the artifacts and the reviewer that were taken back.
- **Withdrawn is a state of its own, never a synonym for absent.** This is the asymmetry
  `attribution-withdrawn` already has against `none-attributed`:
  - the archive gate refuses a withdrawn Gate 2 by name;
  - `archived-openspec-epic-with-no-gate-1` names a withdrawn Gate 1;
  - PROJECT.md and the brief render `withdrawn — <reason>`, and keep an epic whose every gate is
    withdrawn in their tables;
  - the activity log records `gate-withdrawn`, and its report lists it.
- **Refused:** without a reason; for a gate other than 1 or 2; for the same gate twice; where the gate
  has no stored verdict; where the stored verdict is `ungated`; and for `--withdrawal-reason` alone,
  which today passes, is never read, and writes nothing.
- **Bound by the archive gate like every other field write**, through
  `archive-gate-reads-what-it-writes`, which this change depends on and follows:
  - A withdrawal combined with `--status archived` is decided on the record it leaves.
  - A Gate 2 withdrawal on an already-archived `delivered` epic is refused as an obligation
    regression, printing the invocation that withdraws and records the right disposition in one call.

  This change adds no archive-gate rule of its own.
- **The heal does not stamp `ungated` over a withdrawn Gate 2.** The standing condition gains a
  second kind for an archived openspec-lane epic in completion scope whose Gate 2 is withdrawn. It has
  the same clearing path and truthful wording. The existing `ungated` kind is unchanged.
- **A spec sentence false since #163 is corrected:** "`record-gate-review` refuses a verdict to an
  epic of any other lane".
- **A doc defect on this surface:** `README.md` shows `--withdraw-commit <sha> --reason`; the flag has
  been `--withdrawal-reason` since 0.38.0.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `gate-integrity`: ADDS gate-verdict withdrawal, its refusals, the withdrawal as a field write under
  the archive gate, and the withdrawn state. MODIFIES "The archive-drift heal writes one record at the
  moment it flips a status" and "An ungated archive is a standing condition until a real verdict
  supersedes it".

## Impact

- `scripts/lib/update-epic.mjs`: the new flag, its refusals, write and read-back, placed beside the
  `--withdraw-commit` block (before the gate, which `archive-gate-reads-what-it-writes` moves last);
  the usage line.
- `scripts/lib/constants.mjs`: `EPIC_FLAGS` rows, `KNOWN_GATE_NUMBERS`, `withdrawnGate()`.
- `scripts/lib/archive-gate.mjs`: the withdrawn-Gate-2 message inside `deliveredObligation()`, and the
  shared gate-table helper (here, not in `constants.mjs`, because it needs `stalenessMarking`).
- `scripts/lib/integrity.mjs`: `ungatedArchives` kinds, the no-Gate-1 detail, the `recordedShas`
  comment.
- `scripts/lib/epic-progress.mjs`: the heal.
- `scripts/lib/render.mjs`, `scripts/lib/briefing.mjs`: the shared gate-table helper.
- `scripts/lib/activity-log.mjs`, `scripts/lib/activity-report.mjs`, `commands/activity.md`: the event.
- `scripts/lib/rules.mjs` and its emitted-block fixtures: withdrawals as recorded writes.
- `scripts/test/conductor-13.test.mjs`: a full-argv `pre` step in the documented-flag harness.
- `commands/epic.md`, `README.md`, `skills/conductor/SKILL.md`, `CHANGELOG.md`.
- No migration: `withdrawnGateReviews` is additive and absent-tolerant.
