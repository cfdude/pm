# project-boards Specification

## Purpose
TBD - created by archiving change project-boards. Update Purpose after archive.

## Requirements

### Requirement: One bundled skill and a thin command own the boards

pm SHALL ship a skill `project-boards` (`skills/project-boards/SKILL.md`) with two page templates under
`skills/project-boards/templates/`: a release plan and a backlog. It SHALL ship a command `/pm:boards`
(`commands/boards.md`) that loads the skill and runs its refresh. Every shipped file SHALL be claimed by exactly one
capability in the parity ledger.

#### Scenario: Ledger claims every boards file

- **WHEN** the parity test runs
- **THEN** `skills/project-boards/SKILL.md`, each file under `skills/project-boards/templates/`, `commands/boards.md` and `commands/mission.md` are each claimed exactly once, and no `commands/board.md` exists

### Requirement: The skill is the single home of the boards procedure

The skill SHALL be the only place that states the database contract, the access rules, the refresh procedure, the
drag-apply procedure, the standalone fallback and the registration step. The command doc, the `## Boards` rules-block
section and the brief line SHALL point to the skill and SHALL NOT restate any of these.

#### Scenario: Pointers do not restate the procedure

- **WHEN** `commands/boards.md` and the `## Boards` section are checked
- **THEN** neither names a database collection or the batch bound, and both name the `project-boards` skill

### Requirement: The command respects the switch

While boards are off, `/pm:boards` SHALL say the boards are off, name `set-boards on`, and write no artifact.

#### Scenario: Boards off

- **WHEN** `commands/boards.md` is checked by the file-rung doc assertion
- **THEN** it tells the agent to read `boardsEnabled` from `board --json` first and, while it is `false`, to say so, name `set-boards on`, and stop before any artifact write

### Requirement: The database contract is fixed

The skill SHALL define these collections. On both pages: `epics/<epicId>`, `releases/<releaseId>` and `page/info`
(`lastUpdated`, the export's `asOf`, `head`, and the export's `project`; there is no headline). On the release plan: `plan/state` (`here`, `hereText`, `nextText`, `head`,
`asOf`), `mission/current`, `criteria/<cN>`, `decisions/<n>` and `answers/<n>`. On the backlog: `backlogMeta/<epicId>`
and `proposals/rank`.

#### Scenario: Contract is stated

- **WHEN** the skill's text is checked
- **THEN** it names every collection above and the page each belongs to

### Requirement: Board data comes only from the export

Every value the agent writes to `epics`, `releases`, `plan`, `mission`, `criteria` and `page` SHALL come from one
`board --json` run, plus `head`, which the skill obtains with `git rev-parse --short HEAD`. The skill SHALL NOT read
`.conductor/state.json`. Writes SHALL go in batches of at most 50.

#### Scenario: No direct state read

- **WHEN** the skill's text is checked
- **THEN** it names `board --json` as the only state source, does not instruct reading `.conductor/state.json`, and states the 50-write batch bound

### Requirement: Access is enforced by declared database rules

Each page SHALL be published with the `db` and `user` capabilities and a `rules` list naming every collection it uses.
`epics`, `releases`, `plan`, `mission`, `criteria`, `decisions`, `page` and `proposals` SHALL be `read: view` and
`write: admin`. `answers` and `backlogMeta` SHALL be `read: view` and `write: interact`, and these two are the only
collections a viewer below admin can write.

#### Scenario: Declared rules name every collection

- **WHEN** the skill's capability declaration for each page is checked
- **THEN** every collection that page reads or writes has a rule, and only `answers` and `backlogMeta` carry `write: interact`

#### Scenario: Only answers and backlogMeta are open below admin

- **WHEN** the declared `rules` list is parsed out of the skill and each collection's `write` level is read
- **THEN** `epics`, `releases`, `plan`, `mission`, `criteria`, `decisions`, `page` and `proposals` read `admin`, and the only `interact` entries are `answers` and `backlogMeta`

#### Scenario: The proving run confirms a lower level cannot write

- **WHEN** task 7.1 attempts one `ArtifactData` write to `epics/probe` at `as_level: interact`, and lists the collections each published page holds
- **THEN** the write is refused, no `epics/probe` doc exists afterwards, and the page-written collections are exactly `answers`, `backlogMeta` and `proposals`, all recorded in the run's notes

