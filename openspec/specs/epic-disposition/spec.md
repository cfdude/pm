# epic-disposition Specification

## Purpose

Work that ends, is deliberately deferred, is handed off, or is excluded from a release carries a
recorded terminal disposition with a reason. That is one concept at four scopes, and the conductor
currently expresses none of them: a change killed at Gate 1 with 47 tasks and no code written is
byte-identical in `state.json` to one that shipped. This capability defines the disposition record
once and applies it to each scope; the engine records and renders, the agent decides.

## Requirements

### Requirement: A terminal disposition is a reason-bearing record
A terminal disposition SHALL be a durable record on `.conductor/state.json` carrying an outcome
keyword, a free-text reason, a timestamp, and — where the work continues somewhere else — a
reference to where. Every outcome other than the one meaning "this shipped as intended" MUST carry
a non-empty reason; the engine MUST reject a disposition that omits it. The same record shape MUST
be used at all four scopes below rather than four independent shapes.

#### Scenario: A non-delivered disposition without a reason is rejected
- **WHEN** the agent records a disposition whose outcome is not `delivered` and supplies no reason
  (or an empty/whitespace-only one)
- **THEN** the command exits non-zero with a message naming the missing reason, and `state.json` is
  left unchanged

#### Scenario: A recorded disposition survives into the record
- **WHEN** a disposition is recorded with an outcome and a reason
- **THEN** the outcome, the reason, and the time it was recorded are readable back from
  `state.json` and rendered in `PROJECT.md` without re-reading any prose artifact

### Requirement: An epic that ends records its outcome
An epic reaching `status: "archived"` SHALL carry an `outcome` alongside that status, drawn from
`delivered` | `killed` | `superseded` | `abandoned` | `declined` | `unreconstructable` | `unknown`.
`outcome` is a distinct field from `status`, not a new status value — an epic is still `archived`,
and every existing status-driven behavior is unchanged. `delivered` MAY omit a reason; `killed`,
`superseded`, `abandoned`, `declined` and `unreconstructable` MUST carry one. The refusal to
archive without an outcome binds the INTERACTIVE ARCHIVE VERB only — the one path where an agent
supplies a disposition. Every other archive path has nobody to ask, and the engine stamps
`outcome: unknown` with `recordedBy` instead; demanding prose from such a path would be a
fabrication, not a record. This capability
defines the record's shape; **which archive paths exist, and which outcome the Gate 2 requirement
binds, are enumerated by the `gate-integrity` capability** and are not restated here.

`unknown` is never an agent's answer — it is the engine saying nobody recorded one.

`unreconstructable` IS an agent's answer, and it is the one this release adds: it records that
somebody looked for the evidence of what happened and the evidence does not exist. It is
deliberately distinct from `unknown`, which says nobody looked, and from any reconstructed outcome,
which says somebody looked and found. A fabricated disposition is worse than an absent one — an
absent outcome is visibly a gap, while an invented one is indistinguishable from evidence and
defeats every later reader — so the record SHALL preserve all three states.

`declined` is included here because the engine already accepts it on the agent-facing surface while
this specification's enumeration omitted it; that divergence is closed rather than repeated.

#### Scenario: An agent-supplied disposition is reason-bearing
- **WHEN** an agent records a disposition through the interactive archive verb
- **THEN** it carries an outcome from the enumerated set, and every agent-supplied outcome except
  `delivered` carries a reason

#### Scenario: An engine-stamped path carries provenance instead of prose
- **WHEN** an epic reaches `archived` through a path that supplies no disposition
- **THEN** it carries `outcome: unknown` with `recordedBy` naming the path, and no reason is
  demanded of it

#### Scenario: An unreconstructable outcome is recorded with its reason
- **WHEN** an agent determines that an archived epic's outcome cannot be reconstructed from
  available evidence
- **THEN** that determination is recorded with its reason, and the epic no longer appears in the
  unconsidered set

#### Scenario: The three states remain distinguishable
- **WHEN** a reader inspects an archived epic's disposition
- **THEN** it can distinguish an outcome nobody considered, one an agent recorded, and one an agent
  determined to be unreconstructable

