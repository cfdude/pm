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
