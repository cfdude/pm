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
      `subcommands.mjs`), every commit-nudge message VARIANT change 1 prints, and every doc line number
      this tasks.md hardcodes (`skills/conductor/SKILL.md` 70, 117-119, 734, 738, 994; `README.md`
      1327), which change 1's doc tasks move; correct design.md and tasks.md in the first
      implementation commit if any moved

## 1. The sweep harness and Layer A (every invocation passes the pre-dispatch check)

The pre-commit hook runs the whole suite, so every RED test lands in the SAME commit as the GREEN
task that turns it green; pairs are named per section. Before that commit, the new test run against
the pre-GREEN engine is saved in this change directory as `red-<task>.txt`, and the GREEN commit
message names that file. New test file: `scripts/test/emitted-invocations.test.mjs`. Fixture repos
are created under the OS temp dir by the test helpers, never inside the checkout.

A doc edit a RED test requires lands in that test's GREEN commit (the suite cannot go green
without it); narrative docs describing the new behaviour wait for section 10, after Gate 2.

Pairs: 1.2–1.5 land with 1.6.

- [ ] 1.1 REFACTOR: the extractor, placeholder filler and source enumerator (design Decision 1,
      Layer A extraction rules) inside the new test file, with self-tests only on constructed text:
      a wrapped code span is one span; `(--reconcile | --no-reconcile)` yields two invocations; a
      top-level `A | B | C` form yields three; `<how they inform each other>` is one placeholder; a
      fenced `# comment` and a bare `…` are dropped; a `text` fence and prose beginning with a verb name
      are not extracted; each real source class yields at least one invocation; suite green (verify:
      `node --test scripts/test/*.test.mjs` exit 0, output saved to a file and read from the file)
- [ ] 1.2 RED: `checkCommandLine()` returns a `class` on each refusal kind (`unknown-flag`,
      `extra-positional`, `id-as-flag`, `value-on-valueless-flag`, `help-in-value-position`), asserted
      once per kind in `verb-surface.test.mjs`
- [ ] 1.3 RED: Layer A over shipped docs — fails naming `/pm:integrity` (`commands/upgrade.md`),
      `node scripts/conductor.mjs` (`commands/cross-spec-review.md`), and each unmarked refused example
      in design Decision 1's table
- [ ] 1.4 RED: marker rules on constructed docs in a temp dir — a `pm:refused <class>` marker on an
      accepted invocation fails; one whose class differs from the engine's fails; a marker not directly
      after a code span fails as unattached; a marked span followed on the same line by an unmarked
      refused span fails on the second
- [ ] 1.5 RED: Layer A over the rules block for every platform × the tracker matrix, `init` stderr and
      the commit-nudge message in EVERY variant change 1 prints, one fixture per variant (auto-logged
      detour, detour commit, several candidate epics, amend), each built anchor → commit → observe — passes today except where section 3 changes the text; saved as the
      baseline, not a failure (brief, `integrity`, `unconsidered-outcomes` and archive-gate refusals
      join Layer A in 2.9, once their fixtures exist)
- [ ] 1.6 GREEN: the `class` field in `argv-surface.mjs`; the 19 `pm:refused <class>` markers, the
      `pm:engine-message` marker at `README.md:1327` and the `pm:checkout-path` marker at
      `skills/conductor/SKILL.md:70`, each directly after its span; `commands/upgrade.md:226` and
      `commands/cross-spec-review.md:85` in installed-engine form; the test's refusal list saved as
      `sweep-layer-a.txt` and any difference from design's table stated in the commit; 1.2–1.5 pass,
      suite green

## 2. Layer B and remedies that clear their condition (emitted-instructions R2; epic-disposition MODIFIED)

Pairs: 2.1–2.8 (incl. 2.7a) land with 2.9.