#### Scenario: Archiving a killed change preserves why it was killed
- **WHEN** an openspec-lane epic proposed with 47 tasks is dropped before any code is written
  because Gate 1 found the proposed check would invert stop-loss safety on the autonomous exit path,
  and the agent archives it with `outcome: killed` and that reason
- **THEN** `state.json` distinguishes it from a delivered epic, and the reason is readable without
  opening the commit that deleted the change's spec files

#### Scenario: Archiving through the interactive verb without an outcome is refused
- **WHEN** the agent archives an epic through the interactive archive verb and supplies no
  `outcome`
- **THEN** the transition is refused with a message naming the permitted outcomes, and the epic
  remains in its prior status

#### Scenario: The agent cannot choose `unknown`
- **WHEN** the agent archives an epic through the interactive archive verb supplying
  `outcome: unknown`
- **THEN** the transition is refused, because `unknown` records that nobody was asked and an agent
  running the verb was asked

#### Scenario: A path that supplies no disposition stamps `unknown` with `recordedBy` as a field
- **WHEN** any archive path that supplies no disposition leaves an epic at `archived` — the
  archive-drift heal, the archive backfill registration, or either archived-at-creation path
- **THEN** the epic carries `outcome: unknown` **and** `recordedBy` on that disposition record
  holding the fixed token for the path that wrote it, readable without parsing any free-text
  reason — rather than being refused (which would make the record contradict disk) or left with no
  outcome

#### Scenario: Pre-existing archived epics remain valid
- **WHEN** the engine loads a `state.json` whose archived epics predate this capability
- **THEN** those epics load as `outcome: unknown` (stamped `delivered` by migration only where a
  passing Gate 2 verdict exists — 7 of the 49 audited at the time that migration shipped; 3 of 144 remain so today), every existing behavior functions unchanged,
  and no reason is demanded retroactively

### Requirement: An agent's disposition replaces an engine stamp and never another agent's
A disposition supplied by the agent through the **interactive archive verb** SHALL replace an
**engine-stamped** disposition already on the epic — outcome, reason and timestamp together — and
SHALL NOT replace an **agent-supplied** one.

The two are told apart by `recordedBy` and by nothing else, which is the entire reason that field is
data rather than prose. A disposition is **engine-stamped** when `recordedBy` is present and holds
one of the fixed literal tokens this release defines: `archive-drift-heal`, `archive-backfill`,
`add-epic`, `add-many`, `migration`. A disposition is **agent-supplied** when `recordedBy` is
absent — the interactive archive verb never writes that field, and no CLI flag lets an agent set it.
The replacing record SHALL therefore carry no `recordedBy` of its own, so a record replaced once is
not replaceable again by this rule.

**This rule is what makes `delivered` recordable at all**, and it must not be inverted by mirroring
the neighbouring never-overwrite rules. Two such rules exist in this release and both bind other
paths: `gate-integrity` forbids the heal from overwriting an existing `gate2`, and the migration is
forbidden from overwriting an existing `disposition`. Both are engine paths overwriting an agent's
work. This is the opposite direction — an agent correcting a record the engine wrote because nobody
was asked — and an implementer who generalizes those rules to this path makes `outcome: unknown`
terminal on the documented `/opsx:archive` workflow and on all 65 migration-stamped archived epics in
this repository, which is exactly the defect this release exists to close.

The refusal in the other direction is a refusal, not a silent skip: replacing an agent's recorded
disposition would destroy a durable judgment somebody made, and the record of *why* an epic ended is
the thing this capability exists to preserve. Correcting a mistaken agent-supplied disposition is out
of scope here; the refusal MUST name the recorded outcome and when it was recorded so the agent can
see what it collided with.

#### Scenario: An agent's disposition replaces the heal's stamp
- **WHEN** the interactive archive verb records `outcome: delivered` on an epic whose disposition is
  `{outcome: "unknown", recordedBy: "archive-drift-heal"}`
- **THEN** the epic ends at `outcome: delivered` carrying the agent's reason and timestamp, with no
  `recordedBy` remaining on the record, because a disposition nobody chose is exactly what an agent
  is entitled to answer

#### Scenario: An agent's disposition replaces a migration stamp
- **WHEN** the interactive archive verb records a disposition on an archived epic whose disposition
  is `{outcome: "unknown", recordedBy: "migration"}`
