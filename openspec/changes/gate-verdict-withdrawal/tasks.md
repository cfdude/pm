## 1. Precondition — the archive-gate change has shipped

- [ ] 1.1 `archive-gate-reads-what-it-writes` is archived, and this epic's reconcile gate has recorded
      a verdict with `record-reconcile gate-verdict-withdrawal --detour archive-gate-reads-what-it-writes
      --verdict valid|invalidated`. Any amendment it names is applied to these artifacts BEFORE task 2.1
- [ ] 1.2 Confirm, against the shipped code rather than design.md, the name and signature of
      `deliveredObligation()` and the position of `archiveGate()` in `updateEpic`; correct every task
      below that names them

## 2. The withdrawal write

- [ ] 2.1 Export `KNOWN_GATE_NUMBERS` from `constants.mjs`; register `withdraw-gate-review` in
      `EPIC_FLAGS` (`key:null`, `write:"custom"`, `repeats:true`, `requires` naming the gate number);
      make `withdrawal-reason`'s `requires` text name BOTH withdrawal flags
- [ ] 2.2 Add `withdrawnGate(epic, n)` beside `gateHasEvidence`: the latest withdrawal of gate N when
      `gateReview.gateN` is absent, else null. Every surface below calls it; none re-derives it
- [ ] 2.3 RED then GREEN: withdrawing a Gate 2 `pass` removes `gateReview.gate2` and appends
      `{gate, entry, reason, withdrawnAt}` whose `entry` deep-equals the stored verdict. Implement in
      `updateEpic` beside the `--withdraw-commit` block, before the archive gate
- [ ] 2.4 RED then GREEN: a Gate 1 carrying `superseded` moves whole; nothing is promoted
- [ ] 2.5 RED then GREEN: withdrawing one gate leaves the other deep-equal
- [ ] 2.6 RED then GREEN: `--withdraw-gate-review 1 --withdraw-gate-review 2` withdraws both, two entries
- [ ] 2.7 RED then GREEN: re-recording after a withdrawal starts clean — no `superseded`, withdrawal kept
- [ ] 2.8 RED then GREEN: read-back after `render()` — the gate absent AND a matching withdrawal entry,
      else exit non-zero "did NOT land". Force the failure by exporting the read-back check as a pure
      function over (request, state read back) and unit-testing it with a state that still carries the
      verdict; the CLI path calls that same function

## 3. Refusals

Each test supplies every other input valid and asserts `state.json` byte-identical. Order per design.md.

- [ ] 3.1 RED then GREEN: `--withdrawal-reason` with neither withdrawal flag, refused before `loadState`,
      naming both flags
- [ ] 3.2 RED then GREEN: no `--withdrawal-reason`
- [ ] 3.3 RED then GREEN: gate `3`, `0` and `x` — the message names `KNOWN_GATE_NUMBERS`
- [ ] 3.4 RED then GREEN: the same gate twice
- [ ] 3.5 RED then GREEN: no stored verdict for the gate
- [ ] 3.6 RED then GREEN: a stored `ungated` Gate 2 (produced by the heal route, not a direct write) —
      keyed on the VERDICT, never on `recordedBy`

## 4. Bound by the archive gate (inherited, asserted here)

- [ ] 4.1 RED then GREEN: `--withdraw-gate-review 2 --withdrawal-reason x --status archived --outcome
      delivered --no-deferrals` on an openspec epic with a covering passing Gate 2 is refused, and the
      message says Gate 2 was withdrawn and quotes `x`
- [ ] 4.2 RED then GREEN: `--withdraw-gate-review 2 --withdrawal-reason x` on an archived `delivered`
      openspec epic with a covering passing Gate 2 is refused, and the printed invocation carries
      `--correct-disposition` where the disposition is agent-recorded
- [ ] 4.3 RED then GREEN: `--withdraw-gate-review 1 --withdrawal-reason x` on the same archived
      `delivered` epic exits 0 — Gate 1 is not an obligation
