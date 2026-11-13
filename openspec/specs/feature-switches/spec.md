# feature-switches Specification

## Purpose
Give each pm feature a measured cost and, only where the cost and the feature's nature justify it, an off
switch that follows the existing opt-in pattern, with developer features off by default.

## Requirements

### Requirement: Every surface in the overhead map has a costed row and a switch decision

The README SHALL carry a "What each feature costs" table with one row per surface id in `pm-overhead`'s
map, except that every `listing:` surface is one `listings` row: its feature id, its estimated per-session
cost from `overhead --all-features` labelled an estimate, and the verb that switches its feature or
`no switch` with a reason. A surface that `overhead --all-features` never produces, because it is emitted
only while a feature is UNUSED (the rules block's `rules:procedures-emitted-on-use`), SHALL instead take
its cost from `overhead` in a freshly initialised repo, and its row SHALL say so. A test SHALL fail when
the table and the map disagree.

#### Scenario: A surface missing from the table fails

- **WHEN** the map holds a surface id the README table has no row for
- **THEN** the assertion test fails, naming the id

#### Scenario: A table row for an unknown surface fails

- **WHEN** the README table names a surface id the map does not hold
- **THEN** the assertion test fails, naming the id

#### Scenario: The listings are reported as not switchable

- **WHEN** the table's `listings` row is read
- **THEN** it says `no switch` because the plugin's files are read by the host, not emitted by the engine

#### Scenario: The pointer row names where its cost came from

- **WHEN** the table's `rules:procedures-emitted-on-use` row is read
- **THEN** it carries a token estimate and says the figure is from a fresh repo, not from `--all-features`

### Requirement: A switch is added only where the measured cost and the feature's nature justify it

An audit candidate is a surface or named group of surfaces. It SHALL get a switch only when its
unconditional per-session cost is at or above the named threshold and its text is not a safety stop or
record-integrity rule, or when it is a developer feature that costs tokens itself. A switch SHALL be a new
`OPT_INS` id the map re-assigns those surfaces to. Each decision is recorded with its number.

#### Scenario: A safety rule is never switched

- **WHEN** the `rules:the-gate-procedure` surface exceeds the threshold
- **THEN** its README row says `no switch` with the reason that it is a record-integrity rule

#### Scenario: A switch re-assigns named surfaces

- **WHEN** the audit adds a switch for a `core` surface
- **THEN** the map assigns that surface id to the new `OPT_INS` id and `overhead` reports it under that feature

#### Scenario: A developer feature is switchable at any size

- **WHEN** the developer session log's surfaces are below the threshold
- **THEN** it still has a switch, `set-dev-log`

### Requirement: A new switch follows the opt-in pattern and changes nothing on upgrade

Each new switch SHALL have an `OPT_INS` row and a `set-<feature> on|off` verb that is idempotent and
refuses other arguments. An absent field SHALL read as today's behaviour. Off SHALL remove every surface
the map assigns to the feature. `upgrade` SHALL list every switchable feature with its state and its verb.

#### Scenario: Upgrade leaves a default-on feature on

- **WHEN** a repo upgrades to the release that adds a switch for an always-on feature
- **THEN** the feature's surfaces are unchanged and `state.json` gains no field for it
- **AND** `upgrade` lists the feature as `on (default)` with its estimated cost and `set-<feature> off`

#### Scenario: Off removes the feature's surfaces

- **WHEN** `set-<feature> off` runs for a switched feature
- **THEN** `overhead` reports 0 bytes for that feature
- **AND** `CLAUDE.md`'s managed block on disk no longer carries its sections

#### Scenario: An audit that adds no switch changes no verb surface

- **WHEN** the audit records every feature as `no switch`
- **THEN** no `set-<feature>` verb and no `OPT_INS` row is added, and the README table still covers every map id

#### Scenario: A repeated setting writes nothing

- **WHEN** `set-<feature> off` runs while the feature is already off
- **THEN** the verb says so and `state.json` is byte-identical to before

### Requirement: Developer features are off by default and documented with their real verbs

Spend tracking, the spend guard and the developer session log SHALL be off in a new repository, and
`init` and `upgrade` SHALL NOT turn them on. The README SHALL say how to turn spend tracking on with
`set-spend-tracking on`, and state that it adds its own cost.

#### Scenario: A new repo pays nothing for developer features

- **WHEN** `init` runs in a new repository and `overhead` runs
- **THEN** `features.spendTracking`, `features.spendGuard` and `features.devLog` report `on: false` and 0 bytes

#### Scenario: The README names the real verb

- **WHEN** the README's spend-tracking row is read
- **THEN** it contains `set-spend-tracking on` and the feature's estimated cost

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
