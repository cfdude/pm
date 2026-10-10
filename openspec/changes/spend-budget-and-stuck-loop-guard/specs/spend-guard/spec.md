# Spec Delta

## Purpose

Stops an epic from looping through review or fix rounds, or past a token ceiling, without anyone
deciding to continue. pm counts gate rounds, reads the spend ledger, and emits a STOP with an
escalation target. The agent or the user acts on it; pm never dispatches or kills anything.

## ADDED Requirements

### Requirement: record-gate-review keeps a per-gate round tally on the epic

Every accepted `record-gate-review` SHALL update `epic.gateRounds.gate<N>` in the same write as the
verdict: `fails`, `passes`, `failStreak`, `lastVerdictAt` and `lastPassAt`.

- A `fail` adds one to `fails` and to `failStreak`, and leaves `lastPassAt` as it was.
- A `pass` adds one to `passes`, sets `failStreak` to 0, and sets `lastPassAt` to that verdict's
  `reviewedAt`.
- A refused invocation SHALL change nothing.

The tally is recorded whether or not any guard limit is configured.

#### Scenario: Consecutive fails build a streak

- **WHEN** `record-gate-review E --gate 1 --verdict fail` is accepted three times in a row
- **THEN** `epic.gateRounds.gate1` is `{fails: 3, passes: 0, failStreak: 3, lastVerdictAt: <the third verdict's reviewedAt>}`, with no `lastPassAt` key

#### Scenario: A pass ends the streak and keeps the lifetime counts

- **WHEN** gate 2 has `failStreak: 2` and `record-gate-review E --gate 2 --verdict pass --base-sha a --head-sha b` is accepted
- **THEN** `epic.gateRounds.gate2.failStreak` is 0, `fails` is still 2 and `passes` is 1
- **AND** `gate2.lastPassAt` equals that verdict's `reviewedAt`

#### Scenario: The two gates are counted apart

- **WHEN** gate 1 has `failStreak: 2` and a gate 2 `fail` is recorded
- **THEN** `gate1.failStreak` is still 2 and `gate2.failStreak` is 1

#### Scenario: A refused record leaves the tally unchanged

- **WHEN** `record-gate-review E --gate 2 --verdict pass` is refused for missing `--base-sha`
- **THEN** no state write is made

### Requirement: The pass anchor is the latest lastPassAt across the epic's gates

The epic's pass anchor SHALL be the latest `gateRounds.gate<N>.lastPassAt` across its gates, or none
when no gate has one. `lastPassAt` is absent until the gate's first `pass` recorded by this release.
The rounds signal and override liveness SHALL read the anchor, never `gateReview`, whose writer keeps
one superseded entry and so forgets a pass after two more verdicts on that gate.

#### Scenario: Later fails on the same gate keep the pass anchor

- **WHEN** gate 1 records `pass`, then `fail`, then `fail`
- **THEN** `gate1.lastPassAt` is still the pass's `reviewedAt`, though `gateReview.gate1` now holds only the second fail and its superseded first fail

#### Scenario: The anchor spans gates

- **WHEN** gate 1's `lastPassAt` is T1 and gate 2's is a later T2
- **THEN** the epic's pass anchor is T2

### Requirement: Only a recorded verdict moves the tally

No write path other than an accepted `record-gate-review` SHALL change `epic.gateRounds`.

- `update-epic --withdraw-gate-review` leaves it unchanged: the round still happened. A withdrawn
  `pass` keeps its `lastPassAt`, so it still anchors, and the streak it ended is not restored.
- The archive-drift heal's `ungated` Gate 2 write leaves it unchanged: no review took place.
- An epic with no `gateRounds` reads as zero with no anchor. Nothing backfills it.

#### Scenario: Withdrawing a verdict does not un-count the round

- **WHEN** gate 1 has `failStreak: 2` and `update-epic E --withdraw-gate-review 1 --withdrawal-reason "x"` runs
- **THEN** `epic.gateRounds.gate1` is unchanged

