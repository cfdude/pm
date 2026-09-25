# Tasks

## Commit mechanics

These rules bind every section below.

- **A RED lands in the SAME commit as its GREEN.** The pre-commit hook runs the drift script and
  then the whole assertion half, so a RED cannot be committed alone. Before the GREEN commit, save
  the failing run against the pre-GREEN tree in this change directory as `red-<task>.txt`, and name
  that file in the commit message. Every **TDD** task below names its RED/GREEN pair.
- **A REGRESSION GUARD** is a test that passes the moment it exists. Verify it with a deliberate
  violation in a SCRATCH COPY, never in the tree, and save the result as `mutation-<task>.txt`.
- **The drift script shapes the commits.**
  - A staged `scripts/test/functional/<id>.test.mjs` needs its twin
    (`scripts/test/{unit,assert}/<id>.test.mjs`) EDITED in the same staged diff.
  - A changed certified module needs a fresh certification record. The certified set is DERIVED:
    run `rg -l '\bgitOps\s*\(' scripts/lib scripts/conductor.mjs` before each commit.
    `scripts/lib/git.mjs` is in it, and so is `git-gateway.mjs`'s guard coupling.
  - Run `node scripts/test/certify.mjs` only where the orchestrator's brief for the applying agent
    permits it. Otherwise STOP and report the module the drift script names.
- **Cite symbols, never line numbers.** This change lands AFTER the 0.50.0 wave that edits
  `epic-progress.mjs`, `add-epic.mjs`, `update-epic.mjs` and `constants.mjs`. Every reference below
  is a function, constant or check id.
- **Commits.** One conventional commit per task. Use `git add` with explicit paths only. Never pass
  `--no-verify`. After each commit, run `git show --stat <sha>` (see 6.4).

## 0. Before any code

- [ ] 0.1 **Gate 1**, review mode `thorough`: two fresh-context lenses over these artifacts BY PATH.
      - Lens A: is every WHEN/THEN in `specs/conductor-record/spec.md` and
        `specs/gate-integrity/spec.md` reachable and testable against the engine AS IT STANDS AFTER
        the preceding 0.50.0 wave? Does any sentence restate what `epic-disposition`'s "Unfinished
        work at archive records where it went" already owns?
      - Lens B: absent edits and contradictions.
        - Every consumer of `epicProgress().source` (design D2).
        - The regression check's `--carried-to` clause ("An update to an archived epic does not
          break an obligation its archive met") under the union.
        - Whether a sentence anywhere in `gate-integrity` still says outstanding work reads zero for
          a moved source: `rg -n "reads as zero|source is gone" openspec/specs`.
        - Whether D3's "standing condition, not refusal" contradicts "The archive transition is
          gated on every path that can reach it".
        - Whether the ADDED requirement's archived scope (stored status OR archived on disk) agrees
          with the ungated standing condition's, and whether integrity and the briefing can
          disagree about an epic under it.
      Fix every Critical and Important finding, then re-run
      `openspec validate handoff-demand-blind-spots --strict`. Record
      `record-gate-review <epic> --gate 1 --verdict pass --reviewer "<identity>"`, with one
      `--artifact` for each of `proposal.md`, `design.md`, `tasks.md`,
      `specs/conductor-record/spec.md` and `specs/gate-integrity/spec.md`, all under
      `openspec/changes/handoff-demand-blind-spots/`. `<epic>` is whatever 0.3 resolves.
      Verify: the verdict appears in `node scripts/conductor.mjs status`.
- [ ] 0.2 **Cross-spec review** (required task item 5). Release 0.50.0 holds this change's TWO spec
      files, `conductor-record` and `gate-integrity`, plus every other member change's, counted
      flat. Run the `cross-spec-review` skill after Gate 1 with two lenses and ask the six
      questions. Where this change is most exposed:
      - **Double ownership.** The handoff count belongs to `conductor-record`, and its refusal
        wording to `epic-disposition`. The new gate-integrity requirement must not restate either.
      - **Contradiction.** The new standing condition says no archive path refuses on it. Does any
        other 0.50.0 change add an archive-path refusal that reads the main specs?
      - **Shared chokepoint.** Other 0.50.0 changes that touch `epicProgress()`,
        `DELIVERED_OBLIGATIONS` or `GIT_OPERATIONS`.
      Record `record-cross-spec-review 0.50.0 --verdict pass|fail --reviewer "<identity>"`.
      Verify: the verdict is recorded and not rendered stale.
