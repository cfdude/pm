## 0. Before any code

- [ ] 0.1 Gate 1 — two fresh-context lenses over these artifacts BY PATH (lens A: correctness and
      testability of every WHEN/THEN against today's engine, and that each RED below really fails
      on it; lens B: absent edits — call sites, DATA references and inverses the specs do not name,
      and the hook-event wiring on every event Claude Code fires for a Bash call); fix every
      Critical and Important, re-validate with
      `openspec validate commit-nudge-reads-the-whole-move --strict`, then record
      `record-gate-review commit-nudge-reads-the-whole-move --gate 1 --verdict pass --reviewer "<identity>"
      --artifact openspec/changes/commit-nudge-reads-the-whole-move/proposal.md --artifact
      openspec/changes/commit-nudge-reads-the-whole-move/design.md --artifact
      openspec/changes/commit-nudge-reads-the-whole-move/tasks.md --artifact
      openspec/changes/commit-nudge-reads-the-whole-move/specs/commit-observation/spec.md --artifact
      openspec/changes/commit-nudge-reads-the-whole-move/specs/gate-integrity/spec.md --artifact
      openspec/changes/commit-nudge-reads-the-whole-move/specs/state-write-guard/spec.md --artifact
      openspec/changes/commit-nudge-reads-the-whole-move/specs/conductor-record/spec.md`
- [ ] 0.2 **Cross-spec review** (required task item 5) — release 0.45.0 holds this change's four spec
      files and its siblings' (`emitted-commands-run-as-written`, `user-text-never-forges-output`).
      Run the `cross-spec-review` skill after all three pass Gate 1 and again after any later
      amendment; record `record-cross-spec-review 0.45.0 --verdict pass|fail --reviewer "<identity>"`
- [ ] 0.3 Re-derive every function and line reference in design.md with `rg` against `dev` before
      the first implementation commit, and correct design.md in that commit if any moved

## 1. Fixtures

The pre-commit hook runs the whole suite, so every RED test lands in the SAME commit as the GREEN
task that turns it green; pairs are named per section. Before that commit, the new tests run
against the pre-GREEN engine are saved in this change directory as `red-<task>.txt`, and the GREEN
commit message names that file. New test file: `scripts/test/commit-observation.test.mjs`.

- [ ] 1.1 REFACTOR: a `helpers.mjs` fixture that builds a hermetic git repository (own
      `user.name`/`user.email`, `commit.gpgsign=false`, `GIT_TEMPLATE_DIR=""`), runs `init`, registers
      and activates an epic, and exposes `hook(event, toolUseId, cwd)` which pipes a
      `{hook_event_name, tool_use_id, tool_input}` payload into `commit-nudge --platform claude-code`.
      Setup failures throw. Also a nested variant with the conductor at `projects/sub/`. Suite green
      (verify: `node --test scripts/test/*.test.mjs` exit 0, output saved to a file and read from it)

## 2. Every commit a call creates is reported

Pairs: 2.1–2.4b land with 2.5.

- [ ] 2.1 RED: pre → commit → `checkout -b tmp` → `checkout main` → post: the output names the commit
      (fails today: empty output, proposal defect 1)
- [ ] 2.2 RED: pre → two commits → post: both named, older first; the attribution command carries
      both `--attribute-commit` values in that order (fails today: only HEAD, defect 2)
- [ ] 2.3 RED: `hooks/hooks.json` wires `commit-nudge` for `Bash` on `PreToolUse`, `PostToolUse` and
      `PostToolUseFailure` (fails today: PostToolUse only)
- [ ] 2.3a RED: pre-call payload after a commit, with `state.json` prefixed by a conflict marker: exit
      status is not 2 and `state.json`, `PROJECT.md`, `detours.log` byte-identical (fails today: exit 2,
      fixture `rpre`); same with a wrong-shape file (`epics: {}`)
- [ ] 2.3b REGRESSION GUARD: a commit then a failing command in one call, post-call FAILURE payload:
      the commit is reported; with `state.json` unparseable it exits 2 and writes nothing
