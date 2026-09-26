## MODIFIED Requirements

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

**An epic's progress source is the UNION of two parts, and neither part SHALL hide the other.**

- **The story part:** the epic's inline stories. A **disposed story** leaves both the numerator and
  the denominator, exactly as a declared-bookkeeping task does.
- **The checkbox source:** the epic's plan file where it records one. Otherwise, for an openspec-lane
  epic (an absent lane read as openspec), the change's `tasks.md`.

The epic's `done` and `total` are the two parts' sums, and so is the count of excluded items (disposed
stories plus declared-bookkeeping tasks), which the rendered record labels by kind so a disposed story
is never called lifecycle bookkeeping. Where both parts contribute, the rendered ratio counts `items`
(`N/M items`), because its total holds stories and tasks together. Before this requirement, the presence of any inline story made
the checkbox source unread. On a `tasks.md` at 1/3, one `--add-story`, one `--story 1 --done` and an
archive recorded `delivered` with two tasks open and a rendered `1/1`. A source that stops being read
because another one appeared is the missing-source defect this capability already prohibits, reached
by a different path.

The union counts. It does not refuse a second source. Refusing to add a story to an epic with a
checkbox source would guard only the verbs that add stories, and it would leave every record that
already holds both parts reading one of them. The error direction is the one this capability already
chooses: an item counted twice is visible in the rendered record, and an item never counted is not.

Every consumer that branches on WHICH part holds the outstanding work SHALL test each part's own open
count, never a single source label: under the union an epic can have work open in both parts at
once, and a consumer that picked one label would name a remedy that clears only half of it.

**The checkbox source of an archived openspec change is its ARCHIVED `tasks.md`.** `openspec archive`
moves `openspec/changes/<id>/` to `openspec/changes/archive/<YYYY-MM-DD>-<id>/` (or
`archive/<id>/`). Where the live `tasks.md` is absent, the checkbox source SHALL be read from the
archived change directory whose id matches the epic's, and that holds for every epic, not only a
backfilled one. A consumer that reads only the live path sees zero outstanding work at exactly the
moment the archive gate asks. In this repository that let archives be recorded `delivered` with tasks
open. The epic's id is the key: an epic whose work lives in a change directory with a different id
has no checkbox source under this rule, and this requirement does not add a mapping.

**One resolver decides which archived directory is an epic's.** The question "is this epic's change
archived" and the question "where is its archived `tasks.md`" SHALL be answered by the SAME match, so
they can never disagree about one epic. A directory matches when its name, with one leading
`YYYY-MM-DD-` prefix removed, equals the epic's id with the same prefix removed — subject to the
DATE RULE below. Where more than one
directory matches (a change archived, re-proposed under the same id and archived again), the one with
the LATEST date prefix wins, and an undated directory ranks below every dated one, because
`openspec archive` always writes a date and an undated directory is the older manual convention.
Before this requirement the two questions used different matches: one tried the undated name first
and then took the first stripped match in directory order (the OLDEST), and the other matched the
literal id, so an id that itself carried a date prefix could read as archived with no tasks found.

**The date rule: an archive older than a LIVE epic is not its archive.** A name is not an identity:
an unrelated `archive/2025-01-01-add-auth` once ended an ACTIVE epic `add-auth` registered months
later — the drift heal archived it with outcome `unknown` and cleared the active pointer. So, for an
epic whose `status` is NOT `archived`, a DATE-PREFIXED directory SHALL NOT match when its date is more
than one day before the epic's `createdAt` day (the day of slack because `openspec archive` writes a
local date and `createdAt` is UTC), and a live epic with no parseable `createdAt` SHALL match no
date-prefixed directory — the resolver never ends live work on a dated name it cannot compare. An
UNDATED directory carries no date to compare and matches by name, as before. The rule decides only
whether live work is ENDED: the heal, the active-pointer clear and `set-active`'s refusal.

An epic whose `status` IS `archived` SHALL match by name alone, whatever its `createdAt` says. For an
ended epic `createdAt` is not evidence of order: pm's own `createdAt` recovery dates an epic from the
first commit that held it, which can postdate its archive, and a rule over ended epics would take
their archived task counts, their spec-sync scope and their cross-spec scope away. An epic registered
BY the archive backfill is likewise matched by name. A caller that asks with a bare id, holding no
epic record, gets the name match. `sync` SHALL name, on every run, each directory the rule set aside
for a live epic, and count them in its final line; it SHALL never advise renaming a directory an
already-archived epic resolves to.