- [ ] 2.1 RED: Layer B harness over three EXPORTED registries — `CHECKS` (integrity),
      `DELIVERED_OBLIGATIONS` (archive-gate) and `BRIEF_REMEDIES` (briefing) — plus the
      `unconsidered-outcomes` and regression-refusal printers; a registry id with no builder fails
      naming it; the declared-`unconstructable` count is asserted equal to 0. Each builder follows
      design Decision 1's five-step protocol: reproduce and observe → extract → fill BY MEANING → run
      in order, each exit 0 → re-run the producer, assert the condition is gone AND the epic still
      exists. Each alternative runs in its own fresh fixture. The commit nudge is a printer too, with
      builders per variant: after `retract-detour <sha> --reason …` the row is gone from `PROJECT.md`;
      after `update-epic <id> --withdraw-commit <replaced> --withdrawal-reason …` the sha is gone from
      `attributedCommits`; each `--attribute-commit` line attributes to its epic. (Fails today: the two registries are not exported.)
- [ ] 2.2 RED: stale Gate 2 (a commit attributed after the reviewed head) — the archive refusal's
      remedy filled with base = parent of the first attributed commit and head = the last attributed
      commit exits 0 and the same archive then succeeds; missing and withdrawn Gate 2 likewise
- [ ] 2.3 RED: `delivered-release-epic-left-open` on an openspec member with no Gate 2 — alternative 1
      (archive) in one fixture: Gate 2 precondition named first, each command exits 0, `integrity` no
      longer reports the member; alternative 2 (`release --defer`) in a second fresh fixture, same
      assertion (`repro.txt` §D1-D2)
- [ ] 2.4 RED: `unconsidered-outcomes` on an engine-stamped openspec-lane epic with no Gate 2 — the
      invocation's choices exclude `delivered`, `deliveredBlockedBy` names `gate2-missing` with its
      remedy; one fresh fixture per offered outcome, each exits 0 and the epic leaves the set (gh-189;
      `repro.txt` §D3)
- [ ] 2.5 RED: `epic-in-undefined-status` on an openspec-lane epic with no Gate 2 — the printed archive
      invocation excludes `delivered`; each alternative clears the finding in its own fixture
- [ ] 2.6 RED: regression refusal — `--attribute-commit` of a later commit on an archived `delivered`
      openspec-lane epic is refused; the refusal names the Gate 2 re-record first and its invocation
      still offers `delivered`; following both with the range filled by meaning exits 0 and the
      original `--attribute-commit` then succeeds
- [ ] 2.7 RED: `recorded-sha-the-repository-cannot-resolve` (orphan-branch commit recorded, branch
      deleted, `git reflog expire --expire=now --all`, `git gc --prune=now`, plus one reachable
      attributed commit so the check's resolvability probe does not skip the absent arm — first
      assert the finding IS reported) and the malformed-value arm
      on a Gate 1 range — the Gate 1 remedy carries `--artifact`, not a range, and clears the finding
- [ ] 2.7a RED: a legacy epic id `My Plan` in a hand-written state (passes the strict reader) — the
      drift-heal disposition remedy (`integrity.mjs:357`), the attribute-commit remedy (`:293,295`) and
      the nudge's `--attribute-commit` line print it shell-quoted; each, run, exits 0 and clears its
      condition
- [ ] 2.8 REGRESSION GUARD: a `claude-code`-lane unconsidered entry still offers `delivered` with
      `deliveredBlockedBy: []` and clears when run with `delivered`; the regression refusal still
      prints its echoed tokens, `--correct-disposition` and exactly one line beginning `  update-epic `
- [ ] 2.9 GREEN: `DELIVERED_OBLIGATIONS` and `BRIEF_REMEDIES` exported and consumed by
      `deliveredObligations()` and `buildBrief()`; `gateRemedy(id, gate)` at every Gate-remedy site
      (design Decision 2, incl. the `+`-split forms at `archive-gate.mjs:426,430-431` and the
      gate-aware `integrity.mjs:750-752`); `dispositionInvocation(epic, {keepDelivered})` and
      `blockedDelivered(epic)`; `deliveredBlockedBy`; the delivered-release and regression-refusal
      remedy lines; `closedItemStep()`'s Gate 2 sentence; `EPIC_ID_FORMAT` and `printedId()` in
      `constants.mjs` at every printed-id site; Layer A extended to the outputs these
      fixtures produce; 2.1–2.8 pass, suite green

