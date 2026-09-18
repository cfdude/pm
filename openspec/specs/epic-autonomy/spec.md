# epic-autonomy Specification

## Purpose
Defines what an epic's autonomy grants authorise, how a grant is taken back, and what turning
autonomy back on restores — so that the trust an epic carries is a record somebody can read and
revise, rather than an accumulation nothing ever subtracts from.

## Requirements

### Requirement: A pre-authorization is revocable, and revoking it is recorded

**Granting a pre-authorization SHALL ship its inverse.** The claim is scoped to the grant
deliberately, and not written as "every operation this capability offers": the level flag is its own
inverse, and the two annotation flags this capability also carries — the free-text context note and
the notification log — ship none and are not asked to, because each is an append-only record of
something that happened rather than a standing authorisation. An unrevoked grant authorises an
action tomorrow; a note about yesterday does not. The change that ships the revoke names both of
them as inverses deliberately not shipped, with that justification, rather than leaving them
silently uncovered by a blanket sentence.

`--preauthorize` grants; a **revoke** operation SHALL take a grant back, naming either the exact
action or the category the grant carries, and carrying a **non-empty reason**.

Revocation SHALL **record, not delete**. The revoked grant SHALL remain readable in the epic's
record carrying the fact of its revocation and that reason, on the same footing as a withdrawn gate
verdict and a superseded reconcile verdict: a deletion removes the evidence that the grant was ever
made, which is the same silence a disposition exists to prevent, and it makes "this action was
authorised and then was not" indistinguishable from "this action was never authorised".

A revoked grant SHALL NOT authorise anything. No later operation — including setting the level back
to autonomous — SHALL restore it; a revoked grant is taken back only by granting it again, which
writes a new grant and leaves the revocation readable beside it.

**A revoke SHALL mark only the matches that are not already revoked, and SHALL NEVER rewrite an
existing revocation stamp.** Because the documented un-revoke is granting again, an epic can
legitimately hold a revoked grant and a live grant for the same action at once, and a revoke naming
that action matches both. Re-stamping the older entry would replace a reason and a date that
describe something that happened with a later pair that describes something else — the same data
loss on a safety record that the already-revoked refusal below exists to prevent, reached through
the mixed case instead of the fully-revoked one.

Revoking SHALL be refused, writing nothing and exiting non-zero, where it would record nothing true:
when the named action or category matches no grant the epic holds, and when every grant it matches
is already revoked. A revoke that silently matched nothing would report success for an
authorisation that is still live.

#### Scenario: A granted action is revoked and no longer authorises

- **WHEN** an epic holds a pre-authorization for an exact action, and that action is revoked with a
  reason
- **THEN** the command exits zero, the epic's record still holds that grant, the grant reads as
  revoked carrying the supplied reason, and no surface reports it as a live authorisation

#### Scenario: A category grant is revoked by naming the category

- **WHEN** an epic holds a category-shaped pre-authorization and that category is revoked with a
  reason
- **THEN** the command exits zero and the category grant reads as revoked — a category grant is
  revocable by the same operation as an exact-action grant, not by a second one

#### Scenario: Revoking a grant the epic does not hold is refused

- **WHEN** a revoke names an action or category matching no grant the epic holds
- **THEN** the command exits non-zero naming the value it could not match, and the state of record
  is byte-identical to before the call

#### Scenario: Revoking an already-revoked grant is refused

- **WHEN** a revoke names a grant whose every match is already revoked
- **THEN** the command exits non-zero saying so, and the state of record is byte-identical to before
  the call — a second revocation would overwrite the first one's reason and date with a later one
  that describes nothing that happened

#### Scenario: A revoke over a mixed match leaves the earlier revocation untouched

- **WHEN** an epic holds a revoked grant and a later live grant for the same action, and that action
  is revoked again with a new reason
- **THEN** the command exits zero, the live grant reads as revoked carrying the new reason, and the
  earlier entry still carries its original revocation reason and date unchanged

#### Scenario: A revoked grant is not restored by re-arming autonomy

- **WHEN** an epic's autonomy level is set to off after a grant has been revoked, and later set back
  to autonomous
- **THEN** the revoked grant still reads as revoked and authorises nothing

#### Scenario: Revoking without a reason is refused

- **WHEN** a revoke is supplied with no reason, or with an empty one
- **THEN** the command exits non-zero, and the state of record is byte-identical to before the call

