## ADDED Requirements

### Requirement: A release names its primary initiative or declares maintenance

`release <id> --initiative <initiativeId>` SHALL record the release's ONE primary initiative; `--maintenance` (valueless)
SHALL record that it serves none. Setting either SHALL replace the other; both in one invocation SHALL be refused. The
valueless `--clear-initiative` SHALL remove either. `release here` SHALL accept none of these flags.

#### Scenario: Set, switch and clear

- **WHEN** `release r1 --initiative boards` runs, then `release r1 --maintenance`, then `release r1 --clear-initiative`
- **THEN** `board --json` reports r1 as `{initiative: "boards", maintenance: false}`, then `{initiative: null, maintenance: true}`, then `{initiative: null, maintenance: false}`

#### Scenario: Both at once

- **WHEN** `release r1 --initiative boards --maintenance` runs
- **THEN** it is refused naming the two as exclusive, and nothing is written

#### Scenario: The plan marker takes none

- **WHEN** `release here r1 --initiative boards` runs
- **THEN** it is refused naming `--text`, `--next` and `--clear-here`, and nothing is written

### Requirement: The release goal is its theme

A release's goal SHALL be its existing `theme`: no `--goal` flag and no second goal field SHALL exist. The release plan board
and `release show <id>` SHALL label the theme "Goal"; the JSON key stays `theme`.

#### Scenario: No goal flag

- **WHEN** `release r1 --goal "x"` runs
- **THEN** it is refused as an unknown flag and nothing is written

#### Scenario: Labelled Goal

- **WHEN** r1 has theme "Lock the API" and `release show r1` runs
- **THEN** the output reads `goal: Lock the API`

### Requirement: Every member counts in the release's split

Each release SHALL count every member, in any lane, into exactly one of `health` (effective kind `health`), `initiativeWork`
(otherwise, naming a primary initiative) and `unaligned` (neither). The effective kind is the recorded `kind`; a
`claude-code`-lane epic without one reads as `initiative-work` when it names an initiative, else `health`. The split is
derived on every read, never stored.

#### Scenario: Counting by category

- **WHEN** r1 has 7 members of kind `initiative-work` naming an initiative, 2 of kind `health`, and 1 `superpowers` epic with no kind and no initiative
- **THEN** r1's split is `{initiativeWork: 7, health: 2, unaligned: 1}`

#### Scenario: Claude-code defaults

- **WHEN** r1's members are two `claude-code` epics with no kind, one naming initiative boards and one naming none
- **THEN** the first counts as `initiativeWork` and the second as `health`

#### Scenario: Unaligned is visible

- **WHEN** a member has kind `initiative-work` and no initiative, even with an `offInitiativeReason`
- **THEN** it counts as `unaligned`

### Requirement: The health share is checked against a fixed band

`healthShare` SHALL be `health` divided by the member count, or `null` with no members; `target` SHALL be the fixed `0.2`.
`drift` SHALL be `true` when the share is below `HEALTH_SHARE_MIN` (0.10) or above `HEALTH_SHARE_MAX` (0.30), engine
constants and not settings, `false` otherwise, and `null` when the share is `null`.

#### Scenario: No health drifts

- **WHEN** r1 has 10 members and none counts as `health`
- **THEN** r1's `healthShare` is `0` and `drift` is `true`

#### Scenario: Inside the band

- **WHEN** r1 has 10 members of which 1, 2 or 3 count as `health`
- **THEN** `drift` is `false` in each case

#### Scenario: Too much health drifts

- **WHEN** r1 has 10 members of which 4 count as `health`
- **THEN** `drift` is `true`

### Requirement: An override is a recorded reason, never a switch

`release <id> --split-reason "<line>"` (one line, at most 400 characters) SHALL record why the release departs from 80/20,
and the valueless `--clear-split-reason` SHALL remove it. A recorded reason SHALL NOT change `drift` or hide the split. No
verb, flag or setting SHALL turn the report off or change the target or the band.

#### Scenario: Reason shown beside the drift

- **WHEN** r1 drifts and `release r1 --split-reason "platform migration: 80% migration, 20% critical fixes"` runs
- **THEN** `board --json` reports r1's `drift: true` and `reason` equal to that text

### Requirement: A release whose members do not serve its primary initiative is flagged

A release that names a primary initiative SHALL report `primaryServed: false` when it has members and none names that
initiative as primary or secondary, `true` when one does, and `null` with no members or no primary. `release show <id>`
SHALL print a warning line while it is `false`.

#### Scenario: No member serves it

- **WHEN** r1 names initiative boards and its two members both name initiative reporting
- **THEN** `board --json` reports r1's `primaryServed: false` and `release show r1` prints a line naming boards as served by no member

### Requirement: Membership records when an epic joined the release

`release <id> --member <epic>` SHALL record on the epic `releaseJoinedAt`, the time it joined, replacing any earlier value
when the epic moves releases; `--unmember` SHALL remove it with the membership. An epic that joined before 0.56.0 SHALL read
`releaseJoinedAt: null`; nothing backfills it.

