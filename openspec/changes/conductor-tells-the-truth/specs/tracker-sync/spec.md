## ADDED Requirements

### Requirement: Tracker direction is explicit configuration
Every tracker entry SHALL carry a `direction` of `inward`, `outward`, or `both`, settable via
`set-tracker --direction <d>`. Direction MUST NOT be inferred from the tracker's vendor/system
name at any site. A **new** primary tracker registered without `--direction` SHALL default to
`inward` — outward creation of issues in someone else's tracker is the consequential default and
must be chosen, not inherited. This default is a deliberate, user-visible **reversal** of today's
behavior for newly registered non-`github-issues` trackers: a `jira` primary registered today
receives the outward "External tracker sync" section and no inward instruction, and after this
change the same command produces the opposite — the inward pull the migration rationale correctly
observes no existing repo has ever had. The reversal applies **only to trackers registered after
this change ships**; existing state is governed by "A tracker with no recorded direction keeps its
prior behavior" and by the migration, neither of which grants inward pull to any repo that did not
already have it. It MUST be documented as a behavior change in the README and the docs site. A
secondary tracker SHALL be pinned to `inward`; any other value is rejected, because "Secondary
trackers never receive outward-created issues" is already a requirement of this capability.

#### Scenario: A new primary tracker defaults to inward
- **WHEN** the agent runs `set-tracker --system jira --instance onvex --project JOB` in a repo with
  no existing primary tracker
- **THEN** `state.tracker.direction` is `inward`, and the rules block emits the inward section and
  no outward section

#### Scenario: An invalid direction is rejected and writes nothing
- **WHEN** the agent runs `set-tracker --system jira --direction sideways`
- **THEN** the command exits non-zero and `state.tracker` is left exactly as it was

#### Scenario: A secondary tracker cannot be given an outward direction
- **WHEN** the agent runs `set-tracker --role secondary --system jira --project ABC --direction
  outward`
- **THEN** the command exits non-zero and `state.secondaryTrackers` is unchanged

#### Scenario: Merging into an existing tracker does not stamp a direction
- **WHEN** a primary tracker already exists with no `direction` field and the agent runs
  `set-tracker --intent paused:todo`
- **THEN** only `statusIntent` changes; no `direction` is written, and the tracker keeps resolving
  to the same direction it resolved to before the command ran

### Requirement: A tracker with no recorded direction keeps its prior behavior
A tracker object with no `direction` field SHALL resolve to the behavior that vendor produced
before direction existed: `github-issues` resolves to `inward`, every other system resolves to
`outward`. This fallback MUST hold independently of any state migration, because a repo can run
this engine version for weeks before its state is upgraded. Exactly one deliberate behavior change
is permitted on that path — see "The sync nudge is emitted only where an inward procedure exists".

#### Scenario: An un-upgraded jira repo is unchanged
- **WHEN** the rules block is emitted for `tracker: {system: "jira", projectKey: "JOB"}` with no
  `direction` field
- **THEN** it is byte-identical to the block the previous engine version emitted for the same
  state — the outward section present, no inward section

#### Scenario: An un-upgraded github-issues repo is unchanged
- **WHEN** the rules block is emitted for `tracker: {system: "github-issues", repo: "o/n"}` with no
  `direction` field
- **THEN** the inward section is present and the outward section is absent, exactly as before

#### Scenario: Upgrading stamps the direction without changing what is emitted
- **WHEN** a repo whose tracker has no `direction` is upgraded
- **THEN** `github-issues` is stamped `inward` and every other system is stamped `outward`,
  secondary entries are stamped `inward`, an explicitly set `direction` is never overwritten, a
  second upgrade is a no-op, and the rules block emitted after the upgrade is identical to the one
  emitted before it