### Requirement: Turning autonomy off does not revoke, and turning it back on says what it restores

Setting an epic's autonomy level to off SHALL NOT alter its grants. Deletion is not the inverse of
granting: an epic taken off autonomy for the afternoon has not withdrawn the judgments somebody made
about which actions were safe, and clearing them would destroy a record the revoke operation above
exists to preserve.

The measured harm is not that the grants survive; it is that re-arming **silently** restores every
one of them. So setting the level to autonomous SHALL report the live grants it is arming — their
count, and each grant's action or category — on the same invocation that arms them. Revoked grants
SHALL NOT be reported as restored, because they are not.

A level that is already autonomous and is set to autonomous again SHALL report the same set: the
report is a statement of what is live, not a notification of a change.

#### Scenario: Turning autonomy off leaves the grants intact

- **WHEN** an epic carrying pre-authorizations has its autonomy level set to off
- **THEN** the command exits zero, the level reads off, and every grant the epic held is still held
  and still unrevoked

#### Scenario: Turning autonomy on enumerates the grants it arms

- **WHEN** an epic holding two live grants and one revoked grant has its autonomy level set to
  autonomous
- **THEN** the command exits zero and its output names the two live grants it is arming and their
  count, and does not present the revoked one as restored

#### Scenario: Arming an already-autonomous epic reports the same set

- **WHEN** an epic already at autonomy level autonomous, holding live grants, has its level set to
  autonomous again, so the write changes nothing
- **THEN** the command exits zero and still names those grants and their count — the report states
  what is live and is not conditional on the write having changed anything, so the path that reports
  "nothing changed" does not swallow it

#### Scenario: Arming an epic with no grants says so

- **WHEN** an epic holding no pre-authorizations has its autonomy level set to autonomous
- **THEN** the command exits zero and states that it is arming no pre-authorizations, rather than
  saying nothing — silence here is indistinguishable from a report that was not produced

### Requirement: A pre-authorization names something

A grant SHALL name a non-empty action, or a non-empty category drawn from the known category
vocabulary. A pre-authorization whose action is empty SHALL be refused, writing nothing and exiting
non-zero.

An empty action is not a harmless no-op record: it is a grant whose match against any candidate
action is undefined, and an implementer reading the decision rule may reasonably treat it as
matching nothing or as matching everything. The refusal belongs at the write, where the ambiguity is
still one re-run away from being said correctly, and it is the same both-halves-non-empty rule the
declined-deferral flag already carries for the same reason — a rule that was written once and never
reached this sibling.

**A grant already on disk that names nothing authorises nothing, and is reported.** The refusal
above binds writes that have not happened; it does nothing for a grant a previous release already
stored, which cannot be revoked either — a revoke names a stored value and an empty one is not
expressible as a flag value. So a grant whose action and category are both empty SHALL
authorise nothing, and that is discharged by exactly three surfaces, named here so the rule does not
demand a reader behaviour nothing ships: the re-arm report SHALL NOT name it among the grants it
arms; the read-only integrity surface `gate-integrity` defines SHALL report it; and the
execution-time decision rule this project emits — the one an agent, not the engine, applies — SHALL
say that a grant naming nothing does not cover an action. No engine code path evaluates a grant
against a candidate action today, so there is no fourth reader to bind. This is the same
refusal-plus-check pairing `epic-disposition` and `gate-integrity` carry for a stored epic id, and
it is stated here because a grant is not a reference and would otherwise fall between them.

#### Scenario: A grant with an empty action is refused

- **WHEN** a pre-authorization is supplied whose action half is empty and whose reason is present
- **THEN** the command exits non-zero naming the empty half, and the state of record is
  byte-identical to before the call — in particular the epic gains no autonomy block it did not
  already have

#### Scenario: A category grant with an empty category is refused

- **WHEN** a category-shaped pre-authorization is supplied whose category half is empty
- **THEN** the command exits non-zero, and the state of record is byte-identical to before the call

#### Scenario: A grant already on disk that names nothing authorises nothing

- **WHEN** a state file written before this change holds a grant whose action is an empty string,
  and that epic's autonomy level is set to autonomous
- **THEN** the report does not name it among the grants it is arming, and the integrity surface
  reports it

#### Scenario: A grant with an action and no reason is still accepted

- **WHEN** a pre-authorization names an action and supplies no reason
- **THEN** it is accepted, unchanged from today's behavior — this requirement constrains the half
  that decides what is authorised, not the half that explains it
