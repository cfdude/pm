# gate-integrity Specification

## Purpose

Gate verdicts carry evidence a later reader can check, the archive transition is gated — or
recorded as having bypassed the gate — on every path that can reach it, and the gate procedure
pm emits requires a call-site completeness sweep and verification against the commit rather than
the working tree. Measured baseline: 42 of 49 archived openspec-lane epics across 8 repositories
reached `archived` with `gateReview: null`, by following the documented `/opsx:archive` workflow.

## Requirements

### Requirement: The archive transition is gated on every path that can reach it

Five paths can leave an epic at `status: "archived"`, and this capability SHALL name all five so
that every rule about archiving binds a known set rather than whichever path an implementer
happened to remember. These names are the ones other capabilities refer to:

- the **interactive archive verb** — the agent running `update-epic <id> --status archived`;
- the **archive-drift heal** — the function `reconcileArchived()`, **wherever it is invoked**
  (referred to elsewhere in this release as the hook heal). The binding is the function, not any
  list of the entry points that reach it;
- the **archive backfill registration** — `sync` registering an archived change that has no epic
  directly at `status: "archived"`, as required by the `conductor-record` capability;
- the **archived-at-creation paths** — `add-epic --status archived` and an `add-many` batch entry
  carrying `status: "archived"`. `archived` is a member of `KNOWN_STATUSES`, and both commands
  construct the epic object inline from their input, so each produces an archived epic today with
  no gate check and no disposition. They are two paths rather than one because they are two
  commands with two independent construction sites, and a rule applied at one of them is exactly
  the absent-edit class this release exists to close.

**The creation paths are named here even though they perform no transition.** Nothing moves from a
prior status, so there is no moment for a transition guard to fire — but the epic is at `archived`
when the command returns, which is the only property every rule in this capability actually keys on.
An enumeration that named only the paths carrying a status *transition* would leave the two paths
that reach the same end state under no rule at all.

**The heal is defined by its call sites, not by the hooks.** As of this change `reconcileArchived()`
is invoked from four places — `upgrade`, `render`, the commit nudge, and `sync` — of which two
(`upgrade`, `sync`) are interactive verbs an agent typed, and `render` is reachable from ordinary
interactive verbs as well as from the SessionStart, PreCompact and PostToolUse hooks. Binding the
heal's rules to the hook entry points would leave `render`, `sync` and `upgrade` producing archived
epics under no rule at all — the absent-edit defect class this release exists to close, reproduced
inside the requirement written to prevent it. Defining the heal as the function means an implementer
who adds a fifth caller inherits every rule here without amending this spec, and an implementer
wiring the rules to hook entry points has demonstrably not met the requirement.

The heal's rules therefore do NOT turn on whether an agent is present at the call site — at
`upgrade` and `sync` an agent plainly is. They turn on the fact that the heal reflects what disk
already says and receives no disposition and no gate verdict from anyone at the moment it flips the
status: nobody is asked, whether or not somebody is there.

An openspec-lane epic SHALL NOT reach `archived` on any of those five paths with no record of how
it got past Gate 2, and each path SHALL carry its own arm of that rule:

1. the **interactive archive verb** refuses a `delivered` archive without a passing verdict;
2. the **archive-drift heal** records that it bypassed the gate, as the requirement below defines;
3. the **archive backfill registration** relies on the `unknown` outcome and
   `recordedBy: "archive-backfill"` stamp that `conductor-record` already requires of it;
4. and 5. the **archived-at-creation paths** rely on the same stamp with their own token, as the
   requirement below defines.

Arms 3, 4 and 5 are the same argument: the `recordedBy` stamp **is** the record of how the epic
reached `archived`, and it is written unconditionally, so nothing is left silent. Naming five paths
and then writing a rule for three would reproduce inside this requirement the defect it exists to
close.

**Outcome invariant.** NO write that leaves an epic at `status: "archived"` — by any path, whether
named above or added later — SHALL leave it without an `outcome`. This includes a path that archives
an epic later in the same process run than a migration which has already stamped outcomes over the
epics that were archived at that instant. The invariant is deliberately stated over "any write that
produces an archived epic" rather than over the enumerated path list, and it lives under the
requirement that claims exhaustiveness rather than under any single path's rules: an enumeration
goes stale the moment a path is added, an ordering constraint is silently breakable by a later
refactor, and a rule filed under one path's heading invites an implementer to read it as that path's
business. The invariant is checkable wherever an archived epic is read.

#### Scenario: No archive path leaves an epic without an outcome

- **WHEN** every epic at `status: "archived"` in a repository is read, after any sequence of
  interactive archives, drift heals, backfill registrations and migrations
- **THEN** each carries an `outcome`, with no exception for the path or the ordering that produced
  the transition

**The Gate 2 requirement binds `outcome: delivered` only.** A change that is killed, superseded or
abandoned has no passing Gate 2 and never will — the code was never written, or was written and
thrown away — so demanding one would make those dispositions recordable only by fabricating a
verdict or hand-editing state, which are the two failures this release exists to end. For those
outcomes the reason the disposition already requires substitutes for the verdict, and the archive
proceeds.

The interactive archive verb MUST refuse a `delivered` archive that has no passing Gate 2, writing
nothing and exiting non-zero. The archive-drift heal and the archive backfill registration MUST
still reflect what is on disk — disk is the source of truth for OpenSpec, and a heal that refused
would make the record lie about reality — but neither may leave the transition unaccounted for.
Silence is the defect; the transition is not.

#### Scenario: Interactive archive of a delivered epic without a passing Gate 2 is refused

- **WHEN** the agent runs the interactive archive verb with `outcome: delivered` on an openspec-lane
  epic whose `gateReview.gate2` is absent or not a passing verdict
- **THEN** the command exits non-zero, `state.json` is byte-identical to before the call, and the
  epic's status is unchanged

#### Scenario: Archiving a killed change succeeds with no Gate 2

- **WHEN** the agent runs the interactive archive verb on an openspec-lane epic that was dropped at
  Gate 1 with no code written, supplying `outcome: killed` and the reason it was killed
- **THEN** the archive succeeds, no Gate 2 verdict is demanded or invented, and the reason is
  readable back from `state.json` — a change killed for a good reason is recordable without
  fabricating a review that never happened

#### Scenario: Archiving the change on disk still archives the epic

- **WHEN** the change directory for an openspec-lane epic appears under `openspec/changes/archive/`
  and the archive-drift heal subsequently runs
- **THEN** the epic's status becomes `archived`, because the record must not contradict disk

#### Scenario: The heal reached from an interactive verb is bound by the same rules

- **WHEN** `reconcileArchived()` flips an openspec-lane epic to `archived` during `sync` or
  `upgrade` — call sites an agent reached by typing a command, not hook entry points