### Requirement: Page checks are UI gating, never authorization

Page-side checks such as `canEdit()` SHALL only decide which controls are shown. The skill SHALL state that they are
not authorization. A document's `by` field SHALL be shown as "last change by" and SHALL NOT be treated as
attribution by the skill or the agent.

#### Scenario: The skill states the boundary

- **WHEN** the skill's text is checked
- **THEN** it states that the declared rules decide writes, that page checks are UI gating only, and that `by` is not attribution

### Requirement: Every interpolated value is escaped

The shipped templates SHALL escape every value they interpolate into text, attribute values (including `href` and
`data-*`) and class names. That includes ids, priorities, release ids, statuses and every free-text field.

#### Scenario: Markup in a title renders as text

- **WHEN** the backlog render runs over an `epics` doc with a valid id and the title `<img src=x onerror=alert(1)>`
- **THEN** the output contains `&lt;img` and no `<img` element

#### Scenario: Markup in a release id stays inert

- **WHEN** the release-plan render runs over an epic whose `release` is `r1" onclick="x`
- **THEN** the output contains no `onclick` attribute

### Requirement: Pages link only http and https URLs

A template SHALL render a link from a document field only when the value parses as an absolute URL with an `http`
or `https` scheme. Any other value SHALL render as plain escaped text with no `href`.

#### Scenario: A javascript URL renders no link

- **WHEN** a doc's `externalUrl` is `javascript:alert(1)`
- **THEN** the rendered output contains no `href` carrying it and no `javascript:` inside any attribute

### Requirement: Priority is allowlisted

A priority SHALL be checked against the level list `P0`, `P1`, `P2`, `P3`, `P?`. Any other value SHALL render as `P?`
in both its label and its class name.

#### Scenario: Priority outside the allowlist

- **WHEN** a doc's priority is `P1" onmouseover="x`
- **THEN** the rendered class and label use `P?` and the output contains no `onmouseover`

### Requirement: Malformed ids are skipped by the page and refused by the seed

A document whose id does not match `/^[A-Za-z0-9._-]+$/` SHALL NOT be rendered, and the page SHALL show a count of
skipped records. Before writing, the skill's seed step SHALL check every id against the same pattern and SHALL refuse,
naming it, any document that fails.

#### Scenario: Malformed id skipped and refused

- **WHEN** a doc's id is `a"><b>`
- **THEN** the page renders no row for it and reports one skipped record, and the seed step refuses to write it, naming the id

### Requirement: An inlined snapshot cannot break out of its script element

When the standalone fallback inlines the snapshot as JSON inside a script element, every `<` in that JSON SHALL be
written as the six-character escape `\u003c` (backslash, `u`, `0`, `0`, `3`, `c`).

#### Scenario: Script-closing text in a summary

- **WHEN** the fallback inlines a snapshot whose summary contains `</script><script>alert(1)</script>`
- **THEN** the file holds exactly one closing `</script>` for the data block, and the summary parses back intact

### Requirement: Pages type-check every database field

The templates SHALL treat every document as untrusted. A list field SHALL be iterated only after `Array.isArray`. A
text field SHALL be used only when it is a string, and otherwise treated as empty. A value SHALL go through `String()`
before it is compared or sorted.

#### Scenario: A malformed doc does not break the board

- **WHEN** the backlog render runs over three valid docs and one doc whose `dependsOn` is a string and whose `title` is an object
- **THEN** the three valid rows render, the malformed one renders with an empty title and no dependency tags, and no exception escapes the render

### Requirement: Each render step is isolated

Each render step (counts, rows, cards, the delivered and not-pursuing tables, the release roadmap, the criteria and
the decisions) SHALL run inside its own error boundary. A failing step SHALL show a short notice in its own place, and
every other step SHALL still render.

#### Scenario: A failing render step is isolated

- **WHEN** the release roadmap step throws on a malformed release doc
- **THEN** the counts, criteria and decisions still render, and the roadmap shows its notice

### Requirement: Drag writes a whole-band rank proposal, never an epic

The backlog SHALL band rows by `meritPriority`, the band `reorder` takes, and SHALL let an admin drag only within a
band; a lifted blocker (`priority` differs from `meritPriority`) SHALL NOT be draggable. A drop SHALL write
`{band, order, by, at}` to `proposals/rank`, `order` listing every open epic of that merit band, and SHALL change no
`epics` doc. A cross-band drag SHALL be refused with a hint that priority changes go through the agent.

