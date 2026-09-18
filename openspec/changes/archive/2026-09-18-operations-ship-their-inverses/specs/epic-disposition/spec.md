## MODIFIED Requirements

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
