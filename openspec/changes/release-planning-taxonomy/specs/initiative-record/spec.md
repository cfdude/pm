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

### Requirement: An initiative is ended, never deleted

`initiative <id> --end --reason "<why>"` SHALL set the status to `ended` and append `{event: "ended", at, reason}` to its
history. `--reopen --reason "<why>"` SHALL be its inverse, setting `open` and appending a `reopened` event. `--reason` serves
only these two. Ending an ended initiative or reopening an open one SHALL be refused, writing nothing. No verb SHALL delete one.

#### Scenario: End then reopen keeps both events

- **WHEN** `initiative boards --end --reason "folded into reporting"` runs and then `initiative boards --reopen --reason "split back out"` runs
- **THEN** `initiative show boards --history` lists both events with their reasons, and the status is `open`

#### Scenario: A reason is required

- **WHEN** `initiative boards --end` runs without `--reason`, or with `--reason ""`
- **THEN** it is refused naming a non-empty reason and nothing is written

#### Scenario: Ending keeps every reference

- **WHEN** epic E and release r1 name initiative `boards` and `initiative boards --end --reason "done"` runs
- **THEN** E's `initiative` and r1's `initiative` still read `boards`, and `board --json` lists `boards` with status `ended`

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
`{id, title, capability, status, endedAt, milestones: [{id, text}]}` with active milestones only, in id order. An entry
whose id fails the board id format SHALL be omitted and left to `integrity`. `schemaVersion` SHALL stay 1.

#### Scenario: Empty record

- **WHEN** `board --json` runs over a freshly initialised state
- **THEN** `initiatives` is `[]` and `schemaVersion` is `1`

### Requirement: The release plan board shows the initiatives

The release plan template SHALL render an Initiatives section listing each initiative's title, capability, status and
active initiative milestones, every value escaped like every other interpolation. With none, it SHALL render a guided empty
state naming `initiative <id> --title --capability` and that the agent derives candidates for the user to confirm.

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
milestones, release primary initiatives and epic kinds from the repo, its docs and issues by clustering the backlog; to mark
each candidate it cannot ground UNGROUNDED; to ask "Does this make sense?"; and to write only confirmed answers.

#### Scenario: The skill states the procedure

- **WHEN** `skills/project-boards/SKILL.md` is read
- **THEN** it names clustering the existing backlog, the UNGROUNDED mark, the question "Does this make sense?", that the user never has to name an initiative or milestone, and that nothing unconfirmed is written

### Requirement: Off-mission and off-initiative work is challenged once

The conductor skill's Intake SHALL tell the agent to challenge off-mission or off-initiative work once, to accept a stated
reason and record it with `--off-mission-reason` or `--off-initiative-reason`, to read the epic's `board --json` entry first and
never re-flag a recorded reason, to exempt
`claude-code`-lane work, and to ask the orchestrating agent first and the human only when that agent lacks authority.

#### Scenario: The skill states the rule

- **WHEN** `skills/conductor/SKILL.md` is read
- **THEN** its Intake names both reason flags, "once", reading the recorded reason before challenging, the `claude-code` exemption, and the orchestrating-agent-first order
