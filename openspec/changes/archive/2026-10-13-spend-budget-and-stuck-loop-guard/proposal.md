# Proposal: spend-budget-and-stuck-loop-guard

## Why

A review loop that cannot converge keeps spending tokens until a person notices. In 0.51.0 one epic took 7
Gate 1 rounds and 3 Gate 2 rounds, about 70% of roughly 11M sub-agent tokens (figures from
`token-spend-tracking-per-epic`'s proposal), and a review round that kept re-opening spent 5.8M review
tokens on one epic (the incident as Rob reported it). Nothing in pm counted the rounds. Nothing said "stop".
Retrying at the same model tier was the only thing that happened. `token-spend-tracking-per-epic` now
records where tokens go. This change uses that record, plus a round count that state never kept, to say
when to stop and who to hand the failure to.

Rob's handoff (2026-10-09): the stuck-loop half comes first, and it needs a gate-round counter.

## What Changes

- **A gate-round counter, always recorded.**
  - `record-gate-review` keeps a per-gate tally on the epic: the consecutive-fail streak, the lifetime
    fails and passes, the time of the last verdict, and the time of the last pass.
  - A `pass` ends the streak. A withdrawal changes nothing, because the rounds still happened.
  - The counter costs one additive field on an existing write, and needs no opt-in.
  - Epics recorded before this release start at zero. State cannot reconstruct their rounds, and the
    report says so.
- **A stuck-loop signal, with a second source when tracking is on.**
  - The rounds signal is the larger of two counts: the highest recorded fail streak, and (with spend
    tracking on) the number of distinct `round` values the epic's `phase=review` dispatch markers
    carried since its latest recorded pass, minus one.
  - The second source catches rounds that nobody recorded as a failed verdict, which is how 0.51.0's
    loop went unseen.
- **A per-epic token ceiling, read from the spend ledger.** The ceiling warns at a configurable share and
  stops at the limit. With tracking off, the ceiling is not checked. Every surface that would have
  checked it says so, and the guard degrades to round counting only.
- **Limits are configured at three layers.** The project, lane and epic layers resolve most specific
  first, the same way the execution profile does: `set-spend-guard [--epic <id> | --lane <lane>]`, with
  `--max-failed-rounds`, `--tokens` and `--warn-at`, and `--unset <field>` at every layer. No limit is
  set by default, so a repo that never configures one sees no new behaviour except the counter.
- **What the guard does at the limit.** pm is an instruction layer. It dispatches nothing and kills
  nothing. At the limit it stops and escalates:
  - `spend-guard <epicId>` is the check verb. It exits non-zero while the epic is stuck and prints the
    escalation instruction.
  - A failed verdict that reaches the limit is still recorded, because the verdict is evidence. The
    same invocation then prints the STOP block.
  - The SessionStart/PreCompact brief carries one STOP line for a stuck active epic. It computes that
    line from `state.json` alone and never reads the ledger.
  - The rules block gains a `## Spend guard` section, only while a limit is configured. It says: check
    before every review or fix dispatch, and on STOP hand the failure evidence to the next model tier up
    or to the user. A STOP is a genuine safety stop that epic-level autonomy does not bypass.
- **An override that is an acknowledgement, and its inverse.**
  - `override-spend-guard <epicId> --signal rounds|tokens --escalated-to user|<model> --reason "<why>"`
    records who took the decision. It re-arms the guard from the current count.
  - The override is accepted only while that signal is tripped, so it cannot pre-authorize a loop.
  - `--escalated-to` must rank at or above the computed target. After one model override, only `user`
    is accepted. No autonomy grant covers the override, and a later `pass` spends a rounds override.
  - `--revoke --reason` marks the latest live override revoked and re-arms the guard at once. The
    override record is kept, never deleted.

## Capabilities

### New Capabilities

- `spend-guard`: the stuck-loop and spend-ceiling guard. It covers:
  - the gate-round counter and the rounds signal
  - the token ceiling and how it degrades when tracking is off
  - the three-layer limit configuration and its unsets
  - the check verb and the STOP surfaces (the gate-record notice, the brief line and the rules-block
    section)
  - the escalation target
  - the override and its revoke
  - the hot-path guarantee

### Modified Capabilities

None. The limits are a separate cascade, not a fourth profile field, so `execution-profile`'s "at most
three fields" requirement is untouched (design D3). The rules-block section, the brief line and the new
fields on the `record-gate-review` write are new behaviour that `spend-guard` owns, emitted through
existing mechanisms, the same way `spend-ledger` owns its rules-block section.

## Impact

- **Engine (Node built-ins only):**
  - a new `scripts/lib/spend-guard*.mjs` holding the resolver, the signal computation and the three verbs
  - `gate-review-writeback.mjs` (counter and STOP notice)
  - the brief in `subcommands.mjs`
  - `rules.mjs`, a conditional section. This is a managed-rules surface, so it needs the functional
    certify. It is the same chokepoint as `token-spend-tracking-per-epic`'s section and
    `execution-profile-planning-and-light-roles`.
  - `constants.mjs` and the verb registry
  - `verb-effects.mjs`
  - `opt-ins.mjs`
  - `conductor.mjs` dispatch and `USAGE`
- **Reads:** the spend ledger, through the same ingest-and-attribute pipeline `spend` uses, and only
  inside `spend-guard` while tracking is on. No hook reads it.
- **State:** additive optional fields `epic.gateRounds`, `epic.spendGuard`, `epic.spendGuardOverrides`,
  `state.spendGuard` and `state.laneSpendGuards`. No `MIGRATIONS` entry is needed.
- **Docs:**
  - `commands/spend-guard.md`, `commands/set-spend-guard.md` and `commands/override-spend-guard.md`,
    with their parity-ledger claims
  - `skills/conductor/SKILL.md`
  - a changeset fragment
  - README and Mintlify after Gate 2
- **Out of scope:** detecting repeated failing `certify` runs per epic. A certify run is bound to the
  index, not to an epic, so there is nothing to count against. This is recorded as a declined deferral.
