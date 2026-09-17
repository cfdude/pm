## 0. Before any code

- [x] 0.1 Gate 1 — two fresh-context lenses over these artifacts BY PATH (lens A: correctness and
      testability of every WHEN/THEN against today's engine, and that each RED below really fails
      where it says it does; lens B: absent edits — call sites, DATA references and inverses the specs
      do not name, and every hook event Claude Code fires after a Bash call); fix every Critical and
      Important, re-validate with `openspec validate commit-nudge-reads-the-whole-move --strict`, then
      record
      `record-gate-review commit-nudge-reads-the-whole-move --gate 1 --verdict pass --reviewer "<identity>"
      --artifact openspec/changes/commit-nudge-reads-the-whole-move/proposal.md --artifact
      openspec/changes/commit-nudge-reads-the-whole-move/design.md --artifact
      openspec/changes/commit-nudge-reads-the-whole-move/tasks.md --artifact
      openspec/changes/commit-nudge-reads-the-whole-move/specs/commit-observation/spec.md --artifact
      openspec/changes/commit-nudge-reads-the-whole-move/specs/gate-integrity/spec.md --artifact
      openspec/changes/commit-nudge-reads-the-whole-move/specs/state-write-guard/spec.md --artifact
      openspec/changes/commit-nudge-reads-the-whole-move/specs/conductor-record/spec.md`
- [x] 0.2 **Cross-spec review** (required task item 5) — release 0.45.0 holds this change's four spec
      files and its siblings' (`emitted-commands-run-as-written`, `user-text-never-forges-output`).
      Run the `cross-spec-review` skill after all three pass Gate 1 and again after any later
      amendment; record `record-cross-spec-review 0.45.0 --verdict pass|fail --reviewer "<identity>"`
- [x] 0.3 Re-derive every function and line reference in design.md with `rg` against `dev` before
      the first implementation commit, and correct design.md in that commit if any moved

## 1. Fixtures

The pre-commit hook runs the whole suite, so every RED test lands in the SAME commit as the GREEN
task that turns it green; pairs are named per section. Before that commit, the new tests run
against the pre-GREEN engine are saved in this change directory as `red-<task>.txt`, and the GREEN
commit message names that file. New test file: `scripts/test/commit-observation.test.mjs`.

- [x] 1.1 REFACTOR: a `helpers.mjs` fixture that builds a hermetic git repository (own
      `user.name`/`user.email`, `commit.gpgsign=false`, `GIT_TEMPLATE_DIR=""`), runs `init`, registers
      and activates an epic, and exposes `observe(event, cwd)` which pipes a
      `{hook_event_name, tool_name: "Bash", tool_input}` payload into
      `commit-nudge --platform claude-code`. Setup failures throw. Variants: a nested conductor at
      `projects/sub/`, and a clone of a bare-enough upstream for `pull --rebase`. Suite green (verify:
      `node --test scripts/test/*.test.mjs` exit 0, output saved to a file and read from it)

## 2. Every live commit since the last observation is reported

Pairs: 2.1–2.4a land with 2.5; 2.6–2.7 land with 2.8.

- [x] 2.1 RED: observe → commit → `checkout -b tmp` → `checkout main` → observe: the output names the
      commit (fails today: empty output, proposal defect 1)
- [x] 2.2 RED: observe → two commits → observe: both named, older first; the attribution command
      carries both `--attribute-commit` values in that order (fails today: only HEAD, defect 2)
- [x] 2.3 RED: `hooks/hooks.json` wires `commit-nudge` for `Bash` on `PostToolUse` and
      `PostToolUseFailure` and on no pre-call event (fails today: PostToolUse only)
- [x] 2.3b RED: a commit then a failing command, observed with a `PostToolUseFailure` payload: the
      commit is reported and `hookSpecificOutput.hookEventName` is `PostToolUseFailure` (fails today:
      the envelope says `PostToolUse`); with `state.json` unparseable it exits 2 naming the file, and
      `state.json`, `PROJECT.md`, `detours.log`, `.conductor/commit-watch.json` and
      `.conductor/commit-observe.json` are byte-identical (fails today: `commit-watch.json` advances), and
      after `state.json` is repaired the next observation reports the commit
