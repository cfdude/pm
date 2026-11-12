## Context

See proposal.md, Why. Inputs: the owner's 2026-11-12 decisions (epic `release-planning-taxonomy`, its notes in
`.conductor/state.json`), the owner's answers to this change's thirteen open questions (2026-11-12, recorded below as D17 to
D30), and the `project-boards` change (`openspec/changes/project-boards/`), which this extends: its `mission`,
`releasePlan`, release plan fields, `board --json` and the two board templates. Constraints: the engine has zero runtime
dependencies, opens no network connection and runs no git for this change; `state.json` is the only record and the engine its
only writer; every field is machine-checkable; a 0.55.0 state file must still load.

**Ordering.** `project-boards` (0.55.0) archives first. Its specs (`release-planning`, `board-export`, `project-mission`,
`project-boards`) are not in `openspec/specs/` yet, so this change uses ADDED requirements only, and never MODIFIED, for
those capabilities. `epic-annotation` exists in `openspec/specs/` and also receives ADDED requirements only.

## Goals / Non-Goals

**Goals:** record the initiative level and tie milestones and releases to it; record what each level will not do; account for
every piece of work in any lane in each release's split; challenge off-mission and off-initiative work once and keep the
answer; record when work joined a release or an initiative so scope movement is derivable; show all of it on the release plan.

**Non-Goals:** everything in proposal.md "Non-goals of this change". In particular this change computes no initiative
progress; it records the fields that work will read (the join times of D26 among them).

## Decisions

**D1. Initiatives are a top-level array, the record of their own verb.** `state.initiatives = [{id, title, capability,
status: "open"|"ended", outcome, createdAt, source, offMissionReason, history: [{event, outcome?, at, reason}],
milestones: [...], nextMilestone, nonGoals: [...], nextNonGoal}]`. Not a release field (an initiative spans releases) and not
an epic (it is not a unit of delivery). Ids use `EPIC_ID_FORMAT` (`constants.mjs`) in their own namespace.

**D2. Initiative milestones nest inside their initiative.** A milestone is meaningless without an initiative, so nesting
makes an orphan unrepresentable and no milestone reference can dangle. The shape reuses the mission exit criterion pattern
(`mission-record.mjs`): `{id: "mN", text, addedAt, reachedAt?, evidence?, history: [...], removedAt?, removeReason?}`, stable
ids, marked removed. It carries no release, because a milestone sits outside any single release.

**D3. The 0.55.0 mission milestone is left untouched.** `mission.milestoneRelease` stays a release and keeps driving
`criticalPath` (`board.mjs`). The two are kept apart by name, as project-boards D7 did for plan stories: every human surface
says "initiative milestone". Folding the mission milestone in belongs to the later roadmap epic (D17).

**D4. A release records one purpose; the initiatives it also serves are not recorded on it.** `release.initiative` (an id) or
`release.maintenance: true`, mutually exclusive. A release's attribution to initiatives is computed from its epics, so the
secondaries live on epics only (`secondaryInitiatives`) and the attribution is computed by the later progress epic.

**D5. Spellings that keep 0.55.0's closed lists intact.**
- `release --clear <field>` names exactly theme, rationale, exit, order, size and target, so the release's new singletons use
  project-boards D7's valueless `--clear-<thing>` form: `--clear-initiative`, `--clear-split-reason`.
- `mission`'s `--reason` serves exactly `--statement`, `--end` and `--remove-criterion`, so every non-goal and initiative
  milestone operation carries its text inline, `nN:<why>` / `mN:<why>` / `mN:<evidence>`, split at the first colon: the
  gh#179 `--unmember` precedent (`constants.mjs`). Not repeatable, for the same reason `--unmember` is not.
- `board-export`'s `rejected` kinds and reasons are closed and its `mission` object is a fixed `{statement, setAt, reason}`.
  So mission non-goals are a top-level `missionNonGoals` key, and a dangling initiative reference reads `null` with the report
  left to `integrity` (D7). Adding top-level keys contradicts nothing.
