## ADDED Requirements

### Requirement: An epic records when it was registered and when it was last touched
Every epic SHALL carry the moment it was registered and the moment it was last modified. Without
the first, no surface can answer how long an epic has sat, because an epic that was registered and
never started carries no other date: `startedAt` is absent by definition for that population, and
it is exactly the population a staleness question is about.

The registration date SHALL be written at registration by every surface that creates an epic, and
SHALL NOT be rewritten by any later mutation. The last-touched date SHALL be advanced by any
mutation that changes the epic's stored content, and SHALL NOT be advanced by a write that changes
nothing — a save that stores an identical record is not a touch, and treating it as one would make
every render look like activity.

Both SHALL be absent-tolerant: an epic written by an earlier version carries neither, and every
reader SHALL treat absence as "unknown", never as a date. A surface that reports staleness SHALL
distinguish "registered N days ago" from "registration date unknown" rather than collapsing the
second into the first.

#### Scenario: A newly registered epic carries its registration date
- **WHEN** an epic is registered by any surface that creates one
- **THEN** it carries a registration timestamp, and that timestamp is unchanged by every
  subsequent mutation of that epic

#### Scenario: A mutation advances the last-touched date
- **WHEN** a mutation changes an epic's stored content
- **THEN** the epic's last-touched timestamp is advanced to that moment, and its registration
  timestamp is not

#### Scenario: A write that changes nothing is not a touch
- **WHEN** a surface saves an epic whose stored content is identical to what is already recorded
- **THEN** the epic's last-touched timestamp is unchanged

#### Scenario: An epic from an earlier version reports unknown, not a date
- **WHEN** a reader encounters an epic carrying no registration timestamp
- **THEN** it reports the registration date as unknown, and never substitutes another field's
  date or the current time

### Requirement: Registration dates are backfilled from history, not invented
The migration that introduces the registration date SHALL populate it from recoverable evidence
rather than stamping the migration's own run time, which would record every pre-existing epic as
having been registered on upgrade day and destroy the very signal the field exists to carry.

Where `.conductor/state.json` is tracked in version control, the commit that first introduced an
epic's id into that file SHALL be the source of its registration date. Where no such evidence is
recoverable — the file is untracked, the history is shallow, or the id predates the tracked
history — the field SHALL be left absent, and absence SHALL mean unknown.

The migration SHALL be idempotent and SHALL NOT overwrite a registration date that is already
present. It SHALL read only local version-control history; the engine opens no network connection.

#### Scenario: A backfill recovers a real date from tracked history
- **WHEN** the migration runs in a repository whose state file is tracked and whose history
  contains the commit that introduced an epic's id
- **THEN** that epic's registration date is the date of that commit, not the migration's run time

#### Scenario: An unrecoverable date is left absent
- **WHEN** the migration cannot recover an epic's introducing commit from local history
- **THEN** that epic's registration date is left absent, and no date is fabricated for it

#### Scenario: Re-running the migration changes nothing
- **WHEN** the migration runs a second time over a state file it has already migrated
- **THEN** no registration date changes, including those it left absent

### Requirement: The emitted call-site sweep obliges the inverse operation
Required task item 1 in the instructions pm emits SHALL oblige an enumeration of the INVERSE
OPERATION of every operation the change adds or modifies — set against unset, add against remove,
append against replace, enable against disable, grant against revoke — and SHALL require each
inverse that is not shipped to be named and justified, in the same way an unguarded call site must
be.

This obligation SHALL be carried as a numbered required task item and SHALL NOT be restated as
review guidance or a prose bullet: measured in this repository, a rule carried by a mandatory task
section reached 14 of 14 subsequent changes while the same rule written as prose reached 3 of 15.

A call-site sweep alone cannot find this class, and the reason is mechanical rather than a matter
of diligence: enumerating the callers of a thing that is written never leads to the question of
whether it can be unwritten. Measured here, six instances shipped past both gates while the
call-site obligation was in force, and one of them is a safety surface — pre-authorization grants
that accumulate with no revoke, where disabling the feature leaves the grants intact.

#### Scenario: A change that adds a setter is obliged to address the unsetter
- **WHEN** a change adds or modifies an operation that writes a value
- **THEN** the emitted required task list obliges enumerating the corresponding operation that
  removes that value, and requires an explicit justification wherever it is not shipped

#### Scenario: The obligation is a numbered task item, not guidance
- **WHEN** the emitted instructions are rendered
- **THEN** the inverse-operation obligation appears within a numbered required task item rather
  than as a prose bullet or a review suggestion
