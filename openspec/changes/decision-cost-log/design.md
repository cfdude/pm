# Design: decision-cost-log

## Context

The ledger is attributed at read time (`spend-ledger`); `buildReport({filters: {epic, since, until}})`
already sums an epic's rows in a window. Markers carry `phase`, so a decision's window can be read per
phase as well. The activity log (opt-in) is a per-event file, not a record on the epic; the epic said
"likely built on the activity log", and this design deliberately does not, because the activity log can
be off while spend tracking is on.

## Goals / Non-Goals

**Goals:** a decision is a durable, attributable record on its epic; its cost is a number pm computed
from the ledger; the postmortem shows it.

**Non-Goals:**
- Causal attribution. The window's spend is everything attributed to the epic in that window, including
  parallel work unrelated to the decision. The output says so.
- Agent-supplied token figures. Unverifiable; a typed number is a guess presented as data.
- Model calls to judge decisions. Engine law: no network.

## Decisions

- **D1 — The window is explicit (`--since`, optional `--until` defaulting to the record time).**
  Alternatives: (a) "since the previous decision" — wrong for the first decision and for parallel
  decisions; (b) an agent-supplied `--tokens` — unverifiable. An explicit window is checkable.
- **D2 — Stored on the epic, in `state.json`.** The decision is a record of the work, so it lives with
  the epic and survives a ledger `--clear`. Its COST lives only in the ledger and is recomputed on each
  read, so a re-attribution (a fixed marker, #242) re-prices it.
- **D3 — Refused while tracking is off.** Rob's direction: spend records are optional and off by
  default. A decision whose cost can never be computed belongs in an epic note, which already exists.
  The refusal names both `set-spend-tracking on` and `update-epic <id> --notes`.
- **D4 — Withdraw marks, never deletes** (`withdrawnAt`, `withdrawReason`), matching the override revoke
  in `spend-guard`. A withdrawn decision is listed as withdrawn and excluded from totals.
- **D5 — Numbering is per epic, 1-based, never reused**, so `--withdraw <n>` cannot hit a different
  decision after a later append.
- **D6 — This capability owns the postmortem section** inside `spend-analysis --epic <id>`. The analysis
  spec only reserves the `decisions` JSON key and defers its content to this capability; every
  requirement on that section's behaviour lives here, so one change owns that output.

## Risks / Trade-offs

- Overlapping windows double-count spend across decisions. The output never sums decision costs into an
  epic total; it shows each window alone.
- Text fields are agent-written: stored as given, printed through `escapeControls`, each capped at 2,000
  characters (refused above).