#### Scenario: A withdrawn pass is flagged, not un-done

- **WHEN** gate 1's last verdict was a `pass` that ended a streak of 3, and that pass is withdrawn
- **THEN** `gate1.failStreak` stays 0 and `gate1.lastPassAt` still holds that pass's `reviewedAt`
- **AND** `spend-guard E` reports that gate 1's latest verdict is withdrawn, that the streak it ended is not restored, and that it still anchors the ledger side and override liveness

#### Scenario: An epic recorded before this release starts at zero

- **WHEN** an epic carries `gateReview.gate1` with a `superseded` entry and no `gateRounds`
- **THEN** `spend-guard` reports its recorded fail streak as 0 and no pass anchor
- **AND** it says the count starts from the first verdict recorded by this release
- **AND** with tracking on, its ledger side counts every attributed `phase=review` row in the ledger, because no pass bounds it

### Requirement: Guard limits are configured at three layers and resolved most specific first

`set-spend-guard` SHALL store three optional fields: `maxFailedRounds` (positive integer), `tokenCeiling`
(positive integer) and `warnAt` (integer 1–99, a percentage). It stores them at the project layer by
default, at a lane with `--lane <lane>`, or at an epic with `--epic <id>`. Each field SHALL resolve
independently, epic first, then lane, then project. An unset field has no limit, except `warnAt`,
which defaults to 80.

#### Scenario: An epic value overrides the project value

- **WHEN** `set-spend-guard --max-failed-rounds 3` and then `set-spend-guard --epic E --max-failed-rounds 1` run
- **THEN** `spend-guard E` reports `maxFailedRounds 1 (epic)` and an epic in the same lane without its own value reports `3 (project)`

#### Scenario: A lane value applies to that lane's epics

- **WHEN** `set-spend-guard --lane openspec --tokens 2000000` runs
- **THEN** an openspec-lane epic with no epic-layer value resolves `tokenCeiling 2000000 (lane:openspec)`
- **AND** a superpowers-lane epic resolves no token ceiling

#### Scenario: A detour epic inherits nothing from the epic it paused

- **WHEN** epic P has `--epic P --max-failed-rounds 1` and detour D is pushed from P
- **THEN** D resolves `maxFailedRounds` from its own lane or the project, never from P

#### Scenario: Invalid values are refused and nothing is written

- **WHEN** `set-spend-guard` gets `--max-failed-rounds 0`, `--tokens -5`, `--warn-at 100`, `--lane nope`, `--epic missing`, or both `--epic` and `--lane`
- **THEN** each exits non-zero naming the offending value and what is accepted
- **AND** no state write is made

#### Scenario: A set with nothing to set is refused

- **WHEN** `set-spend-guard --epic E` runs with no field flag and no `--unset`
- **THEN** it exits non-zero, says nothing was given to set, and writes nothing

### Requirement: Every guard limit has an unset at every layer

`set-spend-guard [--epic <id> | --lane <lane>] --unset <field>` SHALL remove that field from that
layer only, where `<field>` is `max-failed-rounds`, `tokens`, `warn-at` or `all`. Resolution then falls
through to the next layer. A layer left with no fields SHALL be removed from the record. Unsetting a
field that is not set SHALL exit 0, print that nothing changed, and leave `state.json` unchanged.

#### Scenario: Unsetting the epic layer falls through to the project

- **WHEN** the project has `maxFailedRounds 3`, epic E has `1`, and `set-spend-guard --epic E --unset max-failed-rounds` runs
- **THEN** `spend-guard E` reports `maxFailedRounds 3 (project)`
- **AND** `epic.spendGuard` is absent from E's record

#### Scenario: Unsetting everything at the project returns to no limits

- **WHEN** `set-spend-guard --unset all` runs and no lane or epic layer sets a field
- **THEN** `state.spendGuard` is absent and every epic resolves no limit

#### Scenario: An unset of an absent field changes nothing