- [x] 2.4 RED: overlapping observations, in the order Gate 1 round 2 simulated — observation A reads
      the record, a commit lands, observation B runs to completion, then A writes: the commit is reported
      exactly once across A, B and a third observation, the anchor never moves backwards, and
      `detours.log` holds at most one commit-derived row for it (drive the interleaving through an
      exported function, not timing). Also: with the lock held by another process, an observation
      reports nothing and writes nothing, and the next observation after release reports the commit; a
      lock file is broken when it is older than 10 s AND its holder is not confirmed alive (a holder
      confirmed dead is broken at once; a confirmed-live holder blocks observation — design Decision 3
      as amended by Gate 2 G2-I3). Also: a reflog whose anchored line is gone reports nothing
      from the reflog and re-anchors
- [x] 2.4a RED: observe, commit, delete the oldest HEAD reflog entry (`git reflog delete` of the last
      `HEAD@{n}`, the front of `logs/HEAD`), observe: the commit is reported (fails against an offset
      anchor: the anchored line moved to a smaller offset)
- [x] 2.5 GREEN: `commit-watch.mjs` reflog anchor located by content and resolved against the conductor
      root, `commit-observe.json` with the reported set under the `O_EXCL` lock, `hooks.json`
      `PostToolUseFailure` entry, envelope echoes the event, `ensureGitignore` gains
      `.conductor/commit-observe.json*`, `CONDUCTOR_OWN_FILES` gains `.conductor/commit-observe.json`;
      the engine never reads or writes `commit-watch.json` (design Decisions 1–3, 6). Suite green
- [x] 2.6 RED: in the clone fixture, commit X then `git pull --rebase` over an upstream commit, observe:
      X is named as rewritten or abandoned, no `detours.log` row, no `--attribute-commit` naming X
      (passes today by silence, fixture `rrb`; RED against 2.5's walk)
- [x] 2.7 RED: commit Y then `git reset --hard HEAD~1`, observe: Y named as rewritten or abandoned, no
      row, no `--attribute-commit` naming Y (passes today by silence; RED against 2.5's walk)
- [x] 2.8 GREEN: the live-commit filter (Decision 4). Suite green

## 3. The provenance statement

Pairs: 3.1–3.2 land with 3.3.

- [x] 3.1 RED: a commit lands, observe: the output states the commit landed since the last observation
      and may come from another terminal or a parallel call (fails today)
- [x] 3.2 RED: a commit between two Bash calls, outside either, then an observation after a call that
      made no commit: the report carries the same statement, and the AUTO-DETOUR message names
      `retract-detour` (fails today: "Review it — if that's wrong, edit/remove the line")
- [x] 3.3 GREEN: provenance sentence, dead-commit sentence and retract pointer in `runNudge`
      (Decision 5); the no-anchor, no-git and reflogs-disabled rungs still reach the archived-epic
      self-heal (existing tests stay green). Suite green

## 4. `retract-detour`

Section 5 depends on this section's retraction row. Pairs: 4.1–4.4 (with 4.2a) land with 4.5.

- [x] 4.1 RED: `retract-detour <sha> --reason "own work"` on an AUTO-DETOUR row: exit 0, the log keeps
      the row and gains one `RETRACTED` row, `PROJECT.md` from that invocation shows no row for it; an
      abbreviated and a full sha both work (fails today: unknown verb)
- [x] 4.2 RED: a `detours.log` holding a 7-character and an 8-character commit-derived row for two
      different commits: `retract-detour <full sha>` retracts only its own commit's row, for each; a
      re-fired observation for either commit writes no new row (fails today)
- [x] 4.2a RED: an AUTO-DETOUR row whose commit was rewritten and then pruned (`git reflog expire
      --expire=now --all` plus `git gc --prune=now`, so the sha resolves to nothing): `retract-detour
      <that row's sha>` exits 0 and appends its retraction (fails today: unknown verb)
- [x] 4.3 RED: each refusal names its specific reason — a sha matching no row, a commit with no
      commit-derived row, a commit with only a `MINIMAL` row, an already-retracted commit, a missing
      `--reason`, an empty `--reason`, an unresolvable sha shorter than 7 characters (`1`), an
      unresolvable 7-character prefix shared by rows of two different pruned commits (ambiguity) — asserting the message text for each, with exit non-zero and
      `detours.log` and `PROJECT.md` byte-identical (fails today: exit code and bytes pass, the messages
      do not exist)
- [x] 4.4 REGRESSION GUARD: `retract-detour --help` and an undeclared flag write nothing (verb-surface);
      in a detached tree it exits non-zero and writes nothing; render still shows 8 visible rows when
      retracted rows sit among the last 8 lines; a commit carrying both an AUTO-DETOUR and a
      DETOUR-COMMIT row has both hidden by one retraction
- [x] 4.5 GREEN: verb, positional table, flag registry, `verb-effects.mjs`, help, `conductor.mjs`
      dispatch and USAGE, `retract-detour` added to `DISPATCH_BASELINE` in `scripts/test/verb-surface.test.mjs`, render filter, prefix match in the duplicate check (Decisions 9, 11). Suite
      green

## 5. An amend replaces

Pairs: 5.1–5.3a (with 5.2a) land with 5.4.

- [x] 5.1 RED: commit auto-logged, a later call amends it, observe: `PROJECT.md` shows the amending
      commit only; `detours.log` holds the original row then its retraction (fails today: two visible
      rows)
- [x] 5.2 RED: commit attributed to epic E (`update-epic --attribute-commit`), a later call amends it:
      output prints `update-epic E --withdraw-commit <replaced>` with `--withdrawal-reason` before any
      attribution command, never `--attribute-commit <replaced>`; E's `attributedCommits` byte-identical
      after the hook (fails today)
- [x] 5.3 RED: C1 auto-logged and attributed to E, then one call amends to C2 and again to C3: C1's
      row is retracted, `--withdraw-commit` is printed for C1, no `--attribute-commit` names C1 or C2, and
      `PROJECT.md` shows a row only for C3; and C1 auto-logged and attributed, then one call amends to C2
      and runs `reset --hard HEAD~1`: C1's row is retracted and its withdrawal printed (fails against a
      live-amend-only rule); and C1 auto-logged and attributed, then one call runs `commit --amend` and
      `reset --hard HEAD@{1}`: C1's row is NOT retracted and no `--withdraw-commit` names C1 (fails
      against an every-amend rule that ignores liveness)
