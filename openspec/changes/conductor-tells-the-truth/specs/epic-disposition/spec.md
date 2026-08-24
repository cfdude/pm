# epic-disposition Specification

## Purpose

Work that ends, is deliberately deferred, is handed off, or is excluded from a release carries a
recorded terminal disposition with a reason. That is one concept at four scopes, and the conductor
currently expresses none of them: a change killed at Gate 1 with 47 tasks and no code written is
byte-identical in `state.json` to one that shipped. This capability defines the disposition record
once and applies it to each scope; the engine records and renders, the agent decides.

## ADDED Requirements

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
`delivered` | `killed` | `superseded` | `abandoned` | `unknown`. `outcome` is a distinct field from
`status`, not a new status value — an epic is still `archived`, and every existing status-driven
behavior is unchanged. `delivered` MAY omit a reason; `killed`, `superseded` and `abandoned` MUST
carry one. This capability defines the record's shape; **which archive paths exist, and which
outcome the Gate 2 requirement binds, are enumerated by the `gate-integrity` capability** and are
not restated here.

`unknown` is never an agent's answer. The refusal to archive without an outcome binds the
**interactive archive verb** only — the one path where an agent supplies a disposition — and that
path MUST also refuse `unknown` supplied by the agent, since choosing "I don't know" over a real
disposition is the silence this capability exists to remove. **Every other archive path
`gate-integrity` enumerates supplies no disposition** — the **archive-drift heal**, the **archive
backfill registration** and the two **archived-at-creation paths** — and each MUST instead have the
**engine** stamp `outcome: unknown`. On all of them, that stamp MUST carry
`recordedBy` — the fixed literal path token `gate-integrity` and `conductor-record` define
(`archive-drift-heal`, `archive-backfill`, `add-epic`, `add-many`) — as a **field on the disposition
record**, not merely as the free-text reason. `conductor-record` states the general rule: any path in this release that
stamps an outcome the agent did not supply uses that field, precisely so a consumer keys on data
rather than parsing prose; a heal whose outcome carried only a reason naming its path would
reintroduce exactly the prose-parsing dependency the field exists to eliminate. The reason MAY
additionally name the path for a human reader.

Note that "the engine stamps it" is not a claim that nobody was at the keyboard: `gate-integrity`
binds the heal to `reconcileArchived()` wherever invoked, and two of its call sites are interactive
verbs. The stamp records that no disposition was supplied at the transition, which is true at all of
them. Together with pre-existing state loading as `unknown` this is the only way the value is ever
written. The alternative — an archived epic carrying no outcome at all — is strictly worse than a
recorded "unknown, healed from disk".

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
  passing Gate 2 verdict exists — 7 of the 49 audited), every existing behavior functions unchanged,
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

### Requirement: Unfinished work at archive records where it went
Archiving an epic that **has outstanding work** SHALL require a handoff disposition: a `carried-to`
reference naming the epic that now owns the work, with which tasks, as the reason.

**The demand binds `outcome: delivered` only** — the same binding the archive gate takes in
`gate-integrity`, for the same reason. `killed`, `superseded` and `abandoned` already carry a
required reason that answers where the work went: nowhere, and why. A change killed at Gate 1 with
no code written has every task outstanding by construction, so a handoff demand that bound every
outcome would refuse the exact archive this release exists to make recordable. `carried-to` is how
a *delivered* epic accounts for a remainder it did not finish.

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
