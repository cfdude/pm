# Tasks

## Commit mechanics

These rules bind every section below.

- **This change rewrites the gate that judges it.**
  - **Which drift judges a commit.** The pre-commit hook runs the drift script from the index snapshot
    (`.githooks/pre-commit:146-159`), so every commit is judged by the `drift.mjs` it contains.
  - **The landing order.** Sections 1–4 land in design D7's order (L1 → L2 → L3 → L4), each section's
    code as the commits named there. No commit may leave the drift script unable to read the record
    that commit's own certify wrote.
  - **Certify before committing.** Before every commit that stages a file in a bucket's subject:
    1. stage the commit exactly;
    2. run the working-tree certify (equal to the staged copy), `node scripts/test/certify.mjs
       functional` and/or `… sweeps`, as the drift script names;
    3. then commit with a PLAIN `git commit` (round 2 m4). `git commit <path>` and `git commit -a`
       build their own temporary index (`next-index-<pid>.lock`, `index.lock`; `commit-msg-probe.log`),
       which is not the index certify copied: such a commit is fresh only if that temporary index
       happens to equal the certified one, and after a partial stage it never does.

    Never pass `--no-verify`.
  - **Certify BY HAND where the gate cannot see the machinery (design D7, Gate 1 B9).** Until 2.4
    lands, the old drift demands a functional run only for `certifiedModules()`, which holds none of
    `certify.mjs`, `certification.mjs` or `drift.mjs`. So tasks 1.1, 1.2, 1.3, 2.1, 2.2 and 2.3 each
    carry the step "certify functional by hand before this commit": stage the commit exactly, run
    `node scripts/test/certify.mjs functional`, and paste its pass line into that task's
    `red-<task>.txt` (or `mutation-<task>.txt`). From 2.4 on, the interim subject holds those three
    scripts, so the gate itself demands the run.
- **A RED lands in the SAME commit as its GREEN.** The hook runs the drift script and then the whole
  assertion half, so a RED cannot be committed alone. Before the GREEN commit, save the failing run
  against the pre-GREEN tree in this directory as `red-<task>.txt`, and name that file in the commit
  message. Every **TDD** task names its RED/GREEN pair.
- **A REGRESSION GUARD** is a test that passes the moment it exists. Verify it with a deliberate
  violation in a SCRATCH COPY, never in the tree, and save the result as `mutation-<task>.txt`: the
  guard must fail on the violation and pass once it is reverted.
- **Rungs.**
  - Pure functions of values go on the UNIT rung: manifest agreement, trailer parsing, subject
    derivation over an injected reader.
  - A test that writes the record directory or a temp file goes on the FILE rung (`assert/`).
  - Anything that needs real git (index copy, shared clone, `ls-files -s`, the hooks) is FUNCTIONAL,
    with its assertion twin.
- **Twins.** A staged `scripts/test/functional/<id>.test.mjs` needs its twin in the same staged diff
  until section 4 lands. After that, a `Twin-Unchanged` trailer MAY exempt a subject-free change,
  and it must say why.
- **Cite symbols, not line numbers,** in code comments. Line numbers in THIS file are as of
  c96240ab.
- **Commits.** One conventional commit per task. Use `git add` with explicit paths. After each
  commit, run `git show --stat <sha>` (see 5.4).

## 0. Before any code

- [x] 0.1 **Gate 1** (orchestrator), review mode `thorough`: two fresh-context lenses over these
      artifacts BY PATH.
      - **Lens A: reachability and testability.** Is every WHEN/THEN in
        `specs/suite-certification/spec.md` reachable on the rung this file assigns it? In
        particular:
        - "Concurrent writers lose no entry";
        - "An unstaged edit made during a run does not enter the record";
        - the observer's "A missed observation fails the certification".
      - **Lens B: absent edits and contradictions.**
        - Every MODIFIED block carries every scenario the main spec has. Check with
          `openspec validate --strict`, and read each block against the main spec.
        - Nothing in `openspec/specs/` still says "certified module", "covers" or "dangling" in a
          sense this change retires: `rg -n "certified set|certified module|covers|dangling" openspec/specs`.
        - D1's "one agreeing entry" against the split-commit scenario. **Resolved at Gate 1 (B1):**
          an entry must equal the commit's WHOLE subject manifest (paths, mode and blob), so the
          split-commit scenario is restated as "demands a run for each", and "entries about
          different content never agree" is now true by construction (design D1, "Why the whole
          subject").
        - D4's claim that the pre-commit run no longer reports coupling, against every hook test in
          `functional/conductor-09.test.mjs` that expects a coupling refusal from the pre-commit
          hook.

      Fix every Critical and Important finding, then re-run
      `openspec validate certification-record-redesign --strict`. Record
      `record-gate-review certification-record-redesign --gate 1 --verdict pass --reviewer "<identity>"`,
      with one `--artifact` for each of:
      - `proposal.md`
      - `design.md`
      - `tasks.md`
      - `specs/suite-certification/spec.md`

      all under `openspec/changes/certification-record-redesign/`.
      Verify: the verdict appears in `node scripts/conductor.mjs status`.
      Done: Gate 1 passed, recorded against commit 48afa418 (`gateReview.gate1`, verdict pass).
- [x] 0.2 **Cross-spec review** (orchestrator) (required task item 5). Not applicable at L1: release 0.51.0 holds one spec file; re-run at 5.7 when a second lands (`cross-spec-0.2.txt`).
      - **Today.** Release 0.51.0 holds this change's ONE spec file today, so the item's threshold (2
        or more spec files, counted flat across the release) is not met yet. Record that, with the
        count, in `cross-spec-0.2.txt`.
      - **What may change it.** 0.51.0 carries other epics that may become spec-bearing:
        - `store-owns-claude-md-managed-block` (openspec, planned);
        - `gh-cfdude-pm-205` (openspec, untriaged);
        - `guards-that-read-engine-source-drift-silently` and `hook-fixtures-couple-to-every-hook-step`
          (superpowers, later). Both touch the suite and could grow a `suite-certification` delta.
      - **The trigger.** The moment any of them adds a spec file, run the `cross-spec-review` skill
        over the release's whole spec set before either change's `/opsx:apply`. Record
        `record-cross-spec-review 0.51.0 --verdict pass|fail --reviewer "<identity>"`.
      Verify: `node scripts/conductor.mjs status` shows no `⚠ no cross-spec review` for 0.51.0, or
      shows the release holding one spec file.
- [x] 0.3 **BASELINE, re-measured on the day** into `baseline-before.md`. Never copy it from
      `design.md`.
      - (a) **Trigger frequency.** Run `node openspec/changes/certification-record-redesign/measure.mjs
        . e71c63a3 presquash/pr-234` and paste the JSON. Expect `A_certified_today` 15,
        `B_widenedShippedSurface` 70, `B_widenedPlusHeadDeletions` 70 and `C_anyEngineModule` 51
        of 126, with `headSizes.closure` 132 and `headExecutedAssertion` naming
        `assert/engine-resolution.test.mjs` and `assert/parity.test.mjs` (Gate 1 round 2, C1). Any
        difference is explained,
        never rounded away.
      - (b) **Certify timing.** Time `node scripts/test/certify.mjs functional` and `… sweeps` on the
        CURRENT runner, three runs each, with the machine's load average recorded beside each run.
        Run in a scratch clone, so this record is not touched.
      - (c) **The export.** Time the `checkout-index -a` export, and the shared-clone build of D2.
      - (d) **The bare-export failure.** Re-run the functional half from a bare `checkout-index`
        export and list the failing files. This is the evidence for D2's shared clone.
        `functional-in-snapshot.out` is the 2026-09-28 copy.
      Verify: `baseline-before.md` holds all four, each with the command that produced it.
