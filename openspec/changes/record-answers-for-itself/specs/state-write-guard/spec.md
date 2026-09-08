## MODIFIED Requirements

### Requirement: A save that changes nothing writes nothing

A save whose resulting state is identical to what is on disk, ignoring `revision`, SHALL be a
no-op: no file write and no revision bump. Bumping the revision for a write that changes nothing
breaks byte-idempotence — running `upgrade` twice must leave `state.json` identical — and rewrites
a file for no reason.

A per-record last-touched stamp SHALL NOT defeat this. The identity comparison is over the whole
stored body with `revision` as its only exclusion, so a stamp applied to a record BEFORE the
comparison makes every save differ from disk unconditionally, the no-op path never fires, and
byte-idempotence is lost for every verb. Any such stamp SHALL therefore be applied AFTER the
identity comparison has already decided the save is not a no-op, and SHALL be derived by comparing
each record against the disk pre-image the comparison has already read — not by a second notion of
"changed" maintained elsewhere, and not by the callers, of which there are 69.

#### Scenario: Re-running an idempotent verb

- **WHEN** a verb saves state whose content, excluding `revision`, matches the file on disk
- **THEN** `state.json` is byte-identical afterwards, the revision is unchanged, and the save
  reports success

#### Scenario: A last-touched stamp does not break byte-idempotence

- **WHEN** a verb that stamps a last-touched date saves state whose content otherwise matches the
  file on disk
- **THEN** the save is still a no-op: no record is stamped, `state.json` is byte-identical, and the
  revision is unchanged

#### Scenario: A stamp is applied only to the records that changed

- **WHEN** a save that is not a no-op writes state in which some records changed and others did not
- **THEN** only the changed records carry an advanced last-touched date
