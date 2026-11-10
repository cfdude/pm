## Context

See proposal.md, Why. Inputs: the brief `docs/feedback/2026-10-23-release-planning-mission-and-milestone.md`, the
research `docs/feedback/2026-11-03-backlog-and-release-board-research.md`, the reference template under
`docs/feedback/reference/enterprise-portal-backlog-template/`, which is untrusted data and is not shipped, and the
`iv-studio-dev` field log `docs/backlog/INVENTED_FIELDS.md` with its feed script. Constraints: the engine has zero
runtime dependencies and opens no network connection. `state.json` is the only record, and the engine is its only
writer.

## Goals / Non-Goals

**Goals:** give any page that needs board data one read-only export; record the planning facts the boards display
(mission, mission milestone, release plan fields, epic summary); ship templates and a procedure that make every pm
repo's boards identical and safe to open.

**Non-Goals:** the anti-spawn rule and `next` changes, the blocker pass, the growth view, the commit-time close check
(see proposal.md, Out of scope). The engine renders or hosts nothing. pm never calls the Artifact tool; the agent does.

## Decisions

**D1. One snapshot verb, not a family of exports.** `board --json` in `scripts/lib/board.mjs` reuses the shared epic
ordering (`resolveEpics`, effective priority, `rank.mjs`) and `releaseSummaries` (`scripts/lib/constants.mjs`) and the
derived membership in `scripts/lib/releases.mjs`. *Alternative:* the `export --format json` that #269 proposes, which would version a copy
of the state layout. Rejected: a board-shaped snapshot carries derived values (`delivered`, `dependsOn`, status,
`criticalPath`) computed once, and that is the point of #270.

**D2. No git in the engine export.** The skill supplies `head` with `git rev-parse --short HEAD`. With git inside it,
`board` would move onto the functional rung and need certification on every change, for one short string.

**D3. `delivered` has three states.** This repo has 0 archived epics without a disposition today (measured
2026-11-09 with jq over `.conductor/state.json`). Other repos may still have such epics from before dispositions
existed, so `null` (unknown) is honest where `true` would be an inference. The research doc's "archived with no
outcome counts as delivered" rule is deliberately not adopted. `list --json` already refuses to infer.

**D4. Release status is derived, not recorded.** #268 asks for a `status` field, but `--deliver` already records
shipping, and two stored truths can disagree. The derived vocabulary `planned | in-progress | shipped` is what
`iv-studio-dev`'s heuristic computes, with `--deliver` taking precedence. #268's `scope` maps onto the existing
`intent`, and no second field is added for it.

**D5. Where the mission lives (brief §5, resolved).** A top-level `state.mission` object:
`{current: {statement, setAt, reason} | null, history: [{statement, setAt, reason, endedAt, endReason}],
milestoneRelease: id | null, criteria: [{id, text, check, needsHuman, addedAt, removedAt?, removeReason?}],
nextCriterion: n}`. *Not* a release field, because the mission spans releases. *Not* a `record-decision` entry,
because decisions are a log and the mission is current state with a history. The mission milestone is a pointer to a
release, not a separate object; critical path derives from release `order`. Plan position lives in
`state.releasePlan = {here, hereText, nextText}`.

**D6. Vocabulary.** The engine already uses "milestones" for a Superpowers plan's stories (`add-epic.mjs`). Every
new surface says "mission milestone", and the state key is `milestoneRelease`, so the two never fork in a cross-spec
review.