- **THEN** the transition carries exactly the same records as when the same function runs from a
  hook, because every rule in this capability binds the heal function itself rather than the entry
  point that reached it

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

**The gate's demands are evaluated against the record, not against the change directory.** By this
point `openspec/changes/<id>/` has already moved under `archive/`, and the archive gate's inputs are
all durable on the epic: the Gate 2 verdict and its evidence, the outstanding-work quantity
`conductor-record` defines (which reads as zero for an archived epic whose source is gone), the
deferral assertion, and the attribution array. An implementer who reads the gate's inputs from the
working tree instead makes this requirement unsatisfiable — the change is not there any more — and
the whole path goes inert.

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

### Requirement: An epic created directly at archived is stamped, not refused

The **archived-at-creation paths** SHALL leave the epic they create carrying `outcome: unknown` with
`recordedBy` as a field, holding the fixed literal token of the path that wrote it — `add-epic` and
`add-many` respectively. Like the archive backfill and for the identical reason, neither path SHALL
write a `gateReview.gate2` entry: the stamp already records exactly how the epic reached `archived`,
and an `ungated` entry would add no information while adding a permanent standing condition.

**Creating at `archived` is stamped rather than refused, and the choice is evidence-led.** Refusing
`archived` at creation would be the simpler rule, but the capability is in use: this repository's own
suite creates archived epics at creation to exercise parent rollup and completion counting
(`scripts/test/conductor-06.test.mjs:282`, `scripts/test/conductor-07.test.mjs:141` and `:153`), and
the archive backfill `conductor-record` requires registers historical changes **directly** at
`archived` by design. Registering something already finished is a real need; a refusal would remove
it and force every caller to a two-step create-then-archive dance whose second step would then have
to satisfy the interactive verb's full archive gate for work that finished before the epic existed.
Stamping keeps the outcome invariant true without removing the capability.

**One record carries one token.** Where the archive backfill registers through a creation path
internally, the disposition SHALL carry `archive-backfill`, not the creation path's token: the
backfill is the path a consumer needs to recognize — every rule elsewhere in this release that
exempts historical registrations keys on that token — and a record carrying two stamps or the inner
one would defeat those exemptions.

The stamp binds **every lane**, matching the disposition half of the heal's write, and applies
whether or not the epic's change exists on disk.

#### Scenario: An epic created at archived carries an outcome

- **WHEN** the agent runs `add-epic --id <id> --lane openspec --status archived`
- **THEN** the created epic carries `outcome: unknown` with `recordedBy: "add-epic"` as a field and
  no `gateReview.gate2` entry, rather than landing archived with no outcome at all

#### Scenario: A batch entry created at archived carries an outcome

- **WHEN** an `add-many` batch contains an entry whose `status` is `archived`
- **THEN** that epic carries `outcome: unknown` with `recordedBy: "add-many"`, so the two creation
  commands are distinguishable in the record and a rule applied to one is visibly absent from the
  other

#### Scenario: Creation at any other status writes no disposition

- **WHEN** an epic is created at `queued`, `planned`, `active` or any other non-archived status
- **THEN** it carries no disposition record at all, because nothing has ended and `unknown` would
  assert a terminal disposition for work that has not terminated

#### Scenario: A backfilled epic keeps the backfill's token

- **WHEN** the archive backfill registers a historical archived change and its implementation
  constructs the epic through a creation path
- **THEN** the disposition carries `recordedBy: "archive-backfill"` and not a creation-path token,
  so every rule that exempts historical registrations still recognizes it

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

### Requirement: Every site deciding openspec-lane membership normalizes an absent lane

An epic with no `lane` field SHALL be treated as openspec-lane by **every** site that decides
openspec-lane membership, not by some of them. Today the archive guard tests
`epic.lane === "openspec"` while `resolveEpics()` and the sync/planned paths test
`(epic.lane || "openspec") === "openspec"`, so a lane-less epic renders as openspec-lane
everywhere and slips the openspec-lane gate. The strict test appears at three sites — the archive
guard, `missing()`, and `record-gate-review`'s lane refusal — and all three MUST normalize.

**The rule binds every such site, including the ones this change introduces.** The archive-drift
heal's bypass half is lane-bound by the heal requirement above, which makes it a fourth site
deciding openspec-lane membership; it MUST normalize an absent lane like the other three. Stating
the rule over "every site" rather than over the three that exist today is deliberate: a
three-item list written while a fourth site is being added in the same change is the absent-edit
class this release exists to close.

#### Scenario: A lane-less epic is held to the openspec-lane archive gate

- **WHEN** the agent runs the interactive archive verb with `outcome: delivered` on an epic that has
  no `lane` field and no passing Gate 2 verdict
- **THEN** the archive is refused exactly as it would be for an epic with `lane: "openspec"`

#### Scenario: Rendering and gating agree about the same epic

- **WHEN** an epic with no `lane` field is rendered into `PROJECT.md` and the briefing
- **THEN** it is shown as openspec-lane, and every gate, progress-source and dangling-change check
  that keys on the openspec lane applies to it — no site classifies it differently from another

#### Scenario: A gate verdict can be recorded against a lane-less epic

- **WHEN** the agent runs `record-gate-review <id> --gate 2 --verdict pass` with evidence, on an
  epic that has no `lane` field
- **THEN** the verdict is recorded, rather than refused as "not an openspec-lane epic" for an epic
  every other site treats as openspec-lane

### Requirement: A gate verdict carries checkable evidence as structured fields

A recorded gate verdict SHALL carry `baseSha`, `headSha` and reviewer identity as fields, not as
prose inside a free-text note. A `pass` verdict without a recorded `baseSha` and `headSha` MUST be
refused: `record-gate-review <id> --gate 2 --verdict pass` is otherwise one command with no
evidence requirement, and a review of `a..b` on an epic that later ships `b..c` is today
byte-identical to one that covered everything. A `fail` verdict MAY omit the range. Verdicts
written before this capability existed remain loadable and are treated as carrying no evidence.

#### Scenario: Recording a pass with its range and reviewer

- **WHEN** the agent runs `record-gate-review <id> --gate 2 --verdict pass --base-sha <a>
  --head-sha <b> --reviewer "<identity>"`
- **THEN** `gateReview.gate2` carries `baseSha`, `headSha` and the reviewer identity as separate
  fields alongside `verdict` and `reviewedAt`, each readable without parsing prose

#### Scenario: A pass with no range is refused

- **WHEN** the agent runs `record-gate-review <id> --gate 2 --verdict pass` with no `--base-sha`
  or no `--head-sha`
- **THEN** the command exits non-zero naming the missing evidence, and no verdict is recorded

#### Scenario: A pre-existing verdict without evidence still loads

