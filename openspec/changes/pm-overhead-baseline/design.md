# Design: pm-overhead-baseline

## Context

`rules --sections` already sizes each managed rules section and estimates tokens as bytes/4. The brief is
built in-process by the `brief` verb and capped at 16,384 bytes since 0.52. Hooks (`hooks/hooks.json`):
SessionStart `brief`, PreCompact `snapshot`, PostToolUse and PostToolUseFailure `commit-nudge`, PreToolUse
`gate-guard` and `lesson-advice`. Claude Code lists each command's, skill's and agent's frontmatter
`description` in the session context.

## Goals / Non-Goals

**Goals:** one command that answers "what does pm cost a session, by surface and by feature, today and
with everything on"; every number labelled with its method; a decision-grade answer for the
store-owns gate.

**Non-Goals:**
- Exact token counts from the engine. The engine has no tokenizer and opens no network connection;
  bytes/4 is an estimate and the calibration story measures how far off it is.
- Removing or shrinking any surface (`feature-switches-audit`, and 0.54's rules-block budget).
- Reading the ledger. Per-session multiplication by message count belongs to the measurement doc, which
  can read `spend`; the verb stays static so it is free to run.

## Decisions

- **D1 — Surfaces are enumerated from their builders, not from a list.** Each rules section from
  `rulesBlock()`'s section split; the brief from the brief builder; each hook from `hooks/hooks.json`
  with its verb's output for the current state; listings from the plugin's own files. A new section or
  hook appears without editing the verb.
- **D2 — One feature per surface.** Feature ids are `core`, `listings` (all shipped command, skill and
  agent descriptions: the host lists them whatever is switched on, so they cannot belong to an opt-in), or
  an `OPT_INS` id (`reviewMode`,
  `laneRouting`, `activityLog`, `tracker`, `spendTracking`, `spendGuard`, and any added later). The map
  lives beside `OPT_INS` so a new opt-in cannot ship without stating its surfaces; a test fails on a
  surface with no feature or two.
- **D3 — Conditional surfaces are marked conditional.** `lesson-advice` fires only on a matching
  command, `commit-nudge` only after certain tools, the gate-guard text only while a reconcile is owed.
  Each reports its size when it fires and that it is conditional; the session total counts only the
  unconditional ones and says so.
- **D4 — `--all-features` uses a named hypothetical state** built in memory (each opt-in set to a
  documented representative value: a GitHub tracker, tracking on, a rounds limit, an activity log, lane
  routing, a review mode). It writes nothing and the output names the hypothetical.
- **D5 — Spend tracking's own cost** is the `spendTracking` and `spendGuard` features' surfaces plus the
  marker line (`pm-spend: epic=<id> role=<role> phase=<phase>`), reported once per dispatch and only
  while tracking is on (the marker is instructed only then).
- **D6 — Labels.** Every token figure is printed as `~N tokens (bytes/4, estimate)`; the JSON carries
  `bytes`, `estimatedTokens` and `method: "bytes/4"`. The downstream line is fixed text pointing at `spend-analysis`; the measurement documents are pm's
  own project record and are never named in engine output (`emitted-instructions`: shipped text does not
  send a user's agent to files only pm's repository holds).
- **D7 — The store-owns re-baseline is a task with a recorded outcome, not an engine behaviour.** n=3
  runs on a quiet machine (no agents running; the load average is recorded at the start of each run, and the 2026-09-25 profile it is compared with ran at load under 16), with an
  empty-preload control as in the 2026-09-25 profile; the measure is the summed time of file-rung tests
  that reach init's `CLAUDE.md` or `.gitignore` write, against the 10 s gate (a proposal). The
  orchestrator records the outcome on `store-owns-claude-md-managed-block`; this change writes no state.

## Risks / Trade-offs

- bytes/4 can be off by a wide margin for code-heavy text. The calibration story reports the ratio
  measured on real first messages, and the verb's label stays "estimate" whatever it finds.
- Claude Code's listing format adds per-item text pm does not control; the listing figure covers the
  descriptions pm ships and says so.
