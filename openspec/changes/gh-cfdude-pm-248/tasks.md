# Tasks

## Commit mechanics

- **TDD.** Every behaviour task is RED then GREEN. Save the failing run as `red-<task>.txt` in this
  change directory, then commit the test and code together in one commit that names that file.
- **Mutation evidence.** For every guard or predicate a task adds, neuter it in turn, run the suite
  that covers it, record each result, and restore. Save the batch as `mutation-<task>.txt` here. A
  SURVIVING mutant is a finding to explain or fix, never a redundant test to delete.
- **Rungs.** A predicate's answer, an emitted string or a stderr line is a VALUE (UNIT,
  `scripts/test/unit/`, `unitTest()`). `CLAUDE.md` bytes or mtime after a verb are BYTES (FILE,
  `scripts/test/assert/`). Every new test file is enrolled the way `drift.mjs` requires. A
  functional id gets its assertion twin of the same id.
- **Certify.** `rules.mjs`, `conductor.mjs` and `spend-guard-verbs.mjs` sit in the functional and
  sweeps subjects. After staging, run `node scripts/test/drift.mjs --phase pre-commit`, then each
  `certify.mjs` bucket it names, with output redirected to a file and the real exit code read. Then
  commit plainly.
- **Commits.** One conventional commit per task, staged by explicit path, never `--no-verify`. After
  each commit, run R.2 and `update-epic gh-cfdude-pm-248 --attribute-commit <sha>` (R.4).
- **Order.** This change lands BEFORE `mutation-pass-is-a-required-task-item` adds its 558 B item to
  `GATE_PROCEDURE_ITEMS` in `scripts/lib/rules.mjs`.

## 0. Before any code

- [ ] 0.1 **Gate 1** (review `standard`) over `proposal.md`, `design.md`, `tasks.md` and the six delta
      specs under `specs/`. Fix Critical and Important findings. Then run
      `openspec validate gh-cfdude-pm-248 --strict` and read its exit status, and record
      `record-gate-review gh-cfdude-pm-248 --gate 1 --verdict pass --artifact <path>… --reviewer "<identity>"`.
- [ ] 0.2 **Cross-spec review of release 0.54.0** (required item 5). This change adds six spec files
      to the release, which marks any prior verdict stale. Name the shared chokepoints: `scripts/lib/rules.mjs`
      `rulesBlock()` and `GATE_PROCEDURE_ITEMS` (also edited by
      `mutation-pass-is-a-required-task-item`), the `managed-rules-block` spec, and the
      `spend-guard` liveness refresh this change generalises. Record
      `record-cross-spec-review 0.54.0 --verdict pass|fail --reviewer "<identity>"`.

## 1. One predicate per usage-conditioned section

- [x] 1.1 TDD (UNIT). Add a pure `rulesUsage(state)` returning `{ autonomy, releaseCandidate }`
      (design D2). Cover the following:
      - no epics;
      - an autonomy record on a non-archived epic at level `autonomous` and at level `off`;
      - an autonomy record on an archived epic only;
      - a removed holder;
      - no releases;
      - one release with `delivered`, and one without;
      - a `state.releases` that is absent or not an array.
      Verify: the new unit file passes, and its RED run is saved as `red-1.1.txt`.
- [x] 1.2 Mutation evidence for 1.1. Drop the archived filter, swap presence for
      `level === "autonomous"`, and drop the `delivered` check. Each mutant must die. Verify:
      `mutation-1.2.txt` lists every mutant and its result.

## 2. Emission follows the usage answers

- [x] 2.1 Enumerate, mechanically and before editing, every test and fixture that asserts on a
      block rendered FROM STATE rather than from a direct `rulesBlock(` call. Run
      `rg -n "Epic-level autonomy|Release candidate|rules --sections|write-rules" scripts/test`
      plus `rg -c "rulesBlock\(" scripts/test`, which gives 61 calls in 15 files on 2026-11-02;
      re-derive the count. Also confirm design D7: run
      `rg -n "autonomy|status|releases" scripts/lib/migrations.mjs`, show that no `MIGRATIONS` entry
      writes any of the three, and show that conductor-15's upgrade fixture heals no autonomy holder.
      Verify: the list is saved as `callers-2.1.txt`, with each file marked "unchanged (default
      full)" or "changes" and its reason, plus the D7 evidence.
