# Design: usage-conditioned rules-block sections

## Context

See proposal.md for the motivation. Current state, verified on disk 2026-11-02 against engine 0.53.0:

- `rulesBlock(tracker, reviewMode, secondaryTrackers, platform, profile, spend, guard)`
  (`scripts/lib/rules.mjs:693`) emits `## Epic-level autonomy` (lines 813–852) and
  `## Release candidate` (lines 889–906) unconditionally. Spend tracking and spend guard are already
  conditional on the two trailing booleans.
- Three callers render the block from state: `writeRules()` (`rules.mjs:1220`), the `rules` verb
  (`scripts/conductor.mjs:516`) and `overhead.rulesBlockFor()` (`scripts/lib/overhead.mjs:168`). About
  20 test call sites call `rulesBlock(` directly (`rg -c "rulesBlock\(" scripts/test`).
- The spend-guard section is kept current by `refreshSpendGuardSection(before, after)`
  (`scripts/lib/spend-guard-verbs.mjs:184`). The dispatch wrapper's `finally` calls it
  (`conductor.mjs:586`) for a mutating, non-hook verb whose write moved `revision`. It compares
  `rulesBlockShowsSpendGuard()`, the section on disk, with `guardConfigured(after)`.
- Text outside the two sections that refers to them: the outward-tracker paragraph
  (`rules.mjs:952–958`, 639 B), which cites "decision-rule item (d)". Operating rule 7
  (`rules.mjs:783`) and Reporting (`rules.mjs:524`) name the preflight scan and the end-of-epic
  report as kinds of work. They do not point at the section, so they stay.
- The `conductor` skill (`skills/conductor/SKILL.md:1122`) says the decision rule "is in the rules
  block". The release-candidate skill is loaded by name.
- A release is "delivered" when `releases[i].delivered` is an object (`releases.mjs:352–358`).
  `--undeliver` deletes it. No verb removes a release.
- `sync` matches an openspec change to an epic by id only (`subcommands.mjs:1020`). The change id is
  therefore the epic id, `gh-cfdude-pm-248`, so no duplicate epic is registered.

## Goals / Non-Goals

**Goals:** each conditional section appears and disappears with its condition, after any verb, any
inverse, and any hand-edit followed by an engine write. One predicate per condition. The default
render of `rulesBlock()` stays byte-identical.

**Non-Goals:** a `lean|full` dial or a new `OPT_INS` id (the issue's "optional" half). Conditional
emission of the gate procedure, intake or reporting: these are record-integrity rules, and
`feature-switches` already declines to switch them. A hierarchy section: the block has none today.
Re-loading `CLAUDE.md` into a live session: the host does not do that, and the engine cannot.

## Decisions

**D1. One usage object, not positional args 8 and 9.** `rulesBlock()` gains one trailing parameter,
`usage = FULL_USAGE`, where `FULL_USAGE = { autonomy: true, releaseCandidate: true }`. Defaulting to
the full block keeps every existing test call byte-identical. A future caller that forgets the
argument over-emits rather than drops a rule, which is the safe failure. Alternative rejected: an
options object replacing all seven positionals. That churns 66 call lines for no behaviour, and is
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

`writeRules`, the `rules` verb, `overhead.rulesBlockFor` and the refresh (D4) all call it. A
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

**D4. Generalise the spend-guard refresh into one table.** `CONDITIONAL_SECTIONS` is a list of
`{ heading, shown(state) }` rows: Spend tracking (`spendEnabled`), Spend guard (`guardConfigured`),
Epic-level autonomy, Release candidate and Procedures emitted on use (its own predicate is
`!(autonomy && releaseCandidate)`). `rulesBlockShowsSpendGuard()` becomes `rulesBlockHeadings()`,
which returns the set of `## ` headings inside the one managed block, or `null` with no block or an
ambiguous one. `refreshSpendGuardSection` becomes `refreshConditionalSections(before, after)`.
- It rewrites once if any row's presence on disk differs from `shown(after)`.
- It keeps the guard's existing properties: it is called only from the wrapper's existing
  `guardBefore` branch, so a hook does no work; it reads no extra state image; a failure prints a
  warning naming `write-rules`.
- It compares the block on disk with state, not `before` with `after`. That is what makes a
  hand-edit converge at the next engine write.

A test asserts that every heading `rulesBlock()` emits conditionally appears in the table, so a
future conditional section cannot be left out of the refresh.

**D5. The appearance notice lives in `writeRules()`, not in the refresh.** Several verbs call
`writeRules()` themselves: `set-spend-guard`, `set-spend-tracking`, the tracker verbs,
`set-review-mode`, the profile verbs and `upgrade`. When one of them adds a heading, the wrapper's
refresh then finds disk and state already agreeing and would print nothing. A notice placed in the
refresh would be a guard at one call site with its siblings left bare.

`writeRules()` therefore diffs the `## ` headings of the old block against the new one, only on the
in-place refresh path (arrangement `one`). Create and append announce nothing, so `init` does not
list every section. Each heading present in the new block and absent from the old one gets one
stderr line:
`conductor: the rules block now carries "## <heading>" — a session or agent that loaded it earlier does not have it; run \`rules\` to print it.`

Removal prints nothing new beyond the existing "refreshed rules block" line. The notice is the
instruction-layer answer to a session that grants autonomy and keeps acting on its stale loaded copy.
The `conductor` skill's hierarchy procedure gains one sentence: carry the section into a dispatch
prompt when the notice fired this session.

**D6. Overhead.** `rulesBlockFor(state)` passes `rulesUsage(state)`. `hypotheticalState()` adds one
synthetic non-archived epic with an autonomy record when `rulesUsage(s).autonomy` is false, and one
undelivered release when `releaseCandidate` is false. `HYPOTHETICAL.description` names both.
`SURFACE_FEATURES` gains `"rules:procedures-emitted-on-use": CORE`. The two sections keep `core`:
they are not switchable, only absent while unused.

**D7. The upgrade invariant still holds.** `rules.mjs:695–708` cites conductor-15 7.2: the block a
repo reads is identical before and after an upgrade. Migrations write neither `epic.autonomy` nor
`state.releases`, which a task verifies with `rg` over `scripts/lib/migrations.mjs`. The predicates
therefore return the same answer either side of a migration. The block DOES change on the first
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
(which calls `writeRules`) or at its first non-hook state write (D4). Rollback: revert the release,
and the next write restores the full block.
