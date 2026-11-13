## ADDED Requirements

### Requirement: Boards are a default-on switch

The boards feature SHALL have an `OPT_INS` row with the id `boards`, the verb `set-boards on|off` and the command doc
`commands/boards.md`. An absent setting SHALL read as on, and `init` SHALL NOT write the setting. `set-boards off`
and `set-boards on` SHALL be each other's inverse, and each SHALL be idempotent. Off SHALL remove the `## Boards` rules-block
section and the boards brief line.

#### Scenario: Default on

- **WHEN** a repo upgrades from 0.54.0 with no boards setting
- **THEN** the rules block carries `## Boards`, the brief carries the boards line, `state.json` gains no boards field, and `upgrade` lists `boards: on (default)` with `set-boards off`

#### Scenario: Off removes both surfaces and is undone by on

- **WHEN** `set-boards off` runs, and then `set-boards on` runs
- **THEN** after the first, `overhead` reports 0 bytes for `boards` and neither the `## Boards` section nor the brief line is on disk; after the second, both are back

### Requirement: Each boards and mission surface is measured on its own

`overhead` SHALL report three new surfaces: `rules:boards` (feature `boards`), `brief:boards` (the brief's boards
line, feature `boards`) and `rules:mission` (feature `core`, because a mission is recorded data, not a switchable
feature). The `brief` surface SHALL measure the brief without the boards line, so no byte is counted twice. The README
cost table SHALL carry a row for each of the three.

#### Scenario: The brief's boards line is its own surface

- **WHEN** `overhead` runs with boards on
- **THEN** `brief:boards` reports that line's bytes under `boards`, and `brief` equals the brief's bytes minus that line

#### Scenario: README rows

- **WHEN** the README cost table is checked against the overhead map
- **THEN** it holds rows for `rules:boards`, `brief:boards` and `rules:mission`

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