- [x] 2.2 TDD (UNIT). Add `rulesBlock()`'s trailing `usage = FULL_USAGE` parameter (design D1). Each
      section is emitted only when its flag is true, and the outward-tracker "Epic-level autonomy on
      tracker-linked epics" paragraph follows `usage.autonomy`. `## Procedures emitted on use`
      (design D3) names only the absent procedures, stays within 400 bytes, and is absent when both
      flags are true. Cover every scenario of the `managed-rules-block` requirements "A
      usage-conditioned section…", "An absent procedure…" and "Text that stays emitted…". Assert
      RELATIONALLY, never with a frozen golden copy of the whole block, which
      `mutation-pass-is-a-required-task-item` would turn red with its next item: the default call
      equals the call with both flags true, and turning a flag off removes exactly that section
      (plus the tracker paragraph for autonomy) and adds the pointer. Verify: unit tests pass;
      `red-2.2.txt` saved.
- [x] 2.3 TDD (FILE). `writeRules()` and the `rules` verb pass `currentRulesUsage()`.
      `overhead.rulesBlockFor(state, platform, usage = rulesUsage(state))` takes usage as a parameter
      (design D6), so every render path reads the predicate when this task lands. Cover the
      following, then update every file 2.1 marked "changes":
      - a fresh `init` writes neither section and does write the pointer;
      - `rules` and `write-rules` agree for the same state;
      - the gate procedure's bytes equal those in the default (full) render, compared
        relationally rather than against a stored count.
      Verify: assert tests pass; `red-2.3.txt` saved.
- [x] 2.4 Mutation evidence for 2.2–2.3. Mutate: emit autonomy unconditionally; leave the tracker
      paragraph ungated; emit the pointer always; have `writeRules` pass no usage; have
      `rulesBlockFor` ignore its usage. Verify: `mutation-2.4.txt`, with every mutant dead or
      explained.
- [ ] 2.5 Emitted-instruction coverage.
      - `renderedRulesBlocks()` in `scripts/test/functional/emitted-invocations.test.mjs` (≈ lines
        532–545) renders only the full default block. Add renders with autonomy off,
        release-candidate off and both off, so the pointer's code spans are checked "runnable as
        written". A bare `release` span is the likely failure; write the span as the runnable form
        the check accepts.
      - Update its assertion twin of the same id in the same commit (diff coupling).
      - Add judged entries in `scripts/test/sweeps/output-interpolations.judged.mjs` for the
        pointer's line builder and the appearance-notice string.
      - Certify `functional` and `sweeps` over the staged index.
      Covers the MODIFIED `emitted-instructions` scenario "The usage-off renders are swept".
      Verify: both certify runs pass, and the drift check accepts the twin.

## 3. One refresh for every conditional section

- [ ] 3.1 TDD (FILE). Replace `rulesBlockShowsSpendGuard()` with `rulesBlockHeadings(platform)`,
      which returns the set of `## ` headings inside the one managed block, or `null` when there is
      no block or an ambiguous one. Migrate its callers: `rg -n "rulesBlockShowsSpendGuard"`.
      Verify: assert tests pass, and `rg` finds no remaining caller of the old name.
- [ ] 3.2 TDD (FILE). Generalise `refreshSpendGuardSection` into
      `refreshConditionalSections(before, after)` over the `CONDITIONAL_SECTIONS` table (design D4),
      still called only from the dispatch wrapper's existing non-hook `guardBefore` branch. Cover
      the following:
      - every scenario of "The block on disk follows every conditional section…", including the
        `commit-nudge` archive self-heal: no comparison in the hook, then the refresh on the next
        non-hook write;
      - the refresh-failure warning names the disagreeing section and `write-rules`, in wording
        that is not specific to spend guard;
      - every scenario of the `epic-autonomy` requirement: first record, level off, archive,
        `remove-epic`, un-archive, archived holder alone;
      - every scenario of the MODIFIED `release-candidate-review` requirement: first release,
        `--deliver` retires, `--undeliver` restores;
      - the hand-edit-then-write case.
      Every existing spend-guard emission test must stay green unchanged. Verify: the assertion half
      passes; `red-3.2.txt` saved.
- [ ] 3.3 TDD (FILE). Add the appearance notice inside `writeRules()` on its in-place refresh path
      (design D5). Assert the following:
      - one stderr line per added heading in `CONDITIONAL_SECTIONS`, naming the heading and
        `rules`, and no line for any other heading: the pointer, a tracker heading added by
        `set-tracker`, or a heading an upgrade adds;
      - archiving the last autonomy holder while an undelivered release exists adds the pointer
        and prints no appearance line;
      - a line both when the wrapper's refresh adds a section (`set-autonomy`) and when a verb that
        calls `writeRules()` itself adds one (`set-spend-guard --max-failed-rounds 2`);
      - no line on `init`'s create or append, and none on a removal-only refresh.
      Verify: tests pass; `red-3.3.txt` saved.
