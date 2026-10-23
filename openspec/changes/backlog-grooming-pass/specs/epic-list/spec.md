## ADDED Requirements

### Requirement: A list row reports release, createdAt and description

Each epic `list` reports SHALL carry `release`, `createdAt` and `description` besides its existing
fields. An absent or non-string value SHALL report `null`, and the engine SHALL NOT infer one. The
`--json` shape `{count, epics}` and the text form SHALL be unchanged, and no `--release` or
`--priority` flag SHALL be added.

#### Scenario: A registered epic reports its three new fields

- **WHEN** epic E has `release: "0.54.0"`, `createdAt: "2026-09-08T17:55:42-07:00"` and a description, and `list --json` runs
- **THEN** E's row carries those three values
- **AND** the output is still `{count, epics}`

#### Scenario: An epic without a clock reports null

- **WHEN** epic E has no `createdAt` and `list --json` runs
- **THEN** E's row has `createdAt: null`
- **AND** no date is computed for it

#### Scenario: An epic in no release reports null

- **WHEN** epic E has no `release` and no description and `list --json` runs
- **THEN** E's row has `release: null` and `description: null`

#### Scenario: A non-string value reports null

- **WHEN** an epic's `createdAt` holds a number
- **THEN** its row reports `createdAt: null`

#### Scenario: Existing filters and fields are unchanged

- **WHEN** `list --status queued --lane openspec --json` runs on a record whose epics have the new fields
- **THEN** the same epics match as before this change
- **AND** each row's `id`, `title`, `status`, `lane`, `priority` and `links` are as before

#### Scenario: The text form is unchanged

- **WHEN** `list` runs without `--json`
- **THEN** each line is `id status lane priority title`, with none of the three new fields

#### Scenario: No server-side filter flag for the new fields

- **WHEN** `list --release 0.54.0` or `list --priority P1` runs
- **THEN** it is refused as an unknown flag and nothing is listed