- **WHEN** `set-spend-guard --lane openspec --unset tokens` runs and that lane has no token ceiling
- **THEN** the command exits 0 saying nothing changed
- **AND** no state write is made

### Requirement: The rounds signal combines recorded verdicts with the ledger's review rounds

An epic's rounds count SHALL be the larger of two values. One is the highest `failStreak` across its
gates. The other, used only while tracking is on, is the number of distinct `round` values on its
attributed `phase=review` ledger rows timestamped after its pass anchor (the latest
`gateRounds.gate<N>.lastPassAt`, any gate; every row when there is none), minus one, floored at 0.
The guard SHALL report both values and which one decided.

#### Scenario: Unrecorded review rounds are still counted

- **WHEN** tracking is on, E has no recorded verdict, and the ledger holds E's `phase=review` rows with rounds 1 to 4
- **THEN** E's rounds count is 3, attributed to the ledger

#### Scenario: A recorded pass ends the ledger side too

- **WHEN** E's ledger holds review rounds 1 to 3, then gate 1 `pass` is recorded, then review rows with round 1 follow
- **THEN** the ledger side counts only the rows after the pass, and E's rounds count is 0

#### Scenario: Recorded fails decide when they are higher

- **WHEN** `gate2.failStreak` is 3 and E's ledger side is 2 (three distinct review rounds since the pass anchor)
- **THEN** E's rounds count is 3, attributed to gate 2's recorded verdicts

#### Scenario: Tracking off degrades to recorded verdicts and says so

- **WHEN** spend tracking is off and `gate1.failStreak` is 2
- **THEN** E's rounds count is 2
- **AND** the report says that ledger review rounds were not read because spend tracking is off

### Requirement: The rounds signal trips at the configured limit

When `maxFailedRounds` resolves for an epic, the rounds signal SHALL be tripped while the rounds count,
minus the baseline of the latest live `rounds` override, is at or above that limit. A `rounds` override
is live only if it is unrevoked and the epic's pass anchor is absent or not later than the override's
`at`; otherwise the baseline is 0. With no `maxFailedRounds` the signal never trips.

#### Scenario: The limit is reached

- **WHEN** E resolves `maxFailedRounds 2` and its rounds count reaches 2
- **THEN** the rounds signal is tripped

#### Scenario: A pass after an override spends the override

- **WHEN** a rounds override was recorded at baseline 3, then a `pass` was recorded, then 3 fails follow under limit 3
- **THEN** the override is not live, the baseline is 0, and the signal is tripped

#### Scenario: Fails after the pass on the same gate do not revive the override

- **WHEN** E resolves `maxFailedRounds 2`, a rounds override was recorded at baseline 2, then gate 1 records `pass`, then gate 1 records `fail` twice
- **THEN** `gate1.lastPassAt` is later than the override's `at`, so the override is not live and the baseline is 0
- **AND** the rounds count is 2 and the signal is tripped

#### Scenario: No limit means no trip

- **WHEN** no layer sets `maxFailedRounds` and E's rounds count is 9
- **THEN** the rounds signal is not tripped, and `spend-guard E` reports the count with `limit: none`

### Requirement: The token signal compares attributed spend with the ceiling

When `tokenCeiling` resolves and tracking is on, the token signal SHALL compare the epic's attributed
total, minus the latest live `tokens` override's baseline, with the ceiling. The total is the same one
`spend` reports. At or above `warnAt` percent it SHALL be WARN, and at or above the ceiling it SHALL be
tripped. Unattributed spend is never counted, and the report SHALL print the coverage share.

#### Scenario: Below the warning share

- **WHEN** E's ceiling is 1,000,000, `warnAt` is 80, and its attributed total is 700,000
- **THEN** the token signal is OK

#### Scenario: Past the warning share

- **WHEN** E's attributed total is 850,000 under the same limits
- **THEN** the token signal is WARN, and `spend-guard E` still exits 0

#### Scenario: At the ceiling

