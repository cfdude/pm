# Tasks

## Commit mechanics

These rules bind every section below.

- **Order.** The stuck-loop half (sections 1–3) lands before the token half (section 4), per Rob's
  handoff. Section 3 is usable on its own: a repo with tracking off gets the whole rounds guard.
- **TDD.** Every behaviour task is RED then GREEN. The pre-commit hook runs the whole assertion half,
  so a RED cannot be committed alone. Save the failing run as `red-<task>.txt` in this directory, and
  land the RED and GREEN in ONE commit whose message names that file.
- **Rungs.** A test's rung follows what it OBSERVES (`.claude/agent-startup.md`, the rung table):
  - **UNIT** (`scripts/test/unit/`): values over an in-memory store. That covers:
    - the tally after each verdict
    - the resolver
    - the rounds and token signal computation over in-memory attributed rows
    - the escalation target
    - every refusal
    - what `state` holds after each verb
    - the STOP block text
    - the brief lines
    - the `rulesBlock()` string
    - `optInLines()`
  - **FILE** (`scripts/test/assert/`): bytes on disk. That covers:
    - `spend-guard` over a fixture ledger under a temp `CLAUDE_CONFIG_DIR`, including the "opened no
      ledger file" assertions
    - `CLAUDE.md` after a limit is set and after it is unset
  - **Certify buckets.** The sweeps subject is all of `scripts/lib` plus `conductor.mjs`, and the
    functional subject is the entry point's import closure. Nearly every engine task demands BOTH
    `node scripts/test/certify.mjs functional` and `… sweeps`.
    - Run `node scripts/test/drift.mjs --phase pre-commit` after staging. It names the buckets.
    - Certify each bucket it names, then commit plainly.
    - Batch docs-only edits into the engine commits they document.
- **Commits.**
  - Make one conventional commit per task.
  - Use `git add` with explicit paths, and never use `--no-verify`.
  - After each commit, run `git show --stat <sha>` (7.2) and
    `node scripts/conductor.mjs update-epic spend-budget-and-stuck-loop-guard --attribute-commit <sha>` (7.4).

## 0. Before any code

- [x] 0.1 **Gate 1** (review `standard`, one fresh-context reviewer, opus) over these artifacts, by
      path:
      - `proposal.md` and `design.md`
      - `specs/spend-guard/spec.md`
      - this file

      Fix the Critical and Important findings. Re-validate with
      `openspec validate spend-budget-and-stuck-loop-guard --strict`. Record the verdict:
      `record-gate-review spend-budget-and-stuck-loop-guard --gate 1 --verdict pass --artifact <path>… --reviewer "<identity>"`.
