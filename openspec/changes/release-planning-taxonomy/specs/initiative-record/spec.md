## ADDED Requirements

### Requirement: The initiative verb records an initiative

The engine SHALL provide a verb `initiative`. `initiative <id> --title "<line>" --capability "<line>"` SHALL create an
initiative; on an existing id either flag SHALL replace its value. The id SHALL match the epic id format. `--title` is one
line of at most 200 characters and `--capability` (the valuable capability it delivers) one line of at most 400. A refused
invocation SHALL write nothing.

#### Scenario: Create and read back

- **WHEN** `initiative boards --title "Live boards" --capability "Every pm repo sees its backlog and plan without a tracker"` runs
- **THEN** `initiative show boards` prints that title, that capability and status `open`, and `board --json` lists it in `initiatives`

#### Scenario: Create needs both fields

- **WHEN** `initiative boards --title "Live boards"` runs and no initiative `boards` exists
- **THEN** it exits non-zero naming `--capability` and the state file is byte-identical to before

#### Scenario: One line within the limit

- **WHEN** `initiative boards --title` is given a value holding a newline, or a `--capability` of 401 characters
- **THEN** it is refused naming "one line of at most" and the limit, any control character in the echoed value is escaped, and nothing is written

#### Scenario: Reserved and malformed ids

- **WHEN** `initiative show --title x` or `initiative "Bad Id" --title x --capability y` runs
- **THEN** the first is refused naming `show` as reserved, the second naming the id format, and neither writes anything

### Requirement: An initiative records its source and its mission challenge answer

`--source "<line>"` SHALL record where the initiative was derived from; the literal `UNGROUNDED` is an accepted value.
`--off-mission-reason "<line>"` SHALL record the stated reason an initiative is off the mission. Each is optional, one line
of at most 300 characters, and removable with `initiative <id> --clear source` or `--clear off-mission-reason`.

#### Scenario: Ungrounded source

- **WHEN** `initiative boards --source UNGROUNDED` runs, and then `initiative boards --clear source`
- **THEN** after the first `board --json` reports `source: "UNGROUNDED"` for boards; after the second it reports `null`

#### Scenario: Unknown clear field

- **WHEN** `initiative boards --clear title` runs
- **THEN** it is refused naming `source` and `off-mission-reason` as the clearable fields, and nothing is written

### Requirement: An initiative ends with a work disposition, never a deletion

`initiative <id> --end --outcome delivered|abandoned|superseded --reason "<why>"` SHALL set the status to `ended` and append
`{event: "ended", outcome, at, reason}` to its history. `--reopen --reason "<why>"` SHALL be its inverse: status `open`,
`outcome` and `endedAt` cleared, a `reopened` event appended. `--reason` serves only these two. A wrong-state, outcome-less
or reasonless call SHALL write nothing; no verb SHALL delete an initiative.

#### Scenario: End then reopen keeps both events

- **WHEN** `initiative boards --end --outcome superseded --reason "folded into reporting"` runs, then `initiative boards --reopen --reason "split back out"`
- **THEN** `initiative show boards --history` lists both events, the first with outcome `superseded`, and the status is `open`

#### Scenario: An open initiative exports no outcome

- **WHEN** boards has been ended and then reopened, or was never ended
- **THEN** `board --json` reports boards with `status: "open"`, `outcome: null` and `endedAt: null`

#### Scenario: Outcome and reason are required

- **WHEN** `initiative boards --end --reason "x"`, `initiative boards --end --outcome killed --reason "x"` or `initiative boards --end --outcome delivered` runs
- **THEN** each is refused, naming `delivered|abandoned|superseded` or the missing reason, and nothing is written

#### Scenario: Ending keeps every reference

- **WHEN** epic E and release r1 name initiative `boards` and `initiative boards --end --outcome delivered --reason "done"` runs
- **THEN** E's and r1's `initiative` still read `boards`, and `board --json` lists `boards` with status `ended` and outcome `delivered`