## 3. Tracker recipes (tracker-sync MODIFIED "Every command pm emits must run as written"; ADDED secondary watermark)

Pairs: 3.1–3.9 (incl. 3.3a) land with 3.10.

- [ ] 3.1 RED: Layer C — for every inward section the matrix emits (primary github-issues/jira ×
      inward/both; github-issues and jira secondaries), the registration line filled from a synthetic
      item of that system's key shape, following the section's quoting instruction, run through
      `sh -c`, exits 0; `<issue-updated-at>` is filled only when that section's listing step names an
      updated field (today the github-issues secondary cannot be filled)
- [ ] 3.2 RED: jira keys `ABC-123` and `ABC-124` register as two distinct epics; the same key twice is
      refused as a duplicate (`repro.txt` §B3)
- [ ] 3.3 RED: items titled ``it's "done" $(touch pwned) `id` ``, `--limit=5 ignored`, `-h`, `--help`,
      `-x starts with a dash`, and a title holding a newline — each registration and each
      `suggest-lane --ask=` call, filled per the section's quoting sentence and run through `sh -c`,
      exits 0 (neither prints help); titles read back byte-identical; no `pwned` file exists; every
      inward section emits `--title=`, `--external-url=` and `suggest-lane --ask=`
- [ ] 3.3a RED: `suggest-lane --ask='--limit=5 ignored'` exits 0 routing on that text; `suggest-lane
      "fix a typo"` is unchanged; `suggest-lane --ask=x "y"` is refused as a surplus positional;
      `suggest-lane --help` lists `--ask`
- [ ] 3.4 RED: every github-issues listing step names `--limit`, and the procedure carries the
      truncation stop before its closed-item step
- [ ] 3.5 RED: no emitted section names `/pm:epic list` — asserted against the rendered rules block,
      because Layer A's `/pm:<name>` check reads only `epic`, which exists
- [ ] 3.6 RED: every secondary section carries the watermark step before its closed-item step
- [ ] 3.7 RED: the completion-sync reminder's "steps above" reference resolves — for an inward-only
      github-issues primary with no secondary the block names no absent writeback step (replaces the
      heading-only assertion; `repro.txt` §B4-B6)
- [ ] 3.8 RED: the outward section's record-the-key line carries `--external-updated-at`, and an epic
      recorded by that line, filled, is not counted never-re-read by the brief
- [ ] 3.9 REGRESSION GUARD: the github-issues primary's existing recipe test in `conductor-14` and the
      0.26.0 rules fixtures (`scripts/test/fixtures/rules-0.26.0-*.txt`) — update the fixtures only
      where this change's text changes, and say which lines in the commit; `conductor-14`'s
      `/"<issue-title>"/g` fill helper is rewritten for the `--title=<issue-title>` form
- [ ] 3.10 GREEN: `inwardListStep()` and `watermarkStep()` shared by primary and secondary; the quoting
      sentence, `--title=`/`--external-url=` and `suggest-lane --ask=`; the `--ask` registry row in
      `constants.mjs`, `suggest-lane`'s positional `min` set to 0, and `suggest-lane` reading `--ask`
      (help projects it from the row); the `<issue-key-slug>`/`<issue-key>` placeholders for
      non-github systems; the reminder clause; the dedup wording; the outward line (design Decision 3);
      3.1–3.9 pass, suite green

## 4. `set-tracker`: repository shape and vendor switch (tracker-sync MODIFIED "Primary tracker configuration"; ADDED repo shape)

Pairs: 4.1–4.4 land with 4.7.