- [x] 0.3 **Resolve the change-to-epic mapping before any code.** Resolved by RE-KEY (orchestrator,
      2026-09-25): the change was proposed as `archive-gate-reads-archived-work` and renamed to
      `handoff-demand-blind-spots`, so the change id IS the carrier epic's id (openspec lane since
      2026-09-25). `gh-cfdude-pm-222` stays its own tracker-linked epic, delivered by this same change;
      its disposition names this change as the carrier. Verify:
      `node scripts/conductor.mjs status` renders this change's `tasks.md` progress on
      `handoff-demand-blind-spots`.
- [x] 0.4 **Re-read the tracker item** for `gh-cfdude-pm-222`
      (`gh issue view 222 --repo cfdude/pm --comments`) and record
      `record-tracker-refresh gh-cfdude-pm-222 --verdict unchanged|material-change --external-updated-at <iso>`.
      At drafting, `updatedAt` was 2026-09-25T03:54:58Z with no comments.

## 1. Measure, then read the archived tasks.md for every epic (conductor-record, design D1)

- [ ] 1.1 **BASELINE** in `baseline-before.md`, measured on the day and never copied from `design.md`.
      - (a) Count the managed archived openspec epics whose render moves off `0/0` once the archived
        `tasks.md` is read, and list those with outstanding work above zero, each with its outcome.
      - (b) Run `node scripts/conductor.mjs integrity` in full and save the finding count per check
        id.
      - (c) Run every live-record test and save its result: `rg -ln "liveState|\.conductor/state\.json" scripts/test`.
      - (d) Count the epics whose missing-source warning APPEARS or DISAPPEARS under design D2. A story
        no longer suppresses the warning, and an ABSENT lane reads as openspec, so every lane-less
        story epic that is not archived is a candidate. Measure it here, and in at least three other
        pm-managed repositories (the `pm-fleet-upgrade` skill lists them), each read-only. STOP
        on a count that would flood PROJECT.md with warnings on healthy epics, by the 7-of-8 rule,
        and bring the number back before 2.1 lands.
      Verify: the file exists and names the commit it was measured at.
- [ ] 1.2 **TDD** — archived `tasks.md` for a non-backfilled epic.
      - RED: `red-1.2.txt`, a UNIT-rung test in `scripts/test/unit/` that builds an archived
        openspec-lane epic with no backfill stamp and an archived `tasks.md` at 1/3. It asserts
        `epicProgress()` = `{done: 1, total: 3}` and `outstandingWork()` = 2. Add one case each for
        the date-prefixed and undated directory.
      - GREEN: in `epicProgress()`, drop the `isArchiveBackfilled(epic)` condition around
        `archivedTasksPath(epic.id)`, and rewrite the comment that cites "reads zero".
      Verify: the half is green, and the file-rung backfill tests are unchanged.
- [ ] 1.3 **TDD** — the documented sequence refuses a delivered archive with open archived tasks.
      - RED: `red-1.3.txt`, a UNIT-rung verb test: Gate 2 recorded, the change moved under
        `archive/`, the heal run, then `update-epic <id> --status archived --outcome delivered --no-deferrals`.
        It asserts exit non-zero, `2 of 1/3 task(s) outstanding` in the refusal, and the store
        unchanged.
      - The paired case (every undeclared task ticked, archive task declared) asserts success.
      - GREEN: 1.2's change. If nothing further is needed, say so in the commit message.
      Mutation proof `mutation-1.3.txt`: restore the backfill scope in a scratch copy and show the
      refusal test fails.
- [ ] 1.4 **Live-record fallout.** Re-run 1.1(b) and (c). For every expectation that moves, fix it in
      this commit and justify each movement in the commit body. At drafting: `archived-with-zero-ticked-tasks`
      gains candidates but no findings, and the two delivered epics render 53/54 and 46/47. Verify:
      the live-record tests pass, and `git show --stat` lists every test touched.

## 2. Stories and the checkbox source count together (conductor-record, design D2)

- [ ] 2.1 **TDD** — the union.
      - RED: `red-2.1.txt`, UNIT rung:
        - `tasks.md` at 1/3 plus one done story → `2/4`;
        - a disposed story plus `tasks.md` at 2/2 plus a done story → `3/3`;
        - a story-only epic → unchanged;
        - an openspec epic that is not archived, with stories and no `tasks.md` anywhere → the
          missing-source warning.
      - GREEN: `epicProgress()` computes the story part and the checkbox part independently and sums
        them. `excluded` sums both. `excludedLabel` names both kinds when both are present. `source`
        is single-valued for one part and two-part (e.g. `stories+openspec`) for both, with a parts
        list consumers test membership on.
      Verify: the half is green.
