## ADDED Requirements

### Requirement: A release records its plan fields

`release <id>` SHALL accept `--theme <text>`, `--rationale <text>`, `--exit <text>` (the runnable exit check),
`--order <n>` (a non-negative integer) and `--size major|minor|patch`, on create or amend and alongside the existing
flags. Setting a field again SHALL replace it. The existing `--intent` stays the release's scope statement.

#### Scenario: Set and read back plan fields

- **WHEN** `release r1 --intent "stabilize the API" --theme "Lock the API" --order 1 --size minor --exit "contract tests pass"` runs
- **THEN** `release show r1` and `board --json` both report that theme, order 1, size minor and that exit check

### Requirement: Plan field values are validated before any write

A text plan field SHALL be one line of at most 400 characters. An empty value, a newline, an `--order` that is not a
non-negative integer, or a `--size` outside `major|minor|patch` SHALL be refused, naming the accepted values, and the
command SHALL write nothing.

#### Scenario: Bad size refused

- **WHEN** `release r1 --size huge` runs
- **THEN** it exits non-zero naming `major|minor|patch` and the state file is byte-identical to before

#### Scenario: Negative order refused

- **WHEN** `release r1 --order -1` runs
- **THEN** it exits non-zero naming "a non-negative integer" and writes nothing

### Requirement: Every plan field can be cleared

`release <id> --clear <field>` (repeatable) SHALL remove `theme`, `rationale`, `exit`, `order` or `size`. Clearing an
absent field SHALL be a no-op, reported as such. A `--clear` naming any other field SHALL be refused, naming the
clearable fields, and SHALL write nothing.

#### Scenario: Clear a field

- **WHEN** `release r1 --clear theme` runs on a release with a theme
- **THEN** `board --json` reports `theme: null` for r1 and its other fields are unchanged

#### Scenario: Unknown clear field refused

- **WHEN** `release r1 --clear intent` runs
- **THEN** it exits non-zero naming the clearable fields and writes nothing

### Requirement: Release status is derived, never recorded

A release's status SHALL be computed on read and never stored. It is `shipped` when delivery is recorded with
`--deliver`. Otherwise it is `in-progress` when any derived member is `active`, `paused` or `blocked`, or when some,
but not all, members are archived. Otherwise it is `planned`. `--undeliver` SHALL return the status to whatever the
members imply. `release` SHALL NOT accept `--status`.

#### Scenario: Delivered release is shipped regardless of members

- **WHEN** `release r1 --deliver` has run and every member is still `queued`
- **THEN** `board --json` reports r1's `status` as `shipped`

#### Scenario: A member in flight makes it in-progress

- **WHEN** r1 is not delivered and one member is `active`
- **THEN** r1's `status` is `in-progress`

#### Scenario: Undeliver reverts to the derived value

- **WHEN** `release r1 --undeliver` runs and every member is `queued`
- **THEN** r1's `status` is `planned`

#### Scenario: No status flag

- **WHEN** `release r1 --status shipped` runs
- **THEN** it is refused as an unknown flag and writes nothing

### Requirement: The plan records where the project is, with an inverse

`release here <id>` SHALL record `<id>` as the plan's current release. `--text <line>` SHALL set the "we are here"
line and `--next <line>` the "next up" line, each one line of at most 200 characters. `release here --unset` SHALL
remove the marker and both lines. `release here <id>` naming no existing release SHALL be refused, writing nothing.

#### Scenario: Set and clear the marker

- **WHEN** `release here r2 --text "Hardening the API" --next "Cut r2"` runs, and then `release here --unset` runs
- **THEN** after the first, `plan` is `{here: "r2", hereText: "Hardening the API", nextText: "Cut r2"}`; after the second, every field is `null`

#### Scenario: Unknown release refused

- **WHEN** `release here nope` runs and no release `nope` exists
- **THEN** it exits non-zero naming `nope` and writes nothing

### Requirement: here is a reserved release id and a stale marker is reported

`here` SHALL be a reserved release id, like `show`. `release here` used with release-amending flags and no target id
SHALL be refused, saying `here` is reserved. When the release the marker names no longer exists, `board --json` SHALL
report `plan.here` as `null` and list the stale id in `rejected` with the reason `here names no release`.

#### Scenario: here is reserved

- **WHEN** `release here --intent "x"` runs
- **THEN** it is refused, the message says `here` is a reserved release id, and no release `here` is created

#### Scenario: Stale marker

- **WHEN** the marker names `r9` and no release `r9` exists
- **THEN** `board --json` reports `plan.here: null` and `rejected` names `r9`

### Requirement: Release planning is visible in release show

`release show <id>` SHALL print theme, rationale, exit check, order, size and the derived status when any is set,
and SHALL mark the release `(here)` when it is the plan's current release. `release show` with no id SHALL keep one
line per release, appending the order and the derived status.

#### Scenario: Show one release

- **WHEN** r1 has theme "Lock the API" and order 1, and is the `here` release
- **THEN** `release show r1` prints the theme, `order 1`, the derived status and `(here)`
