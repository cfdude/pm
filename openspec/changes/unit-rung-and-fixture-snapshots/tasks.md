# Tasks

## 0. Before any code

- [x] 0.1 **Gate 1** — two fresh-context lenses over these artifacts BY PATH (lens A: is every
      WHEN/THEN in both spec files reachable and testable against today's 0.47.0 engine, and does any
      of it restate a requirement `suite-certification` or `engine-invocation` already owns; lens B:
      absent edits — every write site the store's ownership table misses (`scripts/lib/constants.mjs`
      holds TWELVE derived path constants, not two: `STATE_PATH`, `CONDUCTOR_DIR`, `BRIEF_PATH`,
      `RENDER_STAMP_PATH`, `DETOURS_LOG`, `WRITE_CONFLICTS_LOG`, `ARCHIVE_DIR`, `PROJECT_MD`,
      `CLAUDE_MD`, `CHANGES_DIR`, `PLANS_DIR`, `SPECS_DIR`), the inverse of each new operation, and
      every existing test that reads engine source or a `.conductor/` artifact and would break
      silently rather than loudly). Fix every Critical and Important, re-validate with
      `openspec validate unit-rung-and-fixture-snapshots --strict`, then record
      `record-gate-review unit-rung-and-fixture-snapshots --gate 1 --verdict pass --reviewer "<identity>"
      --artifact openspec/changes/unit-rung-and-fixture-snapshots/proposal.md --artifact
      openspec/changes/unit-rung-and-fixture-snapshots/design.md --artifact
      openspec/changes/unit-rung-and-fixture-snapshots/tasks.md --artifact
      openspec/changes/unit-rung-and-fixture-snapshots/specs/suite-certification/spec.md --artifact
      openspec/changes/unit-rung-and-fixture-snapshots/specs/engine-invocation/spec.md`
- [x] 0.2 **Cross-spec review** (required task item 5) — release 0.48.0 holds this change's two spec
      files — `suite-certification` and `engine-invocation` — counted FLAT, so it qualifies. Run the
      `cross-spec-review` skill against the release's whole spec set after Gate 1 and again after any
      later round of concurrent amendment; ask the six questions and record
      `record-cross-spec-review 0.48.0 --verdict pass|fail --reviewer "<identity>"`. The question this
      release is most exposed to is DOUBLE OWNERSHIP: `engine-invocation` now owns "the record store is
      supplied per call" while `suite-certification` owns what the assertion half observes, and the two
      must not both own the memory store — `engine-invocation` owns the CALLER's contract, the rung's
      membership rule belongs to `suite-certification`, and neither restates the other. The second is
      CONTRADICTION: `suite-certification`'s "two halves" now carries rungs, and no scenario anywhere
      may still speak of the assertion half as one on-disk directory.
- [x] 0.3 **BASELINE, measured BEFORE any code lands, and kept in this change directory** (this
      change's acceptance is a number, so the number exists at both ends). Capture and write
      `baseline-before.md`:
      (a) `node --test --test-isolation=none scripts/test/assert/*.test.mjs` three times, recording
      `ℹ duration_ms`, `tests`, `pass` — measured at drafting: **86.0 s / 73.8 s / 67.8 s, 1,243 tests,
      1,243 pass**;
      (b) the per-test duration distribution from one of those runs — measured at drafting: **median
      51.4 ms, p25 37.8, p75 71.3, p90 101.5, p99 213.7, max 1,177.9; 133 tests ≥100 ms, 22 ≥200 ms;
      the 1,243 durations SUM to 73.7 s**, i.e. the tests are the wall clock;
      (c) the `fsyncSync` count for one run, via a preload that wraps it — measured: **12,524**;
      (d) the CAUSAL CONTROL: the same command with `fs.fsyncSync` replaced by a no-op — measured at
      Gate 1 as **9.11 s, 1,243/1,243 pass** against a **73.9 s** baseline, i.e. **8.1×**. The
      **6.47 s / ≥10×** first written here does NOT reproduce (see design D10); re-measure on the day;
      (e) the pre-commit hook's wall clock end to end (measured: `node scripts/test/drift.mjs` **0.115 s**
      and the half at 67.8–86.0 s, so the hook is the half);
      (f) the per-verb table in `design.md`'s Context — `init` 37.2 ms / 8 fsyncs, `add-epic` 11.2 ms /
      2, `owingRepo()` 124.9 ms, `render` 0.30 ms, `brief` 0.66 ms, `sync` 0.39 ms, `mkdtemp` 0.32 ms,
      one write+fsync+close 3.3 ms (tmpdir) / 3.5 ms (repo), n=7–60 — re-measured on the day, since a
      number carried forward from drafting is a remembered number.
      **Report which commit this file lands in.** The scratch scripts that produced (c) and (d) are
      kept here too (`count-fsync.cjs`, `noop-fsync.cjs`) so the control is re-runnable rather than
      quoted.