### Requirement: Rules-block tracker sections are governed by direction
The rules block SHALL emit its outward "External tracker sync" section if and only if the primary
tracker's direction is `outward` or `both`, and its inward sync section if and only if **an inward
procedure is emittable** for that tracker, as defined by "An inward section is emitted only when
the tracker names what to read". The inward section MUST be vendor-neutral: a `github-issues`
tracker keeps a literal `gh issue list --repo <repo>` step, and any other system receives the
equivalent step phrased as "list open items in `<system>` (`<scope>`) with your own tooling" — the
same fallback the secondary-tracker path already emits today, which the primary slot alone lacks.
The inward section MUST instruct deduplication on `externalUrl` rather than bare `externalId`,
since issue numbers are unique only within one tracker/repo.

#### Scenario: An inward jira primary gets an inward section and no outward section
- **WHEN** the rules block is emitted for `{system: "jira", projectKey: "JOB", direction:
  "inward"}`
- **THEN** it contains an inward sync section naming `jira` that instructs deduplication on
  `externalUrl`, and contains no "External tracker sync" outward section

#### Scenario: An outward github-issues primary gets an outward section and no inward section
- **WHEN** the rules block is emitted for `{system: "github-issues", repo: "o/n", direction:
  "outward"}`
- **THEN** it contains the "External tracker sync" outward section and no inward sync section

#### Scenario: A both-direction tracker gets both sections
- **WHEN** the rules block is emitted for a tracker with `direction: "both"` and an identifying
  scope
- **THEN** both the inward and the outward sections are present

### Requirement: An inward section is emitted only when the tracker names what to read
There SHALL be exactly one resolved predicate — **"an inward procedure is emittable"** — computed
in one place and consumed by every emitter that depends on inward behavior. A tracker satisfies it
when its resolved direction includes `inward` **and** the tracker carries an identifying scope: a
`repo` for `github-issues`, and a `repo` or `projectKey` for any other system. A tracker whose
direction includes `inward` but which names no scope SHALL emit **no** inward section, on the
un-upgraded path and on the migrated path alike, because there is nothing to put in the "list open
items in …" step and emitting an unrunnable command would violate "Every command pm emits must run
as written".

This case is not hypothetical and it is what makes the plain rule "inward section iff direction
includes inward" unsafe: a `github-issues` primary with **no `repo`** emits neither section today
(`rules.mjs` suppresses the outward section on the vendor test and guards the inward section on
`tracker.repo`), the migration stamps it `inward`, and under the plain rule it would gain a section
it never had — breaking both "An un-upgraded github-issues repo is unchanged" and "Upgrading stamps
the direction without changing what is emitted". Scope-lessness governs the primary slot only;
secondary trackers already require a `repo` or `projectKey` at registration and their vendor-neutral
fallback already degrades correctly, so this requirement MUST NOT be generalized to them.

Direction and scope are separate tests and MUST stay separate in the emitted text: a **scoped**
non-`github-issues` tracker explicitly set to `inward` is the case that receives the vendor-neutral
phrasing, not the scope-less case, which receives nothing.

#### Scenario: A github-issues tracker with no repo emits neither section
- **WHEN** the rules block is emitted for `tracker: {system: "github-issues"}` with no `repo`,
  whether it carries no `direction` at all or has been migrated to `direction: "inward"`
- **THEN** neither an inward sync section nor an outward "External tracker sync" section is
  present, and the block is byte-identical to the one the previous engine version emitted for that
  same state

#### Scenario: A scope-less inward tracker of any system emits no inward section
- **WHEN** the rules block is emitted for `{system: "jira", direction: "inward"}` with neither
  `repo` nor `projectKey`
- **THEN** no inward sync section is emitted, and no command line naming an unfilled scope
  placeholder appears anywhere in the block

#### Scenario: Adding a scope to that tracker turns the inward section on
- **WHEN** the same `{system: "jira", direction: "inward"}` tracker is given a `projectKey`
- **THEN** the inward sync section appears, phrased vendor-neutrally and naming that project as the
  scope to list

### Requirement: The completion-sync reminder is emitted only where an inward procedure exists
The "Sync after completing tracker-linked work" reminder SHALL be emitted only when at least one
configured tracker **has an emittable inward procedure** — the predicate defined in "An inward
section is emitted only when the tracker names what to read", not raw direction — and it MUST NOT
refer the agent to writeback steps that the same rules block does not actually emit. Today it fires
for any `github-issues` primary and cites "the writeback steps above" even when no writeback
instruction was emitted at all, which is exactly the scope-less case.

