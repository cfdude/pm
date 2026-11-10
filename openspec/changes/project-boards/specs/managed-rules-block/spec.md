## ADDED Requirements

### Requirement: The boards pointer line follows the boards switch

While boards are on, the managed block SHALL carry one line, of at most 240 bytes, naming the `project-boards` skill
and `/pm:boards`, and telling the agent to refresh the boards after `/pm:sync`, a status change, a `release` or
`mission` write, or a gate record. While boards are off, the line SHALL be absent. The line SHALL NOT restate the
refresh procedure, which lives in the skill. Every command span in it SHALL pass the "runnable as written" check.

#### Scenario: Line present by default

- **WHEN** the block is written for a fresh repo
- **THEN** it contains exactly one line naming `project-boards` and `/pm:boards`, and that line is at most 240 bytes

#### Scenario: Line absent when off

- **WHEN** `set-boards off` has run and the block is written
- **THEN** no line names `project-boards`

#### Scenario: The boards line is not a conditional section

- **WHEN** `set-boards off` or `set-boards on` changes the setting
- **THEN** that verb rewrites the block itself, as the tracker verbs do, and the declared set of four conditional headings is unchanged

#### Scenario: Command spans run as written

- **WHEN** the emitted-invocations check runs over the block with boards on
- **THEN** every code span in the boards line passes

### Requirement: The mission line follows the recorded mission

While a current mission exists, the managed block SHALL carry one line, of at most 240 bytes, stating the mission
(truncated with an ellipsis) and the mission milestone release, or `none`. With no current mission, the line SHALL be
absent. The `mission` verb SHALL rewrite the block itself when the line's text changes. The line is not a conditional
section.

#### Scenario: Mission line present and bounded

- **WHEN** a 300-character mission statement is recorded with milestone r2, and the block is written
- **THEN** the block holds exactly one mission line, at most 240 bytes, ending its statement in an ellipsis and naming `r2`

#### Scenario: Mission line absent after end

- **WHEN** `mission --end --reason "x"` runs
- **THEN** the block on disk carries no mission line