#### Scenario: Drop writes only the whole-band proposal

- **WHEN** an admin drops row B above row A in merit band P1, which holds A, B and C
- **THEN** `proposals/rank` holds `{band: "P1", order: ["B", "A", "C"]}` and no `epics` doc changed

#### Scenario: Cross-band drag refused

- **WHEN** an admin drags a P2 row into the P1 band
- **THEN** no document is written and the page shows the priority hint

#### Scenario: A lifted blocker is not draggable

- **WHEN** a row's `priority` is P1 and its `meritPriority` is P3
- **THEN** the page renders no drag handle for it

### Requirement: The agent applies a rank proposal once, with reorder

At the start of each refresh, before any other write, the skill SHALL read `proposals/rank`. It SHALL check that
`order` is exactly the set of open epics in that merit band, per a fresh `board --json`. If any id is missing, extra or
in another band, the WHOLE proposal SHALL be refused, reported to the user and deleted. Otherwise the skill SHALL run
`reorder <ids…>`, delete `proposals/rank` and re-export.

#### Scenario: The skill states the apply order

- **WHEN** the skill's refresh procedure is checked by the file-rung doc assertion
- **THEN** it lists, in this order, read `proposals/rank`, check it against `board --json`, run `reorder` with its ids, delete `proposals/rank`, and re-run `board --json`; it states that one bad id refuses the whole proposal and that a refresh with no proposal doc runs no `reorder`

#### Scenario: Within a merit band, rank decides

- **WHEN** `reorder A B` runs (a UNIT test) over merit band P1 holding A and B with equal effective priority, where A depends on B
- **THEN** `board --json` lists A before B, because `resolveEpics()` orders by effective priority, then merit, then rank, and applies no dependency pass

#### Scenario: A stale proposal is refused whole

- **WHEN** `proposals/rank` lists an id that has since been archived
- **THEN** the skill runs no `reorder`, reports the stale id, and deletes the proposal

### Requirement: A re-seed updates existing docs instead of overwriting them

When a document already exists, the refresh SHALL write it with an `update` op, or with a `set` that carries the
version it read (`if_version`). A plain `set` SHALL be used only for a document that does not exist yet. A write
refused for a version mismatch SHALL be retried once after re-reading. A second refusal SHALL be reported, not forced.

#### Scenario: The skill names the op per case

- **WHEN** the skill's seed procedure is checked by the file-rung doc assertion
- **THEN** it names `update` (or `set` with `if_version`) for existing docs, `set` for new ones, and the retry-once-then-report rule

### Requirement: Page-local marks survive every refresh and can be undone

The skill's refresh SHALL never write, overwrite or delete a backlog "Not pursuing" mark (`backlogMeta/<epicId>`,
`{removed, reason, note}`). The page's "Set aside" control is what writes that "Not pursuing" mark. The page SHALL offer Restore, which sets `removed` to false. When the export stops listing
an epic, the refresh SHALL delete that epic's `epics` doc and leave its `backlogMeta` doc in place.

#### Scenario: Re-seed never names backlogMeta as a write target

- **WHEN** the skill's seed and refresh procedures are checked by the file-rung doc assertion
- **THEN** no write step targets `backlogMeta`, and the skill states that refresh never writes, overwrites or deletes it

### Requirement: Ended epics are placed by the export's delivered flag

The backlog SHALL list an ended epic under Delivered when `delivered` is true and under Not pursuing, showing its
outcome, when it is false. When `delivered` is null, the epic SHALL be listed under an "outcome unknown" label.

#### Scenario: Unknown outcome is not shown as delivered

- **WHEN** an archived epic's `delivered` is `null`
- **THEN** the backlog lists it under "outcome unknown", and in neither the Delivered nor the Not pursuing table

### Requirement: Decisions are agent-sourced open questions

`decisions/<n>` SHALL hold `{question, recommendation, askedAt}` for each open question the agent is putting to the
user now. pm records no open-question object and `board --json` carries none, so the page SHALL label each one "asked
by the agent" with its date. The skill SHALL delete a `decisions/<n>` doc once its question is answered or withdrawn.

#### Scenario: The skill names the source and the inverse

- **WHEN** the skill's text is checked by the file-rung doc assertion
- **THEN** it names the agent as the source of `decisions` and states that a doc is deleted once its question is answered or withdrawn

