## 0. Before any code

- [ ] 0.1 Gate 1 — two fresh-context lenses over these artifacts BY PATH (lens A: correctness and
      testability of every WHEN/THEN against today's engine, each RED scenario reproduced from
      `repro.sh`; lens B: absent edits — every site printing a remedy or an inward procedure, DATA
      references, inverses the specs do not name); fix every Critical and Important, re-validate with
      `openspec validate emitted-commands-run-as-written --strict`, then record
      `record-gate-review emitted-commands-run-as-written --gate 1 --verdict pass --reviewer "<identity>"
      --artifact openspec/changes/emitted-commands-run-as-written/proposal.md --artifact
      openspec/changes/emitted-commands-run-as-written/design.md --artifact
      openspec/changes/emitted-commands-run-as-written/tasks.md --artifact
      openspec/changes/emitted-commands-run-as-written/specs/emitted-instructions/spec.md --artifact
      openspec/changes/emitted-commands-run-as-written/specs/tracker-sync/spec.md --artifact
      openspec/changes/emitted-commands-run-as-written/specs/epic-disposition/spec.md --artifact
      openspec/changes/emitted-commands-run-as-written/specs/conductor-record/spec.md`
- [ ] 0.2 **Cross-spec review** (required task item 5) — release 0.45.0 holds this change's four spec
      files and its siblings' (`commit-nudge-reads-the-whole-move`, `user-text-never-forges-output`).
      Run the `cross-spec-review` skill after all three pass Gate 1 and again after any later
      amendment; record `record-cross-spec-review 0.45.0 --verdict pass|fail --reviewer "<identity>"`
- [ ] 0.3 After change 1 (`commit-nudge-reads-the-whole-move`) merges into `dev`, re-derive every line
      anchor in design.md with `rg` (above all `runNudge`'s message and `init()`'s stderr in
      `subcommands.mjs`), and correct design.md in the first implementation commit if any moved

## 1. The sweep harness and Layer A (every invocation passes the pre-dispatch check)

The pre-commit hook runs the whole suite, so every RED test lands in the SAME commit as the GREEN
task that turns it green; pairs are named per section. Before that commit, the new test run against
the pre-GREEN engine is saved in this change directory as `red-<task>.txt`, and the GREEN commit
message names that file. New test file: `scripts/test/emitted-invocations.test.mjs`.

Pairs: 1.2–1.3 land with 1.4.

A doc edit a RED test requires lands in that test's GREEN commit (the suite cannot go green
without it); narrative docs describing the new behaviour wait for section 10, after Gate 2.

- [ ] 1.1 REFACTOR: the extractor, placeholder filler and source enumerator (design Decision 1,
      Layer A) inside the new test file, with self-tests only: each source class yields at least one
      invocation, the dispatch-table verb set is read from `conductor.mjs`, the skipped-`…` count is
      asserted under a bound, and prose beginning with a verb name ("integrity check") is not
      extracted; suite green (verify: `node --test scripts/test/*.test.mjs` exit 0, output saved to
      a file and read from the file)
- [ ] 1.2 RED: Layer A over shipped docs — fails naming `/pm:integrity` (`commands/upgrade.md`),
      `node scripts/conductor.mjs` (`commands/cross-spec-review.md`), and each unmarked deliberate
      refused example
- [ ] 1.3 RED: a marker on an ACCEPTED invocation fails naming the stale marker (constructed doc
      fixture in a temp dir, fed through the same enumerator)
- [ ] 1.4 GREEN: add `<!-- pm:refused-example -->` beside each deliberate refused example and the
      pm-developer note at `skills/conductor/SKILL.md:70`; fix `commands/upgrade.md:226` and
      `commands/cross-spec-review.md:85` to the installed-engine form; Layer A over the rules block
      matrix, brief, `init` stderr and the commit nudge also green; 1.2–1.3 pass, suite green

## 2. Layer B and remedies that run (emitted-instructions R2; epic-disposition MODIFIED)

Pairs: 2.1–2.6 land with 2.7.

- [ ] 2.1 RED: Layer B harness — fixture builders keyed by `integrity.mjs`'s exported `CHECKS` ids and
      by `deliveredObligations()` kinds; a key with no builder fails naming it; every extracted
      remedy in a builder's output is filled and RUN in that fixture repo (hermetic git, real
      commits) and must exit 0
- [ ] 2.2 RED: archive refused for a missing Gate 2 and for a withdrawn Gate 2 — the printed remedy,
      filled with the fixture's real range, exits 0 (today: exit 1, no range flags)
