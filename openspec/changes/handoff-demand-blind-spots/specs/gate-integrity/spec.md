## MODIFIED Requirements

### Requirement: The interactive archive verb accepts an epic that is already archived

The **interactive archive verb** SHALL accept an epic whose `status` is **already** `archived`,
run the full archive gate on that invocation, and record the disposition the agent supplies. It MUST
NOT refuse the call as a no-op, and MUST NOT treat "the status did not change" as grounds to skip
the gate. Re-archiving an already-archived epic is an established shape in this engine, not an edge
case: the completion stamp is already guarded on `!epic.completedAt` precisely because the verb can
be run twice.

**Without this, `delivered` is unrecordable on the documented path.** The workflow pm emits ends
`/opsx:archive`, which moves the change directory on disk; the **archive-drift heal** then observes
the move and flips the epic to `archived`, stamping `outcome: unknown` because nobody supplied a
disposition at that moment. Every step so far is required behavior. The only remaining moment at
which the real disposition can be recorded is a call to the interactive verb on an epic that is by
then already `archived` — so a verb that refused that call would leave **every** openspec epic
following the documented workflow at `outcome: unknown`, which is the 42-of-49 headline defect this
release exists to close, reproduced in the field built to close it.

**The gate's demands are evaluated against the record and against where the archive moved the
change, never against the live change path.** By this point `openspec/changes/<id>/` has already
moved under `archive/`. The Gate 2 verdict and its evidence, the deferral assertion and the
attribution array are durable on the epic. The outstanding-work quantity is the one
`conductor-record` defines, and for an archived openspec change that quantity reads the ARCHIVED
`tasks.md`. It MUST NOT read as zero because the live path is empty. An implementer who reads the
gate's inputs from the live change path makes this requirement unsatisfiable, because the change is
not there any more, and the whole path goes inert. An implementer who treats the moved source as
zero makes the handoff demand inert on exactly this path. Measured in this repository before the
correction: two epics were archived `delivered` on it with a real task still open, at 53/54 and
46/47.

Which disposition an agent's record replaces, and which it may not, is defined by `epic-disposition`
and is not restated here.

#### Scenario: The documented archive sequence ends with the real disposition recorded

- **WHEN** an agent records a passing Gate 2 with its evidence, then runs `/opsx:archive` so the
  change directory moves on disk, then the archive-drift heal runs and flips the epic to `archived`
  — leaving the existing passing `gate2` untouched and stamping `outcome: unknown` with
  `recordedBy: "archive-drift-heal"` — and the agent then runs the interactive archive verb on that
  epic with `--status archived` and `outcome: delivered`
- **THEN** the call is accepted rather than refused for the status being unchanged, and the epic ends
  at `outcome: delivered` carrying the agent's record, with its passing Gate 2 intact and **no**
  `ungated` standing condition anywhere in its `gateReview` — the disposition an openspec epic
  earns on the documented path, reachable without hand-editing `state.json`

#### Scenario: The archive gate still binds the second call

- **WHEN** the interactive archive verb is run with `outcome: delivered` on an epic the heal already
  flipped to `archived` and whose `gate2` is `ungated` because no real verdict was ever recorded
- **THEN** the call is refused exactly as it would be for an epic being archived for the first time,
  because accepting the call is not the same as waiving the gate

#### Scenario: Open tasks in the moved tasks.md still refuse a delivered archive

- **WHEN** the documented sequence runs on an openspec-lane epic with a passing Gate 2 whose
  `tasks.md` holds 3 undeclared tasks with only 1 ticked: `/opsx:archive` moves the change, the heal
  flips the epic, and the agent runs the interactive archive verb with `outcome: delivered`, no
  `--carried-to` and a deferral assertion
- **THEN** it exits non-zero naming 2 of 1/3 task(s) outstanding, which is the count the record
  renders for the epic, and `state.json` is byte-identical

#### Scenario: The moved tasks.md, fully ticked, does not refuse

- **WHEN** the same sequence runs on an epic whose archived `tasks.md` has every undeclared task
  ticked and only its declared archive task open
- **THEN** the archive is accepted with outcome `delivered`

## ADDED Requirements

### Requirement: A delivered epic whose archived spec deltas are absent from the main specs is reported until they arrive

The conductor SHALL report, as a standing condition, every epic whose record claims delivery of a
change whose spec deltas the main specs do not hold. An epic is IN SCOPE when it meets all four:

- it is archived: its stored status is `archived` OR its change directory is archived on disk. This
  is the same OR the ungated standing condition uses, so that the integrity report (which reads
  stored epics) and the briefing (which reads epics resolved against disk) cannot disagree about an
  epic between `/opsx:archive` and the next heal;
- its lane is openspec (an absent lane read as openspec);
- its outcome is `delivered`;
- an archived change directory matches its id, by the same match that decides whether its change is
  archived.

The outcome scope is `delivered` alone, and deliberately. `delivered` is the only outcome that
claims the change's requirements shipped. A `killed` or `abandoned` change's deltas are SUPPOSED to
be absent. An `unknown` outcome claims nothing yet: an epic stamped `unknown` reaches this check when
its real disposition is recorded.

**The comparison.** For every `specs/<capability>/spec.md` in the archived change directory, the
conductor reads the delta's sections as OpenSpec defines them:

- **ADDED** and **MODIFIED** requirement headers MUST be present in the main spec
  `openspec/specs/<capability>/spec.md`.
- **REMOVED** headers MUST be absent.
- Each **RENAMED** pair's `TO` name MUST be present and its `FROM` name absent.

A header matches as OpenSpec matches it: the name after `### Requirement:`, with a closing run of
`#` removed and the ends trimmed, compared case-sensitively. Lines inside a code fence are not
headers. A RENAMED line that forms no `FROM`/`TO` pair is reported as a finding naming the file.
It MUST NOT be silently skipped: OpenSpec refuses such a delta, so an archived one is a record
nobody can check.

