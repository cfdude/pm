## ADDED Requirements

### Requirement: An invalid marker is reported with the rejected value and the accepted set

`spend` SHALL report each distinct `(field, value)` that made a stored marker invalid: the first
failing field in the order `role`, `phase`, `round`, the rejected value, the accepted set read from
the constant the check uses (`positive integer` for `round`), the agent count and those agents' totals. Validation SHALL stay strict.

#### Scenario: A rejected phase is named with the accepted set

- **WHEN** a sub-agent's stored marker is `pm-spend: epic=e1 role=review phase=gate-1`
- **AND** `spend --no-ingest` runs
- **THEN** the text report contains `invalid pm-spend marker: phase "gate-1" is not one of plan|build|review|docs|release`
- **AND** that line names the agent count and the tokens

#### Scenario: The JSON form lists the invalid markers

- **WHEN** `spend --json --no-ingest` runs over the same ledger
- **THEN** `unattributed.invalidMarkers` is an array whose entry holds `field: "phase"`, `value: "gate-1"`,
  `accepted` equal to `KNOWN_SPEND_PHASES`, `agents: 1` and a `totals` object

#### Scenario: Two dispatches with the same wrong value are one entry

- **WHEN** two sub-agents carry `phase=spec` with valid roles
- **THEN** `unattributed.invalidMarkers` holds one entry for `phase` / `spec` with `agents: 2`

#### Scenario: A rejected role names the job-role list

- **WHEN** a stored marker carries `role=architect phase=plan`
- **THEN** the entry's field is `role`, its value is `architect`, and its accepted set equals `KNOWN_JOB_ROLES`

#### Scenario: No alias is accepted

- **WHEN** a stored marker carries `phase=spec`
- **THEN** its rows stay unattributed with reason `invalid-marker`
- **AND** no row is attributed with `phase=plan`

#### Scenario: A clean ledger prints no invalid-marker list

- **WHEN** no row is unattributed with reason `invalid-marker`
- **THEN** the text report prints no `invalid pm-spend marker` line
- **AND** `unattributed.invalidMarkers` is an empty array

#### Scenario: A marker value is printed inert

- **WHEN** a stored marker's phase value holds a control character
- **THEN** the printed line carries it escaped, never raw
