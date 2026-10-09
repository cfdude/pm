# Proposal: token-spend-tracking-per-epic

## Why

Token spend is invisible in pm today. 0.51.0 spent about 11M sub-agent tokens on 5 of its 27 epics, and
70% of that went to one epic (7 Gate 1 rounds and 3 Gate 2 rounds). An overnight autonomous run with
failing gates spent a weekly allowance. Nobody could say which epic, phase, role or model the tokens
went to until it was over.

Three planned epics depend on a per-epic record of spend that does not exist yet:
`spend-budget-and-stuck-loop-guard` (0.52.0), `token-spend-analysis-and-recommendations` (0.53.0) and
`decision-cost-log` (0.53.0). This change builds that record: the ledger. It adds no analysis, budget
or recommendations.

## What Changes

- **A project-level opt-in, off by default.** `set-spend-tracking on|off` adds a row to the
  `OPT_INS` registry, so `upgrade` lists it for every repo that has not adopted it. It is off for
  users because measuring costs reads. This repo turns it on for dogfooding. Turning it off stops all
  reading and deletes nothing.
- **A local ledger built from Claude Code's own transcript files.** The engine reads
  `<config dir>/projects/<encoded repo path>/*.jsonl`, each session's `subagents/agent-*.jsonl`, and
  the repo's worktree project directories. It reads those files only. It opens no network connection
  and calls no model.
  - It writes one row per assistant message to a git-ignored `.conductor/spend/`.
  - Rows hold counts and identifiers only: token counts, model, message, session and agent ids,
    timestamp and tool names. They never hold prompt or response text.
- **Ingest is incremental and idempotent.** A per-file byte cursor reads only complete new lines.
  Re-reading a file never double-counts, because rows fold by message id. Ingest runs only inside the
  `spend` verb. No hook reads a transcript, even with tracking on.
- **One ledger per repository.** The ledger lives in the main working tree, including when `spend`
  runs from a linked worktree. Attribution is computed when the ledger is read, not stored on rows,
  so an epic registered after its spend still gets the credit.
- **Attribution to an epic follows a fixed precedence.**
  1. A sub-agent is attributed by a `pm-spend:` marker line in its dispatch prompt. The rules block
     tells the agent to write it whenever tracking is on. The marker carries epic, role, phase and
     gate round.
  2. Orchestrator rows are attributed by an active-epic timeline that the engine records while
     tracking is on.
  3. Everything else lands in an **unattributed** bucket. The report always prints that bucket, so
     spend that was not measured never looks like zero.
- **Actor, role and phase are separate fields.**
  - Actor is `orchestrator` or `subagent`.
  - Role comes from the existing `KNOWN_JOB_ROLES`. The ledger does not declare a second role list.
  - Phase comes from a new closed list, `KNOWN_SPEND_PHASES`.
  - The gate round is an integer, so a "gate retry" is `phase=review, round>1`.
- **A read verb.** `spend [--epic <id>] [--since <iso>] [--until <iso>] [--json] [--no-ingest]`
  ingests, then reports per-epic totals. Totals are split by actor, role, phase and model tier, with
  the unattributed bucket and a coverage line.
  - It reports tokens. It ships no price table, because a table would be an invented number. Cost is
    reported as not computed, and the report says that Claude Code's own cost figures are notional
    under subscription auth.
- **Every write has an inverse.**
  - `set-spend-tracking off` undoes on. It records when tracking went off, so spend made while
    tracking was off is never credited to an epic.
  - `spend --clear --yes` removes the derived rows and the cursor.
  - `spend --rebuild --yes` re-derives the rows from the transcripts still on disk, and keeps the
    rows whose transcripts Claude Code has since pruned.
  - `spend --clear --timeline --yes` also removes the timeline, which cannot be re-derived.
  - Without `--yes`, each of these prints its plan and changes nothing.

## Capabilities

### New Capabilities

- `spend-ledger`: the opt-in per-epic token ledger. It covers the switch, the transcript source and
  its read-only, network-free boundary, the row model and its privacy rule, incremental idempotent
  ingest, attribution precedence and the dispatch marker, the hot-path guarantee, the `spend`
  report, and the inverse of every write.

### Modified Capabilities

- `conductor-record`: the requirement "A detached HEAD suppresses session-bookkeeping writes" lists
  every write site under `.conductor/`. This change adds the spend directory's files to that list,
  classified as suppressed, with a scenario.

The opt-in row, the rules-block section and the git-ignore entry are each new behaviour that
`spend-ledger` owns, emitted through existing mechanisms.

## Impact

- **New engine code** (Node built-ins only, zero dependencies):
  - a transcript reader
  - the ledger, the cursor and the timeline
  - the `spend` and `set-spend-tracking` verbs
- **Touched engine surfaces:**
  - `scripts/lib/opt-ins.mjs` (a new row)
  - `scripts/lib/subcommands.mjs` (`ENGINE_IGNORED` gains `.conductor/spend/`)
  - `scripts/lib/constants.mjs` (`KNOWN_SPEND_PHASES`, the arity and flag tables, the verb list)
  - `scripts/lib/verb-effects.mjs`
  - the `conductor.mjs` dispatch and its `USAGE` string
  - the dispatch snapshot/diff chokepoint (timeline append)
  - the rules-block builder: a conditional section. This is a managed-rules surface, so it needs the
    functional certify. It is also a chokepoint shared with `execution-profile-planning-and-light-roles`.
- **State:** an additive optional field, `state.spendTracking`. It needs no `MIGRATIONS` entry, the
  same as `state.activityLog`.
- **Docs:**
  - a new `commands/spend.md` and its parity-ledger claim
  - `skills/conductor/SKILL.md`
  - a changeset fragment
  - README and Mintlify after Gate 2
- **Machine-local data.** The ledger is git-ignored and per-checkout. Claude Code's transcript
  retention bounds how far a rebuild can reach back.