- [ ] 2.2 **TDD** — the reproduction from the 0.43.0 review (A2).
      - RED: `red-2.2.txt`, a UNIT-rung verb test: `tasks.md` at 1/3, `update-epic --add-story x`,
        then `update-epic --story 1 --done --status archived --outcome delivered --no-deferrals`.
        It asserts exit non-zero, a refusal naming 2 outstanding, and the store unchanged.
      - GREEN: 2.1, plus 2.3's consumers.
      Mutation proof `mutation-2.2.txt`: reinstate the stories-first early return in a scratch copy.
- [ ] 2.3 **Every consumer of `source`, in the same commit as 2.1 or immediately after it.** Enumerate
      with `rg -n "\.source\b|source ===|source:" scripts/lib` and record the list in the commit
      body. At drafting:
      - `outstandingSummary`: `items` whenever stories contribute;
      - the handoff entry's `remedy`: `--story <n> --done` whenever stories contribute;
      - the handoff entry's `archiveFlags`: `--carried-to` whenever the checkbox part has open
        tasks;
      - `bar()`;
      - the regression refusal's printed `--carried-to` (`dispositionInvocation`'s `carry`), which
        keys on the checkbox part's open count, never on `source`.
      **TDD** RED `red-2.3.txt`: a mixed epic with one open story and one open task. The refusal
      names BOTH remedies, and the printed invocation carries `--carried-to`. Verify: the half is
      green.

## 3. The git gateway reads the index (design D5)

- [ ] 3.1 **TDD** — the operation.
      - RED: `red-3.1.txt`, the gateway guard (`scripts/test/assert/git-gateway-guard.test.mjs`),
        failing on an exec site with no `GIT_OPERATIONS` row, or the reverse.
      - GREEN, all in one commit:
        - `realGit()` gains the operation: `git cat-file --batch`, `:<path>` lines on stdin,
          `GIT_NO_LAZY_FETCH=1`, and the `batchCheckCommits` stdio shape;
        - `GIT_OPERATIONS` gains its row;
        - `git.mjs` gains the wrapper, which returns a map from path to contents or `null` (missing)
          and returns `null` overall when git cannot answer;
        - the double (`fixtures/fake-git.mjs`) and `git-gateway-capture.json` gain the
          `noRepository` answer and an arg-keyed entry, refreshed by the capture's own procedure.
      Verify: the guard is green in both halves, and the capture's byte-identity check against real
      git passes.
- [ ] 3.2 **TDD** — the index read against real git, FUNCTIONAL, with an assertion twin of the same
      id EDITED in the same commit.
      - RED: `red-3.2.txt`, a hermetic repository that covers:
        - a committed spec → contents;
        - a staged but uncommitted rewrite → the staged contents;
        - `git reset --hard` after staging → the committed contents;
        - a path absent from the index → `null`;
        - a non-repository → overall `null`.
      - GREEN: 3.1's wrapper.
      Verify: `node scripts/test/certify.mjs functional` passes, where permitted (see Commit
      mechanics).

## 4. The spec-sync comparison (gate-integrity ADDED requirement, design D4)

- [ ] 4.1 **TDD** — the delta parser, UNIT rung, a pure function.
      - RED: `red-4.1.txt`, one fixture per OpenSpec 1.13.2 grammar arm:
        - ADDED, MODIFIED and REMOVED plain headers;
        - REMOVED as a `-`, `*` or `+` bullet with backticks;
        - RENAMED `FROM:`/`TO:` with and without a bullet or backticks;
        - an unpaired `FROM:` → reported;
        - a header inside a code fence → ignored;
        - a closing `###` run → stripped;
        - case sensitivity → kept.
      - GREEN: the parser in the new module (working name `scripts/lib/spec-sync.mjs`), with a
        comment naming `@fission-ai/openspec` 1.13.2 `dist/core/parsers/requirement-blocks.js` as
        the grammar it mirrors.