- [ ] 2.3c REGRESSION GUARD: pre-call payload in a detached tree exits 0, prints nothing, creates no
      `.conductor/commit-watch/` file (positive half: the same payload on a branch creates one)
- [ ] 2.4 REGRESSION GUARD: two overlapping calls (pre A, pre B, commit, post A, post B) and a
      repeated post for one id each report the commit exactly once, and `detours.log` holds at most
      one commit-derived row for it
- [ ] 2.4b REGRESSION GUARD: a commit made after the post-call hook ran (the backgrounded-call shape)
      is named by the next call as outside it, with no row and no `--attribute-commit`
- [ ] 2.5 GREEN: `commit-watch.mjs` reflog window from the per-call snapshot, announced position,
      snapshot-directory pruning; `commitNudge` dispatch on `hook_event_name` with the pre-call branch
      never loading state and never exiting 2, and `refusalFor` made event-aware; `hooks.json` wiring;
      `ensureGitignore` gains `.conductor/commit-watch/` (design Decisions 1–2). Suite green

## 3. A commit outside the call is never claimed

Pairs: 3.1–3.2 land with 3.3.

- [ ] 3.1 RED: commit between two calls, then pre → `ls` → post: no `detours.log` row, no
      `--attribute-commit` naming it (fails today: AUTO-DETOUR row + command, defect 3)
- [ ] 3.2 RED: post with no pre for that `tool_use_id` after a commit: no row, no command naming it
- [ ] 3.3 GREEN: unbounded commits named in one sentence and otherwise untouched (Decision 3); the
      no-git and reflogs-disabled rungs still reach the archived-epic self-heal (existing tests stay
      green). Suite green

## 4. An amend replaces

Pairs: 4.1–4.2 land with 4.3; 4.3 depends on section 7's retraction row (land section 7 first if
the implementer orders it so, and say which in the commit message).

- [ ] 4.1 RED: commit auto-logged, next call amends it: `PROJECT.md` shows the amending commit only;
      `detours.log` holds the original row then its retraction (fails today: two visible rows)
- [ ] 4.2 RED: commit attributed to epic E (via `update-epic --attribute-commit`), next call amends
      it: output prints `update-epic E --withdraw-commit <replaced>` with `--withdrawal-reason` before
      any attribution command, never `--attribute-commit <replaced>`; E's `attributedCommits`
      byte-identical after the hook
- [ ] 4.2a REGRESSION GUARD: one call runs `git checkout -b tmp`, `git checkout main`, then
      `commit --amend`: the replaced commit named is the one HEAD held before the amend
- [ ] 4.3 GREEN: amend handling per Decision 4. Suite green

## 5. Detour rows: own artifacts and conductor-root paths

Pairs: 5.1–5.5 land with 5.6.

- [ ] 5.1 RED: active A, `fix(a):` commit touching `openspec/changes/A/red-1.txt` + two source files:
      no AUTO-DETOUR row (fails today)
- [ ] 5.2 RED: active A, `chore(openspec):` commit touching only `openspec/changes/A/tasks.md`: no row
      (fails today)
- [ ] 5.3 RED: P paused behind D, commit touching only `openspec/changes/P/tasks.md`: no DETOUR-COMMIT
      row (fails today)
