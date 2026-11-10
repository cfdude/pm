## ADDED Requirements

### Requirement: Boards are a default-on switch

The boards feature SHALL have an `OPT_INS` row with the id `boards`, the verb `set-boards on|off` and the command doc
`commands/boards.md`. An absent setting SHALL read as on, and `init` SHALL NOT write the setting. `set-boards off`
and `set-boards on` SHALL be each other's inverse, and each SHALL be idempotent. Off SHALL remove the boards rules-block
line and the boards brief line. The README cost table SHALL carry a row for each boards surface.

#### Scenario: Default on

- **WHEN** a repo upgrades from 0.54.0 with no boards setting
- **THEN** the rules block and the brief each carry the boards line, `state.json` gains no boards field, and `upgrade` lists `boards: on (default)` with `set-boards off`

#### Scenario: Off removes both surfaces and is undone by on

- **WHEN** `set-boards off` runs, and then `set-boards on` runs
- **THEN** after the first, `overhead` reports 0 bytes for `boards` and neither line is on disk; after the second, both lines are back

### Requirement: The export works whatever the switch

`board --json` SHALL keep working while boards are off, because it is a read.

#### Scenario: Export unaffected by the switch

- **WHEN** boards are off and `board --json` runs
- **THEN** it prints the snapshot and exits 0

### Requirement: Upgrade announces default-on boards once

When `upgrade` moves a repo from a version below the release that adds the boards switch, its output SHALL carry one
line telling the agent to tell the user the boards are on and that `set-boards off` turns them off. An upgrade that
starts at or above that release SHALL NOT carry the line. The announcement SHALL write no state.

#### Scenario: Announcement only on crossing

- **WHEN** `upgrade` runs from 0.54.0, and later runs again from 0.55.0
- **THEN** the first output carries the boards announcement line and the second does not
