## ADDED Requirements

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
routes through. An epic whose `externalId` is a plain positive integer that no other epic holds as its number SHALL take it. Every
other epic SHALL take the counter `nextEpicNumber` (default: one past the largest number held), skipping held numbers, and the
counter SHALL end up past every number taken. No flag or batch key SHALL set a number.


#### Scenario: A tracker number is the epic's number

- **WHEN** `add-epic --id a --external-id 256` runs on a record with no counter
- **THEN** epic a's `number` is 256 and `nextEpicNumber` is 257

#### Scenario: A plain registration takes the counter

- **WHEN** three epics with no `externalId` are registered on an empty record
- **THEN** their numbers are 1, 2 and 3 and `nextEpicNumber` is 4

#### Scenario: A held tracker number falls back to the counter

- **WHEN** two epics from different trackers both carry `externalId` "5"
- **THEN** the first has number 5 and the second takes the counter, so no two epics share a number

#### Scenario: The counter skips a held number

- **WHEN** an epic holds number 300, the counter is 299, and three plain epics are registered
- **THEN** they take 299, 301 and 302

#### Scenario: An externalId that is not a plain positive integer is not a number

- **WHEN** an epic is registered with `externalId` "PROJ-12", "007", "0", "-4" or "12abc"
- **THEN** it takes the counter

### Requirement: A number is never reassigned

Nothing SHALL rewrite an epic's `number` after registration. `update-epic --external-id` SHALL NOT renumber, an archived
epic SHALL keep its number, and removing an epic SHALL NOT free its number for a plain registration, because the counter does
not move back. A freed number MAY be taken again only by an epic registered later whose `externalId` is that integer, which
is the tracker's own number for it.

#### Scenario: Remove does not free a counter number

- **WHEN** epics 1 and 2 are registered, epic 2 is removed, and a plain epic is registered
- **THEN** the new epic's number is 3

#### Scenario: A changed externalId does not renumber

- **WHEN** an epic numbered 1 gets `update-epic --external-id 77`
- **THEN** its number is still 1

### Requirement: Existing epics are numbered by a migration keyed to 0.55.0

A `MIGRATIONS` entry keyed to 0.55.0 SHALL number every epic that has no valid number: tracker-linked epics first by their issue
number, then the rest from the counter in `createdAt`-then-id order (absent dates last). It SHALL be additive, idempotent,
absent-tolerant and read only the record, and the same function SHALL also run on every `upgrade`.


#### Scenario: Backfill order

- **WHEN** the migration runs over epics: issue-9 (`externalId` "9"), early (createdAt 2026-01-01), late (2026-03-01)
- **THEN** issue-9 is 9, early is 10, late is 11, and `nextEpicNumber` is 12

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