- The `## Mission` section's 280-byte cap is a 0.55.0 requirement, so mission non-goals get their own section (D29).
- The epic flags go through the open, registry-driven `update-epic --clear` (nullable rows), which has no closed list. The
  new `initiative` verb gets its own `--clear source|off-mission-reason`.

**D6. The challenge is a warning at the transition, not a judgment by the engine.** The engine checks presence; the agent
judges alignment. It warns on the `owesSummaryWarning` transition (`epic-summary.mjs`): leaving `untriaged`, or registration
into a live status. Firing only there is what makes "challenged once" mechanical, and the recorded reason is the "already
answered" marker. Off-mission judgment (of epics and of initiatives, D25) is the agent's, carried by the conductor skill and
`## Initiatives`; the engine stores the reasons. Scoping, beyond the brief:
- The warning fires only while at least one initiative is `open`. Before any initiative is derived, every triage would warn.
- A `health` epic needs no initiative: health is the 20% that is by definition not initiative work.
- `release --member` warns (never refuses) when the epic does not serve the release's primary; a maintenance release, or one
  with no primary, never warns.

**D7. Dangling initiative references are an integrity finding.** No verb deletes an initiative and every flag that names one
refuses an unknown id, so a dangling reference needs a hand edit. `integrity` (`scripts/lib/integrity.mjs`, `runIntegrity`)
is pm's existing reporter of hand-edit damage; the export reads such a reference as `null`.

**D8. An initiative ends, never deletes.** `--end --outcome <o> --reason "<why>"` and `--reopen --reason "<why>"` append to a
history, spelled as `mission --end --reason` so one operation has one spelling, and following gate item 6.

**D9. The split counts epics** (D18, D20). Epics carry no size and release `--size` is semver impact.

**D10. The health band is two engine constants** (D19): `HEALTH_SHARE_MIN = 0.10`, `HEALTH_SHARE_MAX = 0.30`, in the release
module. Not settings; the target is a fixed 0.2 (D30).

**D11. An override is a reason, not a setting.** `splitReason` is shown beside the drift and changes nothing else. No
`OPT_INS` row, no switch: the report is not a setting to turn off.

**D12. Non-goals are one shared module.** `scripts/lib/non-goals.mjs` holds the shape, validation (`lineFieldError` from
`epic-summary.mjs`, 300 characters, control characters escaped by `escapeControls`) and the add and remove operations, so the
four records cannot drift apart. Ids are per record (`nextNonGoal` on each).

