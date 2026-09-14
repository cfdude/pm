## 1. The gate reads the written record

Each RED test supplies every other input valid and asserts `state.json` byte-identical on refusal.
New file `scripts/test/archive-gate-order.test.mjs`, importing `helpers.mjs`.

- [ ] 1.1 RED: `--lane openspec --status archived --outcome delivered --no-deferrals` on a
      `claude-code` epic with no Gate 2 is refused
- [ ] 1.2 RED: `--attribute-commit <later sha> --status archived …` on an openspec epic whose passing
      Gate 2 `headSha` is its last attribution is refused naming the sha
- [ ] 1.3 RED: `--add-story s --status archived …` on an epic whose stories are all done is refused
- [ ] 1.4 RED: `--withdraw-commit <only sha> --withdrawal-reason x --status archived …` on an openspec
      epic with a covering passing Gate 2 is refused
- [ ] 1.5 RED: `--story 1 --done --status archived …` where story 1 is the only outstanding story
      exits 0 (today's false refusal)
- [ ] 1.6 RED: `--lane claude-code --status archived --outcome delivered …` on an openspec epic with
      no Gate 2 and no outstanding work exits 0
- [ ] 1.7 RED: the refused call of the "announces no cleared field" scenario prints none of the three
      lines; the accepted variant prints all three
- [ ] 1.8 GREEN: move `archiveGate()` in `updateEpic` to after the `--clear` loop and before the
      `completedAt` stamp; route the tombstone, rank and `clearNote` stderr writes through an
      `announcements` array flushed after the gate passes and before `saveState()`
- [ ] 1.9 Every existing archive test passes unchanged; any that pinned the old ordering is named in the
      commit message with why it was wrong

## 2. One definition of the delivered obligations

- [ ] 2.1 RED then GREEN: export `deliveredObligation(epic, {carriedTo})` from `archive-gate.mjs`,
      returning null or the failing message, and unit-test it on four fixtures (met; no Gate 2; stale;
      outstanding story)
- [ ] 2.2 REFACTOR: `archiveGate()` calls it for `delivered`; the existing gate-message tests pass
      byte-for-byte

## 3. An archived epic's obligations do not regress

- [ ] 3.1 RED: archived `delivered` `claude-code` epic, no Gate 2 → `--lane openspec` refused naming
      Gate 2
- [ ] 3.2 RED: archived `delivered` openspec epic with covering passing Gate 2 → `--attribute-commit
      <later sha>` refused naming the sha
- [ ] 3.3 RED: archived `delivered` epic, stories all done → `--add-story s` refused
- [ ] 3.4 RED: archived `delivered` openspec epic, one covered attribution → `--withdraw-commit <it>
      --withdrawal-reason x` refused
- [ ] 3.5 RED: archived `delivered` openspec epic whose Gate 2 is `ungated` → `--attribute-commit`
      exits 0 (already failing, not locked)
- [ ] 3.6 RED: archived `superseded` `claude-code` epic → `--lane openspec --add-story s` exits 0
- [ ] 3.7 RED: archived `unknown` engine-stamped epic → `--lane openspec` exits 0
- [ ] 3.8 RED: 3.1's refusal on an agent-recorded disposition prints an invocation carrying
      `--correct-disposition`
- [ ] 3.9 RED: a migration-stamped `delivered` epic (pre-0.27.0 state with a passing Gate 2, through
      `upgrade`), stories done → `--add-story s` refused, the printed invocation carries no `--correct-disposition`
- [ ] 3.10 RED: the invocation printed in 3.8, filled with `--outcome superseded`, a reason and a
      correction reason, exits 0 and keeps the prior disposition under `superseded`
- [ ] 3.11 RED: archived `delivered` `claude-code` epic → `--status queued --lane openspec` exits 0
- [ ] 3.12 GREEN: `structuredClone(epic)` immediately after lookup; the check at the gate's position,
      when stored status is `archived`, `--status` is absent and `outcomeOf(epic) === "delivered"`;
      refuse iff before is null and after is not; the printed invocation branches on `isEngineStamped` and
      on an existing `deferralAssertion`
- [ ] 3.13 RED then GREEN: a non-archived epic never runs the check (a queued epic's `--lane openspec`
      output and state are unchanged from today)

## 4. Required task items

- [ ] 4.1 **Call-site completeness sweep** — derived with `rg` at sweep time: every caller of
      `archiveGate` and `deliveredObligation`; every WRITER, across `scripts/lib/`, of each input the
      obligations read — `lane`, `planPath`, `specPath`, `stories`, `attributedCommits`,
      `withdrawnCommits`, `gateReview.gate2`, `disposition.carriedTo` — stating for each whether it can
      run on an archived epic and whether this change binds it. `record-gate-review` is bound by
      neither requirement: justified in design.md, gap held by `archived-delivered-gate2-regression-report`.
      DATA references: none added
- [ ] 4.2 **Inverse of every operation added** — the regression refusal's exits are the printed invocation and
      unarchiving, each ending at the full gate; state it in the commit
- [ ] 4.3 **Verify against the commit** — `git show --stat <sha>` for every task commit; each claimed
      file present
- [ ] 4.4 **Attribute every commit** as it lands:
      `update-epic archive-gate-reads-what-it-writes --attribute-commit <sha>`. The archive commit is
      excluded
- [ ] 4.5 **Cross-spec review** — owed: 0.43.0 holds this change's spec and
      `gate-verdict-withdrawal`'s, two files on one capability. Before `/opsx:apply`, run the
      `cross-spec-review` skill and `record-cross-spec-review 0.43.0 --verdict … --reviewer "…"`
- [ ] 4.6 **Dispositions** — archive with `--status archived --outcome delivered --deferral
      "archived-delivered-gate2-regression-report:design.md What this deliberately does not do"`
- [ ] 4.7 **Route what the work taught** — a practice (register an epic), tooling friction
      (`/pm:feedback`), or a process failure (`docs/lessons/`), each named as which it is

## 5. Docs

- [ ] 5.1 `commands/epic.md` — the archive section states one call is decided as the split sequence,
      and that an update to an archived `delivered` epic may be refused, and the invocation that refusal prints
- [ ] 5.2 `README.md` and `skills/conductor/SKILL.md` — the same two facts where the archive gate is
      described
- [ ] 5.3 `CHANGELOG.md` `[Unreleased]` — fixed (the bypass and the false refusal) and changed (the
      regression refusal)
- [ ] 5.4 Mintlify `/commands/epic` in the 0.43.0 release cycle, under `mintlify-doc-sync`
- [ ] 5.5 Full suite green, written to a file and read from the file

## 6. Gates and close

- [ ] 6.1 Gate 1 — two fresh-context lenses over these artifacts BY PATH; record with
      `record-gate-review archive-gate-reads-what-it-writes --gate 1 --verdict pass --reviewer "<identity>"
      --artifact openspec/changes/archive-gate-reads-what-it-writes/proposal.md --artifact
      openspec/changes/archive-gate-reads-what-it-writes/design.md --artifact
      openspec/changes/archive-gate-reads-what-it-writes/tasks.md --artifact
      openspec/changes/archive-gate-reads-what-it-writes/specs/gate-integrity/spec.md`
- [ ] 6.2 Gate 2 — two lenses over the committed range; `record-gate-review
      archive-gate-reads-what-it-writes --gate 2 --verdict pass --reviewer "<identity>" --base-sha
      <parent of first attributed> --head-sha <last attributed>`
- [ ] 6.3 Archive this change <!-- pm:lifecycle --> — `/opsx:archive archive-gate-reads-what-it-writes`,
      then the disposition in 4.6; then `pop-detour gate-verdict-withdrawal` and its reconcile gate