- [x] 0.2 **Cross-spec review of release 0.52.0** (required item 5). The release now holds three or
      more spec files (`spend-ledger`, `conductor-record`, `spend-guard`, plus any other member's).
      - Invoke the `cross-spec-review` skill over the whole set on disk before `/opsx:apply`.
      - Name these shared chokepoints:
        - the rules block (three conditional sections, from this change,
          `token-spend-tracking-per-epic` and `execution-profile-planning-and-light-roles`)
        - `KNOWN_JOB_ROLES` and the escalation role mapping (design D7)
        - the execution-profile resolver this change exports (design D3)
        - the `spend` pipeline this change reuses
      - Record: `record-cross-spec-review 0.52.0 --verdict pass|fail --reviewer "<identity>"`. Verify
        with `release show 0.52.0`.
- [ ] 0.3 **Rob's decisions, recorded before apply.** Each one changes the specs if the answer differs.
      Record them as `update-epic spend-budget-and-stuck-loop-guard --notes "<decision>"`:
      - (a) a separate cascade, not profile fields (design D3)
      - (b) no default rounds limit (design D4)

## 1. The gate-round counter (stuck-loop half)

- [x] 1.1 TDD (UNIT): in `recordGateReview()`, update `epic.gateRounds.gate<N>` (`fails`, `passes`,
      `failStreak`, `lastVerdictAt` = the entry's `reviewedAt`, and on a `pass` only, `lastPassAt` =
      the entry's `reviewedAt`) in the same `saveState` as the verdict. Cover every scenario of the
      spec's "keeps a per-gate round tally" requirement, including:
      - `lastPassAt` absent after fails only
      - pass, fail, fail on one gate keeps `lastPassAt` though `gateReview` has dropped the pass
      - the pass anchor is the latest `lastPassAt` across gates (export the helper; 3.1, 3.5 and 4.2
        read it, never `gateReview`)
      - a refused invocation making no write on the in-memory store
- [x] 1.2 TDD (UNIT): the "Only a recorded verdict moves the tally" requirement.
      - `update-epic --withdraw-gate-review` and the archive-drift heal (`epic-progress.mjs`, the
        `ungated` Gate 2 write) leave `gateRounds` unchanged.
      - An epic with no `gateRounds` reads zero with no pass anchor.
      - A withdrawn pass is flagged by `spend-guard`, not undone, and its `lastPassAt` still anchors
        (asserted in 3.4).
- [x] 1.3 **Call-site sweep for the tally** (required item 1).
      - Run `rg -n "gateReview(\.|\[)gate|gateReview\s*=" scripts/` and list every writer of a gate
        entry.
      - Run `rg -n "gateRounds" scripts/` and list every reader and writer.
      - Name the one writer that counts, and justify each writer that does not.
      - Enumerate the data's REMOVE paths (`remove-epic`, the archive). Neither needs to clear the
        tally.
      - Save the result as `call-site-sweep-1.3.txt`.

## 2. Limits: the three-layer cascade

- [x] 2.1 TDD (UNIT): export the profile's `resolveField` from `execution-profile.mjs` (no behaviour
      change; the existing profile tests stay green). Add the guard resolver over `state.spendGuard`,
      `state.laneSpendGuards[lane]` and `epic.spendGuard`. Cover:
      - epic over lane over project
      - an invalid stored value is ignored and reported
      - `warnAt` defaults to 80
      - a detour inherits nothing
- [x] 2.2 TDD (UNIT): `set-spend-guard [--epic <id> | --lane <lane>] [--max-failed-rounds <n>]
      [--tokens <n>] [--warn-at <pct>] [--unset max-failed-rounds|tokens|warn-at|all]`. Cover every
      refusal and unset scenario in the spec. Add the verb to:
      - the verb registry, its arity and flag tables, and `USAGE`
      - `verb-effects.mjs`, as `mutates`
      - `commands/set-spend-guard.md`, with its parity-ledger claim in the same commit

      The `--tokens` warning while tracking is off is covered in 4.1.

## 3. The rounds signal, the check verb and the override (stuck-loop half)

- [x] 3.1 TDD (UNIT): the rounds signal's recorded side (design D2), as a pure function of the epic's
      tally, the resolved limit and the live overrides, taking the ledger side as an optional input
      that 4.2 supplies. Cover:
      - "Recorded fails decide when they are higher" and the tracking-off degradation text
      - the trip scenarios, including "A pass after an override spends the override" and "Fails after
        the pass on the same gate do not revive the override" (liveness read from the pass anchor)

      The ledger-side scenarios belong to 4.2.
- [x] 3.2 TDD (UNIT): the escalation target (design D7). Declare the model rank once, beside
      `KNOWN_MODELS`, and the STOP exit code as a named constant beside `CONFLICT_EXIT_CODE`. The
      function takes the resolved `{model, source}` whatever the source. Cover:
      - sonnet → opus
      - opus with source `default` → fable, and the block names the source
      - fable → user
      - no model, or a model not in the ladder → user (pure-function input, so it is testable before
        and after the sibling's default table lands)
- [x] 3.3 TDD (UNIT): the STOP block text. It must contain:
      - the epic
      - the tripped signal with its count and limit
      - the target and "or the user"
      - "what is wrong and how do we resolve it"
      - the literal `override-spend-guard` command
      - the autonomy sentence

      Every value leaves through `escapeControls`.
- [x] 3.4 TDD (UNIT + FILE): the `spend-guard <epicId> [--json] [--no-ingest]` verb.
      - Rounds only in this task: the token signal reports `not-checked` until 4.1.
      - Cover the exit codes 0, 1 and 2, the JSON shape, the unknown epic, and the withdrawn-pass
        notice.
      - Guard state comes from the invoking tree; the tracking switch and ledger from the main tree
        (design D5a). Split `spend-command.mjs`'s `mainState()` into a non-refusing reader that
        returns `{state}` or `{reason}`, with `spend`'s refusing wrapper on top (its behaviour and
        tests unchanged); `spend-guard` imports the reader, never `mainState()`.
      - Cover the "ingest cannot run" requirement: a held lock, a detached main HEAD and `--no-ingest`
        each read the existing ledger, say it may be stale, and can trip on the ledger alone (exit 2).
        The ledger-side numbers come from 4.2; until then assert the stale note and the 0/2 rule.
      - Cover the "ledger truly cannot be read" requirement: an unreadable `enabledAt`, an unreadable
        main-tree `state.json` from a linked worktree (tracking `unknown`, never "tracking is off")
        and a failing ledger read each report `not-read` and keep the 0/2 rule, never exit 1.
      - `commands/spend-guard.md` says never to wire the verb into a hook (exit 2 is the hook block
        code).
      - FILE: with tracking off, no spend-directory or transcript path is opened. Prove it with the
        observe-reads fixture.
      - Add `commands/spend-guard.md` and its parity-ledger claim. Register the verb, with
        `verb-effects` set to `reads`.
- [x] 3.5 TDD (UNIT): `override-spend-guard` and `--revoke` (design D6). Cover every scenario of the
      two override requirements, including the rank refusal and "a second model override must go to
      the user". Add `commands/override-spend-guard.md` and its parity-ledger claim,
      and register the verb.
- [x] 3.6 **Inverse sweep** (required item 1). For each write in design D8, show the shipped inverse
      or the stated justification, with a test reference. Append the result to
      `call-site-sweep-1.3.txt`.

## 4. The token signal

- [x] 4.1 TDD (UNIT + FILE): the token signal.
      - Reuse `spend`'s ingest → `attribute()` → `buildReport({filters: {epic}})` pipeline in-process,
        never a second transcript reader.
      - Cover OK, WARN and tripped, and the override baseline.
      - Cover coverage share printed and unattributed tokens not charged.
      - Cover tracking-off `not-checked`, and the `set-spend-guard --tokens` warning while tracking is
        off.
      - FILE: a fixture ledger under a temp `CLAUDE_CONFIG_DIR` gives the expected totals, and
        `--no-ingest` performs no ingest.
- [x] 4.2 TDD (UNIT): the ledger side of the rounds signal: the distinct `round` values on attributed
      `phase=review` rows after the pass anchor (1.1's helper), minus one, floored at 0; every row
      when there is no anchor. Cover "Unrecorded
      review rounds are still counted", "A recorded pass ends the ledger side too", and a marker
      naming an unknown epic or an invalid phase contributing nothing.

## 5. Emission

- [x] 5.1 TDD (UNIT): `record-gate-review` prints the STOP block on stderr, after the success line,
      when the accepted verdict leaves the recorded part tripped. It exits 0, and the check reads state
      only. FILE: no ledger file is opened with tracking on.
- [x] 5.2 TDD (UNIT): the brief.
      - Add one `STOP: spend guard —` line for a stuck active epic, from state alone, in the part of
        the brief `fitBrief` never cuts. Assert it survives an over-cap brief.
      - With no limit configured, assert the guard's brief helper returns no lines and no brief line
        contains `spend guard`.
      - FILE (observe-reads): the SessionStart, PreCompact and PreToolUse hooks open no spend or
        transcript path, with tracking on and with no limit configured.
- [x] 5.3 TDD (UNIT + FILE): the `## Spend guard` rules section.
      - It sits immediately after the `## Spend tracking` slot in `rulesBlock()`
        (`...(spend ? spendTrackingLines() : [])`, `token-spend-tracking-per-epic` task 5.1), in the
        same position when tracking is off. Name this ordering in the 0.2 chokepoint review.
      - It is emitted only while a limit is configured (a `warnAt`-only layer and an archived epic's
        layer do not count), the same condition as the `OPT_INS` row in 5.4.
      - It contains `spend-guard <epic>`, exit 2 as STOP, the autonomy sentence, `override-spend-guard`
        with "no autonomy grant covers it", and the `phase=review round=<n>` marker form.
      - FILE: `CLAUDE.md` is rewritten on set and on the last unset.
      - This is a managed-rules surface, so certify functional.
- [x] 5.4 TDD (UNIT): the `OPT_INS` `spendGuard` row and its `upgrade` line, with no migration. A
      0.51.0 state fixture loads unchanged.
- [x] 5.5 Changeset fragment `.changesets/spend-budget-and-stuck-loop-guard.md`, and the
      `skills/conductor/SKILL.md` section on the guard. Verify: `node scripts/conductor.mjs changesets`
      lists the fragment.

## 6. Dogfood

- [x] 6.1 Integration: the full assertion half passes
      (`node --test scripts/test/unit/*.test.mjs scripts/test/assert/*.test.mjs`), plus
      `node scripts/test/certify.mjs functional` and `… sweeps`. Time the run and record its peak
      memory.
- [x] 6.2 In this repo, run `node scripts/conductor.mjs set-spend-guard --max-failed-rounds 2`, per
      design D4 or Rob's answer to 0.3(b). Then run `spend-guard spend-budget-and-stuck-loop-guard`.
      Verify:
      - its recorded side is 0 with the "counting starts at this release" note, because this epic's
        Gate 1 was recorded before the tally existed
      - it shows the ledger round side, or says tracking is off or not read
      - its exit code matches the reported counts (0 below the limit, 2 at it)

## 7. Required task items (CLAUDE.md "The gate procedure", items 1–7)

- [x] 7.1 Call-site completeness sweep (item 1). Satisfied by 1.3 and 3.6. Verify that
      `call-site-sweep-1.3.txt` names every writer of a gate entry, every reader of `gateRounds`, and
      every inverse in design D8.
- [x] 7.2 **Verify each task against its commit** (item 2). For every task above, run
      `git show --stat <that task's sha>`, and assert that every file the task claims appears in THAT
      commit. Save the result as `commit-verification-7.2.txt`.
- [x] 7.3 **Lifecycle marker** (item 3). Tasks 10.2 and 10.3 carry `<!-- pm:lifecycle -->` on their task
      lines. Verify: `rg -n "pm:lifecycle" openspec/changes/spend-budget-and-stuck-loop-guard/tasks.md`
      lists both.
- [x] 7.4 **Attribute every commit** (item 4), in landing order, starting with the proposal commit. Do
      NOT attribute the archive move (10.3), or a lifecycle-only commit after Gate 2 is recorded.
      Verify: `attributedCommits` lists them in landing order.
- [x] 7.5 Cross-spec review (item 5). Satisfied by 0.2.
- [ ] 7.6 End by recording a disposition (item 6). Satisfied by 10.2.
- [x] 7.7 **Route what the work taught you** (item 7). Name each lesson as one of three kinds:
      - a practice (register an epic)
      - tooling friction (`/pm:feedback`)
      - a process failure (`docs/lessons/`)

      Give the evidence with each. "None" is a claim, and it must say what was looked at.
      Routed 2026-10-13 (closeout):
      - process failure: `docs/lessons/record-each-gate-when-its-review-ends.md` (gates recorded in one command, 779 ms apart as reported by the closing orchestrator, tripped `gate-recorded-as-bookkeeping` and live-record tests 9.4/9.14)
      - process failure: `docs/lessons/a-spec-edit-stales-a-recorded-gate-1-until-the-record-is-committed.md` (79d2ffa9 17:20 edit, re-record committed 6e754d8b 18:08)
      - practice: `skills/release-candidate/SKILL.md` step 2 now says to commit conductor records before dispatching worktree agents
      - tooling friction: drafted for `/pm:feedback` in the closeout report (spend-marker phase names `spec`/`gate-1` rejected as `invalid-marker`, 24,509,352 tokens unattributed per `spend`; `openspec validate --strict` failures hidden behind `| tail -1`)

## 8. Gate 2

- [x] 8.1 **Gate 2** at this epic's effective review. When built inside the 0.52.0 release candidate,
      the converged release-candidate review satisfies it. The review covers the full `BASE..HEAD`
      diff:
      - spec alignment
      - real tests passing
      - the hot-path guarantee (no ledger read from a hook or from `record-gate-review`)
      - the tally's single writer
      - override pre-authorization refused
      - revoke keeps the record
      - escalation order

      Fix the Critical and Important findings, and log the Minor ones. Record:
      `record-gate-review spend-budget-and-stuck-loop-guard --gate 2 --verdict pass --base-sha <a> --head-sha <b> --reviewer "<identity>"`,
      where `<b>` reaches every attributed commit.

## 9. Docs (after Gate 2 only)

- [x] 9.1 README: the guard, the three verbs, exit 2, the escalation protocol, and what is not
      detected. Verify: `rg -n "spend-guard" README.md`.
- [ ] 9.2 Mintlify (`pm-plugin.dev`), per the `mintlify-doc-sync` skill. If the site must not document
      the feature before the plugin ships, carry this task to the 0.52.0 release cut.

## 10. Close

- [ ] 10.1 **Re-record Gate 2 after docs**, at the post-docs head, once 9.x has landed and been
      attributed. Re-record, never withdraw. Verify: Gate 2 renders as a pass, not stale.
- [ ] 10.2 <!-- pm:lifecycle --> **Disposition.**
      `update-epic spend-budget-and-stuck-loop-guard --status archived --outcome delivered --reason "<why>"`
      with the deferral assertions:
      - `--declined-deferral "per-epic failing-certify detection:a certify run is bound to the index, not to an epic"`
      - `--deferral "token-spend-analysis-and-recommendations:design Open Questions (phase=build fix-round signal)"`,
        or a `--declined-deferral` if that epic does not take it

      Then run `/pm:status`.
- [ ] 10.3 <!-- pm:lifecycle --> **Archive.** `/opsx:archive spend-budget-and-stuck-loop-guard`. The
      archive-move commit is NOT attributed (7.4).