- [x] 0.4 **The half's own anomalous state, recorded before it is touched.** `openspec list` today
      reports `functional-assertion-test-split 47/48 tasks` as a LIVE change while
      `openspec/changes/archive/2026-09-21-functional-assertion-test-split/` also exists in the tree —
      the archive commit (`ab171b7`) ADDED the archive copy without removing the live directory, and
      `diff -rq` reports the two trees IDENTICAL. Every later count in this change that walks
      `openspec/changes/` is affected by it. Decide and state whether this change repairs it or files
      it (`/pm:feedback`) and leaves it — do NOT delete a tracked tree as a side effect of an
      unrelated task. **Recommend: file it and leave it**, because a deletion here belongs to a change
      whose subject is the archive verb, and this change's diff should not carry it.

## 1. The store seam

The store seam is engine-side and lands before any test moves. Everything in this section is
backwards-compatible by construction: `main(argv, io)` is untouched, the CLI builds the disk store,
and no verb changes what it decides.

Pairs, RED → GREEN, named across sections because a pair is not a section: **1.1 → 1.2/1.3** (the
in-memory store and the verbs that read it); **1.5 → 1.2** (the write path's refusal behaviour, which
the memory store must reproduce); **2.1 → 2.2/2.3** (the unit rung's guard and its home); **3.1 → 3.2**
(the fixture leak). Marked `REGRESSION GUARD` rather than `RED` are tasks that pass as soon as they
exist and are verified by a deliberate violation: **1.7, 1.8, 2.5, 3.3**.

The pre-commit hook runs the whole assertion half, so a RED test lands in the SAME commit as the GREEN
task that turns it green; before that commit, the failing run against the pre-GREEN engine is saved in
this change directory as `red-<task>.txt`, and the GREEN commit message names that file.

- [x] 1.1 RED — a seam test that makes the same accepted invocation twice in one process, once through
      the store the command line builds and once through an in-memory store, and asserts the returned
      STATUS is equal and the record is equal. Fails today: there is no store, and `loadState()` reads
      `getPaths()` (`scripts/lib/state.mjs:21`) which reads `engineRoot()` — the invocation's root, not
      a caller-supplied record.
- [x] 1.2 GREEN — `scripts/lib/store.mjs`: one interface (read the record, write the record, read a
      record-directory artifact, append to one, write a rendered artifact, AND remove/rotate one —
      I2: the engine removes or rotates artifacts the store owns, at `write-conflicts.mjs:35` (rotate
      to `.prev`), `:65`/`:68` (`clearConflicts`), `purge-logs.mjs:181`, `activity-log.mjs:127`,
      `claims.mjs:110`, so the interface ships the inverse as an operation rather than leaving those
      sites on raw `fs`; one left off the interface is named with its reason), the DISK implementation
      that keeps `saveState()`'s existing behaviour EXACTLY — the strict read before the revision
      comparison, `--force` read from `currentArgv()` (`state.mjs:663`), the lock, the temp-file write,
      the fsync before the rename (`:702`), the directory fsync (`:726`), the read-back
      (`persistFailure`, `:743`) — and the IN-MEMORY implementation that reproduces the SAME
      normalisation the disk load applies (I6): the strict read's shape check (`shapeProblem`,
      `state.mjs:268`, thrown as `StateUnreadableError`), the `defaultState()` merge and the integer
      coercion of `revision` (`:277-281`), plus the revision and no-op comparisons against the object
      it holds. A memory store that skipped the shape check would let a unit test assert a record
      shape a real disk load refuses. `main(argv, io)` builds the disk store; no verb's decision
      changes.

      The three `.conductor/` artifacts the ownership table missed gain a DECISION here, not an
      omission (I1): `.conductor/session-claim.json` (`claims.mjs:104-110`, write + rename + rm),
      `.conductor/commit-observe.json` and its `.lock` (`commit-watch.mjs:191`, `:242-243`, `:223` rm),
      and `.conductor/write-conflicts.log.prev` (`write-conflicts.mjs:35` rotate). Each is either
      brought behind the store's interface or named in design D1's does-NOT-own list WITH its reason —
      a table that claims derivation from the write sites cannot silently omit a write site.
