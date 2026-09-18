# tracker-sync Specification

## Purpose

Defines how the `pm` conductor mirrors epics to external issue trackers: exactly one **primary**
tracker plus zero or more **secondary** trackers.

**Direction is explicit configuration, never inferred from the tracker's vendor.** Every tracker
entry carries a `direction` — `inward`, `outward`, or `both` — and that recorded value is what
every emitter reads to decide which sections it produces. A **primary** tracker may hold any of
the three, and a newly registered primary with no `--direction` defaults to `inward`; a
**secondary** tracker is pinned to `inward` (pull + completion status writeback, never outward
creation). A tracker with no recorded `direction` keeps its prior behavior.

The engine itself never calls a tracker — it only shapes instructions the interactive agent acts
on with its own tooling.

## Requirements

### Requirement: Primary tracker configuration
`set-tracker` with `--role primary` (the default when `--role` is omitted) SHALL write/merge
`state.tracker`, preserving every field not named on the command line, and MUST NOT write to
`state.secondaryTrackers`. Which sync sections the repo receives SHALL be determined by the
tracker's `direction`, never by its `system` name. The vendor test that previously decided this
encoded one repo's convention as a property of a vendor, and it was applied at one emitter and not
the other. "Full bidirectional mirror" is likewise dropped as a description of the non-GitHub
primary path: the two behaviors it named — create the issue, transition the issue — are both
outward, and no non-`github-issues` primary has ever received an inward pull instruction.

**One exception to the merge: scope does not survive a change of system.** When `--system` names a
system different from the one recorded, the recorded scope fields (`repo`, `projectKey`,
`instance`) that the same command does not supply SHALL be dropped, and the command's output SHALL
name each field it dropped. A scope belongs to the tracker it was recorded for; carried across a
vendor switch it becomes the new tracker's scope, and every emitted heading, listing step and
derived id then names the old tracker.

**A change of system SHALL NOT change the direction the repo resolves to unless the command says
so.** A primary with no recorded `direction` resolves by system (`github-issues` inward, any other
outward), so switching the system alone would silently turn outward creation on or off. When the
command changes the system and supplies no `--direction`, it SHALL record the direction the tracker
resolved to BEFORE the switch, and its output SHALL name the direction recorded and why. An
explicitly recorded direction is kept unchanged.

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

#### Scenario: Switching vendor drops the old scope
- **WHEN** a github-issues primary recorded with `repo: "o/n"` is changed with `set-tracker
  --system jira --project ABC`
- **THEN** `state.tracker` carries no `repo`, the output names `repo` as dropped, and the emitted
  inward section and derived id name `ABC` (today they name `o/n`)

#### Scenario: Switching vendor does not turn on outward creation
- **WHEN** a github-issues primary with no recorded direction is changed with `set-tracker --system
  jira --project ABC`
- **THEN** `state.tracker.direction` is `inward`, the output names it as kept from the prior tracker,
  and the rules block carries no outward "External tracker sync" section (today the switch resolves
  `outward` and emits it)

#### Scenario: Re-stating the same system keeps its scope
- **WHEN** `set-tracker --system jira --direction both` runs against a jira primary with
  `projectKey: "ABC"`
- **THEN** `projectKey` is preserved

### Requirement: Secondary tracker registration
`set-tracker --role secondary` SHALL upsert an entry into `state.secondaryTrackers`, keyed by a
namespace-prefixed key (`system + ":repo:" + repo`, or `system + ":project:" + projectKey` when
no `repo` is given), and MUST NOT write to `state.tracker`.

#### Scenario: Adding a secondary tracker
- **WHEN** the agent runs `set-tracker --system github-issues --repo acme/market-intelligence
  --role secondary`
- **THEN** a new entry `{ system: "github-issues", repo: "acme/market-intelligence", role:
  "secondary" }` is appended to `state.secondaryTrackers`, and `state.tracker` is unchanged

#### Scenario: Re-adding the same secondary tracker merges in place
- **WHEN** the agent runs `set-tracker --role secondary` a second time with the same `system` and
  `repo` as an existing secondary entry
- **THEN** the existing entry is updated in place (only the passed flags change) and no duplicate
  entry is created

