# Design: usage-conditioned rules-block sections

## Context

See proposal.md for the motivation. Current state, verified on disk 2026-11-02 against engine 0.53.0:

- `rulesBlock(tracker, reviewMode, secondaryTrackers, platform, profile, spend, guard)`
  (`scripts/lib/rules.mjs:693`) emits `## Epic-level autonomy` (lines 813–852) and
  `## Release candidate` (lines 889–906) unconditionally. Spend tracking and spend guard are already
  conditional on the two trailing booleans.
- Three callers render the block from state: `writeRules()` (`rules.mjs:1220`), the `rules` verb
  (`scripts/conductor.mjs:516`) and `overhead.rulesBlockFor()` (`scripts/lib/overhead.mjs:168`). Tests
  call `rulesBlock(` directly 61 times in 15 files (`rg -c "rulesBlock\(" scripts/test`).
- The spend-guard section is kept current by `refreshSpendGuardSection(before, after)`
  (`scripts/lib/spend-guard-verbs.mjs:186`). The dispatch wrapper's `finally` calls it
  (`conductor.mjs:586`) for a mutating, non-hook verb whose write moved `revision`. It compares
  `rulesBlockShowsSpendGuard()`, the section on disk, with `guardConfigured(after)`.
- Text outside the two sections that refers to them: the outward-tracker paragraph
  (`rules.mjs:952–958`, 639 B of string content, measured from the source lines), which cites "decision-rule item (d)". Operating rule 7
  (`rules.mjs:783`) and Reporting (`rules.mjs:524`) name the preflight scan and the end-of-epic
  report as kinds of work. They do not point at the section, so they stay.
- The `conductor` skill (`skills/conductor/SKILL.md:1122`) says the decision rule "is in the rules
  block". The release-candidate skill is loaded by name.
- A release is "delivered" when `releases[i].delivered` is an object (`releases.mjs:352–358`).
  `--undeliver` deletes it. No verb removes a release.
- A HOOK can write a predicate input. `reconcileArchived()` (`scripts/lib/epic-progress.mjs:204`)
  sets `status = "archived"` (line 208). It runs from the `commit-nudge` hook
  (`scripts/lib/subcommands.mjs:854`), from `render()`'s self-heal and from `upgrade`
  (`scripts/lib/migrations.mjs:235`).
- `sync` matches an openspec change to an epic by id only (`subcommands.mjs:1020`). The change id is
  therefore the epic id, `gh-cfdude-pm-248`, so no duplicate epic is registered.

**Vocabulary.** The *usage-conditioned sections* are the two this change makes conditional:
Epic-level autonomy and Release candidate. The *conditional sections* are those two plus Spend
tracking and Spend guard: the four rows of `CONDITIONAL_SECTIONS`, refreshed and announced as one
set. The pointer belongs to neither set.

## Goals / Non-Goals

**Goals:** each conditional section appears and disappears with its condition, after any verb, any
inverse, and any hand-edit followed by an engine write. One predicate per condition. The default
render of `rulesBlock()` stays byte-identical.

**Non-Goals:** a `lean|full` dial or a new `OPT_INS` id (the issue's "optional" half). Conditional
emission of the gate procedure, intake or reporting: these are record-integrity rules, and
`feature-switches` already declines to switch them. A hierarchy section: the block has none today.
Re-loading `CLAUDE.md` into a live session: the host does not do that, and the engine cannot.
Costing `upgrade`'s `NOT SET` opt-in nudge, the issue's incentive point: that is the follow-up epic
`opt-in-nudge-shows-running-cost`.

## Decisions

**D1. One usage object, not positional args 8 and 9.** `rulesBlock()` gains one trailing parameter,
`usage = FULL_USAGE`, where `FULL_USAGE = { autonomy: true, releaseCandidate: true }`. Defaulting to
the full block keeps every existing test call byte-identical. A future caller that forgets the
argument over-emits rather than drops a rule, which is the safe failure. Alternative rejected: an
options object replacing all seven positionals. That churns 61 test calls in 15 files for no behaviour, and is
a separate refactor.

**D2. The predicates live in one module and are pure over a state object.**
`rulesUsage(state)` returns `{ autonomy, releaseCandidate }`:
- `autonomy`: some epic with `status !== "archived"` has a non-null `autonomy` object. Presence, not
  level: the preflight writes grants and context before `--level autonomous`, and the decision rule
  must already be on disk when the level flips. Level `off` keeps the section because re-arming
  restores the kept grants (epic-autonomy "Turning autonomy off does not revoke").
- `releaseCandidate`: some entry in `state.releases` has no truthy `delivered`. This was chosen over
  "any release exists", the plan's wording, because no verb removes a release. That predicate would
  have no shipped inverse. `--deliver` and `--undeliver` are real inverses, and a delivered release
  needs no candidate procedure.
  A finer predicate was considered and declined: "no delivered marker AND (no members OR some
  non-archived member)". It would retire the section for this repo's stale undelivered releases, but
  members are derived from the epics, so every member add, archive, un-archive and `--unmember` would
  become an inverse to specify and test, for a gain `release <id> --deliver` already gives in one
  explicit command.