- **WHEN** the engine reads a `state.json` whose `gateReview.gate2` is `{verdict, reviewedAt,
  note}` with no sha fields
- **THEN** the state loads unchanged and the verdict is reported as carrying no checkable
  evidence, rather than being deleted, rewritten, or treated as a pass that was verified

### Requirement: A verdict that does not cover the shipped work is stale

A verdict whose `headSha` is not the last commit **attributable to that epic's work** does not
cover the code that shipped and SHALL be treated as stale. A stale Gate 2 MUST NOT satisfy the
archive gate for a `delivered` outcome, and MUST be rendered as stale wherever the verdict is
displayed. Two constraints bound the check: it MUST be local — deriving commits from `git` is
permitted, the engine already shells to `git rev-parse` and `git merge-base`, and no network call
or external system is involved — and it MUST NOT refuse on commits unrelated to the epic.
Repository `HEAD` alone is therefore not the baseline: an epic archived a week after its merge has
a `HEAD` far past its own `headSha` through nobody's fault.

**Attribution SHALL be an array of commit hashes recorded on the epic**; the last entry is the
endpoint a recorded `headSha` is compared against. **The array is written by the named flag and the
emitted obligation the next requirement defines** — this requirement does not leave "appended as
each commit is attributed" to an unnamed actor, because nothing would then append and every epic
would carry an absent array, firing the unverifiable case below universally and leaving this whole
staleness gate permanently inert. Deriving attribution from **commits that touch the epic's own
files** is explicitly
EXCLUDED: archiving a change moves `openspec/changes/<id>/` into `archive/<date>-<id>/`, a commit
that touches every file the epic owns, so under that design the archive move itself makes every
verdict stale at the exact moment the archive gate reads it, and the gate refuses forever. Commit
messages naming epic ids are a human-readable echo of the record and MUST NOT be the mechanism: a
prose convention was measured at 3/15 adoption in this project's own audit, against 14/14 for
anything a required task carries.

#### Scenario: Commits attributed to the epic landed after the reviewed range

- **WHEN** an openspec-lane epic being archived as `delivered` carries a passing Gate 2 whose
  `headSha` is an ancestor of, but not equal to, the last hash in its recorded attribution array
- **THEN** the archive is refused with a message naming the recorded `headSha` and the attributed
  commits it does not cover, and the verdict renders as stale rather than as a pass

#### Scenario: The reviewed range covers the shipped work

- **WHEN** the recorded `headSha` is the last hash in the epic's recorded attribution array
- **THEN** the verdict satisfies the archive gate and renders as a pass, even where unrelated
  commits have since moved repository `HEAD` past it

#### Scenario: An epic with no recorded attribution is unverifiable, not refused

- **WHEN** an epic carries a passing Gate 2 and has no attribution array at all — it predates this
  capability, or no git history is available
- **THEN** the archive is not refused on staleness grounds, and the verdict is reported as
  unverifiable rather than silently rendered as a covering pass

#### Scenario: An empty attribution array is not the same as an absent one

- **WHEN** an epic created under this capability — and therefore carrying the array initialized
  empty — reaches archive with no commit yet attributed to it
- **THEN** it asserts that no commit has been attributed, so no verdict can be shown stale by it
  and the archive is not refused on staleness grounds; the epic instead renders as `delivered` with
  no attributed commits — a distinct rendering from an epic whose array is absent, which renders as
  unverifiable

### Requirement: Commit attribution is written by a named flag the emitted instructions require

The attribution array the staleness requirement compares against SHALL be written by a **named flag
on `update-epic`** — `--attribute-commit <sha>`, accepted more than once in a single invocation and
appending each hash in the order given — and that flag SHALL be declared in the single shared flag
allowlist that `epic-annotation` requires, not in a second parallel list. The engine SHALL append
exactly the hashes it is given and SHALL infer attribution from nothing else: not from the files a
commit touches, not from an epic id appearing in a commit message, not from commit ordering.

**An epic created after this capability SHALL be created carrying the array, initialized empty.**
That is what makes the staleness requirement's two no-attribution states distinguishable and both
reachable: an ABSENT array means the epic predates this capability and its verdict is unverifiable,
while an EMPTY array means the epic was created under it and nothing has been attributed yet. Were
the array only ever created by the flag's first use, `[]` would be a state nothing could produce and
an agent ignoring the obligation below would leave an absence indistinguishable from a pre-existing
epic — hiding the omission behind the one case the staleness gate is required to forgive.

**The migration SHALL NOT add the array to an epic that already exists.** The absent/empty
distinction above is load-bearing and unguarded otherwise: a uniformity-minded migration that
initializes every epic to `[]` collapses the two states, and every pre-existing epic then asserts
"created under this capability, nothing attributed" — a claim that is false for all of them and
that silently converts the staleness gate's one forgiven case into a repo-wide false positive.

An epic-mutating flag nobody is told to use produces an absent array on every epic, which is
indistinguishable in the record from an epic that predates this capability. The instructions pm
emits — its managed `CLAUDE.md` rules block, the `conductor` skill, and its command docs — SHALL
therefore require the agent to attribute each commit to the epic it belongs to at the moment that
commit is made, and SHALL name the per-task conventional commit of an OpenSpec apply loop as the
case that always qualifies. This is the same instruction-layer obligation `conductor-record` states
for the `<!-- pm:lifecycle -->` declaration, for the same reason and to the same shape: the engine
emits the rule and never writes the record itself, and without the emitted rule the field is
expressible and never exercised.

The obligation SHALL also cover work already in flight when this capability lands, since an epic
whose commits were made before the flag existed can only acquire attribution from the agent
finishing it.

**The obligation SHALL exclude the change's own archive move.** The commit that moves
`openspec/changes/<id>/` under `openspec/changes/archive/` — and any commit that only relocates or
deletes a change's artifacts rather than implementing its work — is lifecycle bookkeeping, and the
emitted text SHALL say so where it states the obligation. Without the exclusion the obligation and
the staleness gate collide on the documented workflow: the archive move lands *after* the reviewed
range by construction, so an agent following "attribute each commit as it is made" attributes it,
the last hash in the array becomes a descendant of the recorded `headSha`, the verdict reads stale,
and the archive gate refuses the very `delivered` record the interactive verb is required above to
accept — the same trap this requirement already refuses to build by inference, reappearing through
the flag. The exclusion is agent-declared, exactly like the `<!-- pm:lifecycle -->` marker
`conductor-record` defines: the engine still appends precisely the hashes it is given and classifies
nothing, so the excluded mechanisms above are untouched. Excluding the move never empties a
populated array — it withholds one append — so an epic that attributed its delivery commits keeps
them, and an epic whose only candidate was the move reads as empty, which is the forgiven "nothing
attributed yet" state rather than a stale verdict.