#### Scenario: Moving releases

- **WHEN** `release r1 --member E` runs, and later `release r2 --member E`
- **THEN** E's `releaseJoinedAt` is the second run's time, and r1's amendments record the move as they do today

### Requirement: A release derives its planning baseline and reports scope added since

A release's `planningBaseline` SHALL be derived, never recorded: the earliest `startedAt` among its members that have one, or
`null` when no member has started. With a baseline, the release SHALL report `addedSincePlanning` (members whose
`releaseJoinedAt` is later) and `unknownJoinTime` (members with none); without one, both SHALL be `null`. No flag sets it.
This is a report, never a refusal.

#### Scenario: Scope added after planning

- **WHEN** E1 and E2 join r1, E1 becomes active (stamping its `startedAt`), then E3 joins r1
- **THEN** `board --json` reports r1's `planningBaseline` as E1's `startedAt`, `addedSincePlanning: 1` and `unknownJoinTime: 0`, and `release show r1` prints `1 epic added since planning`

#### Scenario: No baseline

- **WHEN** no member of r1 has a `startedAt`
- **THEN** `planningBaseline`, `addedSincePlanning` and `unknownJoinTime` are `null` and `release show r1` prints no scope line

#### Scenario: No planning flag

- **WHEN** `release r1 --planned` runs
- **THEN** it is refused as an unknown flag and nothing is written

### Requirement: Untracked tweaks have a per-release maintenance epic

The conductor skill SHALL name the destination for a tweak too small for its own epic: the epic `maintenance-<releaseId>`
(lane `claude-code`, kind `health`, a member of that release), registered by the agent on the first such tweak, its commits
recorded with `update-epic --attribute-commit`, and ended with the release by the normal disposition. A tweak that moves an
initiative SHALL instead be a small `claude-code` epic naming it.

#### Scenario: The skill states both destinations

- **WHEN** `skills/conductor/SKILL.md` is read
- **THEN** it names `maintenance-<releaseId>`, its lane, kind and membership, `--attribute-commit`, ending with the release, and the small claude-code epic for a tweak that moves an initiative

### Requirement: The commit nudge offers the two destinations

When the commit nudge says a commit may not be the active epic's work, and the active epic is a member of a release, it SHALL
name the two destinations: `maintenance-<releaseId>` with a runnable `update-epic … --attribute-commit <sha>` (preceded by the
runnable `add-epic` and `release --member` commands when that epic does not exist yet), or a small claude-code epic naming the
initiative.

#### Scenario: The untied branch names the maintenance epic

- **WHEN** a commit lands whose subject and paths do not name the active epic A, A is a member of 0.56.0, and no `maintenance-0.56.0` exists
- **THEN** the nudge names `maintenance-0.56.0`, prints its `add-epic`, `release 0.56.0 --member` and `--attribute-commit` commands with the commit's sha, and every command in it runs as written

#### Scenario: No release, no extra text

- **WHEN** the active epic is a member of no release
- **THEN** the nudge text is unchanged from 0.55.0

### Requirement: release show prints the purpose and the split

`release show <id>` SHALL print `initiative: <id> (<title>)` or `initiative: maintenance` when recorded, and one split line
`split: N initiative work, N health, N unaligned; health X% (target 20%, band 10-30%)`, ending `, DRIFT` when `drift` is
true and adding the recorded reason. `release show` with no id SHALL append the primary initiative id or `maintenance`.

#### Scenario: Drift is said

- **WHEN** r1 names initiative boards, has 10 `initiative-work` members naming boards and no reason recorded
- **THEN** `release show r1` prints `initiative: boards` and a split line ending `, DRIFT`

### Requirement: board --json carries the release purpose, split and scope

Each `board --json` release entry SHALL carry `initiative`, `maintenance`, `splitReason`, `primaryServed`, `planningBaseline`,
`addedSincePlanning`, `unknownJoinTime` and `split: {initiativeWork, health, unaligned, healthShare, target, drift, reason}`.
These keys are additive, so `schemaVersion` SHALL stay 1.

#### Scenario: A release with nothing recorded

- **WHEN** `board --json` runs over a release with no members and no purpose
- **THEN** its entry has `initiative: null`, `maintenance: false`, `splitReason: null`, `primaryServed: null`, `planningBaseline: null`, zero counts, `healthShare: null` and `drift: null`

### Requirement: The release plan board shows each release's purpose and split

Each release card SHALL show its primary initiative's title (or "Maintenance"), its Goal, its split with the unaligned count,
drift and the recorded reason, the unserved-primary warning and the scope-added line when set; a release with neither purpose
SHALL render a guided empty state naming `release <id> --initiative <id>` and `--maintenance`. Every value SHALL be escaped.

#### Scenario: Maintenance release

- **WHEN** r1 is a maintenance release
- **THEN** its card reads "Maintenance" and renders no guided empty state for the initiative

#### Scenario: Hostile split reason

- **WHEN** r1's split reason is `<b onmouseover=alert(1)>x`
- **THEN** the card shows the escaped text and no `<b` element
