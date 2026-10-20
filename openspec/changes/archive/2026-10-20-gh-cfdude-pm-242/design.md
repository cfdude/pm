# Design: gh-cfdude-pm-242

## Context

`resolveMarker()` in `scripts/lib/spend-attribution.mjs:72` returns `{ ok: false, reason: "invalid-marker" }`
and drops which check failed. Markers are stored raw, keyed by `agentId` (`spend-ledger`: "The dispatch
marker is captured once per sub-agent and stored as tokens"), so the failing field and value are
recoverable at read time without touching the ledger.

## Goals / Non-Goals

**Goals:** a rejected marker is legible in the one report that already shows it: the field, the value,
the accepted set.

**Non-Goals:**
- Accepting aliases. Declined in the issue.
- Surfacing it at dispatch time. The engine never sees a dispatch; it reads transcripts later. The rules
  block's Spend tracking section already lists the accepted phases.
- Surfacing it in the brief. No hook reads the ledger (`spend-ledger`), and this change keeps that.

## Decisions

- **D1 — Report the FIRST failing field, in a fixed order: `role`, `phase`, `round`.**
  One marker gets one reason. A marker wrong in two fields is shown with the first; fixing it shows the
  next. Alternative considered: list every failing field. Rejected as extra surface for a rare case.
- **D2 — The accepted set is read from the same constant the check uses** (`KNOWN_JOB_ROLES`,
  `KNOWN_SPEND_PHASES`), never a second literal, so the message cannot drift from the check.
- **D3 — Group by `(field, value)`**, not by agent, so 40 dispatches with `phase=spec` are one line.
- **D4 — Values leave through `escapeControls`.** A marker value is agent-written text.

## Risks / Trade-offs

- A marker value can be long. It is truncated to 64 characters in the text report (JSON keeps the
  stored value), with the truncation marked.
