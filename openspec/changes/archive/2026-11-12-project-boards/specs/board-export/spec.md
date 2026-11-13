## ADDED Requirements

### Requirement: rejected entries have one shape and a closed reason list

Every `rejected` entry SHALL be `{kind, id, field, value, reason}`. `kind` is one of `epic`, `release`, `link`, `url`, `plan`, `milestone` or
`project`. `id` is the record concerned (escaped) or `null`; `value` is the offending value, escaped. `reason` is one of `id format`, `dangling depends-on`,
`url scheme`, `here names no release`, `milestone names no release` or `project format`. A field SHALL yield at most one entry, and no
other spec SHALL add a reason without adding it here.


#### Scenario: Id format wins

- **WHEN** `plan.here` holds a value that fails the id format and also names no release
- **THEN** `rejected` holds one entry for `plan.here`, with reason `id format`

#### Scenario: Every entry carries all five keys

- **WHEN** a fixture produces one rejection of each reason
- **THEN** `rejected` holds six entries, each with exactly the keys `kind`, `id`, `field`, `value` and `reason`

### Requirement: board is a read-only snapshot verb

The engine SHALL provide a verb `board`. `board --json` SHALL print one JSON object. Plain `board` SHALL print a
short text summary of the same snapshot: counts, the "here" release and the mission statement. `board` SHALL write
nothing (no state file, no rules block, no log), SHALL be declared read-only in the verb registry with an
`exercise` argument list, SHALL run no git command and SHALL open no network connection.

#### Scenario: board writes nothing

- **WHEN** `board --json` runs over a state with epics, releases and a mission
- **THEN** the state file, `CLAUDE.md` and every log under `.conductor/` are byte-identical to before

#### Scenario: board is declared read-only

- **WHEN** the verb registry is read
- **THEN** `board` is present with a read-only effect and an `exercise` list, and the registry and dispatch-table equality test passes

#### Scenario: plain board prints a summary

- **WHEN** `board` runs without `--json`
- **THEN** it prints the open-epic count, the `here` release id or `none`, and the mission statement or `no mission`, and exits 0

### Requirement: The snapshot has a stable versioned shape

`board --json` SHALL emit `schemaVersion` (the integer 1 for this release), `pmVersion`, `asOf` (an ISO time),
`boardsEnabled` (`true` when the switch is unset), `counts`, `mission`, `milestone`, `plan`, `releases`, `epics` and
`rejected`. An unknown value SHALL be `null` or `[]`, never omitted. A change in an existing key's meaning SHALL
increment `schemaVersion`.

#### Scenario: Every top-level key is present on an empty record

- **WHEN** `board --json` runs over a freshly initialised state
- **THEN** every named top-level key is present, `mission`, `milestone` and `plan.here` are `null`, and `releases`, `epics` and `rejected` are `[]`

#### Scenario: schemaVersion is 1

- **WHEN** `board --json` runs
- **THEN** `schemaVersion` is the integer `1`

### Requirement: The mission and milestone objects have a fixed shape

`mission` SHALL be `null` or `{statement, setAt, reason}`. `milestone` SHALL be `null` or
`{release, criteria: [{id, text, check, needsHuman}]}`, where `criteria` lists active criteria only, in id order.
`plan` SHALL be `{here, hereText, nextText}`, with each field `null` when unset.

#### Scenario: Milestone shape

- **WHEN** a mission milestone r2 is set with criteria c1 (with a check) and c2 (needs human)
- **THEN** `milestone` is `{release: "r2", criteria: [{id: "c1", …, needsHuman: false}, {id: "c2", check: null, needsHuman: true}]}`

### Requirement: Open epics come in the flat resolveEpics() order

`epics` SHALL list the registered non-archived epics first, in the order `resolveEpics()` produces for `PROJECT.md`:
effective priority, then merit priority, then rank, then lane, then id. That order applies no dependency pass. It is
not the brief's NEXT UP order, which also runs `orderQueueWithDependencies` over queued and untriaged epics. An epic
`resolveEpics()` invents for an unregistered on-disk change SHALL NOT be listed. `counts.unregisteredChanges` SHALL
count those epics.

#### Scenario: Order matches the render ordering