- [ ] 4.2 **TDD** — the comparison and the later-change discharge, UNIT rung.
      - RED: `red-4.2.txt`, every scenario of the ADDED requirement that needs no git:
        - lost ADDED;
        - REMOVED still present;
        - a later MODIFIED of the same requirement → no finding;
        - a later REMOVED → no finding;
        - same-date and undated → unordered, both directions;
        - RENAMED on both sides;
        - main spec absent → every ADDED reported;
        - outcome `killed` → out of scope.
      - GREEN: the comparison. Its scope is status `archived`, the openspec lane (an absent lane
        normalized) and outcome `delivered`, with the change directory found through
        `archivedChanges()` and `strippedChangeId()`, never re-deriving the date-prefix rule.
      Mutation proofs `mutation-4.2.txt`: drop the discharge, and invert the same-date rule. Each in
      a scratch copy fails a named case.
- [ ] 4.3 **REGRESSION GUARD** — the live repository. Run the comparison over this repository's
      archive against the index and assert **zero** findings, as the measurement found. Replay it
      against `3256cc2^:` content and assert exactly 0.48.0's four ADDED headers, excluding changes
      archived after that commit. Save both runs in `evidence-4.3.txt`. Verify: if the live run
      reports anything, STOP. That is either a real loss (restore it) or a false positive (the
      7-of-8 rule: fix the comparison before shipping).

## 5. The surfaces (design D6)

- [ ] 5.1 **TDD** — the integrity check (working id `delivered-epic-spec-deltas-absent`).
      - RED: `red-5.1.txt`, UNIT rung through a stubbed index reader:
        - each finding names the epic, the change directory, the capability, the headers and the
          direction;
        - "cannot answer" → no finding;
        - `integrity` exits as for every other check.
      - GREEN: a `CHECKS` entry in `integrity.mjs` that reads the exported function.
- [ ] 5.2 **TDD** — the briefing block.
      - RED: `red-5.2.txt`: the briefing names the same set under its own heading, and it is
        computed by the same exported function as 5.1 (assert the two report identical epic sets
        for one fixture).
      - GREEN: the briefing reads it the way it reads `ungatedArchives()`.
      Mutation proof `mutation-5.2.txt`: feed the briefing a second computation in a scratch copy,
      and show the identity assertion fails.
- [ ] 5.3 **Cost.** Measure the briefing's wall time over three runs in a hermetic clone, before
      and after 5.2, and record it in `evidence-5.3.txt`. Verify: one git process added, not one per
      capability (count the spawns).
- [ ] 5.4 **The archive transition is not refused.** UNIT-rung test: a `delivered` archive with
      deltas absent succeeds, and the next `integrity` names the epic. This proves design D3
      in code, not only in prose.

## 6. Required task items

- [ ] 6.1 **Call-site completeness sweep** (item 1), recorded in `call-site-sweep-6.1.txt`, every
      list derived with `rg`:
      - every caller of `epicProgress`, `outstandingWork` and `outstandingSummary`: where the union
        and the archived read hold, and where they do not;
      - every reader of `archivedTasksPath` and `isArchiveBackfilled`: the backfill's own path must
        be unchanged;
      - every archive path `gate-integrity` names (the interactive verb, the heal, the backfill, and
        both creation paths): state for each that the specs-synced condition refuses on none, and
        why;
      - every surface that renders standing conditions, `rg -n "ungatedArchives" scripts`: each one
        also renders the new block, or the omission is justified.
- [ ] 6.2 **Data references** (item 1). The new check stores nothing, so say so. The references it
      READS are the epic id, the key into `openspec/changes/archive/`, and the capability name, the
      key into `openspec/specs/`. Name where each is written (`openspec archive`, `sync`) and where
      it is removed (the stale-directory removal, `0ffb025`, is the live example).
- [ ] 6.3 **Every operation has an inverse** (item 1). Name each, shipped or not:
      - counting a story against disposing one: already shipped (`--wont-do`);
      - reading the archived source against the live one: the live path wins while it exists;
      - the finding against its clearing: shipped, because it clears when the index holds the
        headers;
      - a new gateway read: a read has no inverse, so say so.
- [ ] 6.4 **Verify against the commit** (item 2). For every task, run `git show --stat <sha>` and
      check that every file the task claims is in THAT commit. Record the results in
      `commit-verification-6.4.txt`. Pay particular attention to 3.1's five files and each
      functional test's twin.
- [ ] 6.5 **Declare lifecycle bookkeeping** (item 3). The disposition task 9.2 and the archive task
      9.3 each carry `<!-- pm:lifecycle -->` on their own first line. They were marked when this
      source was authored. This matters more here than anywhere else: this change makes the
      ARCHIVED `tasks.md` count, so an unmarked disposition task would make the handoff refuse this
      very change.