### Requirement: Answers flow back without being acted on unasked

A viewer at `interact` SHALL be able to write `answers/<n>` (agree or disagree, plus a note). "Send my answers" SHALL
write only `answers/_submitted`. On refresh the skill SHALL report answers to the user as untrusted input, SHALL NOT
act on one until the user confirms it, and SHALL never delete an answer.

#### Scenario: The skill forbids acting on an answer unconfirmed

- **WHEN** the skill's refresh procedure is checked by the file-rung doc assertion
- **THEN** it states that answers are untrusted input to report to the user, that no pm verb runs because of an answer until the user confirms it, and that answers are never deleted

### Requirement: A host without the Artifact tool gets a standalone file

When no Artifact tool is available, the skill SHALL write each board as one self-contained HTML file with the
snapshot inlined. The file SHALL be read-only (no drag, no answers), SHALL say that editing needs the live version,
and SHALL load no remote script.

#### Scenario: Fallback has no network dependency

- **WHEN** the fallback file is produced
- **THEN** it contains no `<script src=` and contains the inlined snapshot

### Requirement: Boards are registered and refreshed on named triggers

After the first publish of each board, the skill SHALL append a row `| date | title | url | what it is |` to
`docs/artifacts/artifacts.md`, creating the file if absent, and SHALL find each board's URL there on later refreshes.
It SHALL name five refresh triggers: `/pm:sync`, an epic status change, a `release` write, a `mission` write and a gate
record. Only the user deletes a board artifact.

#### Scenario: Registration and triggers stated

- **WHEN** the skill's publish procedure is checked
- **THEN** it names the `docs/artifacts/artifacts.md` row format and the five refresh triggers, and states that it never deletes an artifact

### Requirement: The brief carries one boards line while boards are on

While boards are on, the SessionStart brief SHALL carry one line of at most 160 bytes, passed through `fitBrief` as an obligation string that is never shortened, naming `/pm:boards` and saying
that the boards are refreshed after the named triggers. While boards are off, the line SHALL be absent.

#### Scenario: Brief line follows the switch

- **WHEN** the brief is built with boards on, and again with boards off
- **THEN** the first holds exactly one line naming `/pm:boards`, at most 160 bytes, and the second holds none

#### Scenario: The boards line survives fitting

- **WHEN** the brief is fitted to `BRIEF_BYTE_CAP` with boards on
- **THEN** the boards line is present and unshortened, and its bytes are measured on the fitted brief

### Requirement: Board titles name the project

Each board's title SHALL be `<project name> Backlog` or `<project name> Release Plan`, from the export's `project.name`.
A page SHALL set its H1 and document title from `page/info.project` at render time, and SHALL keep a neutral title while
the name is null or fails the `set-project` name rule. The skill SHALL publish each template with its `<title>` carrying
the escaped name, and SHALL say why this replaces the old rule against a project name in a title.

#### Scenario: The title follows the project name

- **WHEN** the backlog renders with `project` `{name: "PM Plugin", key: "PM"}`, and again with `project.name` null
- **THEN** the first title is "PM Plugin Backlog" and the second is "Project Backlog" with a guided card naming `set-project --name`

### Requirement: Ids shown are engine keys

Wherever a board shows an epic's id it SHALL show the export's `key` (such as `PM-256`) when it matches
`/^[A-Z]{2,3}-[1-9][0-9]{0,8}$/`, and otherwise the words "no key". The epic's slug MAY appear only as small secondary text.
A dependency tag SHALL name the dependency's key.

#### Scenario: A slug is never the id

- **WHEN** the backlog renders an epic with key `PM-256` and slug `project-boards`, and an epic with no key
- **THEN** the first row's key cell reads `PM-256` with the slug as secondary text, and the second reads "no key"

### Requirement: The backlog table is labelled Epics and its text column is Summary

The backlog's ranked table SHALL sit under a heading "Epics", and its text column SHALL be headed "Summary" and hold the
epic's one-line `summary`. When `summary` is null the cell SHALL show the title, marked visibly as a title shown in place
of a summary. A detail card SHALL be drawn only for an epic with a `whyNow` or a `description`, and SHALL hide every empty field.

#### Scenario: Missing summary is marked

- **WHEN** an open epic has a null `summary`
- **THEN** its Summary cell shows the title and the note "Title shown: no summary recorded"

