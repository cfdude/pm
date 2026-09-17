## MODIFIED Requirements

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

## ADDED Requirements

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
the `set-tracker` re-record that restores its listing step, so the lost step is never silent.

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
- **THEN** every read verb succeeds, and no emitted shell command contains the value

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
