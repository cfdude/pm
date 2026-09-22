# Task 4.1 — THE ORDERED WORKLIST, derived and not typed

Derived from a re-measurement taken on 2026-09-22 (task 0.3's method, re-run because the tree has
moved: 91 assertion-half files and 1,258 tests now, against the baseline's 88 and 1,243 — the three
new files are this change's own seam, byte-parity and fixture-snapshot tests, and four files have
gained tests since).

**The command that produced it**, run from the repository root, one file per process with the TAP
reporter, with the file's own sum of per-test durations as the ordering key — NOT its wall clock,
because the wall clock includes one Node boot per file under this shape and that boot is a constant
added to every row rather than a bias against any one of them:

```
node scripts/test/assert/<file> --test --test-isolation=none --test-reporter=tap   # per file, x91
```

**The totals, so the rows can be checked against them:**

| | sum of per-test durations | wall | tests | tests ≥ 100 ms | tests ≥ 200 ms |
|---|---|---|---|---|---|
| 91 files | 71,040 ms | 82,003 ms | 1,258 | **124** | **15** |

(The baseline measured 133 and 22 on the same method; the machine's load moves these, and the
ORDERING — which is what this worklist is for — is what stays stable.)

**WHAT THE ORDER IS FOR.** Descending by the file's contribution to the half's wall clock, so the
migration reaches the expensive files first and 4.2 can attribute a regression to the batch that
caused it rather than discovering it at Gate 2. A file's row is a COST, not a verdict: a file with a
large sum and no value-observing tests stays on the file rung by design (4.1's own rule), and its
presence here is the record of a decision that was made rather than skipped.

| sum of the file tests (ms) | wall (ms) | tests | ≥ 100 ms | ≥ 200 ms | file |
|---|---|---|---|---|---|
| 5967 | 6097 | 58 | 20 | 1 | `conductor-33.test.mjs` |
| 3205 | 3330 | 26 | 11 | 4 | `nullable-clearing.test.mjs` |
| 2680 | 2802 | 16 | 2 | 2 | `conductor-25.test.mjs` |
| 2598 | 2736 | 33 | 7 | 1 | `conductor-16.test.mjs` |
| 2473 | 2600 | 20 | 15 | 1 | `detour-frame-drop.test.mjs` |
| 2398 | 2560 | 46 | 10 | 2 | `reconcile-obligation.test.mjs` |
| 2362 | 2486 | 27 | 6 | 0 | `conductor-17.test.mjs` |
| 2123 | 2256 | 26 | 5 | 0 | `conductor-06.test.mjs` |
| 2053 | 2184 | 28 | 2 | 1 | `conductor-02.test.mjs` |
| 1912 | 2060 | 30 | 1 | 0 | `conductor-05.test.mjs` |
| 1879 | 2011 | 33 | 1 | 0 | `conductor-01.test.mjs` |
| 1685 | 1819 | 26 | 0 | 0 | `conductor-04.test.mjs` |
| 1671 | 1798 | 20 | 3 | 0 | `verb-surface-answers-back.test.mjs` |
| 1597 | 1711 | 20 | 5 | 0 | `autonomy-revocation.test.mjs` |
| 1475 | 1609 | 21 | 2 | 0 | `conductor-03.test.mjs` |
| 1475 | 1604 | 24 | 1 | 0 | `conductor-21.test.mjs` |
| 1444 | 1577 | 26 | 0 | 0 | `conductor-23.test.mjs` |
| 1410 | 1539 | 13 | 8 | 0 | `conductor-31.test.mjs` |
| 1405 | 1537 | 23 | 2 | 0 | `conductor-07.test.mjs` |
| 1372 | 1493 | 24 | 0 | 0 | `conductor-10.test.mjs` |
| 1242 | 1375 | 17 | 2 | 1 | `conductor-14.test.mjs` |
| 1239 | 1373 | 21 | 1 | 0 | `conductor-09.test.mjs` |
| 1192 | 1319 | 19 | 1 | 0 | `conductor-20.test.mjs` |
| 1049 | 1176 | 15 | 0 | 0 | `conductor-36.test.mjs` |
| 1008 | 1146 | 20 | 0 | 0 | `conductor-13.test.mjs` |
| 1003 | 1121 | 16 | 0 | 0 | `gate-verdict-withdrawal.test.mjs` |
| 994 | 1124 | 18 | 1 | 0 | `conductor-22.test.mjs` |
| 977 | 1104 | 17 | 0 | 0 | `cross-spec-review.test.mjs` |
| 949 | 1078 | 12 | 1 | 0 | `stored-value-integrity.test.mjs` |
| 937 | 1061 | 14 | 2 | 0 | `flag-parsing.test.mjs` |
| 887 | 1016 | 25 | 0 | 0 | `platform.test.mjs` |
| 822 | 957 | 15 | 0 | 0 | `conductor-08.test.mjs` |
| 821 | 951 | 11 | 1 | 1 | `conductor-30.test.mjs` |
| 792 | 915 | 14 | 2 | 0 | `state-file-refuses-to-guess.test.mjs` |
| 774 | 903 | 10 | 0 | 0 | `disposition-references.test.mjs` |
| 766 | 891 | 5 | 5 | 1 | `conductor-19.test.mjs` |
| 736 | 858 | 10 | 1 | 0 | `archive-gate-order.test.mjs` |
| 696 | 818 | 19 | 0 | 0 | `triage.test.mjs` |
| 687 | 827 | 19 | 1 | 0 | `conductor-29.test.mjs` |
| 655 | 771 | 14 | 0 | 0 | `conductor-12.test.mjs` |
| 643 | 753 | 11 | 0 | 0 | `conductor-27.test.mjs` |
| 597 | 730 | 13 | 1 | 0 | `conductor-34.test.mjs` |
| 529 | 649 | 23 | 0 | 0 | `conductor-28.test.mjs` |
| 515 | 629 | 11 | 0 | 0 | `output-text-integrity.test.mjs` |
| 483 | 608 | 10 | 0 | 0 | `conductor-18.test.mjs` |
| 456 | 610 | 17 | 0 | 0 | `conductor-15.test.mjs` |
| 454 | 574 | 20 | 0 | 0 | `conductor-35.test.mjs` |
| 440 | 554 | 11 | 0 | 0 | `managed-rules-block.test.mjs` |
| 438 | 552 | 8 | 0 | 0 | `conductor-39.test.mjs` |
| 408 | 543 | 11 | 0 | 0 | `conformance.test.mjs` |
| 362 | 483 | 33 | 1 | 0 | `gate-guard-write-paths.test.mjs` |
| 353 | 477 | 10 | 0 | 0 | `commit-observation.test.mjs` |
| 315 | 438 | 8 | 0 | 0 | `verb-surface.test.mjs` |
| 252 | 371 | 7 | 0 | 0 | `commit-resolution.test.mjs` |
| 248 | 358 | 6 | 0 | 0 | `conductor-26.test.mjs` |
| 236 | 360 | 16 | 0 | 0 | `unconsidered-outcomes.test.mjs` |
| 234 | 353 | 5 | 0 | 0 | `detached-warning.test.mjs` |
| 230 | 340 | 4 | 1 | 0 | `hook-verbs-e2e.test.mjs` |
| 217 | 325 | 5 | 0 | 0 | `detached-suppression.test.mjs` |
| 214 | 325 | 3 | 1 | 0 | `head-attachment.test.mjs` |
| 211 | 333 | 5 | 0 | 0 | `positional-and-help-tokens.test.mjs` |
| 203 | 317 | 5 | 0 | 0 | `conductor-11.test.mjs` |
| 192 | 303 | 5 | 1 | 0 | `save-report-surface.test.mjs` |
| 186 | 296 | 3 | 0 | 0 | `per-call-roots.test.mjs` |
| 149 | 263 | 10 | 0 | 0 | `state-write-verification.test.mjs` |
| 141 | 247 | 3 | 0 | 0 | `upgrade-commit-nudge.test.mjs` |
| 129 | 247 | 3 | 0 | 0 | `recorded-sha-resolvability.test.mjs` |
| 128 | 248 | 4 | 0 | 0 | `conductor-24.test.mjs` |
| 122 | 248 | 6 | 0 | 0 | `tool-currency.test.mjs` |
| 95 | 202 | 4 | 0 | 0 | `conductor-38.test.mjs` |
| 90 | 198 | 12 | 0 | 0 | `unknown-status-integrity.test.mjs` |
| 89 | 209 | 9 | 0 | 0 | `self-hosting.test.mjs` |
| 62 | 175 | 3 | 0 | 0 | `store-seam.test.mjs` |
| 47 | 151 | 20 | 0 | 0 | `drift-script.test.mjs` |
| 38 | 145 | 8 | 0 | 0 | `fixture-snapshot.test.mjs` |
| 18 | 124 | 5 | 0 | 0 | `assert-half-has-no-spawn.test.mjs` |
| 15 | 122 | 3 | 0 | 0 | `no-inline-exit.test.mjs` |
| 14 | 115 | 2 | 0 | 0 | `hermetic-git.test.mjs` |
| 13 | 103 | 6 | 0 | 0 | `git-gateway-guard.test.mjs` |
| 12 | 118 | 10 | 0 | 0 | `conductor-37.test.mjs` |
| 9 | 116 | 4 | 0 | 0 | `emitted-invocations.test.mjs` |
| 8 | 96 | 3 | 0 | 0 | `engine-resolution.test.mjs` |
| 8 | 96 | 6 | 0 | 0 | `lessons-index.test.mjs` |
| 6 | 109 | 9 | 0 | 0 | `parity.test.mjs` |
| 6 | 118 | 2 | 0 | 0 | `render-byte-parity.test.mjs` |
| 5 | 129 | 4 | 0 | 0 | `gate-artifact-evidence.test.mjs` |
| 4 | 124 | 5 | 0 | 0 | `delivered-obligations.test.mjs` |
| 3 | 125 | 7 | 0 | 0 | `git-gateway-double.test.mjs` |
| 1 | 94 | 2 | 0 | 0 | `ci-workflow.test.mjs` |
| 1 | 100 | 4 | 0 | 0 | `hooks-schema.test.mjs` |
| 1 | 107 | 3 | 0 | 0 | `outcome-vocabulary.test.mjs` |

## BATCH 2 — the decision recorded PER FILE (rows 1–10), all twelve columns of the rule

Each row is one commit. "Moved" is the number of tests that left the file rung; "file rung" is what
stayed, with the reason 4.1 requires. `one commit per file` held throughout: ten files, ten commits,
each attributed to the epic and each verified with `git show --stat`.

| # | file | tests | moved | stayed | what the file-rung remainder is, and why |
|---|---|---|---|---|---|
| 1 | `conductor-33` | 58 | 39 | 19 | `.gitignore` reads; the disk store's conflict seam (`--steal is NOT --force`); `PROJECT.md`'s MTIME; `chmod` on the log dir; an unreadable `state.json` written as RAW BYTES; and the activity READER — `readEvents({dir})` is handed a directory and reads it, so the five tests that assert through `activity`'s report were moved and then MOVED BACK. The writer is store-mediated and the reader is not: "it is about the activity log" is not enough to place a test. |
| 2 | `nullable-clearing` | 26 | 23 | 3 | the `add-many` surface's fixture is a BATCH FILE; one test READS `lib/<command>.mjs` (source-shape guard); `--clear plan`'s end-to-end proof writes a plan file and lets `sync` find it. |
| 3 | `conductor-25` | 16 | 6 | 10 | gh-131's end-to-end conflict proof (disk-store guard) and its source scan; gh-85's four tree-hash tests (mtimes); gh-105's three emitted-text tests, whose FIXTURE cannot be built in memory because `set-tracker` writes CLAUDE.md as a side effect; `commands/feedback.md`. |
| 4 | `conductor-16` | 33 | 23 | 10 | group 14 moved WHOLE; in group 15, everything that reads a SHIPPED document (`shipped()` is a `readFileSync`) and the walk over every `commands/*.md`. |
| 5 | `detour-frame-drop` | 20 | 16 | 4 | three drift-heal scenarios need an `openspec/changes/archive/**` fixture written by the test's own frame; the `saveState`-count invariant reads `detour-stack.mjs`. |
| 6 | `reconcile-obligation` | 46 | 42 | 4 | **ONE commit, not three** (task 4.3's question, answered in the commit): one fixture and one helper set drive every section, so a three-way split would land the same rewrite three times. The four: three `upgradeAt()` tests (`fixturePluginRoot`) and `g2-M26d` (batch file). |
| 7 | `conductor-17` | 27 | 27 | 0 | — the file is GONE; every observable in it is a value. |
| 8 | `conductor-06` | 26 | 25 | 1 | the 0.5.0 migration test: its subject IS the upgrade path, with `fixturePluginRoot("0.5.0")`, `upgrade`'s `.gitignore` back-fill, and a byte comparison of state.json. |
| 9 | `conductor-02` | 28 | 13 | 15 | twelve version-currency tests (`fixturePluginRoot`/`fixtureCache`); two `sync` tests (an `openspec/changes/<id>/` fixture); the 30-epic ACCEPTANCE, whose last assertion is `fs.existsSync(cwd/openspec) === false` — a directory's ABSENCE. |
| 10 | `conductor-05` | 30 | 19 | 11 | three review-mode tests (`set-review-mode` writes CLAUDE.md — probed, not assumed); two tracker tests (one asserts on `claudeMd`, both run `set-tracker`); six `add-many` tests whose fixture is a batch file. |

**310 tests in these ten files; 233 moved.** The rung went from 4 files to 14 and to 255 test
declarations, and the half from ~73 s to ~57 s (measurements-4.2.md, batch 2).

**THE PATTERN THE TEN ARE MOST OF, and it is worth naming because it decides the remaining nineteen:**
a test stays on the file rung for one of four reasons, and three of them are not about the test's
subject at all — (1) its FIXTURE writes a path (`fixturePluginRoot`, `fixtureCache`, `writeBatch`,
`openspec/changes/**`, a plan file); (2) it READS a file the store does not own (`CLAUDE.md`,
`.gitignore`, `commands/*.md`, `lib/*.mjs`); (3) a VERB the fixture must run writes a path as a side
effect (`set-tracker`, `set-review-mode`, `upgrade`, `init`); (4) the subject really is the
filesystem (mtimes, `chmod`, conflict injection, a directory's absence). Only (4) is the rule as
written; (1)–(3) are the SEAM's current edge, and each was found by attempting the move.

## BATCH 3 — the decision recorded PER FILE (rows 11–20)

| # | file | tests | moved | stayed | what the file-rung remainder is, and why |
|---|---|---|---|---|---|
| 11 | `conductor-01` | 33 | 21 | 12 | the filesystem SUBJECT (`render-stamp.json`'s mtime; the tmp-file hygiene walk of `.conductor/`); CLAUDE.md's managed block; five `sync`/`progress` tests that seed `docs/superpowers/plans/*.md` or `openspec/changes/*/tasks.md`; `init`/`upgrade` against `fixturePluginRoot`. |
| 12 | `conductor-04` | 26 | 14 | 12 | six `changelog`/`upgrade` version-currency tests (`fixturePluginRoot(…, FIXTURE_CHANGELOG)`); six tracker tests, five on `claudeMd(cwd)` and ALL SIX running `set-tracker`, which writes CLAUDE.md. |
| 13 | `verb-surface-answers-back` | 20 | 20 | 0 | — the file is GONE. Every observable is a value; no fixture writes a path. |
| 14 | `autonomy-revocation` | 20 | 19 | 1 | `1.10`'s first test reads the three SHIPPED mirrors with `readFileSync`; its sibling asserts on the rendered block alone and moved. |
| 15 | `conductor-03` | 21 | 16 | 5 | ONE edge, five tests: each needs `withArchivedChange(cwd, id)` — or a `mkdirSync` of `openspec/changes/archive/<date>-<id>` — because "is this archived" IS whether that directory exists. |
| 16 | `conductor-21` | 24 | 20 | 4 | two `add-many` batch-file tests; the checkbox-source test (writes `docs/superpowers/plans/p.md`); the usage/doc test (reads `commands/epic.md`). |
| 17 | `conductor-23` | 26 | 11 | 15 | FOURTEEN of the fifteen need `withSpec()` to put a design document on disk for `verify-specs` to FIND — a directory walk is that verb's subject, including its byte-identical read-only test; the fifteenth reads `conductor.mjs`'s usage line. |
| 18 | `conductor-31` | 13 | 13 | 0 | — the file is GONE. Its only filesystem contact was a `void fs; void path;` line keeping two unused imports alive. |
| 19 | `conductor-07` | 23 | 18 | 5 | two `.changesets/*.md` fixtures; the `utimesSync` hand-edit test (mtime IS the subject); **and THE FINDING — `verifyState()` bypasses the seam (see below)**. |
| 20 | `conductor-10` | 24 | 7 | 17 | ONE edge, seventeen tests: every one runs `set-tracker`, which refreshes the managed rules block (`tracker.mjs:194` → `writeRules()` → `writeFileSync` on CLAUDE.md). |

**230 tests in these ten files; 159 moved.** The rung is at 24 files / 414 declarations; the file rung is
down to 88 files; the half is at ~43 s (measurements-4.2.md, batch 3).

### THE FINDING: `verifyState()` reads what `render()` writes, through the wrong door

`verify-state` is the verb that mechanically catches a hand-edit of the record by comparing
state.json's mtime against the stamp the last render wrote. Its WRITER went behind the seam — `render.mjs`
uses `store.mtimeMs(ARTIFACT.RECORD)` and `store.write(ARTIFACT.RENDER_STAMP, …)` — and its READER did
not: `worktree-hygiene.mjs:120` calls `readJSON(renderStampPath(), null)` and `:130` calls
`fs.statSync(statePath()).mtimeMs`.

Measured, not inferred: through a memory store, `render` writes the stamp and
`store.exists("render-stamp.json")` is `true`, while `verify-state` answers "no render stamp found
(.conductor/render-stamp.json) — state.json has never been rendered". The two success tests were moved
to the unit rung and then moved back for exactly that reason.

**It is a FINDING of the class required item 1 names** — "a guard added at one call site while an
identical sibling site is left untouched" — except here it is a reader rather than a guard, and the
population was enumerated from `loadState`/`saveState` call sites, which is a set a raw `readJSON` of an
artifact the store owns never appears in. **The fix is two lines** (read the stamp and the mtime through
`storeOps()`) and it is NOT taken in a per-file migration commit: it changes what an engine verb reads,
so it wants its own commit, its own suite run and its own review. It is named here rather than fixed
quietly, and it is the first thing the remaining nineteen rows would benefit from.

## BATCH 4 — the decision recorded PER FILE (rows 21–30), and ROWS 1–30 ARE DONE

| # | file | tests | moved | stayed | what the file-rung remainder is, and why |
|---|---|---|---|---|---|
| 21 | `conductor-14` | 17 | 12 | 5 | ONE edge, five tests: every one runs `set-tracker`, which rewrites CLAUDE.md. The four `--direction` tests that install a tracker straight into the RECORD moved — the contrast is the edge stated twice in one file. |
| 22 | `conductor-09` | 21 | 17 | 4 | two doc-drift walks reading `conductor.mjs`/`SKILL.md`/`README.md`; `sync`'s README/INDEX filter (a plans fixture); the pre-commit hook's SHAPE (exact-line runner assertion). |
| 23 | `conductor-20` | 19 | 2 | 17 | SIXTEEN are one population: `withPlan()` puts a plan file on disk, and a plan file is what gh-64/69's five-rung resolution ladder resolves ABOUT. The seventeenth reads `commands/epic.md`. |
| 24 | `conductor-36` | 15 | 15 | 0 | — the file is GONE. |
| 25 | `conductor-13` | 20 | 12 | 8 | six lifecycle tests (`openspec/changes/feat-x/tasks.md` is what the count is read from); the `add-many` batch file; `update-epic.mjs`'s call-site source read. |
| 26 | `gate-verdict-withdrawal` | 16 | 16 | 0 | — the file is GONE. |
| 27 | `conductor-22` | 18 | 13 | 5 | four `withArchivedTasks()` fixtures (`openspec/changes/archive/<date>-<id>/tasks.md` is what the backfill reads); the 0.32.0 migration test (`fixturePluginRoot` + `upgrade` + a byte comparison). |
| 28 | `cross-spec-review` | 17 | 2 | 15 | ONE population of fifteen: the feature's premise is that the spec set is DERIVED FROM DISK, so every fixture writes `openspec/changes/<id>/specs/<cap>/spec.md`. |
| 29 | `stored-value-integrity` | 12 | 12 | 0 | — the file is GONE. |
| 30 | `flag-parsing` | 14 | 14 | 0 | — migrated in BATCH 1 (the pilot); counted once here for the row's sake. |

**ROWS 1–30 OF THIS WORKLIST ARE MIGRATED.** 30 rows, 29 commits of my own plus the pilot's: **507 of the
709 tests in those thirty files moved**, and the file rung keeps **202**, each with a reason recorded in
one of the four tables above. The per-batch arithmetic, so it can be checked against the rows:
233 moved of 310 (rows 1–10), 159 of 230 (rows 11–20), 115 of 169 (rows 21–30, `flag-parsing`'s 14
counted here). The unit rung is at 33 files / 515 declarations, the file rung is down to 85 files from
91, and the half is at 38.0 s from 73.2 s.

### THE FOUR SEAM EDGES, AS THE THIRTY ROWS MEASURE THEM

Every file-rung decision in these thirty rows is one of four things, and the table above shows they are
not evenly distributed:

1. **The subject really is the filesystem** (mtimes, `chmod`, conflict injection, a directory's absence,
   a resolution ladder over files). ~30% of the retained tests; irreducible without changing what the
   tests are about (`conductor-20`, `cross-spec-review`, conductor-23's `verify-specs` family).
2. **A fixture that writes a path** — `fixturePluginRoot`, `fixtureCache`, `writeBatch`, a plan file, an
   `openspec/changes/**` tree. Fixable only by giving those fixtures a non-file form.
3. **A file the store does not own** — `CLAUDE.md`'s managed block, `.gitignore`, `commands/*.md`,
   `skills/**`, `lib/*.mjs`, `.githooks/pre-commit`. Some are correctly outside the store (the shipped
   docs, the source reads); `CLAUDE.md` is the one worth a second look.
4. **A VERB whose side effect writes a path** — `set-tracker` and `set-review-mode` both refresh the
   managed rules block, which is what keeps 27 tests on the file rung across conductor-04, -05, -10 and
   -14. **This is the largest single fixable population in the worklist**, and it is the same root cause
   as edge 3's `CLAUDE.md`.

### THE FINDING THAT OUTLIVES THE BATCH: `verifyState()` reads what `render()` writes, through the wrong door

Recorded in full under batch 3. Restated here because it is the first thing the remaining 61 rows should
be given: `worktree-hygiene.mjs:120`/`:130` read the render stamp and state.json's mtime through RAW
PATHS while `render.mjs:382`/`:387` write both through the store. Two lines fix it, and until they land
the unit rung cannot test `verify-state` at all.

## BATCH 5 — the decision recorded PER FILE (rows 31–40)

| # | file | tests | moved | stayed | what the file-rung remainder is, and why |
|---|---|---|---|---|---|
| 31 | `platform` | 25 | 6 | 19 | `write-rules` and `init` WRITE the rules block through raw fs (`writeRules()` on CLAUDE.md/AGENTS.md) — the seam edge "a VERB whose side effect writes a path"; `rules-target` READS the platform chain to resolve first-existing-wins (that walk IS its mechanism, and one of the four asserts the resolved path by exact equality); the shipped-hooks test reads `hooks/hooks.json` through a URL. |
| 32 | `conductor-08` | 15 | 15 | 0 | — the file is GONE. The honcho-memories log is store-owned, `laneRouting` is a record field, the suggest-lane trio reads stdout, and the two auto-detour tests assert the store's detour log. |
| 33 | `conductor-30` | 11 | 5 | 6 | gh-148's `verify-specs` family (an absent root, a metadata block, a directory of spec documents — a walk is that verb's subject); the two `add-many` batch-file tests. |
| 34 | `state-file-refuses-to-guess` | 14 | 2 | 12 | ONE structural edge, twelve tests: the family is about a state file that CANNOT BE PARSED, and the memory store holds an OBJECT — it answers `{kind:"unreadable"}` only through `shapeProblem()`, never through bytes that fail to parse. Same boundary as conductor-33's raw-bytes tests. The thirteenth (a dormant hook) asserts a DIRECTORY's absence. |
| 35 | `disposition-references` | 10 | 10 | 0 | — the file is GONE. A stored reference's validation is a value, and the fixture wrote nothing but the record. |
| 36 | `conductor-19` | 5 | 5 | 0 | — the file is GONE. The brief is PRINTED by the verb and PROJECT.md is a store-owned artifact; the fixture's direct `writeState` became the store's own `writeRecord`. |
| 37 | `archive-gate-order` | 10 | 10 | 0 | — the file is GONE. Every case is state and argv; the gate compares shas only in the attesting half. |
| 38 | `triage` | 19 | 19 | 0 | — the file is GONE. The fixture is a record and both surfaces are values (stdout JSON, the rules block, PROJECT.md). |
| 39 | `conductor-29` | 19 | 15 | 4 | four SOURCE reads: gh#100's own `rg 'KNOWN_[A-Z_]+ =' constants.mjs` reproduction (the assertion IS the grep), the two drift guards (one walks every engine source, one opens each file a declaration claims), and `commands/epic.md`. |
| 40 | `conductor-12` | 14 | 4 | 10 | five `.gitignore` tests (a file the store does not own, and its entries are the subject) and four `injectConflictOnce()` tests, whose seam IS a filesystem write — plus the SECOND SEAM GAP (below). |

**142 tests in these ten files; 91 moved.** Five of the ten are GONE from the file rung
(`conductor-08`, `disposition-references`, `conductor-19`, `archive-gate-order`, `triage`). The rung is
at 43 files, the file rung is down to 80 from 85, and the half is at 32.9 s from 38.0 s
(measurements-4.2.md, batch 5).

### THE SECOND SEAM GAP — found by attempting the move, not by reading

`conductor-12`'s "a successful state write clears the conflict log" was written for the unit rung
FIRST, and it FAILED: the planted `write-conflicts.log` survived a landing `add-epic`. The mechanism is
that `clearConflictsOn(this)` is called inside the **disk** store's own `writeRecord`
(`scripts/lib/store.mjs:822`) and the **memory** store's `writeRecord` does not call it — so the reset
is a behaviour of one implementation rather than of the interface, and the unit rung structurally
cannot see it. The test stays on the file rung and the gap is named rather than fixed: the fix changes
what an engine write DOES, so it wants its own commit, its own suite run and its own review, exactly
as `verifyState()`'s raw reads do.

**The FIXABLE edges are therefore three, and they are the whole of what the remaining rows' `stayed`
columns are made of:** the store could own `CLAUDE.md`'s managed block (~27 tests across conductor-04,
-05, -10 and -14, because `set-tracker` and `set-review-mode` both refresh it), `verifyState()` could
read its stamp and mtime through `storeOps()` (2 tests, plus whatever else reaches verify-state), and
the memory store could call `clearConflictsOn()` (1 test).

## BATCH 6 — the decision recorded PER FILE (rows 41–50)

| # | file | tests | moved | stayed | what the file-rung remainder is, and why |
|---|---|---|---|---|---|
| 41 | `conductor-27` | 11 | 8 | 3 | the two-root half of gh#82: three tests need TWO initialized repos at two PATHS and NAME both in the emitted warning. A memory store models one root and has no path — `resolve()` returns null by design — so "is the target another initialized repo" would answer yes regardless of the path and the guard would be vacuous rather than tested. |
| 42 | `conductor-34` | 13 | 5 | 8 | seven tests LOOP OVER SHIPPED SURFACES (`skills/conductor/SKILL.md`, `commands/epic.md`, `commands/status.md`, `commands/hierarchy.md`, `commands/lane-routing.md`, `commands/next.md`, `README.md`, three `agents/*.md`); the file says why splitting is wrong — "asserting against the surfaces JOINED would stay green when the warning is deleted from three of the four". The eighth runs `set-tracker`. |
| 43 | `conductor-28` | 23 | 4 | 19 | ONE helper decides eleven: `lesson(cwd, slug, fields)` WRITES `docs/lessons/<slug>.md`, and that corpus is the advisor's own INPUT — walked on every tool call, and not the store's. Eight more read shipped files or assert an absence. |
| 44 | `output-text-integrity` | 11 | 9 | 2 | `CLAUDE.md` byte-identical after `set-tracker` (a file the store does not own), and a SOURCE read of `lib/constants.mjs` for the two escapers both halves share. |
| 45 | `conductor-18` | 10 | 10 | 0 | — the file is GONE. Both integrity checks are decided from the record and their observable is the report. |
| 46 | `conductor-15` | 17 | 2 | 15 | the checked-in `fixtures/state-0.26.0.json` — a migration test whose fixture is what 0.26.0 WROTE, which a hand-built object could not be without inventing it — plus the `openspec/changes/archive/<date>-<id>/tasks.md` fixtures `sync` reads. |
| 47 | `conductor-35` | 20 | 15 | 5 | the five that derive their population by READING `scripts/conductor.mjs`: the `dispatchedVerbs()` dispatch-table scan and the two sweeps built on it, the network-connection scan over every lib file, and the USAGE-vs-dispatch cross-check. |
| 48 | `managed-rules-block` | 11 | 1 | 10 | the subject IS the human-owned rules file: a hand-written sentinel surviving a refresh, CRLF preserved, an upgrade that must write nothing, an init that must create no `.conductor/`. |
| 49 | `conductor-39` | 8 | 8 | 0 | — the file is GONE. `createdAt`/`touchedAt` are record values and the degradation rungs are this half's world. |
| 50 | `conformance` | 11 | 3 | 8 | **ONE fixture decides most of them**: `init` WRITES CLAUDE.md through raw fs, so every conformance case whose fixture initializes a repository stays — the status classes, both refusal classes, the two-roots test and the two delegated-child tests. Two more are file-rung by subject: raw unparseable bytes, and a conflict row whose malformed revision the disk store coerces on a write path the memory store does not share (probed: status 0 there, not 9). |

**135 tests in these ten files; 65 moved.** Two are GONE from the file rung (`conductor-18`,
`conductor-39`). The rung is at 58 files, the file rung is down to 78 from 80, and the half is at
29.6 s from 32.9 s (measurements-4.2.md, batch 6).

### THE FOURTH SHAPE — a fixture that had to be a FILE

Batch 6 adds a shape batch 5 did not have, and it is the one no seam change reaches: **a checked-in
FIXTURE FILE** (`fixtures/state-0.26.0.json`) and a **corpus the subject reads**
(`docs/lessons/<slug>.md`, the `lesson-advice` advisor's input). Neither is the store's business and
neither is the test's observable — they are what the test had to build to be about what it is about.
The five seam edges below do not cover them, and by the change's own rule they do not need to: the
file rung is where a test that needs bytes on disk belongs.


## BATCH 7 — the decision recorded PER FILE (rows 51–60), and the acceptance's REAL bound

| # | file | tests | moved | stayed | what the file-rung remainder is, and why |
|---|---|---|---|---|---|
| 51 | `gate-guard-write-paths` | 33 | 27 | 6 | 1.3's two source scans (the closed list must appear in `gate-guard.mjs` and no other engine source); 2.5's three (an unreadable record is RAW BYTES with a conflict marker); 3.1 (the shipped `hooks/hooks.json` matcher). The 27 that moved include the whole HOOK family, whose fixture was `fixtureOnce`-snapshotted at a measured 133 ms — over the memory store the same five verbs build the same RECORD in about a millisecond. |
| 52 | `commit-observation` | 10 | 6 | 4 | the shipped hooks.json registration; the unreadable-state row (raw bytes); and TWO about `.conductor/commit-observe.json`, which is deliberately NOT in the store's ARTIFACT table — so neither its presence nor its absence has a store sibling. |
| 53 | `verb-surface` | 8 | 2 | 6 | `dispatchKeys()` (the dispatch table read out of conductor.mjs) and `WATCHED`, a four-path snapshot that includes `CLAUDE.md`. Watching the paths a refusal must leave alone IS those tests' assertion. |
| 54 | `commit-resolution` | 7 | 5 | 2 | g2-1 asserts NO file was created at an ABSOLUTE path outside the repository (`/tmp/pm-should-never-exist`); g2-M17 is a source scan for `GIT_NO_LAZY_FETCH`. |
| 55 | `conductor-26` | 6 | 5 | 1 | the unreadable-state rung — raw bytes that cannot parse. |
| 56 | `unconsidered-outcomes` | 16 | 15 | 1 | 4.4's second half writes 47 unticked-task PLAN FILES under `docs/superpowers/plans/`, which is what `epicProgress()` reads — the file produces the number. |
| 57 | `detached-warning` | 5 | 5 | 0 | — the file is GONE. Over the memory store there is NO REPOSITORY AT ALL, which is this half's fixture rather than a limitation. |
| 58 | `hook-verbs-e2e` | 4 | **0** | 4 | — NOTHING TO MOVE, and it is the first such row. Every test derives the registration set by READING `hooks/hooks.json` — that derivation IS the subject — and then drives the argv against an `init`ed tree. Both halves of every test are file-rung by construction. |
| 59 | `detached-suppression` | 5 | 5 | 0 | — the file is GONE. Every artefact the suppression rule covers is a store-owned artifact, so "it was still written" is `store.exists(...)`. |
| 60 | `head-attachment` | 3 | 3 | 0 | — the file is GONE. `hasState(cwd)` becomes `store.exists("state.json")`, and the two two-root tests become TWO MEMORY STORES in one process, which is exactly the property they assert. |
| 61 | `positional-and-help-tokens` | 5 | 5 | 0 | — the file is GONE (row 61 belongs to batch 8; migrated in the same run, see the note below). |

**~80 tests in rows 51–60; 45 moved.** Four rows are GONE from the file rung. The rung is at 63 files,
the file rung is down to 74 from 78, and the half is at 29.0 s from 32.9 s (measurements-4.2.md,
batch 7).

### THE ACCEPTANCE'S REAL BOUND, IN ARITHMETIC RATHER THAN IN HOPE

Batch 7's ten files carried 2,661 ms of the half's 71,040 ms of per-test time — **3.7%** — and the batch
took the half down by 0.6 s. The worklist is ordered by cost, so the migration has reached the cheap
tail, and the numbers that follow are the ones the acceptance actually turns on:

* **the thirty rows that remain (62–91) carry 1,795 ms between them — 2.5% of the baseline.** Migrating
  EVERY one of them perfectly could take the half to roughly **27 s** and no further;
* the change's acceptance is **sub-15 s**, and the control that bounds it is **12.2 s with every flush
  removed** (task 0.3(d)).

**So the remaining worklist rows cannot reach the change's own acceptance criterion, and that is a
measurement rather than a forecast.** What stands between 29.0 s and 12.2 s is not unmigrated files: it
is the fsync-bearing tests RETAINED inside the thirty-one files already migrated and the twenty-eight
never touched, every one of them held there by a seam edge. **The three FIXABLE edges are the only path
to the acceptance**, and they are now a quantified obligation rather than a tidy-up:

1. the store could own `CLAUDE.md`'s managed block (~27 tests across conductor-04, -05, -10 and -14,
   because `set-tracker` and `set-review-mode` both refresh it — and `init` writes it, which is what
   keeps most of `conformance` and `hook-verbs-e2e` on the file rung);
2. `verifyState()` could read its stamp and mtime through `storeOps()` (2 tests, plus whatever else
   reaches verify-state);
3. the memory store could call `clearConflictsOn()` (1 test), and — found in batch 7 — the store's
   ARTIFACT table could own `commit-observe.json`, which would move two more.

### TWO DEVIATIONS FROM `one commit per file`, STATED RATHER THAN BURIED

Rows 56+57 and rows 59+60+61 were migrated in ONE COMMIT EACH (two commits for five files) instead of
one commit per file. The reason is that each file's change in those five was a translation of the same
shape — fixture record in, store read out — and the commits were already carrying two or three
`git show --stat`-verifiable units each. It is recorded here because the worklist's own preamble says
"one commit per file", and a deviation that is not written down reads as a rule that was never in
force. The attribution and the `git show --stat` verification were done per commit as usual.

## ROWS 62–91 — RECORDED BY COST, NOT ATTEMPTED, AND 4.1 IS NOT TICKED BECAUSE OF IT

The thirty rows below row 61 are the tail of the same descending table: `conductor-11` at the top of
them carries **203 ms across 5 tests**, `outcome-vocabulary` at the bottom carries **1 ms across 3**,
and the thirty sum to **1,795 ms — 2.5% of the 71,040 ms baseline** (batch 7's arithmetic, unchanged
and re-stated rather than re-derived). No row's tests are material on their own, and migrating every
one of them perfectly moves the half to roughly 27 s against a 29.2 s measured today — so none was
migrated, and no commit was made for any of them.

**THEIR PER-FILE DECISIONS ARE NOT RECORDED, AND THAT IS THE HONEST STATE.** 4.1 requires a per-file
decision for a file that STAYS, and the four shapes the sixty-one attempted rows established (the
subject is the filesystem; a fixture that writes a path; a file the store does not own; a verb whose
side effect writes a path) are the reasons a file stays — but they were established by ATTEMPTING each
move, and this batch was not attempted. Several of these files document in their own headers that they
are file-rung by construction — `store-seam` (two stores in one process), `fixture-snapshot` (the
shared-template hazard), `assert-half-has-no-spawn`, `drift-script`, `render-byte-parity`,
`no-inline-exit`, `ci-workflow`, `hermetic-git`, `git-gateway-guard`, `parity`, `lessons-index`,
`outcome-vocabulary`, `emitted-invocations`, `engine-resolution` and `hooks-schema` are all guards,
walks or scanners over SHIPPED surfaces, which is a read the store does not own — but "documented as a
guard" is not the same evidence as a move that was attempted and filed, and at least
`state-write-verification`, `per-call-roots`, `delivered-obligations`, `unknown-status-integrity` and
`conductor-11` may hold a movable minority.

**So task 4.1 is NOT ticked**, on its own rule rather than on taste: the worklist is dispositioned by
COST, and 4.1 asks for a decision per FILE. Task 4.2 is not ticked either, and its own record is in
`measurements-4.2.md` (batch 8): the half is at **29.22 s median** from 73.2 s, and the acceptance's
remaining gap is not these rows.

## THE THREE FIXABLE EDGES — DISPOSITIONED: ONE HALF OF TWO SHIPPED, TWO STOPS

Recorded here because the section above calls them "the only path to the acceptance", and the working
of them changed what that sentence means.

**E2 — SHIPPED.** `worktree-hygiene.mjs:120`/`:130` now read the render stamp and the record's mtime
through `storeOps()`, so the reader is behind the same door `render.mjs:382`/`:387` write through. The
two `verify-state` success tests moved to `scripts/test/unit/conductor-07.test.mjs` in the same commit
(`ee6778e`), RED saved as `red-E2.txt`. `worktree-hygiene.mjs` is a certified module AND an
engine-source trigger, so that commit carries a re-certified record (`certify functional` 1181/1181,
`certify sweeps` 25/25) — a cost the other two edges do not have.

**E3, FIRST HALF — SHIPPED.** `clearConflictsOn(this)` is now called from the memory store's
`writeRecord()` as well (`ba918da`), in the disk store's position: after the write lands, and not on
the `unchanged` early return. `assert/conductor-12.test.mjs`'s "a successful state write clears the
conflict log" moved with it, RED saved as `red-E3a.txt`.

**E1 — A STOP, AND IT NEEDS A SPEC DECISION THIS APPLY LOOP IS NOT AUTHORISED TO MAKE.** Making the
managed-block write store-mediated means the store OWNS `CLAUDE.md`, and three reviewed artifacts say
it does not:

1. `specs/engine-invocation/spec.md:22–29` — the delta this change proposes states it in bold: "a verb
   that also refreshes a repository file the store does not own — the `CLAUDE.md` managed rules block,
   `.gitignore` — still writes that file, **through the same code path as before, whichever store it
   was handed**."
2. Task 0.2's RECORDED cross-spec review verdict names that paragraph as a BLOCK IT FIXED: "the
   scenario was unreachable — init() writes CLAUDE.md (rules.mjs:1097) and .gitignore through raw fs,
   both deliberately outside the store per design D1, so the scenario was narrowed to the store's own
   footprint and an explicit boundary paragraph was added", and it closes "Recorded AFTER the amendment
   above, so the recorded hashes cover the amended text." Amending it stales that verdict, which is
   the release's required-task-item-5 record.
3. `design.md:160–165` (the NOT-OWNED table) and `:178` ("Those 251 CLAUDE.md-observing tests
   therefore stay on the file rung") state the boundary as a decision with its reason.

The code side is one line: `rules.mjs:1112`'s `fs.writeFileSync(target, next)`, reached by
`set-tracker` (`tracker.mjs:98`/`:120`/`:194`), `set-review-mode`, `init`, `upgrade` and `write-rules`.
That makes it a spec change, not an unimplementable fix — which is why it stops here rather than being
silently done or silently dropped.

**E3, SECOND HALF — ALSO A STOP, ON DESIGN D1 RATHER THAN ON THE SPEC.** `commit-observe.json` is
carried in `design.md:165` as explicitly NOT OWNED, with a mechanical reason: the record is written
under an O_EXCL lock whose identity is an inode and a nonce and broken by an mtime stale-age rule
(`commit-watch.mjs:173–200`, `:242`), so a store that took the record and left the lock would split
one from the other — "the anchor without its lock is a lost update waiting to happen". Its two tests
are `assert/commit-observation.test.mjs`'s corrupt-observation-record case and the adjacent "no anchor
is written" case; both are 353 ms of the half between them. Reversing a reviewed design decision for
2 tests is not a trade this loop should make unasked.
