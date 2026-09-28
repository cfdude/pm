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
    3. then commit.

    Never pass `--no-verify`.
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

- [ ] 0.1 **Gate 1** (orchestrator), review mode `thorough`: two fresh-context lenses over these
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
        - D1's "one agreeing entry" against the split-commit scenario.
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
- [ ] 0.2 **Cross-spec review** (orchestrator) (required task item 5).
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
- [ ] 0.3 **BASELINE, re-measured on the day** into `baseline-before.md`. Never copy it from
      `design.md`.
      - (a) **Trigger frequency.** Run `node openspec/changes/certification-record-redesign/measure.mjs
        . e71c63a3 presquash/pr-234` and paste the JSON. Expect `A_certified_today` 15,
        `B_widenedShippedSurface` 70 and `C_anyEngineModule` 51 of 126. Any difference is explained,
        never rounded away.
      - (b) **Certify timing.** Time `node scripts/test/certify.mjs functional` and `… sweeps` on the
        CURRENT runner, three runs each, with the machine's load average recorded beside each run.
        Run in a scratch clone, so this record is not touched.
      - (c) **The export.** Time the `checkout-index -a` export, and the shared-clone build of D2.
      - (d) **The bare-export failure.** Re-run the functional half from a bare `checkout-index`
        export and list the failing files. This is the evidence for D2's shared clone.
        `functional-in-snapshot.out` is the 2026-09-28 copy.
      Verify: `baseline-before.md` holds all four, each with the command that produced it.
