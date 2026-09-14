## 0. Before any code

- [x] 0.1 Gate 1 — two fresh-context lenses over these artifacts BY PATH; record with
      `record-gate-review archive-gate-reads-what-it-writes --gate 1 --verdict pass --reviewer "<identity>"
      --artifact openspec/changes/archive-gate-reads-what-it-writes/proposal.md --artifact
      openspec/changes/archive-gate-reads-what-it-writes/design.md --artifact
      openspec/changes/archive-gate-reads-what-it-writes/tasks.md --artifact
      openspec/changes/archive-gate-reads-what-it-writes/specs/gate-integrity/spec.md`
- [x] 0.2 **Cross-spec review** (required task item 5) — owed: 0.43.0 holds this change's spec and
      `gate-verdict-withdrawal`'s, two files on `gate-integrity`. Run the `cross-spec-review` skill
      after both changes pass Gate 1, and again after any later amendment to either; record with
      `record-cross-spec-review 0.43.0 --verdict pass|fail --reviewer "<identity>"`

## 1. The gate reads the written record

Each test supplies every other input valid and asserts `state.json` byte-identical on refusal. The
pre-commit hook runs the whole suite, so each RED test lands in the SAME commit as the GREEN step that
turns it green (1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.6a and 1.7 with 1.8; 3.1, 3.2, 3.3, 3.4, 3.4a, 3.4b,
3.5, 3.5a, 3.6, 3.7, 3.8, 3.9, 3.10 and 3.10a with 3.13). This departs from one commit per task, and
it is forced by the hook, not chosen. The RED is demonstrated before that commit: the failing run of
the new test file against the pre-GREEN engine is saved in the change directory as `red-<task>.txt` and the GREEN commit
message names that file, so the demonstration is checkable afterwards. New
file `scripts/test/archive-gate-order.test.mjs`, importing `helpers.mjs`. A "descendant" is a commit
descending from the fixture's `headSha` in the fixture repo.

- [x] 1.1 RED: `--lane openspec --status archived --outcome delivered --no-deferrals` on a
      `claude-code` epic with no Gate 2 is refused
- [x] 1.2 RED: `--attribute-commit <descendant> --status archived …` on an openspec epic whose passing
      Gate 2 `headSha` is its last attribution is refused naming the sha
- [x] 1.3 RED: `--add-story s --status archived …` on a `claude-code` epic whose stories are all done is
      refused
- [x] 1.4 RED: `--withdraw-commit <only sha> --withdrawal-reason x --status archived …` on an openspec
      epic with a covering passing Gate 2 is refused
