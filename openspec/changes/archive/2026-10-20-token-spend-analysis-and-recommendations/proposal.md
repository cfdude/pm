# Proposal: token-spend-analysis-and-recommendations

## Why

Rob, 2026-10-06: a postmortem must say WHERE tokens went, not only that an epic burned millions. `spend`
(`spend-ledger`) reports per-epic totals split by actor, role, phase, round and tier, but it ranks nothing,
flags nothing and recommends nothing, and it puts all four token classes into one `total`.

The ledger already shows why a raw total misleads (`docs/reviews/pm-0.53.0-backlog-assessment.md` §6,
141,174,593 tokens since 2026-10-09T22:28Z):

- cache-read is 96.2% of attributed tokens and output 0.34%;
- one Sonnet implement agent used 60.5M of one epic's 68.7M (88%): 156 messages at about 379K cache-read
  per message — a long-lived, large-context agent, not a large amount of output;
- 45.0M (32%) is unattributed: 24.5M `invalid-marker` (phase names outside the set, GitHub #242) and
  20.5M `no-active-epic` (orchestrator turns);
- the per-epic trend has one data point: 4 epics, 1 release.

## What Changes

- **`spend-analysis [--epic <id> | --release <id>] [--json] [--no-ingest]`**, a read-only verb over the
  same ingest → attribute → report pipeline `spend` uses.
- **A breakdown shaped like a usage report**: the four token classes and `work` kept separate; by actor
  (orchestrator context vs sub-agents), model tier, role and phase; sub-agents ranked by `work`, never by
  `total`; coverage and the unattributed reasons as their own section.
- **Tools**: tool-use counts per tool name, from the `tools` names every ledger row already stores
  (`spend-ledger`, "Stored rows hold counts and identifiers only"). Tokens are not apportioned to tools:
  per-message usage cannot separate them, and the output says so.
- **Outlier flags from a closed rule list**, each with its evidence and threshold:
  `long-context-agent`, `dominant-agent`, `tier-mismatch`, `review-loop`, `low-coverage`,
  `invalid-markers`.
- **Recommendations rendered from rules**, one fixed lever per flag (split the batch, hand off to a fresh
  context, sharpen the plan, re-tier the role, fix the markers). No model call; the engine opens no
  network connection.
- **A cross-release trend with an honest floor**: mean `work` per epic per release, and a verdict only
  when there is enough data; otherwise `insufficient data` with the counts.
- **No money cost**, as `spend` already says; tokens are the measure.

## Capabilities

### New Capabilities

- `spend-analysis`: the analysis verb, its breakdown, the outlier rules, the recommendations and the
  trend.

### Modified Capabilities

None. It reads `spend-ledger`'s report and `work` total (`gh-cfdude-pm-251`), the invalid-marker list
(`gh-cfdude-pm-242`) and the rows' stored `tools` names without changing them. Its Decisions section is owned by `decision-cost-log`.

## Impact

- Engine (Node built-ins only): a new `scripts/lib/spend-analysis.mjs`; `constants.mjs` (verb and flags);
  `verb-effects.mjs` (`reads`, plus the same ingest `spend` performs); `conductor.mjs` dispatch and `USAGE`.
- State: none. No migration.
- Docs: `commands/spend-analysis.md` with its parity-ledger claim, `commands/spend.md` cross-reference,
  changeset, README, Mintlify.
- Depends on `token-spend-tracking-per-epic` (delivered), `gh-cfdude-pm-251` and `gh-cfdude-pm-242`.