**Header presence only.** A MODIFIED requirement's BODY is not compared. A later change that
legitimately modifies the same requirement again changes that body. So a body comparison would fire
on every requirement amended twice, and a check that is wrong on routine work is a check people
learn to skip. The consequence is declared rather than hidden: a MODIFIED block whose new text never
arrived, while its header did, is not detected here.

**A later archived change discharges the obligation.** Another archived change whose delta for the
same capability touches the same header in the opposite direction discharges it:

- a later REMOVED, or a later RENAMED `FROM`, discharges an ADDED, a MODIFIED or a RENAMED `TO`;
- a later ADDED, MODIFIED or RENAMED `TO` discharges a REMOVED or a RENAMED `FROM`.

"Later" is decided by the archive directories' `YYYY-MM-DD` prefixes and only by them. Where the two
dates differ, the later date is later. Where they are equal, or either directory carries no date
prefix, the archive records no order between the two. That pair then discharges in BOTH directions,
because either main-spec state is what some order of the two archives produces. A finding that
depended on guessing that order would report a correct record as broken.

**The main spec is read from git's INDEX, not from the working tree and not from `HEAD`.** An
archive writes the main specs into the working tree, so a working-tree read passes at exactly the
moment the 0.48.0 loss was already under way: the edits were there, unstaged, until a hard reset
discarded them. The index equals `HEAD` whenever nothing is staged. Between staging and committing,
the index is what the next commit will record, so a report run in that window already names an
archive staged without its rewritten specs. A report reading `HEAD` would instead name every correct
archive until its commit lands. A capability whose main
spec is absent from the index holds no headers: each of its ADDED, MODIFIED and RENAMED `TO`
headers is reported, and none of its REMOVED ones is. When git cannot answer at all (no
repository, no git), nothing is reported for any epic. A read nobody could make is not evidence that
the specs are missing.

**It is a standing condition, never a refusal.** No archive path SHALL refuse on it: not the
interactive archive verb, not the archive-drift heal, not the backfill registration, and not the
archived-at-creation paths. pm's own closeout records `delivered` before `openspec archive` moves the
change, and every commit in this repository first runs tests that assert on its live record. A
refusal at the transition would therefore require the archive commit to exist before the disposition
it is gated on, and that commit cannot land until the disposition exists. The condition is instead
reported wherever the conductor reports its own integrity, with its own integrity check id and its
own briefing heading. It is computed once and read by both surfaces, and it is not consumed on
delivery: it clears only when the index holds what the deltas require. The same argument ships the
ungated archive as a standing condition.

Each finding names the epic, the archived change directory, the capability, every offending header,
and which way it fails (absent where it should be present, or present where it should be absent).
The remedy it names is to restore the missing spec edits (`openspec archive` rewrites them, and
`/opsx:sync` re-applies deltas) and to stage `openspec/` whole.

#### Scenario: A lost ADDED requirement is reported

- **WHEN** a `delivered` openspec-lane epic's archived change holds a delta for `engine-invocation`
  with two ADDED requirements, and the index's `openspec/specs/engine-invocation/spec.md` holds
  neither header, which is the state 0.48.0's main specs were in for two days
- **THEN** the integrity report and the briefing each name that epic, the change directory,
  `engine-invocation` and both headers as absent

#### Scenario: A REMOVED requirement still in the main spec is reported

- **WHEN** the archived delta REMOVES a requirement whose header the index's main spec still holds,
  and no later archived change adds it back
- **THEN** it is reported as present where it should be absent

#### Scenario: A requirement a later change modified again is not reported

- **WHEN** change A ADDED a requirement, and a later-dated change B MODIFIED the same requirement's
  body, and the index's main spec holds the header with B's text
- **THEN** nothing is reported for either change

#### Scenario: A requirement a later change removed is not reported

- **WHEN** change A ADDED a requirement, a later-dated change B REMOVED it, and the index's main spec
  does not hold the header
- **THEN** nothing is reported for A's ADDED header, and nothing for B's REMOVED one

#### Scenario: Two changes archived on the same date are unordered

- **WHEN** two changes archived under the same date prefix touch one header in opposite directions,
  one ADDED and one REMOVED
- **THEN** nothing is reported for that header whether the index's main spec holds it or not

#### Scenario: A rename is checked on both sides

- **WHEN** an archived delta RENAMES `FROM` one requirement `TO` another, and the index's main spec
  holds both names
- **THEN** the `FROM` name is reported as present where it should be absent, and the `TO` name is not
  reported

#### Scenario: Specs staged but not yet committed are not reported, and specs lost afterwards are

- **WHEN** `openspec archive` has rewritten a main spec and the rewrite is staged but not committed,
  and then a hard reset discards it
- **THEN** nothing is reported while the rewrite is staged, and after the reset the requirement is
  reported as absent

#### Scenario: A main spec absent from the index reports every header the delta adds

- **WHEN** the archived delta ADDS three requirements to a capability whose `spec.md` the index does
  not hold at all
- **THEN** all three headers are reported as absent

#### Scenario: No repository means no finding

- **WHEN** the check runs where git cannot answer
- **THEN** no epic is reported by this check

#### Scenario: The archive transition is not refused

- **WHEN** the interactive archive verb records `delivered` for an epic whose archived deltas are
  absent from the index's main specs, and every other gate demand is met
- **THEN** the archive succeeds, and the next integrity report names the epic under this check

#### Scenario: An outcome other than delivered is out of scope

- **WHEN** an epic archived `killed` has an archived change whose ADDED headers the main spec does not
  hold
- **THEN** this check does not report it
