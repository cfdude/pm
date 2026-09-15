## 0. Before any code

- [x] 0.1 Gate 1 — two fresh-context reviewers over these artifacts BY PATH; record with
      `record-gate-review gate-verdict-withdrawal --gate 1 --verdict pass --reviewer "<identity>"
      --artifact openspec/changes/gate-verdict-withdrawal/proposal.md --artifact
      openspec/changes/gate-verdict-withdrawal/design.md --artifact
      openspec/changes/gate-verdict-withdrawal/tasks.md --artifact
      openspec/changes/gate-verdict-withdrawal/specs/gate-integrity/spec.md`
- [x] 0.2 **Cross-spec review** (required task item 5) — owed: 0.43.0 holds this spec and
      `archive-gate-reads-what-it-writes`'s, two files on `gate-integrity`. Run the `cross-spec-review`
      skill after both pass Gate 1, and again if the reconcile gate in 1.1 amends either spec; record
      with `record-cross-spec-review 0.43.0 --verdict pass|fail --reviewer "<identity>"`

## 1. Precondition — the archive-gate change has shipped

- [x] 1.1 `archive-gate-reads-what-it-writes` is archived, `pop-detour gate-verdict-withdrawal` has run,
      and the reconcile gate has recorded its verdict with `record-reconcile gate-verdict-withdrawal
      --detour archive-gate-reads-what-it-writes --verdict valid|invalidated`. Any amendment it names is
      applied to these artifacts BEFORE task 2.1
- [x] 1.2 Confirm, against the shipped code rather than design.md, the name, signature and return shape
      of `deliveredObligations()` and the position of `archiveGate()` in `updateEpic`; correct every task
      below that names them

## 2. The withdrawal write

- [x] 2.1 REFACTOR (suite green before and after): move `KNOWN_GATE_NUMBERS` from
      `gate-review-writeback.mjs:11` to `constants.mjs`, export it, import it in `gate-review-writeback.mjs`
- [x] 2.2 RED then GREEN: unit-test `withdrawnGate(epic, n)` (absent entry + withdrawal → latest
      withdrawal; stored `pass` + withdrawal → null; stored `ungated` + withdrawal → null; no withdrawal →
      null), then add it beside `gateHasEvidence`. Every surface below calls it; none re-derives it