`writeRules`, the `rules` verb, `overhead.rulesBlockFor` (real report only; D6) and the refresh (D4)
all call it. A
`currentRulesUsage()` wrapper reads the loaded state, like the other `current*()` readers.

**D3. The always-on pointer replaces the absent text with a route to it.** A
`## Procedures emitted on use` section sits in the autonomy slot (after Reporting). It is emitted
while either usage flag is false and holds one line per absent procedure: "Before the first
`set-autonomy`, load the `conductor` skill's "Epic-level autonomy — the preflight scan"" and
"Before the first `release`, load the `release-candidate` skill". It ends with one line saying the
section appears in this block once the feature is in use. Budget: at most 400 B, held by a test.
Without this pointer, the preflight rule ("before flipping the switch") would arrive only after the
first write it governs. Net saving on a fresh repo is 4,310 B minus the pointer. The bound is at
least 3,910 B, which is more than the 558 B the mutation item needs.

**D4. Generalise the spend-guard refresh into one table.** `CONDITIONAL_SECTIONS` is THE set of
conditional sections, declared once and read by the refresh, the notice (D5) and the coverage test.
It holds four `{ heading, shown(state) }` rows: Spend tracking (`spendEnabled`), Spend guard
(`guardConfigured`), Epic-level autonomy and Release candidate. The pointer is not a row: its
presence is derived from the autonomy and release-candidate rows, so a block that agrees on those
two agrees on it. Tracker sections are not rows either. Their headings are parameterised
(`External tracker sync (jira · ABC)`), and every verb that changes a tracker already calls
`writeRules()` itself (`scripts/lib/tracker.mjs:118,140,226`). `rulesBlockShowsSpendGuard()` becomes `rulesBlockHeadings()`,
which returns the set of `## ` headings inside the one managed block, or `null` with no block or an
ambiguous one. `refreshSpendGuardSection` becomes `refreshConditionalSections(before, after)`.
- It rewrites once if any row's presence on disk differs from `shown(after)`.
- It keeps the guard's existing properties: it is called only from the wrapper's existing
  `guardBefore` branch, so a hook does no work; it reads no extra state image; a failure prints a
  warning naming the disagreeing section and `write-rules`, in section-generic wording.
- A hook's archive self-heal (Context) can therefore leave the block stale. The next non-hook write
  corrects it, which is the precedent the spend-guard spec already set for the same hook.
- It compares the block on disk with state, not `before` with `after`. That is what makes a
  hand-edit converge at the next engine write.

A coverage test renders `rulesBlock()` over every combination of the spend-tracking, spend-guard and
usage inputs, with no tracker. It asserts that every heading present in some combination and absent
in another is a row or the pointer, so a future conditional section cannot be left out of the
refresh. Tracker inputs are out of the test's scope for the reason above.

**D5. The appearance notice lives in `writeRules()`, not in the refresh.** Several verbs call
`writeRules()` themselves: `set-spend-guard`, `set-spend-tracking`, the tracker verbs,
`set-review-mode`, the profile verbs and `upgrade`. When one of them adds a heading, the wrapper's
refresh then finds disk and state already agreeing and would print nothing. A notice placed in the
refresh would be a guard at one call site with its siblings left bare.