- [x] 5.2a RED: four epics, each with the replaced commit amended and dead; for each, run the
      withdraw command by hand and assert its exit status agrees with whether the line was printed.
      E (openspec, archived `delivered`, ONE attributed commit, passing Gate 2): no `update-epic E
      --withdraw-commit` line, output names E as delivered and says `update-epic`'s refusal names the
      remedy (the hook names none; the remedy's text and that it runs are tested by
      `emitted-commands-run-as-written` task 2.6), the command exits 1. E2 (openspec, archived `delivered`, TWO attributed commits both reached by the
      Gate 2 head, the amended one withdrawn): the line IS printed and exits 0 (fails against a
      lane-keyed shortcut). E4 (openspec, stored `queued`, outcome `delivered`, change dir archived on
      disk, one attributed commit, with a passing Gate 2 whose head is that commit): no line, exits 1
      (fails against a stored-`archived`-only test; without the Gate 2 the withdrawal breaks nothing
      and exits 0).
      F (claude-code, archived `delivered`): the line IS printed, no refusal sentence, exits 0.
      E also fails a hook whose simulated record only removes the sha (it reads `none-attributed` and
      prints the line). Fails on 0.44.0: the hook prints no withdraw line for any amend, so E2 and F
      fail (reviewer repro of the hand-run commands on 0.44.0: E 1, E2 0, E4 1, F 0)
- [x] 5.3a REGRESSION GUARD: one call runs `checkout -b tmp`, `checkout main`, `commit --amend`: the
      replaced commit named is the one HEAD held before the amend
- [x] 5.4 GREEN: amend handling (Decision 7), with `deliveredRegression` extracted from
      `update-epic`'s inline refusal test and called by both. Suite green

