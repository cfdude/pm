# conductor-record Specification

## Purpose

The conductor's record of what a repository actually shipped must be complete, and its progress
signal must reflect delivery rather than bookkeeping. Today `sync` never walks
`openspec/changes/archive/`, so the conductor sees 49 of 87 archived changes across 8 repos (56%),
and a task reading `run /opsx:archive <this change>` — which cannot be ticked before the thing that
ticks it — counts as outstanding work. Every effectiveness number this project has published was
computed over that record. This capability also owns the definition of "outstanding work" that the
rest of the release refuses actions on.

## Requirements

### Requirement: Outstanding work is a defined quantity
This capability SHALL be the single definition of an epic's **outstanding work**, and every
consumer SHALL key on that definition rather than counting raw checkboxes for itself — the rendered
project record, the briefing, `/pm:next`, and any guard in this release that refuses an action
because an epic still has work left.

**Outstanding work** for an epic is the number of items in its progress source that are neither
ticked nor declared lifecycle bookkeeping in the sense defined below. An epic **has outstanding
work** when that number is greater than zero. A declared-bookkeeping item is removed from both the
numerator and the denominator, so an epic's rendered progress and its outstanding-work count can
never disagree.

A guard that refuses an action on the grounds that work remains SHALL cite this quantity. Refusing
an epic that renders as complete — because the guard counted an item this definition excludes — is
prohibited; the archive instruction in a change's own task list is unticked at archive time by
construction, and a guard keying on raw checkboxes would refuse every correctly finished change.

#### Scenario: An epic whose only unticked item is declared bookkeeping has nothing outstanding
- **WHEN** an epic's task source holds 13 items, 12 ticked, and the thirteenth is a declared
  lifecycle-bookkeeping task instructing the agent to archive this very change
- **THEN** the epic's outstanding work is zero, its progress renders `12/12`, and a guard that
  refuses an action while work remains does not refuse for this epic

#### Scenario: A refusal cites the same count the record renders
- **WHEN** an action is refused because an epic still has outstanding work
- **THEN** the count named in the refusal is this definition's count and is identical to the count
  the rendered project record shows for that epic

### Requirement: Lifecycle bookkeeping is excluded only where it is declared
A task that is lifecycle bookkeeping rather than delivery SHALL be excludable from outstanding work
by an explicit declaration carried in the task source itself. The declaration SHALL be the single
literal token `<!-- pm:lifecycle -->`, written onto the task line by the agent authoring the source
— one fixed string, chosen so it renders invisibly in markdown and so a test binds to it exactly.

The judgment is the agent's, not the engine's. The engine SHALL exclude exactly the tasks that
carry the marker and SHALL infer exclusion from nothing else — not from a task's wording, not from
the commands its text names, not from its position in the file. This is the ruling `epic-disposition`
makes on the identical problem for deferrals, and the one `PLAN_INDEX_FILES` already embodies in
`epic-progress.mjs` by excluding against an enumerable literal rather than reading a file for
intent.

The error direction is deliberate. An undeclared bookkeeping task keeps counting as outstanding,
which is today's behavior and is visible in the rendered record. A text matcher would fail the
other way, silently excluding a real task and under-reporting outstanding work — the exact
over-reporting of completion this whole release exists to correct.

Exclusion MUST remove the task from both the numerator and the denominator: `12/13` where the
thirteenth is a declared archive instruction becomes `12/12`, never `12/13` with a hidden
adjustment.

Excluding tasks MUST NOT collapse a real progress source into the "no progress source" state. A
missing source is a distinct condition from a source that is present and empty, and only the former
warns; an epic whose every task was excluded still has a source, and MUST NOT emit the
missing-source warning.

#### Scenario: A declared self-referential archive task is not outstanding work
- **WHEN** an epic's task source has 13 tasks, 12 ticked, and the thirteenth reads
  `run /opsx:archive <this change>` and carries the marker
- **THEN** the epic's progress renders `12/12` and the epic does not present as having outstanding
  work

#### Scenario: An undeclared task is counted however it is worded
- **WHEN** a task reads `run /opsx:archive <this change>` and does NOT carry the marker
- **THEN** it counts normally toward both numerator and denominator, and the engine does not
  exclude it on the strength of its text

#### Scenario: A real task that mentions archiving still counts
- **WHEN** a task describes implementing or testing behavior that involves archiving, and does not
  carry the marker
- **THEN** it counts normally toward both numerator and denominator

#### Scenario: An epic whose only task was excluded does not warn
- **WHEN** every task in a present, readable task source carries the marker
- **THEN** the epic renders as having a progress source with nothing outstanding, and no
  missing-source warning is emitted

