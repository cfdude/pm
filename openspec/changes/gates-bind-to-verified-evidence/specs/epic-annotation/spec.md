## MODIFIED Requirements

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

**One exception: an epic that owes a reconcile.** While an epic owes a reconcile (as `gate-integrity`
defines it), a clear of its links is refused whatever else the invocation supplies, because it would
remove the link the owed verdict must be recorded against — `gate-integrity` "A write never destroys
the record of an owed reconcile". The repair is not lost, only ordered: every engine message that
instructs a reader to repair a link by clearing and re-supplying SHALL, when the epic it names owes a
reconcile, name `record-reconcile` as the step before the repair.

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

#### Scenario: The repair on an owing epic names the verdict first
- **WHEN** an epic that owes a reconcile holds a malformed link, and the engine emits the repair
  instruction for it
- **THEN** the instruction names `record-reconcile` before the clear-and-re-supply invocation, and the
  clear-and-re-supply invocation run before any verdict is refused with `state.json` byte-identical