- **WHEN** E's attributed total is 1,000,000 under the same limits
- **THEN** the token signal is tripped

#### Scenario: Unattributed spend is shown, not charged

- **WHEN** 40% of the tokens in the ledger are unattributed
- **THEN** `spend-guard E` prints the coverage share next to the token signal
- **AND** the unattributed tokens are not added to E's total

### Requirement: With tracking off, the token ceiling is not checked and every surface says so

While spend tracking is off, the token signal SHALL be `not-checked`, never OK and never tripped.
`spend-guard` SHALL then read no ledger or transcript file. Its report SHALL say the ceiling was not
checked because tracking is off. `set-spend-guard --tokens` SHALL record the value and print the same
warning.

#### Scenario: A ceiling with tracking off

- **WHEN** E resolves `tokenCeiling 1000000` and spend tracking is off
- **THEN** `spend-guard E` reports `tokens: not checked — spend tracking is off; the guard is counting rounds only`
- **AND** no path under the spend directory or the transcript directory is opened

#### Scenario: Setting a ceiling while tracking is off warns

- **WHEN** `set-spend-guard --tokens 1000000` runs with tracking off
- **THEN** the value is recorded
- **AND** the output says it will not be checked until `set-spend-tracking on`

### Requirement: spend-guard reports the guard state and exits non-zero while the epic is stuck

`spend-guard <epicId> [--json] [--no-ingest]` SHALL print each signal with its count, its limit, the
layer each limit came from, and the live overrides. It SHALL exit 0 when no signal is tripped and exit
2 when any signal is tripped, after printing the STOP block. With tracking on it SHALL ingest first,
as `spend` does, unless `--no-ingest` is given. It writes nothing to `state.json`.

#### Scenario: A healthy epic

- **WHEN** no signal is tripped for E
- **THEN** `spend-guard E` exits 0 and prints each signal's count and limit

#### Scenario: A stuck epic

- **WHEN** E's rounds signal is tripped
- **THEN** `spend-guard E` prints the STOP block and exits 2

#### Scenario: The JSON form

- **WHEN** `spend-guard E --json` runs
- **THEN** stdout is one JSON object holding `epic`, `stuck` (boolean), and `signals.rounds` and `signals.tokens`, each with `state`, `count`, `limit`, `source` and `baseline`, plus `overrides`, `escalation` and `tracking`
- **AND** the exit code follows the same rule as the text form

#### Scenario: An unknown epic is refused

- **WHEN** `spend-guard missing` runs
- **THEN** it exits 1 naming the id, and reads no ledger file

#### Scenario: From a linked worktree, guard state is local and the ledger is the main tree's

- **WHEN** `spend-guard E` runs inside a linked worktree
- **THEN** it resolves limits, tallies and overrides from the `state.json` of the tree it runs in, the same file `record-gate-review`, `set-spend-guard` and `override-spend-guard` write there
- **AND** it takes the tracking switch and the ledger from the main working tree, as `spend` does

### Requirement: When ingest cannot run, spend-guard reads the existing ledger and says it may be stale

When tracking is on but ingest does not run, `spend-guard` SHALL read the ledger as it stands, as
`spend` does (`spend-command.mjs`: a held `ingest.lock` or a detached main HEAD reports from the
existing ledger). This covers a held `ingest.lock`, a detached main HEAD and `--no-ingest`. The ledger
side and the token signal SHALL be computed from that ledger and MAY trip. The report SHALL say the
ledger was not refreshed, give the reason, and say the counts may be stale.

#### Scenario: An ingest lock is held and the ledger alone trips

- **WHEN** another ingest holds `ingest.lock`, E has no recorded verdict, E resolves `maxFailedRounds 2`, and the existing ledger holds E's `phase=review` rows with rounds 1 to 3
- **THEN** `spend-guard E` reports the ledger side as 2 with a note that it did not ingest because an ingest was already in progress, and that counts may be stale
- **AND** it prints the STOP block and exits 2