- [ ] 3.4 TDD (UNIT). Add a coverage guard. Render `rulesBlock()` over every combination of the
      spend-tracking, spend-guard, autonomy and release-candidate inputs, with no tracker. Every
      heading present in some combination and absent in another must be a row of
      `CONDITIONAL_SECTIONS` or the pointer. Tracker sections are out of scope: their headings are
      parameterised, and the tracker verbs refresh the block through their own `writeRules()`
      calls (design D4). Verify: the test fails when a row is deleted (recorded in 3.5).
- [ ] 3.5 Mutation evidence for 3.1–3.4. Mutate: compare `before`/`after` instead of disk/state (the
      hand-edit case must die); drop one table row; skip the hook exclusion; print the notice on
      removal; move the notice into the refresh only (the `set-spend-guard` case must die).
      Verify: `mutation-3.5.txt`, with every mutant dead or explained.

## 4. Overhead counts what the hypothetical uses

- [x] 4.1 TDD (UNIT). `--all-features` renders the hypothetical's block with `FULL_USAGE` (design
      D6). `hypotheticalState()` is unchanged, so no epic or release is seeded and the brief's bytes
      do not move. `SURFACE_FEATURES` gains `rules:procedures-emitted-on-use: core`. Cover every
      scenario of the MODIFIED `pm-overhead` and `feature-switches` requirements.
      - **README is approved for this task**, limited to the new section's table row (the
        orchestrator approved it on 2026-11-02, overriding `.claude/agent-startup.md` for this row
        only). The row's cost comes from `overhead` in a freshly initialised repo, and the row says
        so.
      - The feature-switches README-table test forces the row into the same commit.
      Verify: the unit tests and the README-table test pass; `red-4.1.txt` saved.
- [x] 4.2 Mutation evidence for 4.1. Mutate: pass the real usage to the hypothetical (the "counted
      under the hypothetical" scenario must die); drop the map row. Verify: `mutation-4.2.txt`.

## 5. Shipped mirrors and the changeset

- [ ] 5.1 Update the mirrors that describe these sections:
      - `skills/conductor/SKILL.md`: the preflight section's "the decision rule … is in the rules
        block" (≈ line 1122) says the section is present only while a non-archived epic has an
        autonomy record, and that `rules` prints it. The hierarchy procedure carries the section
        into a dispatch when the appearance notice fired this session.
      - `commands/epic.md` `set-autonomy`: the first record adds the section, and the notice.
      - `commands/upgrade.md`: the `rules` row and the conditional sections.
      - `commands/overhead.md`: `--all-features` counts both sections at full usage; the pointer
        appears only in a real report.
      - `docs/parity-ledger.json`: the release-candidate description, "emitted while an undelivered
        release exists".
      - `docs/rules-block-session-cost.md`.
      - `agents/hierarchy-child-executor.md`: re-read it and change it only if it states the
        section is always present.
      Verify: `rg -n "rules block" skills/conductor/SKILL.md commands/epic.md` shows no claim of
      unconditional presence; `parity.test.mjs` passes.
- [ ] 5.2 Add changeset fragment `.changesets/gh-cfdude-pm-248.md`. It states the bytes saved on a fresh
      repo (from 6.1), that existing repos lose unused sections at their next upgrade or write, the
      pointer, and the notice. Verify: `changesets` reads it without error.

## 6. Integration

- [ ] 6.1 Measure. Init a fresh scratch repo and run `rules --sections`, then add an autonomy record and
      a release and run it again. Verify: both tables are saved as `measure-6.1.txt`, and the saving
      is at least 3,910 B (design D3). This re-measures the 34,094 B baseline rather than trusting it.
- [ ] 6.2 Full verification. Run the assertion half once
      (`node --test scripts/test/unit/*.test.mjs scripts/test/assert/*.test.mjs`), then
      `certify.mjs functional` and `sweeps` as drift names them. Verify: the counts and exit codes
      are recorded in the commit message of the last code commit.

## R. Required task items (CLAUDE.md "The gate procedure", items 1–7)

- [ ] R.1 **Call-site completeness sweep** (item 1). Derive every list with `rg` and save it as
      `call-site-sweep-R.1.txt`.
      - (a) Every `rulesBlock(` caller: state which ones pass usage and which rely on the full
        default, and why. Every `writeRules(` caller (`rg -n "writeRules\("`): confirm that each one
        reaches the appearance notice through `writeRules()` itself.
      - (b) Every writer of either predicate's inputs: `epic.autonomy` (`set-autonomy`, and any
        `add-epic`/`add-many` path), epic status (`update-epic` archive and un-archive, `sync`
        archive moves), epic existence (`remove-epic`, `add-epic`, `add-many`, `sync`) and
        `state.releases`/`delivered` (`release` create, `--deliver`, `--undeliver`). For each one,
        state that it runs inside the dispatch wrapper's non-hook branch (`verb-effects.mjs`), or
        why not.
      - Hooks DO write one input. `reconcileArchived()` (`scripts/lib/epic-progress.mjs:204`) sets
        `status = "archived"` from the `commit-nudge` hook (`scripts/lib/subcommands.mjs:854`), from
        `render()`'s self-heal and from `upgrade` (`scripts/lib/migrations.mjs:235`). State for each
        how the block catches up: the next non-hook write's refresh for the hooks, `writeRules()`
        for upgrade. The exclusion of hooks from the comparison is justified by the spend-guard
        precedent.
      - (c) Every referrer of the two sections in emitted text, skills, commands, agents and docs
        (`rg -n -i "epic-level[- ]autonomy|release[- ]candidate|decision[- ]rule"`, which also
        reaches `scripts/lib/spend-guard.mjs` ≈ 372–376 and `rules.mjs` ≈ 783). State whether each
        still resolves while the section is absent.
      - (d) **Inverses.** Section added versus retired for each condition: autonomy (record added ↔
        epic archived or removed; un-archive restores) and release (created ↔ `--deliver`;
        `--undeliver` restores). Release REMOVAL has no verb, so name it as an unshipped inverse,
        justified by the disposition rule (records end, they are not deleted) and covered by the
        hand-edit scenario. Removing an autonomy record has no verb either: `set-autonomy` appends
        or revokes and never deletes `epic.autonomy`. That is the same justification (a safety
        record is kept), covered by archive and `remove-epic`. The appearance notice has no
        inverse line, by design D5.
