# Proposal: a lighter rules block — emit the autonomy and release-candidate sections only while they are in use

## Why

The managed rules block is re-read by every session and every dispatched agent. A fresh repo's block
is 34,094 bytes (~8,524 tokens, measured with `rules --sections` on a just-initialised repo, engine
0.53.0). Two of its sections describe features the repo has never used: `## Epic-level autonomy`
(3,137 B) and `## Release candidate` (1,173 B), together 4,310 B (12.6%). Issue #248 reports this
from two repos. Its second data point names the incentive problem: `upgrade` nudges you to adopt
opt-ins, and each one adds rules-block bytes. The spend sections already follow the repo's usage.
These two still do not.

This also has to land first for another epic. `mutation-pass-is-a-required-task-item` adds a 558 B
item to the gate procedure, and it only fits once this change has freed that space.

## What Changes

- `## Epic-level autonomy` is emitted only while at least one NON-ARCHIVED epic has an autonomy
  record, whatever its level.
- `## Release candidate` is emitted only while at least one release has not been marked delivered.
- The outward-tracker paragraph "Epic-level autonomy on tracker-linked epics" follows the autonomy
  condition. It cites the autonomy decision rule, so emitting it without that section would leave a
  dangling reference.
- A short always-on pointer section, `## Procedures emitted on use`, names how to reach each absent
  procedure before its first use: the `conductor` skill before the first `set-autonomy`, and the
  `release-candidate` skill before the first `release`. It lists only the procedures that are
  absent, and it disappears when none is.
- The existing liveness refresh that keeps `## Spend guard` current becomes one table-driven refresh
  covering every usage-conditioned section. After any non-hook verb that wrote state, the block on
  disk is rewritten only when a conditional section's presence disagrees with state. A hand-edit of
  `state.json` is therefore corrected by the next engine write.
- When any write of an existing block ADDS a conditional section, the engine prints a notice that the session's loaded copy of the
  block predates it and that `rules` prints it. A session that has just granted autonomy would
  otherwise act without the decision rule.
- `overhead --all-features` renders its hypothetical's block at full usage, so the every-feature-on
  figure still counts both sections without seeding fake records.
- No new `OPT_INS` id and no new dial. The gate procedure (12,023 B) and every other section stay
  unconditional.
- Existing repos lose both sections at their next `upgrade` or state write, unless they use the
  features. This is a user-visible change, so it gets a changeset.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `managed-rules-block`: usage-conditioned sections, the always-on pointer to absent ones, the
  table-driven refresh, and the appearance notice.
- `epic-autonomy`: the autonomy section follows non-archived autonomy records, including its
  inverses (archive, `remove-epic`, un-archive).
- `release-candidate-review`: the rules block carries the Release candidate section only while an
  undelivered release exists (`--deliver` retires it, `--undeliver` restores it).
- `pm-overhead`: `--all-features` renders the block at full usage; the real report reads the repo's.
- `feature-switches`: the pointer's README cost row comes from a fresh repo's `overhead`, because
  `--all-features` never produces the pointer.

## Impact

- Engine: `scripts/lib/rules.mjs` (`rulesBlock`, `writeRules`, `rulesBlockShowsSpendGuard`),
  `scripts/lib/spend-guard-verbs.mjs` (`refreshSpendGuardSection`, generalised),
  `scripts/conductor.mjs` (the `rules` verb and the dispatch wrapper's refresh call),
  `scripts/lib/overhead.mjs` (`rulesBlockFor`, `SURFACE_FEATURES`).
- Tests: 61 `rulesBlock(` calls in 15 test files keep the full block by default. Fixtures that assert on a
  freshly written block change. New unit and file-rung tests are added, and the functional test
  `emitted-invocations.test.mjs` and sweep `output-interpolations.judged.mjs` are re-certified.
- Docs: `skills/conductor/SKILL.md` (preflight section's pointer to the decision rule),
  `commands/epic.md` (`set-autonomy`), `commands/upgrade.md`, `commands/overhead.md`, README "What
  each feature costs" rows, `docs/parity-ledger.json` (release-candidate description),
  `docs/rules-block-session-cost.md`, and the Mintlify site (orchestrator).
- No `state.json` schema change and no migration.