#### Scenario: Multiple distinct secondary trackers coexist
- **WHEN** the agent registers two secondary trackers with different `repo` values (e.g.
  `acme/market-intelligence` and `acme/risk-engine`), both under `system: "github-issues"`
- **THEN** both entries persist independently in `state.secondaryTrackers`

#### Scenario: A repo-keyed and a projectKey-keyed entry with the same string value do not collide
- **WHEN** the agent registers a secondary entry `{ system: "jira", projectKey: "ABC" }` and
  separately a secondary entry `{ system: "jira", repo: "ABC" }`
- **THEN** both entries persist independently in `state.secondaryTrackers` (namespace-prefixed
  keys `jira:project:ABC` and `jira:repo:ABC` do not collide)

### Requirement: Secondary trackers never receive outward-created issues
No local epic creation or status change SHALL cause the agent to create or transition an issue in
a secondary tracker. Outward mirroring MUST remain exclusive to the primary tracker.

#### Scenario: New local epic does not touch a secondary tracker
- **WHEN** a new epic is added via `add-epic` in a repo that has a secondary tracker configured
- **THEN** the rules block's instructions for that secondary tracker contain no outward
  issue-creation step, regardless of the epic's lane or status

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

### Requirement: Secondary tracker completion status writeback
When an epic whose `externalUrl` matches a secondary tracker's `repo` (or `instance`+
`projectKey` for non-GitHub systems) reaches a terminal status, the agent SHALL close/transition
the corresponding issue in that secondary tracker. No new epic-level field records tracker
origin — matching is done by inspecting the epic's existing `externalUrl` against each configured
secondary tracker's `repo`/`instance`+`projectKey` at instruction time.

#### Scenario: Archiving an epic linked to a secondary tracker's issue
- **WHEN** an epic with an `externalUrl` matching a configured secondary tracker's `repo`
  transitions to `status: "archived"`
- **THEN** the rules block instructs the agent to close/transition the linked issue in that
  secondary tracker, checking its current state first so a re-run does not error on an
  already-closed issue

#### Scenario: Archiving an epic linked to the primary tracker is unaffected
- **WHEN** an epic with an `externalId`/`externalUrl` sourced from the primary tracker transitions
  to `status: "archived"`
- **THEN** the existing primary `statusIntent`-driven transition instructions apply, unchanged by
  this capability

### Requirement: Removing a secondary tracker
A secondary tracker entry SHALL be removable, explicitly and individually, without affecting the
primary tracker or other secondary entries.

#### Scenario: Removing a stale secondary tracker
- **WHEN** the agent runs `set-tracker --role secondary --system github-issues --repo
  acme/decommissioned-repo --remove`
- **THEN** the matching entry is deleted from `state.secondaryTrackers`, and both `state.tracker`
  and any other secondary entries are unaffected

#### Scenario: Removing a secondary tracker that doesn't exist
- **WHEN** the agent runs `set-tracker --role secondary --system github-issues --repo
  acme/never-registered --remove`
- **THEN** the command exits non-zero with a clear "no matching secondary tracker" message, and
  `state.secondaryTrackers` is left unchanged

### Requirement: Backward compatibility with pre-existing state
A `state.json` written before this change (no `secondaryTrackers` field) SHALL remain fully valid
and MUST NOT require any data migration.