#### Scenario: The emitted obligation excludes the archive move

- **WHEN** pm emits the text stating the attribution obligation
- **THEN** that text names the change's archive move as a commit NOT to attribute, so an agent
  following the emitted instructions cannot make an epic's own Gate 2 stale at the instant the
  archive gate reads it

#### Scenario: Archiving after the move commit is not refused as stale

- **WHEN** an openspec-lane epic whose attribution array ends at its last delivery commit has its
  change archived on disk, that move is committed, and the agent then records `outcome: delivered`
  through the interactive archive verb
- **THEN** the archive is not refused on staleness grounds, because the move was never attributed
  and the recorded `headSha` is still the last hash in the array

#### Scenario: The flag appends hashes and is registered once

- **WHEN** the agent runs `update-epic <id> --attribute-commit <sha1> --attribute-commit <sha2>`
- **THEN** both hashes are appended to that epic's attribution array in the order given, readable
  back from `state.json`, and the flag appears in the one shared flag allowlist rather than in a
  second list of its own

#### Scenario: A newly created epic carries the array empty

- **WHEN** an epic is created after this capability lands and no commit has been attributed to it
- **THEN** it carries an attribution array holding no hashes, distinguishable in the record from an
  epic created before this capability, which carries no array at all

#### Scenario: The emitted instructions require attribution at commit time

- **WHEN** pm emits its managed rules block, the `conductor` skill text, or a command doc covering
  the build loop for an openspec-lane epic
- **THEN** that text directs the agent to attribute each commit to its epic as the commit is made,
  naming the flag — assertable directly against the text pm emits, and covering an epic whose
  earlier commits predate this capability

#### Scenario: The engine never infers an attribution

- **WHEN** a commit touches every file an epic owns, or names the epic's id in its message, and no
  `--attribute-commit` was run for it
- **THEN** that hash does not appear in the epic's attribution array, because the archive move
  itself touches every file a change owns and a prose convention was measured at 3/15 adoption

### Requirement: Gate 1 is read

A recorded Gate 1 verdict SHALL be consumed by something a human or agent sees. It is currently
stored, documented in the `conductor` skill, and read by nothing — the only consumer of
`gateReview` anywhere in the engine reads `gate2`. Gate 1 gates code rather than the archive
transition, so its absence MUST surface as a reported condition, never as a refusal.

#### Scenario: A recorded Gate 1 is displayed

- **WHEN** an openspec-lane epic carries a `gate1` verdict and `PROJECT.md` or the briefing is
  composed
- **THEN** that verdict, its recorded evidence and whether it is stale are shown alongside the
  epic's Gate 2 state

#### Scenario: An epic archived with no Gate 1 is reported, not refused

- **WHEN** an openspec-lane epic reaches `archived` with a passing Gate 2 and no `gate1` verdict
- **THEN** the archive proceeds, and the missing spec review is reported as an integrity finding

### Requirement: Integrity checks report records that cannot be true

The conductor SHALL expose a read-only integrity check over its own record, reporting each
finding with the epic it concerns and enough detail to act on. Every check below can fail against
today's engine — several on live data in this repository today, the rest constructible from a
fixture. A finding is reported, not repaired: none of these
checks writes state, and none blocks a command other than where a requirement above says so.

Two classes of archived epic are explicitly OUT of scope for the completion-shaped checks below,
because in both the record is working rather than broken, and a check that fires on them trains a
reader to filter it:

1. an epic whose `outcome` is `killed`, `superseded`, `abandoned`, `declined` or
   `unreconstructable` — each carries a required reason explaining why the work did not complete, or
   why what happened to it can no longer be established, and the release's own flagship case is a
   change killed at Gate 1 with 47 tasks and no code written, which is zero-ticked by construction.
   `unreconstructable` belongs on this list for the same reason the others do: an epic whose
   defining property is that the evidence is gone is zero-ticked by construction, and a check firing
   on it forever would be firing on the record working correctly;
2. an epic stamped `recordedBy: "archive-backfill"`, which `conductor-record` requires to register
   with its counts intact, unticked ones included.

**Every other archived epic is IN scope, including one whose `outcome` is `unknown`, and regardless
of lane.** `absent` is not a state an archived epic reaches: the migration stamps every pre-existing
archived epic regardless of lane, and the outcome invariant above binds every one of the five archive
paths going forward, the two creation paths included. A check that had to handle an absent outcome
would be handling a state no path produces.
The exclusion is deliberately written as those two cases rather than as "any
outcome other than `delivered`": `unknown` is the value the engine stamps when nobody was asked, and
its reason is a path name, not an explanation of why the work did not complete — the property the
exclusion above actually rests on. Scoping these checks to `delivered` would make them inert, which
is measurable rather than arguable. The migration stamps `delivered` only where a passing Gate 2
already exists, and in this repository it did so for exactly **3** archived epics (measured
2026-09-08; 149 archived in total, of which 9 carry a passing Gate 2 — the two counts are
different populations and only the first is what the migration acted on). Every candidate a
zero-ticked check would report sits outside that set of 3, so scoping the check to `delivered`
leaves it with none. The relative claim is what this requirement rests on: the `delivered` set is
a strict and very small subset of the archive, so a `delivered`-only check measures nothing.

#### Scenario: A verdict's range does not contain the commits its note cites

- **WHEN** a gate verdict's note names commit shas that are not contained in the range recorded by
  its `baseSha`/`headSha` fields
- **THEN** the check reports the epic, the recorded range and the uncontained shas — the live
  instance in this repository is `platform-parity-mechanism`, whose Gate 2 records
  `d168b1e..04c54c8` and cites `c63efc1` and `3cba2e9`, both descendants of that range

#### Scenario: A gate was recorded as bookkeeping rather than as review

- **WHEN** a gate verdict's `reviewedAt` satisfies **either** arm:
  - the verdict carries **no checkable evidence** (no `baseSha`/`headSha`) **and** falls **after
    the epic's merge commit**, where the merge commit is the last hash in the epic's attribution
    array — and where that array is absent or empty this arm does not apply, because every other
    reading of "merge commit" is either inert on all live epics or fires on essentially all of
    them; **or**
  - it falls **within 60 seconds** of the `reviewedAt` of the epic's other gate verdict
- **THEN** the check reports it as a bookkeeping signature — the audited instance recorded both
  gates 83 seconds after the squash-merge, 47 ms apart, with no notes, and 47 ms is inside the
  60-second bound while a spec review and an implementation review of the same change never are

