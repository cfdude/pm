## ADDED Requirements

### Requirement: The boards section follows the boards switch

While boards are on, the managed block SHALL carry a `## Boards` section, at most 280 bytes including its heading.
It SHALL name the `project-boards` skill and `/pm:boards`, and tell the agent to refresh the boards after `/pm:sync`,
a status change, a `release` or `mission` write, or a gate record. While boards are off, the section SHALL be absent.
It SHALL NOT restate the refresh procedure. Every command span in it SHALL pass the "runnable as written" check.

#### Scenario: Section present by default

- **WHEN** the block is written for a fresh repo
- **THEN** it contains one `## Boards` section naming `project-boards` and `/pm:boards`, at most 280 bytes

#### Scenario: Section absent when off

- **WHEN** `set-boards off` has run and the block is written
- **THEN** no `## Boards` heading and no line naming `project-boards` is present

#### Scenario: Command spans run as written

- **WHEN** the emitted-invocations check runs over the block with boards on
- **THEN** every code span in the `## Boards` section passes

### Requirement: The boards and mission sections are verb-refreshed, outside the conditional set

`## Boards` and `## Mission` SHALL NOT be members of the declared conditional-section set. Like the tracker sections,
the verbs that change them (`set-boards`, and `mission` when the section's text changes) SHALL rewrite the block
themselves. The overhead map SHALL assign `rules:boards` to the feature `boards` and `rules:mission` to `core`.

#### Scenario: The conditional set is unchanged

- **WHEN** `set-boards off` or `set-boards on` changes the setting
- **THEN** that verb rewrites the block itself, and the declared set still holds exactly the four existing headings

#### Scenario: Overhead attributes the sections

- **WHEN** `overhead` runs with boards on and a mission recorded
- **THEN** it reports `rules:boards` under `boards` and `rules:mission` under `core`

### Requirement: The mission section follows the recorded mission

While a current mission exists, the managed block SHALL carry a `## Mission` section, at most 280 bytes including its
heading. It SHALL state the mission, truncated with an ellipsis, and the mission milestone release, or `none`. With no
current mission, the section SHALL be absent.

#### Scenario: Mission section present and bounded

- **WHEN** a 300-character mission statement is recorded with milestone r2, and the block is written
- **THEN** the block holds one `## Mission` section, at most 280 bytes, ending its statement in an ellipsis and naming `r2`

#### Scenario: Mission section absent after end

- **WHEN** `mission --end --reason "x"` runs
- **THEN** the block on disk carries no `## Mission` section
