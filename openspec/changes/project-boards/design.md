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

**D1. One snapshot verb, not a family of exports.** `board --json`, in `scripts/lib/board.mjs`, reads the
`resolveEpics()` order (`scripts/lib/epic-progress.mjs`: effective priority, then merit priority, then rank, then
lane, then id). That is the order `render()` writes to `PROJECT.md`. It is not the brief's NEXT UP order, which also
runs `orderQueueWithDependencies` over queued and untriaged epics (`briefing.mjs`). Membership comes from
`releaseSummaries` (`scripts/lib/constants.mjs`) and the derived membership in `scripts/lib/releases.mjs`. Outcome
reading uses `outcomeOf` (`scripts/lib/disposition.mjs`), the same reader `list --json` uses.
*Alternative:* #269's `export --format json`, which would version a copy of the state layout. Rejected, because a
board-shaped snapshot computes the derived values (`delivered`, `dependsOn`, status, `criticalPath`) once, and #270
is about exactly that.

**D2. The unit rung and `resolveEpics()`'s disk read.** `resolveEpics()` calls `activeChangeIds()`, which reads
`openspec/changes/`, and it invents untriaged epics for unregistered changes. Task 1.1 first extracts its sort and
effective-priority step into a pure exported function over an epic list. `resolveEpics()` calls that function, so
behaviour is unchanged and the existing ordering tests still pass. `board.mjs` then splits in two:
- a pure `boardSnapshot(state, resolved)` that unit tests call with fixtures;
- a verb wrapper that calls `resolveEpics(state)`.

The board drops invented epics (`known` has no id for them) and counts them in `counts.unregisteredChanges`. The
wrapper is covered by the `VERB_EFFECTS` `exercise` row, which the existing read-only check runs. That check sits in
the functional bucket, so staging `verb-effects.mjs` demands a functional certify. That cost is the registry's
standing price for every read-only verb, and this change adds no functional test file.

**D3. No git in the engine export.** The skill gets `head` from `git rev-parse --short HEAD`. With git inside it,
`board` would gain a functional test subject for one short string.

**D4. `delivered` has three states, via the one reader.** `outcomeOf` returns `unknown` for engine stamps
(`engineStamp`, `disposition.mjs`; stamped by `migrations.mjs`, `epic-progress.mjs` and `subcommands.mjs`), so an
engine stamp with outcome `unknown` is `null`. An engine stamp CAN carry `delivered`: the migration writes it where a
passing Gate 2 exists. Such an epic reads `true`, because `delivered` follows the outcome, never who stamped it. An archived epic with no disposition reads `null`, like an `unknown` stamp, and is never `true`. This repo has 0 of the
latter today (jq over `.conductor/state.json`, 2026-11-09). The research doc's "no outcome counts as delivered" rule
is not adopted.

**D5. Release status is derived, not recorded.** #268 asks for a `status` field, but `--deliver` already records
shipping, and two stored truths can disagree. The vocabulary is `planned | in-progress | shipped`. `--deliver` takes
precedence. All members archived without `--deliver` reads `in-progress`, because the work is done and delivery is
not recorded. A release with no members reads `planned`. #268's `scope` maps to the existing `intent`. The brief's
"size weight" and "semver impact" become one `--size`, which records semver impact; size weight is declined.

**D6. Where the mission lives (brief §5, resolved).** A top-level `state.mission`:
`{current: {statement, setAt, reason} | null, history: [{statement, setAt, reason, endedAt, endReason}],
milestoneRelease: id | null, criteria: [{id, text, check, needsHuman, addedAt, removedAt?, removeReason?}],
nextCriterion: n}`. It is not a release field, because the mission spans releases. It is not a `record-decision`
entry, because decisions are a per-epic log and the mission is current state with a history. The mission milestone
points to a release, and critical path derives from release `order`. Plan position lives in
`state.releasePlan = {here, hereText, nextText}`.

**D7. Vocabulary.** The engine already uses "milestones" for a Superpowers plan's stories (`add-epic.mjs`). Every new
surface says "mission milestone", and the state key is `milestoneRelease`. The unset spellings follow one rule, except that `set-project` and `set-profile` use `--unset <name>` (a value naming which field to remove):
- `--clear <field>` removes a named field. It takes a value and matches `update-epic --clear`.
- `--clear-<thing>` removes a singleton (`mission --clear-milestone`, `release here --clear-here`). It is valueless.
  It gets its own registry row, because a single verb cannot declare `--clear` both with and without a value
  (`constants.mjs`, the `set-lane-routing` `clear` row).
- `mission --end` is different. Ending a mission is a lifecycle event that carries a reason and a history entry. It
  is not a field clear.

