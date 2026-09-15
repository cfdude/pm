## ADDED Requirements

### Requirement: A recorded gate verdict can be withdrawn, and the withdrawal is recorded

`update-epic <id> --withdraw-gate-review <1|2> --withdrawal-reason "<why>"` MUST remove the epic's
stored Gate N verdict from `gateReview.gateN` and MUST append `{gate, entry, reason, withdrawnAt}` to
the epic's `withdrawnGateReviews` array. `entry` is the removed verdict exactly as it was stored,
including any `superseded` history it carried. The flag MUST be repeatable, so distinct gates are
withdrawn in one invocation under its one reason.

A verdict recorded on the wrong epic is not a wrong verdict; it is a verdict in the wrong place.
Re-recording can replace a verdict but cannot say it does not belong here, which left the gate record
as the one field in `state.json` with no inverse.

The withdrawal is recorded rather than erased, so the record shows a verdict was recorded and taken
back rather than that none ever existed. The whole entry moves: flattening it to the issue's
suggested `{verdict, reviewedAt}` would drop the range, the artifacts and the reviewer an audit of the
withdrawal needs.

#### Scenario: Withdrawing a recorded verdict moves it to the sibling record

- **WHEN** an epic carries a Gate 2 verdict `pass` with `baseSha` and `headSha`, and
  `update-epic <id> --withdraw-gate-review 2 --withdrawal-reason "recorded on the tracker mirror"`
  runs
- **THEN** `gateReview.gate2` is absent, and the last `withdrawnGateReviews` entry has `gate: 2`, that
  reason, a `withdrawnAt` timestamp, and an `entry` deep-equal to the verdict as stored before the call

#### Scenario: The superseded history moves with the verdict and is not restored

- **WHEN** Gate 1 was recorded twice, so its stored entry carries a `superseded` entry, and Gate 1 is
  withdrawn
- **THEN** `gateReview.gate1` is absent (the superseded entry is NOT promoted to the stored verdict),
  and the withdrawn `entry` carries the `superseded` field it had

#### Scenario: The other gate is untouched

- **WHEN** an epic carries both a Gate 1 and a Gate 2 verdict and only Gate 1 is withdrawn
- **THEN** `gateReview.gate2` deep-equals its value before the call

#### Scenario: Both gates in one invocation

- **WHEN** `update-epic <id> --withdraw-gate-review 1 --withdraw-gate-review 2 --withdrawal-reason "x"`
  runs on an epic carrying both verdicts
- **THEN** both `gateReview.gate1` and `gateReview.gate2` are absent, and `withdrawnGateReviews` gained
  exactly two entries, one per gate, each carrying reason `x`

#### Scenario: Re-recording after a withdrawal starts clean

- **WHEN** Gate 2 is withdrawn and then `record-gate-review <id> --gate 2 --verdict pass` runs with a
  valid range
- **THEN** `gateReview.gate2` holds the new verdict with no `superseded` field, and the withdrawal is
  still present in `withdrawnGateReviews`

#### Scenario: The write is read back

- **WHEN** a withdrawal is requested and the state read back after the write still carries that
  gate's verdict, or carries no withdrawal entry for that gate with that reason
- **THEN** the verb exits non-zero with a message stating the withdrawal did NOT land

### Requirement: A gate withdrawal is refused where it would record nothing true

Each of these MUST be refused with no write, and each refusal MUST name its cause:

1. `--withdrawal-reason` given with neither `--withdraw-gate-review` nor `--withdraw-commit`;
2. `--withdraw-gate-review` without a non-blank `--withdrawal-reason`;
3. a gate value other than `1` or `2`;
4. the same gate given twice in one invocation;
5. a gate with no stored verdict (`gateReview.gateN` absent);
6. a gate whose stored verdict is `ungated`.

They are evaluated in the order listed. Refusals 5 and 6 apply only to gate values that passed 3 and
4, and are disjoint: 5 is an absent entry, 6 is a present entry with one particular verdict. Each
scenario below supplies every other input valid, so it exercises exactly one refusal.

- Refusing where there is nothing to withdraw keeps the flag from becoming a general "reset the gate"
  lever.
