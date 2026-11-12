## ADDED Requirements

### Requirement: An epic names one primary initiative and optional secondaries

`--initiative <id>` on `add-epic`, `update-epic` and `add-many` (key `initiative`) SHALL record the epic's ONE primary
initiative; `update-epic <id> --clear initiative` removes it. `--secondary-initiative <id>` (repeatable; key
`secondaryInitiatives`) SHALL append, ignoring a repeat; `update-epic --remove-secondary-initiative <id>` is its inverse.
A secondary equal to the primary SHALL be refused.

#### Scenario: Primary and secondaries

- **WHEN** `update-epic E --initiative boards --secondary-initiative reporting` runs
- **THEN** `board --json` reports E's `initiative: "boards"` and `secondaryInitiatives: ["reporting"]`

#### Scenario: Secondary equal to primary

- **WHEN** `update-epic E --initiative boards --secondary-initiative boards` runs
- **THEN** it is refused naming the primary, and nothing is written

#### Scenario: Removing a secondary

- **WHEN** `update-epic E --remove-secondary-initiative reporting` runs on E above
- **THEN** E's `secondaryInitiatives` is `[]` and its primary is unchanged

### Requirement: An epic records when it joined its initiative

Setting an epic's primary initiative to a new value SHALL record `initiativeJoinedAt`, the time of that write; re-setting the
same value SHALL keep it, and `--clear initiative` SHALL remove both. An epic that named an initiative before this field
existed cannot exist, so no backfill is needed.

#### Scenario: Join time follows the primary

- **WHEN** `update-epic E --initiative boards` runs, again with `boards`, and later with `reporting`
- **THEN** `initiativeJoinedAt` is the first run's time after the second run and the third run's time after the third

### Requirement: An epic carries a kind

`--kind initiative-work|health` on `add-epic`, `update-epic` and `add-many` SHALL record the epic's kind; `update-epic <id>
--clear kind` removes it. Health is bugs, security fixes, dependency and stack upgrades, deprecation work, and test and
tooling debt, never new internal capability; `commands/epic.md` SHALL say so. Nothing backfills a missing kind.

#### Scenario: Bad kind refused

- **WHEN** `update-epic E --kind feature` runs
- **THEN** it is refused naming `initiative-work|health` and nothing is written

#### Scenario: Existing epics keep no kind

- **WHEN** a 0.55.0 state file is loaded and `board --json` runs
- **THEN** every epic's recorded `kind` is `null`, and the state file is unchanged by the load

### Requirement: Challenge answers are recorded reasons

`--off-mission-reason "<line>"` and `--off-initiative-reason "<line>"` (each one line, at most 300 characters) on
`add-epic`, `update-epic` and `add-many` SHALL record the stated reason the epic is off the mission or off its release's
initiative. Each SHALL be removable with `update-epic <id> --clear <field>`. An empty or multi-line value SHALL be refused.

#### Scenario: Record and clear

- **WHEN** `update-epic E --off-initiative-reason "security fix the release cannot wait for"` runs, and then `update-epic E --clear off-initiative-reason`
- **THEN** after the first `board --json` reports that reason for E; after the second it reports `null`

### Requirement: Leaving untriaged without planning fields warns once

When at least one initiative is `open`, an epic outside the `claude-code` lane that leaves `untriaged` or is registered into a
live status SHALL get one stderr warning, exit 0, naming what it lacks: a `kind`, or (unless `kind` is `health`) an
`initiative` or an off-initiative reason. A write leaving the status unchanged SHALL NOT warn.

#### Scenario: Warned on triage

- **WHEN** an initiative is open and `update-epic E --status queued` moves E (lane `superpowers`, no kind, no initiative) out of `untriaged`
- **THEN** stderr names `--kind` and `--initiative`, the exit code is 0, and the status write lands

#### Scenario: A recorded reason silences it

- **WHEN** E has kind `initiative-work`, no initiative and an `offInitiativeReason`, and leaves `untriaged`
- **THEN** no planning warning is printed

#### Scenario: Exempt lane and no initiatives

- **WHEN** a `claude-code`-lane epic leaves `untriaged`, or any epic does while no initiative is open
- **THEN** no planning warning is printed

### Requirement: Adding an epic to a release it does not serve warns

`release <id> --member <epic>` SHALL print one stderr warning, still writing the membership, when the release names a primary
initiative that the epic names neither as primary nor secondary, and the epic is outside the `claude-code` lane, not `health`,
and has no off-initiative reason. A maintenance release, or one with no primary, SHALL NOT warn.

#### Scenario: Off-initiative member

- **WHEN** r1 names initiative boards and `release r1 --member E` runs for E (kind `initiative-work`, initiative `reporting`)
- **THEN** stderr names r1's initiative and `--off-initiative-reason`, and E is a member of r1

#### Scenario: Maintenance release

- **WHEN** r1 is a maintenance release and `release r1 --member E` runs
- **THEN** no planning warning is printed

### Requirement: board --json carries the epic planning fields

Each `board --json` epic entry SHALL carry `initiative`, `initiativeJoinedAt`, `secondaryInitiatives` (`[]` when none),
`kind` (as recorded), `effectiveKind`, `releaseJoinedAt`, `offMissionReason` and `offInitiativeReason`, each `null` when
absent. A reference naming no initiative SHALL read as `null`. These keys are additive, so `schemaVersion` SHALL stay 1.

#### Scenario: Unset fields

- **WHEN** `board --json` runs over a `superpowers` epic with none of these fields
- **THEN** its entry has `initiative: null`, `secondaryInitiatives: []`, `kind: null`, `effectiveKind: null`, both join times `null` and both reasons `null`