### Requirement: The emitted instructions require the declaration to be written
The conductor does not author task sources — OpenSpec and the agent do — so the declaration only
ever appears if the instructions this plugin emits ask for it. The managed rules block and the
session brief SHALL therefore instruct the agent to mark a lifecycle-bookkeeping task with
`<!-- pm:lifecycle -->` at the moment the task source is authored or amended, and SHALL name the
self-referential archive task as the case that always qualifies. This is an instruction-layer
obligation: the engine emits the rule and never edits a task source itself.

Without this, exclusion is expressible and never exercised — an unmarked archive task still counts
as outstanding by the definition above, so an archive guard keyed on that definition still refuses
every correctly finished change. The declaration is the only thing standing between the two, and
nothing else in this capability causes it to exist.

The instructions SHALL also cover amendment, not only authoring: a task source written before this
capability carries no marker, and the agent finishing such a change is the only party positioned to
add one. This change's own task source is an in-flight instance of exactly that case.

#### Scenario: A generated archive task carries the declaration
- **WHEN** an agent following the emitted rules authors a task source containing a task that
  instructs it to archive that very change
- **THEN** that task carries `<!-- pm:lifecycle -->`, and the epic's outstanding work at archive
  time is zero rather than one

#### Scenario: A pre-existing task source is amended rather than left to refuse
- **WHEN** an agent reaches archive time on a change whose task source predates this capability and
  whose only unticked task is the archive instruction
- **THEN** the emitted instructions direct it to add the declaration to that task, and the engine
  neither adds nor infers the marker on its own

### Requirement: sync reconciles the archive directory
`sync` SHALL reconcile `openspec/changes/archive/` in addition to `openspec/changes/`. An archived
change on disk with no corresponding epic SHALL be registered as an epic already in `status:
"archived"` — preserving the record without pretending the change was managed. `reconcileArchived()`
only flips epics that already exist and MUST continue to create nothing; registration is `sync`'s
job.

#### Scenario: An archived change with no epic is registered
- **WHEN** `sync` runs in a repo with 24 archived changes on disk and 8 of them have no epic
- **THEN** 8 epics are registered, each with `status: "archived"`, and the conductor's archived count
  matches the directory

#### Scenario: A change archived before the conductor was initialized is not lost
- **WHEN** a change was archived before `/pm:init` ever ran in the repo
- **THEN** the next reconciliation registers it, rather than it remaining permanently invisible
  because it was never active while a sync ran

### Requirement: Archive registration cannot produce duplicate epics
Identity for archive registration SHALL be the change id, derived identically to the way
`isArchived()` matches it — an archive directory named `<YYYY-MM-DD>-<id>` and one named `<id>`
resolve to the same id, and neither may register a second epic for a change the conductor already
holds. This registration path MUST NOT become a third way to produce duplicates alongside the
over-registration behaviors already filed against `sync`.

#### Scenario: A date-prefixed archive directory does not duplicate its epic
- **WHEN** the archive contains `archive/2026-08-01-port-domain-health-system` and an epic
  `port-domain-health-system` already exists
- **THEN** no new epic is created, and the existing epic is used

#### Scenario: Re-running sync after a backfill adds nothing
- **WHEN** `sync` is run again immediately after an archive reconciliation registered new epics
- **THEN** zero epics are added and no epic is modified

#### Scenario: An active change and its archived form are one epic
- **WHEN** a change registered while active is later archived and `sync` runs
- **THEN** the existing epic flips to `archived` and no second epic is registered for the archive
  directory

### Requirement: The backfill is visible, one-time, and announced
Registering historical archived changes SHALL be a deliberate, announced action, never a silent side
effect of a routine `sync`. The engine MUST report what it registered — the count and the ids — and
MUST NOT alter a repo's epic counts without saying so, because those counts are the input to every
effectiveness measurement taken from conductor state. Once the backfill has run, subsequent
reconciliation is forward-only: it registers changes archived since, and MUST NOT re-announce or
re-register history.

Whether the backfill has run SHALL be persisted on `.conductor/state.json` as `archiveBackfilledAt`,
an ISO timestamp whose PRESENCE is the marker and whose value records when. It is deliberately not a
watermark: forward-only registration derives from "this archived change has no epic", so nothing is
ever compared against the timestamp, and the field's only behavioral job is to decide whether a
registration run announces itself as the historical backfill or proceeds as routine forward
reconciliation. A state file carrying no `archiveBackfilledAt` — including every state file written
before this capability — SHALL load unchanged and be treated as not yet backfilled.

#### Scenario: The one-time backfill announces what it changed and records that it ran
- **WHEN** the archive backfill runs for the first time in a repo and registers 8 historical epics
- **THEN** it reports the count and the ids it registered, so the change in the repo's numbers is
  attributable, and `archiveBackfilledAt` is written to `.conductor/state.json`