- An `ungated` entry is an engine record that no review happened. It is not a review, so recording it
  as a review taken back would be a false record, and it would relabel "never reviewed" as
  "withdrawn" on every surface.
- A reason flag accepted alone is a silent no-op: today it passes, is never read, and writes nothing.

#### Scenario: The reason flag alone

- **WHEN** `update-epic <id> --withdrawal-reason "x"` runs with neither withdrawal flag
- **THEN** it exits non-zero naming `--withdraw-gate-review` and `--withdraw-commit`, and `state.json`
  is byte-identical

#### Scenario: No reason

- **WHEN** `update-epic <id> --withdraw-gate-review 2` runs on an epic carrying a stored Gate 2 `pass`
- **THEN** it exits non-zero naming `--withdrawal-reason`, and `state.json` is byte-identical

#### Scenario: An invalid gate value

- **WHEN** `update-epic <id> --withdraw-gate-review 3 --withdrawal-reason "x"` runs on an epic carrying
  stored Gate 1 and Gate 2 `pass` verdicts
- **THEN** it exits non-zero naming `1` and `2` as the valid values, and `state.json` is byte-identical

#### Scenario: The same gate twice

- **WHEN** `update-epic <id> --withdraw-gate-review 2 --withdraw-gate-review 2 --withdrawal-reason "x"`
  runs on an epic carrying a stored Gate 2 `pass`
- **THEN** it exits non-zero naming Gate 2 as given twice, and `state.json` is byte-identical

#### Scenario: Nothing to withdraw

- **WHEN** `update-epic <id> --withdraw-gate-review 1 --withdrawal-reason "x"` runs on an epic with no
  `gateReview.gate1`
- **THEN** it exits non-zero stating there is no Gate 1 verdict to withdraw, and `state.json` is
  byte-identical

#### Scenario: An ungated stamp

- **WHEN** an openspec-lane epic's change was archived on disk and the archive-drift heal stamped its
  Gate 2 `ungated`, and `update-epic <id> --withdraw-gate-review 2 --withdrawal-reason "x"` runs
- **THEN** it exits non-zero stating an `ungated` entry is cleared by recording a real verdict, and
  `state.json` is byte-identical

### Requirement: A gate withdrawal is a field write the archive gate decides on

`--withdraw-gate-review` MUST be a field write of the interactive archive verb in the sense of
"The interactive archive verb gates the record the invocation writes" and "An update to an archived
epic does not break an obligation its archive met". Both requirements bind it as written, with no
exception, and this requirement adds no rule to either. How their refusals word a withdrawn Gate 2 is
defined once, by "A withdrawn gate is reported as withdrawn, never as absent".

A Gate 1 withdrawal carries no archive obligation, so neither requirement refuses it.

The bypass Gate 1 first found on `--withdraw-commit` was one instance of an ordering defect shared by
every field write of the verb, so the rule lives with the verb and not with either withdrawal flag.

#### Scenario: A Gate 2 withdrawal and a delivered archive in one call are refused

- **WHEN** an openspec-lane epic carries a passing Gate 2 covering its attributed commits and no
  outstanding work, and `update-epic <id> --withdraw-gate-review 2 --withdrawal-reason "x"
  --status archived --outcome delivered --no-deferrals` runs
- **THEN** it exits non-zero with a message stating Gate 2 was withdrawn and quoting `x` (the wording
  "A withdrawn gate is reported as withdrawn, never as absent" defines), `state.json` is
  byte-identical, and the epic is not archived

#### Scenario: Withdrawing Gate 2 from an archived delivered epic is refused

- **WHEN** an openspec-lane epic is `archived` with an agent-recorded `delivered` disposition, a
  passing Gate 2 covering its attributed commits and no outstanding work, and `update-epic <id>
  --withdraw-gate-review 2 --withdrawal-reason "x"` runs without `--status`
- **THEN** it exits non-zero, prints the invocation that also records a disposition carrying
  `--correct-disposition`, and `state.json` is byte-identical

#### Scenario: An archived delivered epic whose Gate 2 already failed can have it withdrawn

- **WHEN** an openspec-lane epic is `archived` `delivered`, and a Gate 2 `fail` was recorded against it
  by `record-gate-review` after it was archived, and `update-epic <id> --withdraw-gate-review 2
  --withdrawal-reason "x"` runs