- **WHEN** three open epics have merit priorities P2, P1 and P1, no dependencies, and ranks such that `resolveEpics()` orders them B, A, C
- **THEN** `epics` lists B, A, C with `position` 0, 1, 2

#### Scenario: An unregistered change is counted, not listed

- **WHEN** a change directory exists on disk with no registered epic
- **THEN** no entry for it appears in `epics` and `counts.unregisteredChanges` is 1

### Requirement: Each epic entry carries the board fields

Each epic entry SHALL carry `id`, `title`, `summary`, `whyNow`, `description`, `lane`, `status`, `priority` (the
effective priority), `meritPriority`, `rank` (the recorded rank, or `null`), `position`, `release`, `externalUrl`,
`dependsOn`, `delivered`, `outcome`, `outcomeReason`, `createdAt`, `endedAt` and `updatedAt`. A field the
epic does not carry, or that is a non-string where a string is expected, SHALL be `null`.

#### Scenario: Recorded rank is carried and an unranked epic reports null

- **WHEN** epic A has rank 2 and epic B has no rank
- **THEN** A's `rank` is 2 and B's `rank` is `null`

#### Scenario: A lifted blocker shows both priorities

- **WHEN** merit-P3 epic B is a `depends-on` target of P1 epic A
- **THEN** B's `priority` is `P1` and its `meritPriority` is `P3`

#### Scenario: Time fields come from the record

- **WHEN** an epic is read
- **THEN** `createdAt` is its `createdAt`, `endedAt` is the disposition's `recordedAt` else `completedAt`, and `updatedAt` is its `touchedAt`, each `null` when absent

#### Scenario: createdAt and endedAt are carried

- **WHEN** an archived epic has `createdAt` "2026-10-01T00:00:00Z" and a disposition `recordedAt` "2026-11-01T00:00:00Z"
- **THEN** its `createdAt` and `endedAt` are those times, and an open epic's `endedAt` is `null`

#### Scenario: updatedAt is touchedAt

- **WHEN** an epic has `touchedAt` "2026-11-01T00:00:00Z" and another has none
- **THEN** their `updatedAt` values are that time and `null`

### Requirement: delivered is derived from the one outcome reader, in three states

`outcome` SHALL be the engine's single outcome reader (`outcomeOf`) applied to the epic when it carries a disposition,
and `null` when it carries none, exactly as `list --json` reports it. `delivered` SHALL be `true` when the epic is
archived and `outcome` is `delivered`. It SHALL be `null` when the epic is archived and `outcome` is `null` or
`unknown`, which includes every engine stamp written with outcome `unknown`. It SHALL be `false` otherwise.

#### Scenario: Archived with outcome delivered

- **WHEN** an archived epic's disposition outcome is `delivered`
- **THEN** its `delivered` is `true`

#### Scenario: Archived with outcome declined

- **WHEN** an archived epic's disposition outcome is `declined` with reason "out of scope"
- **THEN** its `delivered` is `false`, `outcome` is `declined` and `outcomeReason` is "out of scope"

#### Scenario: An engine stamp is unknown, not delivered

- **WHEN** an archived epic carries an engine stamp `{outcome: "unknown", recordedBy: <an engine stamp token>}`
- **THEN** its `outcome` is `unknown` and its `delivered` is `null`

#### Scenario: Archived with no disposition

- **WHEN** an archived epic carries no disposition
- **THEN** its `outcome` and `delivered` are both `null`

#### Scenario: Open epic

- **WHEN** an epic is `queued`
- **THEN** its `delivered` is `false`

### Requirement: Ended epics come in a bounded recent window

After the open epics, `epics` SHALL list archived epics with the most recently ended first. The end time is the
disposition's `recordedAt`, else `completedAt`. Archived epics with neither come last, ordered by id. By default the
50 most recent are included.

#### Scenario: Default window

- **WHEN** the record holds 60 archived epics and `board --json` runs
- **THEN** exactly 50 archived entries appear, most recently ended first

### Requirement: The ended-epic window is adjustable

`--archived <n>` SHALL set the window to n epics, and `--archived all` SHALL include every archived epic. A value that
is neither a positive integer nor `all` SHALL be refused, naming the accepted values, and no JSON SHALL be printed.

