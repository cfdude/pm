# Proposal: feature-switches-audit

## Why

Rob, 2026-10-13: not every feature needs an on/off switch, but not everyone needs every feature, and each
one costs tokens in every session and every dispatched agent. Today the only switches are the opt-ins in
`OPT_INS` (`reviewMode`, `laneRouting`, `activityLog`, `tracker`, `spendTracking`, `spendGuard`); the
always-on rules sections cannot be turned off at all, and no one has costed them feature by feature.
`rules --sections` at `c78c6828` shows the always-on sections range from 404 to 11,963 bytes (~101 to
~2,991 tokens at bytes/4, an estimate) out of 42,242.

`pm-overhead-baseline` produces the per-feature numbers. This change decides, on those numbers, where a
switch earns its place, and documents every feature's cost and switch (or why it has none).

## What Changes

- **An audit, recorded:** every feature in `pm-overhead`'s surface-to-feature map, its estimated
  per-session cost from `overhead --all-features`, and a decision: a switch, or "no switch" with the
  reason. The audit names no switch in advance; the decisions follow the numbers.
- **The rule for adding a switch:** a feature gets one only when its unconditional per-session cost is at
  or above a named threshold (proposed: 1,000 estimated tokens, labelled a proposal) and it is separable,
  i.e. turning it off removes guidance for an action the repo is not taking rather than a safety rule. A
  developer feature that costs tokens itself is switchable whatever its size.
- **Every new switch follows the existing opt-in pattern:** an `OPT_INS` row, a `set-<feature> on|off`
  verb, absent reads as today's behaviour (so an upgrade changes nothing), and off removes every surface
  the map assigns to that feature. `upgrade` lists every switchable feature with its state and its verb.
- **Developer features stay off by default**: spend tracking, the spend guard (no limit), the developer
  session log. The README says how to turn spend tracking on with the real verb, `set-spend-tracking on`.
- **A README table "What each feature costs"** with the measured numbers, kept honest by a test against
  the map.

## Capabilities

### New Capabilities

- `feature-switches`: the switch rule, the pattern a switch follows, the defaults, and the cost table's
  coverage of the feature map.

### Modified Capabilities

None. The existing opt-ins keep their verbs and requirements; a new switch is added beside them.

## Impact

- Engine (Node built-ins only): `scripts/lib/opt-ins.mjs` (rows for any switch the audit adds),
  `scripts/lib/rules.mjs` (gating the sections of a switched-off feature; managed-rules surface,
  functional certify), a `set-<feature>` verb per switch with its command doc and parity-ledger claim.
- State: one additive optional field per switch added. No migration (absent = today's behaviour).
- Docs: `docs/measurement/2026-10-feature-switch-audit.md`, README table, changeset, Mintlify.
- **Out of scope:** inferring automatically which sections a repo uses (GitHub #248, the 0.54.0 rules-block
  budget, G0); the command, skill and agent listings (plugin files the engine does not control).
- Depends on `pm-overhead-baseline`.
