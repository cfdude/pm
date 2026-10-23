## ADDED Requirements

### Requirement: The grooming pass reads the open backlog as a set and proposes

A skill `skills/backlog-grooming/SKILL.md`, entered by `/pm:backlog-grooming`, SHALL define a pass that
reads the open backlog from `list --json`, runs `triage` on suspect epics, and proposes merges,
declines and dead premises. It SHALL write nothing until the user confirms, and the engine SHALL
contribute no verdict and no new verb.

#### Scenario: The pass reads the set through list

- **WHEN** the skill's procedure is followed on a record with archived and open epics
- **THEN** its first read is `list --json`, and archived epics are set aside as already ended
- **AND** it does not read `.conductor/state.json` directly

#### Scenario: A proposal writes nothing

- **WHEN** the pass finds two epics that look like one piece of work
- **THEN** it reports both ids, the evidence and the proposed disposition
- **AND** no `update-epic`, `add-epic` or `remove-epic` runs before the user confirms

#### Scenario: Age is read from createdAt and null means unknown

- **WHEN** an epic has `createdAt: null`
- **THEN** the pass reports its age as unknown and does not propose it for decline on age

#### Scenario: A re-report of delivered work is found

- **WHEN** an open epic's ask overlaps an archived epic whose outcome is `delivered`
- **THEN** the pass proposes a dead-premise decline naming the delivering epic id

### Requirement: Every consolidation records a disposition

A confirmed merge SHALL be recorded as: the survivor receives the superseded epic's context first
(description, notes, links), then the survivor carries a `supersedes` link to it, then the superseded
epic ends with `--outcome superseded --reason "<what replaced it>" --no-deferrals`. A confirmed decline
SHALL end the epic with `--outcome declined --reason "<why not>" --no-deferrals`. The pass SHALL NOT
use `remove-epic` for either, because deletion removes the record of projected work.

#### Scenario: A merge keeps both records

- **WHEN** the user confirms that epic B is superseded by epic A
- **THEN** A holds B's context and a `supersedes` link to B before B is archived
- **AND** B has status `archived`, outcome `superseded` and a non-empty reason
- **AND** B is still present in the record

#### Scenario: A decline keeps the record

- **WHEN** the user confirms a decline of epic C
- **THEN** C has status `archived`, outcome `declined` and a non-empty reason
- **AND** `remove-epic` was not run

#### Scenario: A consolidation without a link or reason is reported unfinished

- **WHEN** a superseded epic is archived without a `supersedes` link on its survivor, or without a reason
- **THEN** the pass reports the consolidation as unfinished rather than done

### Requirement: Findings cite evidence that does not rot

Every finding the pass reports SHALL cite epic ids, engine output or commit shas, and SHALL NOT cite a
line number as its evidence. A reason recorded in a disposition SHALL follow the same rule.

#### Scenario: A line-number citation is replaced

- **WHEN** the pass drafts a finding whose only evidence is a `file:line` citation
- **THEN** it replaces the citation with an epic id, a verb's output or a sha before reporting

### Requirement: The pass states what it left alone

The report SHALL list the epics it read and judged alive, each with a reason or grouped under a stated
common reason, as well as its proposals, so that silence does not read as "not looked at".

#### Scenario: Unchanged epics are named

- **WHEN** the pass finishes with proposals for 3 of 38 open epics
- **THEN** the report names the other 35 as verified alive, each with its one-line reason or grouped with a stated common reason
