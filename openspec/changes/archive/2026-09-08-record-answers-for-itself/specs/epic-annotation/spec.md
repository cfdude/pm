## ADDED Requirements

### Requirement: Nullability is declared, and every declared-nullable field can be unset
Each field an epic-writing surface can set SHALL declare in the flag registry whether it is
NULLABLE — whether absence is a legal, meaningful state rather than a broken record — and every
field so declared SHALL be reachable by a clearing form.

The declaration is what makes the rule enforceable, and without it neither candidate shape works. A
per-field clearing flag can be forgotten when a further nullable field is added; so can a single
clearing flag's accepted set, if that set is typed by hand. Only a registry marker lets the
clearing surface and its test both derive from one place, so a nullable field added without a
clearing path fails the suite instead of shipping silently. A field deliberately left set-only
SHALL carry its reason in the registry beside the marker, not in prose a test cannot read.

The clearing form SHALL be uniform across the declared-nullable fields rather than invented per
field. Measured here, one field of the set carried a clearing flag while the others did not; a fix
adding a second flag for a second field and leaving the rest would reproduce, inside the fix, the
defect it was written to repair.

The clearing form SHALL name fields by the spelling a user reads in the command's own help — the
flag name, not the internal state key — because those are two namespaces that the engine already
warns must not be confused.

`links` is the one field that keeps a dedicated clearing flag. It is GRANDFATHERED, not an exception
to the uniformity rule: `--clear-links` is already documented, already tested, and is required in one
invocation alongside `--link` for the atomic repair this specification also requires — a shape the
generic form cannot express. It SHALL therefore be declared set-only for the generic form, carrying
that reason, so that the generic form refuses `links` by name and points at `--clear-links` rather
than appearing to offer a second way to do the same thing.

`notes` is an append-only trail and SHALL be declared set-only with that reason: its entries are a
record of what was said and when, so removing one would edit history rather than clear a value. That
is a decision recorded here, not an omission — the requirement above demands every settable field
carry one marker or the other.

Unsetting a field SHALL leave every other field on the epic unchanged, and SHALL be refused with a
non-zero exit naming the field where that field is not declared nullable.

#### Scenario: Every declared-nullable field has a clearing form
- **WHEN** the clearing surface is checked against the registry's nullable declarations
- **THEN** every declared-nullable field is reachable by the clearing form

#### Scenario: A new nullable field with no clearing path fails the suite
- **WHEN** a field is declared nullable in the registry and no clearing path reaches it
- **THEN** the suite fails, rather than the field shipping without one

#### Scenario: Clearing one field leaves the others intact
- **WHEN** a declared-nullable field is cleared on an epic
- **THEN** that field is absent and every other field on the epic is unchanged

#### Scenario: Clearing a field that is not nullable is refused
- **WHEN** the clearing form is applied to a field with no declared nullable state
- **THEN** the invocation exits non-zero naming the field, and no field is changed

### Requirement: Supplying a link adds it, and the documented repair stays one write
Supplying a link to an existing epic SHALL add that link to the epic's recorded links rather than
replacing them, because replacement makes the operation destructive in a way its name does not
state and makes recording a second relationship silently discard the first. A link's IDENTITY is its type
and its target; its reason is the part a reader acts on and is NOT part of its identity. Supplying a
link whose identity matches one already recorded SHALL NOT produce a second entry — two
relationships of the same type between the same pair of epics are one relationship, and a record
listing it twice disagrees with itself — and SHALL update that entry's reason in place rather than
discarding it. Discarding would be worse than a duplicate: today replacement makes correcting a
reason work, and a dedup that merely dropped the repeat would remove the only path to it while
reporting that nothing changed. Where identity AND reason both match, nothing changes and the
invocation says so.

Every surface that DOCUMENTS the replacing behaviour SHALL change with it, including the messages
the engine emits at runtime. Two of those messages instruct a reader to repair a malformed link by
re-supplying it with a corrected type; under append the corrected type is a different pair, so the
malformed link survives and the very finding the message remedies persists forever. An emitted
command that no longer runs as written is a defect this engine already forbids elsewhere.

Because replacement is the documented repair for a malformed link, clearing and supplying SHALL be
combinable in ONE invocation, so that repair remains a single atomic write. They are currently
mutually exclusive, which would leave the repair as two writes with a zero-link window between
them, and a rejection on the second write would leave the epic with no links at all.

#### Scenario: A second link is added, not substituted
- **WHEN** a link is supplied to an epic that already records one
- **THEN** the epic records both

#### Scenario: Re-supplying a link with a corrected reason updates it in place
- **WHEN** a link whose type and target match one already recorded is supplied with a different
  reason
- **THEN** the epic records one link with that type and target, carrying the new reason

#### Scenario: Re-supplying a wholly identical link is not a duplicate
- **WHEN** a link matching one already recorded in type, target AND reason is supplied
- **THEN** the epic's recorded links are unchanged

#### Scenario: Repairing a malformed link is one atomic write
- **WHEN** an agent clears an epic's links and supplies the corrected set in one invocation
- **THEN** the invocation is accepted, and the epic's links are replaced in a single write

#### Scenario: An emitted repair instruction matches the behaviour
- **WHEN** the engine emits a message instructing a reader how to repair a malformed link
- **THEN** following that message as written removes the malformed link

### Requirement: A write that changes nothing says so
An epic-writing invocation whose effect on the record is empty SHALL say so, rather than reporting
the generic success line for a write that did not happen. The rule binds the WRITE SURFACE, not an
enumerated list of paths: whenever the save reports that it changed nothing, the invocation reports
that it changed nothing.

Scoping this to the paths a single change happens to introduce would be the very defect required
task item 1 exists to catch, so it is stated once over the surface. The save layer already returns
whether it was a no-op; the reporting layer currently discards that and prints success
unconditionally, which is why a same-valued title, status or priority ALREADY reports a write that
did not happen. Two paths this specification introduces reach the same state — supplying a link
already recorded, and clearing a field already absent — and they are instances of the rule rather
than its scope. In all of them the record is correct and no error occurred, so refusing would be
wrong; but reporting "updated" tells a reader something happened when nothing did.

#### Scenario: Any invocation whose save changed nothing reports no change
- **WHEN** an epic-writing invocation results in a save that reports it changed nothing — including
  setting a field to the value it already holds
- **THEN** the invocation exits zero and reports that nothing changed, rather than reporting the
  record was updated

#### Scenario: A no-op link supply reports no change
- **WHEN** a link already recorded is supplied
- **THEN** the invocation exits zero and reports that nothing changed, rather than reporting the
  record was updated

#### Scenario: A no-op clear reports no change
- **WHEN** a declared-nullable field that is already absent is cleared
- **THEN** the invocation exits zero and reports that nothing changed