- [ ] 4.4 RED then GREEN: the end-to-end remedy — an archived openspec epic whose `delivered`
      disposition is AGENT-recorded, carrying Gate 1 (recorded with `--artifact`) and Gate 2 recorded 2 s
      apart → the combined call withdrawing both with `--status archived --outcome superseded --reason y
      --correct-disposition z --no-deferrals` exits 0 → `integrity` names it under none of
      `gate-recorded-as-bookkeeping`, `archived-with-no-gate-2-review`,
      `archived-openspec-epic-with-no-gate-1`

## 5. Withdrawn is a state, never absence

- [ ] 5.1 RED then GREEN: `deliveredObligation`'s Gate 2 message names a withdrawn Gate 2 and quotes the
      reason; the archive gate on an unarchived epic shows it
- [ ] 5.2 RED then GREEN: `archived-openspec-epic-with-no-gate-1` names a withdrawn Gate 1
- [ ] 5.3 RED then GREEN: re-recording clears the state — the archive with `--outcome delivered
      --no-deferrals` exits 0, and PROJECT.md, the brief and `integrity` name no withdrawn Gate 2
- [ ] 5.4 RED then GREEN: ONE helper in `archive-gate.mjs` decides which epics a gate table lists and
      renders the cell `withdrawn — <reason>`; `render` and `buildBrief` both call it, each keeping its
      own row cap. Scenarios: one gate withdrawn; BOTH withdrawn (the epic stays in both tables). Plus
      a conductor-16-style assertion that PROJECT.md and the brief list the same epic ids with the same
      cell text, asserting each rendered id is a real id string (never `undefined`)
- [ ] 5.5 RED then GREEN: `diffEvents` emits `gate-withdrawn` on GROWTH of `withdrawnGateReviews`;
      a write removing `gate2` with no new withdrawal entry emits none
- [ ] 5.6 RED then GREEN: `activity-report.mjs` lists `gate-withdrawn` in its gates section; add the
      kind to `activity-log.mjs`'s kind-list comment and `commands/activity.md`

## 6. The heal and the standing condition

- [ ] 6.1 RED then GREEN: `reconcileArchived` skips the `ungated` stamp when `withdrawnGate(e, 2)`;
      the disposition half and the status flip are unchanged
- [ ] 6.2 Assert the heal is byte-identical where nothing was withdrawn
- [ ] 6.3 RED then GREEN: `ungatedArchives` returns `{epic, kind: "ungated"|"withdrawn", withdrawal}`.
      The `ungated` kind's predicate is unchanged. ADD the `withdrawn` kind with its explicit filter
      `e.status === "archived" && isOpenspecLane(e) && inCompletionScope(e) && withdrawnGate(e, 2)`.
      `archived-with-no-gate-2-review` and the brief's notice word the withdrawn kind with its reason
      and never say "no review recorded by anyone"; assert each names the epic by its real id
- [ ] 6.4 RED then GREEN: an archived epic reached by the heal route (withdraw while open → change
      archived on disk → heal, outcome `unknown`) is named as withdrawn by both surfaces
- [ ] 6.5 RED then GREEN: the withdrawn kind names neither a `claude-code`-lane archived epic nor an
      unarchived openspec epic, each with a withdrawn Gate 2
- [ ] 6.6 RED then GREEN: an archived `superseded` openspec epic with a withdrawn Gate 2 (reached by the
      combined call in 4.4) is named by neither surface
- [ ] 6.7 RED then GREEN: a withdrawn entry whose `superseded` holds an `ungated` stamp says so on both
      surfaces

## 7. Required task items

- [ ] 7.1 **Call-site completeness sweep** — `rg` from the tree at sweep time, not from design.md's table:
      every reader, writer and remover of `gateReview`, `gate1`, `gate2`, `gateHasEvidence`,
      `gateArtifacts`, `gateSummary`, `gateStaleness`, `stalenessMarking`, `ungatedArchives`,
      `recordedShas`, `archiveGate`, `deliveredObligation`, and the new `withdrawnGateReviews` /
      `withdrawnGate`. For each: where the withdrawn state holds, where it does not, and why. DATA
      references: `withdrawnGateReviews[].entry` holds shas — record in `recordedShas`'s own "a third
      holder added later must be added HERE" comment that they are deliberately not checked, mirroring
      `withdrawnCommits`
