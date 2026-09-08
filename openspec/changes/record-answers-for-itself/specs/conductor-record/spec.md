## ADDED Requirements

### Requirement: An epic records when it was registered and when it was last touched
Every epic SHALL carry the moment it was registered and the moment it was last modified. Without
the first, no surface can answer how long an epic has sat, because an epic registered and never
started carries no other date: `startedAt` is absent by definition for that population, and it is
exactly the population a staleness question is about.

The registration date SHALL be written at the single sink every epic creation routes through, and
SHALL NOT be bound to an enumeration of creation surfaces. That enumeration approach has already
been tried in this engine for a sibling field and already went stale — two creation paths carried
the rule, two did not, and no consumer complained, because absence was forgiven by the very gate
meant to catch it. Binding at the sink inherits the source scan that already forbids bypassing it.
The registration date SHALL NOT be rewritten by any later mutation.

The last-touched date SHALL be advanced only for records whose stored content changed, and the
mechanism SHALL respect the no-op save requirement the `state-write-guard` capability owns: a save
that changes nothing writes nothing and therefore touches nothing. Neither timekeeping field SHALL
be an input to that comparison — writing a registration date is not itself a touch, whether it
happens during the release migration or during a later standalone re-run of the recovery.

Both SHALL be absent-tolerant: an epic written by an earlier version carries neither, and any
reader SHALL treat absence as "unknown", never as a date — never substituting another field's date
and never substituting the current time. Registration records when pm learned of the work, NOT how
old the work is: a historical change registered today is correctly stamped today.

This capability specifies STORAGE and absence tolerance only. What a staleness surface DISPLAYS is
deliberately out of scope here and belongs to the recurring grooming pass that consumes these
fields; specifying a reader in the same change that introduces the field it reads would put a
requirement in this delta that nothing in this delta implements.

#### Scenario: A newly registered epic carries its registration date
- **WHEN** an epic is registered by any path
- **THEN** it carries a registration timestamp, and that timestamp is unchanged by every subsequent
  mutation of that epic

#### Scenario: A creation path cannot omit the stamp
- **WHEN** a new epic-creating path is added that does not route through the creation sink
- **THEN** the suite fails, rather than the new path producing epics with no registration date

#### Scenario: A mutation advances the last-touched date
- **WHEN** a mutation changes an epic's stored content
- **THEN** that epic's last-touched timestamp is advanced, its registration timestamp is not, and
  epics whose content did not change are not advanced

#### Scenario: An epic from an earlier version reports unknown, not a date
- **WHEN** a reader encounters an epic carrying no registration timestamp
- **THEN** it reports the registration date as unknown, and never substitutes another field's date
  or the current time

### Requirement: Registration dates are recovered from history by a re-runnable operation
The operation that populates registration dates from history SHALL be re-runnable, and the release
migration SHALL invoke it rather than performing the recovery itself.

A migration entry runs at most once per repository, keyed to the stamped version. An operation that
reads version-control history produces a different result per checkout — two checkouts of one
remote differ by whatever history each has fetched — so performing the recovery inside a one-shot
migration freezes a wrong answer permanently in the checkout that had less history at that moment,
and it never recovers when that checkout catches up. This is a distinct constraint from the network
law and is stated in the engine's own migration framework.

Where the state file is tracked, the commit that first introduced an epic's id into it SHALL be the
source of that epic's registration date. A commit at a SHALLOW BOUNDARY SHALL NOT be
accepted as that source. Git has cut such a commit's parents, so it diffs against nothing and reports
every id in the file as introduced there — a naive search would hand an entire archive one fabricated
date and record it as fact, which is precisely the outcome the absence rule exists to prevent. A
boundary hit SHALL yield ABSENT, and SHALL remain re-attemptable: unshallowing the clone and
re-running recovers the real dates, which is the case the re-runnable requirement above exists for. Where no such evidence is recoverable — the file is
untracked, the history is shallow, or the id predates the tracked history — the date SHALL be left
absent, absence SHALL mean unknown, and a later run SHALL be free to recover it.

The operation SHALL be idempotent and SHALL NOT overwrite a date already present. It SHALL read
only local version-control history, invoked with an argument vector rather than a shell string,
because epic ids are read from a state file that may predate the id validation now applied at
registration.

The release migration SHALL leave the last-touched date ABSENT on pre-existing epics rather than
stamping its own run time. This is a consequence of the exclusion above and not a separate rule: the
migration writes registration dates across the whole archive in one save, so without excluding the
timekeeping fields from the per-record comparison every epic in every repository would read as last
touched on upgrade day. Stamping it would record every epic in the fleet as last touched on
upgrade day, which is the same signal destruction this specification rejects for the registration
date.

#### Scenario: A recovery finds a real date from tracked history
- **WHEN** the operation runs where the state file is tracked and the history contains the commit
  that introduced an epic's id
- **THEN** that epic's registration date is that commit's date, not the run time

#### Scenario: An unrecoverable date is left absent and stays re-attemptable
- **WHEN** the operation cannot recover an epic's introducing commit
- **THEN** the date is left absent, no date is fabricated, and a later run in a checkout with more
  history recovers it

#### Scenario: Re-running never overwrites a recovered date
- **WHEN** the operation runs again over epics whose dates it already recovered
- **THEN** no already-present date changes

#### Scenario: The migration does not stamp last-touched
- **WHEN** the release migration runs over a state file of pre-existing epics
- **THEN** no epic carries a last-touched date as a result of the migration's own write
