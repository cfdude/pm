## ADDED Requirements

### Requirement: A field an epic-writing surface can set, it can unset
For every field on an epic that is nullable — one whose absence is a legal, meaningful state
rather than a broken record — the update surface SHALL provide a way to return it to absent, or
the specification SHALL name that field and state why it is deliberately set-only.

Silence SHALL NOT be an answer. A field that can be set and not unset is a value a user can enter
by mistake and never remove, and the only remaining recourse is editing the state file by hand —
which is the exact failure this engine exists to remove, and which recurred across several
sessions before anyone reported it.

The clearing form SHALL be uniform across those fields rather than invented per field. Measured
here, one field of nine carried a clearing flag while the other eight did not; a fix that added a
clearing flag for a second field and left the remaining seven would reproduce, in the same
invocation, the defect it was written to repair.

Unsetting a field SHALL leave every other field on the epic unchanged, and SHALL be refused with a
non-zero exit where the field is not nullable — a required field has no absent state, and a
surface that appeared to clear one would report a write it did not perform.

#### Scenario: Every nullable field has a clearing form
- **WHEN** an agent reads the update surface's usage
- **THEN** each nullable field is either reachable by a documented clearing form, or named in the
  specification with the reason it is set-only

#### Scenario: Clearing one field leaves the others intact
- **WHEN** a nullable field is cleared on an epic
- **THEN** that field is absent and every other field on the epic is unchanged

#### Scenario: Clearing a non-nullable field is refused
- **WHEN** a clearing form is applied to a field that has no legal absent state
- **THEN** the invocation exits non-zero naming the field, and no field is changed

### Requirement: Supplying a link adds it rather than replacing what is recorded
Supplying a link to an existing epic SHALL add that link to the epic's recorded links. It SHALL
NOT replace them, because replacement makes the operation destructive in a way its name does not
state and makes recording a second relationship silently discard the first.

Adding a link that is already recorded SHALL leave the recorded set unchanged rather than
producing a duplicate entry: two identical relationships between the same pair of epics are one
relationship, and a record that lists it twice is a record that disagrees with itself.

Removing links SHALL remain reachable by the existing documented clearing form. That form and this
one SHALL be distinguishable from each other by name, so that neither can be reached by a typo in
the other.

#### Scenario: A second link is added, not substituted
- **WHEN** a link is supplied to an epic that already records one
- **THEN** the epic records both

#### Scenario: Re-supplying a recorded link is not a duplicate
- **WHEN** a link identical to one already recorded is supplied
- **THEN** the epic's recorded links are unchanged

#### Scenario: Clearing remains reachable and distinct
- **WHEN** an agent removes every link from an epic using the documented clearing form
- **THEN** the links are emptied, and that form is named differently from the form that adds one
