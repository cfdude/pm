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
- **Rungs.** A test's rung follows what its own frame touches (design D5, "Testing, by rung"). The
  UNIT rung refuses a test that reads or writes a path (`fixtures/fs-work-counter.mjs`; precedent
  `unit/conductor-22` and `unit/conductor-03`, which kept every `withArchivedChange()` case on the
  file rung). So: pure values → `scripts/test/unit/`; a fixture that writes a change directory or a
  `tasks.md` → `scripts/test/assert/`; anything that needs real git → `scripts/test/functional/`
  with its assertion twin.
- **Cite symbols, never line numbers.** This change lands AFTER the 0.50.0 wave that edits
  `epic-progress.mjs`, `add-epic.mjs`, `update-epic.mjs` and `constants.mjs`. Every reference below
  is a function, constant or check id.
- **Commits.** One conventional commit per task. Use `git add` with explicit paths only. Never pass
  `--no-verify`. After each commit, run `git show --stat <sha>` (see 6.4).

## 0. Before any code

- [ ] 0.1 **Gate 1**, review mode `thorough`: two fresh-context lenses over these artifacts BY PATH.
      - Lens A: is every WHEN/THEN in the four delta files (`specs/conductor-record/spec.md`,
        `specs/gate-integrity/spec.md`, `specs/epic-disposition/spec.md`,
        `specs/emitted-instructions/spec.md`) reachable and testable against the engine AS IT STANDS
        AFTER the preceding 0.50.0 wave, on the rung task 1–5 assigns it?
      - Lens B: absent edits and contradictions.
        - Every consumer of `epicProgress().source` (design D2), and every reader of
          `deliveredObligations()`.
        - The regression check's `--carried-to` clause ("An update to an archived epic does not
          break an obligation its archive met") under the union.
        - Whether a sentence anywhere in the main specs still says outstanding work reads zero for a
          moved source, or offers one part's remedy as if it cleared the union:
          `rg -n "reads as zero|source is gone|or an open inline story" openspec/specs`.
        - Whether D3's "standing condition, not refusal" contradicts "The archive transition is
          gated on every path that can reach it".
        - Whether integrity and the briefing can disagree about an epic under the ADDED
          requirement's scope (decided by the archived directory alone).
      Fix every Critical and Important finding, then re-run
      `openspec validate handoff-demand-blind-spots --strict`. Record
      `record-gate-review handoff-demand-blind-spots --gate 1 --verdict pass --reviewer "<identity>"`,
      with one `--artifact` for each of `proposal.md`, `design.md`, `tasks.md`,
      `specs/conductor-record/spec.md`, `specs/gate-integrity/spec.md`,
      `specs/epic-disposition/spec.md` and `specs/emitted-instructions/spec.md`, all under
      `openspec/changes/handoff-demand-blind-spots/`.
      Verify: the verdict appears in `node scripts/conductor.mjs status`.
- [ ] 0.2 **Cross-spec review** (required task item 5). Release 0.50.0 holds this change's FOUR spec
      files (`conductor-record`, `gate-integrity`, `epic-disposition`, `emitted-instructions`), plus
      every other member change's, counted flat. Run the `cross-spec-review` skill after Gate 1 with
      two lenses and ask the six questions. The engine hashes the spec set it enumerates, so any
      verdict recorded before the two new delta files existed is stale and MUST be recorded again.
      Where this change is most exposed:
      - **Double ownership.** The handoff count belongs to `conductor-record`, its refusal wording to
        `epic-disposition`, and the printed remedies to `emitted-instructions`. The new
        gate-integrity requirement must not restate any of them.
      - **Contradiction.** The new standing condition says no archive path refuses on it. Does any
        other 0.50.0 change add an archive-path refusal that reads the main specs?
      - **Shared chokepoint.** Other 0.50.0 epics that touch `epicProgress()`, `isArchived()` /
        `reconcileArchived()` (`drift-heal-leaves-claim-on-archive`), `DELIVERED_OBLIGATIONS`,
        `GIT_OPERATIONS`, or the spawn/exec allowlist (`no-network-law-test-is-weak`).
      Record `record-cross-spec-review 0.50.0 --verdict pass|fail --reviewer "<identity>"`.
      Verify: the verdict is recorded and not rendered stale.