- [ ] 2.3 RED: `delivered-release-epic-left-open` on an openspec member with no Gate 2 — every command
      the finding offers, run in the order given, exits 0 and does not offer a bare
      `--outcome delivered` first (`repro.txt` §D1-D2)
- [ ] 2.4 RED: `unconsidered-outcomes` on an engine-stamped openspec-lane epic with no Gate 2 — the
      invocation's choices exclude `delivered`, `deliveredBlockedBy` names `gate2` with its remedy, and
      the invocation run with each offered outcome and a reason exits 0 (gh-189; `repro.txt` §D3)
- [ ] 2.5 RED: `epic-in-undefined-status` on an openspec-lane epic with no Gate 2 — the printed
      archive invocation excludes `delivered`
- [ ] 2.6 REGRESSION GUARD: a `claude-code`-lane unconsidered entry still offers `delivered`,
      `deliveredBlockedBy` is `[]`, and running it with `delivered` exits 0; update-epic's regression
      refusal still prints its echoed tokens and `--correct-disposition`
- [ ] 2.7 GREEN: `gate2Remedy(id)` and its seven callers; `dispositionInvocation(epic, opts)` and
      `blockedDelivered(epic)` and their three callers; `deliveredBlockedBy` in `unconsidered.mjs`; the
      delivered-release finding consults `deliveredObligations`; `closedItemStep()`'s Gate 2 sentence
      (design Decision 2); 2.1–2.6 pass, suite green

## 3. Tracker recipes (tracker-sync MODIFIED "Every command pm emits must run as written"; ADDED secondary watermark)

Pairs: 3.1–3.8 land with 3.9.

- [ ] 3.1 RED: Layer C — for every inward section the matrix emits (primary github-issues/jira ×
      inward/both; github-issues and jira secondaries), the registration line filled from a synthetic
      item of that system's key shape exits 0; `<issue-updated-at>` is filled only when that section's
      listing step names an updated field (today the github-issues secondary cannot be filled)
- [ ] 3.2 RED: jira keys `ABC-123` and `ABC-124` register as two distinct epics; the same key twice is
      refused as a duplicate (`repro.txt` §B3)
- [ ] 3.3 RED: every github-issues listing step names `--limit`, and the procedure carries the
      truncation stop before its closed-item step
- [ ] 3.4 RED: every secondary section carries the watermark step before its closed-item step
- [ ] 3.5 RED: no emitted section names `/pm:epic list`
- [ ] 3.6 RED: the completion-sync reminder's "steps above" reference resolves — for an inward-only
      github-issues primary with no secondary the block names no absent writeback step (replaces the
      heading-only assertion; `repro.txt` §B4-B6)
- [ ] 3.7 RED: the outward section's record-the-key line carries `--external-updated-at`
- [ ] 3.8 REGRESSION GUARD: the github-issues primary's existing recipe test in `conductor-14` and the
      0.26.0 rules fixtures (`scripts/test/fixtures/rules-0.26.0-*.txt`) — update the fixtures only
      where this change's text changes, and say which lines in the commit
- [ ] 3.9 GREEN: `inwardListStep()` and `watermarkStep()` shared by primary and secondary; the
      `<issue-key-slug>`/`<issue-key>` placeholders for non-github systems; the reminder clause; the
      dedup wording; the outward line (design Decision 3); 3.1–3.8 pass, suite green

## 4. `set-tracker`: repository shape and vendor switch (tracker-sync MODIFIED "Primary tracker configuration"; ADDED repo shape)

Pairs: 4.1–4.4 land with 4.5.

- [ ] 4.1 RED: `set-tracker --system github-issues --repo 'a/b; touch pwned'` exits non-zero naming the
      shape, for `--role primary` and `--role secondary`; `state.json` byte-identical
