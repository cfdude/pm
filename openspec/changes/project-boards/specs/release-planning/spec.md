## ADDED Requirements

### Requirement: A release records its plan fields

`release <id>` SHALL accept `--theme <text>`, `--rationale <text>`, `--exit <text>` (the runnable exit check),
`--order <n>` (a non-negative integer) and `--size major|minor|patch`, on create or amend and alongside the existing
flags. Setting a field again SHALL replace it. `--intent` stays the scope statement. `--size` is the semver impact; the
brief's separate size weight is not recorded.

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

`release <id> --clear <field>` (repeatable) SHALL remove `theme`, `rationale`, `exit`, `order`, `size` or `target`. Clearing an
absent field SHALL be a no-op, reported as such. A `--clear` naming any other field SHALL be refused, naming the
clearable fields, and SHALL write nothing.

#### Scenario: Clear a field

- **WHEN** `release r1 --clear theme` runs on a release with a theme
- **THEN** `board --json` reports `theme: null` for r1 and its other fields are unchanged

#### Scenario: Target is clearable

- **WHEN** `release r1 --clear target` runs on a release with a target, and `release r1 --target x --clear target` runs
- **THEN** the first removes `target` and the second is refused as a contradiction, writing nothing

#### Scenario: Unknown clear field refused

- **WHEN** `release r1 --clear intent` runs
- **THEN** it exits non-zero naming the clearable fields and writes nothing

### Requirement: Release status is derived, never recorded

A release's status SHALL be computed on read and never stored: `shipped` when `--deliver` is recorded; else
`in-progress` when any member is `active`, `paused`, `blocked` or archived; else `planned` (always, with no members).
`--undeliver` SHALL return it to what the members imply. `release` SHALL NOT accept `--status`.

#### Scenario: Delivered release is shipped regardless of members

- **WHEN** `release r1 --deliver` has run and every member is still `queued`
- **THEN** `board --json` reports r1's `status` as `shipped`

#### Scenario: A member in flight makes it in-progress

- **WHEN** r1 is not delivered and one member is `active`
- **THEN** r1's `status` is `in-progress`

#### Scenario: All members archived without delivery

- **WHEN** every member of r1 is archived and `--deliver` was never run
- **THEN** r1's `status` is `in-progress`

#### Scenario: No members

- **WHEN** r1 has no members and no delivery
- **THEN** r1's `status` is `planned`

#### Scenario: Undeliver reverts to the derived value

- **WHEN** `release r1 --undeliver` runs and every member is `queued`
- **THEN** r1's `status` is `planned`

#### Scenario: No status flag

- **WHEN** `release r1 --status shipped` runs
- **THEN** it is refused as an unknown flag and writes nothing

### Requirement: The plan records where the project is, with an inverse

`release here <id>` SHALL record `<id>` as the plan's current release. `--text <line>` SHALL set the "we are here"
line and `--next <line>` the "next up" line, each one line of at most 200 characters. `release here --clear-here` SHALL
remove the marker and both lines; it is valueless and takes no id. `release here <id>` naming no existing release SHALL be refused, writing nothing.

#### Scenario: Set and clear the marker

- **WHEN** `release here r2 --text "Hardening the API" --next "Cut r2"` runs, and then `release here --clear-here` runs
- **THEN** after the first, `plan` is `{here: "r2", hereText: "Hardening the API", nextText: "Cut r2"}`; after the second, every field is `null`

#### Scenario: Unknown release refused

- **WHEN** `release here nope` runs and no release `nope` exists
- **THEN** it exits non-zero naming `nope` and writes nothing

### Requirement: here is a reserved release id and a stale marker is reported

`here` SHALL be a reserved release id, like `show`. `release here` SHALL accept only one release id, `--text`, `--next`
and `--clear-here`, and SHALL refuse any other flag, `--text` without an id, or an id with `--clear-here`, naming what
is accepted. A marker naming a removed release SHALL read as `plan.here: null`, with a `rejected` entry, reason
`here names no release`.

#### Scenario: here is reserved

- **WHEN** `release here --intent "x"` runs
- **THEN** it is refused, the message says `here` is a reserved release id, and no release `here` is created

#### Scenario: here takes no release-amending flag

- **WHEN** `release here r2 --intent "x"` runs
- **THEN** it is refused naming `--text`, `--next` and `--clear-here`, and nothing is written

#### Scenario: here cannot set and clear at once

- **WHEN** `release here r2 --clear-here` runs
- **THEN** it is refused naming that `--clear-here` takes no id, and nothing is written

#### Scenario: here needs an id to set

- **WHEN** `release here --text "x"` runs with no id
- **THEN** it is refused naming the missing release id, and nothing is written

#### Scenario: Stale marker

- **WHEN** the marker names `r9` and no release `r9` exists
- **THEN** `board --json` reports `plan.here: null` and `rejected` holds `{kind: "plan", id: null, field: "plan.here", value: "r9", reason: "here names no release"}`

### Requirement: Release planning is visible in release show

`release show <id>` SHALL print theme, rationale, exit check, order, size and the derived status when any is set,
SHALL mark it `(here)` when it is the plan's current release, and SHALL mark it `(critical path)` or
`(off critical path)` when `criticalPath` is not null. `release show` with no id SHALL keep one line per release,
appending the order, the derived status and the same critical-path mark.

#### Scenario: Show one release

- **WHEN** r1 has theme "Lock the API" and order 1, and is the `here` release
- **THEN** `release show r1` prints the theme, `order 1`, the derived status and `(here)`

#### Scenario: Off the critical path is said where listed

- **WHEN** a mission milestone r2 is set and r3 has order 3
- **THEN** `release show` marks r3 `(off critical path)` and r2 `(critical path)`

### Requirement: /pm:status shows where the plan is

The `/pm:status` verb's own output (beside the spec-sync block, never written into `PROJECT.md`) SHALL print
`here: <id>` and the "we are here" line while a marker is set, and a `(critical path)` or `(off critical path)` mark on
each release whose `criticalPath` is not null, as `release show` does. The brief's RELEASES lines SHALL NOT carry either.

#### Scenario: Status names the marker

- **WHEN** `release here r2 --text "Hardening the API"` has run and `/pm:status` renders
- **THEN** its output contains `here: r2` and "Hardening the API", and `PROJECT.md` does not contain `here: r2`

#### Scenario: Status marks the critical path

- **WHEN** a mission milestone r2 is set over releases r1, r2 (orders 1, 2) and r3 (order 3) and `/pm:status` runs
- **THEN** its output marks r1 and r2 `(critical path)` and r3 `(off critical path)`

#### Scenario: No marks when criticalPath is null

- **WHEN** a mission milestone is set on a release with no `order`, and `/pm:status` runs
- **THEN** its output carries neither mark on any release