### Requirement: Timestamps are human-readable

Every timestamp a board shows (the Last updated line, each Updated and Ended cell, the plan line's stale warning, a
decision's asked date and an answer's saved date) SHALL render as a short date and time in the viewer's locale and time
zone ("Nov 11, 2:10 PM", with the year when it differs from the current one), followed by a relative phrase ("3 days ago")
when it is a day or more old. No raw ISO timestamp SHALL appear in a page's output.

#### Scenario: No raw ISO

- **WHEN** a fully populated board renders with en-US and UTC pinned
- **THEN** the Updated cell reads "Nov 8, 9:30 AM" and "3 days ago", and the output holds no `YYYY-MM-DDTHH` string

### Requirement: Every missing field renders a guided empty state

For each field a board needs that is null, the page SHALL render a card naming what is missing, the engine command that
sets it, and who supplies it, with the instruction to ask the user where only the user knows. A page SHALL NOT render a
bare "not set", and a command placeholder SHALL render as text.

#### Scenario: Empty backlog fields

- **WHEN** the backlog renders with no project name or key and an open epic with no summary
- **THEN** it carries guided cards naming `set-project --name`, `set-project --key` and `update-epic <id> --summary`

#### Scenario: A key is set but an epic has no number

- **WHEN** the backlog renders with `project` `{name: "PM Plugin", key: "PM"}` and an open epic whose `number` is null
- **THEN** it carries a guided card naming `/pm:upgrade`

#### Scenario: Empty project

- **WHEN** the release plan renders with no project, mission, marker or milestone, and a planned release with no plan fields
- **THEN** it carries guided cards naming `set-project`, `mission --statement`, `release here`, `release <id> --theme … --target`, `mission --milestone` and `mission --add-criterion`, and none of them for a fully populated board

### Requirement: The skill asks for first-population fields in one batch

The skill SHALL hold a section "First population: what to fill and what to ask the user" mapping each null field to its
exact verb and to who supplies it, and telling the agent to ask in one batched question set, never to invent a mission or
milestone, and to re-run the refresh afterwards. It SHALL state the refresh-time stale check: read `page/info.lastUpdated`
before writing and, at two or more days, tell the user and re-check the plan marker's text with them.

#### Scenario: The section is stated

- **WHEN** the skill's text is checked by the file-rung doc assertion
- **THEN** it names every verb above, the one batch, the never-invent rule, the re-run, and the two-day stale check

### Requirement: The release plan header reads as one block, the roadmap holds live releases, and shipped releases explain themselves

The release plan SHALL draw the mission, the plan bar and a plan line as one header with no "We are here" block; the roadmap SHALL list only `in-progress` or `planned` releases, and `shipped` releases SHALL appear in a Shipped table at the bottom. The page SHALL NOT draw `plan.hereText`, `plan.nextText` or `plan.head`, SHALL NOT infer a reason, and SHALL escape and check every `unshipped` value.

#### Scenario: The header is one block

- **WHEN** the release plan is drawn
- **THEN** the mission spans the header width at body size with no "Why now" line, and the plan line shows the mission milestone only when one is set (nothing when it is not), the open-decisions count, and the stale warning from two days, with no box between them

#### Scenario: A shipped release's row and explanation

- **WHEN** a shipped release is drawn
- **THEN** its row reads `N of M shipped` from `progress` (or "no members recorded"), and, when it has `unshipped` rows, it expands to its intent, its `N of M` and each row's outcome label and recorded `reason`, or "no reason recorded" when `reason` is null; a row's epic and `supersededBy` ids are checked against the id pattern and its outcome is allowlisted

#### Scenario: A shipped release leaves the roadmap

- **WHEN** releases r0 (`shipped`), r1 (`in-progress`) and r2 (`planned`) exist
- **THEN** the roadmap lists r1 and r2, and the Shipped table lists r0 only, newest first

#### Scenario: A partly shipped release is explained

- **WHEN** a shipped release has `progress` `{done: 17, total: 18}` and an `unshipped` row `{outcome: "superseded", reason: null}`
- **THEN** its Shipped row reads "17 of 18 shipped" and its expansion lists that row as Superseded with "no reason recorded"

#### Scenario: An empty release

- **WHEN** a shipped release has no members and no `unshipped` rows
- **THEN** its row reads "no members recorded"