- [ ] 4.2 RED: a hand-written legacy state carrying that repo loads for every read verb, and the rules
      block contains no shell line with the value (fixture passes the strict reader's shape rules)
- [ ] 4.3 RED: a github-issues primary `repo: "o/n"` switched with `--system jira --project ABC` records
      no `repo`, the output names `repo` as dropped, and the jira section and id name `ABC`
- [ ] 4.4 REGRESSION GUARD: `set-tracker --system jira --direction both` on a jira primary keeps
      `projectKey`; `set-tracker --intent paused:todo` still merges
- [ ] 4.5 GREEN: `isGithubRepo()` in `constants.mjs`, required by `usesGhIssueList()` and by
      `set-tracker` for both roles; the vendor-switch drop with its message (design Decision 4);
      4.1–4.4 pass, suite green

## 5. Brief tracker lines (tracker-sync MODIFIED freshness; ADDED mirror line)

Pairs: 5.1–5.2 land with 5.4.

- [ ] 5.1 RED: outward jira primary + github-issues secondary, the only active epic linked to a GitHub
      item — the brief does not say every active epic is mirrored to jira (`repro.txt` §B7)
- [ ] 5.2 RED: an outward-primary-linked epic counted never-re-read in a repo whose only inward
      procedure is a secondary's — running the remedy the line names for it (filled) removes it from
      the count
- [ ] 5.3 REGRESSION GUARD: with no secondary tracker the mirror line's text is unchanged; the
      direction-gated emission conditions in `tracker-sync` still hold
- [ ] 5.4 GREEN: the two lines at `briefing.mjs:271-310` (design Decision 5); 5.1–5.3 pass, suite green

## 6. No hand-edit instructions (conductor-record ADDED)

Starts after change 1 has merged (task 0.3). Pairs: 6.1–6.3 land with 6.4.

- [ ] 6.1 RED: `init` stderr names `update-epic` and `set-active` and does not say "in
      .conductor/state.json" (`repro.txt` §A1)
- [ ] 6.2 RED: the non-detour, not-auto-logged commit-nudge message names `update-epic` and not
      `.conductor/state.json`
- [ ] 6.3 RED: the hand-edit scanner (design Decision 7) over shipped docs — fails on
      `skills/conductor/SKILL.md:734,738` and `commands/init.md:60-63`; a sentence carrying a negation
      or `<!-- pm:explains-hand-edit -->` passes (constructed fixture for both)
- [ ] 6.4 GREEN: `init()` stderr; the one sentence of `runNudge`'s message; `SKILL.md:734,738`;
      `commands/init.md` step 2 naming `set-active`/`update-epic --priority`/`update-epic --status`;
      markers only where the scanner's hit explains a hand-edit rather than directing one; 6.1–6.3
      pass, suite green

## 7. Gate forms and one state writer (emitted-instructions R3, R4)

Pairs: 7.1–7.2 land with 7.3.

- [ ] 7.1 RED: every passing `record-gate-review` form in shipped docs — Gate 1 forms carry
      `--artifact`, Gate 2 forms carry both range flags, no `--gate 1|2` pass form (fails on
      `agents/hierarchy-child-executor.md:33`, `SKILL.md:117-119,322,1216`, `commands/review-mode.md:72`)
- [ ] 7.2 RED: `agents/hierarchy-child-executor.md` extracts no invocation of a verb whose
      `VERB_EFFECTS` entry is `effect: "mutates"`; the conductor skill's batch-processing step names
      `record-gate-review` and the archive disposition for the orchestrator
- [ ] 7.3 GREEN: `commands/epic.md:731-741`'s two-gate form at every 7.1 site; the child doc reports
      gate verdicts with evidence inside `DONE` (wire fields and order unchanged) and drops its
      pm-repo-only README/test paragraph; `SKILL.md`'s orchestrator step records them after the merge
      (design Decision 6); 7.1–7.2 pass, suite green

## 8. Cost of the sweep

- [ ] 8.1 Measure the new test file alone and the full suite before and after (wall-clock, written to a
      file and read from the file); if the new file adds more than the slowest existing test file,
      share fixture repos across builders before Gate 2 and re-measure

## 9. Required task items

- [ ] 9.1 **Call-site completeness sweep** — derived with `rg` at sweep time, never from this list:
      - every printer of a Gate 2 remedy (`rg -n "gate 2 --verdict pass" scripts/lib`) — each through
        `gate2Remedy` or justified;
      - every caller of `dispositionInvocation`, `deliveredObligations`, `unconsideredOutcomes`
        (`rg -n "dispositionInvocation|deliveredObligations|unconsideredOutcomes" scripts/lib`), and every
        other site printing `--outcome` choices (`rg -n "AGENT_OUTCOMES" scripts/lib`, incl.
        `closedItemStep`), each stated as epic-aware or placeholder-id with the Gate 2 sentence;
      - every emitted `gh ` shell line and every inward/secondary section step
        (`rg -n "gh issue|inwardProcedureEmittable|secondaryInwardProcedureEmittable|usesGhIssueList|mirroredEpicIdPrefix|trackerScope" scripts/lib`),
        each through the shared steps or justified;
      - every reader of `tracker.repo` / secondary `repo` (`rg -n "\.repo\b" scripts/lib`), each stated as
        shell-bound (requires the shape) or prose/slug (tolerates a legacy value);
      - every `/pm:epic` and `state.json` mention in emitted engine text
        (`rg -n "pm:epic|state\.json" scripts/lib/rules.mjs scripts/lib/briefing.mjs scripts/lib/subcommands.mjs`);
      - every shipped `record-gate-review` form and every engine invocation in `agents/*.md`.
      DATA references: this change adds no stored field; `deliveredBlockedBy` is output only. State
      that, and that the `externalUpdatedAt` the outward line now supplies is written by `update-epic`
      and read by the brief and the refresh gate.
      A site where a rule does not hold is a FINDING unless justified in the commit.
- [ ] 9.2 **Inverse of every operation added or modified** — the vendor-switch drop (inverse:
      re-supplying the field; no restore verb, and say why: the dropped value is printed); the repo
      refusal (inverse: none needed — nothing is written); omitting `delivered` (inverse: recording Gate
      2 re-offers it on the next call); primary `set-tracker --remove` — ALREADY missing before this
      change, reproduced, and carried to `code-review-0-43-0-minors` rather than shipped here. Each
      unshipped inverse named and justified in the commit message
- [ ] 9.3 **Verify against the commit** — `git show --stat <sha>` for every task commit; every file the
      task claims is present in THAT commit, including each `red-<task>.txt` and each doc a GREEN task
      edits
- [ ] 9.4 **Attribute every commit** as it lands: `update-epic emitted-commands-run-as-written
      --attribute-commit <sha>`. The archive commit, and any commit that only relocates this change's
      artifacts, is excluded
- [ ] 9.5 **Dispositions** <!-- pm:lifecycle --> — first append the carried items to the receiving epic:
      `update-epic code-review-0-43-0-minors --notes "carried from emitted-commands-run-as-written: primary set-tracker --remove is a silent no-op (no inverse); set-tracker --intent badpair silently dropped; verify-worktrees/verify-state have no command doc"`,
      then `update-epic emitted-commands-run-as-written --status archived --outcome delivered
      --deferral "code-review-0-43-0-minors:proposal.md What Changes (Out of scope)"` (add
      `--deferral`/`--declined-deferral` for anything Gate 2 defers). The three superseded finding
      epics are already archived; gh-189 closes through the inward sync's closed-item step after the
      release ships, not here
- [ ] 9.6 **Route what the work taught** — name each as a practice (register an epic, with its
      evidence), tooling friction (`/pm:feedback [bug|feature] "<summary>"`), or a process failure (a
      lesson in `docs/lessons/` with `trigger`, `cost`, `enforced_in`). At minimum decide whether "a
      one-off sweep in a closed change checked argv shape only and 0.44.0 reported zero emitted
      defects while four refused remedies shipped" is a lesson, and whether the marker convention
      belongs in the gate procedure

## 10. Docs (after Gate 2)

- [ ] 10.1 `commands/tracker.md` — "ongoing responsibilities" split by direction; the worked listing
      step with `--limit`, `updatedAt` and the truncation stop; the secondary watermark step; the
      non-github key placeholder; the `--repo` shape and the vendor-switch drop
- [ ] 10.2 `commands/unconsidered-outcomes.md` — `deliveredBlockedBy`, and that an openspec-lane epic
      never reviewed at Gate 2 is not offered `delivered`
- [ ] 10.3 `commands/review-mode.md:99` — an override clears with `update-epic <id> --clear review-mode`
- [ ] 10.4 `skills/conductor/SKILL.md` — tracker section (limit, watermark on secondaries, key
      placeholder), the hierarchy single-writer narrative, the brief's two tracker lines
- [ ] 10.5 `README.md` where tracker sync, `unconsidered-outcomes`, gate recording or hierarchy runs are
      described
- [ ] 10.6 `CHANGELOG.md` `[Unreleased]` — Fixed (remedies that were refused; secondary recipe, jira ids,
      30-item cap, unquoted repo, stale scope on vendor switch; docs teaching refused gate forms and
      hand-edits) and Added (`deliveredBlockedBy`; the emitted-invocation sweep)
- [ ] 10.7 Full suite green, written to a file and read from the file

## 11. Gate 2 and close

- [ ] 11.1 Gate 2 — two fresh-context lenses over the committed range (A: spec alignment and real
      tests, incl. that each Layer B fixture reproduces its finding rather than an easier state; B:
      absent edits against 9.1's sweep); fix Critical and Important; record
      `record-gate-review emitted-commands-run-as-written --gate 2 --verdict pass --reviewer "<identity>"
      --base-sha <parent of first attributed> --head-sha <last attributed>`
- [ ] 11.2 Archive this change <!-- pm:lifecycle --> — `/opsx:archive emitted-commands-run-as-written`,
      then the dispositions in 9.5