**Arm 1's evidence exemption is load-bearing, and it was found by this change reporting itself.**
Two obligations this same release ships — attribute each commit *at the moment it is made*, and
record Gate 2 *after* the implementation — together guarantee `reviewedAt >
commitDate(last attributed)` for **every correctly run gate**. Without the exemption the arm
therefore fires on compliance rather than on the defect, which is strictly worse than not shipping
it: measured live the first time this repository satisfied both obligations, the arm reported its
own honest verdict. The audited instances the arm exists for are unevidenced by construction —
they predate the sha fields and were written 83 seconds after a squash-merge with no notes and no
range — so exempting an evidenced verdict removes the false positive without weakening the signal.
Whether an evidenced verdict's range actually REACHES the attributed commits is a different
question, answered by the staleness gate and refused at the archive, never guessed at here.

#### Scenario: An evidenced verdict recorded after the last attributed commit is not a finding

- **WHEN** an epic's attribution array is non-empty and its Gate 2 records `baseSha`/`headSha` and
  a `reviewedAt` later than the last attributed commit's date — the shape the emitted procedure
  produces every time it is followed
- **THEN** the check reports nothing for it, because a verdict that states the range it covered and
  is dated after the last commit in that range is what a real review looks like

#### Scenario: An archived epic with zero ticked tasks is reported

- **WHEN** an archived epic that carries neither an outcome the requirement above excludes nor the `archive-backfill` stamp has a progress source that exists and contains
  checkboxes, none of which are ticked
- **THEN** the check reports the epic and its source — four epics in this repository qualify today,
  archived at `0/17`, `0/99`, `0/37` and `0/34`, none carrying a passing Gate 2 and so none
  `delivered` after the migration. Three of the four are the date-prefixed superpowers-lane
  registrations of ids also held under another lane, which the dual-lane check below reports
  separately once that check keys on the date-prefix-stripped id; the fourth,
  `2026-07-29-platform-aware-rules-block`, is not in the collision set at all, so this check has a
  live candidate that is not an artifact of another finding

#### Scenario: A killed epic with no ticked tasks is not a finding

- **WHEN** an epic is archived with `outcome: killed` and its reason, its 47 tasks all unticked
- **THEN** the check reports nothing for it, because a recorded non-delivered disposition already
  explains the zero and is the record working as designed

#### Scenario: One change is registered under two lanes

- **WHEN** two epics whose ids are equal after stripping a leading `<YYYY-MM-DD>-` date prefix —
  the same normalization `isArchived()` already applies to archive directory names — appear in
  `state.epics` under different `lane` values
- **THEN** the check reports every such pair and the lanes each holds

> Identity for this check MUST be the date-prefix-stripped id, not literal equality. Measured on
> this repository: **zero** ids collide literally, while **four changes** are registered twice —
> `conductor-mjs-module-split` (openspec) and `platform-parity-mechanism` (openspec), each against
> its date-prefixed superpowers-lane twin; and `epic-hierarchy-orchestration` and
> `edd-harness-agent-behavior-testing`, each held under the **decision** lane against the same
> superpowers-lane twin. The pairing shape is identical in all four; the lane on the non-prefixed
> side is not, which is why the check reports the lanes it finds rather than assuming a pair.
> A literal-equality check
> reports none of them while claiming four exist — a check that reads as coverage and measures
> nothing, which is the defect class this capability exists to end.

#### Scenario: A heal-archived epic that did pass Gate 2 reads as unknown

- **WHEN** an agent records a passing Gate 2 and then runs `/opsx:archive`, so the change moves on
  disk and the archive-drift heal flips the status and stamps `outcome: unknown` with
  `recordedBy: "archive-drift-heal"` while correctly leaving the existing `gate2` untouched
- **THEN** the check reports that epic — a `delivered`-shaped record wearing an `unknown` outcome

> Without this check the case is invisible everywhere: it gets no `ungated` entry, so the standing
> ungated-archive notice never names it, and its outcome is honestly `unknown` because nobody
> supplied a disposition at the transition. The heal is behaving correctly; what is missing is
> anything that surfaces the mismatch. The remediation is the interactive archive verb run on the
> already-archived epic — the requirement above requires that call to be accepted, and
> `epic-disposition` makes the agent's `delivered` replace the heal's engine stamp — so this check
> is the finding, and that call is the fix. This is the ordinary end of the documented workflow, not
> an exceptional repair.

#### Scenario: A delivered epic with a passing Gate 2 has attributed no commits

- **WHEN** an epic carries `outcome: delivered` and a passing `gate2` (which requires `baseSha` and
  `headSha`) while its attribution array is present and empty
- **THEN** the check reports it

> This is precisely the shape of *the agent ignored the `--attribute-commit` obligation*. The
> staleness gate still behaves correctly — an empty array is not a stale verdict — so without this
> check nothing anywhere reports an unmet emitted obligation, and the obligation becomes advisory
> in the one way that leaves no trace.

#### Scenario: An archive directory has no epic

- **WHEN** a directory under `openspec/changes/archive/` corresponds to no epic in `state.epics`
- **THEN** the check reports the directory as an unrecorded archived change; registering it is out
  of scope here and belongs to the conductor's record-completeness capability

#### Scenario: An unreconstructable epic does not fire the zero-ticked check

- **WHEN** the completion-shaped checks run over an archived epic whose outcome is
  `unreconstructable` and whose tasks are unticked
- **THEN** no zero-ticked finding is reported for it

### Requirement: The emitted gate procedure requires a call-site completeness sweep

The gate procedure pm emits SHALL require, for every rule, guard or invariant a change introduces
or modifies, that the reviewer enumerate all call sites of the thing being guarded, state where
the rule holds and where it does not, and justify each omission.

It SHALL FURTHER require the reviewer to enumerate the **INVERSE OPERATION** of every operation the
change adds or modifies — set against unset, add against remove, append against replace, enable
against disable, grant against revoke — and to name and justify each inverse that is not shipped,
exactly as an unguarded call site must be. A call-site sweep alone cannot find this class, and the
reason is mechanical rather than a matter of diligence: enumerating the callers of a thing that is
written never leads to the question of whether it can be unwritten. Measured in this repository,
six instances shipped past both gates while the call-site obligation was already in force, and the
most consequential is a safety surface — pre-authorization grants that accumulate with no revoke,
where disabling the feature leaves every prior grant intact.

The requirement MUST appear in the emitted procedure as a **numbered required task item**, not as
a prose bullet in a paragraph of review guidance. The acceptable surface is one pm itself owns and
emits — its managed `CLAUDE.md` rules block, the `conductor` skill, and its command docs — because
a change's `tasks.md` is authored by the `openspec` plugin, which pm neither owns nor writes; what
pm controls, and what its own suite can assert, is the text of the procedure it emits and hands
the agent to carry into that task list. The form matters and is measured: across one audited
repository, a rule carried by a mandatory task section reached 14/14 subsequent changes, while the
same rule as a prose bullet reached 3/15. Both gates are diff-scoped and structurally cannot see
an edit that is absent from a file the diff never touched — the dominant defect class in all three
audit shards, ~38 instances in one shard and 5 whole epics that exist only to finish an earlier
epic's rule.