- **THEN** the replacement is accepted, so history stamped by the upgrade is remediable rather than
  frozen at `unknown` for every archived epic in the repository

#### Scenario: An agent-supplied disposition is not replaced
- **WHEN** the interactive archive verb records a disposition on an epic whose existing disposition
  carries no `recordedBy`
- **THEN** the command exits non-zero naming the recorded outcome and when it was recorded,
  `state.json` is unchanged, and the earlier judgment survives

### Requirement: The instructions pm emits never present deletion as a way to end work
Wherever pm emits instructions for ending an epic, a story, a deferral, or a release exclusion —
its managed `CLAUDE.md` rules block, the `conductor` skill, and its command docs — that text SHALL
name recording a terminal disposition as the way to do it, and SHALL NOT present removing the
record as an equivalent action. Deletion removes the record of projected work, which is precisely
what a disposition exists to preserve.

The requirement binds the **emitted text**, which pm owns and its own suite can assert against, not
the removal verb itself. `remove-epic` hard-deletes today and stays available for what it is for —
an epic registered in error, a duplicate, a mistake made a minute ago — where there is no
disposition to record because there was no work. Gating that verb is deliberately NOT required
here: the failure this addresses is an agent reaching for deletion because the instructions it was
handed offered it as a way to close something out, and that is fixed at the surface where the
suggestion is made.

#### Scenario: The emitted instructions offer disposition, not removal
- **WHEN** the rules block, the `conductor` skill, or a command doc describes ending an epic, a
  story, a deferral, or a release exclusion
- **THEN** that text names the disposition path with its required reason, and no emitted surface
  presents removal of the record as a way to resolve it — assertable directly against the text pm
  emits

#### Scenario: Removing an epic registered in error is still available
- **WHEN** an epic was registered by mistake and carries no work to disposition
- **THEN** removing it remains available and is not obstructed, because there is no terminal
  disposition to preserve for work that never existed

### Requirement: A deferral is registered or explicitly declined before archive
A follow-up deliberately scoped out during a change — an "out of scope here", a "latent caveat", a
"follow-up discovered during implementation" — SHALL be registrable as a `planned`/`queued` epic
carrying its provenance: the change it came from and the artifact section that named it.

Identification of deferrals is the agent's job, not the engine's: matching on artifact prose is the
same fragility `PLAN_INDEX_FILES` already works around in `epic-progress.mjs`, and a scanner that
misses a deferral would make the guard less trustworthy than no guard. The engine therefore cannot
know what the deferrals are, and MUST NOT claim to. What it can require is an **assertion**: the
**interactive archive verb** SHALL refuse until the agent has asserted, durably against the epic,
what the change's deferrals are — including the assertion that there are none — with each asserted
deferral either registered as a `planned`/`queued` epic or recorded as declined with a reason.

The refusal therefore names the **missing assertion**, never a list of deferrals the engine has not
identified and cannot identify. An implementer reading this MUST NOT build a prose scanner to
populate that message; a refusal that named specific deferrals would require exactly the scanner
this requirement rules out, and shipping it would make the guard's message a guess.

**AN ASSERTED DEFERRAL SHALL NAME A REAL EPIC.** The engine cannot identify the deferrals and does
not try — but a deferral the agent HAS identified makes a checkable claim, that a named epic now
holds the work, and that claim SHALL be checked before it is stored. The interactive archive verb
SHALL refuse, writing nothing and exiting non-zero, a deferral whose epic half is **empty**, names
an epic **the record does not hold**, or names **the epic being archived**. The refusal SHALL name
the offending value and which of the three it is.

Each of the three is the assertion failing in the way the assertion exists to prevent. An empty half
records an assertion asserting nothing, which is the silence "there are none" is the sayable form
of — and it is not equivalent to that assertion, because it claims a deferral exists and then
declines to say where it went. An unknown epic records work handed to nothing. The epic being
archived records work handed to the record that just ended. This is the validation every sibling
that stores an epic id already performs; that it was written for the declined half of the same
assertion and never reached this half is the absent-edit defect class, not an exemption.

The check is a **write-time refusal and not a scan**: it reads the id the agent supplied, against
the epic list already loaded, and asks nothing about prose.