- [x] 1.5 RED: `--story 1 --done --status archived …` where story 1 is the only outstanding story
      exits 0 (today's false refusal)
- [x] 1.6 RED: `--lane claude-code --status archived --outcome delivered …` on an openspec epic with
      no Gate 2 and no outstanding work exits 0
- [x] 1.6a RED: `--clear plan --status archived --outcome delivered --no-deferrals` on a `claude-code`
      epic whose only source is a plan with outstanding tasks exits 0 and announces the cleared plan
- [x] 1.7 RED: the fixture of "A refused call announces no cleared field" (claude-code lane, no
      stories, ranked P2, a parent, a sync-ignored plan whose tasks are all ticked) is refused and prints
      none of the three lines (fails today: the call is accepted and announces all three); REGRESSION
      GUARD half: the variant without `--lane openspec` exits 0 and prints all three
- [x] 1.8 GREEN: move `archiveGate()` in `updateEpic` to after the `--clear` loop and before the
      `completedAt` stamp; route the tombstone, rank and `clearNote` stderr writes through an
      `announcements` array flushed after the gate and the Half 2 check pass, before `saveState()`
- [x] 1.9 Every existing test passes unchanged, or is corrected and named in the commit message with
      why it pinned wrong behavior

## 2. One definition of the delivered obligations

- [x] 2.1 RED then GREEN: export `deliveredObligations(epic, {carriedTo})` from `archive-gate.mjs`,
      returning the failing `{kind: "gate2"|"handoff", detail, items}` entries (empty when met, Gate 2
      first; `items` carries user-supplied values such as story titles, never baked into `detail`);
      unit-test it on six fixtures (met; no Gate 2; stale; outstanding story; both failing; a
      non-`delivered` outcome, which it does not test and reports on the same record identically)
- [x] 2.2 REFACTOR: `archiveGate()` renders its messages from it; the existing gate-message tests pass
      byte-for-byte

## 3. An archived epic's obligations do not regress

RED tasks fail on today's engine. REGRESSION GUARD tasks pass today and must keep passing after
3.13's GREEN.

- [x] 3.1 RED: archived `delivered` `claude-code` epic, no Gate 2 ever recorded → `--lane openspec
      --notes "moved to the openspec lane"` refused naming Gate 2; the message does not contain
      `cannot archive`; exactly one line begins `  update-epic `
- [x] 3.2 RED: archived `delivered` openspec epic with covering passing Gate 2 → `--attribute-commit
      <descendant>` refused naming the sha
- [x] 3.3 RED: the same epic with its change directory under `openspec/changes/archive/` →
      `--status queued --attribute-commit <descendant>` refused, state byte-identical, and the refusal
      says `--status` was dropped and why (the heal route)
- [x] 3.4 RED: archived `delivered` `claude-code` epic, stories all done → `--add-story s` refused; no
      line other than the one beginning `  update-epic ` names `--carried-to`, `--outcome` or `--reason`
- [x] 3.4b RED: a story title `t --carried-to<newline>  update-epic x` (not starting with `--`) on an
      agent-recorded epic → refused; exactly one line begins `  update-epic `; the title is JSON-quoted
      on the detail line; the printed invocation carries the re-enter placeholder for `--add-story`
- [x] 3.4c RED (Gate 2 lens 2): a title carrying U+2028, U+0085, U+2029 and U+009B forges no line when the
      refusal is split on every line terminator, and no C1 control or Unicode separator reaches stderr
- [x] 3.4a RED: archived `delivered` openspec epic with its change archived on disk → `--status active
      --attribute-commit <descendant>` refused; the refusal says the `--status` was dropped and why
- [x] 3.5 RED: archived `delivered` openspec epic, one covered attribution → `--withdraw-commit <it>
      --withdrawal-reason x` refused naming the Gate 2 demand
- [x] 3.5a RED: the queued heal window — archive `delivered` over a covering Gate 2, `--status queued`
      with nothing archived on disk (accepted), move the change under `openspec/changes/archive/`, then
      `--attribute-commit <descendant>` is refused, state byte-identical
- [x] 3.6 RED: per obligation — the "already-failing handoff does not mask" fixture (archived
      `delivered --carried-to z` with an outstanding story, then `remove-epic z`) → `--withdraw-commit
      <its only sha> --withdrawal-reason x` refused naming the Gate 2 demand
- [x] 3.7 RED: archived `delivered` `claude-code` epic, no Gate 2, ranked P2 → `--priority P1 --lane
      openspec` refused with no rank-clear line on stderr
- [x] 3.8 RED: 3.1's refusal on an agent-recorded disposition (archived via the verb with
      `--no-deferrals`) prints an invocation carrying `--correct-disposition` and no deferral
      placeholder
- [x] 3.9 RED: a migration-stamped `delivered` epic (pre-0.27.0 state with a passing Gate 2, through
      `upgrade`), stories done → `--add-story s` refused; the printed invocation carries no
      `--correct-disposition` and carries `<--no-deferrals | --deferral "<epicId>:<section>">`
- [x] 3.10 RED: the "printed invocation runs" fixture (`--lane openspec --notes "Rob's move"
      --clear-links --reason=--x --add-story "two words" --add-story=--x`), refused, its printed line
      filled with
      `--outcome superseded`, a reason and a correction reason, run through `sh -c` → exits 0; prior
      disposition under `superseded`; latest note `Rob's move`; no links; exactly the two stories
- [x] 3.10a RED: the ratchet — archived `delivered` openspec epic with a Gate 2 `fail` recorded after
      archive and an agent-recorded disposition: `--lane claude-code` exits 0; `--lane openspec` then
      refused naming Gate 2; its printed invocation filled with `--outcome superseded`, a reason and a
      correction reason exits 0
