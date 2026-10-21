# Design: token-spend-analysis-and-recommendations

## Context

`buildReport()` (`scripts/lib/spend-report.mjs`) returns per-epic `totals`, `byActor`, `byRole`,
`byPhase`, `byRound`, `byTier`, `firstAt`, `lastAt` and per-agent totals, plus `unattributed` and
`coverage`. Rows hold counts and identifiers only (`spend-ledger`). Epics carry `release`.

## Goals / Non-Goals

**Goals:** say where tokens went in a form a person can act on; name the inefficiency; keep every number
traceable to ledger rows.

**Non-Goals:**
- Money cost or price weighting. Notional under subscription auth; `spend` computes none.
- Context-retention warnings per session (session age, compactions). Those belong to
  `developer-session-log`, which reads session-level data this verb does not.
- Model-written recommendations. Engine law: no network.
- Re-attributing `invalid-marker` rows by alias (#242 keeps strictness).

## Decisions

- **D1 — Rank by `work`, report `total` beside it.** Assessment §6 implication 1: a raw-total ranking is
  a ranking of context size times turn count.
- **D2 — "Context" means the orchestrator's own turns plus every class of cache tokens.** The report
  shows the cache classes per actor so "how much is in context" is the cache-read and cache-write
  columns, not a separate estimate.
- **D3 — The outlier rules and their thresholds are named constants, and each threshold is labelled a
  proposal, not a measurement** (n = 4 epics). Initial values:
  - `long-context-agent`: an agent with at least 100 messages AND mean per-message context at least
    200,000, where per-message context is `input + cacheCreation + cacheRead` (the measure the developer
    session log's `large-context` warning applies to a single message). The one known case is 156 and ~379K (assessment §6).
  - `dominant-agent`: one agent holds at least 50% of an epic's `work`, on an epic with at least 2 agents.
  - `tier-mismatch`: role `mechanical`, `rudimentary` or `test` on an opus- or fable-tier model; or role
    `plan` or `review` on a haiku-tier model.
  - `review-loop`: an epic's `phase=review` rows carry at least 3 distinct `round` values ("distinct
    review rounds", deliberately not the guard's anchored rounds signal).
  - `low-coverage`: the scope's coverage share below 90%.
  - `invalid-markers`: any `invalid-marker` tokens in scope (the #242 list says which).
  **Rob's call:** the threshold values; the rules ship with these and are tuned on 0.53's own build.
- **D4 — One recommendation per flag**, fixed text with the evidence filled in:
  long-context-agent → split the batch or hand off to a fresh context before the context passes the
  threshold; dominant-agent → the plan left one executor too much to decide, sharpen it; tier-mismatch →
  set the role's model with `set-profile`/`--model`; review-loop → the guard's escalation (`spend-guard`);
  low-coverage → mark dispatches and keep an epic active; invalid-markers → fix the phase/role names.
- **D5 — The trend floor.** A verdict needs at least 2 releases each with at least 3 epics holding
  attributed rows. Releases are ordered by registration order in state, newest first. Then `growing` when the latest
  release's mean `work` per epic exceeds the previous
  release's by at least 20%, `falling` at 20% or more below, else `flat`. Below the floor:
  `insufficient data — <r> releases, <e> epics`. 20% is a proposal (Rob's call, with D3).
- **D6 — Tools from the ledger's stored `tools` names.** Every row already holds the `tool_use` names of
  its message (`spend-ledger`), so tool-call counts per name need no new capture. Tokens are NOT
  apportioned to tools: a message's usage is one number for all its content. The developer session log
  adds byte-level composition for a developer who wants it; this verb does not depend on it.
- **D7 — Scope.** No flag: the whole ledger. `--epic`: one epic, plus its Decisions section
  (`decision-cost-log`). `--release`: the epics whose `release` is that id.

## Risks / Trade-offs

- Thresholds tuned on one release can flag too much or too little. Mitigated by printing the evidence and
  the threshold with every flag, so a reader can disagree.
- The trend will read `insufficient data` until a second release is ingested; that is the honest output.
