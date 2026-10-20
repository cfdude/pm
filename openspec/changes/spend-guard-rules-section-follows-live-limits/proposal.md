# Proposal: spend-guard-rules-section-follows-live-limits

## Why

A Gate 2 Minor on `spend-budget-and-stuck-loop-guard`: the managed rules block's `## Spend guard`
section is refreshed only by `set-spend-guard`. Whether a limit is configured also depends on epic
status — `guardConfigured()` counts an epic-layer limit only on an epic that is not archived
(`spend-guard` spec, "The guard is an opt-in listed by upgrade"). So:

- archiving or removing the only epic that holds a limit leaves the section in `CLAUDE.md` after the
  limit stopped being live;
- un-archiving it (`update-epic --status untriaged`) leaves the section ABSENT while the limit is live,
  and the per-dispatch "run `spend-guard <epic>` before every review or fix dispatch" instruction
  disappears. The brief's STOP line and `record-gate-review`'s STOP still fire, so the guard is not
  blind, but the instruction an agent reads before dispatching is gone.

## What Changes

- Any invocation that changes whether a limit is configured refreshes the rules block, whatever verb
  made the change. The check is a before/after comparison of `guardConfigured()` over the state the
  dispatch wrapper already loads, so a future writer is covered without being listed.
- No change to what the section says, where it sits, or when it is emitted.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `spend-guard`: MODIFIES "The rules block carries a Spend guard section only while a limit is
  configured" to say every write that changes liveness refreshes the block, with archive, remove and
  un-archive scenarios.

## Impact

- Engine: `scripts/conductor.mjs` (the dispatch wrapper's before/after snapshot, beside the activity
  and spend-timeline snapshots), `scripts/lib/spend-guard.mjs` (`guardConfigured`, unchanged),
  `scripts/lib/rules.mjs` (`writeRules`, unchanged). The rules block is a managed-rules surface, so the
  functional certify applies.
- No state change, no migration, no new verb or flag.
- Docs: none user-facing beyond a changeset line (the section's behaviour is what it always claimed).