#### Scenario: A design-doc deferral becomes a backlog epic with provenance
- **WHEN** a change's design doc defers an identical zero-fall-through fix in a second code path,
  and the agent registers it before archiving
- **THEN** a `planned` epic exists carrying the originating change id and the section it came from,
  and it survives the change's artifacts moving into `openspec/changes/archive/`

#### Scenario: Archiving before the agent has asserted anything is refused
- **WHEN** the agent runs the interactive archive verb on a change against which no deferral
  assertion has been recorded
- **THEN** the transition is refused with a message naming the missing assertion and how to make
  it — not a list of deferrals, which the engine has not identified and does not attempt to

#### Scenario: Asserting that a change deferred nothing satisfies the requirement
- **WHEN** the agent asserts that the change carries no deferrals and then archives it
- **THEN** the archive proceeds, and the assertion is readable back later as the agent's answer
  rather than as an absence indistinguishable from never having looked

#### Scenario: A deliberate decline is recorded, not silently dropped
- **WHEN** the agent declines to register a deferral because it is judged not worth doing
- **THEN** the decline is stored as a disposition with its reason and is readable later, rather than
  existing only in the session that made the call

#### Scenario: A deferral naming no epic is refused
- **WHEN** the agent archives an epic asserting a deferral whose epic half is empty
- **THEN** the command exits non-zero naming the empty half, the epic is not archived, and the state
  of record is byte-identical to before the call

#### Scenario: A deferral naming an epic the record does not hold is refused
- **WHEN** the agent archives an epic asserting a deferral to an id no epic in the record carries
- **THEN** the command exits non-zero naming that id as unknown, the epic is not archived, and the
  state of record is byte-identical to before the call — the dangling reference is refused at the
  write rather than reported afterwards by the read-only integrity check

#### Scenario: A deferral naming the archiving epic itself is refused
- **WHEN** the agent archives an epic asserting a deferral whose epic half is that same epic's id
- **THEN** the command exits non-zero saying the epic cannot defer work to itself, and the state of
  record is byte-identical to before the call

#### Scenario: A deferral section may be empty, and a valid deferral still archives
- **WHEN** the agent archives an epic asserting a deferral naming a different, registered epic and
  supplying an **empty artifact-section half**
- **THEN** the archive proceeds and the assertion reads back holding that epic — this requirement
  constrains the half that names where the work went, and leaves the artifact-section half exactly as
  it is today, so the both-halves-non-empty rule the declined flag carries is NOT what is reused here:
  only the epic half is checked

### Requirement: Unfinished work at archive records where it went
Archiving an epic that **has outstanding work** SHALL require a handoff disposition: a `carried-to`
reference naming the epic that now owns the work, with which tasks, as the reason.

**THE NAMED RECEIVER SHALL BE A REAL, OTHER EPIC.** A handoff is the one thing standing between
outstanding work and its disappearance, so the reference SHALL be refused, writing nothing and
exiting non-zero, when it is **empty**, names an epic **the record does not hold**, or names **the
epic being archived**. The refusal SHALL name the offending value and which of the three it is.

The self-reference is the sharpest of the three and is the reason this rule is stated here rather
than left to the read-only integrity check. A handoff to the archiving epic satisfies the guard
while conveying nothing: the work is recorded as owned by a record that has just ended, the gate
that exists to stop a remainder vanishing reports success, and a reader afterwards cannot
distinguish it from a genuine handoff. Every id-storing sibling in the record validates its target;
this one did not.

**The demand binds `outcome: delivered` only** — the same binding the archive gate takes in
`gate-integrity`, for the same reason. `killed`, `superseded` and `abandoned` already carry a
required reason that answers where the work went: nowhere, and why. A change killed at Gate 1 with
no code written has every task outstanding by construction, so a handoff demand that bound every
outcome would refuse the exact archive this release exists to make recordable. `carried-to` is how
a *delivered* epic accounts for a remainder it did not finish. **The validation above, unlike the
demand, binds wherever the reference is supplied**: a receiver named alongside any outcome is a
claim about where work went, and a false one is no less false for accompanying a `killed`.

This MUST NOT block a legitimate archive — the archive proceeds once the handoff is recorded. Both the archiving epic and the
receiving epic MUST show the relationship in `PROJECT.md` and the briefing. The link vocabulary
already accepts a free-form type, so no new link type is required; what does not exist today is the
prompt at the transition and the rendering on both ends.

