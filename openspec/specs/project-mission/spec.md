# project-mission Specification

## Purpose
TBD - created by archiving change project-boards. Update Purpose after archive.

## Requirements

### Requirement: The mission is a recorded statement with history

The engine SHALL provide a verb `mission`. `mission --statement "<text>" --reason "<why>"` SHALL record the current
mission: one line of at most 300 characters, the time it was set, and the reason. A new statement SHALL move the
previous one into an append-only history, stamped with when it was replaced. The engine SHALL never write a statement
it was not given.

#### Scenario: Changing the mission keeps the old one

- **WHEN** `mission --statement "Stabilize the API" --reason "kickoff"` runs, and then `mission --statement "Ship trading" --reason "API locked"` runs
- **THEN** `mission show` prints "Ship trading", and `mission show --history` lists "Stabilize the API" with its replacement time and the reason "API locked"

### Requirement: Ending the mission keeps the record

`mission --end --reason "<why>"` SHALL end the current mission and append it to history with that reason, leaving
no current mission. A statement or an end without `--reason`, or with an empty statement, SHALL be refused and SHALL
write nothing. `--end` with no current mission SHALL be refused, naming that there is none. Recording a statement
identical to the current one SHALL write nothing and say so.

#### Scenario: End leaves the milestone and criteria in place

- **WHEN** `mission --end --reason "x"` runs on a repo with milestone r2 and criteria
- **THEN** `mission.milestoneRelease`, the criteria and every `criticalPath` mark are unchanged, and nothing else is cleared

#### Scenario: End is an inverse that keeps the record

- **WHEN** `mission --end --reason "project paused"` runs on a repo with a mission
- **THEN** `board --json` reports `mission: null`, and the history holds the cleared statement with that reason

#### Scenario: Same statement twice writes nothing

- **WHEN** `mission --statement "x" --reason "r"` runs twice
- **THEN** the second run says nothing changed, the history gains no entry, and the state file is byte-identical to before it

#### Scenario: End with no mission

- **WHEN** `mission --end --reason "x"` runs with no current mission
- **THEN** it exits non-zero saying there is no current mission and writes nothing

#### Scenario: Reason belongs to one operation

- **WHEN** `mission --statement "x" --end --reason "r"` or `mission --end --remove-criterion c1 --reason "r"` runs
- **THEN** it is refused naming that `--reason` serves exactly one of `--statement`, `--end` and `--remove-criterion`, and nothing is written

#### Scenario: Reason required

- **WHEN** `mission --statement "x"` runs without `--reason`
- **THEN** it exits non-zero naming `--reason` and the state file is byte-identical to before

### Requirement: mission show reads the record back

`mission show` SHALL print the current statement, the mission milestone, the active criteria and the number of
history entries. `mission show --history` SHALL also print every history entry and every removed criterion. `show`
SHALL be reserved, and `mission show` SHALL write nothing.

#### Scenario: Show on an empty record

- **WHEN** `mission show` runs with no mission ever recorded
- **THEN** it prints `no mission`, exits 0, and the state file is byte-identical to before

### Requirement: The mission milestone is a release, with an inverse

`mission --milestone <releaseId>` SHALL record which release meets the mission. Every human-readable surface (command output, docs, the brief, the rules block) SHALL call it the "mission milestone", to keep it apart from a plan's story milestones. JSON keys and `rejected` kind and reason tokens (`milestone`, `milestone names no release`) are exempt. `mission --clear-milestone` SHALL remove it. A
milestone naming no existing release SHALL be refused, writing nothing.

#### Scenario: Unknown release refused

- **WHEN** `mission --milestone nope` runs and no release `nope` exists
- **THEN** it exits non-zero naming `nope` and writes nothing

#### Scenario: Clearing the milestone

- **WHEN** `mission --clear-milestone` runs
- **THEN** `board --json` reports `milestone: null` and every release's `criticalPath` is `null`

### Requirement: Critical path is derived from the mission milestone

A release SHALL be critical path when a mission milestone is set and the release is the milestone or has an `order`
at most the milestone's. Every other release SHALL be off it. With no milestone, or a milestone release with no order,
every `criticalPath` SHALL be `null`. A milestone naming a removed release SHALL read as `milestone: null`, with a
`rejected` entry (shape in `board-export`), field `milestone.release`, reason `milestone names no release`.

#### Scenario: Critical path follows order

- **WHEN** releases r1 (order 1), r2 (order 2) and r3 (order 3) exist and `mission --milestone r2` has run
- **THEN** `board --json` reports `criticalPath` true for r1 and r2 and false for r3

#### Scenario: No milestone means unknown

- **WHEN** no mission milestone is set
- **THEN** every release's `criticalPath` is `null`

### Requirement: Mission milestone exit criteria are numbered and stable

`mission --add-criterion "<text>"` SHALL append an exit criterion with the next stable id (`c1`, `c2`, …), and ids
SHALL never be reused or renumbered. `--check "<how to check it>"` SHALL attach a mechanical check. `--needs-human`
SHALL mark a criterion that needs a human-supplied number. `--check` and `--needs-human` apply only to `--add-criterion`;
`mission --check` without it, and `--check` together with `--needs-human`, SHALL be refused and write nothing.

#### Scenario: Criteria without a milestone

- **WHEN** a criterion is added while no mission milestone is set
- **THEN** it is recorded, and `board --json` reports `milestone: null` (the criteria show in `mission show` only) until a milestone is set

#### Scenario: Needs-human marker

- **WHEN** `mission --add-criterion "p95 latency under target" --needs-human` runs
- **THEN** that criterion's `needsHuman` is `true` and its `check` is `null`

### Requirement: Removing a criterion marks it, never deletes it

`mission --remove-criterion <cN> --reason "<why>"` SHALL mark the criterion removed, with the time and the reason.
Removed criteria SHALL be absent from `board --json` `milestone.criteria` and present in `mission show --history`.
Removing an unknown or already-removed id SHALL be refused, writing nothing.

#### Scenario: Ids are stable across removal

- **WHEN** criteria c1 and c2 exist, `mission --remove-criterion c1 --reason "merged into c2"` runs, and then a new criterion is added
- **THEN** the new criterion is `c3`, `milestone.criteria` lists c2 and c3, and the history shows c1 removed with its reason

### Requirement: The mission is surfaced in status and the brief, within budget

While a current mission exists, `/pm:status` SHALL print it with the mission milestone and how many active criteria
it has. The SessionStart brief SHALL carry one mission line of at most 200 bytes, truncating the statement with an
ellipsis. The line passes through `fitBrief` as an obligation string that is never shortened, and its size is measured
after fitting. With no mission, neither surface SHALL print a mission line.

#### Scenario: Long statement truncated in the brief

- **WHEN** the mission statement is 300 characters
- **THEN** the brief's mission line is at most 200 bytes and ends in an ellipsis

#### Scenario: No mission, no line

- **WHEN** no mission is recorded
- **THEN** neither the brief nor `/pm:status` contains a mission line