#### Scenario: An outward-only repo gets no completion-sync reminder
- **WHEN** the rules block is emitted for a single primary tracker with `direction: "outward"` and
  no secondary trackers
- **THEN** the "Sync after completing tracker-linked work" section is absent

#### Scenario: An inward primary with no secondaries gets a reminder with no dangling reference
- **WHEN** the rules block is emitted for a single primary tracker with `direction: "inward"`, an
  identifying scope, and no secondary trackers
- **THEN** the reminder is present and every writeback step it references is a step the same block
  emitted

#### Scenario: A scope-less inward primary gets no reminder
- **WHEN** the rules block is emitted for a single primary tracker whose direction includes
  `inward` but which names no `repo` or `projectKey`, with no secondary trackers
- **THEN** the reminder is absent, because no inward procedure was emitted for it to point at

### Requirement: The brief's tracker block is governed by direction
The SessionStart/PreCompact brief's `TRACKER SYNC` block SHALL emit its outward drift line
("not yet in <sys> — create issues + record keys") if and only if the primary tracker's direction
is `outward` or `both`, and its freshness line if and only if **an inward procedure is emittable**
for that tracker — the predicate defined in "An inward section is emitted only when the tracker
names what to read", not raw direction. A repo whose rules block contains no outward procedure MUST
NOT receive a brief demanding outward action, and a repo whose rules block contains no inward
procedure MUST NOT receive a brief presuming one was read.

#### Scenario: An inward tracker with unmirrored epics demands no outward action
- **WHEN** the brief is built for `{system: "github-issues", repo: "o/n", direction: "inward"}` in
  a repo with queued epics that have no `externalId`
- **THEN** the brief contains no "not yet in github-issues" line

#### Scenario: The same fixture set outward does demand it
- **WHEN** the brief is built for that identical fixture with `direction: "outward"`
- **THEN** the brief does contain the "not yet in github-issues — create issues + record keys"
  line naming those epics

### Requirement: The rules block and the brief agree about direction
For every combination of direction and tracker system, outward instruction in the rules block and
outward action demanded by the brief SHALL be present together or absent together. The same holds
for inward, where the shared definition is the emittable-inward-procedure predicate rather than raw
direction. No emitter may decide direction on its own; all of them MUST resolve it from one
definition — the rules block, the brief's `TRACKER SYNC` block, the brief's freshness line, the
sync nudge, the completion-sync reminder, and the instruction set `/pm:sync` follows all read the
same two resolved values (outward applies; an inward procedure is emittable) and none recomputes
either from `system`, `repo`, or `direction` locally.

#### Scenario: Emitter coherence across every direction and system
- **WHEN** the rules block and the brief are produced from the same state, for each direction in
  `inward`/`outward`/`both` crossed with a `github-issues` and a `jira` tracker
- **THEN** for each of the six cases, the rules block containing an outward procedure and the brief
  demanding outward action have the same truth value

#### Scenario: Coherence holds for the scope-less tracker too
- **WHEN** the rules block and the brief are produced from the same state for a tracker whose
  direction includes `inward` but which names no scope
- **THEN** the rules block containing an inward procedure, the brief emitting its freshness line,
  its sync nudge, its completion-sync reminder, and `/pm:sync` instructing any external read are
  all false together

### Requirement: The sync nudge is emitted only where an inward procedure exists
The brief's "N tracker(s) configured — consider `/pm:sync`" nudge SHALL be emitted only when at
least one configured tracker **has an emittable inward procedure** — the predicate defined in "An
inward section is emitted only when the tracker names what to read", which is what the requirement
title has always meant. An outward-only tracker cannot produce new inward items, and a scope-less
inward tracker names nothing to list; in both cases the rules block gives no inward procedure to
run, so the nudge instructs an action the repo has no instructions for. This is a deliberate,
user-visible behavior change for existing outward-only repos and MUST be recorded as one.