- [ ] 6.6 **Attribute every commit** (item 4). The orchestrator runs
      `update-epic <epic> --attribute-commit <sha>` for each implementation commit, in the order the
      commits landed, after the merge. The archive-move commit is NOT attributed.
- [ ] 6.7 **Cross-spec review** (item 5). This is 0.2. Re-run it after any concurrent amendment to a
      0.50.0 spec, and record the verdict again.
- [ ] 6.8 **Disposition** (item 6). It is recorded by 9.2, whose flags are specified there.
      This task checks that 9.2's declined deferrals still name every non-goal in `design.md`
      before Gate 2. Verify: each non-goal maps to a flag in 9.2, or is justified as not being a
      deferral.
- [ ] 6.9 **Route what the work taught** (item 7), and name which of the three kinds each item is.
      - PRACTICE: none expected. Say so if none arose.
      - TOOLING FRICTION: an epic whose change id differs from its own id reads `0/0` everywhere
        (design, Risks). If 0.3 needed a workaround, file it with
        `/pm:feedback feature "<summary>"`.
      - PROCESS: update `docs/lessons/an-archive-writes-outside-the-change-dir.md` `enforced_in` to
        name the new check. That is an edit to an existing lesson, not a new one.

## 7. Docs

- [ ] 7.1 `commands/status.md`: the new integrity check id and title, the briefing block, the index
      reading and the reason for it, and the archived-`tasks.md` and union rules for progress.
      Verify: `docs/parity-ledger.json` still claims the file (`scripts/test/parity.test.mjs` green).
- [ ] 7.2 `README.md`: the progress rule (stories plus tasks, and the archived tasks read) and the
      new standing condition, wherever the README describes integrity or progress
      (`rg -n "integrity|outstanding|progress" README.md`).
- [ ] 7.3 `skills/conductor/SKILL.md` and `commands/epic.md`: wherever they state that stories take
      precedence over a task source, or that outstanding work reads zero after an archive
      (`rg -n "precedence|stories" skills/conductor/SKILL.md commands/epic.md`).
- [ ] 7.4 `.changesets/<carrier-epic-id>.md`: user-facing bullets only, in `CHANGELOG.md`'s bullet
      format:
      - archived tasks now count;
      - stories no longer hide tasks;
      - `integrity` and the briefing now report a delivered change whose spec deltas never reached
        `openspec/specs/`.
- [ ] 7.5 **Mintlify list for the release cut** (`mintlify-doc-sync`), applied by the release, not by
      this change's branch: `/commands/status` (integrity check and briefing block), `/commands/epic`
      (progress: stories plus tasks), and the concept page that defines outstanding work. Verify:
      the list is in the 0.50.0 release notes handoff.

## 8. Integration

- [ ] 8.1 Every test is green on the final tree: the drift script, the assertion half, and
      `certify.mjs functional|sweeps` where permitted. `openspec validate handoff-demand-blind-spots --strict`
      passes. Re-run 1.1's measurements into `baseline-after.md`, and explain every difference from
      `baseline-before.md`.

## 9. Close

- [ ] 9.1 **Gate 2**, mode `thorough`: two fresh-context reviewers over `BASE..HEAD`, where HEAD is
      the last attributed commit. They check:
      - spec alignment;
      - that the D3 non-refusal holds in code;
      - the parser against the upstream grammar;
      - the double's capture honesty.
      Fix Critical and Important findings, then
      `record-gate-review <epic> --gate 2 --verdict pass --reviewer "<identity>" --base-sha <sha> --head-sha <last attributed sha>`.
- [ ] 9.2 <!-- pm:lifecycle --> Dispositions: archive the carrier epic `delivered`, with
      `--declined-deferral "MODIFIED requirement bodies are not compared::a later legitimate amendment changes the body, so a body check fires on routine work (design D4)"`,
      `--declined-deferral "no refusal at the archive transition::it deadlocks pm's own closeout (design D3)"`,
      and any further deferral as `--deferral "<epicId>:<section>"`. Each member epic that is not
      the carrier ends with its own disposition, per 0.3.
- [ ] 9.3 <!-- pm:lifecycle --> Archive: run `/opsx:archive handoff-demand-blind-spots`, then
      stage `openspec/` WHOLE, because the archive rewrites `openspec/specs/` too. Verify: the new
      integrity check reports nothing for this change once that commit is made.
