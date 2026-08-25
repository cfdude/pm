## Purpose

Gate verdicts carry evidence a later reader can check, the archive transition is gated — or
recorded as having bypassed the gate — on every path that can reach it, and the gate procedure
pm emits requires a call-site completeness sweep and verification against the commit rather than
the working tree. Measured baseline: 42 of 49 archived openspec-lane epics across 8 repositories
reached `archived` with `gateReview: null`, by following the documented `/opsx:archive` workflow.

## ADDED Requirements

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
  `pass` and `fail`, carrying `reviewedAt` and `recordedBy` — binds **openspec-lane epics only**.

On both halves, `recordedBy` SHALL be the single fixed literal token `archive-drift-heal`, so a test
and a consumer bind to it exactly rather than to a description of the path. `reviewer` carries a
reviewer's identity and MUST be absent on an `ungated` entry, so an audit query over `reviewer`
never mixes path names with the identities of people and agents who actually reviewed something.

**The bypass half MUST NOT be written for a non-openspec-lane epic.** Gate 2 is an openspec-lane
obligation: `record-gate-review` refuses a verdict to an epic of any other lane, so an `ungated`
entry on a `claude-code` or `superpowers` epic would be a standing condition with **no** clearing
path in the engine at all — strictly worse than the backfill flood the requirement below forbids,
because that one is at least clearable in principle. The heal reaches every lane and the lanes it
reaches most are not openspec: it is a live, reachable shape, not a hypothetical one — this
repository holds 68 archived epics of which 65 are not openspec-lane, and the dual-lane registration
defect deliberately left unfixed this release keeps producing superpowers-lane epics whose ids are
date-prefixed variants of openspec ones.

**The heal's openspec-lane test is a site deciding openspec-lane membership** and SHALL normalize an
absent `lane` exactly as the three sites named in the normalization requirement below do. A lane-less
epic renders as openspec-lane everywhere, so a strict test here would silently deny it the bypass
record that its rendering says it owes.

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

- **WHEN** the archive-drift heal archives an openspec-lane epic that has no passing Gate 2 verdict
- **THEN** one write leaves the epic with `gateReview.gate2` at verdict `ungated`, carrying its
  timestamp and `recordedBy: "archive-drift-heal"` and no `reviewer`, and with `outcome: unknown`
  carrying `recordedBy: "archive-drift-heal"` as a field — so a later reader can tell it apart from
  an epic that passed a real implementation review without parsing any prose, and no archived epic
  is left without an outcome

#### Scenario: A healed non-openspec-lane epic gets a disposition and no ungated condition

- **WHEN** the archive-drift heal flips a `claude-code`- or `superpowers`-lane epic to `archived`
- **THEN** the epic carries `outcome: unknown` with `recordedBy: "archive-drift-heal"` and **no**
  `gateReview.gate2` entry, so it is never named as an ungated archive — a lane whose epics
  `record-gate-review` refuses a verdict could never clear such a condition, leaving it permanent
  and unactionable on the majority of the epics this function touches

#### Scenario: A healed lane-less epic is treated as openspec-lane by the heal

- **WHEN** the archive-drift heal flips an epic that has no `lane` field to `archived`
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

An epic carrying an `ungated` Gate 2 SHALL be named wherever the conductor reports its own
integrity, and that notice MUST NOT be consumed on delivery. An ungated archive is a standing
record condition, not an episode: unlike the write-conflict contention warning — which describes a
run of events that has ended and is therefore consumed once a session has seen it — the condition
here persists in `state.json` until something changes it, and a notice that consumes would report
it to one session and hide it from every session after.

Only the archive-drift heal produces `ungated` entries, and only for openspec-lane epics. The
archive backfill registration and the two archived-at-creation paths are forbidden above from
writing a `gate2` entry at all, so no epic any of them registers can ever be named by this notice —
which is what keeps a standing, unclearable condition from being asserted en masse against changes
archived before the conductor could have guarded them. The heal's lane binding does the same job for
the lanes that have no Gate 2 to record: a non-openspec-lane epic is never named by this notice,
because it never acquires the entry.

Recording a real Gate 2 verdict with evidence SHALL supersede an `ungated` entry, and that is what
clears the notice. The superseded entry MUST remain readable, so an audit can still see that the
epic was archived ungated before it was reviewed. Without a supersession path the notice would be
unremediable by design, which is how a standing signal becomes noise everyone filters.

#### Scenario: An ungated archive is visible in the session briefing

- **WHEN** a briefing is composed in a repo containing at least one epic whose recorded Gate 2
  verdict is `ungated`
- **THEN** the briefing names those epics, so the condition is visible in-session rather than
  discoverable only by querying `state.json`

#### Scenario: Delivering the notice does not clear it

- **WHEN** a briefing carrying that notice is delivered into a session and a later briefing is
  composed with the epic's `ungated` verdict unchanged
- **THEN** the later briefing names the epic again, because the condition still holds

#### Scenario: A real verdict supersedes the bypass entry

- **WHEN** the agent records a passing Gate 2 with its evidence against an epic whose `gate2` is
  `ungated`
- **THEN** the epic stops being reported as an ungated archive, and the record still shows that it
  was archived ungated before the review happened

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

1. an epic whose `outcome` is `killed`, `superseded` or `abandoned` — each carries a required reason
   explaining why the work did not complete, and the release's own flagship case is a change killed
   at Gate 1 with 47 tasks and no code written, which is zero-ticked by construction;
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
is measurable rather than arguable: this repository holds 68 archived epics, 3 with a passing
Gate 2, so after the migration that stamps `delivered` only where such a verdict exists, a
`delivered`-only zero-ticked check has zero candidates in the repository whose live data this
requirement cites as its evidence.

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

- **WHEN** an archived epic that carries neither an excluded outcome (`killed`, `superseded`,
  `abandoned`) nor the `archive-backfill` stamp has a progress source that exists and contains
  checkboxes, none of which are ticked
- **THEN** the check reports the epic and its source — four epics in this repository qualify today,
  archived at `0/17`, `0/99`, `0/37` and `0/34`, none carrying a passing Gate 2 and so none
  `delivered` after the migration. Three of the four are the date-prefixed superpowers-lane
  registrations of ids also held under the openspec lane, which the dual-lane check below reports
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
> `conductor-mjs-module-split` (openspec) against `2026-07-21-conductor-mjs-module-split`
> (superpowers), and the same shape for `platform-parity-mechanism`,
> `epic-hierarchy-orchestration` and `edd-harness-agent-behavior-testing`. A literal-equality check
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

### Requirement: The emitted gate procedure requires a call-site completeness sweep

The gate procedure pm emits SHALL require, for every rule, guard or invariant a change introduces
or modifies, that the reviewer enumerate all call sites of the thing being guarded, state where
the rule holds and where it does not, and justify each omission.

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
