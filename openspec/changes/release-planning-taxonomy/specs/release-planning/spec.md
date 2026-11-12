## ADDED Requirements

### Requirement: A release names its primary initiative or declares maintenance

`release <id> --initiative <initiativeId>` SHALL record the release's ONE primary initiative; `--maintenance` (valueless)
SHALL record that it serves none. Setting either SHALL replace the other; both in one invocation SHALL be refused. The
valueless `--clear-initiative` SHALL remove either. `release here` SHALL accept none of these flags.

#### Scenario: Set, switch and clear

- **WHEN** `release r1 --initiative boards` runs, then `release r1 --maintenance`, then `release r1 --clear-initiative`
- **THEN** `board --json` reports r1 as `{initiative: "boards", maintenance: false}`, then `{initiative: null, maintenance: true}`, then `{initiative: null, maintenance: false}`

#### Scenario: Both at once

- **WHEN** `release r1 --initiative boards --maintenance` runs
- **THEN** it is refused naming the two as exclusive, and nothing is written

#### Scenario: The plan marker takes none

- **WHEN** `release here r1 --initiative boards` runs
- **THEN** it is refused naming `--text`, `--next` and `--clear-here`, and nothing is written

### Requirement: The release goal is its theme

A release's goal SHALL be its existing `theme`: no `--goal` flag and no second goal field SHALL exist. The release plan board
and `release show <id>` SHALL label the theme "Goal"; the JSON key stays `theme`.

#### Scenario: No goal flag

- **WHEN** `release r1 --goal "x"` runs
- **THEN** it is refused as an unknown flag and nothing is written

#### Scenario: Labelled Goal

- **WHEN** r1 has theme "Lock the API" and `release show r1` runs
- **THEN** the output reads `goal: Lock the API`

### Requirement: Each release reports its 80/20 split

Each release SHALL report its members' split by epic count: `initiativeWork`, `health` and `unclassified` (no `kind`).
`healthShare` SHALL be `health / (health + initiativeWork)`, or `null` when that sum is 0. `target` SHALL be the fixed
`0.2`. The split is derived on every read and never stored.

#### Scenario: Counting by kind

- **WHEN** r1's members are 8 `initiative-work`, 2 `health` and 1 with no kind
- **THEN** r1's split is `{initiativeWork: 8, health: 2, unclassified: 1, healthShare: 0.2, target: 0.2}`

#### Scenario: Nothing classified

- **WHEN** every member of r1 has no kind
- **THEN** `healthShare` is `null` and `drift` is `null`

### Requirement: Split drift is flagged

`drift` SHALL be `true` when `healthShare` lies outside a fixed tolerance band, the constant `HEALTH_DRIFT_TOLERANCE`,
around the target, `false` inside it, and `null` when `healthShare` is `null`. The tolerance SHALL be one engine constant,
not a setting.

#### Scenario: No health at all drifts

- **WHEN** r1 has 10 `initiative-work` members and 0 `health`
- **THEN** r1's `drift` is `true`

#### Scenario: Exactly 80/20 does not drift

- **WHEN** r1 has 8 `initiative-work` members and 2 `health`
- **THEN** r1's `drift` is `false`

### Requirement: An override is a recorded reason, never a switch

`release <id> --split-reason "<line>"` (one line, at most 400 characters) SHALL record why the release departs from 80/20,
and the valueless `--clear-split-reason` SHALL remove it. A recorded reason SHALL NOT change `drift` or hide the split. No
verb, flag or setting SHALL turn the report off or change the target.

#### Scenario: Reason shown beside the drift

- **WHEN** r1 drifts and `release r1 --split-reason "platform migration: 80% migration, 20% critical fixes"` runs
- **THEN** `board --json` reports r1's `drift: true` and `reason` equal to that text

### Requirement: release show prints the purpose and the split

`release show <id>` SHALL print `initiative: <id> (<title>)` or `initiative: maintenance` when either is recorded, and one
split line `split: N initiative work, N health, N unclassified; health X% (target 20%)`, ending `, DRIFT` when `drift` is
true and adding the recorded reason. `release show` with no id SHALL append the primary initiative id or `maintenance`.

#### Scenario: Drift is said

- **WHEN** r1 names initiative boards, has 10 `initiative-work` members and no reason recorded
- **THEN** `release show r1` prints `initiative: boards` and a split line ending `, DRIFT`

### Requirement: board --json carries the release purpose and split

Each `board --json` release entry SHALL carry `initiative` (an id or `null`), `maintenance` (a boolean), `splitReason` and
`split: {initiativeWork, health, unclassified, healthShare, target, drift, reason}`. These keys are additive, so
`schemaVersion` SHALL stay 1.

#### Scenario: A release with nothing recorded

- **WHEN** `board --json` runs over a release with no members and no purpose
- **THEN** its entry has `initiative: null`, `maintenance: false`, `splitReason: null` and `split` with zero counts, `healthShare: null` and `drift: null`

### Requirement: The release plan board shows each release's purpose and split

Each release card on the release plan SHALL show its primary initiative's title (or "Maintenance"), its Goal and its split,
marking drift and showing the recorded reason beside it; a release with neither purpose SHALL render a guided empty state
naming `release <id> --initiative <id>` and `--maintenance`. Every value SHALL be escaped.

#### Scenario: Maintenance release

- **WHEN** r1 is a maintenance release
- **THEN** its card reads "Maintenance" and renders no guided empty state for the initiative

#### Scenario: Hostile split reason

- **WHEN** r1's split reason is `<b onmouseover=alert(1)>x`
- **THEN** the card shows the escaped text and no `<b` element