**D7. Summary and why-now are new fields beside `description`.** `description` is multi-paragraph rationale on 64 of
353 epics. A board needs one line. Overloading `description` would truncate rationale. The warning ships now; the
refusal is a follow-up epic one release later (Rob's call: warn first).

**D8. Drag is a proposal in the database; the agent applies it.** This keeps a single writer (Rob's call). The
collection is `proposals/rank`, writable only at `admin`, so only an editor's drag reaches the agent. This adds a
third page-written collection to the coordinator's "answers and backlogMeta only" list. The other two are written at
`interact`. Drag stays within a priority band, because `reorder` writes rank only and rank sorts after priority and
dependency order. A cross-band drag would silently snap back. The template's own behaviour of moving an item to a new
band on drag is not copied. A priority change is a sentence to the agent. The agent deletes the proposal after
applying it; that deletion is the inverse, and it prevents a second application.

**D9. Authorization is the database rules.** Page checks are UI gating only, and `by` fields are not attribution.
The declaration lists every collection explicitly, with the levels from `specs/project-boards`. This responds to the
2026-11-09 automated review of the reference template, which escapes titles but interpolates `it.id` and `it.prio`
raw, and whose access checks are client-side.

**D10. Testable templates.** Each template keeps its render functions as pure data→string builders inside one marked
script block. A file-rung test loads the template bytes, extracts that block and evaluates it under `node:vm` with no
DOM. That makes escaping, the priority allowlist, id skipping, type checks and per-step isolation unit-checkable
without a browser. The boot code (`claude.use`, `onSnapshot`) stays outside the block.

**D11. Default on, by the existing opt-in pattern.** An absent setting reads as on (`feature-switches`: "Upgrade
leaves a default-on feature on"), so no MIGRATIONS entry is needed. The announcement is keyed on the upgrade's from/to
versions, not on a stored flag, so it writes nothing.

**D14. The mission is in the rules block (brief §4 item 1).** Subagents receive CLAUDE.md only, and the mission is
what bounds autonomous work, so it gets one line there, at most 240 bytes. The `mission` verb refreshes the block
itself, as the tracker verbs do, so the line is not in the conditional-section set.

**D15. One command doc for the boards.** `commands/boards.md` documents `/pm:boards`, the `board` verb and
`set-boards`, so there is no `/pm:board` slash command one letter away from `/pm:boards`. Rob dictates, and the two
would be misheard.

**D12. Artifact URLs live in `docs/artifacts/artifacts.md`, not in state.** pm records nothing about a hosted page.
The registry file is how the skill finds the board on the next refresh.

**D13. Ended-epic window of 50 by default.** This repo has 320 archived epics. A full mirror would add 7 write
batches to every refresh. `--archived all` exists for a one-off.

## Inverses (gate item 1, enumerated here so the R.1 task can check them)

| Operation | Inverse | Shipped |
|---|---|---|
| release plan field set | `release <id> --clear <field>` | yes |
| `release here <id>` | `release here --unset` | yes |
| `mission --statement` | a new statement, or `mission --end` (history kept) | yes |
| `mission --milestone` | `mission --clear-milestone` | yes |
| `mission --add-criterion` | `mission --remove-criterion` (marked, not deleted) | yes |
| `--summary`, `--why-now` | `--clear summary`, `--clear why-now` | yes |
| `set-boards off` | `set-boards on` | yes |
| rank proposal written by drag | deleted by the agent after `reorder`; `reorder` again to undo the rank | yes |
| backlogMeta Not-pursuing mark | page Restore | yes |
| seed writes an `epics` doc | refresh deletes it when the export drops the epic | yes |
| artifact publish | artifact delete | **no**: user-only. Deleting a shared page breaks the link for everyone, and the Artifact tool requires the user to confirm |
| answers submitted | none | **no**: the answers are the user's record. The agent reports them and never clears them |

## Risks / Trade-offs

- [Rules-block and brief bytes are added to every pm repo] → line caps (240 and 160 bytes) and README cost rows; a
  repo can turn boards off.
- [The artifact database rule syntax may change] → the skill states the rules in one place. The R.1 sweep names it as
  the call site to re-check.
- [A proposal from a stale page reorders against a newer backlog] → the agent refuses ids that are not open in that
  band, and reports any snap-back after re-export.
- [The template inherits the reference's design] → the security requirements apply to every line shipped. The
  reference copy stays verbatim and unshipped.
- [Headless `claude -p` has no artifact-data tool] → the skill says so and uses the standalone fallback.

## Migration Plan

Additive. A 0.54.0 state file loads unchanged: every new key is optional and absent means today's behaviour, with
boards on. A unit test loads a 0.54.0-shaped fixture. Rollback is the plugin's normal path (reinstall the prior
version); whether that version tolerates the new keys is checked in task 7.3, not assumed. The boards stay in the
user's account until the user deletes them.