**D13. `## Initiatives` is a verb-refreshed section with its own cap.** Present only while an initiative is open, capped at
280 bytes, outside `CONDITIONAL_SECTIONS` (`rules-usage.mjs`), rewritten by `initiative` when its text changes (the `mission`
verb's pattern, `mission.mjs:196-206`), attributed `rules:initiatives` → `core` in `SURFACE_FEATURES` (`overhead.mjs`), as
`rules:mission` is. Its code spans pass the emitted-invocations functional test.

**D14. Derive-and-confirm lives in skill text, in two existing homes.** Candidate derivation joins the `project-boards`
skill's "First population: Derive, then confirm". The challenge-once procedure and the two tweak destinations (D23) join the
conductor skill's Intake. No new skill: a project assessment skill is out of scope.

**D15. `schemaVersion` stays 1.** Every `board --json` addition is a new key; no existing key's meaning changes. `unaligned`
(D21) replaces this change's own earlier `unclassified` draft, which never shipped.

**D16. Field caps follow the engine's existing conventions** (`--help`, 2026-11-12): titles 200 (as `--summary`), capability
400 (as release `--theme`), milestones, evidence, sources and non-goals 300 (as mission criteria), reasons 300 (as
`--why-now`), split reason 400 (as `--rationale`). All one line, validated before any write, echoed through `escapeControls`.

### Owner answers (2026-11-12)

**D17 (Q1). The mission milestone stays as it is; no migration.** It folds into initiative milestones later, in the roadmap
epic, not here.

**D18 (Q2). No epic sizing in 0.56.0; the split and progress count epics.** A later epic adds epic sizing with ONE default
scale chosen and kept, but the scale is a configuration choice (t-shirt, Fibonacci, others), because people hold strong
opinions about it. That epic is in proposal.md's non-goals; nothing here reserves a size field.

**D19 (Q3). Drift is a share below 10% or above 30%.** Boundaries are inside the band: 0.10 and 0.30 do not drift.

**D20 (Q4). Count by epic.** Same as D9; restated so the answer is on record.

**D21 (Q5, revised). Every piece of work in any lane is accounted for, with minimal overhead.** NEW MACHINERY is marked.
- (a) A `claude-code`-lane epic counts in the split by its kind. With none recorded, its EFFECTIVE kind is `initiative-work`
  when it names an initiative, else `health`. NEW: the derived `effectiveKind` (read-only, never stored, so no backfill and no
  inverse). It is still not challenged one by one.
- (b) A tweak too small for its own epic goes to the per-release floating epic `maintenance-<releaseId>` (lane `claude-code`,
  kind `health`, a member of that release), registered by the agent with `add-epic` on the first unaccounted tweak, its
  commits recorded with the existing `update-epic --attribute-commit`, ended with the release by the normal disposition. NOT
  new engine machinery: it is a naming convention over existing verbs, stated in the conductor skill. A tweak that moves an
  initiative is a small claude-code epic naming that initiative instead. The id fits `EPIC_ID_FORMAT`
  (`maintenance-0.56.0`). Inverse: the normal disposition; `remove-epic` for one registered in error.
- (c) The commit nudge (`attributionNudge`, `scripts/lib/subcommands.mjs`, read 2026-11-12) already has an "untied" branch
  for a commit whose subject and paths do not name the active epic; it ends "If it is not, attribute nothing." AMENDED
  (cheap, one branch): when the active epic is a member of a release, that sentence names the two destinations instead, with
  runnable commands. When no epic is active the nudge returns `null` today (no candidate); that stays, to keep the nudge's
  noise budget, and the gap is closed later by the unattributed-commit check (e).
- (d) The split reports `health`, `initiativeWork` and `unaligned`. NEW: `unaligned` is any member that is neither effective
  `health` nor naming a primary initiative, a visible off-initiative signal even when a reason is recorded. Its audience is
  the release plan board, the orchestrating agent at closeout (`release show`) and the later assessment skill. A tiny project
  pays at most one attribution line per tweak.
- (e) The read-only `integrity` check listing commits in a release range that no epic attributes is LATER, not 0.56.0. A
  release records no commit range today (`delivered` holds only `recordedAt`; the record's release keys are amendments,
  crossSpecReview, deferred, delivered, exit, id, intent, rationale, size, target, theme), so the check needs a new range
  record and a git walk inside `integrity`, which already imports `git.mjs` but would put a new functional-bucket subject in
  every certify. The nudge amendment (c) covers commits from here on; the check is listed in proposal.md's non-goals.

**D22 (Q6). An initiative milestone is reached when the agent records it with evidence.** `--reach-milestone
"mN:<evidence>"`; the human override is `--unreach-milestone "mN:<why>"`, its inverse. No mechanical check yet.

**D23 (Q7). Ending an initiative records only the WORK disposition.** `--outcome delivered|abandoned|superseded`, the epic
vocabulary's subset the owner named. The OUTCOME review (`successSignal`, `reviewDue`) is a separate later feature that arms
AFTER deployment, never at close, because the human cannot judge an outcome before it has run in production. Out of scope.

**D24 (Q8). Warn when no member serves the release's primary initiative.** Derived `primaryServed`; `release show` prints a
warning line while it is `false`. A report, never a refusal.

**D25 (Q9). An initiative is challenged against the mission once,** with its answer in `initiative --off-mission-reason`.

**D26 (Q10). An initiative may record its source** (`--source`, optional, one line; `UNGROUNDED` is an accepted value).

**D27 (Q11, widened). Record when an epic joined its initiative and its release; report scope added since planning.** Checked
from disk first: `release --member` writes only `epic.release = id` (`releases.mjs:367`) and appends an amendment only when an
epic MOVES (`{op: "unmember", via: "member", to, at}` on the old release, `releases.mjs:355`). A plain join records no time,
so join times cannot be recovered from amendments. NEW: `epic.releaseJoinedAt`, written by `--member` only when the epic
JOINS (a repeat for the same release keeps it; `releases.mjs:367` writes `epic.release` unconditionally today, so the build
guards it), replaced by a move, and removed by both membership removers, `--unmember` (`releases.mjs:399`) and `--defer` on
that release (`releases.mjs:375`); `epic.initiativeJoinedAt` (written when the primary changes, removed by `--clear initiative`), and
a derived planning baseline (D31). `addedSincePlanning` and `unknownJoinTime`
are derived; `release show` prints "N epics added since the first member started" at closeout as a learning input. Report only.

**D28 (Q11).** Superseded by D31; the explicit-mark proposal it held was declined by the owner.

**D29 (Q12). Mission non-goals reach the rules block in one line.** A separate `## Mission non-goals` section (D5), present only
while one is active, capped at 200 bytes, refreshed by `mission`, `rules:mission-non-goals` → `core`. Measured with
`node scripts/conductor.mjs overhead` on 2026-11-12 in this repo: `rules:mission` is 282 bytes and core is 40280 bytes; the
mission has no non-goals, so the new section costs 0 bytes today and at most 200 bytes (about 50 tokens, bytes/4) when set,
a 0.5% rise in core. `rules:initiatives` adds at most 280 more while an initiative is open.

**D30 (Q13). The 20% target is fixed for every project.** The only override is a recorded `--split-reason`.

**D31 (Q14). The planning baseline is automatic: no mark, no flag, no inverse.** The owner wants no added ceremony.
`planningBaseline` is derived on every read as the earliest `startedAt` among the release's members that have one. Checked
from disk: `startedAt` is stamped once, on an epic's first activation, and never reset (`active-pointer.mjs:46-48`); 67 epics
in this repo carry it (jq, 2026-11-12). "Added since planning" counts members whose `releaseJoinedAt` is later. With no member
started there is no baseline and every scope count is `null`, never invented. Nothing is stored, so nothing needs unsetting.

**D32. Smaller choices, stated so the build does not guess them** (fresh-context review, 2026-11-12):
- `release show` keeps its 0.55.0 `theme:` label (`releases.mjs:616`, pinned by existing tests); only the board says "Goal".
- The split's override has one home, `splitReason` on the release entry; `split` carries no `reason`.
- The split counts EVERY member, killed and declined ones included, because the split asks where effort was planned; 0.55.0
  `progress` excludes declined members from its denominator because it asks what shipped. The two answer different questions.
- A non-claude-code epic with no kind that names a primary initiative counts as `initiativeWork` (it serves one), while its
  `effectiveKind` reads `null`, because the claude-code default (D21a) is the only derived kind.
- Rules-section caps (280 and 200 bytes) are tested on the section text as the section function returns it, heading
  included and with no trailing newline: `missionSectionText`'s convention. `overhead` also counts the separator, which is
  why it reports `rules:mission` as 282.
- The automatic baseline moves earlier when a member that started before the others joins later, so every human surface
  says "added since the first member started", never "since planning".

## Call sites (gate item 1, derived with `rg` on 2026-11-12; R.1 re-derives them)

- `rg -n "warnSummary\(" scripts/lib`: the transition sink the planning warning joins: `active-pointer.mjs:136`,
  `update-epic.mjs:1195`, `detour-stack.mjs:179-180`, `add-epic.mjs:522`, `add-many.mjs:266`.
- `rg -n "lineFieldError\(" scripts/lib`: `update-epic.mjs:591`, `add-many.mjs:148`, `add-epic.mjs:495`.
- `rg -n "epicBatchKeys|epicFlagsFor" scripts/lib`: `constants.mjs`, `update-epic.mjs`, `add-many.mjs`, `help.mjs`.
- `rg -n "pushEpic\(" scripts/lib`: `state.mjs:136`, `subcommands.mjs` x3, add-epic and add-many through it. New epic fields
  are optional and seeded by nothing, so no creation site changes.
- `rg -n "\.release = |delete [a-zA-Z.()]*\.release\b" scripts/lib scripts/conductor.mjs` (2026-11-12): one writer,
  `releases.mjs:367` (`--member`, also the move); two removers, `releases.mjs:375` (`--defer`, `if (epic.release === id)
  delete epic.release`) and `releases.mjs:399` (`--unmember`). Each remover deletes `releaseJoinedAt` in the same statement
  block; `remove-epic` deletes the whole record.
- `rg -n "attributionNudge|attributionCandidates" scripts/lib`: `subcommands.mjs` (the nudge, ~649-728, and its candidates
  ~540); only the untied branch changes.
- `rg -n "rulesBlock\(|writeRules\(|currentMissionSection\(|currentBoardsSection\(" scripts/lib scripts/conductor.mjs`:
  three builders of the block (`rules.mjs:1334` in `writeRules`, `conductor.mjs:529` for the `rules` verb, `overhead.mjs:181`)
  each gain the `## Initiatives` and `## Mission non-goals` arguments; every other writer (`set-boards`, `mission`, tracker
  verbs, `review-mode`, `profile-verbs`, `spend-tracking`, `spend-guard-verbs`, `subcommands`, `migrations` for `upgrade`)
  goes through `writeRules`, so none can drop either section.
- `rg -n "SURFACE_FEATURES|CONDITIONAL_SECTIONS" scripts/lib`: `overhead.mjs:51`, `rules-usage.mjs:41`, `rules.mjs`,
  `spend-guard-verbs.mjs`.
- `rg -n "REJECTED_REASONS" scripts/lib`: `board.mjs:46` only; not extended (D5).
- `rg -n "missionOf\(" scripts/lib`: `mission-record.mjs`, `mission.mjs`: the readers that must carry `nonGoals`.
- `rg -n "releaseSummaries" scripts/lib`: `constants.mjs:215`, `briefing.mjs`, `render.mjs`, `releases.mjs`. The split, scope
  and `primaryServed` are computed in the release module and read by `release show`, `board` and the template only, not by
  the brief or `PROJECT.md`.
- `rg -n "VERB_EFFECTS" scripts/lib/verb-effects.mjs`: the `release` and `mission` rows' `writes` text gains the new keys; a new
  `initiative` row (mutates; `show` writes nothing).

**Data references (gate item 1).**

| Holder | Writers | Readers | Removers |
|---|---|---|---|
| `epic.initiative` (+ `initiativeJoinedAt`) | add-epic, update-epic, add-many | board, warnings, split, initiative show, integrity | `update-epic --clear initiative`; `remove-epic` removes the holder |
| `epic.secondaryInitiatives[]` | same | board, member warning, `primaryServed`, integrity | `--remove-secondary-initiative`; `remove-epic` |
| `epic.releaseJoinedAt` | `release --member` on a join (`releases.mjs:367`) | scope report, board | `--unmember` (`:399`); `--defer` (`:375`); a move replaces it; `remove-epic` |
| `release.initiative` | `release --initiative` | board, release show, member warning, `primaryServed`, integrity | `--clear-initiative`, `--maintenance` |
| initiative milestones and non-goals | `initiative` | board, initiative show | marked removed only |

An initiative is never removed, so none of these can dangle through a verb; a hand edit is reported by `integrity` (D7).

## Inverses (gate item 1)

| Operation | Inverse | Shipped |
|---|---|---|
| `initiative <id>` create | `--end --outcome <o> --reason "<why>"` (history kept) | yes |
| `initiative --end` | `--reopen --reason "<why>"` | yes |
| `initiative --title`, `--capability` | a new value | **no clear**, deliberate: required on create, as release `intent` |
| `initiative --source`, `--off-mission-reason` | `initiative --clear source`, `--clear off-mission-reason` | yes |
| `--add-milestone` | `--remove-milestone "mN:<why>"` (marked, not deleted) | yes |
| `--reach-milestone` | `--unreach-milestone "mN:<why>"` (both events kept) | yes |
| `--add-non-goal` (four records) | `--remove-non-goal "nN:<why>"` (marked) | yes |
| `release --initiative` / `--maintenance` | `--clear-initiative`; each replaces the other | yes |
| `release --split-reason` | `--clear-split-reason` | yes |
| `releaseJoinedAt` written by `--member` | removed by `--unmember` and `--defer`, replaced by a move, kept by a repeat | yes |
| `--initiative` (epic), with `initiativeJoinedAt` | `update-epic --clear initiative` (removes both) | yes |
| `--secondary-initiative` | `--remove-secondary-initiative` | yes |
| `--kind` | `update-epic --clear kind` | yes |
| `--off-mission-reason`, `--off-initiative-reason` | `update-epic --clear off-mission-reason`, `--clear off-initiative-reason` | yes |
| `maintenance-<releaseId>` registered | normal disposition at release end; `remove-epic` if registered in error | yes (existing verbs) |
| initiative delete | none | **no**, deliberate: ending records, deletion destroys (gate item 6) |
| the 80/20 report, the scope report | none | **no**, deliberate: reports are not settings to turn off |

## Amendments owed to 0.55.0 specs

One, owed AFTER `project-boards` archives. `board-export`'s "Every emitted id passes the board id format" requires each
failing id to appear in `rejected` with reason `id format`, and its `rejected` kind list is closed with no `initiative`. This
change cannot amend `project-boards` (it is built and unarchived; editing it would make 0.55.0 contradict its own code), and a
MODIFIED delta needs the base spec in `openspec/specs/`, which exists only after that archive. So 0.56.0 validates initiative
ids on write, skips a hand-edited bad one in the export and reports it through `integrity`, and states plainly that it is
not a `rejected` entry. Task 0.6, ordered after project-boards' archive, adds the MODIFIED `board-export` delta (kind
`initiative`) and turns the skip into a `rejected` entry. Everything else: D5 keeps the closed lists intact, and the nudge
amendment changes a branch no 0.55.0 spec fixes. The cross-spec review (task 0.4) checks both claims.

