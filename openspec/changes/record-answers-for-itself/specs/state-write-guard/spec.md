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

That per-record comparison SHALL EXCLUDE the timekeeping fields themselves — the registration date
and the last-touched date — exactly as the whole-body comparison excludes `revision`, and for the
same reason: a field this mechanism introduces must not be an input to the mechanism's own decision.
A record whose ONLY delta is a newly recovered registration date is a recovery, not a touch. Without
that exclusion any write populating registration dates makes every record it touches differ from its
pre-image, so the last-touched stamp fires on all of them — and that is not hypothetical: the release
migration applies every pending transformation to one in-memory state and saves ONCE, so a recovery
sweeping an entire archive would stamp every record as last touched on upgrade day. The exclusion
SHALL hold identically for a later standalone re-run of that recovery, which is the same write on a
different day.

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

#### Scenario: Recovering a registration date is not a touch

- **WHEN** a write populates a record's registration date and changes nothing else about it —
  whether during the release migration or during a later standalone re-run of the recovery
- **THEN** that record's last-touched date is unchanged