**"Has outstanding work" is the quantity the `conductor-record` capability defines, and this guard
SHALL key on it rather than counting unticked checkboxes for itself.** The two are not the same: a
change's own task list carries a task instructing the agent to archive it, which is unticked at
archive time by construction, so a guard reading raw checkbox state would demand a handoff for
every fully delivered change and the release would ship a guard that refuses its own success case.
The refusal MUST state the same count the record renders for that epic.

**The refusal MUST name BOTH remedies.** The exclusion `conductor-record` defines is marker-gated,
so a task source authored before this release — carrying a real archive instruction with no
`<!-- pm:lifecycle -->` declaration — still counts that item as outstanding and still refuses.
There are therefore two correct responses to this refusal, and the message SHALL name each: record
a `carried-to` reference where work genuinely moved to another epic, **or** add the
`<!-- pm:lifecycle -->` declaration, quoted as that literal token, where the outstanding item is
lifecycle bookkeeping rather than delivery. A refusal naming only the handoff steers an agent
holding a fully delivered change toward inventing a receiver for work nobody carried anywhere,
which is a fabricated record produced by a guard built to prevent fabricated records.

The guard binds the **interactive archive verb** only. Every other archive path `gate-integrity`
enumerates — the **archive-drift heal**, the **archive backfill registration** and the two
**archived-at-creation paths** — MUST NOT be bound by it: the backfill is required to register
historical changes with their unticked counts intact, including the one genuinely abandoned change
in the audited archive, and none of those paths receives a named receiver from anyone.

#### Scenario: Archiving with outstanding work and a named receiver
- **WHEN** an epic is archived with 3 of 81 tasks deliberately un-ticked and the agent records
  `carried-to` the epic that inherited them
- **THEN** the archive succeeds, the archived epic renders as having carried work out, and the
  receiving epic renders what it inherited

#### Scenario: Archiving as delivered with outstanding work and no handoff is refused
- **WHEN** an epic with outstanding work is archived through the interactive verb as
  `outcome: delivered` with no `carried-to` reference
- **THEN** the transition is refused, stating the same outstanding count the record renders, so the
  handoff cannot vanish silently

#### Scenario: A handoff naming the archiving epic itself is refused
- **WHEN** an epic holding outstanding work is archived through the interactive verb as
  `outcome: delivered` with a `carried-to` reference naming that same epic
- **THEN** the command exits non-zero saying an epic cannot carry work to itself, the epic is not
  archived, and the state of record is byte-identical to before the call

#### Scenario: A handoff naming an epic the record does not hold is refused
- **WHEN** an epic is archived through the interactive verb with a `carried-to` reference to an id
  no epic in the record carries
- **THEN** the command exits non-zero naming that id as unknown, and the state of record is
  byte-identical to before the call

#### Scenario: A handoff supplied alongside a non-delivered outcome is validated too
- **WHEN** an epic is archived through the interactive verb with `outcome: killed`, its reason, and
  a `carried-to` reference naming an id no epic carries
- **THEN** the command exits non-zero, because the reference is a claim about where work went
  whether or not this outcome demanded one

#### Scenario: The refusal names the declaration as well as the handoff
- **WHEN** a fully delivered change is archived through the interactive verb and its only
  outstanding item is an un-declared archive instruction in a task source written before this
  release
- **THEN** the refusal names both remedies — record a `carried-to` reference, or mark the item with
  the literal `<!-- pm:lifecycle -->` declaration — so the agent is not steered into naming a
  receiver for work that went nowhere

#### Scenario: A killed epic with every task outstanding needs no handoff
- **WHEN** an epic is archived with `outcome: killed` and its reason, with all 47 of its tasks
  outstanding because no code was ever written
- **THEN** the archive succeeds and no `carried-to` reference is demanded, because the recorded
  reason already accounts for the work — the same archive `gate-integrity` requires to succeed
  without a Gate 2 verdict

#### Scenario: The change's own archive instruction alone demands no handoff
- **WHEN** a fully delivered change is archived and the only item its task source leaves unticked is
  the lifecycle-bookkeeping task instructing the agent to archive this very change, carrying the
  declaration marker that `conductor-record` requires for exclusion