- [x] 0.3 **Resolve the change-to-epic mapping before any code.** Resolved by RE-KEY (orchestrator,
      2026-09-25): the change was proposed as `archive-gate-reads-archived-work` and renamed to
      `handoff-demand-blind-spots`, so the change id IS the carrier epic's id (openspec lane since
      2026-09-25). `gh-cfdude-pm-222` is NOT a separate epic to deliver: it is already archived
      `outcome: superseded` into `handoff-demand-blind-spots` through a `supersedes` link, and
      cfdude/pm#222 is closed by 9.2 with the ship evidence. Verify:
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
      - (c) Run `node scripts/conductor.mjs unconsidered-outcomes` and save each entry's
        `deliveredBlockedBy`; `blockedDelivered()` reads `deliveredObligations()`, so D1 and D2
        move it.
      - (d) Run every live-record test and save its result: `rg -ln "liveState|\.conductor/state\.json" scripts/test`.
      - (e) Count the epics whose missing-source warning APPEARS or DISAPPEARS under design D2. A story
        no longer suppresses the warning, and an ABSENT lane reads as openspec, so every lane-less
        story epic that is not archived is a candidate. Measure it here, and in at least three other
        pm-managed repositories (the `pm-fleet-upgrade` skill lists them), each read-only. STOP
        on a count that would flood PROJECT.md with warnings on healthy epics, by the 7-of-8 rule,
        and bring the number back before 2.1 lands.
      - (f) Count the archive directories whose id `archivedTasksPath()` and `isArchived()` resolve
        differently today (the one-resolver rule), and for each, what `reconcileArchived()` (a WRITE
        path, through `isArchived()`) would write differently under the resolver. 1.2 adds a test for
        any non-zero count.
      Verify: the file exists and names the commit it was measured at.
- [ ] 1.2 **TDD** — one resolver, and the archived `tasks.md` for a non-backfilled epic.
      - RED: `red-1.2.txt`, an ASSERT-rung test in `scripts/test/assert/` (its fixture writes
        `openspec/changes/archive/…`, which the unit rung refuses):
        - an archived openspec-lane epic with no backfill stamp and an archived `tasks.md` at 1/3:
          `epicProgress()` = `{done: 1, total: 3}` and `outstandingWork()` = 2, one case each for the
          date-prefixed and the undated directory;
        - two dated directories for one id: the later date's `tasks.md` is read, and `isArchived()`
          and `archivedTasksPath()` name the same directory;
        - an id that itself carries a date prefix resolves identically through both.
      - GREEN, in one commit:
        - one exported resolver (working name `archivedChangeDir(id)`) on `archivedChanges()` and
          `strippedChangeId()`; the latest date wins, undated ranks below dated. `isArchived()` and
          `archivedTasksPath()` both call it;
        - in `epicProgress()`, drop the `isArchiveBackfilled(epic)` condition around
          `archivedTasksPath(epic.id)`, and rewrite the comment that cites "reads zero";
        - rewrite the three stale comments design Context names: `archiveGate()`'s doc comment, the
          handoff branch's "A checkbox source cannot be read here at all", and the
          `archived-with-zero-ticked-tasks` check's `0/0` comment;
        - **`scripts/test/functional/conductor-15.test.mjs`'s "8.3: an epic the conductor MANAGED
          keeps its suppressed missing-source behavior" asserts exactly what D1 reverses.** Rewrite it
          to assert the managed epic now renders `1/2`, and EDIT its twin
          (`scripts/test/assert/conductor-15.test.mjs` or `scripts/test/unit/conductor-15.test.mjs`)
          in the same commit, which the drift script requires. Gate 1 lens B measured the functional
          half at 1188/1189 with D1 applied and this test unchanged, while the hook stayed green.
      Verify: the assertion half is green, `certify.mjs functional` is green where permitted, and the
      file-rung backfill tests are unchanged.
- [ ] 1.3 **TDD** — the documented sequence refuses a delivered archive with open archived tasks.
      - RED: `red-1.3.txt`, an ASSERT-rung verb test: Gate 2 recorded, the change moved under
        `archive/`, the heal run, then `update-epic <id> --status archived --outcome delivered --no-deferrals`.
        It asserts exit non-zero, `2 of 1/3 task(s) outstanding` in the refusal, and the store
        unchanged.
      - The paired case (every undeclared task ticked, archive task declared) asserts success.
      - GREEN: 1.2's change. If nothing further is needed, say so in the commit message.
      Mutation proof `mutation-1.3.txt`: restore the backfill scope in a scratch copy and show the
      refusal test fails.