**D8. Summary and why-now are new fields beside `description`.** `description` is multi-paragraph rationale, set on 64
of 353 epics. A board needs one line, and overloading `description` would truncate the rationale. The warning ships
now. The refusal is a follow-up epic one release later (Rob's call: warn first).

**D9. Drag is a whole-band proposal in the database; the agent applies it.** This keeps a single writer (Rob's call).
The collection is `proposals/rank`, writable only at `admin`. That makes it a third page-written collection beyond
`answers` and `backlogMeta`, which are written at `interact`.
- **Bands are merit priority**, because `reorder` takes a merit band and refuses a partial one (`rank.mjs`). The
  proposal therefore carries the whole band.
- **A lifted blocker is not draggable.** Its effective priority differs from its merit priority, so the board displays it at a
  different effective position than the one `reorder` ranks it at. Bands use `meritPriority`, so the band is the same,
  and a drag there would not land where the page shows it.
- **Within a merit band, rank decides.** `resolveEpics()` has no dependency pass, so no snap-back follows a valid
  proposal. The page's dependency warning tells the human when a dependency is ranked below its dependent.
- **One bad id refuses the whole proposal.** A partial apply would leave a rank no human asked for.
- **The agent deletes the proposal after applying it.** That is the inverse, and it prevents a second apply.

**D10. Authorization is the database rules.** Page checks are UI gating only, and `by` fields are not attribution.
The declaration lists every collection explicitly. This responds to the 2026-11-09 automated review of the reference
template, which escapes titles but interpolates `it.id` and `it.prio` raw, and checks access client-side.

**D11. Two id formats, on purpose.** The engine writes ids under `EPIC_ID_FORMAT` (`/^[a-z0-9][a-z0-9._-]*$/`,
`constants.mjs`). The board checks the wider `/^[A-Za-z0-9._-]+$/`, which is what the page itself enforces. That
check is the boundary for hand-edited or legacy records, and it catches every markup-bearing character. It is not a
second engine id rule. An engine-written id always passes it.

**D12. URLs are scheme-checked twice.** `externalUrl` has no format check on write (`constants.mjs` flag registry), so
the export emits only http and https URLs, and the page links only http and https URLs. Escaping does not stop a
`javascript:` href. A scheme check does.

**D13. Testable templates.** Each template keeps its render functions as pure data→string builders inside one marked
script block. A file-rung test loads the template bytes, extracts that block and evaluates it under `node:vm` with no
DOM. The boot code (`claude.use`, `onSnapshot`) stays outside the block.

**D14. Default on, by the existing opt-in pattern.** An absent setting reads as on (`feature-switches`: "Upgrade
leaves a default-on feature on"), so no MIGRATIONS entry is needed. The announcement is keyed on the upgrade's
from-version and to-version rather than a stored flag, so it writes nothing.

**D15. Boards and mission are verb-refreshed sections.** `overhead` attributes surfaces per rules heading plus one
`brief` surface (`overhead.mjs`). So the boards text is its own `## Boards` section (`rules:boards` → `boards`), and
the brief's boards line becomes its own surface (`brief:boards` → `boards`), subtracted from `brief`. The mission is a
`## Mission` section (`rules:mission` → `core`). Like the tracker sections, both stay outside `CONDITIONAL_SECTIONS`
(`rules-usage.mjs`), and their verbs rewrite the block. The mission is in the rules block (brief §4 item 1) because
subagents receive CLAUDE.md only, and the mission is what bounds autonomous work.

**D16. One command doc for the boards.** `commands/boards.md` documents `/pm:boards`, the `board` verb and
`set-boards`. There is no `/pm:board` one letter away from `/pm:boards`. Rob dictates, and the two would be misheard.

**D17. Artifact URLs live in `docs/artifacts/artifacts.md`, not in state.** pm records nothing about a hosted page.
The registry file is how the skill finds the board on the next refresh.

**D18. Ended-epic window of 50 by default.** This repo has 320 archived epics, and a full mirror would add 7 write
batches to every refresh. `--archived all` covers the one-off case.

**D19. Decisions are agent-sourced.** pm records decisions already made (`record-decision`), not open questions.
The release plan's decisions table holds the questions the agent is asking now, written by the agent and labelled as
such. A pm-recorded open-question object would be a follow-up, and none is proposed here.

**D20. Jira-style keys: store a number, derive the key (board redesign, 2026-11-11).** An epic stores only an integer `number`; the project
stores `projectKey` and `projectName` (`set-project`) and a counter `nextEpicNumber`. The displayed key `PM-256` is derived on read, so
changing the key renames nothing on disk. The rule lives in `pushEpic` (via `assignEpicNumber`), the one sink every registration path
routes through, so a fifth path cannot skip it. An issue number below 1000 becomes the epic number where it is free, so `PM-256` is issue 256;
everything else takes the counter, whose first value is 1000 (the floor), skipping held numbers. The counter is persisted and only advances, so a number is never reused.
`set-project` writes the record only: it needs no render and does not touch the managed rules block, so it adds no overhead row.

**D21. `schemaVersion` stays 1.** The `project` object, the epic `number`/`key` and the release `progress` are additive keys, and the
snapshot has not shipped (0.55.0 is unreleased), so there is no consumer to break and the "meaning of an existing key changed" rule
does not fire. The export emits `project: {name: null, key: null}` while unset and never derives a name or key.

**D22. Release progress reads the entries, not the records.** `progress` is computed from the epic entries the export already builds
(`delivered`, `outcome`), over every member in the record, so it cannot disagree with an epic row and is not clipped by the ended-epic
window. "Non-declined" is read literally: only outcome `declined` leaves the denominator; a killed or superseded member keeps the release
below 100% until it is removed from it (`release --unmember`).

**D23. Counter floor at 1000 (owner decision, 2026-11-11; it replaces the earlier max+1 counter).** The counter starts at 1000, not one past
the largest number held, so local numbers (PM-1000 and up) can never meet an issue number below 1000: the collision the max+1 rule left
open (backfill handing a code-name epic 271 in a repo whose issues ran to about 270, so a later issue 271 lost its own number) is closed
by construction. A tracker number at or above 1000, or already held, falls back to the counter, so its key then differs from its issue
number; that is the only remaining case. The rule is one function: `epic-number.mjs` (`EPIC_NUMBER_FLOOR`, `keepsTrackerNumber`), used by
`pushEpic` and by the 0.55.0 backfill and `upgrade` renumbering alike. A stored counter below the floor (an unreleased 0.55.0 record) is
raised to it; valid numbers already held are never changed (a duplicate is the one exception: `stampEpicNumbers` keeps the earlier holder in array order and renumbers the later).

## Inverses (gate item 1, enumerated here so the R.1 task can check them)

| Operation | Inverse | Shipped |
|---|---|---|
| release plan field set | `release <id> --clear <field>` | yes |
| `release here <id>` | `release here --clear-here` | yes |
| `mission --statement` | a new statement, or `mission --end` (history kept) | yes |
| `mission --milestone` | `mission --clear-milestone` | yes |
| `mission --add-criterion` | `mission --remove-criterion` (marked, not deleted) | yes |
| `--summary`, `--why-now` | `--clear summary`, `--clear why-now` | yes |
| `set-boards off` | `set-boards on` | yes |
| `set-project --name`, `--key` | `set-project --unset name`, `--unset key` | yes |
| epic number assigned | none, by design: a number is never reassigned or freed, and `nextEpicNumber` only advances. `remove-epic` removes the epic and its number with it; the number can return only through a later epic whose `externalId` is that integer | **no**: deliberate |
| `release <id> --target` | `release <id> --clear target` (added in 8.5; `target` had none) | yes |
| `release <id> --intent` | none: `intent` has no `--clear`, because creating a release without one is refused | **no**: deliberate |
| rank proposal written by drag | deleted by the agent after `reorder`; `reorder` again to undo the rank | yes |
| backlogMeta Not-pursuing mark | page Restore | yes |
| seed writes an `epics` doc | refresh deletes it when the export drops the epic | yes |
| agent writes a `decisions` doc | agent deletes it when the question is answered or withdrawn | yes |
| artifact publish | artifact delete | **no**: user-only. Deleting a shared page breaks the link for everyone, and the Artifact tool requires the user to confirm |
| answers submitted | none | **no**: the answers are the user's record. The agent reports them and never clears them |

## Risks / Trade-offs

- [Rules-block and brief bytes in every pm repo] → caps (`## Boards` and `## Mission` at most 280 bytes each, brief
  line at most 160), README cost rows, and boards can be turned off.
- [The artifact database rule syntax may change] → the skill states the rules in one place, and the R.1 sweep names it.
- [A stale page proposes against a newer backlog] → the whole proposal is refused and deleted.
- [The template inherits the reference's design] → the security requirements apply to every shipped line, and the
  reference copy stays verbatim and unshipped.
- [Headless `claude -p` has no artifact-data tool] → the skill says so and uses the standalone fallback.

## Migration Plan

Additive, with one transform. A 0.54.0 state file loads without error and keeps every existing value, because every new key is optional and absent means today's behaviour
(with boards on); a `MIGRATIONS` entry keyed to 0.55.0 then adds a number to each epic (D20; the same function also runs on every `upgrade`). Task 7.3 is the evidence: a unit test loads a 0.54.0-shaped fixture. Rollback is reinstalling the
prior plugin version. Whether that version tolerates the new keys is NOT claimed or tested here. If it matters, it is
a separate check at the release cut. Boards stay in the user's account until the user deletes them.