## Risks / Trade-offs

- [Warning noise once initiatives exist] → transition-only, silenced by a recorded reason, skips `claude-code` and `health`,
  off while no initiative is open.
- [Rules-block bytes in every repo] → two sections, each present only while its data exists, capped at 280 and 200 bytes
  (D29), with README cost rows.
- [Two milestone concepts confuse readers] → distinct names on every surface until the roadmap epic folds them (D17).
- [Count-based split misleads when epics differ widely in size] → stated on the board as "by epic count"; sizing is later (D18).
- [Pre-0.56.0 members carry no join time] → reported as `unknownJoinTime`, never guessed.
- [Tweaks committed with no active epic stay unattributed] → the nudge is silent there today (D21c); the unattributed-commit
  check is a later epic (D21e).

## Migration Plan

Additive. Every new key is optional and absent means today's behaviour: no initiative, no non-goals, no recorded kind, no
release purpose, no planning baseline, no join times. No existing value is transformed: D17 keeps the mission milestone and
D27 does not backfill join times. So no `MIGRATIONS` entry is added; task 8.2's unit test loading a 0.55.0-shaped fixture is
the evidence. Rollback is reinstalling 0.55.0; whether it tolerates the new keys is not claimed here.

## Open questions

None. Q1 to Q14 are answered (D17 to D31).