The obligation SHALL reach every mirrored surface, not the generator alone. The mirrors are
deliberately reworded for markdown, so the guard that keeps them in step compares DECLARED
LOAD-BEARING CLAIMS rather than prose; an obligation added to the emitted text without a
corresponding declared claim leaves that guard green while every mirror continues to carry the
older, narrower rule. That failure has been proven live in this repository — a mirror's body was
edited to say the OPPOSITE of the generator and the whole suite stayed green — and it is the same
absent-edit class this requirement exists to prevent, which is why the claim, and not only the
text, is normative.

#### Scenario: The sweep is emitted as a numbered required task item

- **WHEN** pm emits the gate procedure for an openspec-lane change
- **THEN** the emitted text carries the completeness sweep as a numbered required task item, with
  the enumeration it demands named concretely, rather than as advisory prose — assertable directly
  against the text pm emits

#### Scenario: A rule applied at one of several call sites is a finding

- **WHEN** a change introduces a guard at one call site while an identical sibling call site is
  left untouched and the omission is not justified
- **THEN** the emitted procedure directs the reviewer to raise it as a finding rather than as a
  detail, regardless of whether the unedited site appears in the diff

#### Scenario: An operation shipped without its inverse is a finding

- **WHEN** a change adds or modifies an operation that writes a value, and the corresponding
  operation that removes that value is neither shipped nor justified
- **THEN** the emitted procedure directs the reviewer to raise it as a finding

#### Scenario: The inverse obligation reaches the mirrored surfaces

- **WHEN** the mirrored surfaces are checked against the generator's declared load-bearing claims
- **THEN** the inverse-operation obligation is among those claims, and every mirrored surface
  carries it

### Requirement: The emitted gate procedure verifies against the commit, not the working tree

The gate procedure pm emits SHALL state that reading the working tree does not count as
verification, and SHALL require that the files a task claims to change are asserted present in
that task's commit. This too MUST appear as a numbered required task item in the procedure text pm
emits, on the same pm-owned surfaces as the requirement above, for the same reason. The audited
failure: two commits each claimed to remove a file's code and neither staged it, because a
`git add` with an explicit path list aborted on an already-removed path — tasks ticked, gates
green, tests passing, because all four layers inspected the working tree. It then recurred after
being written down in a commit message in the same epic.

#### Scenario: Commit-based verification is emitted as a numbered required task item

- **WHEN** pm emits the gate procedure for an openspec-lane change
- **THEN** the emitted text carries a numbered required task item instructing the reviewer to check
  each task's commit contents, and states explicitly that reading the file in the working tree is
  not verification

#### Scenario: A claimed change absent from the commit is a failure

- **WHEN** a task names files it changes and one of those files does not appear in that task's
  commit
- **THEN** the emitted procedure requires the gate to fail on that task, even though the working
  tree contains the intended edit and the tests pass

### Requirement: An epic in a status the engine does not define is reported
The integrity surface SHALL report every epic whose `status` is outside the set of statuses the
engine defines, naming the epic, naming the value it carries, and naming the remedy — the same
shape the existing unknown-link-type check establishes for a stored value that cannot be true.

The finding SHALL state the consequence a reader would otherwise not deduce: an epic in an
undefined status is **non-terminal to every rule that tests for the archived status**, so it is
invisible to the completion-shaped checks and makes the record look cleaner than it is. It SHALL
also state that any dependency edge pointing at such an epic reads unsatisfied permanently — so
whatever waits on it stays blocked, and the epic itself permanently ABSORBS the effective priority
of everything depending on it, for as long as the value persists. The direction matters: priority
propagates from the dependent into the blocker, so the stuck epic is what gets lifted, not the work
behind it.

The check SHALL be read-only and SHALL NOT repair the value it finds. Which legal status an
undefined one should become is a judgment about what happened to the work, and an engine that
guessed would write a disposition nobody made.

#### Scenario: An epic in an undefined status is named with its consequence
- **WHEN** the integrity surface runs over a state file containing an epic whose status is not one
  the engine defines
- **THEN** it reports that epic, the undefined value, the remedy, and the fact that the epic is
  currently exempt from every rule that tests for the archived status

#### Scenario: The check reports and does not repair
- **WHEN** the integrity surface reports an epic in an undefined status
- **THEN** the epic's stored status is unchanged by the check

#### Scenario: A state file with only defined statuses reports nothing
- **WHEN** the integrity surface runs over a state file in which every epic carries a defined
  status
- **THEN** no unknown-status finding is reported

### Requirement: The interactive archive verb gates the record the invocation writes

When `update-epic` carries `--status archived`, the archive gate MUST evaluate the epic after every
field write and unset in that invocation, never the epic as it stood before them. The field writes
include:

- the lane;
- the plan and spec paths;
- commit attribution and its withdrawal;
- added stories, and a story marked done or won't-do;
- links and priority;
- every `--clear` unset.

The gate's decision SHALL therefore be the decision it would make if those writes had already been
applied: refused exactly where that record fails the gate, and accepted exactly where it passes.

The claim is about the GATE's decision. It does not extend to refusals that validate the invocation
itself: contradictory flags, a story index out of range, a flag that needs another flag. Those keep
their own rules.

A refused invocation MUST write nothing and MUST print no line announcing a write. That includes the
sync-ignore tombstone clear, the rank clear, and the `--clear` notes. A refused call that announced a
cleared rank would report a change that did not happen.

Today the gate reads the epic before those writes. One call can therefore archive a record the gate
refuses, and refuse a record the gate accepts. The gate exists to decide on the record that gets
written; one that reads a different record decides nothing.

#### Scenario: A lane switch and an archive in one call cannot bypass Gate 2

- **WHEN** a `claude-code`-lane epic with no Gate 2 ever recorded and no outstanding work runs
  `update-epic <id> --lane openspec --status archived --outcome delivered --no-deferrals`
- **THEN** it exits non-zero naming the missing passing Gate 2, `state.json` is byte-identical, and
  the epic is not archived

#### Scenario: An attribution and an archive in one call cannot bypass staleness

- **WHEN** an openspec-lane epic carries a passing Gate 2 whose `headSha` is its last attributed
  commit, and `update-epic <id> --attribute-commit <a commit descending from that headSha>
  --status archived --outcome delivered --no-deferrals` runs
- **THEN** it exits non-zero naming the uncovered commit, and `state.json` is byte-identical

#### Scenario: An added story and an archive in one call cannot bypass the handoff

- **WHEN** a `claude-code`-lane epic whose stories are all done runs `update-epic <id> --add-story "s"
  --status archived --outcome delivered --no-deferrals`
