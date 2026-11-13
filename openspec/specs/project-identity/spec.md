# project-identity Specification

## Purpose
TBD - created by archiving change project-boards. Update Purpose after archive.

## Requirements

### Requirement: The project has a name and a two- or three-letter key

The verb `set-project` SHALL record `state.projectName` (`--name`: at most 60 characters, no control character, no `<`) and
`state.projectKey` (`--key`: `/^[A-Z]{2,3}$/`), either alone, and `--unset <name|key>` SHALL remove one. A bad value, no operation,
or one field both set and unset SHALL be refused with nothing written; a value already held writes nothing. It SHALL NOT rewrite
the managed rules block or derive a name or key from anything.

#### Scenario: Set both, then one alone

- **WHEN** `set-project --name "Project Manager" --key PM` runs, and then `set-project --key PX` runs
- **THEN** `projectName` is "Project Manager" and `projectKey` is "PX"

#### Scenario: A bad key or name is refused

- **WHEN** `set-project --key pm`, `--key P`, `--key PMXX`, `--key P1`, `--name ""`, a name of 61 characters, a name containing `<`, and a name containing a newline each run
- **THEN** each exits non-zero naming its rule, and the state file is byte-identical to before

#### Scenario: Each field has an inverse

- **WHEN** `set-project --unset name` runs, and then `set-project --unset key` runs
- **THEN** `projectName` and then `projectKey` are absent from the record, and `--unset` of an unknown field name is refused naming `name` and `key`

#### Scenario: Setting and unsetting one field together is a contradiction

- **WHEN** `set-project --key PM --unset key` runs
- **THEN** it exits non-zero and writes nothing

#### Scenario: The same value twice writes nothing

- **WHEN** `set-project --key PM` runs twice
- **THEN** the second run says nothing changed and the state file is byte-identical to before it

### Requirement: Every epic carries an integer number, assigned at registration by the one creation sink

Every epic SHALL carry an integer `number` of at least 1, assigned at registration by the one function every registration path
routes through. An epic whose `externalId` is a plain positive integer below 1000 that no other epic holds as its number SHALL
take it. Every other epic SHALL take the counter `nextEpicNumber`, skipping held numbers. No flag or batch key SHALL set a number.

#### Scenario: A tracker number is the epic's number

- **WHEN** `add-epic --id a --external-id 256` runs on a record with no counter
- **THEN** epic a's `number` is 256 and `nextEpicNumber` is 1000

#### Scenario: A held tracker number falls back to the counter

- **WHEN** two epics from different trackers both carry `externalId` "5"
- **THEN** the first has number 5 and the second takes the counter (1000), so no two epics share a number

#### Scenario: The counter skips a held number

- **WHEN** an epic holds number 1001, the counter is 1000, and three plain epics are registered
- **THEN** they take 1000, 1002 and 1003

#### Scenario: An externalId that is not a plain positive integer is not a number

- **WHEN** an epic is registered with `externalId` "PROJ-12", "007", "0", "-4" or "12abc"
- **THEN** it takes the counter

### Requirement: The counter starts at a floor of 1000

The counter's first value SHALL be 1000 (the counter floor), never one past the largest number held, so a local number cannot
collide with a tracker number below 1000. A counter number SHALL leave the counter past it; a tracker number below the floor
SHALL leave it alone; a tracker number at or above 1000, or already held, SHALL fall back to the counter. A stored counter
below the floor SHALL be raised to it.

#### Scenario: A plain registration takes the counter, which starts at 1000

- **WHEN** three epics with no `externalId` are registered on an empty record
- **THEN** their numbers are 1000, 1001 and 1002 and `nextEpicNumber` is 1003

#### Scenario: A local number cannot meet a tracker number below 1000

- **WHEN** an epic with `externalId` "256" and then a plain epic are registered on an empty record
- **THEN** their numbers are 256 and 1000

#### Scenario: A tracker number at or above the floor takes the counter

- **WHEN** epics with `externalId` "999", "1000" and "1500" are registered on an empty record
- **THEN** their numbers are 999, 1000 and 1001

### Requirement: A valid number is a positive integer no earlier epic holds

A valid `number` SHALL be a positive safe integer held by no earlier epic in array order. When two epics hold the same number,
`stampEpicNumbers` SHALL keep it on the earlier holder and renumber the later one as an epic with no valid number.

#### Scenario: A duplicate number is renumbered on the later holder

- **WHEN** the migration runs over epics a then b (array order) that both hold number 7
- **THEN** a keeps 7 and b takes the counter (1000), so no two epics share a number

### Requirement: A number is never reassigned

Nothing SHALL rewrite a valid `number` after registration, the duplicate rule above being the one exception. `update-epic
--external-id` SHALL NOT renumber, an archived epic SHALL keep its number, and removing an epic SHALL NOT free its number for a
plain registration, because the counter does not move back. A freed number MAY return only to an epic registered later whose
`externalId` is that integer.

#### Scenario: Remove does not free a counter number

- **WHEN** two plain epics are registered (numbers 1000 and 1001), the second is removed, and a plain epic is registered
- **THEN** the new epic's number is 1002

#### Scenario: A changed externalId does not renumber

- **WHEN** an epic numbered 1000 gets `update-epic --external-id 77`
- **THEN** its number is still 1000

### Requirement: Existing epics are numbered by a migration keyed to 0.55.0

A `MIGRATIONS` entry keyed to 0.55.0 SHALL number every epic that has no valid number (a duplicate's later holder counts as having none): tracker-linked epics first by their issue
number (under the same rule: below 1000 and not held), then the rest from the counter, whose first value is 1000, in
`createdAt`-then-id order (absent dates last). It SHALL be additive, idempotent,
absent-tolerant and read only the record, and the same function SHALL also run on every `upgrade`.

#### Scenario: Backfill order

- **WHEN** the migration runs over epics: issue-9 (`externalId` "9"), early (createdAt 2026-01-01), late (2026-03-01)
- **THEN** issue-9 is 9, early is 1000, late is 1001, and `nextEpicNumber` is 1002

#### Scenario: A second run changes nothing

- **WHEN** the migration runs twice
- **THEN** the second run numbers no epic and the record is byte-identical to after the first

### Requirement: The displayed key is derived, never stored

The key an epic displays SHALL be `projectKey + "-" + number`, computed on read, and SHALL be unavailable (`null`) while the
project key is unset or the epic carries no number. Changing `projectKey` SHALL therefore change every displayed key and
rewrite no epic.

#### Scenario: Key follows the project key

- **WHEN** epic a has number 256 and `set-project --key PM` runs, and then `set-project --key PX` runs
- **THEN** `board --json` reports a's `key` as "PM-256" and then "PX-256", and no epic record changed