`writeRules()` therefore diffs the `## ` headings of the old block against the new one, only on the
in-place refresh path (arrangement `one`). Create and append announce nothing, so `init` does not
list every section. Only headings in `CONDITIONAL_SECTIONS` are announced. The pointer, tracker
headings and anything an upgrade adds are not; announcing the pointer would make a retirement noisy
(archive the last autonomy holder while a release is open, and the pointer appears). Each
conditional heading present in the new block and absent from the old one gets one stderr line:
`conductor: the rules block now carries "## <heading>" — a session or agent that loaded it earlier does not have it; run \`rules\` to print it.`

Removal prints nothing new beyond the existing "refreshed rules block" line. The notice is the
instruction-layer answer to a session that grants autonomy and keeps acting on its stale loaded copy.
The `conductor` skill's hierarchy procedure gains one sentence: carry the section into a dispatch
prompt when the notice fired this session.

**D6. Overhead.** `rulesBlockFor(state, platform, usage = rulesUsage(state))` takes the usage as a
parameter. The real report passes the state's own answers, and `--all-features` passes
`FULL_USAGE`. `hypotheticalState()` is unchanged: seeding a fake epic and release would also add
RELEASES lines to the brief and change the brief surface's bytes. Under the hypothetical, both
sections are counted and the pointer is absent. `SURFACE_FEATURES` gains
`"rules:procedures-emitted-on-use": CORE`. Its README cost therefore comes from a fresh repo's real
`overhead` (feature-switches delta). The two sections keep `core`: they are not switchable, only
absent while unused.

**D6a. The emitted-instruction sweep owns the usage-off renders.** The live `emitted-instructions`
requirement names the rules-block renders the invocation sweep must cover. The change amends it
(MODIFIED delta) to add the autonomy-off, release-candidate-off and both-off renders, so the
pointer's spans are owned by the capability that already owns "runnable as written". The
managed-rules-block scenario states only the outcome.

**D7. The upgrade invariant holds for migrations, and the self-heal is named.** `rules.mjs:695–708`
cites conductor-15 7.2: the block a repo reads is identical before and after an upgrade. No
`MIGRATIONS` entry writes `epic.autonomy`, epic status or `state.releases` (task 2.1 verifies this
with `rg` over `scripts/lib/migrations.mjs` for all three). `upgrade` also runs `reconcileArchived()`
(`migrations.mjs:235`), which can archive an epic. When that archives the last autonomy holder, the
block changes because the STATE changed. That is the refresh doing its job, not a migration
altering what anyone reads. Task 2.1 confirms conductor-15's fixture heals no autonomy holder. The block DOES change on the first
write by the engine release that ships this change. That is a release change, not a migration
effect, and the changeset says so.

## Risks / Trade-offs

- [A session acts on a decision rule it never loaded] → D3's pointer before first use, and D5's
  notice after it.
- [Test churn from fixtures asserting a freshly written block] → D1's full default. Only tests that
  read a block written from state change. Task 2.1 enumerates them with `rg` before any edit.
- [The refresh rewrites `CLAUDE.md` more often] → it rewrites only on a presence disagreement. The
  existing "no-op write leaves mtime unchanged" scenario is carried over to the generalised check.
- [Sequencing with `mutation-pass-is-a-required-task-item`] → both edit `rules.mjs`'s
  `GATE_PROCEDURE_ITEMS` neighbourhood. This change lands first, and the cross-spec review (task
  0.2) names the chokepoint.
- [A repo whose old releases were never marked delivered keeps the Release candidate section]
  → accepted. This repo holds 16 of 19 releases without `delivered`. The saving is certain for
  fresh repos and for repos that mark releases delivered. The changeset names `release <id> --deliver`.
- [A fleet repo loses sections it never used, and a user may look for them] → the pointer names
  where they went, and the changeset states it.

## Migration Plan

No `state.json` change, no `MIGRATIONS` entry. A repo picks up the change at its next `upgrade`
(which calls `writeRules`) or at its first non-hook state write (D4).
A dispatched implementer MAY edit `README.md` for task 4.1, limited to the new section's table row
(approved by the orchestrator, 2026-11-02). Rollback: revert the release,
and the next write restores the full block.