#### Scenario: All archived

- **WHEN** `board --json --archived all` runs over 60 archived epics
- **THEN** 60 archived entries appear

#### Scenario: Bad bound refused

- **WHEN** `board --json --archived 0` runs
- **THEN** it exits non-zero naming "a positive integer or all" and prints no JSON

### Requirement: dependsOn is resolved

`dependsOn` SHALL list the ids that the epic's `depends-on` links target, in link order, without duplicates, and only
those of registered epics. A target that names no registered epic SHALL be left out and recorded in `rejected` with
`kind: "link"`, `field: "dependsOn"`, the target as `value` and the reason `dangling depends-on`. Links of other types SHALL NOT appear.

#### Scenario: A depends-on link resolves

- **WHEN** epic A carries `depends-on:B` and `relates-to:C`, and B and C exist
- **THEN** A's `dependsOn` is `["B"]`

#### Scenario: A dangling target is reported

- **WHEN** epic A carries `depends-on:gone` and no epic `gone` exists
- **THEN** A's `dependsOn` is `[]` and `rejected` holds `{kind: "link", id: "A", field: "dependsOn", value: "gone", reason: "dangling depends-on"}`

### Requirement: Every emitted id passes the board id format

Every id the snapshot emits SHALL match `/^[A-Za-z0-9._-]+$/`: epic, release and member ids, `dependsOn` targets, an
epic's `release`, `plan.here`, `milestone.release` and criterion ids. A record with a failing id SHALL be omitted; a
failing reference SHALL become `null` or leave its list. Each failure SHALL appear in `rejected` with
reason `id format`, control characters escaped, and the verb SHALL still exit 0.

#### Scenario: A malformed epic id is excluded and named

- **WHEN** the state holds an epic whose id is `a"><img src=x>` alongside a valid epic
- **THEN** `epics` holds only the valid epic, `rejected` holds one entry of kind `epic` with reason `id format`, and the exit code is 0

#### Scenario: A malformed reference is nulled

- **WHEN** a valid epic's `release` is `r1"><b>` and `plan.here` holds the same value
- **THEN** that epic's `release` and `plan.here` are `null`, and `rejected` names both fields

#### Scenario: A malformed release member is excluded

- **WHEN** a release's derived members include an id that fails the format
- **THEN** that id is absent from the release's `members` and is listed in `rejected`

### Requirement: externalUrl is emitted only with an http or https scheme

`externalUrl` SHALL be emitted only when it parses as an absolute URL whose scheme is `http` or `https`. Otherwise it
SHALL be `null` and listed in `rejected` with the reason `url scheme`.

#### Scenario: A javascript URL is not emitted

- **WHEN** an epic's `externalUrl` is `javascript:alert(1)`
- **THEN** its entry's `externalUrl` is `null` and `rejected` holds `{kind: "url", id: <that epic>, field: "externalUrl", value: "javascript:alert(1)", reason: "url scheme"}`

#### Scenario: An https URL is emitted

- **WHEN** an epic's `externalUrl` is `https://github.com/o/r/issues/1`
- **THEN** its entry carries that URL unchanged

### Requirement: Releases are listed in plan order with their plan fields

`releases` SHALL list every release, ordered by `order` ascending and then by id, with unordered releases last. Each
entry SHALL carry `id`, `intent`, `target`, `theme`, `rationale`, `exit`, `order`, `size`, `status` (derived),
`delivered`, `criticalPath`, `members` (derived) and `deferred`. Absent fields SHALL be `null`.

#### Scenario: Release ordering

- **WHEN** releases r2 (order 2), r1 (order 1) and rx (no order) exist
- **THEN** `releases` lists r1, r2, rx

### Requirement: counts partition the record

`counts` SHALL carry `open`, `unregisteredChanges`, `unassigned` (open epics in no release) and `byPriority`, which is
keyed P0, P1, P2, P3 and `P?` and counted by effective priority. `delivered`, `notPursued` and `unknownOutcome` SHALL
count archived epics whose `delivered` is true, false and null respectively. Counts SHALL cover the whole record, not
only the window.

#### Scenario: Counts partition the archived epics