- [ ] 5.4 RED: nested conductor, `chore(conductor):` commit touching only its own `state.json` and
      `PROJECT.md`: no row — for both the AUTO-DETOUR and the DETOUR-COMMIT branch (fails today, #195)
- [ ] 5.5 REGRESSION GUARD: nested conductor, `chore(x):` commit touching `projects/sub/PROJECT.md` and
      `src/thing.mjs`: AUTO-DETOUR row written (fails under `--relative`; passes today); and an epic
      whose id differs from its change directory keeps today's behaviour; and a `planPath` file
      touched by the commit counts as the active epic's own artifact
- [ ] 5.6 GREEN: `changedFiles(sha)` conductor-root relative (Decision 5), `ownArtifacts` (Decision 6),
      both branches' rules (Decision 7), `appendDetourLog` takes the commit's sha (Decision 9). Suite
      green

## 6. The attribution hint names candidates and decides none

Pairs: 6.1–6.2 land with 6.4.

- [ ] 6.1 RED: P paused behind D, both with arrays, a commit lands: a runnable command for D and one
      for P, and the text says the choice is the agent's (fails today, #199)
- [ ] 6.2 RED: same, commit touches only `openspec/changes/P/tasks.md`: P's command precedes D's
- [ ] 6.3 REGRESSION GUARD: every epic's `attributedCommits` unchanged by the hook in 6.1, 6.2 and 2.2;
      one active epic and no artifact match prints exactly one command (today's shape); an epic with no
      `attributedCommits` array is never a candidate
- [ ] 6.4 GREEN: `attributionCandidates` and the multi-candidate text (Decision 8). Suite green

## 7. `retract-detour`

Pairs: 7.1–7.4 land with 7.5.

- [ ] 7.1 RED: `retract-detour <sha> --reason "own work"` on an AUTO-DETOUR row: exit 0, the log keeps
      the row and gains one `RETRACTED` row, `PROJECT.md` from that invocation shows no row for it; an
      abbreviated and a full sha both work (fails today: unknown verb)
- [ ] 7.2 RED: refused, exit non-zero naming why, `detours.log` and `PROJECT.md` byte-identical — for
      a sha with no commit-derived row, an already-retracted sha, a `MINIMAL`-only sha, a missing or
      empty `--reason`, and an unresolvable sha
- [ ] 7.3 RED: after retraction, a re-fired post-call hook for the same commit writes no new row; the
      AUTO-DETOUR hook message names `retract-detour` and contains no instruction to edit or remove a
      line (fails today)
- [ ] 7.4 REGRESSION GUARD: `retract-detour --help` and an undeclared flag write nothing (verb-surface);
      in a detached tree it exits non-zero and writes nothing; render keeps showing 8 visible rows when
      retracted rows sit among the last 8 lines
- [ ] 7.5 GREEN: verb, positional table, flag registry, `verb-effects.mjs`, help, `conductor.mjs`
      dispatch and USAGE, render filter, hook message (Decision 10). Suite green

## 8. Required task items

- [ ] 8.1 **Call-site completeness sweep** — derived with `rg` at sweep time, never from this list:
      - every caller of `observeCommit`, `classifyMovement`, `headReflog`, `readWatch`, `writeWatch`
        (`rg -n "observeCommit|classifyMovement|headReflog|readWatch|writeWatch" scripts`);
      - every caller of `headChangedFiles`/`changedFiles`, `isConductorOwnFiles`,
        `looksLikeUnloggedMinimalDetour`, `headSubject`, `gitShortSha`
        (`rg -n "headChangedFiles|changedFiles|isConductorOwnFiles|looksLikeUnloggedMinimalDetour|headSubject|gitShortSha" scripts`),
        each stated as HEAD-scoped or commit-scoped after this change;
      - every writer and reader of `detours.log` (`rg -n "DETOURS_LOG|detours\.log|appendDetourLog|alreadyLogged" scripts`),
        each stated as retraction-aware or retraction-blind with the reason (expected: `render.mjs`,
        `git.mjs`, `purge-logs.mjs`, `links.mjs` comment, `activity` if it reads it);
      - every reader of `attributedCommits` the hint now reads (`attributionTarget` replaced; any
        other `rg -n "attributionTarget|attributionNudge" scripts` caller);
      - every surface listing hook wiring or hook verbs (`rg -n "PostToolUse|PreToolUse|hooks\.json" scripts commands skills README.md docs`),
        including `verb-effects.mjs`'s `commit-nudge` `writes` text and `platform.mjs`;
      - every consumer of the hook exit-status tables (`rg -n "HOOK_ON_UNREADABLE|HOOK_DEFAULT_ON_UNREADABLE|refusalFor" scripts`),
        each stated as event-aware or not with the reason — a PreToolUse path reaching exit 2 is a FINDING;
      - every state read reachable from the pre-call branch (`rg -n "loadState|readState" scripts/lib/subcommands.mjs scripts/lib/commit-watch.mjs`);
      - `ensureGitignore`'s list and `upgrade()`'s re-run of it.
      DATA references added: the `RETRACTED` row's sha (points at another row) — state where it is
      written (`retract-detour`, amend handling), read (render, `alreadyLogged`, `retract-detour`'s
      already-retracted check) and removed (`purge-logs` wholesale; nothing else).
      A site where a rule does not hold is a FINDING unless justified in the commit
- [ ] 8.2 **Inverse of every operation added or modified** — automatic row (inverse: `retract-detour`,
      shipped); retraction (no un-retract: re-declare with `log-detour`, justified in design Decision
      10); snapshot write (inverse: post-call delete, and 24-hour pruning for a call that never
      returns); announced position (no inverse: monotonic by design); amend auto-retraction (inverse:
      none beyond `log-detour`, same reason); hook wiring on two new events (inverse: removing them
      restores today's rung, stated in design Migration Plan). Each unshipped inverse named and
      justified in the commit message
- [ ] 8.3 **Verify against the commit** — `git show --stat <sha>` for every task commit; every file the
      task claims is present in THAT commit, including each `red-<task>.txt`, `hooks/hooks.json` and
      the test file
- [ ] 8.4 **Attribute every commit** as it lands: `update-epic commit-nudge-reads-the-whole-move
      --attribute-commit <sha>`. The archive commit, and any commit that only relocates this change's
      artifacts, is excluded
- [ ] 8.5 **Dispositions** <!-- pm:lifecycle --> — `update-epic commit-nudge-reads-the-whole-move --status archived --outcome delivered --no-deferrals`
      (swap `--no-deferrals` for `--deferral "<epicId>:<section>"` or `--declined-deferral
      "<what>:<why not>"` for anything Gate 2 defers — at minimum decide the design's Open Question
      on two-conductor monorepos and #173's pm-written-lines suggestion); end the superseded finding:
      `update-epic commit-watch-misses-commits --status archived --outcome superseded --reason "carried by commit-nudge-reads-the-whole-move: tasks 2.1, 2.2, 3.1, 4.1, 4.2" --no-deferrals`;
      propose (do not write unasked) dispositions for `gh-cfdude-pm-173`, `gh-cfdude-pm-184`,
      `gh-cfdude-pm-195`, `gh-cfdude-pm-199` once their GitHub issues are closed with a comment naming
      what shipped and what was declined
- [ ] 8.6 **Route what the work taught** — name each as a practice, tooling friction
      (`/pm:feedback`), or a process failure (`docs/lessons/`). At minimum decide whether "a hook that
      observes only the success event misses work done in failing calls" is a lesson, and whether the
      five hand-removals from `detours.log` before a verb existed belong in
      `docs/lessons/` as evidence for the dogfooding skill

## 9. Docs (after Gate 2)

- [ ] 9.1 `commands/detour.md` — `retract-detour`, when the hook auto-logs and when it does not (own
      artifacts, pm bookkeeping, commits outside the call), the amend behaviour
- [ ] 9.2 `skills/conductor/SKILL.md` — the auto-logging paragraph (currently "auto-logged to
      `.conductor/detours.log` by the hook") and the attribution-hint candidates
- [ ] 9.3 `README.md` — the `detours.log` row kinds (add `RETRACTED`), the hook wiring description,
      `retract-detour` in the verb list
- [ ] 9.4 `CHANGELOG.md` `[Unreleased]` — Fixed (defects 1–7 of proposal.md, citing #173, #184, #195,
      #199), Added (`retract-detour`), Changed (hook wired on PreToolUse and PostToolUseFailure; one
      extra process per Bash call)
- [ ] 9.5 Full suite green, written to a file and read from the file

## 10. Gate 2 and close

- [ ] 10.1 Gate 2 — two fresh-context lenses over the committed range (A: spec alignment and real
      tests; B: absent edits against 8.1's sweep and 8.2's inverses); fix Critical and Important;
      record `record-gate-review commit-nudge-reads-the-whole-move --gate 2 --verdict pass --reviewer
      "<identity>" --base-sha <parent of first attributed> --head-sha <last attributed>`
- [ ] 10.2 Archive this change <!-- pm:lifecycle --> — `/opsx:archive commit-nudge-reads-the-whole-move`,
      then the dispositions in 8.5