A plan file that has moved is read where the epic records it and nowhere else. Plans have no archive
convention to follow, so a moved plan is not reconstructed here.

The missing-source warning is decided by the checkbox source alone, and the story part does not
suppress it. An epic that is not archived, whose checkbox source is expected (it records a plan file,
or it is openspec-lane) and cannot be read from either location, warns whether or not it has
stories.

#### Scenario: An epic whose only unticked item is declared bookkeeping has nothing outstanding
- **WHEN** an epic's task source holds 13 items, 12 ticked, and the thirteenth is a declared
  lifecycle-bookkeeping task instructing the agent to archive this very change
- **THEN** the epic's outstanding work is zero, its progress renders `12/12`, and a guard that
  refuses an action while work remains does not refuse for this epic

#### Scenario: A refusal cites the same count the record renders
- **WHEN** an action is refused because an epic still has outstanding work
- **THEN** the count named in the refusal is this definition's count and is identical to the count
  the rendered project record shows for that epic

#### Scenario: An archived change's tasks are read where the archive moved them
- **WHEN** an openspec-lane epic that was NOT registered by the archive backfill has its change
  moved to `openspec/changes/archive/<YYYY-MM-DD>-<id>/`, with a `tasks.md` holding 3 undeclared
  tasks of which 1 is ticked
- **THEN** its progress renders `1/3` and its outstanding work is 2, not `0/0` and zero

#### Scenario: An undated archive directory is found too
- **WHEN** the archived change directory is named `openspec/changes/archive/<id>/`, with no date
  prefix
- **THEN** its `tasks.md` is read exactly as a date-prefixed one is

#### Scenario: A story added to an epic with a tasks.md does not hide the tasks
- **WHEN** an openspec-lane epic's `tasks.md` holds 3 undeclared tasks of which 1 is ticked, and one
  inline story is added and marked done
- **THEN** its progress renders `2/4` and its outstanding work is 2

#### Scenario: A disposed story leaves both sides while the tasks stay counted
- **WHEN** an epic with a `tasks.md` at 2/2 carries two inline stories, one done and one disposed
- **THEN** its progress renders `3/3`: the disposed story is in neither the numerator nor the
  denominator, and the tasks still are

#### Scenario: Stories do not suppress a missing tasks.md warning
- **WHEN** an openspec-lane epic that is not archived carries inline stories, and no `tasks.md`
  exists at the live path or in any archived change directory matching its id
- **THEN** the missing-source warning is emitted and its stories are still counted

#### Scenario: Two archived directories for one id resolve to the latest
- **WHEN** an epic's id matches both `openspec/changes/archive/2026-08-01-<id>/` and
  `openspec/changes/archive/2026-09-01-<id>/`, each holding a `tasks.md` with different counts
- **THEN** its progress is read from the `2026-09-01` directory, and the same directory is the one
  that decides the epic's change is archived

#### Scenario: An archive dated before a live epic existed does not end it
- **WHEN** an ACTIVE epic `add-auth` has `createdAt` today, and `openspec/changes/archive/` holds only
  `2025-01-01-add-auth`, and `sync`, `render` or `set-active add-auth` runs
- **THEN** the epic is not archived, the active pointer still names it, `set-active` accepts it, and
  `sync`'s stderr names the set-aside directory and its final line counts it

#### Scenario: A change archived after its epic was registered still heals it
- **WHEN** a live epic registered today has its change moved to `archive/<today>-<id>/`
- **THEN** the heal archives it, as before this rule

#### Scenario: An already-archived epic keeps an archive dated before its createdAt
- **WHEN** an epic with `status: archived` has `createdAt` 2026-07-09 (as pm's own recovery can
  date it) and its only matching directory is `archive/2026-07-01-<id>/` with a `tasks.md` at 26/26
- **THEN** its progress renders `26/26`, it stays in spec-sync and cross-spec scope, and `sync`
  prints no set-aside line for it

#### Scenario: A live epic with no registration date is never ended by name
- **WHEN** a live epic carries no `createdAt` and `archive/2026-06-25-<id>/` exists
- **THEN** the heal does not archive it and `sync` names the directory, pointing at
  `recover-created-at`

#### Scenario: A story-only epic is unchanged
- **WHEN** an epic in a lane with no checkbox source and no plan file carries 3 stories, 1 done
- **THEN** its progress renders `1/3`, as before this requirement
