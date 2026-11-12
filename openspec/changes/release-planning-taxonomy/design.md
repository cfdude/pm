## Context

See proposal.md, Why. Inputs: the owner's 2026-11-12 decisions (epic `release-planning-taxonomy`, its notes in
`.conductor/state.json`), and the `project-boards` change (`openspec/changes/project-boards/`), which this extends: its
`mission`, `releasePlan`, release plan fields, `board --json` and the two board templates. Constraints: the engine has zero
runtime dependencies, opens no network connection and runs no git for this change; `state.json` is the only record and the
engine its only writer; every field is machine-checkable; a 0.55.0 state file must still load.

**Ordering.** `project-boards` (0.55.0) archives first. Its specs (`release-planning`, `board-export`, `project-mission`,
`project-boards`) are not in `openspec/specs/` yet, so this change uses ADDED requirements only, and never MODIFIED, for
those capabilities. `epic-annotation` exists in `openspec/specs/` and also receives ADDED requirements only.

## Goals / Non-Goals

**Goals:** record the initiative level and tie milestones and releases to it; record what each level will not do; record
each epic's kind and report each release's health split; challenge off-mission and off-initiative work once and keep the
answer; show the initiative on the release plan board.

**Non-Goals:** everything in proposal.md "Non-goals of this change". In particular this change computes no initiative
progress and no release-to-initiative attribution; it records only the fields that work will read.

## Decisions

**D1. Initiatives are a top-level array, the record of their own verb.** `state.initiatives = [{id, title, capability,
status: "open"|"ended", createdAt, history: [{event, at, reason}], milestones: [...], nextMilestone, nonGoals: [...],
nextNonGoal}]`. Not a release field (an initiative spans releases) and not an epic (it is not a unit of delivery, and an
epic never spans releases). Ids use `EPIC_ID_FORMAT` (`constants.mjs`) in their own namespace; an initiative id may equal an
epic id without conflict.

**D2. Initiative milestones nest inside their initiative.** The owner: a milestone is meaningless without an initiative.
Nesting makes an orphan milestone unrepresentable, so no milestone reference can dangle. The shape reuses the mission exit
criterion pattern (`mission-record.mjs`): `{id: "mN", text, addedAt, removedAt?, removeReason?}`, stable ids, marked removed.
It carries no release, because a milestone sits outside any single release.

**D3. The 0.55.0 mission milestone is left untouched.** `mission.milestoneRelease` is a release and drives `criticalPath`
(`board.mjs`). Whether it stays, folds into initiative milestones or retires is the owner's call (Q1). Until then the two are
kept apart by name, as project-boards D7 did for plan stories: every human surface says "initiative milestone".

**D4. A release records one purpose; the initiatives it also serves are not recorded on it.** `release.initiative` (an id) or
`release.maintenance: true`, mutually exclusive. The owner: a release's attribution to initiatives is computed from its
epics. Recording secondaries on the release as well would be a second source of truth for what its epics already say, so
the secondaries live on epics only (`secondaryInitiatives`) and the attribution is computed by the later progress epic.

**D5. Spellings that keep 0.55.0's closed lists intact.** Several `project-boards` requirements close a list:
- `release --clear <field>` names exactly theme, rationale, exit, order, size and target. The release's new singletons
  therefore use project-boards D7's valueless `--clear-<thing>` form: `--clear-initiative`, `--clear-split-reason`.
- `mission`'s `--reason` serves exactly `--statement`, `--end` and `--remove-criterion`. Every non-goal and initiative
  milestone removal therefore carries its reason inline, `nN:<why>` / `mN:<why>`, split at the first colon: the gh#179
  `--unmember` precedent (`constants.mjs`). Not repeatable, for the same reason `--unmember` is not.
- `board-export`'s `rejected` kinds and reasons are closed, and its `mission` object is a fixed `{statement, setAt, reason}`.
  So mission non-goals are a top-level `missionNonGoals` key, and a dangling initiative reference reads `null` with the
  report left to `integrity` (D7). Adding top-level keys contradicts nothing: board-export names what SHALL be present.