#### Scenario: A detached main HEAD

- **WHEN** tracking is on and the main working tree's HEAD is detached
- **THEN** `spend-guard E` reads the existing ledger, computes both signals from it, and says it did not ingest because HEAD is detached

### Requirement: When the ledger truly cannot be read, spend-guard still applies the recorded-verdict check

`spend-guard` SHALL report the ledger side and the token signal `not-read` with the reason, still
compute the rounds signal from recorded verdicts, and exit by the 0/2 rule, never 1, when:

- tracking is on and `state.spendTracking.enabledAt` is unreadable
- from a linked worktree, the main tree's `state.json` is absent or unreadable (tracking `unknown`)
- the ledger read itself fails

The main-tree read SHALL NOT refuse. In the main tree, its own unreadable `state.json` still exits 11, the engine-wide code for an unreadable record (exit 1 means wrong arguments).

#### Scenario: The main tree's record is unreadable from a linked worktree

- **WHEN** `spend-guard E` runs in a linked worktree whose main tree's `state.json` is unreadable, and E's `gate1.failStreak` is at its limit
- **THEN** it reports tracking as unknown, never as off, and the ledger side and token signal `not-read`, naming the main tree's `state.json`
- **AND** `--json` gives `tracking: "unknown"`
- **AND** it prints the STOP block and exits 2, not 1

#### Scenario: An unreadable enabledAt

- **WHEN** tracking is on, `state.spendTracking.enabledAt` is unreadable, and E's recorded streak is below its limit
- **THEN** `spend-guard E` reports the token signal `not-read` naming the remedy `set-spend-tracking off` then `on`, and exits 0

### Requirement: The STOP block names the escalation target and the next command

The STOP block SHALL name the epic and every tripped signal with its count and limit. It SHALL tell
the agent to stop dispatching same-tier retries for the epic, to hand the failure evidence to the
escalation target, and to record the decision with `override-spend-guard`. A STOP SHALL be stated as a
stop that epic-level autonomy does not bypass.

#### Scenario: The block is actionable

- **WHEN** the STOP block is printed for E's rounds signal at 3 of 3
- **THEN** it names E, `rounds 3/3`, the escalation target, and the literal `override-spend-guard E --signal rounds --escalated-to <target> --reason "<why>"`
- **AND** it asks the target "what is wrong and how do we resolve it", with the last failing findings or tests, the verdicts and the diff

#### Scenario: Autonomy does not bypass it

- **WHEN** E has `autonomy.level: autonomous`
- **THEN** the STOP block still says to stop and escalate, and that autonomy does not cover continuing past it

### Requirement: The escalation target is one model tier above the role that failed, else the user

The target SHALL be the next model above the resolved model of the role tied to the signal: `review`
for rounds, `implement` for tokens, in the order `haiku < sonnet < opus < fable`. The resolved model
counts whatever its source layer, `default` included, and the block names the source. The target
SHALL be `user` only when that model is `fable` or is not in the ladder (or absent). The user always
stays a valid target.

#### Scenario: Sonnet escalates to Opus

- **WHEN** E's `review` role resolves `sonnet:medium` and the rounds signal trips
- **THEN** the escalation target is `opus`, and the block says `or the user`

#### Scenario: Fable escalates to the user

- **WHEN** E's `review` role resolves `fable:high`
- **THEN** the escalation target is `user`

#### Scenario: A default-sourced model escalates like a configured one

- **WHEN** no layer sets a `review` model, so it resolves `opus (high) (default)`
- **THEN** the escalation target is `fable`, and the block names the review model as `opus (default)`

#### Scenario: A model outside the ladder escalates to the user

- **WHEN** the resolver returns no `review` model, or one that is not in `haiku < sonnet < opus < fable`
- **THEN** the escalation target is `user`, and the block says there was no ranked model to step up from

### Requirement: A failed verdict is always recorded, then the STOP is printed