### Requirement: initiative show reads the record back

`initiative show` SHALL print one line per initiative: id, status, title and the counts of active initiative milestones and
of epics naming it as primary. `initiative show <id>` SHALL print every field and the active initiative milestones;
`--history` SHALL add the lifecycle events and removed milestones. Every `show` form SHALL write nothing; an unknown id
SHALL be refused.

#### Scenario: Show on an empty record

- **WHEN** `initiative show` runs with no initiative recorded
- **THEN** it prints `no initiatives`, exits 0, and the state file is byte-identical to before

#### Scenario: Unknown id

- **WHEN** `initiative show nope` runs
- **THEN** it exits non-zero naming `nope` and writes nothing

### Requirement: Initiative milestones live inside their initiative

`initiative <id> --add-milestone "<line>"` SHALL append an initiative milestone (one line, at most 300 characters) with the
next stable id `m1`, `m2`, …, never reused. A milestone SHALL carry no release field and SHALL exist only inside an
initiative. Every human-readable surface SHALL call it an "initiative milestone"; the 0.55.0 mission milestone is unchanged.

#### Scenario: Ids are stable across removal

- **WHEN** milestones m1 and m2 exist, m1 is removed, and a milestone is added
- **THEN** the new milestone is `m3`, and `board --json` lists m2 and m3 for that initiative

#### Scenario: The mission milestone is untouched

- **WHEN** `mission --milestone r2` has run and `initiative boards --add-milestone "Boards live in every repo"` runs
- **THEN** `mission.milestoneRelease` is still `r2` and every release's `criticalPath` is unchanged

### Requirement: Removing an initiative milestone marks it

`initiative <id> --remove-milestone "mN:<why>"` SHALL mark the milestone removed with the time and the reason, split at the
first colon. Removed milestones SHALL be absent from `board --json` and present in `initiative show <id> --history`. An
unknown or already-removed id, or a missing reason, SHALL be refused, writing nothing.

#### Scenario: Remove without a reason

- **WHEN** `initiative boards --remove-milestone m1` runs
- **THEN** it is refused naming the `mN:<why>` form and nothing is written

### Requirement: A milestone is recorded as reached with evidence

`initiative <id> --reach-milestone "mN:<evidence>"` SHALL record the milestone reached, with the time and a one-line evidence
note of at most 300 characters. `--unreach-milestone "mN:<why>"` SHALL be its inverse (the human override), clearing the
mark and keeping both events in the milestone's history. No mechanical check SHALL decide either.

#### Scenario: Reach then override

- **WHEN** `initiative boards --reach-milestone "m1:both boards live in 26 repos"` runs, then `initiative boards --unreach-milestone "m1:three repos still fall back"`
- **THEN** after the first `board --json` shows m1 `reachedAt` set with that evidence; after the second `reachedAt` is `null`, and `--history` lists both

#### Scenario: Wrong state refused

- **WHEN** m1 is already reached and `--reach-milestone "m1:again"` runs, or m2 is not reached and `--unreach-milestone "m2:x"` runs
- **THEN** each is refused naming the milestone's state, and nothing is written

### Requirement: Every reference to an initiative is checked

A flag that names an initiative (on `release` and the epic-writing verbs) SHALL refuse an id naming no recorded initiative,
writing nothing. Because no verb deletes one, a dangling reference can only come from a hand edit: `integrity` SHALL report
each one, and `board --json` SHALL read it as `null`.

#### Scenario: Unknown initiative refused

- **WHEN** `update-epic E --initiative nope` or `release r1 --initiative nope` runs and no initiative `nope` exists
- **THEN** it exits non-zero naming `nope` and writes nothing

#### Scenario: Hand-edited reference

- **WHEN** state.json is hand-edited so epic E's `initiative` is `gone`, and `integrity` runs
- **THEN** integrity names E and `gone`, and `board --json` reports E's `initiative` as `null`

