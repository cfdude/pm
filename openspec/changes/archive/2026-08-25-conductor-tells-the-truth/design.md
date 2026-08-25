## Context

Motivation is in `proposal.md` and the evidence is in
`docs/measurement/2026-08-23-delivery-audit.md`. This section records only the current state of the
code and the constraints the design has to hold inside.

**Engine shape.** `scripts/lib/` is a zero-dependency Node 18+ module set with a one-directional
import discipline — `constants.mjs` is the leaf ("No dependencies on any other lib module — every
other module may import from here", `constants.mjs:2-3`); `epic-progress.mjs` imports only
`constants.mjs`. pm is an INSTRUCTION layer: no module opens a network connection, and the one
sanctioned mechanical enforcement is the local `PreToolUse` gate-guard hook.

**What is true of the record today, measured on this repository (`.conductor/state.json`,
revision 28, `pmVersion 0.26.0`):**

| Quantity | Value |
|---|---|
| Epics | 133 |
| Archived epics | 68 — `claude-code` 51, `superpowers` 7, `decision` 7, **`openspec` 3** |
| Archived with a passing Gate 2 | 3 — and they are exactly the 3 openspec-lane archived epics |
| Ids registered twice after stripping a `<YYYY-MM-DD>-` prefix | 4 pairs; **0** collide literally |
| Directories under `openspec/changes/archive/` | 1 |
| Tracker | `{system: "github-issues", repo: "cfdude/pm"}`, no `direction`, no secondaries |

The last row matters twice: this repo's own archive backfill registers approximately nothing, so the
backfill's blast radius is in the other seven audited repos, not here. The 68/3 split is what forces
the migration to stamp every lane (§ Migration Plan).

**The seams this change has to cut through, verified in source:**

| Seam | Today |
|---|---|
| `reconcileArchived()` — the archive-drift heal | Flips status with no lane check, no gate check, no disposition. Four callers: `migrations.mjs:66`, `render.mjs:30`/`:34`, `subcommands.mjs:200`/`:204` (commit nudge), `subcommands.mjs:252` (sync) |
| `UPDATE_EPIC_FLAGS` | A literal 11-element array at `update-epic.mjs:15`; an unlisted flag exits 1 (`:29-34`) |
| `add-epic` | **No** allowlist at all — `parseFlags` reads named flags and drops the rest, so `--notes "x"` parses, exits 0, writes nothing (issue #79) |
| `add-many` | Copies a fixed key set (`add-many.mjs:61-70`) and pushes straight onto `state.epics` (`:71`) — silently dropping every other key, and never calling `activate()` |
| `activate()` | `active-pointer.mjs:13-23`; three callers (`active-pointer.mjs:55`, `update-epic.mjs:136`, `add-epic.mjs:222`) — `add-many` is the fourth door and does not use it |
| openspec-lane membership | Strict `=== "openspec"` at `update-epic.mjs:106`, `epic-progress.mjs:193`, `gate-review-writeback.mjs:37`; normalizing `(lane \|\| "openspec")` at `epic-progress.mjs:147`, `:168`, `:174` |
| Gate verdict | `{verdict, reviewedAt, note?}` (`gate-review-writeback.mjs:45-47`); no range, no reviewer field; `KNOWN_GATE_VERDICTS = ["pass","fail"]` (`:10`) |
| Progress | `countCheckboxes()` counts every `- [ ]` line (`epic-progress.mjs:105-116`); archived epics with a missing source return `{done:0,total:0,warn:null}` (`:143`, `:150`) |
| Tracker direction | Vendor-tested at `rules.mjs:203`; `briefing.mjs:115` gates outward drift on a tracker merely existing; `briefing.mjs:136` nudges `/pm:sync` on any tracker count |
| Contention warning | `briefing.mjs:63` tests `conflictCount() === CONFLICT_WARN_THRESHOLD`; `consumeConflictWarning()` renames the log to `.prev` (`write-conflicts.mjs:73-77`) |
| Write guard | `saveState()` compares revisions; `--force` is read from raw `process.argv` (`state.mjs:97`); a thrown `StateConflictError` becomes exit 9 at `conductor.mjs:153-159` |

**Release discipline that binds this change** (`CLAUDE.md`): `plugin.json` version bump, a
`CHANGELOG.md` entry, a `MIGRATIONS` entry keyed to the release, every new file claimed in
`docs/parity-ledger.json`, README + Mintlify in the same PR cycle.

## Goals / Non-Goals

**Goals**

- One definition per concept, consumed everywhere: outstanding work, openspec-lane membership,
  tracker direction, the flag surface. Each currently exists as two or more copies, and the
  divergence is the defect.
- Every write that leaves an epic `archived` carries an outcome, on every path, including paths
  added after this change.
- A gate verdict that a later reader can check without believing prose.
- Behavior preservation for state written by 0.26.0, with or without `/pm:upgrade` having run.

**Non-Goals**

- **No engine judgment about intent.** The engine never classifies a task as bookkeeping, never
  infers a deferral from artifact prose, never attributes a commit from files or message text, and
  never proposes release membership. Every one of those is agent-declared.
- **No network call, no tracker call, anywhere.** `direction` shapes emitted instructions; it does
  not perform sync.
- **No repair by an integrity check.** Findings are reported; nothing writes state, and nothing
  blocks a command except where a requirement says so explicitly.
- **No retroactive enforcement.** The migration stamps history; the gates enforce forward. No
  archived epic is refused, rewritten, or deleted because it predates a rule.
- **Not in this release:** improving the *quality* of the lane-routing decision (#114's primary
  complaint — needs a product/milestone layer that does not exist), completion writeback for a
  primary inward tracker, and a global tracker watermark.

## Decisions

### 1. Seam ownership: `conductor-record` owns what is true about the record; `gate-integrity` owns what is required at a transition

Stated once so future work has a rule instead of case-by-case adjudication. "Outstanding work" is a
property of an epic, so `conductor-record` defines it and every guard cites it. "You may not archive
as `delivered` without a passing Gate 2" is a condition on a transition, so `gate-integrity` owns it.
The archive guard therefore *reads* the outstanding-work quantity and *does not compute* one.

Module placement follows the ownership, and each direction is one-way:

| New module | Owns | Imports |
|---|---|---|
| `disposition.mjs` | The disposition record shape, its validation, the `recordedBy` tokens | `constants.mjs` |
| `archive-gate.mjs` | What the archive transition requires, per path | `constants.mjs`, `epic-progress.mjs`, `disposition.mjs`, `git.mjs` |
| `integrity.mjs` | The read-only checks over the record | `constants.mjs`, `epic-progress.mjs`, `disposition.mjs`, `git.mjs` |

`update-epic.mjs` imports `archive-gate.mjs`; `briefing.mjs` and `render.mjs` import `integrity.mjs`
(both already import `epic-progress.mjs`, so no new cycle). Nothing under `disposition.mjs` or
`archive-gate.mjs` imports back up.

*Alternative rejected:* put the guard inline in `update-epic.mjs` where the existing Gate 2 refusal
lives (`:106-115`). That is exactly how the current refusal came to bind one of three archive paths.

### 2. Outstanding work is one exported function, and lifecycle exclusion is agent-declared

`outstandingWork(epic)` lands in `epic-progress.mjs` beside `epicProgress()` and is the only counter.
`epicProgress()` gains an excluded-count so the rendered bar and the guard's number are the same
arithmetic: a task carrying `<!-- pm:lifecycle -->` leaves both numerator and denominator, turning
`12/13` into `12/12` rather than `12/13` with a footnote.

The marker is one fixed literal matched on the task line itself, never on a following line, and the
engine infers exclusion from nothing else. Rationale, from the specs and measured: over-exclusion
silently under-reports outstanding work, which is the defect class this release closes, and a text
matcher fails in exactly that direction. `PLAN_INDEX_FILES` (`epic-progress.mjs:27`) is the repo's
precedent — it excludes against an enumerable literal precisely to avoid "reading inside the file to
decide", and its comment says so.

Excluding every task in a present source must not collapse into the missing-source state: `exists`
from `countCheckboxes()` stays the discriminator, not `total > 0`.

*Alternative rejected:* infer from the task's text (`/opsx:archive/`, "run `/pm:...`"). It cannot
distinguish the self-referential archive instruction from a real task that implements archiving, and
a false exclusion is invisible.

### 3. The disposition record: one shape, four scopes

```
epic.disposition = { outcome, reason?, recordedAt, recordedBy?, carriedTo? }
outcome ∈ delivered | killed | superseded | abandoned | unknown
```

`outcome` is **not** a top-level field on the epic, and it never becomes a `status` value —
`KNOWN_STATUSES` is untouched and every status-driven behavior in the engine is unchanged. Every
consumer and every test reads it through `outcomeOf(epic)`, never `epic.outcome`: a scenario phrased
"the epic carries `outcome: unknown`" is a claim about that reader, not about a flat field, and a
test that asserts the flat field is asserting a shape this design does not ship. The invariant in
Decision 5 stays checkable wherever an archived epic is read, because the reader is one lookup.

The same record shape carries the other three scopes rather than three parallel shapes: a declined
deferral, a release exclusion (`state.releases[].deferred[]`, Decision 15), and a handoff
(`carriedTo`, naming the receiving epic, with the reason saying which tasks moved). Reason is
mandatory for every outcome except `delivered`, rejected at the CLI with nothing written.

*Alternative rejected:* three flat fields on the epic (`outcome`, `outcomeReason`, `recordedBy`).
Each of the four scopes would then need its own flat triple, and `recordedBy`'s general rule —
"the engine records which path wrote a disposition nobody chose" — would have to be restated at each.

### 4. The archive transition binds `reconcileArchived()` wherever invoked

The rules bind the **function**, not a list of entry points. Verified call sites as of this change:
`migrations.mjs:66` (upgrade), `render.mjs:30`/`:34`, `subcommands.mjs:200`/`:204` (commit nudge),
`subcommands.mjs:252` (sync). Two of those — `upgrade` and `sync` — are interactive verbs an agent
typed, so "no agent is present" is false and cannot be the trigger. The rule turns on the fact that
**no disposition is supplied at the transition**, which is true at all four sites.

Binding to the hooks instead would leave `render`, `sync` and `upgrade` producing archived epics
under no rule at all — the absent-edit class reproduced inside the requirement written to prevent it.
A fifth caller added later inherits every rule without amending the spec.

The heal writes **one** record: `gateReview.gate2 = {verdict: "ungated", reviewedAt, recordedBy:
"archive-drift-heal"}` with **no** `reviewer` field, and in the same write the disposition
`{outcome: "unknown", recordedAt, recordedBy: "archive-drift-heal"}`. One write, because two
independent writes are what produce an epic carrying the bypass and not the outcome. An existing
`gate2` is never overwritten.

`ungated` is storable by the engine and not writable by the agent: `KNOWN_GATE_VERDICTS`
(`gate-review-writeback.mjs:10`) stays `["pass","fail"]` and a second, storage-side vocabulary admits
`ungated`. Widening the single `--verdict` allowlist is a failure of the requirement, not a way to
satisfy it — a verdict meaning "no review happened" must not be self-certifiable by the party whose
work would otherwise be reviewed.

### 5. Migration ordering versus the outcome invariant

Verified in `migrations.mjs:63-68`: the `MIGRATIONS` loop runs, **then** `reconcileArchived(state)`,
**then** `stampVersion(state)` and `saveState(state)`. An epic healed to `archived` during that run
is archived *after* the migration that stamps outcomes has already walked the epic list — and
`pmVersion` is then stamped, so the migration never replays. Stamping outcomes and stopping there
leaves heal-flipped epics permanently without one.

The specs express this as an **invariant** ("no write that leaves an epic at `status: archived` may
leave it without an `outcome`") rather than as an ordering rule, and that choice is deliberate: an
ordering is silently breakable by any later refactor that moves the heal, and a rule filed under one
path's heading invites an implementer to read it as that path's business. An invariant is checkable
wherever an archived epic is read.

What the implementation must actually do: the heal stamps its own disposition at the moment it flips
the status (Decision 4). The invariant then holds by construction regardless of ordering, and a test
asserts it over the whole epic list after an upgrade run in a repo where a change sits under
`openspec/changes/archive/` with an unhealed epic.

### 6. Commit attribution is an explicit array, written by a named flag

`epic.attributedCommits` is an array of hashes; its **last entry** is the endpoint a recorded
`headSha` is compared against. Written only by `update-epic --attribute-commit <sha>`, accepted more
than once per invocation, appending in the order given.

Two mechanisms are explicitly excluded:

- **Commits that touch the epic's files.** `/opsx:archive` moves `openspec/changes/<id>/` to
  `archive/<date>-<id>/` — one commit touching every file the epic owns. Under that design the
  archive move itself makes every verdict stale at the exact instant the archive gate reads it, and
  the gate refuses forever.
- **Commit messages naming an epic id.** A human-readable echo, not a mechanism: measured 3/15
  adoption for a prose convention against 14/14 for anything a required task carries.

Absent and empty are different claims. The array is initialized empty at epic creation, so an
**empty** array asserts "created under this capability, nothing attributed" while an **absent** array
means the epic predates it and its verdict is unverifiable. The migration therefore must **not** add
the array to a pre-existing epic; a uniformity-minded migration that initializes every epic to `[]`
converts the staleness gate's one forgiven case into a repo-wide false claim.

**`--attribute-commit` must be registered in `REPEATABLE_FLAGS` (`add-epic.mjs:16`) as well as in the
shared flag allowlist.** `parseFlags` (`add-epic.mjs:17-28`) overwrites a non-repeatable flag on each
occurrence, so `--attribute-commit <a> --attribute-commit <b>` keeps only `<b>` — exit 0, one hash
recorded, the spec scenario "both hashes appended in the order given" failed silently. Registering
the flag in one list and not the other is an absent edit inside the release that exists to close
absent edits.

Staleness is evaluated locally through `git.mjs`, which already shells out (`git.mjs:10`); the
ancestor test is `git merge-base --is-ancestor`. Where git is unavailable the verdict reports as
unverifiable and the archive is not refused on staleness grounds.

### 7. One shared flag registry; `add-many`'s keys are derived from it, not restated

Four capabilities in this release add flags to epic-writing commands. Grown four times, whichever
capability lands first rejects by name the flags the others introduce.

The registry moves to `constants.mjs` (the leaf both `update-epic.mjs` and `add-many.mjs` already
reach) as a single declaration carrying, per flag, its name, which commands accept it, whether it
repeats, and the state key it writes. `UPDATE_EPIC_FLAGS` becomes a projection of that declaration
rather than a literal. `add-epic` gains an allowlist derived from the same declaration — it has none
today, which is issue #79 exactly: `--notes "x"` parses, exits 0, writes nothing. `add-many`'s fixed
key copy (`add-many.mjs:61-70`) becomes a loop over the same declaration, with the flag→key mapping
being the one rule `--external-updated-at` ↔ `externalUpdatedAt`; an unknown key in a batch is
rejected by name and **no** entry in that batch is created.

The coverage check reads the **documented** flag surface at check time — the command's usage line
(`update-epic.mjs:27`) and its `commands/` document — never a list transcribed into a test. Driving
the check from the registry would be circular: a flag a capability forgot to register is simply
absent from the registry, so the check passes vacuously on exactly the omission it exists to catch.

### 8. `description` replaces, `notes` appends, and link clearing gets a named flag

`epic.description` is a single durable string, replaced when set again. `epic.notes` is an
append-only array of `{at, actor, text}` entries; appending never rewrites or drops an earlier one,
and writing either field never touches the other. `actor` is recorded here and not interpreted —
attribution semantics belong to a queued capability, and the entry shape is chosen to be the one
that capability will need.

Neither is substituted by stories. Stories are checklist items whose ticked state drives progress,
which is why epics have been archived carrying "incomplete" stories that were in fact completion
notes.

**Link clearing ships as a named `--clear-links` flag, not as the existing valueless `--link`.** The
spec permits either shape; this design picks the named one. Today `--link` with its value omitted
replaces the links array with an empty one (`update-epic.mjs:50-56` via `parseLinkFlags`), which is
byte-identical to the typo of dropping a value from a flag invoked to *fix* a malformed link, and it
is documented nowhere. A destructive path whose invocation is indistinguishable from a typo cannot be
made safe by documenting it, so the valueless form becomes a non-zero exit naming the flag, and the
intent gets its own name in the usage line and a test.

### 9. A gate verdict carries evidence as fields, and `gate1` acquires a reader

`gateReview.gateN` grows `baseSha`, `headSha` and `reviewer`. A `pass` with either sha missing is
refused with nothing written; a `fail` may omit the range. Pre-existing verdicts (`{verdict,
reviewedAt, note?}`) load unchanged and report as carrying no checkable evidence — never deleted,
never rewritten, never treated as a verified pass.

`gate1` is currently stored, documented, and read by nothing; the only consumer of `gateReview`
anywhere in the engine reads `gate2` (`update-epic.mjs:107`). It becomes a displayed condition in
`PROJECT.md` and the brief, and a missing Gate 1 is an integrity finding — never a refusal, because
Gate 1 gates code and the code has already been written by archive time.

All three strict lane tests normalize an absent lane in the same commit: `update-epic.mjs:106`,
`epic-progress.mjs:193`, `gate-review-writeback.mjs:37`. A lane-less epic renders as openspec-lane
everywhere today and slips the openspec-lane gate; fixing one of the three is the defect this release
exists to close.

### 10. The backfill stamps `unknown` + `recordedBy`, and writes no `gate2` at all

An epic registered from `openspec/changes/archive/` carries `{outcome: "unknown", recordedBy:
"archive-backfill"}` and **no** `gateReview.gate2` entry. An `ungated` entry there would add no
information — the stamp already records exactly how the epic reached `archived` — and it would add a
permanent one: `ungated` is a standing condition whose only clearing path is a real passing Gate 2
carrying `baseSha`/`headSha`, which for a change archived before the conductor existed is either
impossible or fabrication. Measured: 68 archived epics here, 3 with a passing Gate 2, so a backfill
writing `ungated` per epic produces an unclearable finding against essentially every archived change
in the repo on its first run.

Identity for registration is the date-prefix-stripped change id, derived the way `isArchived()`
already derives it (`epic-progress.mjs:50-56`), so `archive/2026-08-01-foo` and an existing `foo`
epic are one epic. `reconcileArchived()` continues to create nothing; registration is `sync`'s job.

`archiveBackfilledAt` at the state root is a **presence marker**, not a watermark: nothing is
compared against it. Forward-only registration derives from "this archived change has no epic", so
the field's only behavioral job is deciding whether a run announces itself as the historical backfill
or proceeds as routine reconciliation. Absent — including in every state file written before this
change — means not yet backfilled, and the state loads unchanged.

A backfilled epic keeps its real counts. `epicProgress()` suppresses the missing-source warning for
archived epics (`epic-progress.mjs:143`, `:150`) but returns `{done: 0, total: 0}`; the backfill
reads the archived artifacts so an abandoned change registers with its unticked tasks intact rather
than as `0/0`, which is the evidence the backfill exists to preserve.

### 11. Direction resolves through two named predicates, computed once, in `constants.mjs`

Two resolved values, and no emitter recomputes either from `system`, `repo` or `direction` locally:

- **`outwardApplies(tracker)`** — resolved direction is `outward` or `both`.
- **`inwardProcedureEmittable(tracker)`** — resolved direction includes `inward` **and** the tracker
  names a scope (a `repo` for `github-issues`; a `repo` or `projectKey` for any other system).

Direction and scope stay separate tests. A `github-issues` primary with no `repo` emits neither
section today (`rules.mjs:203` suppresses outward on the vendor test; the inward section is guarded
on `tracker.repo`), the migration stamps it `inward`, and under a plain "inward iff direction
includes inward" rule it would gain a section it never had. A scoped non-`github-issues` tracker set
to `inward` is the case that gets the vendor-neutral phrasing; the scope-less case gets nothing,
because emitting a command with an unfilled placeholder violates "every command pm emits must run as
written".

Placement is forced: `briefing.mjs` does not import from `rules.mjs` and must not start (the
one-directional discipline), while both already import from `constants.mjs`. A helper that lands
anywhere both emitters cannot reach becomes two copies, and the coherence assertion then passes
vacuously.

The resolution fallback (`github-issues` → `inward`, everything else → `outward`) is load-bearing
**independently of the migration**, because `/pm:upgrade` lags the plugin update by design — a repo
can run this engine for weeks before anyone upgrades its state.

### 12. `activate()` is the single activation door, and `add-many` routes through it

The tracker-refresh obligation is set **at the activation transition**, inside `activate()`
(`active-pointer.mjs:13-23`), never derived from current state — the same law `reconcileNeeded`
taught this repo, since a watermark advances for reasons unrelated to activation.

Four paths can leave an epic at `active`: `set-active` (`active-pointer.mjs:55`), `update-epic
--status active` (`update-epic.mjs:136`), `add-epic --status active` (`add-epic.mjs:222`), and
`add-many`. Only the first three call `activate()`; `add-many` constructs epic objects inline and
pushes them straight onto `state.epics` (`add-many.mjs:61-71`), so a batch entry at `active` status
sets neither the `.active` pointer nor the demotion of any other active epic. The single-active
invariant is already silently skipped there today — a pre-existing bug this change surfaces rather
than causes — and the refresh obligation would be skipped with it.

`add-many` therefore routes through `activate()` rather than duplicating the flag logic: one rule,
one site, four entry points covered. `add-epic.mjs:222` keeps a freshly-read exemption, so an epic
created active in the same command that read the external item owes no immediate re-read. The
obligation keys on `externalId` present — provenance, never direction; the full argument is in
`docs/superpowers/specs/2026-08-23-tracker-direction-and-freshness-design.md` § "The refresh gate"
and is not restated here.

*Alternative rejected:* set the flag at each of the four call sites. That is the absent-edit class
this release exists to close, and it would be the third time in this repo a rule was applied at three
of four sites.

### 13. Integrity findings are read-only; the ungated-archive notice is a standing condition and is never consumed

`integrity` is a read-only subcommand producing findings with the epic and enough detail to act on.
It writes no state and blocks nothing.

The ungated-archive notice in the brief is **recomputed from `state.json` on every composition**, not
stored as a delivered notification and not consumed on delivery. This is the deliberate opposite of
the contention warning: the contention warning describes a run of events that has ended, so it is
consumed once a session has seen it; an `ungated` verdict persists in `state.json` until a real Gate 2
supersedes it, so a notice that consumed would report it to one session and hide it from every
session after. The superseded `ungated` entry stays readable after a real verdict lands, so an audit
can still see that the epic was archived ungated before it was reviewed.

**The zero-ticked check gates on `total > 0`, not on `done === 0`.** `epicProgress()` returns
`{done: 0, total: 0}` for an archived epic whose source is gone (`epic-progress.mjs:143`, `:150`), so
a `done === 0` test would report all 65 migration-stamped `unknown` epics whose sources have long
since moved. With `total > 0` the live candidate set in this repo is the four the spec names
(`0/17`, `0/99`, `0/37`, `0/34`).

Identity for the dual-lane check is the date-prefix-stripped id, the same normalization
`isArchived()` applies. Measured here: **0** ids collide literally while **4** changes are registered
twice — a literal-equality check reports none of them while claiming four exist.

### 14. The contention warning latches in the sidecar, and two call sites change

`briefing.mjs:63` tests `conflictCount() === CONFLICT_WARN_THRESHOLD`. The count is only *sampled*
when a briefing is composed, so a burst from 0 to 7 skips between two briefings warns **zero** times —
the warning is least likely to fire in exactly the wedged-writer scenario it exists for, and its
absence then reads as evidence of health. `>= threshold` alone floods.

The latch is a sidecar marker file beside the log, never a field in `state.json` — that is the file
whose write just failed, which is the whole reason `write-conflicts.mjs` exists (`:4-7`). The brief
warns when `count >= threshold && !latched`; delivering the warning sets the latch; `clearConflicts()`
— which already runs on any successful state write (`state.mjs:130`) — removes both the log and the
latch, so the signal of interest stays *consecutive* skips.

Two edits, and both are required:

1. `consumeConflictWarning()` (`write-conflicts.mjs:73-77`) stops renaming the log to `.prev` and
   sets the latch instead. Rotating destroys the very path the warning tells the reader to open, and
   it also resets the count, so a continuing run of contention re-crosses the threshold and warns
   again — which the spec forbids.
2. `snapshot()` (`subcommands.mjs:78`) stops passing `consume: true`. PreCompact writes
   `.conductor/brief.txt`, which nothing reads back; a PreCompact landing between the threshold
   crossing and the next SessionStart currently shows the message to no one. Only `brief()`
   (`subcommands.mjs:65`) delivers into a session. `render()` already passes no `consume`
   (`render.mjs:133`) and stays that way.

### 15. A release is a named object; membership is one-way

`state.releases = [{id, intent, target?, deferred: [{epic, reason, recordedAt}]}]`, with membership
recorded as `epic.release` (at most one). Membership one-way rather than a member list on the release
means the two can never disagree. Exclusion uses the Decision 3 record against the epic/release pair
and leaves the epic in the backlog — an excluded epic is not an ended one, and a queued epic nobody
considered is neither in the release nor deferred from it. The engine proposes no membership.

### 16. New writeback verbs are documented in the existing command docs

`CLAUDE.md` requires a `commands/` doc per subcommand. `record-gate-review` and `record-reconcile`
are shipped subcommands with no `commands/*.md` of their own, because they are engine-facing
writeback verbs an agent runs mid-gate rather than user-facing slash commands. The verbs this change
adds are the same shape and are documented inside `commands/sync.md`, `commands/epic.md` and the
`conductor` skill. Taken as proposed, `docs/parity-ledger.json` needs no new claimed path; if a new
`commands/*.md` ships instead it must be claimed in a capability **in the same commit** or
`scripts/test/parity.test.mjs` fails CI.

## Risks / Trade-offs

- **[Risk] The two new agent obligations — `<!-- pm:lifecycle -->` and `--attribute-commit` — ship as
  emitted prose, which this release's own audit measured at 3/15 adoption against 14/14 for anything
  a required task carries.** Neither field is written by the engine, so an ignored obligation leaves
  the feature expressible and never exercised. → Mitigation, one detector per obligation, both
  mechanical: the archive refusal names the `<!-- pm:lifecycle -->` remedy as a literal token at
  exactly the moment the agent needs it, so the lifecycle marker is learned from a refusal rather
  than from a rule; and the integrity check "a `delivered` epic with a passing Gate 2 has attributed
  no commits" is the shape of *the agent ignored the flag* and reports it. Neither obligation is
  invisible when unmet. Residual risk is real and accepted: the attribution detector fires only at
  archive, after the commits it wanted are already made.

- **[Risk] The archive gate begins refusing where it previously did not, and it will surprise people
  mid-flight.** An openspec-lane epic archived as `delivered` now needs a passing Gate 2 carrying
  `baseSha`/`headSha`, a deferral assertion, and either zero outstanding work or a `carriedTo`. That
  is the point of the change, and it lands on epics that were started under the old contract. →
  Mitigation: every refusal names its remedy and the exact command; the demand binds
  `outcome: delivered` only, so `killed`/`superseded`/`abandoned` archive on their required reason
  alone; the guard cites the same outstanding count the record renders, so it can never refuse an
  epic that reads as complete; and the two non-interactive paths are not bound by it at all.

- **[Risk] The dual-lane integrity check reports 4 pairs in this repository on day one and cannot
  distinguish a deliberate double registration from an accidental one.** The "tombstone" convention
  is prose in a title — 3 mentions in `state.json` — not a field, so nothing keys on it. All 4 pairs
  are the same known bug (#64/#69), deliberately out of this release. → Mitigation: the finding
  reports the pair and the lanes each holds and asserts nothing about intent; the check is read-only
  and blocks nothing. A `deliberate` field would be a fifth disposition scope invented without a
  motivating case, so it is not built here; #64/#69 remains the place that resolves it.

- **[Risk] Every new integrity check risks day-one noise, and a reader who learns to filter one
  learns to filter the block.** Six checks land at once. → Mitigation, applied per check rather than
  as a policy: the backfill writes no `gate2`, so no historical epic is ever named as an ungated
  archive; `killed`/`superseded`/`abandoned` and `archive-backfill`-stamped epics are out of scope
  for the completion-shaped checks; the zero-ticked check gates on `total > 0` (Decision 13), which
  is what keeps 65 source-less archived epics out of it. The measured day-one finding set for this
  repository is 4 dual-lane pairs, 1 zero-ticked epic outside the collision set, and 1 range-vs-note
  mismatch (`platform-parity-mechanism`, `d168b1e..04c54c8` citing `c63efc1` and `3cba2e9`).

- **[Risk] `--force` disarms the write guard for the migration.** `saveState()` reads `--force` from
  raw `process.argv` (`state.mjs:97`), so `/pm:upgrade --force` overwrites whatever a racing writer
  landed. → Mitigation: the migration is additive and per-field guarded, so a forced overwrite loses
  the racing writer's change, not the migration's; and `state.json` is git-tracked, so the loss is
  recoverable (§ Migration Plan). Not mitigated further — removing the argv read means threading an
  option through every call site, which is the refactor the write-guard design deliberately excluded.

- **[Trade-off] A new primary tracker registered with no `--direction` defaults to `inward`, the
  reverse of today's outcome for a non-`github-issues` tracker.** A fresh `set-tracker --system jira`
  emits different instructions in 0.27.0 than in 0.26.0. → Accepted: outward creation of issues in
  someone else's tracker is the consequential default and must be chosen, not inherited. The one-line
  remedy is `set-tracker --system jira --direction outward`, and this must be documented as a
  behavior change in README, `CHANGELOG.md` and the Mintlify site — not only in the spec. Existing
  repos are unaffected by both the fallback and the migration.

- **[Trade-off] Two deliberate emitted-output changes for existing repos, on different surfaces.**
  The "Sync after completing tracker-linked work" reminder leaves the rules block where no inward
  procedure was emitted (it currently cites "the writeback steps above" that the same block never
  emits), and the `consider /pm:sync` nudge leaves the brief for outward-only repos. → Named here so
  an implementer diffing against 0.26.0 output knows exactly which lines are expected to differ and
  treats any third as a regression.

- **[Trade-off] Six specs, 59 requirements, one release.** Splitting would ship the shared chokepoints
  — the flag registry, `activate()`, the archive transition — twice. → Accepted: the flag registry in
  particular cannot be split, because whichever capability lands first rejects by name the flags the
  others introduce.

## Migration Plan

One `MIGRATIONS` entry keyed `0.27.0`, additive, idempotent, backward-compatible. It runs inside
`upgrade()` (`migrations.mjs:57-72`) before `reconcileArchived()`, `stampVersion()` and `saveState()`.

**Tracker direction.**

| Existing | Stamped | Preserves |
|---|---|---|
| `github-issues` primary | `inward` | inward pull; outward stays suppressed |
| any other primary | `outward` | outward create + transition; **no** inward pull is introduced |
| any secondary entry | `inward` | inward pull + completion writeback, never outward creation |

`both` is wrong for existing non-`github-issues` primaries, verified rather than assumed: a Jira
tracker today receives *only* the outward section (`rules.mjs:203`), and the sole inward-pull section
is gated `sys === "github-issues" && tracker.repo`. Stamping `both` would grant inward pull no repo
has ever had, and `/pm:sync` would start registering an untriaged epic per open Jira issue. An
explicitly set `direction` is never overwritten; the guard is `!t.direction`, so a second upgrade is
a no-op. The new-tracker default must be captured **before** the merge in `setTracker()` —
`tracker.mjs:61` merges (`const t = { ...(state.tracker || {}) }`), so a naive
`if (!t.direction) t.direction = "inward"` inside the writer silently switches off outward mirroring
for every existing Jira repo. The test is `const isNew = !(state.tracker && state.tracker.system)`,
and the same trap exists in `upsertSecondaryTracker`.

**Archived-epic outcomes — every archived epic, regardless of lane.** `delivered` only where a
passing Gate 2 exists; `unknown` everywhere else, stamped `recordedBy: "migration"` so the
migration's stamp is distinguishable from the heal's and the backfill's. Measured here: 68 archived
epics, 3 openspec-lane, and the same 3 carry the only passing Gate 2 verdicts — stamping one lane
would leave 65 with no outcome and the invariant in Decision 5 would fail on this repository the
instant the migration ran. `unknown` is the honest value: it says nobody recorded a disposition,
which is exactly true, and no non-openspec lane has a Gate 2 to have passed, so `delivered` there
would assert something unverified. `recordedAt` prefers the epic's existing `completedAt` and falls
back to the migration timestamp. The gate enforces going forward and touches no history.

**What the migration must NOT do.** It must not add `attributedCommits` to any pre-existing epic
(Decision 6), must not write `archiveBackfilledAt` (Decision 10 — absence means "not yet backfilled",
and the backfill is a deliberate announced action, never a migration side effect), and must not
overwrite an existing `disposition` or `direction`.

**No migration is needed** for `externalUpdatedAt` (absent means "never re-read since mirroring",
which is truthfully the state of every pre-0.27.0 tracker-linked epic), `trackerRefreshNeeded`
(absent means not owed; set at the next `activate()`), or `revision` (absent means 0, already the
0.26.0 contract).

**A 0.26.0 state file must still load, upgraded or not.** Absent `direction` resolves through the
Decision 11 fallback; absent `disposition` reads as `unknown` at every consumer; absent
`attributedCommits` reads as unverifiable; absent `revision` is 0 (`state.mjs:68`). A rules block
emitted for an un-upgraded Jira repo is byte-identical to 0.26.0's, and the brief is identical except
the nudge.

**Concurrency.** The migration is itself a state write, and `upgrade()` uses the default throwing
path (`migrations.mjs:68` → `saveState(state)` with `onConflict: "throw"`). A racing hook write
therefore aborts it cleanly with `StateConflictError` → exit 9 (`conductor.mjs:153-159`), writing
nothing; the operator re-runs `/pm:upgrade` and every entry replays, because `pmVersion` is only
stamped on the same successful write. `/pm:upgrade --force` disarms that guard — `--force` is read
from raw `process.argv` at `state.mjs:97` — and should not be used to get past a conflict.

**Rollback.** `.conductor/state.json` is git-tracked in every repo that uses pm, so **git is the
rollback**: `git -C <repo> restore .conductor/state.json`, then `/pm:status` to re-render
`PROJECT.md` (generated, never hand-edited). Three implications follow and must be stated to users
rather than discovered:

1. Commit `state.json` before upgrading. A restore discards every uncommitted state change since the
   last commit, not only the migration's.
2. **Rolling back state does not require rolling back the engine.** The Decision 11 fallback and every
   absent-field default above are what make a 0.27.0 engine behave identically on 0.26.0 state, so an
   operator can revert the file and keep working while the problem is diagnosed.
3. Rolling back the *engine* is a plugin operation, not a state one — pin the marketplace source to
   the prior ref and `/reload-plugins`. A 0.27.0 state file loads on 0.26.0 with the new fields
   ignored, so the two directions are independent.