## 6. Detour rows: own artifacts and conductor-root paths

Pairs: 6.1–6.6 land with 6.7.

- [x] 6.1 RED: active A, `fix(a):` commit touching `openspec/changes/A/red-1.txt` + two source files:
      no AUTO-DETOUR row (fails today)
- [x] 6.2 RED: active A, `chore(openspec):` commit touching only `openspec/changes/A/tasks.md`: no row
      (fails today)
- [x] 6.3 RED: active A with a `planPath`, a `chore(…):` commit touching that plan file: no row (fails
      today)
- [x] 6.4 RED: P paused behind D, commit touching only `openspec/changes/P/tasks.md`: no DETOUR-COMMIT
      row (fails today)
- [x] 6.5 RED: nested conductor, `chore(conductor):` commit touching only its own `state.json` and
      `PROJECT.md`: no row — for both the AUTO-DETOUR and the DETOUR-COMMIT branch (fails today, #195)
- [x] 6.6 REGRESSION GUARD: nested conductor, `chore(x):` commit touching `projects/sub/PROJECT.md` and
      `src/thing.mjs`: AUTO-DETOUR row written (would fail under `--relative`; passes today); an epic
      whose id differs from its change directory keeps today's behaviour; #173's shape (`.gitignore`,
      `state.json`, `PROJECT.md`) is still auto-logged
- [x] 6.7 GREEN: `changedFiles(sha)` conductor-root relative, `ownArtifacts`, both branches' rules,
      `appendDetourLog` takes the commit's sha (Decisions 8, 9). Suite green

## 7. The attribution hint lists candidates and decides none

Pairs: 7.1–7.2 land with 7.4.

- [x] 7.1 RED: P paused behind D, both with arrays, a commit lands: a runnable command for D and one
      for P, and the text says the choice is the agent's (fails today, #199)
- [x] 7.2 RED: same, commit touches only `openspec/changes/P/tasks.md`: P's command precedes D's
- [x] 7.3 REGRESSION GUARD: every epic's `attributedCommits` unchanged by the hook in 7.1, 7.2 and 2.2;
      one active epic and no artifact match prints exactly one command (today's shape); an epic with no
      `attributedCommits` array is never a candidate; with no active epic and no detour, a commit
      touching `openspec/changes/E/` and a commit moving it under `archive/` print no hint (today's
      silence)
- [x] 7.4 GREEN: `attributionCandidates` and the multi-candidate text (Decision 10). Suite green

## 8. Required task items

- [x] 8.1 **Call-site completeness sweep** — derived with `rg` at sweep time, never from this list:
      - every caller of `observeCommit`, `classifyMovement`, `headReflog`, `readWatch`, `writeWatch`,
        `COMMIT_WATCH_PATH` (`rg -n "observeCommit|classifyMovement|headReflog|readWatch|writeWatch|COMMIT_WATCH_PATH|commit-watch" scripts`);
      - every caller of `headChangedFiles`/`changedFiles`, `isConductorOwnFiles`,
        `looksLikeUnloggedMinimalDetour`, `headSubject`, `gitShortSha`
        (`rg -n "headChangedFiles|changedFiles|isConductorOwnFiles|looksLikeUnloggedMinimalDetour|headSubject|gitShortSha" scripts`),
        each stated as HEAD-scoped or commit-scoped after this change;
      - every writer and reader of `detours.log` and every sha comparison against a row
        (`rg -n "DETOURS_LOG|detours\.log|appendDetourLog|alreadyLogged" scripts`), each stated as
        retraction-aware and prefix-matching, or neither with the reason;
      - every caller of `attributionTarget`/`attributionNudge` (`rg -n "attributionTarget|attributionNudge" scripts`);
      - every caller of `deliveredRegression` and every remaining inline archived-delivered test
        (`rg -n "deliveredRegression|deliveredObligations|isArchived\(" scripts/lib`), each stated as
        calling the predicate or not deciding a withdrawal/regression refusal;
      - every surface describing hook wiring, hook events or the hook envelope
        (`rg -n "PostToolUse|hookEventName|hooks\.json" scripts commands skills hooks README.md docs`),
        including `verb-effects.mjs`'s `commit-nudge` `writes` text and `platform.mjs`;
      - every consumer of the hook exit-status tables (`rg -n "HOOK_ON_UNREADABLE|HOOK_DEFAULT_ON_UNREADABLE|refusalFor" scripts`);
      - every state read that runs before `commitNudge`'s own, including `scripts/conductor.mjs`'s
        activity block (`rg -n "loadState" scripts/conductor.mjs scripts/lib/subcommands.mjs scripts/lib/commit-watch.mjs`),
        each stated as unable or able to change the hook's exit status or writes;
      - `ensureGitignore`'s list and `upgrade()`'s re-run of it.
      DATA references added: the `RETRACTED` row's sha (points at other rows) — written by
      `retract-detour` and amend handling, read by render, the duplicate check and `retract-detour`'s
      already-retracted check, removed only by `purge-logs` wholesale; `commit-observe.json`'s
      `reported` shas — written and read by the hook only, removed by the 500-entry bound.
      A site where a rule does not hold is a FINDING unless justified in the commit
- [x] 8.2 **Inverse of every operation added or modified** — automatic row (inverse: `retract-detour`,
      shipped); retraction (no un-retract: re-declare with `log-detour`, design Decision 11); amend
      auto-retraction (same); adding to `reported` (inverse: the bound's eviction only — a manual
      un-report has no use, since a reported commit's rows are retracted, not re-reported); the anchor
      (overwritten each observation; no inverse needed); the observe lock (inverse: release on exit, and
      the 10 s stale break for a killed hook); `PostToolUseFailure` wiring (inverse: removing
      it restores today's rung); `commit-watch.json` left behind by 0.44.0 (not removed by any engine:
      git-ignored and inert, and removing it would break an unreloaded 0.44.0 session sharing the
      checkout). Each unshipped inverse named and justified in the commit message
- [x] 8.3 **Verify against the commit** — `git show --stat <sha>` for every task commit; every file the
      task claims is present in THAT commit, including each `red-<task>.txt`, `hooks/hooks.json` and
      the test file
- [x] 8.4 **Attribute every commit** as it lands: `update-epic commit-nudge-reads-the-whole-move
      --attribute-commit <sha>`. The archive commit, and any commit that only relocates this change's
      artifacts, is excluded
- [ ] 8.5 **Dispositions** <!-- pm:lifecycle --> — `update-epic commit-nudge-reads-the-whole-move --status archived --outcome delivered --no-deferrals`
      (swap `--no-deferrals` for `--deferral "<epicId>:<section>"` or `--declined-deferral
      "<what>:<why not>"` for anything Gate 2 defers — at minimum decide defect 3's residual, the
      two-conductor monorepo question and #173's pm-written-lines suggestion); end the superseded
      finding: `update-epic commit-watch-misses-commits --status archived --outcome superseded --reason "carried by commit-nudge-reads-the-whole-move: tasks 2.1, 2.2, 3.2, 5.1, 5.2; the out-of-band case is a stated residual" --no-deferrals`;
      propose (do not write unasked) dispositions for `gh-cfdude-pm-173`, `gh-cfdude-pm-184`,
      `gh-cfdude-pm-195`, `gh-cfdude-pm-199` once their GitHub issues are closed with a comment naming
      what shipped and what was declined
- [x] 8.6 **Route what the work taught** — name each as a practice, tooling friction
      (`/pm:feedback`), or a process failure (`docs/lessons/`). At minimum decide whether "a hook that
      observes only the success event misses work done in failing calls" is a lesson, and whether the
      five hand-removals from `detours.log` before a verb existed belong in `docs/lessons/` as evidence
      for the dogfooding skill
      - Success-event-only hook — **product defect, not a lesson** (declined): it is what the tool did
        wrong, not how we worked; fixed by the `PostToolUseFailure` wiring, bound by test 2.3 and the
        `commit-observation` requirement, and explained in `hooks/README.md`.
      - Five hand-removals from `detours.log` — **tooling friction, already filed and now shipped**
        (declined as a lesson): filed as #173/#184 and closed by `retract-detour` in this change. The
        dogfooding skill and the repo CLAUDE.md "FRICTION IN THE TOOLING" item already name the class
        (a hand-edit because no verb exists); the numbers live in proposal.md defect 8.
      - Adding a verb means hand-writing registration rows in several tables, and the verb-surface
        harness had no seed step — **tooling friction**, filed as
        https://github.com/cfdude/pm/issues/206.
      - Fixtures running `reset --hard`/`checkout -f` silently restored committed `state.json` and
        dropped recorded attributions — **process failure**, written as
        `docs/lessons/git-rewinds-restore-tracked-conductor-state.md`.
      - Decoding the reflog as UTF-8 before storing the anchor lost commits permanently, past TDD, the
        suite and Gate 1, because every fixture was ASCII (Gate 2 G2-C1) — **process failure** (fixture
        design), written as `docs/lessons/ascii-fixtures-hide-a-lossy-decode.md`, retrieval-only: no
        `detect:` matcher, since no tool call recognises a lossy decode with near-certainty.
      - No new practice or gate was adopted by this change beyond the ones already registered.

## 9. Docs (after Gate 2)

- [x] 9.1 `commands/detour.md` — `retract-detour`, when the hook auto-logs and when it does not (own
      artifacts, pm bookkeeping, dead commits), the provenance statement, the amend behaviour
- [x] 9.2 `skills/conductor/SKILL.md` — the auto-logging paragraph, the attribution-hint candidates, and
      the exit-status line ("`commit-nudge` writes nothing but its HEAD watermark …", line 195) to say
      `commit-nudge` "writes nothing, the observation record included", on both post-call events
- [x] 9.3 `hooks/README.md` — the `## PostToolUse — matcher Bash` section (the watermark description
      becomes the reflog anchor and reported set; add `PostToolUseFailure`), and the hook-verb /
      unreadable-state paragraph
- [x] 9.4 `README.md` — the `detours.log` row kinds (add `RETRACTED`), the hook wiring description,
      `retract-detour` in the verb list, and the unreadable-state paragraph (line 1511, "writes nothing
      but its HEAD watermark") to say `commit-nudge` "writes nothing, the observation record included"
- [x] 9.5 `CHANGELOG.md` `[Unreleased]` — Fixed (defects 1, 2 and 4–8 of proposal.md, citing #173, #184,
      #195, #199), Added (`retract-detour`), Changed (hook also wired on `PostToolUseFailure`; the
      provenance statement; defect 3 stated as a residual), and **requires `/reload-plugins`**: until
      then a session keeps 0.44.0's hook and engine
- [x] 9.6 Full suite green, written to a file and read from the file

## 10. Gate 2 and close

- [x] 10.1 Gate 2 — two fresh-context lenses over the committed range (A: spec alignment and real
      tests; B: absent edits against 8.1's sweep and 8.2's inverses); fix Critical and Important;
      record `record-gate-review commit-nudge-reads-the-whole-move --gate 2 --verdict pass --reviewer
      "<identity>" --base-sha <parent of first attributed> --head-sha <last attributed>`
      - Round 1 over `b136774^..` failed (1 Critical, 6 Important); fixed in:
        - `304311e` — reflog anchor stored and compared as bytes, not a UTF-8 decode (G2-C1)
        - `69fea84` — changed paths read unquoted with `-z` (G2-I1, G2-I6)
        - `f838869` — withdrawal simulated with `update-epic`'s own removal (G2-I2)
        - `5a2b677` — dead-only reports state provenance; `retract-detour` refuses a ref (G2-M1, G2-M2,
          G2-I4, G2-I5, G2-M3, G2-M4)
        - `912f657` — observation lock broken only when its holder is not confirmed alive (G2-I3)
        - `46fa347` — test pinning how a Latin-1 subject reaches the trail (G2-C1 follow-up)
      - Scoped re-review over `304311e..46fa347`: pass. Its Minors: M-b (release() guard untested)
        covered by a test with `red-G2-Mb.txt`; M1 (task 2.4's stale-lock wording) corrected above
- [ ] 10.2 Archive this change <!-- pm:lifecycle --> — `/opsx:archive commit-nudge-reads-the-whole-move`,
      then the dispositions in 8.5