- **THEN** the archive succeeds with no handoff demanded, because the epic's outstanding work is
  zero; a guard that refused here would refuse every correctly finished change in the repository

#### Scenario: A backfilled archived epic is not asked for a handoff
- **WHEN** the archive backfill registration registers a historical archived change carrying
  unticked tasks
- **THEN** it registers as `archived` with those counts intact and no handoff is demanded, because
  no agent is present on that path and the counts are the evidence the backfill exists to preserve

### Requirement: A release is a named grouping of epics
A release SHALL be a first-class object in `.conductor/state.json` with an id, intent prose, an
optional target, and member epics, and an epic SHALL be associable with at most one release. The
agent decides membership; the engine only records and renders it. Automated grouping, and any
engine judgment about what belongs in a release, are explicitly out of scope.

#### Scenario: Creating a release and associating epics
- **WHEN** the agent creates a release with an id and intent prose and associates several epics
  with it
- **THEN** "what is in this release" is answerable from `state.json` alone, without reading a
  conversation transcript

#### Scenario: The engine proposes no membership of its own
- **WHEN** epics are added, re-prioritized, or archived in a repo that has a release
- **THEN** release membership changes only when the agent changes it, and no epic is auto-assigned

### Requirement: Exclusion from a release is recorded with a reason
An epic deliberately excluded from a release SHALL be recordable as deferred from that release with
a required reason, using the same disposition record as every other scope. This MUST be
distinguishable from an epic nobody considered: leaving an epic queued MUST NOT be treated as an
exclusion, and an excluded epic MUST remain in the backlog rather than being ended.

#### Scenario: Recording why an epic was cut from a release
- **WHEN** the agent records that an epic is deferred from release `0.27.0` because it depends on
  another issue landing and on a progress signal the same release is still changing
- **THEN** that reason is stored against the epic/release pair and survives the release closing

#### Scenario: An unconsidered epic is not an exclusion
- **WHEN** an epic is queued and was never associated with or excluded from a release
- **THEN** it renders as neither in the release nor deferred from it

### Requirement: Release membership and exclusions render
`PROJECT.md` and the briefing SHALL render a release as its member count and its deferred count —
"`<release>`: N epics, M deferred" — with each deferral's reason reachable from the record rather
than only from the session that made the call.

#### Scenario: Rendering a release line
- **WHEN** a release has 12 member epics and 3 epics deferred from it with reasons
- **THEN** `PROJECT.md` and the briefing show `12 epics, 3 deferred` for that release, and the three
  reasons are readable from `state.json`

### Requirement: The archive can be asked which of its records carry no considered outcome
The engine SHALL be able to enumerate the archived epics whose outcome nobody considered, and SHALL
emit, per epic, the invocation that would record one.

That population is precisely the epics carrying an ENGINE-WRITTEN stamp whose outcome value is
`unknown`. Both halves are load-bearing. An engine stamp alone is not enough: a stamp can be
evidence-derived, and this repository holds three epics stamped `delivered` by migration from a
passing Gate 2 verdict — handing those to an agent to re-dispose would ask it to re-derive what the
record already derived correctly. An `unknown` value alone is not enough either, since `unknown` is
never an agent's answer and can only arrive by stamp.

An absent disposition SHALL NOT be part of the population. Absence is not a state an archived epic
reaches: every archive path binds the outcome invariant, and the migration stamped every
pre-existing archived epic. A predicate handling absence would be handling a state no path produces.

Measured in this repository, 66 of 144 archived epics match — 46% of the archive — with 3
evidence-derived stamps correctly excluded and 75 agent-recorded outcomes untouched. The cost of
that gap is not cosmetic: a grooming pass hit it four separate times and reconstructed from commit
history what the record should have stated, and a user filed an issue reporting work that had in
fact been done, because the epic proposing it archived with nothing saying so.