- [ ] 1.4 **Live-record fallout.** Re-run 1.1(b), (c) and (d). For every expectation that moves, fix it
      in this commit and justify each movement in the commit body. At drafting:
      `archived-with-zero-ticked-tasks` gains candidates but no findings, and the two delivered epics
      render 53/54 and 46/47. Name those two epics in the commit body. Verify: the live-record tests
      pass, and `git show --stat` lists every test touched.

## 2. Stories and the checkbox source count together (conductor-record, epic-disposition, emitted-instructions, design D2)

- [ ] 2.1 **TDD** — the union.
      - RED: `red-2.1.txt`, split by rung:
        - UNIT (`scripts/test/unit/`, no path touched): a story-only epic → unchanged; a disposed
          story leaves both sides; `excludedLabel` over stories alone;
        - ASSERT (`scripts/test/assert/`, the fixture writes a `tasks.md`): `tasks.md` at 1/3 plus one
          done story → `2/4`; a disposed story plus `tasks.md` at 2/2 plus a done story → `3/3`, with
          `excludedLabel` naming both kinds; an openspec epic that is not archived, with stories and no
          `tasks.md` anywhere → the missing-source warning.
      - GREEN: `epicProgress()` computes the story part and the checkbox source independently and sums
        them. `excluded` sums both. `excludedLabel` names both kinds when both are present. `source`
        is single-valued for one part and two-part (e.g. `stories+openspec`) for both, with a parts
        list consumers test membership on, and each part's own open count.
      Verify: the half is green.
- [ ] 2.2 **TDD** — the reproduction from the 0.43.0 review (A2).
      - RED: `red-2.2.txt`, an ASSERT-rung verb test: `tasks.md` at 1/3, `update-epic --add-story x`,
        then `update-epic --story 1 --done --status archived --outcome delivered --no-deferrals`.
        It asserts exit non-zero, a refusal naming 2 outstanding, and the store unchanged.
      - GREEN: 2.1, plus 2.3's consumers.
      Mutation proof `mutation-2.2.txt`: reinstate the stories-first early return in a scratch copy.