- [ ] 0.4 **Re-read the four tracker items** (#226, #230, #229, #227), with their comments, for the
      superseded epics `gh-cfdude-pm-226`, `-230`, `-229` and `-227`.
      This epic has no `externalId`, so nothing is recorded with `record-tracker-refresh`. Note any
      comment newer than 2026-09-28 in `baseline-before.md`.
      Verify: every item has a line there.

## 1. L1: certify runs over the index (design D2, ADDED "Certification runs over the index…")

- [ ] 1.1 **TDD, UNIT**: the run plan as a pure value.
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

      RED `red-1.1.txt`. Verify: the new unit file passes and the unit rung's fs guard stays green.
- [ ] 1.2 **TDD, FUNCTIONAL** (new id `certify-index`, with its twin `unit/certify-index`): certify
      over a real fixture repository.
      - **The RED.** Build a fixture repository with a partially staged file; certify records the
        STAGED blob. A second test proves an edit made to the working tree mid-run is absent from the
        record, using a bucket stub that edits the file and then passes. A third proves the working
        tree, the index, `git stash list` and `git worktree list` are byte-identical before and after
        a passing, a failing and a SIGTERM'd run.
      - **The GREEN.** `certify.mjs` runs the bucket in the shared clone from 1.1's plan and removes
        it on exit and on INT/TERM/HUP. It STILL writes the old single-file format, now hashed from
        the index copy's bytes.

      RED `red-1.2.txt`.
      Verify: `node --test scripts/test/functional/certify-index.test.mjs`; `certify.mjs functional`
      passes in this repository with a load average recorded; the count equals 0.3(b)'s.
- [ ] 1.3 **REGRESSION GUARD, FUNCTIONAL**: the bucket passes in the shared clone.
      - **The guard.** A test in `functional/certify-index` runs the four files 0.3(d) found failing
        in a bare export (`conductor-13` "16.3", `conductor-15`, `conductor-37`,
        `gate-artifact-evidence`) from a shared clone built by the plan, and asserts they pass.
      - **The mutation.** Build the run directory as a bare export in a scratch copy of `certify.mjs`;
        the guard must fail naming `not a git repository`.

      `mutation-1.3.txt`. Verify: the guard is green in the tree and red in the mutation.

## 2. L2: the content-keyed manifest record (design D1, D5; MODIFIED "A functional result is recorded…")

- [ ] 2.1 **TDD, UNIT**: freshness as agreement with ONE entry.
      - **The pure function.** `manifestAgrees(entry, stagedPaths, indexBlobOf)` and
        `recordFreshness({ bucket, stagedSubjectPaths, entries, indexBlobOf })`.
      - **The RED** (`unit/drift-freshness.test.mjs`, new; no functional twin needed). It covers the spec's
        scenarios:
        - an unchanged module;
        - a changed module;
        - a stale record: none, other bucket, other content;
        - a split across two commits;
        - two runs NOT combined;
        - a deleted functional test;
        - a removed conformance row (an edit to `conformance.test.mjs`);
        - an entry from another tree ignored.

      RED `red-2.1.txt`. Verify: each scenario is one named test.
- [ ] 2.2 **TDD, FILE rung** (`assert/drift-script.test.mjs`): the record directory.
      - **The RED:**
        - `writeManifestEntry()` names the file by the manifest's sha256 and creates it through a
          unique temp name plus rename;
        - two writers interleaved through an injected `io` both survive whole ("Concurrent writers
          lose no entry");
        - pruning keeps the newest 50 by `ranAt` and never the entry just written;
        - a manifest with no test file of its bucket is refused.
      - **The GREEN.**
        - `certification.mjs` gains the writer, the reader (`readEntries(commonDir, bucket)`,
          where an absent directory is an empty record) and the pruner.
        - `readRecord`/`writeEntry` for the single file are deleted in 2.4, not here.

      RED `red-2.2.txt`.
- [ ] 2.3 **TDD, FILE rung**: migration (D5).
      - **The RED:**
        - a common dir holding only `pm-suite-certification.json` yields ZERO entries;
        - the first `writeManifestEntry()` removes that file;
        - a second write with it already absent does not throw;
        - a fresh clone (no directory) demands a run only when a subject path is staged.

      RED `red-2.3.txt`.
- [ ] 2.4 **The switch, ONE commit** (L2).
      - **Drift.** `drift.mjs` reads blob ids with `ls-files -s` and judges freshness with 2.1.
        `PERMITTED_SUBCOMMANDS` is unchanged.
      - **Certify.** `certify.mjs` writes manifests (functional subject = today's `certifiedModules()`
        plus the functional and fixture files it ran; sweeps subject = `engineSourceFiles()` plus
        `scripts/test/sweeps/*`), prunes, and removes the old file.
      - **What is deleted** from `certification.mjs`, in the same commit:
        - `recordRefusals`'s dangling-entry and dangling-covers branches;
        - `coversFor`;
        - `conformanceRows`;
        - `moduleEntry`;
        - `triggerEntry`;
        - `readRecord`;
        - `writeEntry`;
        - `RECORD_NAME`.
      - **Tests.** `functional/drift-script.test.mjs` (its `RECORD_NAME` writer at `:78`) and its
        twin move to the directory format in the same staged diff.

      Before committing, run the new certify for BOTH buckets over the staged commit.
      Verify: the commit passes its own hook. `ls "$(git rev-parse --git-common-dir)"` shows
      `pm-suite-certification.d/` and no `pm-suite-certification.json`. Paste both into
      `evidence-2.4.txt`.
- [ ] 2.5 **REGRESSION GUARD, FUNCTIONAL** (`functional/drift-script`, twin edited): the second
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

- [ ] 3.1 **TDD, UNIT**: `functionalSubject({ readdir, readFile })`, over an injected index reader.
      - **The RED:**
        - an engine module that is imported but makes no gateway call is IN (the b4ffe164 shape:
          `archive-gate.mjs`);
        - `.githooks/pre-commit` and `hooks/hooks.json` are IN when a closure test spells their
          names;
        - `scripts/test/{assert,unit}/*` are OUT even when named;
        - `commands/`, `skills/`, `agents/` and `.claude-plugin/` are wholly IN when a closure file
          spells the root, and `README.md`, `CLAUDE.md` and `docs/parity-ledger.json` when one spells
          the name;
        - `openspec/`, `.conductor/`, `CHANGELOG.md` and the rest of `docs/` are OUT, even when named;
        - a literal dynamic `import("…")` is followed;
        - a non-relative specifier is not.

      RED `red-3.1.txt`.
- [ ] 3.2 **TDD, FUNCTIONAL** (`functional/certify-index`, twin edited): the run-time observer.
      - **The RED.** A fixture functional test reads a tracked `scripts/` file through a path
        assembled at run time. Certify refuses naming that file and writes no entry. With the
        derivation complete, certify writes its entry. A read of `openspec/changes/archive/` (the
        record, excluded by rule) does NOT refuse.
      - **The GREEN.**
        - `scripts/test/fixtures/observe-reads.mjs` (new), loaded through
          `NODE_OPTIONS=--import`. It records module resolutions, `fs` reads and `child_process`
          script paths under the run directory.
        - `certify.mjs` compares them with `functionalSubject()`.

      RED `red-3.2.txt`.
- [ ] 3.3 **The switch, ONE commit** (L3).
      - **Drift.** `drift.mjs` and `certify.mjs` use `functionalSubject()`.
      - **Retired.** `certifiedModules()` and `ENGINE_ENTRY`'s special case retire.
      - **Tests.** `assert/drift-script.test.mjs`'s `certifiedModules` tests (`:281`, `:441`) are
        rewritten against the subject.

      This commit stages `certification.mjs`, which is in the closure, so run `certify functional`
      over the staged commit first.
      Verify: the commit passes its own hook. Then run `measure.mjs` again over `HEAD~1..HEAD` and
      paste it: the commit demanded the functional half.
- [ ] 3.4 **The stale comment**, `scripts/lib/store.mjs:624-631`. It exists only because the
      `gitOps(` scan counted comments. Rewrite it to say the scan is retired, in the same commit as
      3.3 or the next one. `store.mjs` is in the functional subject, so certify first.
      Verify: `rg -n "certifiedModules" scripts` returns nothing.
- [ ] 3.5 **REGRESSION GUARD, UNIT**: the #229 reproduction.
      - **The guard.** With b4ffe164's two changed paths (`scripts/lib/archive-gate.mjs`,
        `scripts/lib/store.mjs`) staged and no agreeing entry, the freshness result is a functional
        DEMAND.
      - **The mutation.** Restore the `gitOps(` derivation in a scratch copy; the guard must fail.

      `mutation-3.5.txt`.

## 4. L4: coupling in the commit-msg hook, with a declared exemption (design D4; MODIFIED "Every functional test has an assertion twin…", "The pre-commit gate checks the record…")

- [ ] 4.1 **TDD, UNIT**: `parseTwinExemptions(messageText)`.
      - The final paragraph only.
      - `#` lines ignored.
      - `Twin-Unchanged: <id> — <reason>`, with an ASCII `-` or `--` accepted as the separator.
      - An empty reason is kept as empty, so 4.2 can refuse it.

      RED `red-4.1.txt`.
- [ ] 4.2 **TDD, UNIT**: `couplingRefusals()` takes `exemptions`.
      - **The RED:**
        - a declared, staged id passes without its twin;
        - a declared id whose functional file is NOT staged is refused, naming it;
        - an empty reason is refused, naming it;
        - an undeclared id is refused exactly as today;
        - with `isMerge: true`, nothing is refused (the merge rule; `commit-msg-probe.log`, merge probes).

      RED `red-4.2.txt`.
- [ ] 4.3 **TDD, FUNCTIONAL** (`functional/conductor-09`, twin edited): the two hooks.
      - **The RED.** In a fixture repository with `core.hooksPath` set to the hooks under test:
        - a staged functional file without its twin and without a trailer is refused by commit-msg,
          and pre-commit's output does not mention coupling;
        - with a trailer, it is accepted and the exemption line is printed;
        - the four commit forms each judge their own index: plain, `-a`, `<path>`, and a linked
          worktree (per `commit-msg-probe.log`);
        - a `--no-ff` merge of a branch whose commit carried a `Twin-Unchanged` trailer is accepted,
          and a squash commit of the same change without the trailer is refused.
      - **The GREEN, ONE commit** (L4):
        - `.githooks/commit-msg`, new and executable, captures `GIT_INDEX_FILE` as the pre-commit
          hook does and runs the snapshot's drift with `--phase commit-msg --message "$1"`;
        - `drift.mjs` gains `--phase`;
        - `.githooks/pre-commit` passes `--phase pre-commit`.

      RED `red-4.3.txt`. Verify: `git ls-files -s .githooks/commit-msg` shows mode `100755`.
- [ ] 4.4 **REGRESSION GUARD, FUNCTIONAL**: coupling runs in exactly one place.
      - **The guard.** With both hooks installed and a violating commit, exactly one hook's output
        names the coupling refusal.
      - **The mutations.** Re-enable check 3 in the pre-commit phase in a scratch copy: the guard
        fails, because it is reported twice. Disable it in commit-msg: the guard fails, because
        nothing refuses.

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
      - removing the old record file: none. The old format is unreadable by design (D5); a rollback
        re-creates it.
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
        is rewritten.

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

      Verify: `rg -n "pm-certify.lock|Twin-Unchanged|Parallel worktrees" CONTRIBUTING.md` hits each.
- [ ] 6.2 `CLAUDE.md` "Tests:" bullet. It names the drift script's checks and when the triggered
      buckets run. Update it for the commit-msg phase and the observed subject. If a re-read shows
      nothing in it is now false, record that it was checked, with the reason, in the commit message
      of 6.3.
- [ ] 6.3 `.changesets/certification-record-redesign.md`: contributor-facing bullets only, in
      `CHANGELOG.md`'s style. This change ships nothing to plugin users, so say so in the entry's
      first line. Verify: the release checklist's changeset lint accepts it.
- [ ] 6.4 **Documentation currency** (CLAUDE.md "Commits"). README.md and the Mintlify site
      document the shipped plugin, and this change touches only dev tooling. Record in the PR
      description that the check was made and why neither changes.

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
      - **The superseded epics.** `gh-cfdude-pm-226`, `-230`, `-229` and `-227` are already
        superseded into this epic. Close each issue with the ship evidence:
        `gh issue close <n> --repo cfdude/pm --comment "Shipped in 0.51.0 by certification-record-redesign: <commit range>."`

      Verify: `gh issue view <n> --repo cfdude/pm --json state` reads `CLOSED` for all four.
- [ ] 8.3 <!-- pm:lifecycle --> **Archive.** Run `/opsx:archive certification-record-redesign`, then
      stage `openspec/` WHOLE, because the archive rewrites `openspec/specs/suite-certification/spec.md`.
      Verify: `openspec validate --specs --strict` passes, and the main spec holds the ADDED
      requirements.
