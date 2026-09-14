## 1. The bypass on the shipped flag — first, because it is live

- [ ] 1.1 RED: one `update-epic` carrying `--withdraw-commit <sha> --withdrawal-reason r --status archived
      --outcome delivered --no-deferrals` on an openspec-lane epic whose only attributed commit is
      covered by a passing Gate 2 is refused, `state.json` byte-identical (reproduces Gate 1's finding)
- [ ] 1.2 GREEN: move the `--withdraw-commit` block — its refusals AND its in-memory mutation — ahead
      of `archiveGate()` in `updateEpic`, so the gate evaluates the record the invocation will write.
      The read-back stays after `render()`
- [ ] 1.3 RED then GREEN: withdrawing a commit from an ALREADY-archived `delivered` openspec-lane epic,
      without `--status archived`, is refused when the result would fail the archive gate, and the
      refusal names the `--correct-disposition` combined form
- [ ] 1.4 Assert every existing conductor-36 withdraw-commit test still passes unchanged

## 2. The withdrawal write

- [ ] 2.1 Export `KNOWN_GATE_NUMBERS` from `constants.mjs`; register `withdraw-gate-review` in
      `EPIC_FLAGS` (`key:null`, `write:"custom"`, `repeats:true`, `requires` naming the gate number);
      make `withdrawal-reason`'s `requires` text name BOTH withdrawal flags
- [ ] 2.2 Add `withdrawnGate(epic, n)` beside `gateHasEvidence` — the latest withdrawal of gate N when
      gate N has no live verdict, else null. Every surface below calls it; none re-derives it
- [ ] 2.3 RED then GREEN: withdrawing a Gate 2 `pass` removes `gateReview.gate2` and appends
      `{gate, entry, reason, withdrawnAt}` whose `entry` deep-equals the stored verdict. Implement in
      `updateEpic` immediately after the `--withdraw-commit` block, i.e. BEFORE `archiveGate()`
- [ ] 2.4 RED then GREEN: a Gate 1 carrying `superseded` moves whole; nothing is promoted
- [ ] 2.5 RED then GREEN: withdrawing one gate leaves the other deep-equal
- [ ] 2.6 RED then GREEN: `--withdraw-gate-review 1 --withdraw-gate-review 2` withdraws both, two entries
- [ ] 2.7 RED then GREEN: re-recording after a withdrawal starts clean — no `superseded`, withdrawal kept
- [ ] 2.8 RED then GREEN: read-back after `render()` — the gate absent AND a matching withdrawal entry,
      else exit non-zero "did NOT land". Force the failure by exporting the read-back check as a pure
      function over (before-request, state-read-back) and unit-testing it with a state that still
      carries the verdict; the CLI path calls that same function
- [ ] 2.9 RED then GREEN: the archive gate evaluates a gate withdrawal's result — one call withdrawing
      Gate 2 with `--status archived --outcome delivered` is refused, `state.json` byte-identical
- [ ] 2.10 RED then GREEN: an already-archived `delivered` openspec-lane epic refuses a bare Gate 2
      withdrawal, naming the combined form
- [ ] 2.11 RED then GREEN: the end-to-end remedy — archived `delivered` epic with Gate 1 and Gate 2
      recorded 2 s apart → one combined call withdrawing both and correcting to `superseded` exits 0 →
      `integrity` reports it under none of `gate-recorded-as-bookkeeping`,
      `archived-with-no-gate-2-review`, `archived-openspec-epic-with-no-gate-1`

## 3. Refusals

Each test supplies every other input valid and asserts `state.json` is byte-identical.

- [ ] 3.1 RED then GREEN: no `--withdrawal-reason`
- [ ] 3.2 RED then GREEN: gate `3`, `0` and `x` — the message names `KNOWN_GATE_NUMBERS`
- [ ] 3.3 RED then GREEN: the same gate twice
- [ ] 3.4 RED then GREEN: no live verdict for the gate
- [ ] 3.5 RED then GREEN: a Gate 2 whose verdict is `ungated` — keyed on the VERDICT, never on
      `recordedBy` (conductor-13 asserts no `scripts/lib` module reads `.recordedBy` off an epic)
- [ ] 3.6 RED then GREEN: `--withdrawal-reason` with neither withdrawal flag, refused before `loadState`

## 4. Withdrawn is a state, never absence

- [ ] 4.1 RED then GREEN: `archiveGate` refuses a withdrawn Gate 2 by name, quoting the reason
- [ ] 4.2 RED then GREEN: `archived-openspec-epic-with-no-gate-1` names a withdrawn Gate 1
- [ ] 4.3 RED then GREEN: re-recording clears the state — the archive with `--outcome delivered
      --no-deferrals` exits 0, and PROJECT.md, the brief and `integrity` name no withdrawn Gate 2
- [ ] 4.4 RED then GREEN: ONE helper beside `gateSummary` decides which epics a gate table lists and
      renders the cell `withdrawn — <reason>`; `render` and `buildBrief` both call it. Scenarios: one
      gate withdrawn; BOTH withdrawn (the epic must not drop out of either table)
- [ ] 4.5 RED then GREEN: `diffEvents` emits `gate-withdrawn` on GROWTH of `withdrawnGateReviews`;
      a write removing `gate2` with no new withdrawal entry emits none
- [ ] 4.6 RED then GREEN: `activity-report.mjs` lists `gate-withdrawn` in its gates section; add the
      kind to `activity-log.mjs`'s kind-list comment and `commands/activity.md`

## 5. The heal and the standing condition

- [ ] 5.1 RED then GREEN: `reconcileArchived` skips the `ungated` stamp when `withdrawnGate(e, 2)`;
      the disposition half and the status flip are unchanged
- [ ] 5.2 Assert the heal is byte-identical where nothing was withdrawn
- [ ] 5.3 RED then GREEN: `ungatedArchives` returns `{epic, kind: "ungated"|"withdrawn", withdrawal}`,
      keeping the openspec-lane and `inCompletionScope` filters INSIDE it; `archived-with-no-gate-2-review`
      and the brief's notice each word the withdrawn kind with its reason and never say "no review
      recorded by anyone"
- [ ] 5.4 RED then GREEN: a withdrawn entry whose `superseded` was an `ungated` stamp says so
- [ ] 5.5 RED then GREEN: a withdrawn Gate 2 on an archived `superseded` epic is named by neither surface

## 6. Required task items

- [ ] 6.1 **Call-site completeness sweep** — `rg` from the tree at sweep time, not from design.md's table:
      every reader, writer and remover of `gateReview`, `gate1`, `gate2`, `gateHasEvidence`,
      `gateArtifacts`, `gateSummary`, `gateStaleness`, `stalenessMarking`, `ungatedArchives`,
      `recordedShas`, `archiveGate`, and the new `withdrawnGateReviews` / `withdrawnGate`. For each:
      where the withdrawn state holds, where it does not, and why. DATA references:
      `withdrawnGateReviews[].entry` holds shas — record in `recordedShas`'s own "a third holder added
      later must be added HERE" comment that they are deliberately not checked, mirroring
      `withdrawnCommits`. The `--withdraw-commit` ordering bypass is the sibling this sweep exists for:
      state it closed in 1.2
- [ ] 6.2 **Inverse of every operation added** — `--withdraw-gate-review` inverts `record-gate-review`;
      its own inverse is re-recording, not an un-withdraw verb. `record-cross-spec-review` has no
      withdrawal: justified in design.md
- [ ] 6.3 **Verify against the commit** — `git show --stat <sha>` for every task commit; each claimed
      file present
- [ ] 6.4 **Attribute every commit** at the moment it lands:
      `update-epic gate-verdict-withdrawal --attribute-commit <sha>`. The archive commit is excluded
- [ ] 6.5 **Cross-spec review** — not owed while 0.43.0 holds one spec file. `release show 0.43.0` before
      `/opsx:apply`; if a second spec file has joined, run the `cross-spec-review` skill and record it
- [ ] 6.6 **Route what the work taught** — practice, tooling friction, process failure — before closing

## 7. Harness and docs

- [ ] 7.1 Extend conductor-13's documented-flag harness with a full-argv `pre` step, so the
      `--withdraw-gate-review` entry records a gate verdict (`record-gate-review subject --gate 2 …`)
      before the flag runs — an entry asserting only the refusal is ruled out by that table's comments
- [ ] 7.2 The hand-written usage line in `update-epic.mjs` (conductor-13 reads flags from it);
      `commands/epic.md` flag table (conductor-36 enforces the registry⇒doc row)
- [ ] 7.3 `README.md` command table — and correct its `--withdraw-commit <sha> --reason` to
      `--withdrawal-reason`, wrong since 0.38.0
- [ ] 7.4 `skills/conductor/SKILL.md` — the flag in the two-gate mechanical-check section, and a
      `withdrawnGateReviews?` schema entry beside `withdrawnCommits?`
- [ ] 7.5 `rules.mjs` Reporting item 1 — withdrawals are recorded writes; update the emitted-block
      fixtures the rules tests compare against
- [ ] 7.6 `CHANGELOG.md` `[Unreleased]` entry. The version bump, the Mintlify Changelog page and Real
      Numbers belong to the 0.43.0 release cut under `release-checklist`, not to this change
- [ ] 7.7 Mintlify content sync for the flag (`/commands/epic`) in the same PR cycle as the release
- [ ] 7.8 Full suite green, written to a file and read from the file

## 8. Gates and close

- [ ] 8.1 Gate 1 — two fresh-context reviewers over these artifacts BY PATH; record with
      `record-gate-review gate-verdict-withdrawal --gate 1 --verdict pass --reviewer "<identity>"
      --artifact openspec/changes/gate-verdict-withdrawal/proposal.md --artifact …/design.md
      --artifact …/tasks.md --artifact …/specs/gate-integrity/spec.md`
- [ ] 8.2 Gate 2 — two lenses over the committed range; `headSha` equals the last attributed commit
- [x] 8.3 `gh-cfdude-pm-192` ended at registration — `update-epic gh-cfdude-pm-192 --status archived
      --outcome superseded --reason "…" --no-deferrals` — so no gate is transcribed onto the mirror
- [ ] 8.4 Archive this change <!-- pm:lifecycle --> — `/opsx:archive gate-verdict-withdrawal`, then
      `update-epic gate-verdict-withdrawal --status archived --outcome delivered --no-deferrals`