- [x] 1.3 GREEN — `scripts/lib/render.mjs` produces `PROJECT.md` and `render-stamp.json`
      (`:325`, `:366`) through the store, AND its READS move with them (I3): the pre-image
      `fs.readFileSync(projectMd())` (`:306`) that decides the skip-rewrite and answers
      `--diff-summary` becomes a store read of the artifact's previous text, and `writeRenderStamp()`'s
      "state unchanged since the last render" test (`fs.statSync(statePath()).mtimeMs`, `:356`)
      becomes a store question about the state the stamp was taken FROM — an mtime is not something a
      store that "produces no path on disk" can answer, so the stamp records a state identity the
      store can supply for both implementations, and the skip-rewrite/write decision is made from the
      store's pre-image rather than from a path read. **A THIRD read, and the one that runs on EVERY
      render**: `fs.accessSync(detoursLog())` (`:276`) plus `visibleDetourRows()` (`:277`, →
      `readDetourRows()` → `fs.readFileSync(detoursLog())` at `git.mjs:102`) reaches a store-OWNED
      artifact (`detours.log`; writers `git.mjs:134`/`:193`) through the module-scope `detoursLog()`
      path, so the "Recent detours" rows also become a store read of that artifact — :306 and :356 are
      not the whole set. The markdown-building code is NOT edited — only
      where its inputs come from and its output goes — because that is what makes 1.8's byte parity
      checkable. `verify-state` (`worktree-hygiene.mjs:120-140`) READS the stamp and state.json's
      mtime and is a filesystem check by construction: it stays on the file rung, stated here rather
      than left implicit.
- [x] 1.4 GREEN — the four append-only record writes move behind the store: `detours.log`
      (`scripts/lib/git.mjs:134`, `:193`), `write-conflicts.log` and its latch
      (`write-conflicts.mjs:48`, `:98`), `honcho-memories.log` (`subcommands.mjs:1037`), the activity
      segments (`activity-log.mjs:171`), and `brief.txt` (`subcommands.mjs:156`). Each keeps its
      existing guard-then-write shape; the failure policy on a write that cannot land does not change.
- [x] 1.5 RED — a seam test that a STALE revision is still refused through the in-memory store, and
      that a no-op write is still a no-op, both with the same status the disk store produces; AND a
      third case for the normalisation the disk load also applies (I6): a seeded record whose SHAPE
      the strict read refuses (`shapeProblem`) is refused through the memory store too, rather than
      passing as a plain object. Guards the likeliest way the seam quietly weakens the engine: a
      memory implementation that skips the comparison — or the shape check — it inherited.