#### Scenario: A routine sync does not silently backfill
- **WHEN** `sync` runs in a repo whose state already carries `archiveBackfilledAt`
- **THEN** no historical epic is registered or re-announced, and only changes archived since are
  picked up, without a backfill announcement

#### Scenario: State written before this capability backfills once
- **WHEN** `sync` runs against a state file that has no `archiveBackfilledAt` field
- **THEN** the state loads unchanged, the backfill runs and announces once, and the field is
  written so the next run does not repeat it

### Requirement: A backfilled epic is distinguishable from a managed one
Every epic the archive backfill registers SHALL be stamped by the ENGINE as having been registered
by that path — unconditionally, for every backfilled epic, and never by the agent. The stamp SHALL
be the field `recordedBy` on the epic's terminal disposition record, carrying the literal value
`archive-backfill`, alongside the `unknown` terminal outcome that `epic-disposition` reserves for
work whose disposition was never recorded. It is a named field precisely so a consumer keys on data
rather than parsing a free-text reason; the reason MAY additionally name the path for a human
reader, but no consumer may depend on that prose.

`recordedBy` is the general form of the same stamp every non-interactive path needs — the engine
records which path wrote a disposition nobody chose — so any other path in this release that stamps
an outcome the agent did not supply SHALL use this field with its own path name as the value.

A backfilled epic never passed through the conductor while it was in flight. It has no gate verdict,
no start time, and — where the change was abandoned — no ticked tasks. Those are properties of a
record reconstructed from disk, not of a badly managed epic. The stamp exists so that a check or a
refusal keyed on any of those properties can tell the two apart. Without it, the first run of the
backfill fills the repo's integrity report with findings against changes that were archived long
before the conductor could have guarded them.

The stamp MUST NOT be conditional on the backfilled epic's task counts, its lane, or any other
property — conditioning it would reintroduce exactly the engine-side classifier this capability
rules out elsewhere.

#### Scenario: A backfilled epic carries its origin as data
- **WHEN** the backfill registers an archived change as an epic
- **THEN** the epic carries the `unknown` outcome and `recordedBy: "archive-backfill"`, readable as
  a field without parsing a free-text reason

#### Scenario: Every backfilled epic is stamped, not only the incomplete ones
- **WHEN** the backfill registers one change whose tasks are fully ticked and one archived with 12
  tasks unticked
- **THEN** both epics carry the stamp, and neither is distinguished from the other by whether it was
  stamped

#### Scenario: The stamp is not available to the agent
- **WHEN** an epic is created by any path other than the archive backfill
- **THEN** it does not carry the backfill stamp, and no CLI flag lets the agent apply one

### Requirement: A backfilled epic carries its real delivery evidence
An epic registered from the archive SHALL carry the task-completion evidence recorded in its
archived artifacts. Its progress MUST read those counts, and MUST NOT render as `0/0` or as an em
dash because the engine looked for a task source where an ACTIVE change would keep one and an
archived epic's missing source is suppressed rather than warned about. A change archived with 12 of
its tasks still unticked is the most informative row in the whole audit; registering it without its
counts preserves the row and discards the only evidence that makes the row worth preserving.

#### Scenario: An abandoned change registers with its unticked count intact
- **WHEN** `log-collector-not-applicable` is registered from the archive with 12 of its tasks
  unticked
- **THEN** its progress reflects those 12 unticked tasks rather than rendering `0/0` or an em dash

#### Scenario: A fully delivered archived change registers as complete
- **WHEN** an archived change whose task source is fully ticked is registered
- **THEN** its progress renders as complete, distinguishable from the abandoned case above

### Requirement: A checkbox is a claim, not evidence
Progress derived from checkbox state SHALL be presented as **claimed** completion, and this
capability explicitly does not assert that a ticked task was actually delivered. The bound is
measured, not theoretical: in an 18-epic sample, 3 ticked tasks hid undone work — one still
defective at HEAD, verified by executing the real renderer — and all 3 unticked boxes were non-work.
The errors are asymmetric toward over-reporting completion. Nothing in this capability verifies a
claim; verification is the gates' job, and any consumer that treats a progress figure as evidence of
delivery MUST be considered out of contract.

#### Scenario: Progress is labelled as a claim where it is presented
- **WHEN** `PROJECT.md`, the briefing, or `/pm:next` presents an epic's checkbox-derived progress
- **THEN** it is presented as claimed completion rather than verified delivery, so a reader does not
  mistake `12/12` for evidence that the work is correct

#### Scenario: A fully ticked epic still carries no delivery assurance
- **WHEN** an epic's tasks are all ticked but its Gate 2 verdict is absent or failing
- **THEN** this capability makes no claim that the epic delivered, and the archive-time disposition
  and gate requirements remain the authority on that question
