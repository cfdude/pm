## ADDED Requirements

### Requirement: A non-goal has one shape on every record

A non-goal SHALL be `{id, text, addedAt, removedAt?, removeReason?}`. `text` is one line of at most 300 characters. Ids are
`n1`, `n2`, … per record, from a per-record counter that only advances, so an id is never reused. The mission, each
initiative, each release and each epic SHALL hold their own list; no other record SHALL hold one.

#### Scenario: Ids are per record

- **WHEN** a non-goal is added to the mission and then one to release r1
- **THEN** both are `n1`, and each is listed only under its own record

#### Scenario: A bad value writes nothing

- **WHEN** `release r1 --add-non-goal` is given an empty value, a newline, or 301 characters
- **THEN** it is refused naming "one line of at most 300 characters" and the state file is byte-identical to before

### Requirement: Non-goals are added on each record's own verb

`--add-non-goal "<line>"` (repeatable, appended in order) SHALL be accepted by `mission`, `initiative <id>`, `release <id>`,
`add-epic` and `update-epic`; `add-many` SHALL accept a `nonGoals` array of strings per entry. Every value SHALL be validated
before any write, so one bad value refuses the whole invocation.

#### Scenario: Two in one invocation

- **WHEN** `update-epic E --add-non-goal "No Jira sync" --add-non-goal "No new verb"` runs
- **THEN** E's non-goals are n1 "No Jira sync" and n2 "No new verb"

#### Scenario: A batch entry

- **WHEN** `add-many` registers an entry with `"nonGoals": ["No CSV export"]`
- **THEN** that epic's non-goals are n1 "No CSV export"

### Requirement: Removing a non-goal marks it, never deletes it

`--remove-non-goal "nN:<why>"`, split at the first colon, SHALL mark that non-goal removed with the time and the reason, on
`mission`, `initiative <id>`, `release <id>` and `update-epic`. It is not repeatable, so one reason never covers two
records. An unknown or already-removed id, or a missing reason, SHALL be refused, writing nothing.

#### Scenario: Removed is kept

- **WHEN** `mission --remove-non-goal "n1:now in scope"` runs
- **THEN** `board --json` `missionNonGoals` omits n1, and `mission show --history` lists n1 with the reason "now in scope"

#### Scenario: A missing reason

- **WHEN** `release r1 --remove-non-goal n1` runs
- **THEN** it is refused naming the `nN:<why>` form and nothing is written

### Requirement: A milestone carries no non-goals

No verb SHALL add a non-goal to a mission milestone, a mission exit criterion or an initiative milestone. A `nonGoals` key
found on a milestone record SHALL be ignored by every reader.

#### Scenario: The flag applies to the initiative

- **WHEN** `initiative boards --add-milestone "Live in every repo" --add-non-goal "No hosted service"` runs
- **THEN** the non-goal is recorded on initiative `boards`, and milestone m1 has no non-goals

### Requirement: Non-goals are read back on every surface

Active non-goals SHALL appear in `mission show`, `initiative show <id>`, `release show <id>` and `board --json`, as
`missionNonGoals` at the top level and `nonGoals` on each initiative, release and epic entry, each `[{id, text}]` in id order,
`[]` when none. Removed ones SHALL be absent there, kept in the record, and listed by `mission show --history` and
`initiative show <id> --history`.

#### Scenario: Empty lists are present

- **WHEN** `board --json` runs over a record with no non-goals
- **THEN** `missionNonGoals` is `[]` and every initiative, release and epic entry carries `nonGoals: []`

### Requirement: The release plan board shows non-goals beside what they bound

The release plan template SHALL render the mission's non-goals under the mission, each initiative's under that initiative,
and each release's on its release card, labelled "Not doing" and escaped like every other value. A record with none SHALL
render no empty heading.

#### Scenario: Hostile non-goal text

- **WHEN** a release non-goal is `</script><script>alert(1)</script>`
- **THEN** the card shows the escaped text and no script element is created