### Requirement: board --json lists the initiatives

`board --json` SHALL carry a top-level `initiatives` array in creation order, `[]` when none. Each entry SHALL be
`{id, title, capability, status, outcome, endedAt, source, offMissionReason, nonGoals, milestones: [{id, text, reachedAt,
evidence}]}` with active milestones only, in id order. Ids are validated on write, so a failing id is a hand edit: the export SHALL
skip it and `integrity` report it, NOT a `rejected` entry (0.55.0 closes that kind list). `schemaVersion` stays 1.

#### Scenario: Empty record

- **WHEN** `board --json` runs over a freshly initialised state
- **THEN** `initiatives` is `[]` and `schemaVersion` is `1`

#### Scenario: A hand-edited bad id is skipped, not rejected

- **WHEN** state.json is hand-edited so an initiative's id is `Bad Id`, and `board --json` then `integrity` run
- **THEN** the export omits it, `rejected` holds no entry for it, exit is 0, and integrity names it

### Requirement: The release plan board shows the initiatives

The release plan template SHALL render an Initiatives section listing each initiative's title, capability, status, source
(marked when `UNGROUNDED`) and active initiative milestones with their reached marks, every value escaped. With none, it
SHALL render a guided empty state naming `initiative <id> --title --capability` and that the agent derives candidates.

#### Scenario: Hostile initiative text stays inert

- **WHEN** an initiative's title is `<img src=x onerror=alert(1)>`
- **THEN** the rendered section contains the escaped text and no `<img` element

#### Scenario: No initiatives

- **WHEN** the snapshot's `initiatives` is `[]`
- **THEN** the section renders the guided empty state and no bare "not set"

### Requirement: The rules block carries the challenge rule while an initiative is open

While at least one initiative is `open`, the managed rules block SHALL carry an `## Initiatives` section of at most 280
bytes, heading included, stating the challenge-once rule and naming both reason flags; every code span in it SHALL run as
written. With none open it SHALL be absent. Every builder of the block SHALL include it; `initiative` refreshes it, and
`overhead` reports it as `rules:initiatives`.

#### Scenario: Present, bounded and absent

- **WHEN** an initiative is created, and later every initiative is ended
- **THEN** after the first the block holds `## Initiatives` within 280 bytes; after the second it holds no `## Initiatives`

#### Scenario: Another rewrite keeps it

- **WHEN** an initiative is open and `set-boards off`, `mission --statement "x" --reason "r"` or the `rules` verb rewrites the block
- **THEN** the block still holds the same `## Initiatives` section

### Requirement: Candidates are derived and confirmed, never invented

The `project-boards` skill's "First population" procedure SHALL tell the agent to derive candidate initiatives, initiative
milestones, release primary initiatives and epic kinds by clustering the backlog, docs and issues; to record each
initiative's `--source`, or `UNGROUNDED` when it cannot ground one; to ask "Does this make sense?"; and to write only
confirmed answers.

#### Scenario: The skill states the procedure

- **WHEN** `skills/project-boards/SKILL.md` is read
- **THEN** it names clustering the existing backlog, `--source` and UNGROUNDED, the question "Does this make sense?", that the user never has to name an initiative or an initiative milestone, and that nothing unconfirmed is written

### Requirement: Off-mission and off-initiative work is challenged once

The conductor skill's Intake SHALL tell the agent to challenge each initiative against the mission, and each off-initiative
epic, once; to read the record's `board --json` entry first and never re-flag a recorded reason; to record the answer with
`--off-mission-reason` or `--off-initiative-reason`; to exempt `claude-code`-lane epics; and to ask the orchestrating agent
before the human.

#### Scenario: The skill states the rule

- **WHEN** `skills/conductor/SKILL.md` is read
- **THEN** its Intake names both reason flags, "once", initiatives as well as epics, reading the recorded reason before challenging, the `claude-code` exemption, and the orchestrating-agent-first order