- **THEN** it exits non-zero naming the outstanding story, and `state.json` is byte-identical

#### Scenario: A commit withdrawal and an archive in one call cannot bypass the gate

- **WHEN** an openspec-lane epic attributes exactly one commit and carries a passing Gate 2 covering
  it, and `update-epic <id> --withdraw-commit <that sha> --withdrawal-reason "x" --status archived
  --outcome delivered --no-deferrals` runs
- **THEN** it exits non-zero naming the withdrawn attribution, `state.json` is byte-identical, and the
  epic is not archived

#### Scenario: Finishing the last story and archiving in one call is accepted

- **WHEN** a `claude-code`-lane epic whose only outstanding story is story 1 runs `update-epic <id>
  --story 1 --done --status archived --outcome delivered --no-deferrals`
- **THEN** it exits zero, story 1 is done, and the epic is archived with outcome `delivered`

#### Scenario: Leaving the openspec lane and archiving in one call is accepted

- **WHEN** an openspec-lane epic with no Gate 2 ever recorded and no outstanding work runs
  `update-epic <id> --lane claude-code --status archived --outcome delivered --no-deferrals`
- **THEN** it exits zero and the epic is an archived `delivered` `claude-code`-lane epic

#### Scenario: A refused call announces no cleared field

- **WHEN** a `claude-code`-lane epic with no stories, ranked in P2, carrying a `parent`, whose
  sync-ignored plan file has every task ticked and which has no Gate 2 ever recorded, runs
  `update-epic <id> --priority P1 --clear parent --plan <that path> --lane openspec --status archived
  --outcome delivered --no-deferrals`
- **THEN** it exits non-zero, stderr carries none of the rank-clear, parent-clear or tombstone-clear
  lines, and `state.json` is byte-identical

#### Scenario: An accepted call still announces what it cleared

- **WHEN** the same epic runs the same flags with `--lane openspec` omitted
- **THEN** it exits zero and stderr carries the rank-clear, parent-clear and tombstone-clear lines

### Requirement: An update to an archived epic does not break an obligation its archive met

This requirement binds an `update-epic` invocation when ALL of these hold (the outcome and the status
are read from the epic as stored BEFORE the invocation):

- the epic's recorded outcome is `delivered`;
- the invocation does not carry `--status archived`;
- the record will be archived when the invocation returns: EITHER the epic's change directory is
  archived on disk (the predicate on which the archive-drift heal, run by the invocation's own
  render, archives it, whatever its stored status), OR its stored status is `archived` and the
  invocation carries no `--status`.

For such an invocation, `update-epic` MUST compare the delivered-outcome obligations on the record
before the invocation with those on the record it would leave. The obligations are:

- **the Gate 2 demand** — openspec lane, a present passing Gate 2 that is neither stale nor
  attribution-withdrawn;
- **the handoff demand** — no outstanding work, unless the disposition names where it was carried.

The comparison is PER OBLIGATION. The invocation MUST be refused, writing nothing and announcing no
write, where some obligation the record met before is failed by the record after, whatever the
other obligation's state. A whole-record comparison would let an already-failing handoff mask a
Gate 2 the invocation breaks.

The archive gate and this check MUST decide the obligations from ONE definition, so they cannot
disagree about what "met" means. Sharing the definition does not make this check the archive
transition's handoff guard: `epic-disposition`'s rule that the handoff refusal names `--carried-to`
and the lifecycle marker binds the interactive archive verb's refusal only, and this refusal is not
one.

An obligation the record already failed before the invocation MUST NOT be a ground for refusal.
Archived records from before a rule existed fail rules they were never held to, and refusing every
update to them would lock notes, links and priority on a record for a defect the update did not cause.

**The refusal's wording.** It MUST state that the update would break an obligation the archived
record met, and name that obligation. It MUST NOT contain the text `cannot archive`, which opens every
archive-gate refusal. The printed invocation below MUST be the only line of the refusal that begins
with `  update-epic `, and no ENGINE-WRITTEN text on any other line may name `--carried-to`,
`--outcome` or `--reason`, flags that take effect only alongside `--status archived`. A value a user
supplied (a story title, a reason, a note) MUST NOT start a line of the refusal. Where the invocation carried a non-archived `--status`,
the refusal MUST say that status is dropped from the printed invocation because the change directory
archived on disk re-archives the epic.

**The printed invocation.** The refusal MUST print a runnable invocation that makes the same change
and records the disposition it implies. It is the invocation's own argument tokens, as given, minus
`--status`, `--outcome`, `--reason`, `--carried-to`, `--correct-disposition` and the deferral flags
(with their values), plus `--status archived`, an `--outcome` placeholder naming the agent outcomes,
and `--reason "<why>"`. Which token is a
dropped flag's value follows the engine's own flag walk: an inline `--flag=value` token drops alone,
and a following token drops with its flag only where that token is not itself flag-shaped. A flag
given with no value echoes with no value, a repeated flag echoes once per occurrence, and an inline
`--flag=value` token echoes as one token. Every echoed token MUST be quoted so that the printed line, with only its placeholders
filled, runs in a POSIX shell with each token arriving whole, including a value containing an
apostrophe. The printed invocation MUST stay on ONE physical line. A token containing a newline or other
control character is NOT echoed as a value: its position carries the flag and a placeholder, and the
refusal says which flag's value must be re-entered. A shell cannot reliably rebuild such a value on one line (command substitution strips a
trailing newline), and a promise of byte-for-byte reconstruction there would be false.
- It MUST carry `--correct-disposition "<why the recorded one was wrong>"` if and only if the recorded
  disposition is agent-recorded. An engine-stamped disposition is replaced by recording an outcome,
  and the correction flag is refused against it.
- It MUST carry the placeholder `<--no-deferrals | --deferral "<epicId>:<section>">` if and only if
  the epic has no deferral assertion. A deferral assertion is a claim to be made, not a default to
  print.

An update to an archived epic never passes through `--status archived`, so the archive gate never
sees it. Reproduced on 0.42.0:
- `update-epic <id> --lane openspec` on an archived `delivered` `claude-code` epic exits 0 and leaves a
  `delivered` openspec-lane epic with no Gate 2, which `integrity` names nowhere.
- `update-epic <id> --status queued --attribute-commit <descendant>` on an archived `delivered`
  openspec epic whose change directory is archived on disk exits 0. The heal re-archives it in the same
  call with a stale Gate 2.

#### Scenario: Switching an archived delivered epic into the openspec lane is refused

- **WHEN** an archived `delivered` `claude-code`-lane epic with no Gate 2 ever recorded runs
  `update-epic <id> --lane openspec --notes "moved to the openspec lane"`
- **THEN** it exits non-zero naming the missing passing Gate 2, its message does not contain
  `cannot archive`, and `state.json` is byte-identical

