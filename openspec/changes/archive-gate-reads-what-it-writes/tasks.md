## 0. Before any code

- [ ] 0.1 Gate 1 — two fresh-context lenses over these artifacts BY PATH; record with
      `record-gate-review archive-gate-reads-what-it-writes --gate 1 --verdict pass --reviewer "<identity>"
      --artifact openspec/changes/archive-gate-reads-what-it-writes/proposal.md --artifact
      openspec/changes/archive-gate-reads-what-it-writes/design.md --artifact
      openspec/changes/archive-gate-reads-what-it-writes/tasks.md --artifact
      openspec/changes/archive-gate-reads-what-it-writes/specs/gate-integrity/spec.md`
- [ ] 0.2 **Cross-spec review** (required task item 5) — owed: 0.43.0 holds this change's spec and
      `gate-verdict-withdrawal`'s, two files on `gate-integrity`. Run the `cross-spec-review` skill
      after both changes pass Gate 1, and again after any later amendment to either; record with
      `record-cross-spec-review 0.43.0 --verdict pass|fail --reviewer "<identity>"`

## 1. The gate reads the written record

Each test supplies every other input valid and asserts `state.json` byte-identical on refusal. New
file `scripts/test/archive-gate-order.test.mjs`, importing `helpers.mjs`. A "descendant" is a commit
descending from the fixture's `headSha` in the fixture repo.

- [ ] 1.1 RED: `--lane openspec --status archived --outcome delivered --no-deferrals` on a
      `claude-code` epic with no Gate 2 is refused
- [ ] 1.2 RED: `--attribute-commit <descendant> --status archived …` on an openspec epic whose passing
      Gate 2 `headSha` is its last attribution is refused naming the sha
- [ ] 1.3 RED: `--add-story s --status archived …` on a `claude-code` epic whose stories are all done is
      refused
- [ ] 1.4 RED: `--withdraw-commit <only sha> --withdrawal-reason x --status archived …` on an openspec
      epic with a covering passing Gate 2 is refused
- [ ] 1.5 RED: `--story 1 --done --status archived …` where story 1 is the only outstanding story
      exits 0 (today's false refusal)
- [ ] 1.6 RED: `--lane claude-code --status archived --outcome delivered …` on an openspec epic with
      no Gate 2 and no outstanding work exits 0
- [ ] 1.6a RED: `--clear plan --status archived --outcome delivered --no-deferrals` on a `claude-code`
      epic whose only source is a plan with outstanding tasks exits 0 and announces the cleared plan
- [ ] 1.7 RED: the fixture of "A refused call announces no cleared field" (claude-code lane, no
      stories, ranked P2, a parent, a sync-ignored plan whose tasks are all ticked) prints none of the
      three lines when refused; the variant without `--lane openspec` exits 0 and prints all three
- [ ] 1.8 GREEN: move `archiveGate()` in `updateEpic` to after the `--clear` loop and before the
      `completedAt` stamp; route the tombstone, rank and `clearNote` stderr writes through an
      `announcements` array flushed after the gate and the Half 2 check pass, before `saveState()`
- [ ] 1.9 Every existing test passes unchanged, or is corrected and named in the commit message with
      why it pinned wrong behavior

## 2. One definition of the delivered obligations

- [ ] 2.1 RED then GREEN: export `deliveredObligations(epic, {carriedTo})` from `archive-gate.mjs`,
      returning the failing `{kind: "gate2"|"handoff", detail}` entries (empty when met, Gate 2 first);
      unit-test it on five fixtures (met; no Gate 2; stale; outstanding story; both failing)
- [ ] 2.2 REFACTOR: `archiveGate()` renders its messages from it; the existing gate-message tests pass
      byte-for-byte

## 3. An archived epic's obligations do not regress

RED tasks fail on today's engine. REGRESSION GUARD tasks pass today and must keep passing after
3.13's GREEN.

- [ ] 3.1 RED: archived `delivered` `claude-code` epic, no Gate 2 ever recorded → `--lane openspec
      --notes "moved to the openspec lane"` refused naming Gate 2; the message does not contain
      `cannot archive`; exactly one line begins `  update-epic `
- [ ] 3.2 RED: archived `delivered` openspec epic with covering passing Gate 2 → `--attribute-commit
      <descendant>` refused naming the sha
- [ ] 3.3 RED: the same epic with its change directory under `openspec/changes/archive/` →
      `--status queued --attribute-commit <descendant>` refused, state byte-identical (the heal route)
- [ ] 3.4 RED: archived `delivered` `claude-code` epic, stories all done → `--add-story s` refused; no
      line other than the one beginning `  update-epic ` names `--carried-to`, `--outcome` or `--reason`
- [ ] 3.4a RED: archived `delivered` openspec epic with its change archived on disk → `--status active
      --attribute-commit <descendant>` refused; the refusal says the `--status` was dropped and why
- [ ] 3.5 RED: archived `delivered` openspec epic, one covered attribution → `--withdraw-commit <it>
      --withdrawal-reason x` refused naming the Gate 2 demand
- [ ] 3.5a RED: the queued heal window — archive `delivered` over a covering Gate 2, `--status queued`
      with nothing archived on disk (accepted), move the change under `openspec/changes/archive/`, then
      `--attribute-commit <descendant>` is refused, state byte-identical
- [ ] 3.6 RED: per obligation — the "already-failing handoff does not mask" fixture (archived
      `delivered --carried-to z` with an outstanding story, then `remove-epic z`) → `--withdraw-commit
      <its only sha> --withdrawal-reason x` refused naming the Gate 2 demand
- [ ] 3.7 RED: archived `delivered` `claude-code` epic, no Gate 2, ranked P2 → `--priority P1 --lane
      openspec` refused with no rank-clear line on stderr
- [ ] 3.8 RED: 3.1's refusal on an agent-recorded disposition (archived via the verb with
      `--no-deferrals`) prints an invocation carrying `--correct-disposition` and no deferral
      placeholder