- **WHEN** the record holds 3 archived epics delivered, 2 declined, 1 engine-stamped `unknown` and 1 with no disposition
- **THEN** `counts.delivered` is 3, `counts.notPursued` is 2 and `counts.unknownOutcome` is 2

### Requirement: The snapshot names the project, and each epic carries its number and key

`board --json` SHALL emit a top-level `project` object `{name, key}` (each `null` when unset or invalid; an invalid stored value is named in
`rejected[]` with reason `project format`) and, on each epic entry, `number` (or `null`) and `key` (`projectKey-number`, or `null`
while either is missing). The export SHALL derive nothing. `schemaVersion` stays 1: the keys are additive and unreleased.


#### Scenario: Unset project

- **WHEN** `board --json` runs over a record with no `projectName` and no `projectKey`
- **THEN** `project` is `{name: null, key: null}` and every epic's `key` is `null`

#### Scenario: Set project and numbered epics

- **WHEN** `projectKey` is "PM", `projectName` is "Project Manager", and epic a has number 256
- **THEN** `project` is `{name: "Project Manager", key: "PM"}` and a's `number` is 256 and `key` is "PM-256"

#### Scenario: An invalid stored value is rejected, not emitted

- **WHEN** a hand-edited record holds `projectKey` "pm<x"
- **THEN** `project.key` is `null`, every `key` is `null`, and `rejected[]` names it with reason `project format`

### Requirement: Each release carries its progress

Each release entry SHALL carry `progress: {done, total}` over its member epics, computed from the same `delivered` and
`outcome` values the epic entries carry and over every member in the record, not only those inside the ended-epic window.
`total` SHALL count every member whose outcome is not `declined`; `done` SHALL count those whose `delivered` is `true`. A
release with no members SHALL report `{done: 0, total: 0}`.

#### Scenario: Progress over mixed members

- **WHEN** release r1 has members: two delivered, one open, one declined, one killed
- **THEN** r1's `progress` is `{done: 2, total: 4}`

#### Scenario: Progress ignores the window

- **WHEN** `board --json --archived 1` runs and r1 has three delivered members that fall outside the window
- **THEN** r1's `progress.done` is still 3

### Requirement: Each release lists what did not ship, with the recorded reason

Each release entry SHALL carry `unshipped`, derived once in the export: one `{epic, title, outcome, reason, supersededBy}` row per member whose `delivered` is not `true`, then one per deferral that is not already a row, read over every member and not only the ended-epic window. `progress` SHALL be unchanged. The row rules are in the scenarios.

#### Scenario: Outcome, title and reason

- **WHEN** a row is built
- **THEN** `outcome` is the recorded outcome, `open` for a member not yet ended, `unknown` for an ended member with no outcome or the engine stamp `unknown`, or `deferred` for a deferral that is not a member; `title` is the epic's title or `null` for an unknown epic; `reason` is the disposition's `reason` (else the release's deferral reason), capped at 300 characters with a trailing `…`, control characters escaped as `escapeControls` does, and `null` when none is recorded or the outcome is `unknown`

#### Scenario: A superseded member is listed with its recorded reason

- **WHEN** release r1 has one delivered member and one member whose outcome is `superseded` with reason "folded into x"
- **THEN** r1's `progress` is `{done: 1, total: 2}` and `unshipped` is one row `{epic, title, outcome: "superseded", reason: "folded into x", supersededBy: null}`

#### Scenario: A deferral is a row

- **WHEN** release r1 has a `deferred` entry for an epic that is not one of its members, with reason "later"
- **THEN** `unshipped` holds `{epic, title, outcome: "deferred", reason: "later", supersededBy: null}`, where `title` is that epic's title, or `null` when the epic is not registered

#### Scenario: No reason is never invented

- **WHEN** an ended member's outcome is `unknown`, or an open member has no disposition, or a deferral records no reason
- **THEN** its row's `reason` is `null`

#### Scenario: A structured supersedes link names the successor

- **WHEN** epic b carries a link `{type: "supersedes", epic: a}` and a is an unshipped member of r1
- **THEN** a's row has `supersededBy: "b"`; a reason that merely mentions "b" sets nothing

#### Scenario: A long reason is capped

- **WHEN** a recorded reason is 400 characters
- **THEN** the row's `reason` is 300 characters ending in `…`