- [ ] 1.6 GREEN — the ~20 verb modules read the store from the invocation instead of calling
      `loadState()`/`saveState()` against module-scope paths. **137 call sites** across `scripts/lib/`
      and `conductor.mjs`, derived mechanically with
      `rg -o -e '\bloadState\(\)' -e '\bsaveState\(' scripts/lib/*.mjs scripts/conductor.mjs` and not
      from a list in this document — 19 in `update-epic.mjs`, 12 in `subcommands.mjs`, 9 in
      `detour-stack.mjs`. (`rg -o`, not `rg -c`: `-c` counts LINES, and reports 135 here and 11 for
      `subcommands.mjs`, because a line can hold two matches — M1.) No verb body changes otherwise.
- [ ] 1.7 REGRESSION GUARD — the conformance set (§`scripts/test/functional/conformance.test.mjs`)
      still passes UNCHANGED: every refusal class's returned status still equals the status the binary
      exits with. It is the same check 0.47.0 shipped and it is the reason a seam this wide is safe to
      land at all. Verified by a deliberate violation, not by a green run.
- [ ] 1.8 REGRESSION GUARD — byte parity of the rendered artifact, compared with the render STAMP
      held constant (C2): `render()` stamps `> Last rendered: <now>` (`render.mjs:57`), so two renders
      of the same record are never byte-identical as raw text — the comparison strips the stamp line
      (the engine's own `STAMP_RE`, `:57`/`:304`) from BOTH sides before comparing, and the stamp
      line's presence and format are asserted separately, which is the one choice this makes and the
      other (an injected clock) is not taken. With the stamp held constant: the same record, rendered
      through the disk store and through the memory store, produces byte-identical text; and the same
      record in the same repository state renders byte-identically to a capture taken before the seam
      landed. The capture is committed under `scripts/test/fixtures/` — NOT in this change directory,
      because task 7.2 MOVES this directory under `archive/` and the test's path would break (I8) —
      and is read, not regenerated at assert time: a test that re-derives its own expectation cannot
      catch a change in it.
- [ ] 1.9 MUTATION, saved here as `red-1.x-mutation-evidence.txt` — for 1.7, change one class's
      returned status by hand and confirm ONLY that class's row goes red; for 1.8, change one byte of
      the render and confirm the parity check names it rather than the whole suite failing.

## 2. The unit rung: its home, its guard, and the floor

- [ ] 2.1 RED — the unit rung's guard, and its discrimination. Extend
      `scripts/test/assert/assert-half-has-no-spawn.test.mjs`'s source scan
      (`violations()`, `:76`; `stripComments()`, `:52`) with the filesystem predicate — and the
      predicate covers READS as well as writes (I4): the spec forbids a unit file to "read, write,
      create or remove a path", so the token set includes read names and not only
      write/open/create/remove/flush. Add the run-time counter in the shape of
      `fixtures/assert-git-shim.mjs`, wrapping `fs`'s READ-side entry points as well as its write side
      — a read reached three modules away (render's `fs.readFileSync(projectMd())`,
      `render.mjs:306`) is exactly the hole the run-time layer exists for. The counter cannot be a
      process-wide "count MUST be zero" (I7): the file rung does real writing in the SAME
      `--test-isolation=none` invocation, so the counter is RESET and ASSERTED around each unit test
      (per-test scope) — process-wide it is always-red once the file rung writes, or vacuous. Fails
      today: nothing refuses a unit-rung file that reads or writes. Four direct exercises as tests,
      not a hope: a source that imports the filesystem module is refused, one that calls a write is
      refused, one that calls a READ is refused, and one that names any of them only inside a comment
      is NOT refused.
- [ ] 2.2 GREEN — `scripts/test/unit/` becomes the fourth home. `scripts/test/certification.mjs:63`'s
      `homeOf()` regex gains `unit` as a fourth alternative and nothing else; `EXCLUSIONS` (`:53`)
      stays empty; the comment at `:50` that states the three homes is corrected to four in the same
      edit, because a comment that under-counts the homes is how the next file gets filed in none.
      The enrolment REFUSAL is derived rather than hand-written (I5): `drift.mjs:158`'s message names
      the three homes in prose ("move it under scripts/test/assert/, scripts/test/functional/ or
      scripts/test/sweeps/"), which is NOT derived from `homeOf()` and stays wrong once the fourth
      home exists — derive the named homes from `homeOf`'s alternatives so the message cannot go
      stale, and add the missing POSITIVE assertion
      `homeOf("scripts/test/unit/<id>.test.mjs") === "unit"` beside the three at
      `assert/drift-script.test.mjs:60-64`, which today assert only `assert`/`functional`/`sweeps`
      (and the two null cases). `drift.mjs`'s four checks are otherwise unchanged (`:111`) — the rung
      reaches them as a member of the assertion half.
- [ ] 2.3 GREEN — the pre-commit hook runs BOTH rungs in ONE process and its floor enumerates exactly
      those two globs (`.githooks/pre-commit:125`, `:154`). The declaration becomes
      `git ls-files 'scripts/test/unit/*.test.mjs' 'scripts/test/assert/*.test.mjs'` piped through the
      existing per-file `grep -c '^test('`. The hook's own comment at `:144` forbids enumerating both
      HALVES — the new text must say why this is not that: the set enumerated IS the set the runner was
      given, so the invariant holds; enumerating a set the runner was NOT given is what aborts every
      commit. That distinction is written into the comment AND into the requirement, or the next reader
      re-derives the wrong rule.
- [ ] 2.4 GREEN — the hook's isolation-flag probe (`:117`) covers the two-glob invocation, and the
      Node-18 fallback still runs both rungs correctly. The probe is per-clone and cached; a two-glob
      runner on a Node without `--test-isolation` must still run every file, which the floor then
      confirms.
- [ ] 2.5 REGRESSION GUARD — a NON-VACUITY assertion for the new rung, in the SHAPE
      `assert/assert-half-has-no-spawn.test.mjs:94` uses — but NOT with that assertion's number (I11):
      `files.length > 40` is the FILE rung's floor, and the unit rung starts, per D7, with a handful
      of hand-written proofs (one per verb family — a state verb, a render verb, an append-only log
      verb). So the assertion states the rung's ACTUAL starting count (the D7 proofs — three, or
      whatever the rung holds when the assertion lands) and the rule that RAISES it as the rung fills,
      which is a number in the test and not a rule in a document. Written with the file rung's 40, the
      check cannot go green on a young rung, which is the opposite of what it is for. An empty rung
      runs zero tests and every floor passes, because the floor's declared count is enumerated from
      the same empty set — so the count is asserted in the guard. Verified by emptying the directory
      and confirming the guard fails.
- [ ] 2.6 GREEN — CI runs the rung in the SAME step as the assertion half, one runner invocation given
      both globs and one floor over both (`.github/workflows/ci.yml:74`), and the syntax-check loop
      (`:72`) gains `scripts/test/unit/*.mjs`. The pinned `node-version: "18"` (`:33`) is PROBED for
      `--test-isolation=none`; if the probe succeeds, bump-and-add in one commit as `:75`'s comment
      already directs, and if it cannot be probed here, say so explicitly rather than leaving the
      deferral to a reader who has to guess whether it was decided.

## 3. Fixture snapshots

- [ ] 3.1 RED — a `fixtureOnce()` helper in `scripts/test/fixtures/` with the leak test: two tests in
      one file share a fixture, the first mutates the restored tree, the second reads the value the
      fixture was BUILT with. Fails today: `owingRepo()` is defined three times
      (`assert/gate-guard-write-paths.test.mjs:277`, `assert/reconcile-obligation.test.mjs:48`,
      `functional/conformance.test.mjs:60`) and each call rebuilds the repository.
- [ ] 3.2 GREEN — the helper: build once per file into a template that is never handed out, restore
      per test with `fs.cpSync(template, dst, { recursive: true })`, remove the previous copy, and
      perform no `fsync` and start no engine on the restore path. Proven on ONE file
      (`assert/gate-guard-write-paths.test.mjs`) before any other file uses it.
- [ ] 3.3 REGRESSION GUARD — the restore path performs no durability flush and starts no engine: a
      counter over the flush calls, asserted to be zero for a restore, verified by a deliberate
      violation. Without it, a helper that "restores" by re-running `init` looks identical from the
      tests and costs what it cost before.
- [ ] 3.4 GREEN — the three `owingRepo()` definitions collapse onto the helper, and the helper's own
      rule is stated where it lives: use it for a fixture more than one test in a file uses, NOT for a
      one-shot build, where the copy costs more than the build.
- [ ] 3.5 GREEN — the template's DISPOSAL is shipped, not merely named (M4): 5.3 says the template is
      "removed with the file's run", but no task performs it. The helper removes its per-file
      `mkdtemp` template when the file's run ends (a process-exit or file-teardown hook), so a
      template does not outlive the file that built it and accumulate under the temp dir across files
      — a leak the per-test copy/remove discipline in 3.2 does not cover. State the reason if the
      template is instead kept for the file's whole lifetime and removed by the OS temp cleaner.

## 4. The per-file migration

**The migration is PER FILE and by OBSERVABLE, never a codemod** (design D6): the mechanical part is
the seam, and the test-side move is a decision about what each test reads. A regex rewriting
`run([...])` into a store call would rewrite assertions nobody read, 88 times in one commit.

- [ ] 4.1 The ordered worklist is derived, not typed: the 133 tests over 100 ms and the 22 over 200 ms
      from 0.3(b), mapped to their files, descending. Each migrated file is ONE commit; its diff shows
      its assertions unchanged and only the mechanism they obtain their values through moved.
      A file whose tests assert on `CLAUDE.md`'s managed rules block, `.changesets/`, or any repo file
      the store does not own (design D1) stays on the file rung — that is a decision recorded per file,
      not a gap. The rule in the OTHER direction is what makes the rung reach the half at all (C1): a
      test asserting what the RECORD SAYS — `state.json`'s values, a verb's result, a refusal — moves
      to the unit rung over the memory store, and only a test that needs BYTES on disk (the rendered
      `PROJECT.md`'s parity, the write-conflict log's bytes, the record FILE itself) stays on the file
      rung. **60 of the 88 assertion files — 1,016 of the 1,243 tests — assert on `state.json`'s
      values**, so a file-rung rule that named "the `.conductor/` record" would strand 82% of the half
      on disk with its fsyncs intact and leave the acceptance resting on a control that no-op'd every
      flush.
- [ ] 4.2 The migration is measured AS IT GOES, not only at the end: the half's wall clock and the two
      rungs' counts are recorded at the end of each batch of ten files in this change directory, so a
      regression is attributed to the batch that caused it rather than discovered at Gate 2.
- [ ] 4.3 `assert/reconcile-obligation.test.mjs` is called out separately: 46 tests at 7.84 s
      (170 ms/test, 27% above the half's own median per test). Whether it splits into one commit or
      three is the author's call and is stated in the commit that touches it.

## 5. Required task items

- [ ] 5.1 **Call-site completeness sweep** (required task item 1) — for each rule this change
      introduces, enumerate ALL call sites MECHANICALLY rather than from this document's lists:
      (a) the store rule over every **`.conductor/` write site and `PROJECT.md`** — and the enumeration
      must start from the path constants, not from a hand list. **The pattern is the finding here.**
      `rg -n '^export const \w+ = \(root = engineRoot\(\)\)' scripts/lib/constants.mjs` reaches all
      twelve (`conductorDir:36`, `statePath:37`, `briefPath:38`, `renderStampPath:39`, `detoursLog:40`,
      `writeConflictsLog:41`, `projectMd:65`, `claudeMd:66`, `changesDir:67`, `archiveDir:68`,
      `plansDir:69`, `specsDir:75`). The obviously-similar
      `rg 'path\.join\((conductorDir|engineRoot|ROOT)'` reaches only SIX of them, because the
      repo-root-relative ones are written `path.join(root, …)` rather than `path.join(engineRoot(), …)` —
      and `ROOT|STATE_PATH|CONDUCTOR_DIR` reaches three. A pattern that reaches an arbitrary subset
      while reading as if it reached all of them is the FINDING this item exists to catch, and it is
      recorded here because it was made while writing this document;
      (b) the no-filesystem-work rule over `scripts/test/unit/`;
      (c) the ENROLMENT rule over the four homes and over every consumer that enumerates the suite —
      the hook's floor, the drift script's check 1, `ci.yml`'s per-bucket enumerations, `certify.mjs`'s
      `bucketFiles()`, and the twin-id walk over `scripts/test/functional/` — a consumer added later
      that enumerates a different set is a FINDING;
      (d) the "rung membership follows the observable" rule, whose call sites are the human decisions,
      so state where it holds, where it does not (the files that stay on the file rung by design), and
      justify each omission.
- [ ] 5.2 **DATA references are call sites** (required task item 1) — the store's record holds the
      artifact set it owns; enumerate every place each artifact is WRITTEN, READ and REMOVED, and name
      the artifact that is deliberately NOT moved. In particular the inverse of "the store owns an
      artifact": if the store's ownership table and the engine's write sites can disagree, say which
      one is derived and which is asserted, and add the check that fails when a write site exists that
      the table does not name — an ownership table maintained by hand is exactly the stale enumeration
      this repository's lesson set is built on.
- [ ] 5.3 **Every operation has an inverse** (required task item 1) — enumerate the inverse of each new
      operation and name each one shipped or deliberately not shipped: the store's write against a
      read, and against a REMOVAL (**shipped** — I2: the engine removes/rotates artifacts the store
      owns at `write-conflicts.mjs:35`/`:65`/`:68`, `purge-logs.mjs:181`, `activity-log.mjs:127`,
      `claims.mjs:110`, so 1.2's interface carries a remove/rotate operation and those sites move onto
      it; any one that stays on raw `fs` is named with its reason); the fixture build against its
      discard (**shipped** — task 3.5 ships the template's disposal); the rung's guard against a
      bypass (not shipped — the source scan and the run-time counter are the two halves, and the
      run-time counter's blind spot is named in design's Risk 7 rather than claimed closed); the
      migration's per-file move against a move back (not shipped — say why a rung decision is not
      re-derived automatically).
- [ ] 5.4 **Verify against the commit, not the working tree** (required task item 2) — for every task
      above, run `git show --stat <that task's sha>` and assert every file the task claims to change
      appears in THAT commit. A verb module claiming to read the store but absent from the commit
      FAILS, and the working tree will hold the intended edit while both gates are green.
- [ ] 5.5 **Attribute every commit to its epic** (required task item 4) — `update-epic
      unit-rung-and-fixture-snapshots --attribute-commit <sha>` as each commit is made. The commit that
      moves this change under `archive/` is lifecycle bookkeeping and is NOT attributed (this is the
      one exclusion that is not a judgment call).
- [ ] 5.6 **Route what the work taught you** (required task item 7) — name which of the three each
      finding is, before the change closes. The candidate this change already carries: **friction** —
      the half's cost was explained for a release by a number nobody had measured, and the explanation
      was wrong in its mechanism (it named engine setup; the measurement names durability flushing).
      That is a `/pm:feedback` against the practice of describing a cost without a control, and a
      PROCESS FAILURE worth a `docs/lessons/` file with its `trigger` written as the situation BEFORE
      the mistake ("before explaining why a suite is slow, run the control that removes the suspected
      term"), a concrete `cost` (this change's own design was drafted against the wrong mechanism), and
      an `enforced_in` naming where it binds. Check whether an existing lesson already covers it —
      `docs/lessons/` is a corpus, and a second copy is worse than none.
- [ ] 5.7 **Declare lifecycle bookkeeping** (required task item 3) — the archive task below carries the
      literal `<!-- pm:lifecycle -->` marker on its own line, marked at the moment this source was
      authored.

## 6. Docs (after Gate 2)

- [ ] 6.1 `CONTRIBUTING.md` — the dev inner loop (this change's GOAL 4): `node --test --watch` on the
      assertion half or on a named file, which rung a new test belongs in and how to tell, and what the
      unit rung's guard refuses. The contributor quickstart (clone → install → test) is VERIFIED by
      running it, not described — and `package.json` does not exist in this repository today (the
      certify runner's header says so at `scripts/test/certify.mjs:5`), so if the quickstart needs one,
      adding it is a decision stated here rather than a step assumed.
- [ ] 6.2 The other files that quote the suite's commands are checked as a SET, not one at a time —
      `rg -n --hidden 'node --test' --glob '!scripts/**'` is the enumeration (`--hidden` is required:
      some live under `.claude/skills/`). Correct: this repo's own `CLAUDE.md`'s `Tests:` bullet
      (`:27`, which names the three buckets and now names four homes), `.claude/skills/pr-workflow/SKILL.md`
      and `.claude/skills/release-checklist/SKILL.md`. Say explicitly whether this is user-facing — it
      is not — so the documentation-currency check is answered rather than skipped.
- [ ] 6.3 `CHANGELOG.md` — an entry under `## [Unreleased]`, stating the before/after numbers from 0.3
      and the final measurement, and saying whether the memory store ships (design Open Question 1).
      The release cut folds it into `0.48.0`; Mintlify's Changelog page and Introduction's Real Numbers
      table belong to that cut via the `release-checklist` skill, NOT to this change.
- [ ] 6.4 Confirm `docs/parity-ledger.json` still claims every touched path and adds none — the store
      lives under `scripts/lib/`, which the ledger does not walk, and nothing new is added under
      `commands/`, `agents/`, `skills/`, `hooks/` or `.claude-plugin/`. State it rather than assume it.
- [ ] 6.5 **THE AFTER MEASUREMENT, and it is the change's acceptance.** Re-run 0.3's (a)–(f) on the
      final commit and write `baseline-after.md` beside `baseline-before.md`. The acceptance is
      **sub-15-second pre-commit for the FULL assertion half** and **~1 ms per unit-rung test**, with
      the value-observing population that migrates expected **under 10 s** on its own (design D10).
      The reproducible control — 9.11 s with all 1,243 tests passing and only the flush removed,
      against a 73.9 s baseline = 8.1× — is an UPPER bound: it removes EVERY flush, including the file
      rung's, so it does not license a sub-10 s target for the whole half, and the sub-10 s figure the
      proposal first carried rested on a 6.47 s control that does not reproduce. A miss is reported as
      a miss with the number, not rounded into a pass. **This task's commit is the one that reports the
      change's headline number**, and the CHANGELOG entry quotes it.

## 7. Close

- [ ] 7.1 **Gate 2** — two fresh-context lenses over the committed range (lens A: spec alignment and
      real tests, including that the seam's tests are proven to discriminate and that the unit rung's
      guard has been SEEN to fail; lens B: absent edits — the unguarded write site, the inverse that was
      not shipped, the write site the store's ownership table does not name, and the honesty of every
      refusal message). Fix Critical and Important, then record
      `record-gate-review unit-rung-and-fixture-snapshots --gate 2 --verdict pass --reviewer "<identity>"
      --base-sha <parent of the first attributed commit> --head-sha <the last attributed commit>`
- [ ] 7.2 <!-- pm:lifecycle --> Archive — `/opsx:archive unit-rung-and-fixture-snapshots`, then
      `update-epic unit-rung-and-fixture-snapshots --status archived --outcome delivered --reason
      "the assertion half has a rung for tests whose observable is a value, and the durability flush
      they were paying for is gone from the path" --no-deferrals`. The commit that moves
      `openspec/changes/<id>/` under `archive/` is NOT attributed. **This is the archive that the 0.47.0
      archive COPY and did not MOVE (task 0.4)** — move, do not copy, and confirm afterwards that
      `openspec list` no longer reports this change.