- [ ] R.2 **Verify against the commit** (item 2). For every task commit, run `git show --stat <sha>`
      and assert that each file the task claims is in that commit.
- [ ] R.3 **Lifecycle marker** (item 3). C.2 and C.3 carry `<!-- pm:lifecycle -->` on their own task
      lines.
- [ ] R.4 **Attribute every commit** (item 4). Run `update-epic gh-cfdude-pm-248 --attribute-commit <sha>`
      as each commit lands. Never attribute the archive move or the post-Gate-2 lifecycle commits.
- [ ] R.5 **Cross-spec review** (item 5). Done by 0.2. Re-run it if any spec in release 0.54.0 is
      amended after 0.2.
- [ ] R.6 **Disposition** (item 6). Done by C.2.
- [ ] R.7 **Route what the work taught you** (item 7). Name each lesson's kind out loud.
      - Candidate practice: "a section gated on derived state is refreshed by comparing disk with
        state, not before with after", with the hand-edit evidence from 3.5.
      - Candidate friction: the tasks instruction from OpenSpec says to keep archive steps out of
        tracked tasks, while pm requires a marked archive task.
      Record the outcome in the epic's notes.

## G. Gate 2

- [ ] G.1 **Gate 2** over `BASE..HEAD`, or the converged `rc/0.54.0` review. Check:
      - every predicate writer reaches the refresh;
      - no rewrite happens on a no-op write;
      - no hook does the comparison;
      - the default render is byte-identical;
      - no emitted line points at an absent section.
      Record it with a head SHA that reaches every attributed commit.

## D. Docs (after Gate 2 only)

- [ ] D.1 README: update the "What each feature costs" rows for `rules:epic-level-autonomy` and
      `rules:release-candidate` ("core, emitted only while in use"), and any README description of
      the rules block's sections. Mintlify (`pm-plugin.dev`): hand to the orchestrator per the
      `mintlify-doc-sync` skill. Verify: the README-table test passes, and the orchestrator is
      named in the closeout.

## C. Close

- [ ] C.1 Re-record Gate 2 if anything was attributed after it.
- [ ] C.2 <!-- pm:lifecycle --> **Disposition.** Run `update-epic gh-cfdude-pm-248 --status archived --outcome delivered --reason "<why>" --no-deferrals` (or the deferral flags that apply), then `/pm:status`.
- [ ] C.3 <!-- pm:lifecycle --> **Archive.** Run `/opsx:archive gh-cfdude-pm-248`. Do not attribute it.