`record-gate-review` SHALL never refuse a verdict because a guard is tripped. When an accepted verdict
leaves the epic's rounds signal tripped, the same invocation SHALL write the STOP block to stderr after
the success line. It SHALL exit 0, because the write succeeded. That check reads `state.json` only,
never the ledger.

#### Scenario: The fail that reaches the limit

- **WHEN** E resolves `maxFailedRounds 2`, `gate1.failStreak` is 1, and a gate 1 `fail` is recorded
- **THEN** the verdict and the tally are written, the STOP block is on stderr, and the exit code is 0

#### Scenario: A pass clears the recorded part

- **WHEN** E is tripped only through `gate1.failStreak`, and a gate 1 `pass` is recorded
- **THEN** no STOP block is printed

#### Scenario: The verdict path reads no ledger

- **WHEN** tracking is on and `record-gate-review` runs
- **THEN** no ledger or transcript file is opened

### Requirement: The brief carries one STOP line for a stuck active epic, computed from state alone

When a stuck active epic exists, the SessionStart and PreCompact brief SHALL carry one line naming it,
its recorded rounds count and its limit, and pointing to `spend-guard <id>`. The line uses only the
recorded verdicts and live overrides in `state.json`, and sits in the part of the brief the byte cap
never cuts. When no limit is configured (see the opt-in requirement), the brief SHALL carry no guard
text.

#### Scenario: A stuck active epic

- **WHEN** the active epic E resolves `maxFailedRounds 2` and `gate2.failStreak` is 2
- **THEN** the brief contains one line beginning `STOP: spend guard —` that names E and `spend-guard E`

#### Scenario: The brief never reads the ledger

- **WHEN** tracking is on and the SessionStart hook runs
- **THEN** no ledger or transcript file is opened, whatever the guard configuration

#### Scenario: No limits configured

- **WHEN** no limit is configured and the active epic has `gate1.failStreak` 5
- **THEN** the guard's brief contribution is an empty list of lines, and no brief line contains `spend guard`

#### Scenario: The STOP line survives the byte cap

- **WHEN** the brief exceeds its byte cap and the active epic is stuck
- **THEN** the fitted brief still contains the `STOP: spend guard —` line

### Requirement: The rules block carries a Spend guard section only while a limit is configured

While a limit is configured (opt-in requirement), the rules block SHALL carry a `## Spend guard`
section after the `## Spend tracking` slot, telling the agent to:

- run `spend-guard <epic>` before every review or fix dispatch
- treat exit 2 as a STOP autonomy does not bypass, and escalate
- record the decision with `override-spend-guard`, which no autonomy grant covers
- mark review dispatches `phase=review round=<n>`

With no limit, there is no such section.

#### Scenario: A configured limit adds the section

- **WHEN** `set-spend-guard --max-failed-rounds 2` runs
- **THEN** the managed `CLAUDE.md` rules block contains `## Spend guard` with the literal `spend-guard <epic>` command
- **AND** the section follows `## Spend tracking` when tracking is on, and takes that position when it is off

#### Scenario: Unsetting the last limit removes it

- **WHEN** the only configured limit is unset
- **THEN** the rules block contains no `## Spend guard` section

#### Scenario: A warnAt alone is not a limit

- **WHEN** the only guard field set anywhere is `warnAt`
- **THEN** the rules block contains no `## Spend guard` section

### Requirement: An override records the escalation and re-arms the guard from the current count

`override-spend-guard <epicId> --signal rounds|tokens --escalated-to user|<model> --reason "<why>"` SHALL
append `{signal, baseline, escalatedTo, reason, at}` to `epic.spendGuardOverrides`. `<model>` comes from
the known model list and SHALL rank at or above the computed escalation target; when the target is
`user`, or a live model override exists for that signal, only `user` is accepted. `baseline` is the
current count. It is refused, writing nothing, unless that signal is tripped now.

#### Scenario: Overriding a tripped rounds signal