- [x] 2.3 RED then GREEN: withdrawing a Gate 2 `pass` removes `gateReview.gate2` and appends
      `{gate, entry, reason, withdrawnAt}` whose `entry` deep-equals the stored verdict. The GREEN step
      registers `withdraw-gate-review` in `EPIC_FLAGS` (`key:null`, `write:"custom"`, `requires` naming
      the gate number, NOT yet repeatable) and implements a single-gate write, with no refusals, in
      `updateEpic` beside the `--withdraw-commit` block, before the archive gate (the only refusal it
      brings is `requires`' built-in missing-value error). The SAME commit carries
      8.1's conductor-13 exercise entry (with its `pre` step) and 8.2's usage line and `commands/epic.md`
      row, because conductor-36 fails the suite on a registered flag with no doc row and the pre-commit
      hook runs the suite
- [x] 2.4 REGRESSION GUARD (passes once 2.3 moves the whole entry): a Gate 1 carrying `superseded` moves whole; nothing is promoted
- [x] 2.5 REGRESSION GUARD: withdrawing one gate leaves the other deep-equal
- [x] 2.6 RED then GREEN: `--withdraw-gate-review 1 --withdraw-gate-review 2` withdraws both, two
      entries — GREEN adds `repeats:true`, the loop, and "repeatable" on the `commands/epic.md` row (RED:
      without it `parseFlags` keeps only Gate 2)
- [x] 2.7 REGRESSION GUARD (no code change; design.md asserts it): re-recording after a withdrawal starts clean — no `superseded`, withdrawal kept
- [x] 2.8 RED then GREEN: read-back after `render()` — the gate absent AND a matching withdrawal entry,
      else exit non-zero "did NOT land". Force the failure by exporting the read-back check as a pure
      function over (request, state read back) and unit-testing it with a state that still carries the
      verdict; the CLI path calls that same function

## 3. Refusals

Each test supplies every other input valid, asserts `state.json` byte-identical, and asserts the
refusal's CAUSE string (not only a non-zero exit, which an unknown-flag refusal would also satisfy).
Order per design.md.

- [x] 3.1 RED then GREEN: `--withdrawal-reason` with neither withdrawal flag, refused before `loadState`,
      naming both flags — an explicit companion-flag refusal in `updateEpic`, not `requires` text (which
      drives only the missing-value error); update `withdrawal-reason`'s `requires` text to name both flags
- [x] 3.2 RED then GREEN: no `--withdrawal-reason`
- [x] 3.3 RED then GREEN: gate `3`, `0` and `x` — the message names the values of `KNOWN_GATE_NUMBERS`
- [x] 3.4 RED then GREEN: the same gate twice
- [x] 3.5 RED then GREEN: no stored verdict for a valid gate
- [x] 3.6 RED then GREEN: a stored `ungated` Gate 2 produced by the heal route — keyed on the VERDICT,
      never on `recordedBy`

## 4. Withdrawn is a state, never absence

- [ ] 4.1 RED then GREEN: `deliveredObligations`'s Gate 2 entry names a withdrawn Gate 2 in `detail` and
      carries the reason in `items` as `{reason}` (never in `detail`); the archive gate on an unarchived
      epic shows the reason, and the regression refusal shows it. RECONCILE AMENDMENTS (vs shipped
      `archive-gate-reads-what-it-writes`): (a) `regressionRefusal()` in `update-epic.mjs` renders `items`
      story-shaped only (`story <n> "<title>"`), so switch its findings map on `o.kind` — handoff keeps
      today's form byte-for-byte, gate2 renders `withdrawal reason <escaped JSON>`; (b) `archiveGate()`'s
      Gate 2 branch prints only `detail` today, so it gains code to print the reason from `items`; (c) both
      print the reason as `escapeControls(JSON.stringify(reason))`, NOT raw — a new print of a user value
      does not add a second instance of `handoff-refusal-prints-story-titles-raw`'s defect. Move
      `CONTROL_CHARACTER` and `escapeControls` from `update-epic.mjs` to an export of `archive-gate.mjs`
      (update-epic already imports from it). RED: a reason carrying a newline and `  update-epic x`
      forges no line in either refusal
- [ ] 4.2 RED then GREEN: `archived-openspec-epic-with-no-gate-1` names a withdrawn Gate 1
- [ ] 4.3 REGRESSION GUARD (written after 5.3): re-recording clears the state — the archive with `--outcome delivered
      --no-deferrals` exits 0, and PROJECT.md, the brief and `integrity` name no withdrawn Gate 2
- [ ] 4.4 RED then GREEN: ONE helper in `archive-gate.mjs` decides which epics a gate table lists and
      renders the cell `withdrawn — <reason>`; `render` and `buildBrief` both call it, each keeping its
      own row cap. Scenarios: one gate withdrawn; BOTH withdrawn (the epic stays in both tables). Plus
      a conductor-16-style assertion that PROJECT.md and the brief list the same epic ids with the same
      cell text, asserting each rendered id is a real id string (never `undefined`)
- [ ] 4.5 RED then GREEN: `diffEvents` emits `gate-withdrawn` on GROWTH of `withdrawnGateReviews`;
      a write removing `gate2` with no new withdrawal entry emits none
- [ ] 4.6 RED then GREEN: `activity-report.mjs` lists `gate-withdrawn` in its gates section; add the
      kind to `activity-log.mjs`'s kind-list comment and `commands/activity.md`

## 5. The heal and the standing condition

- [ ] 5.1 RED then GREEN: `reconcileArchived` skips the `ungated` stamp when `withdrawnGate(e, 2)`;
      the disposition half and the status flip are unchanged. Correct the code comment at
      `epic-progress.mjs:123` that repeats "record-gate-review refuses a verdict to any other lane"
- [ ] 5.2 REGRESSION GUARD: assert the heal is byte-identical where nothing was withdrawn
- [ ] 5.3 RED then GREEN: `ungatedArchives` returns `{epic, kind: "ungated"|"withdrawn", withdrawal}`.
      The `ungated` kind's predicate is unchanged. ADD the `withdrawn` kind:
      `(e.status === "archived" || isArchived(e.id)) && isOpenspecLane(e) && inCompletionScope(e) &&
      withdrawnGate(e, 2)`. Update its callers `integrity.mjs:201` and `briefing.mjs:218`, and keep the
      intent of `scripts/test/conductor-15.test.mjs:1417`. The withdrawn kind is reported under its OWN
      integrity check id `archived-with-withdrawn-gate-2` (own title) and its OWN brief heading; both
      word it with its reason. Assert each names the epic by its real id, and that the whole block,
      headings and titles included, matches no `/no (gate 2 )?review/i` — for `integrity`, the CLI text
      from the new check's title line to the next check's line or the blank line before the totals (so
      `formatIntegrity`'s title is covered); for the brief, from the nearest NON-INDENTED line above the
      withdrawn entry (brief blocks are blank-delimited with unindented headings, so an umbrella heading
      with an indented sub-heading is still scanned) to the next blank line. The SAME commit adds
      `archived-with-withdrawn-gate-2` and its explanation to
      `openspec/changes/archive/2026-08-25-conductor-tells-the-truth/integrity-day-one.md`, because
      conductor-15 test 9.14 requires every registered check id there and the pre-commit hook runs the
      suite. 5.8's "archived ungated" wording must not match that regex
- [ ] 5.4 REGRESSION GUARD (passes once 5.1 and 5.3 land): an epic reached by the heal route (withdraw while open → change archived on disk
      → heal, outcome `unknown`) is named as withdrawn by both surfaces
- [ ] 5.5 REGRESSION GUARD (pins 5.3's `isArchived` arm): the not-yet-healed window — withdraw while open, move the change under
      `openspec/changes/archive/`, then compose the brief and `integrity` WITHOUT a mutating verb; both
      name the epic
- [ ] 5.5a REGRESSION GUARD: a brief carrying the withdrawn-kind notice is delivered, and a later brief
      with the withdrawal unchanged names the epic again
- [ ] 5.6 REGRESSION GUARD (written after 5.3): the withdrawn kind names neither a `claude-code`-lane archived epic nor an
      openspec epic neither archived in state nor on disk, each with a withdrawn Gate 2
- [ ] 5.7 REGRESSION GUARD: an archived `superseded` openspec epic with a withdrawn Gate 2 (reached by the
      combined call in 6.5) is named by neither surface
- [ ] 5.8 RED then GREEN: a withdrawn entry whose `superseded` holds an `ungated` stamp says so on both
      surfaces; and after a re-record and second withdrawal (latest entry holding no `ungated`), both
      still say so

## 6. Bound by the archive gate (inherited, asserted here)

These pin behavior `archive-gate-reads-what-it-writes` already ships plus this change's wording
(4.1) and standing condition (5.3), so each is a REGRESSION GUARD: it passes when written, and must
keep passing.

- [ ] 6.1 REGRESSION GUARD: `--withdraw-gate-review 2 --withdrawal-reason x --status archived --outcome
      delivered --no-deferrals` on an openspec epic with a covering passing Gate 2 and no outstanding work
      is refused with a message stating Gate 2 was withdrawn and quoting `x`; state byte-identical; not
      archived
- [ ] 6.2 REGRESSION GUARD: `--withdraw-gate-review 2 --withdrawal-reason x` on an archived agent-recorded
      `delivered` openspec epic with a covering passing Gate 2 and no outstanding work is refused; the
      printed invocation carries `--correct-disposition`; the message states Gate 2 was withdrawn and
      quotes `x`, and does not say Gate 2 is missing. Repeat with a reason containing a newline and
      `  update-epic y`: exactly one line begins `  update-epic `
- [ ] 6.3 REGRESSION GUARD: `--withdraw-gate-review 1 --withdrawal-reason x` on the same archived
      `delivered` epic exits 0 — Gate 1 is not an obligation
- [ ] 6.4 REGRESSION GUARD: an archived `delivered` openspec epic with a Gate 2 `fail` recorded by
      `record-gate-review` after archive → `--withdraw-gate-review 2 --withdrawal-reason x` exits 0, and
      the epic is named by the withdrawn kind on both surfaces
- [ ] 6.5 REGRESSION GUARD: the end-to-end remedy — an archived openspec epic whose `delivered`
      disposition is AGENT-recorded, carrying Gate 1 (recorded with `--artifact`) and Gate 2 recorded 2 s
      apart → the combined call withdrawing both with `--status archived --outcome superseded --reason y
      --correct-disposition z --no-deferrals` exits 0 → the epic is `superseded`, keeps the prior
      `delivered` under `superseded`, carries no Gate 1 or Gate 2 verdict and exactly two
      `withdrawnGateReviews` entries → `integrity` names it under none of `gate-recorded-as-bookkeeping`,
      `archived-with-no-gate-2-review`, `archived-with-withdrawn-gate-2`,
      `archived-openspec-epic-with-no-gate-1`

## 7. Required task items

- [ ] 7.1 **Call-site completeness sweep** — `rg` from the tree at sweep time, not from design.md's table:
      every reader, writer and remover of `gateReview`, `gate1`, `gate2`, `gateHasEvidence`,
      `gateArtifacts`, `gateSummary`, `gateStaleness`, `stalenessMarking`, `ungatedArchives`,
      `recordedShas`, `archiveGate`, `deliveredObligations`, `KNOWN_GATE_NUMBERS`, and the new
      `withdrawnGateReviews` / `withdrawnGate`. For each: where the withdrawn state holds, where it does
      not, and why. DATA references: `withdrawnGateReviews[].entry` holds shas — record in
      `recordedShas`'s own "a third holder added later must be added HERE" comment that they are
      deliberately not checked, mirroring `withdrawnCommits`. Also `INVOCATION_DROPPED_FLAGS`
      (`update-epic.mjs`): record that `--withdraw-gate-review`/`--withdrawal-reason` are deliberately NOT
      in it, because design.md's #175 remedy needs them echoed in the printed invocation
- [ ] 7.2 **Inverse of every operation added** — `--withdraw-gate-review` inverts `record-gate-review`;
      its own inverse is re-recording, not an un-withdraw verb. `record-cross-spec-review` has no
      withdrawal: justified in design.md
- [ ] 7.3 **Verify against the commit** — `git show --stat <sha>` for every task commit; each claimed
      file present
- [ ] 7.4 **Attribute every commit** at the moment it lands:
      `update-epic gate-verdict-withdrawal --attribute-commit <sha>`. The archive commit is excluded
- [ ] 7.5 **Dispositions** <!-- pm:lifecycle --> — archive with 9.3's exact flags (its two `--declined-deferral`s), adding a
      `--deferral "<epicId>:<section>"` for any deferral registered while the work ran; never
      `--no-deferrals`, which would erase the two declines
- [ ] 7.6 **Route what the work taught** — a practice → register an epic; tooling friction →
      `/pm:feedback [bug|feature] "<summary>"`; a process failure → a lesson file in `docs/lessons/`.
      Name which each is

## 8. Harness and docs

- [x] 8.1 (lands with 2.3) Extend conductor-13's documented-flag harness with a full-argv `pre` step (the
      entry passing `--withdrawal-reason`, so 3.2's refusal never breaks it), so the
      `--withdraw-gate-review` entry records a gate verdict (`record-gate-review subject --gate 2 …`)
      before the flag runs — an entry asserting only the refusal is ruled out by that table's comments
- [x] 8.2 (lands with 2.3) The hand-written usage line in `update-epic.mjs` (conductor-13 reads flags from it);
      `commands/epic.md` flag table (conductor-36 enforces the registry⇒doc row)
- [ ] 8.3 `README.md` — the command table, the archive-gate prose naming the withdrawn state, and the
      prose sentence naming the integrity checks gaining `archived-with-withdrawn-gate-2`; `commands/status.md`'s UNGATED
      ARCHIVES bullet gaining the withdrawn heading; correct
      `--withdraw-commit <sha> --reason` to `--withdrawal-reason`, wrong since 0.38.0
- [ ] 8.4 (note in the SKILL.md flag entry) running the verb on a LIVE archived epic of this
      repository adds an integrity finding that conductor-15 test 9.14 requires explained in
      `integrity-day-one.md` — the #192 shape; say so where the flag is documented.
      `skills/conductor/SKILL.md` — the flag in the two-gate mechanical-check section; a
      `withdrawnGateReviews?` schema entry beside `withdrawnCommits?`; the `gateReview?` schema line
      noting a gate may be in the withdrawn state. `agents/hierarchy-child-executor.md` — its
      missing-Gate-2 guidance covers the withdrawn wording
- [ ] 8.5 `rules.mjs` Reporting item 1 — withdrawals are recorded writes; update the emitted-block
      fixtures the rules tests compare against
- [ ] 8.6 `CHANGELOG.md` `[Unreleased]` entry. The version bump, the Mintlify Changelog page and Real
      Numbers belong to the 0.43.0 release cut under `release-checklist`
- [ ] 8.7 Mintlify content sync for the flag (`/commands/epic`) in the same PR cycle as the release
- [ ] 8.8 Full suite green, written to a file and read from the file

## 9. Gates and close

- [ ] 9.1 Gate 2 — two lenses over the committed range; `record-gate-review gate-verdict-withdrawal
      --gate 2 --verdict pass --reviewer "<identity>" --base-sha <parent of first attributed>
      --head-sha <last attributed>`
- [x] 9.2 `gh-cfdude-pm-192` ended at registration — `update-epic gh-cfdude-pm-192 --status archived
      --outcome superseded --reason "…" --no-deferrals` — so no gate is copied onto the mirror
- [ ] 9.3 Archive this change <!-- pm:lifecycle --> — `/opsx:archive gate-verdict-withdrawal`, then
      `update-epic gate-verdict-withdrawal --status archived --outcome delivered` with
      `--declined-deferral "withdraw-cross-spec-review::a spec change already stales that verdict"
      --declined-deferral "un-withdraw verb::re-recording is the way back"`, plus a `--deferral` for any
      deferral registered while the work ran