- [ ] 3.9 RED: a migration-stamped `delivered` epic (pre-0.27.0 state with a passing Gate 2, through
      `upgrade`), stories done → `--add-story s` refused; the printed invocation carries no
      `--correct-disposition` and carries `<--no-deferrals | --deferral "<epicId>:<section>">`
- [ ] 3.10 RED: the "printed invocation runs" fixture (`--lane openspec --notes "Rob's move"
      --clear-links --add-story "two words" --add-story=--x`), refused, its printed line filled with
      `--outcome superseded`, a reason and a correction reason, run through `sh -c` → exits 0; prior
      disposition under `superseded`; latest note `Rob's move`; no links; exactly the two stories
- [ ] 3.10a RED: the ratchet — archived `delivered` openspec epic with a Gate 2 `fail` recorded after
      archive and an agent-recorded disposition: `--lane claude-code` exits 0; `--lane openspec` then
      refused naming Gate 2; its printed invocation filled with `--outcome superseded`, a reason and a
      correction reason exits 0
- [ ] 3.11 REGRESSION GUARD: archived `delivered` openspec epic with a Gate 2 `fail` recorded by
      `record-gate-review` after archive → `--attribute-commit <sha>` exits 0
- [ ] 3.12 REGRESSION GUARD: archived `superseded` `claude-code` epic → `--lane openspec --add-story s`
      exits 0; archived `unknown` engine-stamped epic → `--lane openspec` exits 0
- [ ] 3.13 GREEN: `structuredClone(epic)` immediately after lookup; the check at the gate's position
      when `outcomeOf(snapshot) === "delivered" && str(f.status) !== "archived" && (isArchived(id) ||
      (snapshot.status === "archived" && f.status === undefined))` — every read from `snapshot`, never
      `epic`; refuse where an obligation kind failing after is not failing before; its own message
      (no `cannot archive`); the printed invocation alone on a line beginning `  update-epic `, with
      raw tokens echoed minus `--status` and disposition flags (with values, by registry arity), each
      single-quoted with `'` → `'\''`, branching on `isEngineStamped` and on an existing
      `deferralAssertion`; `detail` excludes the gate's remedy text