- The epic flags go through the open, registry-driven `update-epic --clear` (nullable rows), which has no closed list.

**D6. The challenge is a warning at the transition, not a judgment by the engine.** The engine cannot decide that work is
off-mission; it can check that fields are present. It warns on the `owesSummaryWarning` transition (`epic-summary.mjs`):
leaving `untriaged`, or registration into a live status. Firing only at that transition is what makes "challenged once"
mechanical, and the recorded reason field is the "already answered" marker. Off-mission judgment is the agent's, carried by
the conductor skill and the `## Initiatives` section; the engine only stores `offMissionReason`. Three scoping choices,
each beyond the brief and reported as such:
- The warning fires only while at least one initiative is `open`. Before any initiative is derived, every triage would warn.
- A `health` epic needs no initiative: health is the 20% that is by definition not initiative work.
- `release --member` warns (never refuses) when the epic does not serve the release's primary; a maintenance release, or one
  with no primary, never warns.

**D7. Dangling initiative references are an integrity finding.** No verb deletes an initiative (it ends, D8), and every flag
that names one refuses an unknown id, so a dangling reference needs a hand edit. `integrity` (`scripts/lib/integrity.mjs`,
`runIntegrity`) is pm's existing reporter of hand-edit damage, and it reports one; the export reads it as `null`.

**D8. An initiative ends, never deletes.** `--end --reason "<why>"` and `--reopen --reason "<why>"` append to a history,
spelled exactly as `mission --end --reason` so one operation has one spelling, and following gate item 6 (end by recording, never by removal). Whether ending carries an outcome vocabulary is Q7.

**D9. The split counts epics.** Epics carry no size and release `--size` is semver impact, so the epic count is the only
measure computable today. Unclassified members are counted and excluded from the share. Weighting is Q4. The `claude-code`
lane is exempt from the challenge only; its members count in the split by their kind until Q5 says otherwise.

**D10. Drift has a named tolerance whose value is the owner's.** `HEALTH_DRIFT_TOLERANCE` in the release module. The spec's
scenarios (10/0 drifts, 8/2 does not) hold for any tolerance between 0 and 0.2, so the RED tests can be written now; the value
is set from Q3 before task 4.2, and task 0.5 writes the number into the release-planning spec once answered. The target is fixed at 0.2 (Q13 asks whether it may be set per project).

**D11. An override is a reason, not a setting.** `splitReason` is displayed beside the drift and changes nothing else. No
`OPT_INS` row, no switch: the owner said the report is not a setting to turn off.

**D12. Non-goals are one shared module.** `scripts/lib/non-goals.mjs` holds the shape, validation (`lineFieldError` from
`epic-summary.mjs`, 300 characters, control characters escaped by `escapeControls`) and the add and remove operations, so the
four records cannot drift apart. Ids are per record (`nextNonGoal` on each). The cap of 300 matches mission statements and
criteria.

