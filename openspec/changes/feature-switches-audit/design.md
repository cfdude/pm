# Design: feature-switches-audit

## Context

`OPT_INS` rows carry `id`, `verb`, `doc`, `isSet`, `describe` and `missing`; `upgrade` prints a
`NOT SET:` line for each unset row. Opt-ins today add surfaces when turned ON. A switch for an always-on
feature removes surfaces when turned OFF, so its default is the inverse of an opt-in's.

## Goals / Non-Goals

**Goals:** every feature costed; switches only where the numbers and the feature's nature justify one;
no behaviour change on upgrade.

**Non-Goals:**
- Automatic section selection (#248, 0.54 G0) — this is explicit user choice.
- The plugin listings: Claude Code reads `commands/`, `skills/`, `agents/` from the plugin; the engine
  cannot hide them. The audit reports their cost and says so.
- A generic `set-feature <name>` verb. It would be a second channel for the existing opt-ins
  (`set-spend-tracking` and the rest); one verb per switch matches them.

## Decisions

- **D1 — Threshold 1,000 estimated tokens per session, unconditional surfaces only.** About 4,000 bytes.
  A proposal, not a measurement: **Rob's call.** Conditional surfaces (hooks that fire on a match) are
  costed per firing and are not switched by this rule.
- **D2 — Separable, not safety.** A feature whose text is a safety stop or a record-integrity rule (the
  gate procedure's required items, the operating rules' detour and reconcile rules, the Reporting rules
  that forbid dropping recorded facts) is never switched, whatever its size, and the audit says so. The
  candidates the numbers will put in front of the audit are named in the audit doc, not here.
- **D3 — Default is today's behaviour.** A new switch for an always-on feature reads absent as ON; the
  `OPT_INS` row is "set" when the field is present either way, and `upgrade` prints
  `<id>: on (default) — ~N tokens/session → set-<x> off` for a default-on switch, beside the existing
  `NOT SET:` lines for default-off opt-ins.
- **D4 — Off removes every surface the map assigns.** Verified by `overhead` reporting zero bytes for the
  feature, so the switch and the map cannot drift.
- **D5 — The README table is derived-checked.** A FILE-rung test reads the README table's feature ids
  and fails when the map holds a feature the table lacks, or the table names one the map does not.

## Risks / Trade-offs

- A switched-off section can leave an agent without guidance it later needs. Mitigated by D2 and by the
  switch's command doc stating what the agent no longer receives.
- The audit may add zero switches. That is a valid outcome and is recorded with the numbers.