- [ ] 7.2 **Inverse of every operation added** — `--withdraw-gate-review` inverts `record-gate-review`;
      its own inverse is re-recording, not an un-withdraw verb. `record-cross-spec-review` has no
      withdrawal: justified in design.md
- [ ] 7.3 **Verify against the commit** — `git show --stat <sha>` for every task commit; each claimed
      file present
- [ ] 7.4 **Attribute every commit** at the moment it lands:
      `update-epic gate-verdict-withdrawal --attribute-commit <sha>`. The archive commit is excluded
- [ ] 7.5 **Cross-spec review** — owed: 0.43.0 holds this spec and `archive-gate-reads-what-it-writes`'s,
      two files on `gate-integrity`. Run the `cross-spec-review` skill before `/opsx:apply`, and again if
      the reconcile gate in 1.1 amends either spec; record with `record-cross-spec-review 0.43.0`
- [ ] 7.6 **Dispositions** — archive per 9.4, with `--no-deferrals` unless a deferral is registered
- [ ] 7.7 **Route what the work taught** — a practice → register an epic; tooling friction →
      `/pm:feedback [bug|feature] "<summary>"`; a process failure → a lesson file in `docs/lessons/`.
      Name which each is

## 8. Harness and docs

- [ ] 8.1 Extend conductor-13's documented-flag harness with a full-argv `pre` step, so the
      `--withdraw-gate-review` entry records a gate verdict (`record-gate-review subject --gate 2 …`)
      before the flag runs — an entry asserting only the refusal is ruled out by that table's comments
- [ ] 8.2 The hand-written usage line in `update-epic.mjs` (conductor-13 reads flags from it);
      `commands/epic.md` flag table (conductor-36 enforces the registry⇒doc row)
- [ ] 8.3 `README.md` — the command table, and the archive-gate prose naming the withdrawn state; correct
      `--withdraw-commit <sha> --reason` to `--withdrawal-reason`, wrong since 0.38.0
- [ ] 8.4 `skills/conductor/SKILL.md` — the flag in the two-gate mechanical-check section; a
      `withdrawnGateReviews?` schema entry beside `withdrawnCommits?`; the `gateReview?` schema line
      noting a gate may be in the withdrawn state
- [ ] 8.5 `rules.mjs` Reporting item 1 — withdrawals are recorded writes; update the emitted-block
      fixtures the rules tests compare against
- [ ] 8.6 `CHANGELOG.md` `[Unreleased]` entry. The version bump, the Mintlify Changelog page and Real
      Numbers belong to the 0.43.0 release cut under `release-checklist`
- [ ] 8.7 Mintlify content sync for the flag (`/commands/epic`) in the same PR cycle as the release
- [ ] 8.8 Full suite green, written to a file and read from the file

## 9. Gates and close

- [ ] 9.1 Gate 1 — two fresh-context reviewers over these artifacts BY PATH; record with
      `record-gate-review gate-verdict-withdrawal --gate 1 --verdict pass --reviewer "<identity>"
      --artifact openspec/changes/gate-verdict-withdrawal/proposal.md --artifact
      openspec/changes/gate-verdict-withdrawal/design.md --artifact
      openspec/changes/gate-verdict-withdrawal/tasks.md --artifact
      openspec/changes/gate-verdict-withdrawal/specs/gate-integrity/spec.md`
- [ ] 9.2 Gate 2 — two lenses over the committed range; `record-gate-review gate-verdict-withdrawal
      --gate 2 --verdict pass --reviewer "<identity>" --base-sha <parent of first attributed>
      --head-sha <last attributed>`
- [x] 9.3 `gh-cfdude-pm-192` ended at registration — `update-epic gh-cfdude-pm-192 --status archived
      --outcome superseded --reason "…" --no-deferrals` — so no gate is copied onto the mirror
- [ ] 9.4 Archive this change <!-- pm:lifecycle --> — `/opsx:archive gate-verdict-withdrawal`, then
      `update-epic gate-verdict-withdrawal --status archived --outcome delivered --no-deferrals`