- [ ] 3.14 REGRESSION GUARD: archived `delivered` `claude-code` epic, no Gate 2, no archived change
      directory → `--status queued --lane openspec` exits 0 and leaves it `queued`; then
      `--status archived --outcome delivered --reason r --correct-disposition c --no-deferrals` is
      refused for the missing Gate 2
- [ ] 3.15 REGRESSION GUARD: a non-archived epic with nothing archived on disk never runs the check (a queued epic's `--lane openspec`
      output and state are unchanged from today)

## 4. Required task items

- [ ] 4.1 **Call-site completeness sweep** — derived with `rg` at sweep time:
      - every caller of `archiveGate` and `deliveredObligations`;
      - every WRITER, across `scripts/lib/`, of each input the obligations or the check's trigger read:
        `status`, `lane`, `planPath`, `specPath`, `stories`, `attributedCommits`, `withdrawnCommits`,
        `gateReview.gate2`, `disposition` and `disposition.carriedTo`. That list includes
        `reconcileArchived`, `record-gate-review`, `remove-epic`'s `epicReferences` sweep, and the
        migrations.

      For each writer, state whether it can run on an archived epic, and whether this change binds
      it or design.md's "What this deliberately does not do" justifies it.
      DATA references: none added
- [ ] 4.2 **Inverse of every operation added** — the regression refusal's exits are the printed
      invocation and a genuine unarchive, each ending at the full gate or at a path held by
      `archived-delivered-gate2-regression-report`; state it in the commit
- [ ] 4.3 **Verify against the commit** — `git show --stat <sha>` for every task commit; each claimed
      file present
- [ ] 4.4 **Attribute every commit** as it lands:
      `update-epic archive-gate-reads-what-it-writes --attribute-commit <sha>`. The archive commit is
      excluded
- [ ] 4.5 **Dispositions** — archive with `update-epic archive-gate-reads-what-it-writes --status archived --outcome delivered --deferral
      "archived-delivered-gate2-regression-report:design.md What this deliberately does not do" --deferral
      "status-write-undone-by-heal-reports-updated:design.md What this deliberately does not do"`
- [ ] 4.6 **Route what the work taught** — a practice → register an epic; tooling friction →
      `/pm:feedback [bug|feature] "<summary>"`; a process failure → a lesson in `docs/lessons/`. Name
      which each is

## 5. Docs

- [ ] 5.1 `commands/epic.md` — the archive section: the gate decides on the record the call writes; an
      update to an archived `delivered` epic may be refused, and the invocation that refusal prints
- [ ] 5.2 `README.md`, `skills/conductor/SKILL.md` and `agents/hierarchy-child-executor.md` — the same
      facts where the archive gate or its refusal is described
- [ ] 5.3 `CHANGELOG.md` `[Unreleased]` — fixed (the one-call bypasses and the false refusal) and
      changed (the regression refusal)
- [ ] 5.4 Mintlify `/commands/epic` in the 0.43.0 release cycle, under `mintlify-doc-sync`
- [ ] 5.5 Full suite green, written to a file and read from the file

## 6. Gates and close

- [ ] 6.1 Gate 2 — two lenses over the committed range; `record-gate-review
      archive-gate-reads-what-it-writes --gate 2 --verdict pass --reviewer "<identity>" --base-sha
      <parent of first attributed> --head-sha <last attributed>`
- [ ] 6.2 Archive this change <!-- pm:lifecycle --> — `/opsx:archive archive-gate-reads-what-it-writes`,
      then the disposition in 4.5
- [ ] 6.3 Resume the paused epic <!-- pm:lifecycle --> — `pop-detour gate-verdict-withdrawal`, run the reconciler against what
      shipped, record `record-reconcile gate-verdict-withdrawal --detour archive-gate-reads-what-it-writes
      --verdict valid|invalidated [--amendments "<a>;<b>"]`, and write the POP Honcho line
