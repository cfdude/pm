## ADDED Requirements

### Requirement: A sync can be previewed without writing
The sync surface SHALL support a mode that reports the epics a sync would create or update and
writes nothing. Registration is the moment a backlog acquires a permanent record, and an
all-or-nothing import that cannot be inspected first gives the owner no point at which to decline
one of its members.

The preview SHALL report the same set the writing run would produce, derived the same way, so that
a preview which disagreed with the run it previews is impossible by construction rather than by
the two paths happening to agree.

The preview SHALL leave the state file byte-identical, including any field an ordinary run would
touch as a side effect of writing at all.

#### Scenario: A preview reports what a run would register
- **WHEN** an agent previews a sync in a repository holding unregistered work
- **THEN** it receives the epics a writing run would create or update

#### Scenario: A preview writes nothing
- **WHEN** a sync preview completes
- **THEN** the state file is byte-identical to what it was before the preview ran

#### Scenario: A preview of a repository with nothing to register reports an empty set
- **WHEN** an agent previews a sync in a repository where every item is already registered
- **THEN** the preview reports that nothing would be created or updated