- [ ] 4.1 RED: `set-tracker --system github-issues --repo 'a/b; touch pwned'` exits non-zero naming the
      shape; a repo holding a control character exits non-zero, escapes the value in its message and
      writes nothing (shape wording NOT asserted: change 3's input refusal fires first), for `--role primary` and `--role secondary`; `state.json` byte-identical
- [ ] 4.2 RED: a hand-written legacy state carrying that repo on the primary loads for every read verb,
      and the rules block contains no shell line with the value (fixture passes the strict reader)
- [ ] 4.3 RED: a github-issues primary `repo: "o/n"` switched with `--system jira --project ABC` records
      no `repo`, the output names `repo` as dropped, and the jira section and id name `ABC`
- [ ] 4.4 RED: a legacy github-issues primary with NO recorded direction switched with `--system jira
      --project ABC` records `direction: "inward"`, prints that it was kept from the previous tracker,
      and the rules block has no outward section (`repro.txt` §B9); a legacy jira primary with no
      direction switched to `linear` records `outward`; an explicit `--direction both` on the switch
      records `both`
- [ ] 4.5 REGRESSION GUARD: `set-tracker --role secondary --system github-issues --repo 'a/b; touch
      pwned' --remove` on a legacy entry exits 0 and removes it (passes today; must survive 4.7)
- [ ] 4.6 REGRESSION GUARD: `set-tracker --system jira --direction both` on a jira primary keeps
      `projectKey`; `set-tracker --intent paused:todo` still merges
- [ ] 4.7 GREEN: `isGithubRepo()` in `constants.mjs`, required by `usesGhIssueList()` and by
      `set-tracker` for both roles except `--remove`; the vendor-switch scope drop and direction record
      with their messages (design Decision 4); 4.1–4.6 pass, suite green

## 5. Brief tracker lines (tracker-sync MODIFIED freshness; ADDED mirror line)

Pairs: 5.1–5.2 land with 5.4.

- [ ] 5.1 RED: outward jira primary + github-issues secondary, the only active epic linked to a GitHub
      item — the brief does not say every active epic is mirrored to jira (`repro.txt` §B7)
- [ ] 5.2 RED: an outward-primary-linked epic counted never-re-read in a repo whose only inward
      procedure is a secondary's — the remedy the line names, filled, removes it from the count
      (`repro.txt` §B8); runs as a `BRIEF_REMEDIES` Layer B builder
- [ ] 5.3 REGRESSION GUARD: with no secondary tracker the mirror line's text is unchanged; the
      direction-gated emission conditions in `tracker-sync` still hold
- [ ] 5.4 GREEN: the two lines as `BRIEF_REMEDIES` entries (design Decision 5); 5.1–5.3 pass, suite green

## 6. No hand-edit instructions (conductor-record ADDED)

Starts after change 1 has merged (task 0.3). Pairs: 6.1–6.3 land with 6.4.

- [ ] 6.1 RED: `init` stderr names `update-epic` and `set-active` and does not say "in
      .conductor/state.json" (`repro.txt` §A1)
- [ ] 6.2 RED: the non-detour, not-auto-logged commit-nudge message names `update-epic` and not
      `.conductor/state.json`
- [ ] 6.3 RED: the hand-edit scanner exactly as design Decision 7 defines it (units, sentences,
      imperative position, negations, rules a and b) over shipped docs reports exactly
      `commands/init.md:61`, `skills/conductor/SKILL.md:734` and `:738`; constructed fixtures show a
      negated sentence, a wrapped negation on the previous line, a bare field name outside a
      `state.json` lead-in, and a `pm:explains-hand-edit` sentence each NOT reported
- [ ] 6.4 GREEN: `init()` stderr; the one sentence of `runNudge`'s message; `SKILL.md:734,738`;
      `commands/init.md` step 2 naming `set-active`/`update-epic --priority`/`update-epic --status`;
      6.1–6.3 pass, suite green

## 7. Gate forms in shipped docs (emitted-instructions R3)

Pairs: 7.0–7.1 land with 7.2. The single-writer rule for hierarchy runs is NOT here — it moved to
`hierarchy-run-has-one-state-writer`.

- [ ] 7.0 RED: `agents/hierarchy-child-executor.md` names neither pm's `README.md` nor `scripts/test`;
      `commands/review-mode.md` names `update-epic <id> --clear review-mode` and no "no separate unset"
      (both pass with 7.2's doc edits; the review-mode line moves here from 10.3)
- [ ] 7.1 RED: every passing `record-gate-review` form in shipped docs — Gate 1 forms carry
      `--artifact`, Gate 2 forms carry both range flags, no `--gate 1|2` pass form (fails on
      `agents/hierarchy-child-executor.md:33`, `SKILL.md:117-119,322,1216`, `commands/review-mode.md:72`);
      the child doc's forms, filled, exit 0 in a fixture
- [ ] 7.2 GREEN: `commands/epic.md:731-741`'s two-gate form at every 7.1 site, with the child doc's WHO
      unchanged; the child doc's pm-repo-only README/test paragraph and `SKILL.md:994` replaced;
      `commands/review-mode.md:99` naming `--clear review-mode` (design Decision 6); 7.0–7.1 pass, suite green

## 8. Cost of the sweep

- [ ] 8.1 Measure the new test file alone and the full suite before and after (wall-clock, written to a
      file and read from the file); if the new file adds more than the slowest existing test file,
      share fixture repos across builders before Gate 2 and re-measure

## 9. Required task items

- [ ] 9.1 **Call-site completeness sweep** — derived with `rg` at sweep time, never from this list:
      - every printer of a gate-verdict remedy, derived MULTI-LINE because remedy strings are split
        across `+`: `rg -n -U -e "--gate 2[^;]*?--verdict" -e "--gate <n>" -e "record-gate-review \$\{"
        scripts/lib` — each through `gateRemedy(id, gate)` or justified, and each gate-agnostic site
        stated as gate-aware;
      - every writer and reader of the new exports `DELIVERED_OBLIGATIONS` and `BRIEF_REMEDIES`
        (`rg -n "DELIVERED_OBLIGATIONS|BRIEF_REMEDIES|deliveredObligations\(" scripts`), and every brief
        line printing an engine verb that is NOT a `BRIEF_REMEDIES` entry, justified;
      - every item-sourced placeholder in emitted text (`rg -n "<issue-(title|url|key)>" scripts/lib`),
        each covered by the quoting sentence;
      - every reader of `suggest-lane`'s text (`rg -n "suggest-lane|suggestLane" scripts commands skills README.md`),
        each stated as reading `--ask` or the positional, and every emitted `suggest-lane` line using `--ask=`;
      - every reader of a tracker's `direction` (`rg -n "directionOf|\.direction\b" scripts/lib`), each
        stated as unaffected by the vendor-switch record;
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
      re-supplying the field; no restore verb, and say why: the dropped value is printed); the
      vendor-switch direction record (inverse: `set-tracker --direction <d>`); the repo
      refusal (inverse: none needed — nothing is written; `--remove` stays exempt so a legacy entry is
      never stranded); omitting `delivered` (inverse: recording Gate
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
      non-github key placeholder; the quoting rule for item values; the `--repo` shape (and its
      `--remove` exemption); the vendor-switch scope drop and direction record
- [ ] 10.2 `commands/unconsidered-outcomes.md` — `deliveredBlockedBy`, and that an openspec-lane epic
      never reviewed at Gate 2 is not offered `delivered`
- [ ] 10.3 (moved to 7.0/7.2 — the review-mode unset line is test-driven)
- [ ] 10.4 `skills/conductor/SKILL.md` — tracker section (limit, watermark on secondaries, key
      placeholder, quoting item values, direction kept on a vendor switch), the brief's two tracker
      lines, `deliveredBlockedBy`
- [ ] 10.5 `README.md` where tracker sync, `unconsidered-outcomes` or gate recording are described
- [ ] 10.5a `commands/lane-routing.md` and README's verb reference / flag table — `suggest-lane --ask=<text>`,
      why it exists (a flag-shaped text cannot be passed positionally), and that the positional form is
      unchanged; `docs/parity-ledger.json` needs no change (no new file)
- [ ] 10.6 `CHANGELOG.md` `[Unreleased]` — Fixed (remedies that were refused; secondary recipe, jira ids,
      30-item cap, unquoted repo and item titles, stale scope and silent outward switch on vendor change; docs teaching refused gate forms and
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