- **THEN** it exits zero, because the record already failed its Gate 2 obligation before the call, and
  the epic is named by the withdrawn kind of the standing condition

#### Scenario: Withdrawing Gate 1 from an archived delivered epic is accepted

- **WHEN** the archived `delivered` epic of "Withdrawing Gate 2 from an archived delivered epic is
  refused", whose Gate 2 was met, runs `update-epic <id> --withdraw-gate-review 1 --withdrawal-reason
  "x"`
- **THEN** it exits zero and Gate 1 is in the withdrawn state

#### Scenario: A misplaced verdict is withdrawn and the disposition corrected in one call

- **WHEN** an openspec-lane epic is `archived` with an agent-recorded `delivered` disposition, carrying
  a Gate 1 verdict recorded with `--artifact` evidence and a Gate 2 verdict recorded 2 seconds apart, so
  `integrity` reports it under `gate-recorded-as-bookkeeping`, and `update-epic <id>
  --withdraw-gate-review 1 --withdraw-gate-review 2 --withdrawal-reason "x" --status archived
  --outcome superseded --reason "y" --correct-disposition "z" --no-deferrals` runs
- **THEN** it exits zero; the epic is `archived` with outcome `superseded`, keeps the prior `delivered`
  disposition under `superseded`, carries no Gate 1 or Gate 2 verdict and two `withdrawnGateReviews`
  entries; and a following `integrity` run reports the epic under NONE of
  `gate-recorded-as-bookkeeping`, `archived-with-no-gate-2-review`,
  `archived-with-withdrawn-gate-2`, and `archived-openspec-epic-with-no-gate-1`

### Requirement: A withdrawn gate is reported as withdrawn, never as absent

A gate is in the **withdrawn** state when `gateReview.gateN` is absent AND at least one
`withdrawnGateReviews` entry exists for that gate. A gate with a stored verdict, `ungated` included,
is never in it, whatever its withdrawal history.

On every surface named below, the withdrawn state MUST be distinguishable from a gate that was never
recorded. A withdrawal MUST NOT discharge an obligation: every refusal and finding an absent gate
produces MUST still be produced, naming the withdrawal and quoting its reason.

This is the asymmetry `attribution-withdrawn` already has against `none-attributed`. Moving the entry
out makes every reader see no stored verdict, which is the safe direction. Without a distinct state,
though, never-recorded and withdrawn look the same, and 0.38.0's Gate 2 found that collapse letting an
epic archive cleanly on the neighbouring field.

#### Scenario: The archive gate refuses a withdrawn Gate 2 by name

- **WHEN** an unarchived openspec-lane epic whose Gate 2 is in the withdrawn state, with no outstanding
  work, is archived with `--outcome delivered --no-deferrals`
- **THEN** the archive is refused, the message states Gate 2 was withdrawn and quotes the withdrawal
  reason, and `state.json` is byte-identical

#### Scenario: The regression refusal names a withdrawn Gate 2 by name

- **WHEN** the refusal of "Withdrawing Gate 2 from an archived delivered epic is refused" fires
- **THEN** its message states Gate 2 was withdrawn and quotes the reason, and does not state that Gate 2
  is missing

#### Scenario: A withdrawn Gate 1 is named by the no-Gate-1 check

- **WHEN** an archived openspec-lane epic in completion scope carries a passing Gate 2 and a Gate 1 in
  the withdrawn state, and `integrity` runs
- **THEN** `archived-openspec-epic-with-no-gate-1` reports that epic, and its detail states Gate 1 was
  withdrawn and quotes the reason

#### Scenario: Re-recording clears the withdrawn state

- **WHEN** an unarchived openspec-lane epic's Gate 2 is withdrawn and then re-recorded as `pass` over
  a range whose head is the epic's last attributed commit, and the epic has no outstanding work
- **THEN** `update-epic <id> --status archived --outcome delivered --no-deferrals` exits zero, and
  neither PROJECT.md nor the brief nor `integrity` names Gate 2 of that epic as withdrawn

#### Scenario: PROJECT.md and the brief show one withdrawn gate

- **WHEN** an epic carries a passing Gate 1 and a Gate 2 in the withdrawn state, and PROJECT.md is
  rendered and the brief is built
- **THEN** each shows that epic, by its id, with Gate 2 as `withdrawn — <reason>` and no Gate 2 verdict

#### Scenario: PROJECT.md and the brief keep an epic whose every gate is withdrawn

- **WHEN** an epic's Gate 1 and Gate 2 are both in the withdrawn state, and PROJECT.md is rendered and
  the brief is built
- **THEN** each still lists that epic by its id in its gate table, with both gates shown as
  `withdrawn — <reason>`

#### Scenario: PROJECT.md and the brief agree on the gate table

- **WHEN** a repository holds epics with stored, withdrawn and absent gates, and PROJECT.md is rendered
  and the brief is built
- **THEN** the set of epic ids each lists in its gate table is the same, and each epic's gate cell text
  is identical on both surfaces, up to each surface's own row cap

#### Scenario: The activity log records a withdrawal and nothing that merely looks like one

- **WHEN** the activity log is enabled and a gate is withdrawn through `update-epic`
- **THEN** exactly one event of kind `gate-withdrawn` naming the epic and gate is appended, and the
  activity report's gates section lists it

#### Scenario: A verdict removed without a withdrawal record is not logged as a withdrawal

- **WHEN** the activity log is enabled and a state write removes `gateReview.gate2` without adding a
  `withdrawnGateReviews` entry
- **THEN** no `gate-withdrawn` event is appended

## MODIFIED Requirements

### Requirement: The archive-drift heal writes one record at the moment it flips a status

The **archive-drift heal** SHALL write a **single** record for the transition it performs, whose
two halves bind different sets of epics:

- the **disposition half** — an `outcome` of `unknown` carrying `recordedBy` as a field — binds
  **every lane**, because the heal flips an epic of any lane and the outcome invariant above admits
  no lane exception;
- the **bypass half** — `gateReview.gate2` with the verdict value `ungated`, a value distinct from
  `pass` and `fail`, carrying `reviewedAt` and `recordedBy` — binds **openspec-lane epics only**, and
  among those, only epics whose Gate 2 is not in the withdrawn state.

On both halves, `recordedBy` SHALL be the single fixed literal token `archive-drift-heal`, so a test
and a consumer bind to it exactly rather than to a description of the path. `reviewer` carries a
reviewer's identity and MUST be absent on an `ungated` entry, so an audit query over `reviewer`
never mixes path names with the identities of people and agents who actually reviewed something.

**The bypass half MUST NOT be written for a non-openspec-lane epic.** Gate 2 is an openspec-lane
obligation: the heal and the integrity checks treat only openspec-lane epics as owing it. An `ungated`
entry on a `claude-code` or `superpowers` epic would assert a missing review that lane was never
required to have, and the only way to clear it would be recording a Gate 2 nobody owed — a standing
condition that is noise by construction. The heal reaches every lane and the lanes it reaches most are not openspec: it is a live, reachable
shape, not a hypothetical one — this repository holds 68 archived epics of which 65 are not
openspec-lane, and the dual-lane registration defect deliberately left unfixed this release keeps
producing superpowers-lane epics whose ids are date-prefixed variants of openspec ones.

**The heal's openspec-lane test is a site deciding openspec-lane membership** and SHALL normalize an
absent `lane` exactly as the three sites named in the normalization requirement below do. A lane-less
epic renders as openspec-lane everywhere, so a strict test here would silently deny it the bypass
record that its rendering says it owes.

**The bypass half MUST NOT be written onto an epic whose Gate 2 is in the withdrawn state** — no
`gateReview.gate2`, and at least one `withdrawnGateReviews` entry for Gate 2. `ungated` means nobody
reviewed the work. For an epic whose review was recorded and then taken back, that is a different and
false claim. A stored `ungated` would also end the withdrawn state, so every surface would word the
epic as never reviewed. The standing condition is still reported, as a withdrawn Gate 2, by the
requirement below, and its clearing path is unchanged: record a real verdict.

Splitting the halves by lane does not split the write: it remains **one** write, and an epic of any
lane leaves the heal carrying a disposition.

**The heal's outcome record carries `recordedBy`, not only a free-text reason.** `conductor-record`
defines `recordedBy` as the general form of the stamp every path that writes a disposition the agent
did not supply must use, and the heal is exactly such a path; giving its outcome a prose reason alone
would leave a consumer parsing the very prose that field exists to stop it parsing. The reason MAY
additionally name the path for a human reader, and no consumer may depend on that prose.

**The archive backfill registration SHALL NOT write a `gate2` entry at all.** Its `outcome: unknown`
with `recordedBy: "archive-backfill"` already records precisely how the epic reached `archived`,
so an `ungated` verdict would add no information — and it would add a permanent one. An `ungated`
entry is a standing condition whose only clearing path is a real passing Gate 2 carrying `baseSha`
and `headSha` (the requirement below), which for a change archived long before the conductor existed
is either impossible or fabrication. The scale is measured, not hypothetical: this repository holds
68 archived epics, 3 of which carry a passing Gate 2, so a backfill that wrote `ungated` per epic
would produce an unclearable finding against essentially every archived change in the repo on its
first run — the exact flood `conductor-record` created the `archive-backfill` stamp to prevent, and
which its own rationale names ("the first run of the backfill fills the repo's integrity report with
findings against changes that were archived long before the conductor could have guarded them").

Writing the bypass and the outcome as two independent records is what produces an archived epic
carrying one and not the other, which is why this is one write and why the outcome invariant stated
in the requirement above binds it.

#### Scenario: The archive-drift heal records the bypass and the outcome together

- **WHEN** the archive-drift heal archives an openspec-lane epic that has no `gateReview.gate2` and no
  `withdrawnGateReviews` entry for Gate 2
- **THEN** one write leaves the epic with `gateReview.gate2` at verdict `ungated`, carrying its
  timestamp and `recordedBy: "archive-drift-heal"` and no `reviewer`, and with `outcome: unknown`
  carrying `recordedBy: "archive-drift-heal"` as a field — so a later reader can tell it apart from
  an epic that passed a real implementation review without parsing any prose, and no archived epic
  is left without an outcome

#### Scenario: A healed non-openspec-lane epic gets a disposition and no ungated condition

- **WHEN** the archive-drift heal flips a `claude-code`- or `superpowers`-lane epic to `archived`
- **THEN** the epic carries `outcome: unknown` with `recordedBy: "archive-drift-heal"` and **no**
  `gateReview.gate2` entry, so it is never named as an ungated archive — Gate 2 is not an obligation
  of that lane, and a condition asserting a review it never owed would be noise on the majority of the
  epics this function touches, clearable only by recording a Gate 2 nobody owed

#### Scenario: A healed lane-less epic is treated as openspec-lane by the heal

- **WHEN** the archive-drift heal flips an epic that has no `lane` field, no `gateReview.gate2` and no
  Gate 2 withdrawal to `archived`
- **THEN** it receives the bypass half exactly as an epic with `lane: "openspec"` does, because the
  heal's lane test normalizes an absent lane the same way every other openspec-lane decision does

#### Scenario: The archive backfill writes no gate verdict

- **WHEN** the archive backfill registration registers a historical archived change as an epic
- **THEN** the epic carries `outcome: unknown` and `recordedBy: "archive-backfill"` and NO
  `gateReview.gate2` entry, so it is never reported as an ungated archive and never acquires a
  standing condition that only a Gate 2 review of a long-archived change could clear

#### Scenario: An epic healed to archived during an upgrade still carries an outcome

- **WHEN** an upgrade runs in a repo where a change already sits under `openspec/changes/archive/`
  while its epic's status has not yet been healed, so the epic becomes `archived` after the
  migration that stamps outcomes has already passed over the epic list
- **THEN** once the run completes the epic is `archived` **and** carries an `outcome`, rather than
  landing archived with none and never being revisited because the version stamp now says the
  migration ran

#### Scenario: The heal does not stamp over a withdrawn Gate 2

- **WHEN** an openspec-lane epic carrying no disposition, whose Gate 2 is in the withdrawn state, has
  its change directory moved under `openspec/changes/archive/`, and a mutating verb runs the heal
- **THEN** the epic is `archived` and carries `outcome: unknown` with
  `recordedBy: "archive-drift-heal"`, and `gateReview.gate2` is absent — no `ungated` entry is
  written

#### Scenario: An existing verdict is never overwritten by the heal

- **WHEN** the archive-drift heal archives an openspec-lane epic that already carries a recorded
  `gate2` verdict
- **THEN** the existing verdict is left exactly as recorded and no bypass entry replaces it

#### Scenario: The bypass verdict cannot be self-certified

- **WHEN** the agent runs `record-gate-review <id> --gate 2 --verdict ungated`
- **THEN** the command exits non-zero with a message naming the accepted verdicts, because a
  verdict that means "no review happened" MUST be writable only by the engine recording that fact,
  never by the party whose work would otherwise be reviewed

#### Scenario: The storable and the agent-writable verdict vocabularies stay distinct

- **WHEN** the set of verdicts an agent may pass to `record-gate-review --verdict` and the set of
  verdicts the engine may store on `gateReview.gate2` are compared
- **THEN** they are two separate lists — `pass` and `fail` for the agent, `pass`, `fail` and
  `ungated` for storage — and widening the single `--verdict` allowlist to admit `ungated` for
  storage's sake is a failure of the scenario above, not a way to satisfy it

### Requirement: An ungated archive is a standing condition until a real verdict supersedes it

The conductor reports two kinds of this standing condition. Both SHALL be named wherever the conductor
reports its own integrity, and their notice MUST NOT be consumed on delivery.

- **The ungated kind:** an epic in completion scope carrying an `ungated` Gate 2.
- **The withdrawn kind:** an epic that is archived, whose lane is openspec (an absent lane normalized
  as openspec), which is in completion scope, and whose Gate 2 is in the withdrawn state. "Archived"
  here means its stored status is `archived` OR its change directory is archived on disk. The
  integrity report reads stored epics and the briefing reads epics resolved against disk, and without
  that OR they would disagree about an epic between `/opsx:archive` and the next heal.

The two kinds are disjoint, because a gate carrying `ungated` is never in the withdrawn state. They
are ONE definition, computed in one place and read by the integrity report and the briefing alike.
Each surface MUST present the withdrawn kind under its own heading: its own integrity check id and
title, and its own briefing heading. Neither the withdrawn kind's own heading or check title,
nor any heading whose block encloses a withdrawn-kind entry (an umbrella heading shared with the
ungated kind), may state or imply that no review was recorded. A heading of a separate block printed
earlier is not above the entry in this sense.

Each reader MUST word the kinds differently. "No Gate 2 review recorded by anyone" is true of the
ungated kind and false of the withdrawn one, whose notice names the withdrawal and quotes the latest
withdrawal's reason. Where ANY Gate 2 withdrawal entry holds an `ungated` stamp in its `superseded`
field, the notice MUST say so, so a withdrawal never hides "never reviewed", even after a later
re-record and second withdrawal. The guarantee reaches as far as the record does: `record-gate-review`
keeps one level of `superseded`, so an `ungated` stamp superseded twice before any withdrawal is not
in the record to report.

**The two kinds filter differently, and on purpose.** The ungated kind is keyed on a stamp: a durable
record that an archive bypassed Gate 2. The heal writes that stamp only onto openspec-lane epics it
archives, but a later lane switch or status change does not undo the bypass, so the stamp stays
reported wherever the epic moves. That is today's behavior, and this change keeps it. The withdrawn
kind is keyed on a state that can arise on any lane and at any status. It is reported only where
Gate 2 is owed at archive, which is the set the heal would have stamped.

An epic outside completion scope — one that ended `killed`, `superseded`, `abandoned`, `declined`
or `unreconstructable`, or one registered by the archive backfill — owes no Gate 2 and is named by
neither kind.

Either kind is a standing record condition, not an episode. The write-conflict contention warning
describes a run of events that has ended, so it is consumed once a session has seen it. The condition
here persists in `state.json` until something changes it, and a notice that consumed itself would
report it to one session and hide it from every session after.

Only the archive-drift heal produces `ungated` entries, and only for openspec-lane epics. The
archive backfill registration and the two archived-at-creation paths are forbidden above from
writing a `gate2` entry at all, so no epic any of them registers can ever be named by this notice.
That is what keeps a standing, unclearable condition from being asserted en masse against changes
archived before the conductor could have guarded them. The heal's lane binding does the same job for
the lanes that have no Gate 2 to record: the heal never stamps a non-openspec-lane epic, so no such
epic is named by the ungated kind unless it was stamped as openspec-lane and switched lanes afterwards.

Recording a real Gate 2 verdict with evidence SHALL supersede an `ungated` entry and SHALL end the
withdrawn state, and that is what clears either notice. The superseded entry and the withdrawal MUST
remain readable, so an audit can still see what the epic carried before it was reviewed. Without a
clearing path the notice would be unremediable by design, which is how a standing signal becomes
noise everyone filters.

#### Scenario: An ungated archive is visible in the session briefing

- **WHEN** a briefing is composed in a repo containing at least one epic in completion scope whose
  recorded Gate 2 verdict is `ungated`
- **THEN** the briefing names those epics, so the condition is visible in-session rather than
  discoverable only by querying `state.json`

#### Scenario: Delivering the notice does not clear it

- **WHEN** a briefing carrying that notice is delivered into a session and a later briefing is
  composed with the epic's `ungated` verdict unchanged
- **THEN** the later briefing names the epic again, because the condition still holds

#### Scenario: Delivering the withdrawn notice does not clear it either

- **WHEN** a briefing naming an epic under the withdrawn kind is delivered into a session and a later
  briefing is composed with that epic's withdrawal unchanged
- **THEN** the later briefing names the epic again

#### Scenario: A real verdict supersedes the bypass entry

- **WHEN** the agent records a passing Gate 2 with its evidence against an epic whose `gate2` is
  `ungated`
- **THEN** the epic stops being reported as an ungated archive, and the record still shows that it
  was archived ungated before the review happened

#### Scenario: An archived epic with a withdrawn Gate 2 is named, and worded as withdrawn

- **WHEN** an openspec-lane epic's Gate 2 is withdrawn while it is open, its change is then archived
  on disk and the heal flips it to `archived` with outcome `unknown`, and the integrity report and the
  briefing are composed
- **THEN** both name the epic by its id, each states Gate 2 was withdrawn and quotes the withdrawal
  reason, and no text in the block that names it, headings and titles included, states that no
  review was recorded

#### Scenario: A withdrawn entry that superseded an ungated stamp says so

- **WHEN** an epic named by the withdrawn kind has a withdrawn Gate 2 entry whose `superseded` field
  holds an `ungated` stamp, and the integrity report and the briefing are composed
- **THEN** each states both that Gate 2 was withdrawn and that the epic was archived ungated before
  the withdrawn review was recorded

#### Scenario: The ungated history survives a second withdrawal

- **WHEN** the heal stamped an epic's Gate 2 `ungated`, a `pass` was recorded and withdrawn, a second
  `pass` was recorded and withdrawn, and the integrity report and the briefing are composed
- **THEN** each still states that the epic was archived ungated, although the latest withdrawal entry
  holds no `ungated` stamp

#### Scenario: Both surfaces agree before the heal has run

- **WHEN** an openspec-lane epic's Gate 2 is withdrawn while it is open, its change directory is then
  moved under `openspec/changes/archive/`, and the briefing and the integrity report are composed
  before any mutating verb runs the heal
- **THEN** both name the epic as withdrawn, because the withdrawn kind counts an epic whose change is
  archived on disk as archived

#### Scenario: A withdrawn Gate 2 on an epic that ended another way is not named

- **WHEN** an archived openspec-lane epic with outcome `superseded` has its Gate 2 in the withdrawn
  state, and the integrity report and the briefing are composed
- **THEN** neither names the epic

#### Scenario: A withdrawn Gate 2 outside the openspec lane or the archive is not named

- **WHEN** an archived `claude-code`-lane epic and an openspec-lane epic that is neither archived in state nor archived on
  disk each have Gate 2 in the withdrawn state, and the integrity report and the briefing are composed
- **THEN** neither surface names either epic

#### Scenario: A backfilled archived epic is never named as an ungated archive

- **WHEN** the integrity report and the briefing are composed in a repository where the archive
  backfill has registered every historical archived change
- **THEN** none of those epics is named as an ungated archive, because the backfill wrote them no
  `gate2` entry — a report that named them would be permanent, since the only clearing path is a
  passing Gate 2 with a commit range for work that shipped years ago