#### Scenario: An outward-only repo gets no sync nudge
- **WHEN** the brief is built for a repo whose only tracker resolves to `direction: "outward"`
- **THEN** the "consider `/pm:sync`" nudge is absent

#### Scenario: A repo with any inward tracker still gets the nudge
- **WHEN** the brief is built for a repo with a primary tracker of `direction: "outward"` and one
  secondary tracker
- **THEN** the nudge is present, because the secondary tracker's direction is `inward`

### Requirement: `/pm:sync`'s tracker instructions follow direction
What `/pm:sync` instructs the agent to do externally SHALL be determined by direction. Its inward
branch — pull new items in, and compare each linked item's tracker-side updated timestamp against
the epic's recorded watermark, reading the movers — SHALL be instructed only where **an inward
procedure is emittable** (the predicate defined in "An inward section is emitted only when the
tracker names what to read"), never on raw direction alone: a tracker that names no scope gives the
agent nothing to list against, which is the same unrunnable instruction "Every command pm emits
must run as written" forbids. Under `outward` it performs no external read at all — local
OpenSpec/Superpowers registration only. Under `both` it does both. The engine performs none of
this: it emits instruction and stores what the agent writes back.

#### Scenario: Sync in an outward-only repo touches nothing external
- **WHEN** the agent runs `/pm:sync` in a repo whose only tracker resolves to `outward`
- **THEN** the instructions it follows contain no step that reads or lists items from that tracker

#### Scenario: Sync in an inward repo pulls and re-reads
- **WHEN** the agent runs `/pm:sync` in a repo whose primary tracker is `inward`
- **THEN** the instructions direct it to list open items, register the unmirrored ones, compare
  each linked item's tracker-side updated timestamp against the epic's watermark, and read the
  items whose timestamp is newer

### Requirement: Tracker-linked epics carry a freshness watermark
An epic linked to an external item SHALL carry `externalUpdatedAt` — the **tracker's own**
updated timestamp as of the last time the agent read that item's content. It MUST NOT be a local
clock reading. It SHALL advance only when content (body, comments, labels, state) was actually
read; merely seeing the item in a list response MUST NOT advance it, or sync would erase the drift
it exists to detect. There is exactly one watermark **per epic**; a single tracker-wide watermark
is not sufficient, because it advances past items nobody read as soon as one item is handled. The
engine SHALL NOT fetch anything to obtain this value — it stores what the agent supplies.

The CLI flag that carries this value on an existing epic is a capability-introduced flag on an
epic-mutating command, so it SHALL be registered wherever `epic-annotation`'s "An epic-mutating
command never accepts a flag it discards" requires — that requirement owns the registration
contract and the bulk-path mirror, and this capability does not restate it. Today
`UPDATE_EPIC_FLAGS` is a literal array in `update-epic.mjs` and any flag missing from it exits
non-zero, so an unregistered watermark flag would make every scenario below fail at the CLI rather
than in the logic they test.

#### Scenario: Inward registration stamps the watermark
- **WHEN** the agent registers a new epic from an external item it just read, passing the item's
  updated timestamp
- **THEN** the epic's `externalUpdatedAt` reads back that value, and the epic does not count as
  never-re-read

#### Scenario: An existing epic's watermark can be updated after a plain re-read
- **WHEN** the agent re-reads a linked item during sync with no verdict to record and updates that
  epic with the item's updated timestamp
- **THEN** the command exits zero and the epic's `externalUpdatedAt` reads back that value

#### Scenario: Listing items does not advance the watermark
- **WHEN** `/pm:sync` lists open items to compute which have drifted, without reading their bodies
  or comments
- **THEN** no epic's `externalUpdatedAt` changes

#### Scenario: Bulk-created tracker-linked epics carry the same field
- **WHEN** epics are created in bulk from a batch in which an entry carries an external id and an
  external updated timestamp
- **THEN** the created epic carries `externalUpdatedAt`, identically to an epic created one at a
  time

### Requirement: The brief reports only locally computable freshness
The brief SHALL surface `N tracker-linked epics never re-read since mirroring` — epics that have
an external id and no watermark. This is the same freshness line that "The brief's tracker block is
governed by direction" gates, and it has exactly two conditions, both required: an inward procedure
must be emittable for the repo (the predicate defined in "An inward section is emitted only when
the tracker names what to read"), and the count must be greater than zero. It SHALL be omitted
entirely when either fails. The
brief MUST NOT claim how many linked items have newer remote activity: that number requires a
network call the engine is forbidden to make, so emitting it would be fabricated. The live drift
count belongs in `/pm:sync`'s own in-session output, reported by the agent that made the call.

#### Scenario: Never-re-read epics are counted
- **WHEN** the brief is built for an inward repo with three epics that have an external id and no
  watermark
- **THEN** the brief contains a line reporting three tracker-linked epics never re-read since
  mirroring

#### Scenario: The line disappears once every linked epic has been read
- **WHEN** every epic with an external id has a watermark
- **THEN** the line is absent from the brief

#### Scenario: The brief never asserts remote activity it cannot see
- **WHEN** the brief is built for any tracker configuration
- **THEN** it contains no claim about how many external items have changed since they were last
  read

### Requirement: A tracker-linked epic is re-read before specs are drawn, keyed on provenance
Before an epic becomes the active piece of work — the point at which specs or a plan are drawn for
it — its source of truth SHALL be re-read. The obligation keys on **provenance**, never on
direction: direction says where items are *born*, provenance says where an item's *truth lives*,
and in a `both` repo the two disagree routinely on the same day. An epic with an external id owes
a re-read of the linked external item (body, comments, labels, state); an epic with no external id
owes a re-read of its local source — its plan document, or its OpenSpec proposal and tasks — as
instruction only, with nothing recorded in state. The obligation SHALL be set at the activation
transition, not derived from current state, and MUST be set identically no matter which command
performed the activation, including bulk creation.

**Every path that can leave an epic at `active` SHALL route through the single activation
transition rather than reimplementing it.** The enumerated paths are `set-active`, `update-epic
--status active`, `add-epic` creating an epic at active status, and `add-many` bulk creation.
`add-many` today constructs epic objects directly and never calls that transition, so a batch entry
at `active` status sets neither the top-level `.active` pointer nor the demotion of any other epic
still at `active` — the single-active-epic invariant and the refresh obligation are both silently
skipped. Binding the obligation to one creation path and not its sibling is precisely the
absent-edit defect class this release exists to close, so the rule SHALL be enforced at the shared
transition rather than repeated at each call site. Origin governs only *whose ask wins when the
external item and a local spec disagree* — guidance for the agent, not a recorded field: nothing in
state distinguishes an inward-born external id from an outward-mirrored one, and the obligation to
look does not depend on it.

#### Scenario: Activating a tracker-linked epic owes a re-read
- **WHEN** an epic carrying an external id becomes active
- **THEN** it is marked as owing a tracker refresh, and the brief and the rendered project record
  both show that debt so a compacted session re-learns it

#### Scenario: Activating an epic with no external origin owes no tracker refresh
- **WHEN** an epic with no external id becomes active
- **THEN** no tracker refresh is owed, and the instruction it receives is to re-read its local plan
  or OpenSpec source instead

#### Scenario: An epic created from an item just read does not immediately owe a re-read
- **WHEN** an epic is created active in the same command that read the external item
- **THEN** no tracker refresh is owed

#### Scenario: Every activation path sets the obligation identically
- **WHEN** a tracker-linked epic is made active by setting the active pointer, by updating its
  status, by creating it active, or as part of a bulk batch
- **THEN** all four paths produce the same refresh obligation and the same single-active-epic
  invariant

#### Scenario: Bulk creation goes through the same activation path
- **WHEN** epics are created in bulk from a batch containing an entry at active status carrying an
  external id
- **THEN** that epic becomes the single active epic and owes a tracker refresh, identically to an
  epic activated by any other command — bulk creation today sets neither, because it builds epics
  without passing through the activation transition at all

#### Scenario: A both-direction repo treats two differently-born epics the same way
- **WHEN** a repo with `direction: "both"` activates an epic mirrored inward from a third party's
  issue, and separately an epic born from a local OpenSpec proposal and mirrored outward
- **THEN** both owe a re-read of their linked item, because a linked item accumulates third-party
  context regardless of which way it was born, and nothing in state records which way that was —
  direction never decides the obligation, only the presence of an external id does

### Requirement: Recording a refresh verdict advances the watermark
Recording the outcome of a tracker refresh SHALL require both a verdict (the item is unchanged, or
it changed materially) and the item's tracker-side updated timestamp, so a verdict can never be
recorded without advancing the watermark. It SHALL persist the verdict, any summary, when it was
recorded, and the watermark, and SHALL clear the epic's outstanding refresh obligation.

#### Scenario: A material-change verdict is recorded
- **WHEN** the agent records a `material-change` verdict with a summary and the item's updated
  timestamp
- **THEN** the epic carries the verdict, the summary, the time it was recorded and the watermark;
  `externalUpdatedAt` advances; and the refresh obligation is cleared

#### Scenario: A verdict without a watermark is refused
- **WHEN** the agent records a verdict without supplying the item's updated timestamp
- **THEN** the command exits non-zero and nothing is written

#### Scenario: A verdict on an epic with no external origin is refused
- **WHEN** the agent records a tracker refresh verdict for an epic that has no external id
- **THEN** the command exits non-zero and nothing is written

### Requirement: Mechanical enforcement of the refresh gate is opt-out
The mechanical pre-tool block for an outstanding tracker refresh SHALL respect the repo's
gate-guard setting, so an agent that is offline, unauthenticated, or facing a deleted upstream
item can proceed honestly rather than recording a blind "unchanged". Turning the guard off MUST
NOT weaken the unconditional reconcile block.

#### Scenario: The refresh block honors the guard setting
- **WHEN** the active epic owes a tracker refresh and the repo's gate guard is on
- **THEN** the guard blocks; with the guard off, it does not block

#### Scenario: Turning the guard off does not bypass reconcile
- **WHEN** the active epic needs reconciliation
- **THEN** the guard blocks whether the gate-guard setting is on or off

### Requirement: Every command pm emits must run as written
Any command line the conductor emits into a rules block, a brief, or a command document SHALL
execute successfully as written, with only the documented placeholders substituted. The inward
registration recipe currently emitted omits a required argument and fails on every invocation; two
independent sessions hit it the same afternoon and each silently invented a substitute. Where the
recipe registers an epic from an external item, the epic's id SHALL be determined by the recipe
itself rather than left to the agent's invention, and the same external item SHALL produce the
same id across repos and sessions.

#### Scenario: The emitted registration recipe executes verbatim
- **WHEN** the inward registration command emitted in the rules block is run with only its
  placeholders filled in from a real external item
- **THEN** it exits zero and the epic exists

#### Scenario: The same issue yields the same epic id twice
- **WHEN** the emitted recipe is followed for the same external item in two different sessions
- **THEN** both produce the same epic id, and the second is refused as a duplicate rather than
  creating a second epic under a different invented id

### Requirement: Lane at mirror time comes from lane routing
The emitted inward registration recipe SHALL derive a mirrored item's lane from the repo's lane
routing rather than a fixed `claude-code`, and SHALL allow the agent to override the suggestion
with a stated reason. The lane determines whether the work leaves any spec, plan, or gate record,
so a hardcoded lane silently decides that for every mirrored item.

**Scope boundary — this requirement ships one half of #114 and deliberately defers the other.**
What ships is the *call-site* half: the mirror-time recipe stops hardcoding `--lane claude-code`
and asks lane routing instead, so mirrored items are routed by the same mechanism as every other
epic. What does NOT ship is the issue's primary complaint — that lane routing weighs only the
wording of the ask, with no product, milestone, or release context to weigh against it. Improving
the *quality* of the routing decision requires a product/milestone layer that does not exist in
`pm` today; specifying it here would be specifying against a substrate this release does not build.
That half SHALL remain open on #114 after this change archives, and no requirement in this
capability may be read as delivering it.

#### Scenario: A mirrored item is routed, not hardcoded
- **WHEN** the rules block emits the inward registration recipe
- **THEN** the recipe instructs the agent to take the lane from lane routing for that item's title
  and description, not from a fixed value

#### Scenario: The agent may override the suggested lane
- **WHEN** the routed lane is wrong for a particular item
- **THEN** the recipe permits registering it in a different lane, with the reason recorded on the
  epic

## MODIFIED Requirements

### Requirement: Primary tracker configuration
`set-tracker` with `--role primary` (the default when `--role` is omitted) SHALL write/merge
`state.tracker`, preserving every field not named on the command line, and MUST NOT write to
`state.secondaryTrackers`. Which sync sections the repo receives SHALL be determined by the
tracker's `direction`, never by its `system` name. The vendor test that previously decided this
encoded one repo's convention as a property of a vendor, and it was applied at one emitter and not
the other. "Full bidirectional mirror" is likewise dropped as a description of the non-GitHub
primary path: the two behaviors it named — create the issue, transition the issue — are both
outward, and no non-`github-issues` primary has ever received an inward pull instruction.

#### Scenario: Setting a tracker without --role
- **WHEN** the agent runs `set-tracker --system jira --instance onvex --project JOB --mechanism
  mcp --intent active:in-progress`
- **THEN** `state.tracker` is written/merged with those fields, `state.secondaryTrackers` is
  untouched, and the rules block gains the sync sections its resolved `direction` calls for — for
  a newly registered tracker, the inward section and no outward section

#### Scenario: Re-running set-tracker for the primary merges, not replaces
- **WHEN** the agent runs `set-tracker --intent paused:todo` after a primary tracker already
  exists
- **THEN** only the `statusIntent` map gains the new entry; every other existing field on
  `state.tracker` is preserved unchanged, and no `direction` is stamped onto a tracker that did
  not have one

#### Scenario: github-issues as primary keeps its existing inward-only special case
- **WHEN** `state.tracker.system === "github-issues"` with no `direction` recorded
- **THEN** it resolves to `inward`: the outward "External tracker sync" section stays suppressed
  and only the pull-only inward instructions are emitted, exactly as before this change — but that
  outcome now follows from the resolved direction, not from the system name, so the same tracker
  set to `direction: "outward"` DOES receive the outward section

#### Scenario: A non-github primary can be inward
- **WHEN** `state.tracker` is `{system: "jira", projectKey: "JOB", direction: "inward"}`
- **THEN** the repo receives an inward sync section naming `jira` and no outward section

### Requirement: Secondary tracker inward pull
Open issues in a secondary tracker SHALL be pulled in as untriaged epics. Deduplication SHALL
match on `externalUrl` (globally unique across every system and repo) when both the incoming
issue and an existing epic have one; MUST NOT match on bare `externalId` alone whenever a URL is
available on both sides, since issue numbers are only unique within one tracker/repo, not
globally. The registration command the rules block emits for this pull SHALL execute as written
and SHALL take the epic's lane from lane routing rather than a hardcoded `claude-code`.

#### Scenario: Open secondary-tracker issue becomes an untriaged epic
- **WHEN** the agent runs the sync step for a secondary tracker and finds an open issue whose URL
  does not match any existing epic's `externalUrl`
- **THEN** the agent registers a new untriaged epic using the emitted recipe verbatim — which
  exits zero, titles the epic from the issue title, records the issue's number and URL and its
  updated timestamp, takes its priority from a `P0`/`P1`/`P2`/`P3` label when present and `P2`
  otherwise, and takes its lane from lane routing

#### Scenario: Re-running sync does not duplicate an already-mirrored issue
- **WHEN** the agent re-runs the secondary-tracker sync step and an epic with that issue's
  `externalUrl` already exists
- **THEN** no new epic is created for that issue

#### Scenario: Issue #42 in two different secondary-tracker repos does not collide
- **WHEN** two secondary trackers (`acme/market-intelligence` and `acme/risk-engine`, both
  `system: "github-issues"`) each have an open issue numbered `#42`
- **THEN** syncing both trackers registers two distinct epics — `externalId` alone is not used to
  detect a false duplicate, because `externalUrl` differs between them
