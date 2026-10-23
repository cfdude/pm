## ADDED Requirements

### Requirement: A list row reports release, createdAt, description and outcome

Each epic `list` reports SHALL carry `release`, `createdAt`, `description` and `outcome` (the recorded
disposition outcome) besides its existing fields. An absent or non-string value SHALL report `null`
(an empty-string `description` reports `""`), and the engine SHALL NOT infer one. The
`--json` shape `{count, epics}` and the text form SHALL be unchanged, and no `--release` or
`--priority` flag SHALL be added.

#### Scenario: A registered epic reports its new fields

- **WHEN** epic E has `release: "0.54.0"`, `createdAt: "2026-09-08T17:55:42-07:00"` and a description, and `list --json` runs
- **THEN** E's row carries those values
- **AND** the output is still `{count, epics}`

#### Scenario: An epic without a clock reports null

- **WHEN** epic E has no `createdAt` and `list --json` runs
- **THEN** E's row has `createdAt: null`
- **AND** no date is computed for it

#### Scenario: An epic in no release reports null

- **WHEN** epic E has no `release` and no description and `list --json` runs
- **THEN** E's row has `release: null` and `description: null`

#### Scenario: An archived epic reports its outcome

- **WHEN** epic E ended with `--outcome delivered` and `list --status archived --json` runs
- **THEN** E's row has `outcome: "delivered"`
- **AND** an epic with no recorded disposition reports `outcome: null`

#### Scenario: An empty description reports an empty string

- **WHEN** epic E's `description` is `""` and `list --json` runs
- **THEN** E's row has `description: ""`

#### Scenario: A non-string value reports null

- **WHEN** an epic's `createdAt` holds a number
- **THEN** its row reports `createdAt: null`

#### Scenario: Existing filters and fields are unchanged

- **WHEN** `list --status queued --lane openspec --json` runs on a record whose epics have the new fields
- **THEN** the same epics match as before this change
- **AND** each row's `id`, `title`, `status`, `lane`, `priority` and `links` are as before

#### Scenario: The text form is unchanged

- **WHEN** `list` runs without `--json`
- **THEN** each line is `id status lane priority title`, with none of the four new fields

#### Scenario: No server-side filter flag for the new fields

- **WHEN** `list --release 0.54.0` or `list --priority P1` runs
- **THEN** it is refused as an unknown flag and nothing is listed
- **AND** no registry row is added for either flag (regression guard: both are already unknown)