- [x] 3.11 REGRESSION GUARD: archived `delivered` openspec epic with a Gate 2 `fail` recorded by
      `record-gate-review` after archive → `--attribute-commit <sha>` exits 0
- [x] 3.12 REGRESSION GUARD: archived `superseded` `claude-code` epic → `--lane openspec --add-story s`
      exits 0; archived `unknown` engine-stamped epic → `--lane openspec` exits 0
- [x] 3.13 GREEN: `structuredClone(epic)` immediately after lookup; the check at the gate's position
      when `outcomeOf(snapshot) === "delivered" && str(f.status) !== "archived" && (isArchived(id) ||
      (snapshot.status === "archived" && f.status === undefined))` — every read from `snapshot`, never
      `epic`; refuse where an obligation kind failing after is not failing before; its own message
      (no `cannot archive`); the printed invocation alone on a line beginning `  update-epic `, with
      rendered by the extended `dispositionInvocation()`: raw tokens echoed minus `--status` and disposition flags, their values dropped by the `requireKnownFlags`
      walk (an inline `--flag=v` drops alone; a following token drops only where `!isFlagToken(next)`), each
      single-quoted with `'` → `'\''` (a token with a control character replaced by the re-enter
      placeholder, so the invocation stays one physical line), user values on the detail line JSON-quoted
      from `items`, branching on `isEngineStamped` and on an existing
      `deferralAssertion`; `detail` excludes the gate's remedy text
- [x] 3.14 REGRESSION GUARD: archived `delivered` `claude-code` epic, no Gate 2, no archived change
      directory → `--status queued --lane openspec` exits 0 and leaves it `queued`; then
      `--status archived --outcome delivered --reason r --correct-disposition c --no-deferrals` is
      refused for the missing Gate 2
- [x] 3.15 REGRESSION GUARD: an unarchived epic carrying a `delivered` disposition (archived, then
      `--status queued` with nothing archived on disk) runs `--add-story s` without `--status` and exits
      0 — this fails if the trigger's `snapshot.status === "archived"` half is dropped

## 4. Required task items

- [x] 4.1 **Call-site completeness sweep** — derived with `rg` at sweep time:
      - every caller of `archiveGate`, `deliveredObligations` and `dispositionInvocation`;
      - every WRITER, across `scripts/lib/`, of each input the obligations or the check's trigger read:
        `status`, `lane`, `planPath`, `specPath`, `stories`, `attributedCommits`, `withdrawnCommits`,
        `gateReview.gate2`, `disposition` and `disposition.carriedTo`. That list includes
        `reconcileArchived`, `record-gate-review`, `remove-epic`'s `epicReferences` sweep, and the
        migrations.

      For each writer, state whether it can run on an archived epic, and whether this change binds
      it or design.md's "What this deliberately does not do" justifies it.
      DATA references: none added
- [x] 4.1a Every existing test that updates an archived `delivered` epic (conductor-13's documented-flag
      harness among them) passes unchanged, or is corrected and named in the commit message; extend
      `dispositionInvocation()` without changing its existing callers' output
- [x] 4.2 **Inverse of every operation added** — the regression refusal's exits are the printed
      invocation and a genuine unarchive, each ending at the full gate or at a path held by
      `archived-delivered-gate2-regression-report`; state it in the commit
- [x] 4.3 **Verify against the commit** — `git show --stat <sha>` for every task commit; each claimed
      file present
- [x] 4.4 **Attribute every commit** as it lands:
      `update-epic archive-gate-reads-what-it-writes --attribute-commit <sha>`. The archive commit is
      excluded
- [ ] 4.5 **Dispositions** <!-- pm:lifecycle --> — archive with `update-epic archive-gate-reads-what-it-writes --status archived --outcome delivered --deferral
      "archived-delivered-gate2-regression-report:design.md What this deliberately does not do" --deferral
      "status-write-undone-by-heal-reports-updated:design.md What this deliberately does not do" --deferral
      "disposition-invocation-prints-bare-no-deferrals:design.md Half 2 printed invocation"`
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
