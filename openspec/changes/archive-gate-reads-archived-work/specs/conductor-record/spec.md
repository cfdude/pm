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

- **The story part:** the epic's inline stories. A story that carries a disposition leaves both the
  numerator and the denominator, exactly as a declared-bookkeeping task does.
- **The checkbox part:** the epic's plan file where it records one. Otherwise, for an openspec-lane
  epic (an absent lane read as openspec), the change's `tasks.md`.

The epic's `done` and `total` are the two parts' sums. Before this requirement, the presence of any
inline story made the checkbox part unread. On a `tasks.md` at 1/3, one `--add-story`, one
`--story 1 --done` and an archive recorded `delivered` with two tasks open and a rendered `1/1`. A
source that stops being read because another one appeared is the missing-source defect this
capability already prohibits, reached by a different path.

The union counts. It does not refuse a second source. Refusing to add a story to an epic with a
checkbox source would guard only the verbs that add stories, and it would leave every record that
already holds both parts reading one of them. The error direction is the one this capability already
chooses: an item counted twice is visible in the rendered record, and an item never counted is not.

**The checkbox part of an archived openspec change is its ARCHIVED `tasks.md`.** `openspec archive`
moves `openspec/changes/<id>/` to `openspec/changes/archive/<YYYY-MM-DD>-<id>/` (or
`archive/<id>/`). Where the live `tasks.md` is absent, the checkbox part SHALL be read from the
archived change directory whose id matches the epic's. That is the same match that decides whether
the change is archived, and it holds for every epic, not only a backfilled one. A consumer that reads
only the live path sees zero outstanding work at exactly the moment the archive gate asks. In this
repository that let archives be recorded `delivered` with tasks open. The epic's id is the key:
an epic whose work lives in a change directory with a different id has no checkbox part under this
rule, and this requirement does not add a mapping.

A plan file that has moved is read where the epic records it and nowhere else. Plans have no archive
convention to follow, so a moved plan is not reconstructed here.

The missing-source warning is decided by the checkbox part alone, and the story part does not
suppress it. An epic that is not archived, whose checkbox part is expected (it records a plan file,
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

#### Scenario: A story-only epic is unchanged
- **WHEN** an epic in a lane with no checkbox part and no plan file carries 3 stories, 1 done
- **THEN** its progress renders `1/3`, as before this requirement