- [x] 0.4 **Re-read the four tracker items** (#226, #230, #229, #227), with their comments, for the
      superseded epics `gh-cfdude-pm-226`, `-230`, `-229` and `-227`.
      This epic has no `externalId`, so nothing is recorded with `record-tracker-refresh`. Note any
      comment newer than 2026-09-28 in `baseline-before.md`.
      Verify: every item has a line there.

## 1. L1: certify runs over the index (design D2, ADDED "Certification runs over the index…")

- [x] 1.1 **TDD, UNIT**: the run plan as a pure value.
      - **The pure function.** Extract `indexRunPlan({ indexFile, commonDir, headSha, tmp })` into
        `scripts/test/certification.mjs`. It returns the ordered git argv lists for:
        - the index copy;
        - `ls-files -s` over the copy;
        - `clone --shared --no-checkout`;
        - `update-ref --no-deref HEAD`;
        - `checkout-index -a -f`.
      - **The RED** (`unit/certify-index.test.mjs`, new): the plan reads the COPY for both the
        manifest and the export, and never the live index. It also never names `worktree`, `stash`,
        `GIT_DIR` or `GIT_WORK_TREE`.
      - **The GREEN:** the function.

      RED `red-1.1.txt`. Certify functional by hand before this commit (Commit mechanics, B9).
      Verify: the new unit file passes and the unit rung's fs guard stays green.
- [x] 1.2 **TDD, FUNCTIONAL** (new id `certify-index`, with its twin `unit/certify-index`): certify
      over a real fixture repository.
      - **The RED.** Build a fixture repository with a partially staged file; certify records the
        STAGED blob. A second test proves an edit made to the working tree mid-run is absent from the
        record, using a bucket stub that edits the file and then passes. A third proves the working
        tree, the index, `git stash list` and `git worktree list` are byte-identical before and after
        a passing, a failing and a SIGTERM'd run.
      - **The GREEN.** `certify.mjs` runs the bucket in the shared clone from 1.1's plan, in a run
        directory named `pm-certify-run.*` under the temp directory, and removes it on exit and on
        INT/TERM/HUP. It STILL writes the old single-file format, now hashed from the index copy's
        bytes.
      - **Import-safe (round 2 m8).** `certify.mjs` stays import-safe: importing it clones nothing,
        copies no index and runs no git. All of 1.1's plan runs only under the `invokedDirectly`
        guard (`certify.mjs:167-171`), never at module top level, because
        `assert/certify-count.test.mjs:15` imports it into the assertion half, which may spawn
        nothing. Verify: `assert/certify-count.test.mjs` stays green in the same commit.

      RED `red-1.2.txt`. Certify functional by hand before this commit (B9).
      Verify: `node --test scripts/test/functional/certify-index.test.mjs`; `certify.mjs functional`
      passes in this repository with a load average recorded; the count equals 0.3(b)'s.
- [x] 1.3 **REGRESSION GUARD, FUNCTIONAL**: the bucket passes in the shared clone.
      - **The guard.** A test in `functional/certify-index` runs the four files 0.3(d) found failing
        in a bare export (`conductor-13` "16.3", `conductor-15`, `conductor-37`,
        `gate-artifact-evidence`) from a shared clone built by the plan, and asserts they pass.
      - **The mutation.** Build the run directory as a bare export in a scratch copy of `certify.mjs`;
        the guard must fail naming `not a git repository`.

      `mutation-1.3.txt`. Certify functional by hand before this commit (B9).
      Verify: the guard is green in the tree and red in the mutation.

## 2. L2: the content-keyed manifest record (design D1, D5; MODIFIED "A functional result is recorded…")

- [x] 2.1 **TDD, UNIT**: freshness as equality with ONE entry's WHOLE manifest (design D1, B1/B2).
      - **The pure functions.**
        - `bucketDemanded({ stagedPaths, indexPaths, subjectIndex, subjectHead })`: true when a staged
          path is in `subjectIndex`, or, for a staged path `indexPaths` no longer holds, in
          `subjectHead` (design D1 step 2; round 2 m2). `subjectIndex` and `subjectHead` are thunks,
          and neither is called when no staged path lies under a subject root (design D2, "The
          skip"; round 2 m3).
        - `manifestKey(manifest)` over `path NUL mode SP blob NUL`, and
          `recordFreshness({ bucket, indexManifest, entryFor })`, where `entryFor(key)` returns the
          one entry of that key or null. Fresh only when that entry passed and its manifest equals
          `indexManifest` exactly.
      - **The RED** (`unit/drift-freshness.test.mjs`, new; no functional twin needed). It covers the spec's
        scenarios:
        - an unchanged module;
        - a changed module;
        - a stale record: none, other bucket, other content;
        - a split across two commits: the first split commit is NOT fresh against the run over both;
        - an entry agreeing on the staged paths only (a different unstaged subject file) is NOT fresh;
        - a mode-only change (`100644` to `100755`) is NOT fresh;
        - two runs NOT combined;
        - a deleted functional test: demanded through `subjectHead`, and not fresh;
        - a MODIFIED path that is in `subjectHead` but not in `subjectIndex` is NOT demanded through
          HEAD (m2);
        - a staged set holding only `openspec/` and `CHANGELOG.md` paths demands nothing and calls
          neither subject thunk (m3, counted by the injected thunks);
        - a removed conformance row (an edit to `conformance.test.mjs`);
        - an entry from another tree ignored;
        - **subject ∩ index paths (Gate 1 round 4, design D1 step 3).** A subject naming a path the
          index does not hold (`scripts/conductor.mjs`, which `engineSourceFiles()` always names and
          the hook fixture writes but never tracks) yields a manifest WITHOUT that path, and an entry
          over the index's paths alone is fresh. A pure `manifestOf({ subject, indexEntries })`
          carries the intersection, so the unit rung can pin it.
          Why the intersection and not tracking `conductor.mjs` in the fixture: the fixture is one
          caller, and the rule is general. Any derivation over an index can name a path the index
          lacks, and that path has no mode or blob a manifest could record, so the rule belongs in
          the one function every caller shares.

      RED `red-2.1.txt`. Certify functional by hand before this commit (B9).
      Verify: each scenario is one named test.
- [x] 2.2 **TDD, FILE rung** (`assert/drift-script.test.mjs`): the record directory.
      - **The RED:**
        - `writeManifestEntry()` names the file by the manifest's sha256 and creates it through a
          unique temp name plus rename;
        - two writers interleaved through an injected `io` both survive whole ("Concurrent writers
          lose no entry");
        - pruning keeps the newest 50 by `ranAt` and never the entry just written;
        - pruning removes a `*.tmp` older than 1 hour and keeps a younger one, and removes a
          `pm-certify-run.*` directory older than 24 hours and keeps a younger one (Gate 1 M6);
        - a manifest with no test file of its bucket is refused.
      - **The GREEN.**
        - `certification.mjs` gains the writer, the reader (`readEntry(commonDir, bucket, key)`,
          where an absent directory or file is no entry) and the pruner.
        - `readRecord`/`writeEntry` for the single file are deleted in 2.4, not here.

      RED `red-2.2.txt`. Certify functional by hand before this commit (B9).
- [x] 2.3 **TDD, FILE rung**: migration (D5, Gate 1 B5: the formats coexist).
      - **The RED:**
        - a common dir holding only `pm-suite-certification.json` yields ZERO entries;
        - `writeManifestEntry()` leaves that file byte-identical;
        - a fresh clone (no directory) demands a run only when a subject path is staged.

      RED `red-2.3.txt`. Certify functional by hand before this commit (B9).
- [x] 2.4 **The switch, ONE commit** (L2).
      - **Drift.** `drift.mjs` reads modes and blob ids with `ls-files -s`, derives the subject from
        the index AND from HEAD (`ls-tree -r -z HEAD`, `show HEAD:<path>`), and judges freshness
        with 2.1. `PERMITTED_SUBCOMMANDS` gains `ls-tree`, and the pin at
        `assert/drift-script.test.mjs:312` moves with it.
      - **ONE manifest entry point (Gate 1 round 4, T2; design D1 "Content identity").** `drift.mjs`
        exports `indexManifest(root, bucket, { indexFile })`: the bucket's subject derived over the
        index at `indexFile` (the inherited index when omitted), intersected with that index's paths
        (2.1), with modes and blob ids from `ls-files -s` under the same `GIT_INDEX_FILE`; it returns
        `{ subject, manifest, key }`. Its three callers are drift's freshness check, certify
        (`indexFile` = its index copy) and `seedAgreeingEntry()`. 1.1's `ls-files -s` element leaves
        `indexRunPlan()` in this commit, and `unit/certify-index.test.mjs` moves with it.
      - **`indexFile` reaches EVERY read (Gate 1 round 5, X1).** Today `gitRead(root, args)`
        (`drift.mjs:54-60`) and `indexReaders(root)` (`drift.mjs:120-131`) read only the index the
        process inherited, so an `indexFile` that stopped at `ls-files -s` would pair ONE index's
        modes and blobs with ANOTHER index's subject. The edit:
        - `gitRead(root, args, { indexFile } = {})` runs git with
          `env: { ...process.env, GIT_INDEX_FILE: indexFile }` when `indexFile` is given (an
          absolute path; a relative one is refused, because `-C root` would re-anchor it), and
          inherits otherwise. It stays the file's ONE `execFileSync`.
        - `indexReaders(root, { indexFile } = {})` passes it to its `ls-files -z` (`:121`) and to
          every `show :<path>` its `readFile` makes (`:130`), so the subject derivation's listing
          AND the bytes it judges (`certifiedModules()` admits a module by its `gitOps(` text) come
          from the same index.
        - `indexManifest(root, bucket, { indexFile })` passes `{ indexFile }` to every git read it
          makes: `ls-files -s` and `indexReaders()` for subject(index). The subject(HEAD) reader
          lives BESIDE it (the lazy thunk in `bucketDemanded`, design D1 step 2) and takes the same
          `{ indexFile }` for its `ls-tree -r -z HEAD` / `show HEAD:<path>` reads, which read no
          index but take it anyway so no read is on the inherited index by omission.
        - Drift's own freshness caller passes nothing (the hook hands it `GIT_INDEX_FILE` already,
          `pre-commit:155`); `stagedFiles()` (`drift.mjs:90-92`) and `trackedTestFiles()`
          (`:81-84`) stay on the inherited index, which is the index drift judges. Certify passes
          its index copy, and `seedAgreeingEntry()` the index its commit is made from (4.3).
        - The pin at `assert/drift-script.test.mjs:305-321` moves: `PERMITTED_SUBCOMMANDS` gains
          `ls-tree` (`:312`), `execFileSync(` still counts ONE, and `GIT_INDEX_FILE` occurs in
          `drift.mjs`'s CODE (comments stripped with `js-lexer.mjs` once 3.1 lands; before it, a
          line-comment filter) only inside `gitRead()`.
        - **RED, FUNCTIONAL** (`functional/drift-script`, twin edited; it needs two real indexes). In
          a scratch repository whose `.git/index` stages `scripts/lib/a.mjs` WITHOUT a `gitOps(`
          call, a second index file (a copy of `.git/index`, then `update-index --add --cacheinfo` under
          `GIT_INDEX_FILE`) stages `scripts/lib/a.mjs` WITH one and a functional file the first
          lacks, which IMPORTS `../../lib/a.mjs`. The import is load-bearing: at L2 `a.mjs` is
          admitted by its `gitOps(` text (`certifiedModules()`), and from 3.3 by the import closure
          (`functionalSubject()`), so the case discriminates by index at BOTH landing steps and 3.3
          needs no rewrite of it (3.3 re-runs it; its `certify functional` must stay green). `indexManifest(root, "functional", { indexFile: <second> })` returns a `subject`
          holding `a.mjs` (admitted by the SECOND index's bytes) and the functional file, and a
          `manifest` whose blob for `a.mjs` is the second index's (`git hash-object` of its bytes),
          not the inherited one's. Omitting `indexFile` returns the first index's subject and blobs.
          Mutation: dropping `{ indexFile }` from the `indexReaders()` call alone makes the case fail
          (the subject loses `a.mjs` while `ls-files -s` still follows the second index).
        Verify: `rg -n '"-s"' scripts/test --glob '!*.test.mjs'` finds an `ls-files -s` argv only in
        `indexManifest()`. `drift.mjs` stays import-safe (its CLI runs only
        under `invokedDirectly`), so certify importing it, and `assert/certify-count.test.mjs:15`
        importing certify, still spawn nothing.
      - **The interim subject** (design D7 L2 row, B9). Both certify and drift derive it from the same
        index, as path classes: the functional subject is `certifiedModules()` plus every tracked
        file under `scripts/test/functional/` and `scripts/test/fixtures/`, plus
        `scripts/test/{certify,certification,drift,js-lexer}.mjs` (`js-lexer.mjs` from 3.1 on, when
        `certification.mjs` starts importing it; before that the index holds no such path and the
        intersection drops it); the sweeps subject is `engineSourceFiles()`
        plus every tracked `scripts/test/sweeps/*.mjs` and `scripts/test/js-lexer.mjs` (RED: staging
        only `sweeps/output-interpolations.mjs` demands a sweeps run). Never "the files it ran", which drift cannot derive.
      - **Certify.** `certify.mjs` writes manifests, prunes, and leaves the old file alone (D5).
      - **What is deleted** from `certification.mjs`, in the same commit:
        - `recordRefusals`'s dangling-entry and dangling-covers branches;
        - `coversFor`;
        - `conformanceRows`;
        - `moduleEntry`;
        - `triggerEntry`;
        - `readRecord`;
        - `writeEntry`;
        - `RECORD_NAME`;
        - `contentHash()` (`certification.mjs:222`) and `stagedHash()` (`:232`), and drift's
          `hashStaged` closure (`drift.mjs:159-170`): freshness is the `ls-files -s` manifest now,
          so nothing hashes bytes; their importer `functional/drift-script.test.mjs:30,65` moves in
          this commit (round 2 m7). With them go drift's `crypto` import (`drift.mjs:34`, whose only
          use is `:163`) and `stagedReader()` (`drift.mjs:94-105`, whose only caller is `:149`,
          feeding `hashStaged`) (Gate 1 round 4);
        - `ENGINE_SOURCE` (`certification.mjs:39`) as a bucket id: the buckets are `functional` and
          `sweeps`, the record's directory names, so `certify.mjs:51` (the bucket-to-directory
          special case), `:132`, `:142`, `:144` and `drift.mjs:39` use `"sweeps"`, and
          `assert/drift-script.test.mjs:36,187,193,203,395,403,417,453-454,464` move with it (m7);
        - `certifiedSet()` (`certification.mjs:211-216`), whose `ENGINE_SOURCE` entry
          (`:214`) is the last use of that id (Gate 1 round 3, R3). Drift stops using it once the
          interim subject lands, so it retires here and not in 3.3. Its importers move in this
          commit: `drift.mjs:39,146`, `functional/drift-script.test.mjs:30,58` (already moving,
          above), and `assert/drift-script.test.mjs:36` (the `certifiedSet` name only;
          `certifiedModules` stays until 3.3), `:186` and `:393`. `certifiedModules()` and
          `engineSourceFiles()` STAY: the interim subjects are built from them.
        - `describeRefusal()`'s `stale-record` wording (`certification.mjs:489-493`, "the certified
          … module '<id>'"): rewritten to name the bucket, the staged subject paths and the run, and
          its `dangling-*` cases go with the branches above; `assert/drift-script.test.mjs:154,408,410`
          move with it (m7);
        - the dead exports `KIND_MODULE`, `KIND_TRIGGER` (`certification.mjs:35-36`) and
          `CONFORMANCE_ID` (`:47`), with its re-import and re-export in `certify.mjs:36,173`, and
          their uses in `assert/drift-script.test.mjs:41,331,358,378-379,395-396,406-407,418,430,433,454,464`.
          Verify: `rg -n "KIND_MODULE|KIND_TRIGGER|CONFORMANCE_ID|ENGINE_SOURCE|certifiedSet|contentHash|stagedHash" scripts`
          returns nothing.
      - **Stale wording, same commit** (Gate 1 B6/B7): `drift.mjs:21-24` (check 4's "certified
        module … contentHash … dangling ids"); `certify.mjs:13-16,25,155` ("records every certified
        module", "touching a certified module"); `.githooks/pre-commit:128-130` (freshness as a
        "certified module … contentHash") and `:136-137` (the four subcommands as "the whole of its
        access"). `.githooks/pre-commit` is NOT in the interim subject (it enters with 3.3's named-literal
        rule); this commit's certify is demanded anyway because it stages `drift.mjs`. Also (Gate 1 round 4): `drift.mjs:114-118`, `indexReaders()`'s comment, whose
        "carries no ROWS table" clause names the retiring `conformanceRows`; its `certifiedModules`
        clause (`:116`) and "calls no gateway" stay true until 3.3 rewrites them.
      - **Stale tests over the old record, same commit** (Gate 1 round 4), each rewritten against
        the manifest record or deleted with the function it tests, `assert/drift-script.test.mjs`:
        - `:133-266`, check 4's tests over `contentHash` records (`:138`, `:159`, `:170`, `:213`,
          `:231`, `:266`);
        - `:333` and `:363`, `moduleEntry()`'s and `triggerEntry()`'s `contentHash` assertions;
        - `:378-383`, the `writeEntry()`/`readRecord()` atomic-merge test (replaced by 2.2's
          interleaved-writers test);
        - `:390`, the G-M1 comment quoting "the certified module 'engine-source'";
        - `:430-433`, `writeEntry()`'s EMPTY-covers refusal (replaced by 2.2's "no test file of its
          bucket" refusal).
      - **Tests.** `functional/drift-script.test.mjs` (its `RECORD_NAME` writer at `:78`, and its
        `certifiedSet`/`contentHash` import at `:30`) and its twin move to the directory format in
        the same staged diff.
      - **Hook fixtures that stage a subject path (Gate 1 round 3, R2; design D7, "Hook-fixture
        tests under the new gate").** From this commit a fixture's own pre-commit hook runs the new
        drift, which refuses a staged subject path with no agreeing entry.
        - **The helper (Gate 1 round 4, T2).** `seedAgreeingEntry(cwd, bucket, { indexFile })` in
          `fixtures/helpers.mjs` calls drift's `indexManifest(cwd, bucket, { indexFile })` and
          writes the `manifest` it returns with `writeManifestEntry()`. It parses no `ls-files -s`
          output and derives no subject itself, so its key is drift's key for that index by
          construction (design D7, "Hook-fixture tests under the new gate", including what that
          construction does not cover). `runHookAgainstFixture` takes `seed: [<bucket>, …]` and
          calls it after `setup`.
        - **Moved, because each would be refused:** `functional/conductor-09.test.mjs` G-I3
          (`:332-367`, stages `functional/marker.test.mjs`, seeds `functional`) and 1.3
          (`:490-518`, stages `sweeps/marker.test.mjs`, seeds `sweeps`). G-I3's comment
          (`:333-336`) cites "A commit that touches nothing certified runs the assertion half
          only", which a seeded commit staging a functional file no longer is: it is re-cited to
          "A commit that touches a certified module requires a fresh functional result" ("It does
          not start that run itself") and "The gate stays fast".
        - **Re-run, not changed:** IX-i (`:694`), IX-j (`:713`) and IX-k (`:731`) stage subject
          paths and expect a refusal naming the id or module; drift prints every refusal in one
          ABORT, so each still sees its own. If any does not, it seeds too.
        - **IX-j is re-run asserting WHICH bucket refused** (Gate 1 round 4; design D7). Here its
          `scripts/lib/zz-probe.mjs` is in both interim subjects, so it asserts a functional AND a
          sweeps freshness demand, each naming `zz-probe.mjs`. Its title becomes "IX-j drift judges
          the STAGED engine: a module staged and deleted from disk still demands its buckets"
          (it drops "uncertified module"); the twin is edited in the same staged diff.
        - **Found how.** `rg -n "runHookAgainstFixture" scripts/test` (only `conductor-09` and
          `fixtures/helpers.mjs` call it), then every `extraFiles` key, `withFixture` path and
          `setup` add in those calls checked against both interim subjects. Paste the `rg` output
          and the per-test verdict into `evidence-2.4.txt`.
        - **Twins.** `conductor-09` and the helper change before L4, so `conductor-09`'s twin
          (`assert/` or `unit/conductor-09.test.mjs`) is edited in the same staged diff.
      - **The deletion case (Gate 1 B2), RED then GREEN in this commit.** A new
        `functional/drift-script` test: in a fixture repository whose record holds a passing entry
        for its current subject, `git rm` a functional test file and run drift; it is refused with a
        functional demand. RED `red-2.4.txt`, against the pre-switch drift, where the deletion
        passes because no entry's `covers` names the deleted id.

      Before committing, run the new certify for BOTH buckets over the staged commit.
      Verify: the commit passes its own hook. `ls "$(git rev-parse --git-common-dir)"` shows
      `pm-suite-certification.d/` AND the untouched `pm-suite-certification.json`. Paste both into
      `evidence-2.4.txt`.
- [x] 2.5 **REGRESSION GUARD, FUNCTIONAL** (`functional/drift-script`, twin edited): the second
      failure mode of #226, reproduced.
      - **The setup.** Two linked worktrees of one fixture repository. Worktree B certifies content
        that includes a functional test file only B has. Worktree A certifies its own content and
        commits.
      - **The assertion.** A's drift accepts. Then the reverse order is tried.
      - **The mutation.** Restore "resolve covers of every entry" in a scratch copy; A must be
        refused.

      `mutation-2.5.txt`. The worktrees are removed and `git worktree prune` is run in a `finally`,
      and the test asserts `git worktree list` holds only the main tree afterwards.

## 3. L3: the observed functional subject (design D3; MODIFIED "The suite has two halves…"; ADDED "The functional subject's derivation…")

- [x] 3.1 **TDD, UNIT**: `functionalSubject({ readdir, readFile })`, over an injected index reader.
      This commit stages `certification.mjs`, which the interim subject holds from 2.4, so the gate
      itself demands a functional certify (B9); run it first.
      - **The RED:**
        - an engine module that is imported but makes no gateway call is IN (the b4ffe164 shape:
          `archive-gate.mjs`);
        - `.githooks/pre-commit` and `hooks/hooks.json` are IN when a closure test spells their
          names;
        - `scripts/test/{assert,unit}/*` are OUT unless executed (below), even when named;
        - `commands/`, `skills/`, `agents/`, `hooks/` and `.claude-plugin/` are wholly IN when a
          closure file under `scripts/test/` spells the root, and `README.md`, `CLAUDE.md` and `docs/parity-ledger.json` when one spells
          the name;
        - `openspec/`, `.conductor/`, `CHANGELOG.md` and the rest of `docs/` are OUT, even when named;
        - a literal dynamic `import("…")` is followed;
        - a bare side-effect `import "../fixtures/hermetic-git.mjs"` is followed (Gate 1 M1);
        - a non-relative specifier is not;
        - **an executed assertion file is IN, with its imports (round 2 C1):** a closure file
          holding `{ file: "assert/parity.test.mjs" }` (the `temp-dir-cleanup.test.mjs:64` shape)
          puts `scripts/test/assert/parity.test.mjs` and every file it imports in the subject;
        - a twin named only in a comment (`` // Its assertion twin is `assert/git-shim.test.mjs` ``)
          stays OUT;
        - **comments are stripped before the executed-file match (Gate 1 round 3, R4):** a twin
          named in a comment WITH quotes (`// runs "assert/parity.test.mjs"` and the `/* … */`
          form) stays OUT, while the same quoted path in code is IN; a RED case proves a string
          holding `//` (`"http://x"`) is not cut short.
      - **The lexer (Gate 1 round 4, T1; design D3, "The tokenizer").** No new tokenizer is written.
        - **The move, in this commit.** `lex()` and `KEYWORDS_BEFORE_REGEX` move from
          `scripts/test/sweeps/output-interpolations.mjs:78-146` to a new
          `scripts/test/js-lexer.mjs`. Call sites: the definition (`output-interpolations.mjs:79-80`)
          becomes an import, and its twelve uses (`:296`, `:315`, `:316`, `:348`, `:372`, `:423`,
          `:450`, `:456`, `:464`, `:499`, `:520`, `:550`) keep their text; the new importers are
          `certification.mjs`'s comment stripper and, in 3.2, `nodeOptionsRefusals()`. `lex()` gains
          two ADDITIVE results, `comments` (the ranges it skipped) and `misparse`, which the sweep
          ignores. Found with `rg -n "\blex\(|KEYWORDS_BEFORE_REGEX" scripts`; paste it into
          `red-3.1.txt`.
        - **Fail closed.** `misparse` records a quoted string or a regex literal meeting an
          unescaped newline, an unterminated `/*`, and input ending inside a string, template,
          `${…}` or regex. `certification.mjs` throws on any, naming the file and line.
        - **The hook fixture needs the module.** `fixtures/helpers.mjs:351-353` copies
          `scripts/test/{drift,certification}.mjs` into every hook fixture, and IX-k
          (`functional/conductor-09.test.mjs:731`) tracks the same two through `extraFiles`. Both
          gain `scripts/test/js-lexer.mjs` here, or every hook fixture's drift fails to load
          (`conductor-09`'s twin is edited in the same staged diff).
        - **The sweep is inside its own subject.** From 2.4 the sweeps subject holds every tracked
          `scripts/test/sweeps/*.mjs` and `scripts/test/js-lexer.mjs`, so this commit (which moves the
          sweep's lexer) demands a sweeps run mechanically: `node scripts/test/certify.mjs sweeps`
          over the staged commit before committing.
        - **REDs, UNIT** (`unit/certify-index.test.mjs`), each against the round-3 tokenizer:
          - built from `functional/conformance.test.mjs:470-472` (the regex
            `/process\.on\(\s*["'`]exit["'`]/` and its message) followed by
            `// runs "assert/parity.test.mjs"`: the path is OUT (the round-3 tokenizer opened a
            string at the regex's `"` and kept the comment as string text, so it was IN);
          - built from `functional/output-text-integrity.test.mjs:185` (the regex
            `/md\.push\(\s*(["'`])\|/g`, whose backtick opened a round-3 template) followed by the
            same comment: OUT, where round 3 read it IN;
          - `const a = "abc` + newline + `run("assert/parity.test.mjs");` is REFUSED as a misparse,
            naming line 1, rather than read.
          Probed on 2026-09-28 with scratch copies of both tokenizers: each of the three is
          discriminated as stated.
        - **Whole tree, FUNCTIONAL twin case** (`functional/certify-index`; the unit rung reads no
          path): the shared lexer over every tracked `.mjs`/`.cjs`/`.js` file under `scripts/`
          (the engine, `scripts/lib/`, and every file under `scripts/test/`, both halves and the
          fixtures included), read with `git show :<path>`, reports ZERO misparse. Measured under
          this design: 0 of 70 files under `scripts/test/{functional,fixtures,sweeps}/` at c96240ab,
          and 0 of 300 over every tracked `.mjs`/`.cjs`/`.js` file under `scripts/` at 59461425
          (Gate 1 round 5, `gate1-fix5/whole.mjs`). The round-3 tokenizer, by the same newline scan,
          lost parity in 13 files under `functional/` and `fixtures/`. A zero here does NOT cover
          the statement-position regex misread (design D3 (b), spec's fourth stated limit), which
          records no misparse.

      RED `red-3.1.txt`.
- [x] 3.2 **TDD, FUNCTIONAL** (`functional/certify-index`, twin edited): the run-time observer.
      The interim subject holds the fixtures and `certify.mjs`, so the gate demands a functional
      certify for this commit (B9); run it first.
      - **The RED.**
        - A fixture functional test reads a tracked `scripts/` file through a path assembled at run
          time. Certify refuses naming that file and writes no entry.
        - With the derivation complete, certify writes its entry.
        - A read of `openspec/changes/archive/` (the record, excluded by rule) does NOT refuse.
        - **The observer bypass (Gate 1 B4).** A fixture test starts a Node child with
          `env: { ...process.env, NODE_OPTIONS: "--require <x>" }`, the shape of
          `functional/conformance.test.mjs:210`. Certify FAILS CLOSED naming the test file and the
          child's argv, and writes no entry.
        - A fixture test that starts `node --version` is NOT refused (it loads no code, so it never
          reports), and one that starts `node -e ""` reports and is not refused.
        - Two Node children observed at once each leave their own observation file, and both are
          read.
        - **Token rule (round 2 m1).** A spawn of `node` that fails to start (a `cwd` that does not
          exist, so `spawnSync` returns `r.error` and `spawn` emits `error`) cancels its expectation
          and is NOT refused. A Node child whose code is `process.exit(0)` as its first statement
          has still arrived, because the arrival is written synchronously at observer load.
        - **Self-exclusion (m9).** The report of a passing run never lists
          `scripts/test/fixtures/observe-reads.mjs`, and the observer that loaded is the run
          directory's copy (the fixture asserts `import.meta.url` lies under the run directory).
        - **The static guard's shapes (round 2 I3), UNIT, in `unit/certify-index.test.mjs`:**
          - negative: the real text of `fixtures/future-clock.mjs` (its `:6` comment carries
            `NODE_OPTIONS="--import …"`) is NOT refused;
          - negative: `"NODE_OPTIONS: --require x"` as a string in prose is NOT refused, nor is
            `x == "NODE_OPTIONS"`, nor `env.NODE_OPTIONS === y`;
          - positive, round 3: the TWO syntactic shapes (design D3), each with a value not carrying
            `process.env.NODE_OPTIONS`, are refused, and each carrying it is not. The object key:
            bare `NODE_OPTIONS:`, double-quoted `"NODE_OPTIONS":`, single-quoted `'NODE_OPTIONS':`,
            and a key overriding `...process.env`. The property assignment: `env.NODE_OPTIONS =`,
            `env["NODE_OPTIONS"] =` and `env['NODE_OPTIONS'] =`. The quoted forms are positive
            because a string in key or subscript position is CODE;
          - the tokenizer's order: `"a // b"; NODE_OPTIONS: "x"` is refused (the `//` is inside a
            string, so the key after it is still code), and `/* NODE_OPTIONS: "x" */` is not;
          - whole tree: run over every tracked file under `scripts/test/{functional,fixtures}/`
            (read through `git show :<path>` in a FUNCTIONAL twin case, since the unit rung reads
            no path), it flags exactly `functional/conformance.test.mjs:210` at c96240ab (its RED,
            read with `git show c96240ab:<path>`) and nothing over the staged index after the fix
            below.
      - **Two tree edits, BEFORE the report-only run (Gate 1 round 3), both functional files, so
        each twin is edited in the same staged diff (no trailer exists before L4).**
        - **The fix.** `functional/conformance.test.mjs:210` appends:
          `${process.env.NODE_OPTIONS ?? ""} --require …`. It lands first, because without it that
          test's child drops the observer and the report-only run below cannot see what it reads.
          Its twin is `unit/conformance.test.mjs` or `assert/conformance.test.mjs`.
        - **The built-path read (R1).** `functional/conductor-14.test.mjs:229` builds
          `rules-0.26.0-${name}.txt`, which reaches `fixtures/rules-0.26.0-github-scoped.txt` and
          `-scopeless.txt`, named by no closure file. Replace the template with the three file
          names spelled as literals (for example a map from `"github-scoped"`,
          `"github-scopeless"` and `"jira-scoped"` to `"rules-0.26.0-github-scoped.txt"`,
          `"rules-0.26.0-github-scopeless.txt"` and `"rules-0.26.0-jira-scoped.txt"`), so the
          named-literal rule admits them. Its twin is `unit/` or `assert/conductor-14.test.mjs`.
          This is the ONLY built-path read of a tracked out-of-subject file the mechanical sweep
          found (design D3, "Reads by a built path"); any later one gets the same treatment.
          Verify: after the edit, `functionalSubject()` over the staged index holds both files.
      - **Before the GREEN: the observer, report-only, over the REAL tree (round 2 C1).** With the
        observer built, its refusal not yet armed, and the two edits above staged, run the
        functional half of THIS repository under it (from a shared clone of the staged index, as
        certify will) and write every observed tracked path outside `functionalSubject()` to
        `observer-report-3.2.txt` in this directory, with the command that produced it.
        Expected (round 3): NOT none. The record reads the rule excludes, each marked "excluded by
        rule": at least `openspec/changes/archive/` (`conductor-15:1335-1436`), `.conductor/state.json`
        (the live-record reads `conductor-15:806` and `conductor-18:21`, Gate 1 round 4) and
        `CHANGELOG.md` (`conductor-37:256`, and the engine through `plugin-meta.mjs:33`). Any other path under a
        subject root is a derivation gap, fixed in `functionalSubject()` (with a 3.1 RED for it)
        before the GREEN lands, and the file says so. A path outside every subject root and the
        record (`.claude/`, `.github/`, `PROJECT.md`, …; none expected by the static search) cannot
        be admitted by a derivation fix, because the root list is closed: STOP and raise it with
        the orchestrator.
      - **The GREEN.**
        - `scripts/test/fixtures/observe-reads.mjs` (new), loaded through
          `NODE_OPTIONS=--import`. It records module resolutions, `fs` reads and `child_process`
          script paths under the run directory, each process into its own file. It patches
          `node:child_process` and calls `module.syncBuiltinESMExports()`, so a direct Node child gets
          a `PM_OBSERVE_TOKEN` and is expected to report (design D3).
        - `certify.mjs` compares the observations with `functionalSubject()`, and every expected
          token with the arrivals.
        - **The static guard.** A pure `nodeOptionsRefusals(files)` in `certification.mjs` refuses
          any file under `scripts/test/{functional,fixtures}/` that assigns `NODE_OPTIONS` a value
          not carrying `process.env.NODE_OPTIONS`. UNIT test (`unit/certify-index.test.mjs`) over
          file texts handed to it; its RED input is today's `conformance.test.mjs:210` line.
          `certify.mjs functional` applies it to the exported run directory before the bucket runs,
          and fails closed on a refusal, so the guard reads the real index copy. It tokenizes with
          the shared `lex()` of `scripts/test/js-lexer.mjs` (3.1), and throws on any `misparse`.
        - **Its stated limits** (spec, "It has four stated limits"): an indirect Node child whose
          `NODE_OPTIONS` is assembled at run time, or whose environment OMITS the variable (an
          `env` that does not spread `process.env`, or a `delete`), is not observed and not
          refused; and an assignment inside a statement-position regex misread (a regex after `)`
          or `}` that closes on its own line, design D3 (b)) is not refused, because `lex()`
          records no misparse for it. No test asserts otherwise.

      RED `red-3.2.txt`.
- [x] 3.3 **The switch, ONE commit** (L3).
      - **Drift.** `drift.mjs` and `certify.mjs` use `functionalSubject()`.
      - **Retired.** `certifiedModules()` (`certification.mjs:191-201`) and `ENGINE_ENTRY`'s
        special case (`:199`) retire. (`certifiedSet()` already retired in 2.4, Gate 1 round 3
        R3.) `certifiedModules()`'s importers move to `functionalSubject()` in this commit:
        `certify.mjs:36,120` and drift's interim functional subject (both built from it since
        2.4), `assert/drift-script.test.mjs:36` (with its uses at `:281`, `:441`, below), and
        `seedAgreeingEntry()` (`fixtures/helpers.mjs`, 2.4), which reaches the subject only through
        drift's `indexManifest()` and so moves to `functionalSubject()` with drift in this commit
        with no edit of its own; its seeded G-I3 and 1.3 cases re-run here (Gate 1 round 4).
        - **IX-j re-run** (`functional/conductor-09.test.mjs:713`): nothing imports its
          `scripts/lib/zz-probe.mjs`, so from this commit it is outside `functionalSubject()` and
          only the sweeps bucket demands. The test asserts a sweeps freshness demand naming
          `zz-probe.mjs` and NO functional demand (design D7); the twin is edited in the same staged
          diff.
        - **X1's two-index case re-run** (`functional/drift-script`, 2.4): its functional file imports
          `a.mjs`, so `functionalSubject()` still admits `a.mjs` from the second index only; it passes
          unedited here (Gate 1 confirmation review).
        - **Stale comment:** `drift.mjs:116-118` (`indexReaders()`: "`certifiedModules` needs
          `scripts/lib/` to read as empty", "calls no gateway") is rewritten for the observed
          subject (Gate 1 round 4).
        Verify: `rg -n "certifiedSet|certifiedModules" scripts` returns nothing outside
        `scripts/lib/store.mjs`'s comment, which 3.4 rewrites.
      - **Tests.** `assert/drift-script.test.mjs`'s `certifiedModules` tests (`:281`, `:441`) are
        rewritten against the subject.
      - **Stale wording** (Gate 1 B6): `fixtures/helpers.mjs:347` ("derive an empty certified set")
        is rewritten for the observed subject. The "diff coupling" wording in
        `assert/conductor-09.test.mjs:205`, `drift.mjs:20` and `.githooks/pre-commit:127,157` stays
        TRUE until coupling leaves the pre-commit run, so it moves in 4.3, not here.

      This commit stages `certification.mjs`, which is in the closure, so run `certify functional`
      over the staged commit first.
      Verify: the commit passes its own hook. Then run `measure.mjs` again over `HEAD~1..HEAD` and
      paste it: the commit demanded the functional half.
- [ ] 3.4 **The stale comment**, `scripts/lib/store.mjs:624-631`. It exists only because the
      `gitOps(` scan counted comments. Rewrite it to say the scan is retired, in the same commit as
      3.3 or the next one. `store.mjs` is in the functional subject, so certify first.
      Verify: `rg -n "certifiedModules" scripts` returns nothing.
- [ ] 3.5 **REGRESSION GUARD, FUNCTIONAL** (`functional/certify-index`, twin edited): the #229
      reproduction, over the REAL tree (Gate 1 M4).
      - **The guard.** `functionalSubject()` is derived over this repository's own index
        (`git ls-files -s` and `git show :<path>` in `REPO`), never an injected reader. With
        b4ffe164's two changed paths (`scripts/lib/archive-gate.mjs`, `scripts/lib/store.mjs`)
        taken as staged and no agreeing entry, the result is a functional DEMAND.
      - **Why the index and not `git ls-tree b4ffe164`.** b4ffe164 is reachable only from the tag
        `presquash/pr-234` (`git branch -a --contains b4ffe164` lists nothing), so a clone without
        that tag cannot read it.
      - **The mutation.** Restore the `gitOps(` derivation in a scratch copy; the guard must fail.

      `mutation-3.5.txt`.

## 4. L4: coupling in the commit-msg hook, with a declared exemption (design D4; MODIFIED "Every functional test has an assertion twin…", "The pre-commit gate checks the record…")

- [ ] 4.1 **TDD, UNIT**: `parseTwinExemptions(parsedTrailers)`, over the OUTPUT of
      `git interpret-trailers --parse --no-divider` (design D4, Gate 1 B3, round 2 I2). git decides
      what is a trailer; this function only reads the `Twin-Unchanged` lines git returned.
      - Only `Twin-Unchanged` keys are read; other trailers are ignored.
      - **The split (round 2 I1).** The id is the value's first whitespace-delimited token, and it
        must be followed by a spaced separator ` — `, ` -- ` or ` - `; the reason is the rest.
      - RED cases: a hyphenated id, `Twin-Unchanged: conductor-09 — r`, yields id `conductor-09`;
        a reason containing `-`, `Twin-Unchanged: conductor-09 - a change - comment only`, yields
        reason `a change - comment only`; `Twin-Unchanged: conductor-09-r` (no spaced separator)
        yields id `conductor-09-r` with an empty reason.
      - An empty reason is kept as empty, so 4.2 can refuse it.

      RED `red-4.1.txt`.
- [ ] 4.2 **TDD, UNIT**: `couplingRefusals()` takes `exemptions`.
      - **The RED:**
        - a declared, staged id passes without its twin;
        - a declared id whose functional file is NOT staged is refused, naming it;
        - an empty reason is refused, naming it;
        - an undeclared id is refused exactly as today;
        - with `isMerge: true`, nothing is refused (the merge rule; `commit-msg-probe.log`, merge probes);
        - with no phase (Gate 1 M5), all four checks run, and coupling uses no exemptions when no
          message is given.

      RED `red-4.2.txt`.
- [ ] 4.3 **TDD, FUNCTIONAL** (`functional/conductor-09`, twin edited): the two hooks.
      - **Seeding (Gate 1 round 3, R2).** Every case below stages a functional file, which is in
        the functional subject, so pre-commit refuses it for freshness and commit-msg never runs
        unless the fixture's record agrees. Each case, accepted or refused, therefore seeds with
        2.4's `seedAgreeingEntry()` over the index its commit is made from: `.git/index` for a
        plain commit and the linked worktree's own index there; for `-a` a copy of the index
        updated with `add -u`; for `<path>` an index from `read-tree HEAD` plus `add <path>`. This
        is what makes the spec's accept scenarios reachable ("A declared subject-free change passes
        without its twin", spec `:217-221`; "A merge that brings in an exempted change is not
        refused", `:243-248`), and what lets each refusal come from commit-msg rather than from
        pre-commit's freshness check.
      - **Every REFUSED case proves which hook refused (Gate 1 round 4, T2).** Each asserts BOTH
        (1) that pre-commit's success line was printed (`pre-commit: <n>/<n> passing`, after the
        pre-commit phase's `drift: ok —` line), so the seed agreed and pre-commit passed, and
        (2) that the refusal text is commit-msg's coupling line, naming the id and the twin's path
        (`<id> — scripts/test/functional/<id>.test.mjs is staged,
        scripts/test/{assert|unit}/<id>.test.mjs is not`, or the declaration refusal naming the
        id), and not a freshness refusal. A seed that silently disagreed would fail (1), not pass
        as a coupling refusal.
      - **The RED.** In a fixture repository with `core.hooksPath` set to the hooks under test:
        - a staged functional file without its twin and without a trailer is refused by commit-msg,
          and pre-commit's output does not mention coupling;
        - with a trailer, it is accepted and the exemption line is printed;
        - the four commit forms each judge their own index: plain, `-a`, `<path>`, and a linked
          worktree (per `commit-msg-probe.log`);
        - a `--no-ff` merge of a branch whose commit carried a `Twin-Unchanged` trailer is accepted,
          and a squash commit of the same change without the trailer is refused;
        - the same `--no-ff` merge made IN A LINKED WORKTREE is accepted (Gate 1 M3: `MERGE_HEAD` is
          found through `git rev-parse --git-path MERGE_HEAD`, because `.git` is a file there);
        - **trailer parsing is git's (Gate 1 B3).** Each is refused, because git parses no trailer
          from it and the functional file is staged without its twin: a subject-only message; a
          message whose `Twin-Unchanged:` line shares a paragraph with prose; and a `commit -v`
          message whose only `Twin-Unchanged:` line sits after the scissors line. A `commit -v`
          message with the trailer ABOVE the scissors is accepted. For each, the test also asserts
          that `git log --format='%(trailers:key=Twin-Unchanged)'` on an accepted commit yields
          exactly the declarations drift printed.
        - **The `---` divider (round 2 I2).** A message with a `---` line BEFORE the trailer
          paragraph is accepted, and one whose trailer paragraph is followed by a `---` line and more
          text is refused (git parses no trailer there). For both, drift's reading agrees with
          `%(trailers:key=Twin-Unchanged)` on the same message committed with `git commit -F` in a
          second fixture repository that has no hooks installed (`trailer-divider-probe.log`).
        - **The working-tree fallback (Gate 1 round 4).** commit-msg keeps pre-commit's fallback
          (`pre-commit:150-154`): it runs the snapshot's `drift.mjs`, and the working tree's only when
          the index holds none. RED: in a fixture whose index holds `drift.mjs` and whose working-tree
          `drift.mjs` is replaced, unstaged, by `process.exit(0)` (the IX-k shape), a staged
          functional file without its twin is still refused by commit-msg (the fixture also tracks
          `certification.mjs` and `js-lexer.mjs`, which the snapshot's `drift.mjs` imports; design D7,
          "the other replaced-copy case"); and in a fixture whose
          index holds no `drift.mjs` (the `runHookAgainstFixture` default), commit-msg runs the
          working tree's copy and refuses the same commit.
      - **The GREEN, ONE commit** (L4):
        - `.githooks/commit-msg`, new and executable, captures `GIT_INDEX_FILE` as the pre-commit
          hook does, makes `$1` absolute against the directory git ran it in (as `pre-commit:33-34`
          does for the index), and runs the snapshot's drift with
          `--phase commit-msg --message "<absolute path>"`, falling back to the working tree's
          `drift.mjs` only when the index holds none, exactly as `pre-commit:150-154` does;
        - `drift.mjs` gains `--phase`, runs `git interpret-trailers --parse --no-divider <message>`, and finds
          `MERGE_HEAD` with `rev-parse --git-path`. `PERMITTED_SUBCOMMANDS` gains
          `interpret-trailers`, and the pin at `assert/drift-script.test.mjs:312` moves with it;
        - `.githooks/pre-commit` passes `--phase pre-commit`, and its "diff coupling" wording moves:
          `:126-127` (the check list) and `:157` (the abort line); its list of drift's git
          subcommands, `:136-137` ("the whole of its access", which 2.4 already grew by `ls-tree`),
          gains `interpret-trailers`;
        - `drift.mjs:20` (check 3's description), `drift.mjs:231` (the pre-commit ABORT line, "the
          checks are enrolment, twin coverage, diff coupling and record freshness"; round 2 m6) and
          `assert/conductor-09.test.mjs:205` (the assertion message naming "the diff coupling" as the
          hook's) are rewritten in the same commit.

      RED `red-4.3.txt`. Verify: `git ls-files -s .githooks/commit-msg` shows mode `100755`.
- [ ] 4.4 **REGRESSION GUARD, FUNCTIONAL**: coupling runs in exactly one place.
      - **The guard.** With both hooks installed, a violating commit and an agreeing entry seeded
        by `seedAgreeingEntry()` (so pre-commit passes freshness and commit-msg runs), exactly one
        hook's output names the coupling refusal. As in 4.3 (T2), it asserts pre-commit's success
        line was printed and that the refusal is commit-msg's coupling line naming the id and the
        twin's path.
      - **The mutations.** Re-enable check 3 in the pre-commit phase in a scratch copy: the guard
        fails on assertion (1) of 4.3's T2 pair, NOT because the refusal is reported twice. Git runs
        no commit-msg hook after pre-commit exits non-zero, so the coupling refusal appears once,
        from pre-commit, and pre-commit's success line (`pre-commit: <n>/<n> passing`) is never
        printed. Disable it in commit-msg: the guard fails, because nothing refuses and the commit
        is made.

      `mutation-4.4.txt`.

## 5. Required task items (CLAUDE.md "The gate procedure", items 1–7)

- [ ] 5.1 **Call-site completeness sweep** (item 1), recorded in `call-site-sweep-5.1.txt`, every
      list derived with `rg`, never typed.
      - **The callers.**
        `rg -n "certifiedModules\(|certifiedSet\(|recordRefusals\(|couplingRefusals\(|writeEntry\(|readRecord\(|RECORD_NAME|coversFor\(|conformanceRows\(|moduleEntry\(|triggerEntry\(|contentHash\(|stagedHash\(" scripts .githooks .github`
        (at c96240ab: `drift.mjs`, `certify.mjs`, `assert/drift-script`, `functional/drift-script`),
        and every reader of the record path, including the hook's
        `rm -f "$(git rev-parse --git-common-dir)/pm-isolation-flag"` neighbour, CI, and
        `CONTRIBUTING.md`.
      - **The rules.** State where the new freshness rule, the subject derivation and the exemption
        hold, and justify each place they do not. CI is expected to be justified: it runs every
        bucket and reads no record.
- [ ] 5.2 **Data references** (item 1).
      - **Retired.** The OLD record's ids that point at other records (`covers`, `conformanceRows`,
        entry ids keyed on module paths) are retired. Say where each was written (`writeEntry`),
        read (`recordRefusals`) and removed (never; that was #226's second failure mode).
      - **Added.** The NEW manifest holds paths and blob ids. They are content, not references to
        another record, and an entry is removed only by pruning.
      - **The trailer** names a functional id. It is read by commit-msg and by Gate 2 and is never
        stored.
- [ ] 5.3 **Every operation has an inverse** (item 1). Name each, shipped or not:
      - writing an entry: pruning (shipped, D1);
      - the shared-clone build: its removal on exit and on signal (shipped, D2; guarded by 1.2's
        third test);
      - widening the subject: no inverse. The subject is derived, so narrowing it is an edit to the
        tests themselves;
      - declaring an exemption: removing the trailer before the commit is made (amend), and after
        the commit, Gate 2's audit;
      - the old record file: this change neither writes nor removes it (D5, Gate 1 B5). Its removal
        is DEFERRED to a later release, registered by 8.2.
- [ ] 5.4 **Verify against the commit** (item 2). For every task, run `git show --stat <sha>` and
      check that every file the task claims is in THAT commit. Record the results in
      `commit-verification-5.4.txt`. Pay particular attention to:
      - 2.4's and 3.3's switch commits, which each claim drift, certify, certification and two test
        files;
      - 4.3's new `.githooks/commit-msg`, and its mode;
      - every functional test's twin.
- [ ] 5.5 **Declare lifecycle bookkeeping** (item 3). Tasks 8.2 and 8.3 carry
      `<!-- pm:lifecycle -->` on their own lines. They were marked when this source was authored.
      Verify: `rg -n "pm:lifecycle" openspec/changes/certification-record-redesign/tasks.md` lists
      exactly those two task lines.
- [ ] 5.6 **Attribute every commit** (orchestrator) (item 4). Run
      `update-epic certification-record-redesign --attribute-commit <sha>` for each implementation
      commit, in landing order, at the moment it is made. The archive-move commit is NOT attributed.
- [ ] 5.7 **Cross-spec review** (orchestrator) (item 5). This is 0.2. Re-run it when any 0.51.0
      change adds or amends a spec file, and record the verdict again.
- [ ] 5.8 **Disposition** (item 6). It is recorded by 8.2, whose flags are specified there. Before
      Gate 2, check that 8.2 names every non-goal in `design.md` as a declined deferral, or justifies
      it as not being one.
- [ ] 5.9 **Route what the work taught** (item 7), naming which of the three kinds each item is.
      - **PRACTICE.** The staged-certify-before-commit order this change needs while it rewrites its
        own gate. Register it if it recurs outside this change; otherwise say why not.
      - **TOOLING FRICTION.** `openspec` 1.13.2 has no `new change` verb, so this change's directory
        and `.openspec.yaml` were created by hand. File it upstream, or note that it is not pm's.
        Anything else routed around during apply gets `/pm:feedback`.
      - **PROCESS.** Update `docs/lessons/an-uncertified-module-change-skips-the-functional-half.md`:
        its `enforced_in` moves from "habit — no mechanism" to the mechanism 3.3 ships, and its rule
        is rewritten. In the same commit (Gate 1 B7):
        - `docs/lessons/a-one-off-sweep-certifies-only-the-day-it-ran.md:7` (`enforced_in` names
          "check 4 … a certified module's staged content … `contentHash`") and `:35` (the record as
          `pm-suite-certification.json`) are rewritten for the manifest directory;
        - `docs/lessons/a-one-off-sweep-certifies-only-the-day-it-ran.md:39-43` (check 4 as "four git
          index reads" at `:39`, and the quoted refusal "the certified change-triggered bucket
          'engine-source' … the record covers DIFFERENT content") is rewritten for the manifest
          record and the new refusal text (round 2 m10);
        - `docs/lessons/README.md:39` (the trigger row naming `certifiedModules()`) and `:102` (the
          `enforced_in` index row "habit — no mechanism") are rewritten to match.

## 6. Docs

- [ ] 6.1 `CONTRIBUTING.md`.
      - **"Pre-commit hook".** The pre-commit run performs enrolment, twin coverage and freshness.
        The new commit-msg run performs coupling, with the `Twin-Unchanged` trailer, who may use it,
        and that Gate 2 audits it.
      - **"The triggered buckets".** The functional subject is what the half observes, and certify
        runs over the index in a shared clone.
      - **A NEW "Parallel worktrees" section.** Certify and commit per worktree with no lock. Parallel
        certifies are correct and only cost CPU. `pm-suite.lock` stays for machine load. Any
        hand-rolled `pm-certify.lock` is obsolete and should be deleted.
      - **The order (round 2 m4).** Stage exactly, run certify, then a PLAIN `git commit`. A
        `git commit <path>` or `git commit -a` builds its own temporary index, which certify never
        copied, so after a partial stage it is never fresh.

      Verify: `rg -n "pm-certify.lock|Twin-Unchanged|Parallel worktrees" CONTRIBUTING.md` hits each.
- [ ] 6.2 `CLAUDE.md` "Tests:" bullet. It names the drift script's checks and when the triggered
      buckets run. Update it for the commit-msg phase and the observed subject. `CLAUDE.md:31` tells
      a contributor to run a bare `node scripts/test/drift.mjs`, which 4.2 keeps meaning "every
      check". If a re-read shows nothing in it is now false, record that it was checked, with the
      reason, in the commit message of 6.3.
      `CLAUDE.md` IS in the functional subject (design D7 L5, Gate 1 B9), so this commit demands a
      functional certify: run it over the staged commit first.
- [ ] 6.3 `.changesets/certification-record-redesign.md`: contributor-facing bullets only, in
      `CHANGELOG.md`'s style. This change ships nothing to plugin users, so say so in the entry's
      first line. Verify: the release checklist's changeset lint accepts it.
- [ ] 6.4 **Documentation currency** (CLAUDE.md "Commits"). README.md and the Mintlify site
      document the shipped plugin, and this change touches only dev tooling. Record in the PR
      description that the check was made and why neither changes.
- [ ] 6.5 `.claude/skills/pr-workflow/SKILL.md` step 2 (`:28`, Gate 1 B7). It says the hook refuses
      "a certified module's changed content". Rewrite it for the observed subject, and add the
      commit-msg phase: a functional file staged without its twin is refused there unless a
      `Twin-Unchanged: <id> — <reason>` trailer declares the change subject-free; the trailer must be
      a git trailer (its own final paragraph, above any `commit -v` scissors line), and Gate 2
      audits it.
      Verify: `rg -n "certified module" .claude/skills/pr-workflow/SKILL.md` returns nothing, and
      `rg -n "Twin-Unchanged" .claude/skills/pr-workflow/SKILL.md` hits.
- [ ] 6.6 **A NUMBERED Gate 2 step that binds every later epic** (Gate 1 B8), in
      `.claude/skills/pr-workflow/SKILL.md`, beside step 6 ("Record Gate 2 BEFORE the
      squash-merge"): before recording Gate 2, list every `Twin-Unchanged` trailer in `BASE..HEAD`
      with `git log --format='%H %(trailers:key=Twin-Unchanged)' BASE..HEAD`, and judge for each
      whether the declared change left the file's subject untouched; a trailer judged false is an
      Important finding. State in the step that Gate 2 runs on `dev` before the squash into `main`,
      so the squash dropping trailers is harmless.
      Why the skill and not `CLAUDE.md`'s "gate procedure" list: that list is inside the pm-managed
      rules block (`CLAUDE.md:96` onwards), emitted by `scripts/lib/rules.mjs:158,732`. A hand edit
      is overwritten by `/pm:upgrade`, and a `rules.mjs` edit would ship this repository's rule to
      every plugin user (design D4).
      Verify: the step is numbered, and `rg -n "trailers:key=Twin-Unchanged" .claude/skills/pr-workflow/SKILL.md` hits.

## 7. Integration

- [ ] 7.1 **Every test is green on the final tree:**
      - the drift script, both phases;
      - the assertion half, both rungs;
      - `certify.mjs functional` and `certify.mjs sweeps`, each passing and writing a manifest;
      - CI's four steps on the PR.

      Record the counts in `baseline-after.md`, beside 0.3's.
- [ ] 7.2 **The after-measure.**
      - Re-run `measure.mjs` over the 0.50.0 range with the SHIPPED `functionalSubject()`, and over
        this change's own range. Report both against 0.3(a).
      - Run two worktrees of this repository that each certify and commit concurrently, with no
        lock, and paste the transcript.

      Verify: both commits land, and neither worktree re-certifies.

## 8. Close

- [ ] 8.1 **Gate 2**, mode `thorough`: two fresh-context reviewers over `BASE..HEAD`, where HEAD is
      the last attributed commit. They check:
      - spec alignment for every MODIFIED and ADDED requirement;
      - that the manifest agreement uses ONE entry;
      - that certify never writes the working tree, the index, the stash or the worktree list;
      - that the observer's limit is the one the spec states;
      - **the audit of every `Twin-Unchanged` trailer** in
        `git log --format='%H %(trailers:key=Twin-Unchanged)' BASE..HEAD`, judging for each that the
        declared change left the file's subject untouched.

      Fix Critical and Important findings, then record
      `record-gate-review certification-record-redesign --gate 2 --verdict pass --reviewer "<identity>" --base-sha <sha> --head-sha <last attributed sha>`.
- [ ] 8.2 <!-- pm:lifecycle --> **Disposition and tracker close.**
      - **Archive the carrier epic:**
        `update-epic certification-record-redesign --status archived --outcome delivered --reason "<what shipped>"`
        with one `--declined-deferral` per non-goal in `design.md`:
        - `--declined-deferral "running the functional half per commit::it takes minutes; the observed subject decides when it is demanded (design D3)"`
        - `--declined-deferral "replacing pm-suite.lock::it limits machine load, which certification correctness never depended on (design D6)"`
        - `--declined-deferral "an operation-level observation map::a hand-kept list, which the trigger requirement forbids (design D3)"`
        - `--declined-deferral "a CI step listing Twin-Unchanged trailers::optional; Gate 2 on the dev range is the audit of record (design D4)"`

        CI's buckets and the engine are unchanged by design, so they are not deferrals.
      - **The deferred retirement of the old record (Gate 1 B5).** Before archiving, register a
        planned epic for it (`/pm:epic add` with `--status planned`, id
        `retire-single-file-certification-record`), and pass
        `--deferral "retire-single-file-certification-record:design D5"` on the archive command
        above. This task writes no conductor state until 8.2 runs.
      - **The superseded epics.** `gh-cfdude-pm-226`, `-230`, `-229` and `-227` are already
        superseded into this epic. Close each issue with the ship evidence:
        `gh issue close <n> --repo cfdude/pm --comment "Shipped in 0.51.0 by certification-record-redesign: <commit range>."`

      Verify: `gh issue view <n> --repo cfdude/pm --json state` reads `CLOSED` for all four.
- [ ] 8.3 <!-- pm:lifecycle --> **Archive.** Run `/opsx:archive certification-record-redesign`, then
      stage `openspec/` WHOLE, because the archive rewrites `openspec/specs/suite-certification/spec.md`.
      Verify: `openspec validate --specs --strict` passes, and the main spec holds the ADDED
      requirements.