**The emitted invocation SHALL offer only outcomes the archive gate would accept for that epic.**
Where recording `delivered` is blocked by an obligation the archive gate enforces — for an
openspec-lane epic, a missing, withdrawn or stale Gate 2 — the entry SHALL NOT offer `delivered` in
its invocation, and SHALL name each blocking obligation in a machine-readable field, together with
the remedy that meets it. That field is an ORDERED list, and its order is the order the remedies must
run: every Gate 2 obligation before the handoff, because the `delivered` archive that meets a checkbox
source's handoff is itself refused while Gate 2 is unmet. gh-189 measured the cost: of 20 epics reported, all 12 openspec-lane
entries were refused when `delivered` was substituted, and nothing in the output said they would be.
Where the blocking obligation is a Gate 2 that the epic predates, the entry states that recording
`delivered` requires a real Gate 2 review of that work — the finding is about process, not a
bookkeeping obstacle. The `integrity` remedy for an epic in an undefined status SHALL apply the
same rule.

**One rendering is excepted: update-epic's refusal of an edit that would break an archived
`delivered` record.** That epic's outcome is already `delivered` and was considered; the refusal
exists so the edit can be made without losing it. Its remedy SHALL keep `delivered` and SHALL name
first the re-record that restores the broken obligation (for a Gate 2, the verdict over the range
that now covers the attributed commits), then the disposition invocation. Where the edit would leave
the record attributing no commits (it withdraws the last one), a re-record cannot restore the
obligation alone: the remedy SHALL name the Gate 2 re-record over the commit that replaces the
withdrawn one, then that commit's `--attribute-commit`, then the invocation.

#### Scenario: The unconsidered set is enumerable with its remedy
- **WHEN** an agent asks the engine which archived epics carry no considered outcome
- **THEN** it receives those epics and, for each, the invocation that would record a disposition

#### Scenario: An evidence-derived engine stamp is excluded
- **WHEN** an archived epic carries an engine-written outcome other than `unknown`
- **THEN** it does NOT appear in the unconsidered set

#### Scenario: An agent-recorded outcome is excluded
- **WHEN** an archived epic carries an agent-recorded outcome
- **THEN** it does NOT appear in the unconsidered set

#### Scenario: An archive with every outcome considered reports an empty set
- **WHEN** no archived epic carries an engine-written `unknown`
- **THEN** the unconsidered set is empty

#### Scenario: An openspec-lane entry without Gate 2 does not offer delivered
- **WHEN** the unconsidered set holds an openspec-lane epic with no passing Gate 2
- **THEN** its invocation's outcome choices exclude `delivered`, its entry names the Gate 2 obligation
  and the remedy that records one, and running the invocation with any outcome it offers (and a
  reason) exits zero (today `delivered` is offered and exits 1)

#### Scenario: An entry the gate does not bind still offers delivered
- **WHEN** the unconsidered set holds a `claude-code`-lane epic
- **THEN** its invocation offers `delivered` and names no blocking obligation, and running it with
  `delivered` exits zero

#### Scenario: An entry blocked by open work names the way past it
- **WHEN** the unconsidered set holds an epic whose task source still has open work — a checkbox file
  with a task open, or an open inline story
- **THEN** its entry names the handoff obligation with a remedy that is never empty: for the checkbox
  source, the `delivered` archive carrying `--carried-to <epicId>` and `--reason`, which filled with a
  receiving epic exits zero and removes the entry; for the story, `--story <n> --done`, after which the
  entry names nothing blocking `delivered` (before Gate 2 U-I1 the checkbox entry's remedy was empty)

#### Scenario: An entry blocked twice lists its remedies in the order they run
- **WHEN** the unconsidered set holds an openspec-lane epic with no passing Gate 2 whose task source is a
  checkbox file with a task open
- **THEN** its entry names the Gate 2 obligation first and the handoff second; running the handoff's
  archive first is refused on the missing Gate 2; and running every entry's remedy lines in the order
  listed, filled with a range and a receiving epic, exits zero at each step and removes the entry

#### Scenario: The archived-delivered regression refusal keeps delivered
- **WHEN** an `--attribute-commit` on an archived `delivered` openspec-lane epic is refused because
  its passing Gate 2 would no longer reach the attributed commits
- **THEN** the refusal names the Gate 2 re-record first, its printed invocation still offers
  `delivered`, and following both in order with the range filled by meaning exits zero

#### Scenario: The integrity remedy for an undefined status follows the same rule
- **WHEN** `integrity` reports an openspec-lane epic with no passing Gate 2 sitting in an undefined
  status
- **THEN** the archive invocation it prints does not offer `delivered`