- [ ] 2.3 **Every consumer of `source`, in the same commit as 2.1 or immediately after it.** Enumerate
      with `rg -n "\.source\b|source ===|source:" scripts/lib` and record the list in the commit
      body. At drafting:
      - `outstandingSummary`: `items` whenever stories contribute;
      - `archiveGate()`'s handoff refusal message: its `source === "stories"` remedy branch becomes
        one remedy clause per contributing part (`epic-disposition`, "Unfinished work at archive
        records where it went");
      - the handoff entry's `remedy` in `DELIVERED_OBLIGATIONS`: `--story <n> --done` whenever
        stories contribute;
      - the handoff entry's `archiveFlags`: `--carried-to` whenever the checkbox source has open
        tasks;
      - `bar()`;
      - the regression refusal's printed `--carried-to` (`dispositionInvocation`'s `carry`), which
        keys on the checkbox source's open count, never on `source`;
      - the `integrity` remedies for `heal-archived-epic-passed-gate-2` and
        `delivered-release-epic-left-open` (`emitted-instructions`).
      **TDD** RED `red-2.3.txt`, ASSERT rung, a mixed epic with one open story and one open task:
      - the archive refusal names BOTH remedies, each against its part, and the printed invocation
        carries `--carried-to`;
      - `unconsidered-outcomes` on the same epic: after `--story <n> --done` alone the entry STILL
        names the handoff; following it with the `--carried-to` archive exits zero and removes it
        (`epic-disposition`'s both-parts scenario);
      - the drift-heal disposition step `integrity` prints names `--story <n> --done` first AND
        carries `--carried-to`, and followed it clears the finding (`emitted-instructions`).
      Verify: the half is green, and the remedy-registry test that exercises every printed remedy
      against a fixture still passes.

## 3. The git gateway reads the index (design D5)

- [ ] 3.1 **TDD** — the operation.
      - RED: `red-3.1.txt`, the gateway guard, failing on an exec site with no `GIT_OPERATIONS` row,
        or the reverse.
      - GREEN, all in ONE commit, every file listed (6.4 checks each against this commit):
        - `scripts/lib/git-gateway.mjs`: `realGit()` gains the operation (`git cat-file --batch`,
          `:./<path>` lines on stdin, `GIT_NO_LAZY_FETCH=1`, the `batchCheckCommits` stdio shape, NO
          `encoding` so it returns a `Buffer`, and `maxBuffer: 256 * 1024 * 1024`); `GIT_OPERATIONS`
          gains its row;
        - `scripts/lib/git.mjs`: the wrapper. It parses the `Buffer` by BYTE offset (`<oid> blob
          <size>` then exactly `<size>` bytes then a newline; `<path> missing`), decodes each blob as
          UTF-8 only after slicing, returns a map from path to contents or `null` (missing), returns
          `null` overall ONLY for the no-repository failure, and RETHROWS `ENOBUFS` and every other
          failure;
        - `scripts/test/fixtures/fake-git.mjs`: the `noRepository` answer, and a byte-valued answer
          decoded from the capture;
        - `scripts/test/fixtures/git-gateway-capture.json`: the operation's `noRepository` entry and
          an arg-keyed case whose value is stored base64 under an explicit encoding tag, refreshed by
          the capture's own procedure;
        - `scripts/test/fixtures/git-gateway-repo.mjs`: `casesFor()` gains the operation's case,
          including a multi-byte spec and two paths in one call;
        - `scripts/test/assert/git-gateway-guard.test.mjs`: its hardcoded site count 23 → 24;
        - `scripts/test/functional/git-gateway-guard.test.mjs`: its asserted count 23 → 24 (a
          functional file, so its assertion twin above is edited in the same commit).
      Verify: the guard is green in both halves, and the capture's byte-identity check against real
      git passes on the multi-byte case.
- [ ] 3.2 **TDD** — the index read against real git, FUNCTIONAL (new id, working name
      `functional/spec-sync-index.test.mjs`), with its assertion twin
      (`assert/spec-sync-index.test.mjs`, the wrapper's parsing over a captured `Buffer`) EDITED in the
      same commit.
      - RED: `red-3.2.txt`, a hermetic repository that covers:
        - a committed spec → contents;
        - a staged but uncommitted rewrite → the staged contents;
        - `git reset --hard` after staging → the committed contents;
        - a path absent from the index → `null`;
        - a non-repository → overall `null`;
        - TWO multi-byte specs in one call → each decoded exactly, byte-for-byte equal to the file;
        - a conductor root that is a SUBDIRECTORY of the repository → its own `openspec/specs/`
          contents, not `null`.
      - GREEN: 3.1's wrapper.
      Verify: `node scripts/test/certify.mjs functional` passes, where permitted (see Commit
      mechanics).

## 4. The spec-sync comparison (gate-integrity ADDED requirement, design D4)

- [ ] 4.1 **TDD** — the delta parser, UNIT rung, a pure function of text.
      - RED: `red-4.1.txt`, one fixture per rule the ADDED requirement states:
        - ADDED, MODIFIED and REMOVED plain headers;
        - REMOVED as a `-`, `*` or `+` bullet with backticks;
        - RENAMED `FROM:`/`TO:` with and without a bullet or backticks;
        - an unpaired `FROM:` (displaced, and pending at section end) and an unpaired `TO:` → reported;
        - `FROM:` in one copy of `## RENAMED Requirements` and `TO:` in a second copy → two unpaired,
          never a pair;
        - `###Requirement: X` and `### requirement: X` → headers;
        - `## added requirements` (title case folded) and a title repeated twice → both copies read;
        - a header outside any delta section → not part of the delta;
        - a header inside a code fence → ignored;
        - `### Requirement: Foo ###` → `Foo`; `### Requirement: C#` → `C#`;
        - case sensitivity of names → kept;
        - a BOM and CRLF line endings → normalized;
        - the MAIN spec: a header under `## Notes` → not present; one under `## requirements` → present.
      - GREEN: the parser in the new module (working name `scripts/lib/spec-sync.mjs`), with a
        comment naming `@fission-ai/openspec` 1.13.2 `dist/core/parsers/requirement-blocks.js` as
        the grammar it mirrors.
- [ ] 4.2 **TDD** — the comparison and the later-change discharge, UNIT rung, text in and findings
      out, no path.
      - RED: `red-4.2.txt`, every scenario of the ADDED requirement that needs no git:
        - lost ADDED;
        - REMOVED still present;
        - a later MODIFIED of the same requirement → no finding;
        - a later REMOVED → no finding;
        - same-date and undated → unordered, both directions;
        - RENAMED on both sides;
        - main spec absent → every ADDED reported;
        - outcome `killed` → out of scope;
        - "cannot answer" → no presence or absence finding, and an unpaired RENAMED still reported.
      - GREEN: the comparison. Its scope is an archived change directory found by the one resolver
        (1.2), the openspec lane (an absent lane normalized) and outcome `delivered`.
      Mutation proofs `mutation-4.2.txt`: drop the discharge, and invert the same-date rule. Each in
      a scratch copy fails a named case.
- [ ] 4.3 **EVIDENCE ONLY, not a test** — the live repository. It is not a functional test because an
      assertion on this repository's own archive is a live-record test whose expectation moves with
      every archive, and the replay needs history a shallow CI clone lacks. The ongoing guard is the
      check itself in `integrity`. Save in `evidence-4.3.txt`:
      - FIRST, that the index read returned a non-null map with one entry per capability named by an
        in-scope delta, and how many of those entries are non-null. Zero findings from a null read is
        the cannot-answer case, not a pass;
      - the live run against the index: **zero** findings, as the measurement found;
      - the replay against `3256cc2^:` content: exactly 0.48.0's four ADDED headers, excluding changes
        archived after that commit;
      - a mutation proof: in a scratch clone, remove one in-scope ADDED header from a main spec and
        `git add` it; the run names exactly that header.
      Verify: if the live run reports anything, STOP. That is either a real loss (restore it) or a
      false positive (the 7-of-8 rule: fix the comparison before shipping).

## 5. The surfaces (design D6)

- [ ] 5.1 **TDD** — the integrity check (working id `delivered-epic-spec-deltas-absent`) and its
      exported function.
      - RED: `red-5.1.txt`:
        - ASSERT rung: `specSyncFindings(epics, { readIndex })` called directly with a stub reader
          returning a NON-EMPTY map over fixture archive directories. Each finding names the epic, the
          change directory, the capability, the headers and the direction; a reader returning `null`
          → no presence or absence finding;
        - FUNCTIONAL (new id, working name `functional/spec-sync-surfaces.test.mjs`); its same-id twin
          is `assert/spec-sync-surfaces.test.mjs`, which holds the direct-call cases above and is
          edited in the same commit, in a hermetic repository: `integrity` names
          the epic and exits as for every other check; and the staged-then-reset SEQUENCE — commit
          the archive move, stage the rewritten main spec (integrity names nothing), then
          `git reset --hard` (integrity names the lost header).
      - GREEN: `specSyncFindings()` in `spec-sync.mjs` with the reader as a parameter defaulting to
        the `git.mjs` wrapper; a `CHECKS` entry in `integrity.mjs` that calls it.
- [ ] 5.2 **TDD** — the briefing block and `render`'s output.
      - RED: `red-5.2.txt`, FUNCTIONAL, in `functional/spec-sync-surfaces.test.mjs` (twin
        `assert/spec-sync-surfaces.test.mjs` edited in the same commit), over a
        hermetic repository with one real finding so both sets are NON-EMPTY:
        - `brief` names the same epic set under its own heading as `integrity`, computed by the same
          exported function;
        - `render` prints the block on its stdout, and the `PROJECT.md` it writes does NOT contain it;
        - the archive-to-`git add` window, SIMULATED by moving the change directory under `archive/`
          and rewriting the main spec in the fixture (the openspec CLI is not a test dependency), both
          present and unstaged → `integrity` names the epic and `PROJECT.md` does not; after `git add openspec/`
          → nothing named.
      - GREEN: `buildBrief()` gains an option that includes the block; `brief()` and `snapshot()` pass
        it; `render()`'s embedding does not. The `render` VERB's command-line dispatch (not
        `render()`, which hooks and other verbs run in-process) writes the block to stdout after
        writing the file, and never under `--diff-summary`. The overflow line points at `integrity`.
        Add cases: `commit-nudge` and `snapshot` stdout do not carry the block, and
        `render --diff-summary` prints only its `epic-relevant:` line.
      Mutation proof `mutation-5.2.txt`: feed the briefing a second computation in a scratch copy, and
      show the identity assertion fails; and embed the block in `PROJECT.md` in a scratch copy and
      show the window case fails.
- [ ] 5.3 **Cost.** Measure the wall time of `brief` AND of `render` over three runs each in a hermetic
      clone, before and after 5.2, and record it in `evidence-5.3.txt`. Verify: one git process added
      per invocation, not one per capability (count the spawns).
- [ ] 5.4 **REGRESSION GUARD** — the archive transition is not refused. FUNCTIONAL, in
      `functional/spec-sync-surfaces.test.mjs` (twin `assert/spec-sync-surfaces.test.mjs` edited in
      the same commit), because the check it proves silent at the
      transition only fires against a real index: a `delivered` archive with a delta whose header the
      index lacks SUCCEEDS, and the next `integrity` names the epic. It passes the moment it exists,
      so mutation proof `mutation-5.4.txt`: add the check to `DELIVERED_OBLIGATIONS` in a scratch copy
      and show the archive is then refused and this test fails.

## 6. Required task items

- [ ] 6.1 **Call-site completeness sweep** (item 1), recorded in `call-site-sweep-6.1.txt`, every
      list derived with `rg`:
      - every caller of `epicProgress`, `outstandingWork`, `outstandingSummary` and
        `deliveredObligations` (`rg -n "epicProgress\(|outstandingWork\(|outstandingSummary\(|deliveredObligations\(" scripts`):
        where the union and the archived read hold, and where they do not. At drafting the
        `deliveredObligations()` readers are `blockedDelivered()` → `unconsidered-outcomes`,
        `integrity`'s `heal-archived-epic-passed-gate-2` and `delivered-release-epic-left-open`,
        `deliveredRegression()`, and the AMEND commit hook in `subcommands.mjs` that calls
        `deliveredRegression()`;
      - every reader of `archivedTasksPath`, `isArchived` and `isArchiveBackfilled`: each goes through
        the one resolver, and the backfill's own path is unchanged;
      - every archive path `gate-integrity` names (the interactive verb, the heal, the backfill, and
        both creation paths): state for each that the specs-synced condition refuses on none, and
        why;
      - every surface that renders standing conditions (`rg -n "ungatedArchives|buildBrief\(" scripts`):
        `integrity`, `brief`, `snapshot` and the `render` verb's stdout carry the new block;
        `render()`'s embedding into `PROJECT.md`, `render()` run in-process by other verbs and hooks,
        and `render --diff-summary` deliberately do not (design D6), and those omissions are the
        justified ones.
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
      `commit-verification-6.4.txt`. Pay particular attention to 3.1's SEVEN files, 1.2's
      `conductor-15` pair, and every functional test's twin.
- [ ] 6.5 **Declare lifecycle bookkeeping** (item 3). The disposition task 9.2 and the archive task
      9.3 each carry `<!-- pm:lifecycle -->` on their own first line. They were marked when this
      source was authored. This matters more here than anywhere else: this change makes the
      ARCHIVED `tasks.md` count, so an unmarked disposition task would make the handoff refuse this
      very change.
- [ ] 6.6 **Attribute every commit** (item 4). The orchestrator runs
      `update-epic handoff-demand-blind-spots --attribute-commit <sha>` for each implementation
      commit, in the order the commits landed, after the merge. The archive-move commit is NOT
      attributed.
- [ ] 6.7 **Cross-spec review** (item 5). This is 0.2. Re-run it after any concurrent amendment to a
      0.50.0 spec, and record the verdict again.
- [ ] 6.8 **Disposition** (item 6). It is recorded by 9.2, whose flags are specified there.
      This task checks that 9.2's declined deferrals still name every non-goal in `design.md`
      before Gate 2. Verify: each of the SIX non-goals maps to a flag in 9.2, or is justified there as
      not being a deferral.
- [ ] 6.9 **Route what the work taught** (item 7), and name which of the three kinds each item is.
      - PRACTICE: none expected. Say so if none arose.
      - TOOLING FRICTION: a change proposed under one id and carried by an epic with another reads
        `0/0` on the epic; here it took a directory re-key and a hand-supersede of the tracker epic.
        File it with `/pm:feedback feature "<summary>"` unless an open issue already covers it.
      - PROCESS: update `docs/lessons/an-archive-writes-outside-the-change-dir.md` `enforced_in` to
        name the new check. That is an edit to an existing lesson, not a new one.

## 7. Docs

- [ ] 7.1 `commands/status.md`: the new integrity check id and title; the briefing block; that
      the `render` verb PRINTS the block on its output rather than writing it into `PROJECT.md`, so the status
      procedure reads that output as well as the file (design D6); the index reading, the reason for
      it, and the archive-to-`git add` window; and the archived-`tasks.md` and union rules for
      progress. Verify: `docs/parity-ledger.json` still claims the file
      (`scripts/test/parity.test.mjs` green).
- [ ] 7.2 `README.md`: the progress rule (stories plus tasks, and the archived tasks read) and the
      new standing condition, wherever the README describes integrity or progress
      (`rg -n "integrity|outstanding|progress" README.md`).
- [ ] 7.3 `skills/conductor/SKILL.md` and `commands/epic.md`: wherever they state that stories take
      precedence over a task source, or that outstanding work reads zero after an archive
      (`rg -n "precedence|stories" skills/conductor/SKILL.md commands/epic.md`).
- [ ] 7.4 `.changesets/handoff-demand-blind-spots.md`: user-facing bullets only, in `CHANGELOG.md`'s
      bullet format:
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
      passes. Re-run 1.1's measurements, `unconsidered-outcomes` included, into `baseline-after.md`,
      and explain every difference from `baseline-before.md`.

## 9. Close

- [ ] 9.1 **Gate 2**, mode `thorough`: two fresh-context reviewers over `BASE..HEAD`, where HEAD is
      the last attributed commit. They check:
      - spec alignment across all four delta files;
      - that the D3 non-refusal holds in code;
      - the parser against the upstream grammar;
      - the double's capture honesty, including the byte-valued entry;
      - that `PROJECT.md` never carries the new block.
      Fix Critical and Important findings, then
      `record-gate-review handoff-demand-blind-spots --gate 2 --verdict pass --reviewer "<identity>" --base-sha <sha> --head-sha <last attributed sha>`.
- [ ] 9.2 <!-- pm:lifecycle --> Disposition and tracker close. Archive the carrier epic ONLY:
      `update-epic handoff-demand-blind-spots --status archived --outcome delivered --reason "<what shipped>"`
      with one `--declined-deferral` per non-goal in `design.md`:
      - `--declined-deferral "a refusal at the archive transition for unsynced specs::it deadlocks pm's own closeout (design D3)"`;
      - `--declined-deferral "comparing MODIFIED requirement bodies::a later legitimate amendment changes the body, so a body check fires on routine work (design D4)"`;
      - `--declined-deferral "mapping an epic to a change directory with a different id::the epic id stays the key, as for archivedTasksPath, isArchived and the heal"`;
      - `--declined-deferral "reconstructing a moved plan file::plans have no archive convention to follow"`;
      - `--declined-deferral "repairing the two live delivered records with open tasks::they are reported truthfully; correcting them is a separate decision on each record"`;
      - `--declined-deferral "refusing discharge by a --skip-specs or killed later change::the archive records neither, and restricting discharge reports correct records (design D4)"`;
      and any further deferral as `--deferral "<epicId>:<section>"`. The archive-to-`git add` window
      is NOT a deferral: it is the stated behavior of reading the index, not unbuilt work.
      `gh-cfdude-pm-222` gets NO disposition here: it is already archived `superseded` into this
      epic. Instead close its issue with the ship evidence:
      `gh issue close 222 --repo cfdude/pm --comment "Shipped in 0.50.0 by handoff-demand-blind-spots: <commit range>, integrity check delivered-epic-spec-deltas-absent and its briefing block."`
      Verify: `gh issue view 222 --repo cfdude/pm --json state` reads `CLOSED`.
- [ ] 9.3 <!-- pm:lifecycle --> Archive: run `/opsx:archive handoff-demand-blind-spots`, then
      stage `openspec/` WHOLE, because the archive rewrites `openspec/specs/` too. Verify: the new
      integrity check reports nothing for this change once `openspec/` is staged (the window closes at
      staging), and still nothing once that commit is made.