#### Scenario: Attributing a commit an archived delivered epic's Gate 2 does not cover is refused

- **WHEN** an archived `delivered` openspec-lane epic carries a passing Gate 2 whose `headSha` is its
  last attributed commit, and `update-epic <id> --attribute-commit <a commit descending from that
  headSha>` runs
- **THEN** it exits non-zero naming the uncovered commit, and `state.json` is byte-identical

#### Scenario: A non-archived status does not escape the check while the heal will re-archive

- **WHEN** the epic of the previous scenario has its change directory under
  `openspec/changes/archive/`, and `update-epic <id> --status queued --attribute-commit <a commit
  descending from that headSha>` runs
- **THEN** it exits non-zero naming the uncovered commit, the refusal says `--status` is dropped from
  the printed invocation because the change directory archived on disk re-archives the epic, and
  `state.json` is byte-identical

#### Scenario: Adding a story to an archived delivered epic is refused without naming a dead remedy

- **WHEN** an archived `delivered` `claude-code`-lane epic whose stories are all done runs
  `update-epic <id> --add-story "s"`
- **THEN** it exits non-zero naming the outstanding story, no line of the refusal other than the one
  beginning `  update-epic ` names `--carried-to`, `--outcome` or `--reason`, and `state.json` is
  byte-identical

#### Scenario: Withdrawing the only attribution of an archived delivered epic is refused

- **WHEN** an archived `delivered` openspec-lane epic attributes exactly one commit, covered by its
  passing Gate 2, and `update-epic <id> --withdraw-commit <that sha> --withdrawal-reason "x"` runs
- **THEN** it exits non-zero naming the Gate 2 demand, and `state.json` is byte-identical

#### Scenario: A queued epic the heal will archive does not escape the check

- **WHEN** an openspec-lane epic archived `delivered` over a passing Gate 2 covering its one attributed
  commit is set `--status queued` while nothing is archived on disk, its change directory is then
  moved under `openspec/changes/archive/`, and `update-epic <id> --attribute-commit <a commit
  descending from that headSha>` runs
- **THEN** it exits non-zero naming the uncovered commit, and `state.json` is byte-identical

#### Scenario: Restoring a record the check accepted is judged like any other change

- **WHEN** an archived openspec-lane epic with an agent-recorded `delivered` disposition and a Gate 2
  `fail` recorded after archive runs
  `update-epic <id> --lane claude-code`, which is accepted, and then `update-epic <id> --lane openspec`
- **THEN** the second call is refused naming the Gate 2 demand, and the invocation it prints, filled
  with `--outcome superseded`, a reason and a correction reason, exits 0

#### Scenario: An already-failing handoff does not mask a Gate 2 the update breaks

- **WHEN** an openspec-lane epic with one outstanding story was archived `delivered --carried-to z`
  over a passing Gate 2 covering its one attributed commit, and `remove-epic z` then stripped its
  `carriedTo` so its handoff demand fails, and `update-epic <id> --withdraw-commit <that sha>
  --withdrawal-reason "x"` runs
- **THEN** it exits non-zero naming the Gate 2 demand, and `state.json` is byte-identical

#### Scenario: A user-supplied value cannot forge a line of the refusal

- **WHEN** an archived agent-recorded `delivered` `claude-code`-lane epic whose stories are all done
  runs `update-epic <id> --add-story` with a title that does not begin with `--` and contains
  `--carried-to`, a newline, and `  update-epic x`
- **THEN** it is refused; exactly one line of the refusal begins `  update-epic `; no line of the refusal
  begins with any part of the title after its newline; and the printed invocation carries a placeholder
  for that `--add-story` value instead of echoing it

#### Scenario: A refused update announces no cleared field

- **WHEN** an archived `delivered` `claude-code`-lane epic with no Gate 2, ranked in P2, runs
  `update-epic <id> --priority P1 --lane openspec`
- **THEN** it exits non-zero, stderr carries no rank-clear line, and `state.json` is byte-identical

#### Scenario: A record that already failed is not locked

- **WHEN** an archived `delivered` openspec-lane epic had a Gate 2 `fail` recorded by
  `record-gate-review` after it was archived, and `update-epic <id> --attribute-commit <sha>` runs
- **THEN** it exits zero and the commit is attributed, because the record failed the Gate 2 demand
  before the call

#### Scenario: An epic that ended another way carries no obligation

- **WHEN** an archived `claude-code`-lane epic with outcome `superseded` runs `update-epic <id> --lane
  openspec --add-story "s"`
- **THEN** it exits zero

#### Scenario: An unknown outcome carries no obligation

- **WHEN** an archived `claude-code`-lane epic whose outcome is `unknown` with an engine `recordedBy`
  runs `update-epic <id> --lane openspec`
- **THEN** it exits zero

#### Scenario: The invocation printed for an agent-recorded disposition names the correction

- **WHEN** the lane-switch refusal above fires on an epic whose `delivered` disposition was recorded by
  `update-epic … --status archived --outcome delivered --no-deferrals`
- **THEN** the invocation it prints carries `--correct-disposition` and no deferral placeholder, because
  the epic already carries a deferral assertion

#### Scenario: The invocation printed for an engine-stamped disposition does not name the correction

- **WHEN** an archived epic whose `delivered` disposition was stamped by the 0.27.0 migration (a
  pre-0.27.0 state file carrying a passing Gate 2, run through `upgrade`), and whose stories are all
  done, runs `update-epic <id> --add-story "s"`
- **THEN** it is refused, and the invocation it prints carries no `--correct-disposition` and carries
  the deferral placeholder, because a migration stamp records no deferral assertion

#### Scenario: The printed invocation runs

- **WHEN** an archived agent-recorded `delivered` `claude-code`-lane epic with no Gate 2 ever recorded
  runs `update-epic <id> --lane openspec --notes "Rob's move" --clear-links --reason=--x --add-story
  "two words" --add-story=--x`, which is refused, and the invocation it prints is run through `sh -c` with its
  placeholders filled as `--outcome superseded`, a reason, and a correction reason
- **THEN** it exits zero; the epic is an archived `superseded` openspec-lane epic whose prior
  `delivered` disposition is kept under `superseded`; its latest note is `Rob's move`; it has no links;
  and it gained exactly the two stories `two words` and `--x`

#### Scenario: Leaving the archive is not refused where nothing re-archives the epic

- **WHEN** an archived `delivered` `claude-code`-lane epic with no Gate 2 ever recorded and no change directory
  archived on disk runs `update-epic <id> --status queued --lane openspec`
- **THEN** it exits zero and the epic is `queued`, and a later `update-epic <id> --status archived
  --outcome delivered --reason r --correct-disposition c --no-deferrals` is refused for the missing
  passing Gate 2

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