**D13. `## Initiatives` is a verb-refreshed section with its own cap.** The `## Mission` section is already near its 280-byte
cap (head and tail about 97 bytes, statement truncated), so nothing is appended to it. The new section is present only while
an initiative is open, capped at 280 bytes, outside `CONDITIONAL_SECTIONS` (`rules-usage.mjs`), rewritten by `initiative`
when its text changes (the `mission` verb's pattern, `mission.mjs`), and attributed `rules:initiatives` → `core` in
`SURFACE_FEATURES` (`overhead.mjs`), as `rules:mission` is. Its code spans pass the emitted-invocations functional test.

**D14. Derive-and-confirm lives in skill text, in two existing homes.** Candidate derivation joins the `project-boards`
skill's "First population: Derive, then confirm" (task 8.15 of project-boards). The challenge-once procedure joins the
conductor skill's Intake. No new skill: a project assessment skill is out of scope.

**D15. `schemaVersion` stays 1.** Every `board --json` addition is a new key; no existing key's meaning changes.

**D16. Field caps follow the engine's existing conventions** (`--help`, 2026-11-12): titles 200 (as `--summary`),
capability 400 (as release `--theme`), milestones and non-goals 300 (as mission criteria), reasons 300 (as `--why-now`),
split reason 400 (as `--rationale`). All one line, validated before any write, echoed through `escapeControls`.

## Call sites (gate item 1, derived with `rg` on 2026-11-12; R.1 re-derives them)

- `rg -n "warnSummary\(" scripts/lib`: the transition sink the planning warning joins: `active-pointer.mjs:136`,
  `update-epic.mjs:1195`, `detour-stack.mjs:179-180`, `add-epic.mjs:522`, `add-many.mjs:266`. Every status writer that
  already warns for a missing summary warns for planning fields too, from the same call.
- `rg -n "lineFieldError\(" scripts/lib`: `update-epic.mjs:591`, `add-many.mjs:148`, `add-epic.mjs:495`, the validators the
  new one-line fields reuse.
- `rg -n "epicBatchKeys|epicFlagsFor" scripts/lib`: `constants.mjs` (definition), `update-epic.mjs`, `add-many.mjs`,
  `help.mjs`: a new registry row reaches add-epic, update-epic, add-many and `--help` through these projections.
- `rg -n "pushEpic\(" scripts/lib`: the creation sink (`state.mjs:136`, `subcommands.mjs` x3, plus add-epic and add-many
  through it). New epic fields are optional and seeded by nothing, so no creation site changes.
- `rg -n "missionSectionText|boardsSectionText" scripts/lib`: `rules.mjs`, `overhead.mjs:181`, `mission.mjs:196,206`,
  `boards-switch.mjs`: the rules-block section pattern `## Initiatives` copies, and the `rulesBlock` argument list it joins.
- `rg -n "rulesBlock\(|writeRules\(|currentMissionSection\(|currentBoardsSection\(" scripts/lib scripts/conductor.mjs`:
  three builders of the block (`rules.mjs:1334` in `writeRules`, `conductor.mjs:529` for the `rules` verb, `overhead.mjs:181`)
  each gain the `## Initiatives` argument; every other writer (`set-boards`, `mission`, tracker verbs, `review-mode`,
  `profile-verbs`, `spend-tracking`, `spend-guard-verbs`, `subcommands`, `migrations` for `upgrade`) goes through
  `writeRules`, so none can drop the section.
- `rg -n "SURFACE_FEATURES|CONDITIONAL_SECTIONS" scripts/lib`: `overhead.mjs:51`, `rules-usage.mjs:41`, `rules.mjs`,
  `spend-guard-verbs.mjs`.
- `rg -n "REJECTED_REASONS" scripts/lib`: `board.mjs:46` only; this change does not extend it (D5).
- `rg -n "missionOf\(" scripts/lib`: `mission-record.mjs`, `mission.mjs`: the readers that must carry `nonGoals`.
- `rg -n "releaseSummaries" scripts/lib`: `constants.mjs:215`, `briefing.mjs`, `render.mjs`, `releases.mjs`: release
  readers; the split is computed in the release module and read by `release show`, `board` and the template only, not by
  the brief or `PROJECT.md`.
- `rg -n "VERB_EFFECTS" scripts/lib/verb-effects.mjs`: the `release` and `mission` rows' `writes` text gains the new keys; a
  new `initiative` row (mutates; `show` writes nothing).

**Data references (gate item 1).** Fields that hold another record's id:

| Holder | Writers | Readers | Removers |
|---|---|---|---|
| `epic.initiative` | add-epic, update-epic, add-many | board, warning, initiative show (counts), integrity | `update-epic --clear initiative`; `remove-epic` removes the holder |
| `epic.secondaryInitiatives[]` | same | board, member warning, integrity | `--remove-secondary-initiative`; `remove-epic` |
| `release.initiative` | `release --initiative` | board, release show, member warning, integrity | `--clear-initiative`, `--maintenance` |
| initiative milestones and non-goals | `initiative` | board, initiative show | marked removed only |

An initiative is never removed, so none of these can dangle through a verb; a hand edit is reported by `integrity` (D7).

## Inverses (gate item 1)

| Operation | Inverse | Shipped |
|---|---|---|
| `initiative <id>` create | `--end --reason "<why>"` (history kept) | yes |
| `initiative --end` | `--reopen --reason "<why>"` | yes |
| `initiative --title`, `--capability` | a new value | **no clear**, deliberate: both are required on create, as release `intent` |
| `--add-milestone` | `--remove-milestone "mN:<why>"` (marked, not deleted) | yes |
| `--add-non-goal` (four records) | `--remove-non-goal "nN:<why>"` (marked) | yes |
| `release --initiative` / `--maintenance` | `--clear-initiative`; each replaces the other | yes |
| `release --split-reason` | `--clear-split-reason` | yes |
| `--initiative` (epic) | `update-epic --clear initiative` | yes |
| `--secondary-initiative` | `--remove-secondary-initiative` | yes |
| `--kind` | `update-epic --clear kind` | yes |
| `--off-mission-reason`, `--off-initiative-reason` | `update-epic --clear off-mission-reason`, `--clear off-initiative-reason` | yes |
| initiative delete | none | **no**, deliberate: ending records, deletion destroys (gate item 6) |
| the 80/20 report | none | **no**, deliberate: the owner said it is not a setting to turn off |

## Amendments owed to 0.55.0 specs

None. D5 picks spellings so that no `project-boards` requirement is contradicted. The cross-spec review (task 0.4) checks
this claim against the whole 0.56.0 set plus the 0.55.0 specs it extends.

## Risks / Trade-offs

- [Warning noise once initiatives exist] → it fires only at the transition, never re-fires once a reason is recorded, skips
  `claude-code` and `health`, and is off while no initiative is open.
- [Rules-block bytes in every repo] → present only while an initiative is open, capped at 280, README cost row.
- [Two milestone concepts confuse readers] → distinct names on every surface until Q1 is answered.
- [Count-based split misleads when epics differ widely in size] → stated on the board as "by epic count"; Q4.
- [Later progress epic lacks a planning baseline] → Q11: if 0.56.0 must start capturing when an epic joined an initiative,
  that field must be added here, because history cannot be reconstructed later.

## Migration Plan

Additive. Every new key is optional and absent means today's behaviour: no initiative, no non-goals, unclassified kind, no
release purpose, a split of all-unclassified. No existing value is transformed, so no `MIGRATIONS` entry is added; task 8.2's
unit test loading a 0.55.0-shaped fixture is the evidence. If an answer to an Open question requires a transform (for example
Q1 folding the mission milestone into an initiative), that answer adds a `MIGRATIONS` entry keyed to 0.56.0, additive and
idempotent, in the same task. Rollback is reinstalling 0.55.0; whether it tolerates the new keys is not claimed here.

## Open questions

Owner answers needed; none is guessed in the specs. Q3 blocks task 4.2; Q1 and Q11 block task 1.1; the rest can land later.

- Q1. Is the 0.55.0 mission milestone (a release) kept beside initiative milestones, folded into them, or retired?
- Q2. What epic size weights initiative progress, given epics carry no size today and release `--size` is semver?
- Q3. What drift tolerance around the 20% health target raises the drift flag?
- Q4. Is the 80/20 split counted by epic (as specced) or weighted by size once a size exists?
- Q5. Do claude-code-lane epics count in the 80/20 split, or are they excluded from it as well as from the challenge?
- Q6. How is an initiative milestone reached: recorded by the agent, checked mechanically, or derived from its epics?
- Q7. Does ending an initiative carry an outcome (delivered, abandoned, superseded) like an epic's disposition?
- Q8. Should a release be flagged when none of its members serves its primary initiative?
- Q9. Is an initiative itself challenged against the mission, with its own recorded reason?
- Q10. Should an initiative record the evidence it was derived from (a source field), or is the user's confirmation enough?
- Q11. Must 0.56.0 start recording when an epic joined an initiative, so the later progress epic has a "since planning" baseline?
- Q12. Should mission non-goals reach the managed rules block so subagents see them, and at what byte cost?
- Q13. Is the 20% health target fixed for every project, or settable per project with a recorded reason?