#### Scenario: Loading a state.json without secondaryTrackers
- **WHEN** the engine reads a `state.json` that has `tracker` but no `secondaryTrackers` field
- **THEN** it is treated as zero secondary trackers configured, and every existing primary-tracker
  behavior functions exactly as before this change

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
secondary tracker SHALL be pinned to `inward`; any other value is rejected, because this
capability's "Secondary tracker inward pull" requirement already defines the secondary role as
pull-only — open issues come in as untriaged epics, and no outward creation is specified for it.

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
this engine version for weeks before its state is upgraded. Exactly **two** deliberate behavior
changes are permitted for that tracker shape, both repairs of instructions that pointed at steps
nothing emitted. They live on **different surfaces**: the completion-sync reminder is in the rules
block (see "The completion-sync reminder is emitted only where an inward procedure exists"), and
the sync nudge is in the brief (see "The sync nudge is emitted only where an inward procedure
exists"). So the rules-block byte-identity claimed in the scenarios below is affected by the first
and not the second. Both are named here so an implementer diffing against the previous engine's
output knows exactly which lines are expected to differ, and treats any third as a regression.

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
  present, exactly as before this change

#### Scenario: That path changes in exactly one way, and it is a repair
- **WHEN** the same scope-less `github-issues` rules block is compared against the one the previous
  engine version emitted
- **THEN** the only difference is the removal of the "Sync after completing tracker-linked work"
  reminder, which the previous version emitted for **any** `github-issues` primary regardless of
  scope, and which referred the agent to "the writeback steps above" that the same block never
  emitted — a dangling instruction, removed by "The completion-sync reminder is emitted only where
  an inward procedure exists"

> Byte-identity is claimed for the two **sync sections** on this path, not for the whole block. The
> reminder's removal is a second deliberate change and is named here rather than left to be
> discovered as a diff, because a spec that claims byte-identity while a sibling requirement
> removes a line is a contradiction an implementer resolves silently and by call order.

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

#### Scenario: An inward-only github-issues primary is not pointed at absent steps
- **WHEN** the rules block is emitted for `{system: "github-issues", repo: "o/n", direction: "inward"}`
  with no secondary trackers
- **THEN** the reminder's text contains no reference to writeback steps above it, because the block
  emits none (today it says "the writeback steps above")

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
epic-mutating command, so it SHALL be registered in the shared allowlist and mirrored onto the
bulk-creation path exactly as `epic-annotation`'s "One shared flag allowlist, grown by every
capability that adds a flag" requires — that requirement owns the registration contract and the
bulk-path mirror, and this capability does not restate it. `epic-annotation`'s "Every epic-writing
surface rejects what it will not persist" is what makes an omission a hard failure rather than a
silent discard. Today
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
an external id, no watermark, and a **non-terminal status**. An epic whose status is `archived`
SHALL NOT be counted, whatever its outcome: the archive disposition discharges the refresh
obligation outright, because the obligation is to re-read the linked item *before the epic becomes
the work* and work that ended never becomes the work again. No terminal watermark is recorded or
required. The engine SHALL NOT consider whether the linked ITEM is closed — that requires
integration it is forbidden to make — so the closed half belongs to the inward-sync procedure,
which already reads the open list and proposes a disposition for an epic whose item is no longer
open; that disposition is what clears the count. This is the same freshness line that "The brief's
tracker block is governed by direction" gates, and it has exactly two emission conditions, both
required: an inward procedure must be emittable for the repo (the predicate defined in "An inward
section is emitted only when the tracker names what to read"), and the count must be greater than
zero. It SHALL be omitted entirely when either fails. The
brief MUST NOT claim how many linked items have newer remote activity: that number requires a
network call the engine is forbidden to make, so emitting it would be fabricated. The live drift
count belongs in `/pm:sync`'s own in-session output, reported by the agent that made the call.

The line SHALL name a remedy that, followed, clears the count for EVERY epic it counts — including an
epic linked through an outward-only primary while a secondary makes the repo inward, whose link no
inward procedure reads. Naming only `/pm:sync` there sends the agent to a procedure that never
touches that epic.

#### Scenario: Never-re-read epics are counted
- **WHEN** the brief is built for an inward repo with three epics that have an external id and no
  watermark
- **THEN** the brief contains a line reporting three tracker-linked epics never re-read since
  mirroring

#### Scenario: The line disappears once every linked epic has been read
- **WHEN** every epic with an external id has a watermark
- **THEN** the line is absent from the brief

#### Scenario: An epic that has ended is not counted
- **WHEN** the brief is built for an inward repo holding both non-terminal and `archived` epics,
  every one of them carrying an external id and no watermark
- **THEN** the line reports only the non-terminal ones, and archiving a counted epic lowers the
  count by exactly one without any watermark being recorded

#### Scenario: The line vanishes when every linked epic has ended
- **WHEN** every epic with an external id and no watermark is `archived`
- **THEN** the line is absent from the brief

#### Scenario: The brief never asserts remote activity it cannot see
- **WHEN** the brief is built for any tracker configuration
- **THEN** it contains no claim about how many external items have changed since they were last
  read

#### Scenario: An outward-recorded key starts with a watermark
- **WHEN** the rules block is emitted for a primary whose direction includes `outward`
- **THEN** its line for recording a newly created issue's key carries `--external-updated-at` with the
  created issue's own timestamp, and an epic recorded that way is not counted never-re-read (today
  the line carries no watermark)

#### Scenario: The brief's create-and-record remedy starts with a watermark
- **WHEN** the brief reports active epics not yet in an outward primary whose direction is `both`, and
  the agent records each key with the invocation that line names, filled
- **THEN** that invocation carries `--external-updated-at`, and the recorded epic is not counted
  never-re-read (before Gate 2 E-I1 the brief's form omitted it, so following it raised that count)

#### Scenario: The named remedy clears an outward-linked epic
- **WHEN** the brief counts an epic linked through an outward-only primary in a repo whose only
  inward procedure is a secondary's, and the agent follows the remedy the line names for it
- **THEN** that epic is no longer counted (today the line names only `/pm:sync`, whose procedure
  never reads that epic)

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

The refresh block SHALL cover a Bash call on the same terms as the reconcile block: a command
matching a recognized write shape is blocked, anything else passes, and a payload that does not
identify its tool — or that names `Bash` while carrying no readable command text — takes the
blocking path. This arm keeps the inverse the requirement already
names — `set-gate-guard off` silences it, Bash included — and that asymmetry with the reconcile
block is deliberate: the reconcile block ships no inverse because a switch that silenced Bash
writes there would bypass the whole gate, while here the escape hatch is the point.

#### Scenario: The refresh block honors the guard setting
- **WHEN** the active epic owes a tracker refresh and the repo's gate guard is on
- **THEN** the guard blocks; with the guard off, it does not block

#### Scenario: Turning the guard off does not bypass reconcile
- **WHEN** the active epic needs reconciliation
- **THEN** the guard blocks whether the gate-guard setting is on or off

#### Scenario: A Bash write is blocked by the refresh gate only while the guard is on
- **WHEN** the active epic owes a tracker refresh, the guard is on, and the hook is invoked with a
  payload naming tool `Bash` and a command matching a recognized write shape
- **THEN** it exits 2; and with the guard off the same invocation exits 0

#### Scenario: A read-only Bash command is never blocked by the refresh gate
- **WHEN** the active epic owes a tracker refresh, the guard is on, and the hook is invoked with a
  payload naming tool `Bash` and a command matching no recognized write shape
- **THEN** it exits 0 and prints nothing

### Requirement: Every command pm emits must run as written
Any command line the conductor emits into a rules block, a brief, or a command document SHALL
execute successfully as written, with only the documented placeholders substituted. The inward
registration recipe currently emitted omits a required argument and fails on every invocation; two
independent sessions hit it the same afternoon and each silently invented a substitute. Where the
recipe registers an epic from an external item, the epic's id SHALL be determined by the recipe
itself rather than left to the agent's invention, and the same external item SHALL produce the
same id across repos and sessions.

This binds EVERY emitted inward procedure — the primary's and each secondary's, for every tracker
system — and not only the github-issues primary the suite used to execute. In particular:

- The listing step SHALL fetch every field a later step of the same procedure consumes. A recipe
  that asks for an item's updated timestamp after a listing step that never requested it cannot be
  filled from what the procedure fetched.
- The listing step SHALL NOT be silently truncated. Where the listing tool pages or caps its result,
  the emitted step SHALL name an explicit bound, and the procedure SHALL stop before its closed-item
  step when the listing may have been truncated — an item missing from a truncated list is not an
  item that closed.
- The derived epic id SHALL be a valid epic id for the item keys the tracker actually uses, including
  keys that are not bare numbers (`ABC-123`), and distinct keys SHALL derive distinct ids.
- A recorded tracker value SHALL NOT be interpolated into an emitted shell command unless it has a
  shape that cannot alter that command.
- A placeholder the agent fills from the external ITEM (its title, its url) is third-party text. The
  procedure SHALL instruct the agent to shell-quote every such value when filling it, and SHALL say
  how, so that a title carrying `"`, `$(…)`, a backtick or an apostrophe is stored exactly and
  executes nothing. Quoting does not change the token the engine receives, so every item-sourced
  value SHALL also be placed where the engine reads it as a value whatever its shape: a title that
  begins with `-` or is shaped like a flag (`--limit=5 ignored`), or that holds a newline, SHALL
  register and route exactly as any other title. `suggest-lane` SHALL therefore accept its text as
  the value of a declared flag (`--ask=<text>`) as well as positionally, and the emitted lane-routing
  step SHALL use the flag form.
- The procedure SHALL name only commands that exist.

#### Scenario: The emitted registration recipe executes verbatim
- **WHEN** the inward registration command emitted in the rules block is run with only its
  placeholders filled in from a real external item
- **THEN** it exits zero and the epic exists

#### Scenario: The same issue yields the same epic id twice
- **WHEN** the emitted recipe is followed for the same external item in two different sessions
- **THEN** both produce the same epic id, and the second is refused as a duplicate rather than
  creating a second epic under a different invented id

#### Scenario: A secondary's recipe can be filled from its own listing
- **WHEN** the rules block is emitted for a github-issues secondary tracker
- **THEN** its listing step requests the updated timestamp that its registration line consumes
  (today it requests `number,title,url,labels` only)

#### Scenario: A non-numeric item key registers
- **WHEN** the registration recipe emitted for an inward jira tracker scoped to `ABC` is filled from
  the items `ABC-123` and `ABC-124`
- **THEN** both invocations exit zero and create two distinct epics (today the id is refused)

#### Scenario: The listing is bounded and a truncated list ends nothing
- **WHEN** the rules block is emitted for an inward github-issues tracker
- **THEN** its listing step names an explicit result bound, and the procedure instructs the agent
  not to run the closed-item step when the number of items returned reaches that bound

#### Scenario: A repository value cannot alter the emitted command
- **WHEN** the recorded github-issues repository is not an `[HOST/]owner/name` value
- **THEN** no emitted shell command contains that value

#### Scenario: A hostile or ordinary item title is stored exactly
- **WHEN** the registration line of any emitted inward section is filled, following the section's
  own quoting instruction, from an item titled ``it's "done" $(touch pwned) `id` `` and run through a
  shell
- **THEN** it exits zero, the epic's title reads back byte-identical to the item title, and no
  `pwned` file exists (today the recipe wraps the title in double quotes and gives no instruction)

#### Scenario: A flag-shaped, dash-leading or multi-line title registers and routes
- **WHEN** the registration line and the lane-routing step of any emitted inward section are filled,
  following the section's own quoting instruction, from items titled `--limit=5 ignored`, `-h`,
  `--help`, `-x starts with a dash` and a title holding a newline, and run through a shell
- **THEN** each lane-routing call and each registration exits zero and each epic's title reads back
  byte-identical (today `--title '--limit=5 ignored'` is refused as an unknown flag, and
  `suggest-lane '--foo'` is refused telling the agent to quote a value it already quoted)

#### Scenario: suggest-lane reads its text from --ask and still positionally
- **WHEN** `suggest-lane --ask='--limit=5 ignored'` runs, and separately `suggest-lane "fix a typo"`
- **THEN** both exit zero, the first routing on the text `--limit=5 ignored` (today `--ask` is refused
  as an undeclared flag) and the second behaving exactly as today

#### Scenario: The dedup step names no absent command
- **WHEN** any inward section is emitted
- **THEN** it names no `/pm:` command form that pm does not ship (today it names `/pm:epic list`) —
  asserted against the rules block directly, because a shipped-command existence check reads only
  the name `epic`, which exists

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

### Requirement: A secondary tracker's inward pull re-reads what is already linked
Every emitted secondary inward procedure SHALL carry the same watermark step the primary's carries:
for each epic already linked to an item in that tracker, compare the item's updated timestamp with
the epic's watermark, read the items that are newer, and record what was read — never advancing a
watermark from the listing alone.

#### Scenario: The secondary section has a watermark step
- **WHEN** the rules block is emitted with a secondary tracker
- **THEN** its section instructs comparing each linked item's updated timestamp with the epic's
  watermark and recording what was read, and states that listing alone never advances it (today the
  section has no such step)

### Requirement: A github-issues repository is recorded as an owner/name pair
`set-tracker` SHALL refuse, for either role, a `--repo` on a `github-issues` tracker that is not an
`owner/name` pair of characters GitHub permits in those names — optionally prefixed by a GitHub
Enterprise `HOST/`, the form `gh issue list -R` accepts — exiting non-zero and writing nothing.
`--remove` on the secondary role is exempt: it matches the recorded value exactly and writes nothing
new, so a legacy malformed entry stays removable. `--remove` on the primary role is NOT exempt — the
primary has no remove, so the value would otherwise be recorded.
A value recorded before this rule that does not have that shape SHALL NOT fail any read; emitters
treat it as absent for the purpose of building a shell command, and `integrity` SHALL name it with
the `set-tracker` re-record that restores its listing step, so the lost step is never silent. For a
secondary, `integrity` names its removal first, carrying the recorded value as one shell-quoted word
in inline `--repo=<quoted>` form (a value holding a control character: named without the value, per
`output-text-integrity`).

#### Scenario: A repository carrying a shell metacharacter is refused
- **WHEN** the agent runs `set-tracker --system github-issues --repo 'a/b; touch pwned'`
- **THEN** it exits non-zero naming the expected shape, and `state.json` is byte-identical (today it
  is accepted)

#### Scenario: A malformed repository is refused on the primary even with --remove
- **WHEN** a github-issues primary records `o/n`, and the agent runs
  `set-tracker --repo 'a/b; touch pwned' --remove`
- **THEN** it exits non-zero naming the expected shape, and `state.json` is byte-identical (before
  this rule's correction the value was saved and rendered into the rules block)

#### Scenario: A legacy malformed secondary is removable
- **WHEN** a state file carries a github-issues secondary whose `repo` is `a/b; touch pwned`, and the
  agent runs `set-tracker --role secondary --system github-issues --repo 'a/b; touch pwned' --remove`
- **THEN** it exits zero and the entry is gone

#### Scenario: A legacy malformed repository still loads
- **WHEN** a state file recorded before this rule carries such a repository
- **THEN** every read verb succeeds, and the value never appears unquoted in any output: the only
  emitted command carrying it is `integrity`'s removal of a secondary, where it is one shell-quoted word
  in inline `--repo=<quoted>` form, so a shell expands nothing in it and a flag-shaped value (`--help`)
  is read as data (Gate 2 X-B2, R-M1) (a value holding a control character: named without the value, per
  `output-text-integrity`); everywhere else it is JSON-quoted data or absent

#### Scenario: A GitHub Enterprise repository is accepted
- **WHEN** the agent runs `set-tracker --system github-issues --repo ghe.example.com/o/n`, for either role
- **THEN** it exits zero, and the emitted listing step names `--repo ghe.example.com/o/n` (before Gate 2
  E-I2 it was refused)

#### Scenario: A legacy malformed repository is named, with the re-record that restores it
- **WHEN** a state file carries a github-issues primary or secondary whose `repo` fails the shape, and
  `integrity` runs
- **THEN** it reports that tracker as receiving no `gh` listing step, and the commands it names, filled
  and run in order, clear the finding and restore the step (before Gate 2 E-I2 the step was dropped
  with no notice anywhere)

### Requirement: The brief's mirror line claims only what it checked
The brief's outward mirror line SHALL state only what the engine verified. An epic's carrying an
external id does not show it is mirrored to the PRIMARY tracker when a secondary tracker is
configured, because a secondary-linked epic carries one too; the line MUST NOT say every active epic
is mirrored to the primary on that evidence.

#### Scenario: A secondary-linked active epic is not claimed for the primary
- **WHEN** the brief is built for an outward jira primary and a github-issues secondary, and the only
  active epic is linked to a github-issues item
- **THEN** the brief does not state that all active epics are mirrored to jira (today it does)