- **WHEN** E's rounds count is 3 with limit 3, and `override-spend-guard E --signal rounds --escalated-to opus --reason "opus diagnosed the fixture"` runs
- **THEN** an override with `baseline: 3` and `escalatedTo: "opus"` is recorded
- **AND** the signal is not tripped again until the rounds count reaches 6

#### Scenario: The model that failed cannot override itself

- **WHEN** E's review role resolves `sonnet:medium`, the rounds signal is tripped, and `--escalated-to sonnet` is given
- **THEN** the command exits non-zero naming `opus` as the lowest accepted model, and writes nothing

#### Scenario: A second model override must go to the user

- **WHEN** a live rounds override with `escalatedTo: "opus"` exists, the signal trips again, and `--escalated-to fable` is given
- **THEN** the command exits non-zero saying the next escalation is the user's, and writes nothing

#### Scenario: An override cannot pre-authorize

- **WHEN** E's rounds signal is not tripped and `override-spend-guard E --signal rounds …` runs
- **THEN** it exits non-zero saying there is nothing to override, and writes nothing

#### Scenario: A tokens override needs the ledger

- **WHEN** spend tracking is off and `override-spend-guard E --signal tokens …` runs
- **THEN** it exits non-zero saying the token signal is not checked while tracking is off, and writes nothing

#### Scenario: Required fields

- **WHEN** `--reason` is missing or blank, `--escalated-to` is missing or not `user` or a known model, or `--signal` is missing or unknown
- **THEN** the command exits non-zero naming what is missing, and writes nothing

### Requirement: An override is revoked by a recorded revoke, never by deletion

`override-spend-guard <epicId> --signal <s> --revoke --reason "<why>"` SHALL mark the latest unrevoked
override for that signal with `revokedAt` and `revokeReason`. The entry SHALL stay in the record.
The baseline then falls back to the previous unrevoked override for that signal, or to 0.
`--escalated-to` SHALL be refused alongside `--revoke`. A revoke with no live override exits non-zero.

#### Scenario: Revoking re-arms the guard at once

- **WHEN** E's rounds count is 3 with limit 3, one live rounds override at baseline 3 exists, and it is revoked
- **THEN** the override carries `revokedAt` and `revokeReason`, and stays in `spendGuardOverrides`
- **AND** `spend-guard E` exits 2

#### Scenario: Nothing to revoke

- **WHEN** E has no live tokens override and `override-spend-guard E --signal tokens --revoke --reason x` runs
- **THEN** it exits non-zero naming the signal, and writes nothing

### Requirement: The guard adds no work to a hook path beyond what is already loaded

No hook SHALL read a ledger or transcript file on the guard's behalf. The PreToolUse hook SHALL do no
guard work. The brief's guard work SHALL be a pure function of the `state.json` it already loads.

#### Scenario: A repo with no limits pays nothing

- **WHEN** no limit is configured and the SessionStart, PreCompact and PreToolUse hooks run
- **THEN** no path under the spend directory or the transcript directory is opened or stat'ed
- **AND** the PreToolUse hook output carries no guard text

### Requirement: The guard is an opt-in listed by upgrade

The `OPT_INS` registry SHALL carry a `spendGuard` row. It names `set-spend-guard` and
`commands/set-spend-guard.md`. A limit is configured when `maxFailedRounds` or `tokenCeiling` is set
at the project, at any lane, or on any epic that is not archived; the row is set exactly then. `init`
and `upgrade` SHALL NOT set a limit. All new state fields are additive and optional, so a state file
written by 0.51.0 loads unchanged with no migration.

#### Scenario: A repo without a limit is told about it

- **WHEN** `upgrade` runs in a repo with no guard field set
- **THEN** its opt-in lines include `NOT SET: spendGuard` with `set-spend-guard --max-failed-rounds <n>` as the remedy

#### Scenario: An older state file loads

- **WHEN** a state file written by 0.51.0 is loaded
- **THEN** every epic reads zero rounds and no limit, and nothing is rewritten
