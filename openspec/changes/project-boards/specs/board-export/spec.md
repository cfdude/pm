## ADDED Requirements

### Requirement: board is a read-only snapshot verb

The engine SHALL provide a verb `board`. `board --json` SHALL print one JSON object. Plain `board` SHALL print a
short text summary of the same snapshot: counts, the "here" release and the mission statement. `board` SHALL write
nothing (no state file, no rules block, no log), SHALL be declared read-only in the verb registry, SHALL run no git
command and SHALL open no network connection.

#### Scenario: board writes nothing

- **WHEN** `board --json` runs over a state with epics, releases and a mission
- **THEN** the state file, `CLAUDE.md` and every log under `.conductor/` are byte-identical to before

#### Scenario: board is declared read-only

- **WHEN** the verb registry is read
- **THEN** `board` is present with a read-only effect, and the registry and dispatch-table equality test passes

#### Scenario: plain board prints a summary

- **WHEN** `board` runs without `--json`
- **THEN** it prints the open-epic count, the `here` release id or `none`, and the mission statement or `no mission`, and exits 0

### Requirement: The snapshot has a stable versioned shape

`board --json` SHALL emit `schemaVersion` (the integer 1 for this release), `pmVersion`, `asOf` (an ISO time),
`boardsEnabled` (the boards switch, `true` when unset), `counts`, `mission`, `milestone`, `plan`, `releases`, `epics` and `rejected`. An unknown value SHALL be present as
`null` or `[]`, never omitted. Changing the meaning of an existing key SHALL increment `schemaVersion`.

#### Scenario: Every top-level key is present on an empty record

- **WHEN** `board --json` runs over a freshly initialised state
- **THEN** every named top-level key is present, `mission`, `milestone` and `plan.here` are `null`, and `releases`, `epics` and `rejected` are `[]`

#### Scenario: schemaVersion is 1

- **WHEN** `board --json` runs
- **THEN** `schemaVersion` is the integer `1`

### Requirement: Open epics come in engine order

`epics` SHALL list every non-archived epic first, in the order the engine's shared epic ordering produces (the order
`next` and `PROJECT.md` use). Each entry's `position` SHALL be its zero-based index in that order, and `priority`
SHALL be the effective priority.

#### Scenario: Order matches the engine ordering

- **WHEN** three open epics have priorities P2, P1 and P1 and ranks such that the engine orders them B, A, C
- **THEN** `epics` lists B, A, C with `position` 0, 1, 2

### Requirement: Each epic entry carries the board fields

Each epic entry SHALL carry `id`, `title`, `summary`, `whyNow`, `description`, `lane`, `status`, `priority`, `rank`,
`position`, `release`, `externalUrl`, `dependsOn`, `delivered`, `outcome`, `outcomeReason` and `updatedAt`. Any field
the epic does not carry, or carries as a non-string where a string is expected, SHALL be `null`. `rank` SHALL be the
recorded rank, or `null` if there is none.

#### Scenario: Recorded rank is carried and an unranked epic reports null

- **WHEN** epic A has rank 2 and epic B has no rank
- **THEN** A's `rank` is 2 and B's `rank` is `null`

#### Scenario: A non-string summary reads as null

- **WHEN** an epic's stored `summary` is a number
- **THEN** its entry's `summary` is `null`

### Requirement: delivered is derived once, in three states

`delivered` SHALL be `true` for an archived epic whose disposition outcome is `delivered`. It SHALL be `false` for an
archived epic with any other recorded outcome, and for any epic that is not archived. It SHALL be `null` for an
archived epic with no recorded disposition, meaning unknown. It SHALL never be inferred from `status` alone.
`outcome` and `outcomeReason` SHALL copy the disposition, or be `null` when there is none.

#### Scenario: Archived with outcome delivered

- **WHEN** an archived epic's disposition outcome is `delivered`
- **THEN** its `delivered` is `true`

#### Scenario: Archived with outcome declined

- **WHEN** an archived epic's disposition outcome is `declined` with reason "out of scope"
- **THEN** its `delivered` is `false`, `outcome` is `declined` and `outcomeReason` is "out of scope"

#### Scenario: Archived with no disposition

- **WHEN** an archived epic carries no disposition
- **THEN** its `delivered` is `null`

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
those of epics that exist in the record. A target that names no existing epic SHALL be left out and recorded in
`rejected` with the reason `dangling depends-on`. Links of other types SHALL NOT appear.

#### Scenario: A depends-on link resolves

- **WHEN** epic A carries `depends-on:B` and `relates-to:C`, and B and C exist
- **THEN** A's `dependsOn` is `["B"]`

#### Scenario: A dangling target is reported

- **WHEN** epic A carries `depends-on:gone` and no epic `gone` exists
- **THEN** A's `dependsOn` is `[]` and `rejected` holds an entry for A with the reason `dangling depends-on`, naming `gone`

### Requirement: Ids that fail the board id format are rejected, not emitted

Every epic id, release id and member id SHALL match `/^[A-Za-z0-9._-]+$/` before it is emitted. A record that fails
SHALL be left out of `epics` or `releases` and listed in `rejected` as `{kind, id, reason: "id format"}`, with control
characters in the id escaped. The rest of the snapshot SHALL still be emitted, and the exit code SHALL be 0.

#### Scenario: A malformed epic id is excluded and named

- **WHEN** the state holds an epic whose id is `a"><img src=x>` alongside a valid epic
- **THEN** `epics` holds only the valid epic, `rejected` holds one entry of kind `epic` with reason `id format`, and the exit code is 0

#### Scenario: A malformed release member is excluded

- **WHEN** a release's derived members include an id that fails the format
- **THEN** that id is absent from the release's `members` and is listed in `rejected`

### Requirement: Releases are listed in plan order with their plan fields

`releases` SHALL list every release, ordered by `order` ascending and then by id, with unordered releases last. Each
entry SHALL carry `id`, `intent`, `target`, `theme`, `rationale`, `exit`, `order`, `size`, `status` (derived),
`delivered`, `criticalPath`, `members` (derived) and `deferred`. Absent fields SHALL be `null`.

#### Scenario: Release ordering

- **WHEN** releases r2 (order 2), r1 (order 1) and rx (no order) exist
- **THEN** `releases` lists r1, r2, rx

### Requirement: counts partition the record

`counts` SHALL carry `open` and `byPriority` (keyed P0, P1, P2, P3 and `P?`), and `delivered`, `notPursued` and
`unknownOutcome`, which count archived epics whose `delivered` is true, false and null respectively. It SHALL also
carry `unassigned`, the number of open epics in no release. Counts SHALL cover the whole record, not only the window.

#### Scenario: Counts partition the archived epics

- **WHEN** the record holds 3 archived epics delivered, 2 declined and 1 with no disposition
- **THEN** `counts.delivered` is 3, `counts.notPursued` is 2 and `counts.unknownOutcome` is 1
