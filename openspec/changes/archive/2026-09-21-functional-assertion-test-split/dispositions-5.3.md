# 5.3 — the disposition of every tracked test file

DERIVED FROM DISK, not from the move script's own list: `git ls-files 'scripts/test/*.test.mjs'
'scripts/test/**/*.test.mjs'`, so this record can be checked against the tree afterwards rather than
agreeing with the variable that performed the move. 85 files, every one with exactly one home, and
the inline enrolment check in `.githooks/pre-commit` refuses a file in none of them.

The vocabulary is design D6's, and `paired` is the only one that carries a debt: **a functional id
whose assertion twin is not yet on disk is a refusal the drift script will make (6.1/6.4)**. That
debt is recorded rather than hidden — see the note at the end.

The `asked for:` column is the gateway operations that file drives, read off the probe in
`scratchpad/apply-47/split-probe/ops/` (one JSONL per file, from an instrumented `realGit` in a
scratch copy). It is evidence for WHY a file is in the half it is in, not a mechanism: nothing reads
it at test time.

40 files keep the assertion half, 44 are `paired` into the functional half, 1 is the sweep
bucket's. `assert-half-has-no-spawn` is not in the table because it is not a MIGRATION: it is 5.2's
guard, written by this commit, and it is new rather than moved.

| file | home | disposition | gateway operations asked for |
|---|---|---|---|
| `archive-gate-order` | `functional` | paired (assertion twin OWED — 5.4) asked for: headRef,batchCheckCommits,revListNotReached,isShallowRepository,logPickaxe,diffNamesAgainstHead | — |
| `autonomy-revocation` | `assert` | kept whole asked for: headRef | — |
| `commit-observation` | `functional` | paired (assertion twin OWED — 5.4) asked for: headRef,commitWatchGit,commitSubject,diffTreeNames,showPrefix,abbreviateCommit,verifyCommitName,shortHead,describeExactTag,batchCheckCommits,revListNotReached,isShallowRepository,diffNamesAgainstHead | — |
| `commit-resolution` | `functional` | paired (assertion twin OWED — 5.4) asked for: headRef,batchCheckCommits,revListNotReached,committerDate,commitExists,refsContaining | — |
| `conductor-01` | `assert` | kept whole asked for: headRef | — |
| `conductor-02` | `assert` | kept whole asked for: headRef,isShallowRepository,logPickaxe,diffNamesAgainstHead | — |
| `conductor-03` | `functional` | paired (assertion twin OWED — 5.4) asked for: headRef,commitWatchGit,headSubject,diffTreeNames,showPrefix | — |
| `conductor-04` | `assert` | kept whole asked for: headRef,isShallowRepository,diffNamesAgainstHead | — |
| `conductor-05` | `assert` | kept whole asked for: headRef | — |
| `conductor-06` | `functional` | paired (assertion twin OWED — 5.4) asked for: headRef,isShallowRepository,logPickaxe,diffNamesAgainstHead,worktreeList,mergeBaseIsAncestorOfHead | — |
| `conductor-07` | `assert` | kept whole asked for: headRef | — |
| `conductor-08` | `functional` | paired (assertion twin OWED — 5.4) asked for: headRef,commitWatchGit,headSubject,diffTreeNames,showPrefix,shortHead,verifyCommitName | — |
| `conductor-09` | `functional` | paired (assertion twin OWED — 5.4) asked for: headRef,batchCheckCommits | — |
| `conductor-10` | `assert` | kept whole asked for: headRef | — |
| `conductor-11` | `functional` | paired (assertion twin OWED — 5.4) asked for: headRef,commitWatchGit,headSubject,commitSubject,diffTreeNames,showPrefix,abbreviateCommit,verifyCommitName,shortHead | — |
| `conductor-12` | `functional` | paired (assertion twin OWED — 5.4) asked for: headRef,diffNamesAgainstHead,commitWatchGit,headSubject,diffTreeNames | — |
| `conductor-13` | `functional` | paired (assertion twin OWED — 5.4) asked for: headRef,batchCheckCommits,revListNotReached,isShallowRepository,logPickaxe,diffNamesAgainstHead,commitWatchGit,headSubject,diffTreeNames | — |
| `conductor-14` | `functional` | paired (assertion twin OWED — 5.4) asked for: headRef,batchCheckCommits | — |
| `conductor-15` | `functional` | paired (assertion twin OWED — 5.4) asked for: headRef,isShallowRepository,logPickaxe,diffNamesAgainstHead,batchCheckCommits,committerDate,commitExists,refsContaining,mergeBaseIsAncestor | — |
| `conductor-16` | `assert` | kept whole asked for: headRef | — |
| `conductor-17` | `assert` | kept whole asked for: headRef | — |
| `conductor-18` | `functional` | paired (assertion twin OWED — 5.4) asked for: committerDate,commitExists,refsContaining,headRef | — |
| `conductor-19` | `assert` | kept whole asked for: headRef | — |
| `conductor-20` | `assert` | kept whole asked for: headRef | — |
| `conductor-21` | `assert` | kept whole asked for: headRef | — |
| `conductor-22` | `assert` | kept whole asked for: headRef,isShallowRepository,logPickaxe,diffNamesAgainstHead | — |
| `conductor-23` | `assert` | kept whole asked for: headRef | — |
| `conductor-24` | `functional` | paired (assertion twin OWED — 5.4) asked for: headRef,commitWatchGit,commitSubject,diffTreeNames,showPrefix,abbreviateCommit,verifyCommitName,headSubject,shortHead | — |
| `conductor-25` | `assert` | kept whole asked for: headRef,worktreeList | — |
| `conductor-26` | `functional` | paired (assertion twin OWED — 5.4) asked for: headRef,commitWatchGit,commitSubject,diffTreeNames,showPrefix,abbreviateCommit,verifyCommitName,headSubject | — |
| `conductor-27` | `functional` | paired (assertion twin OWED — 5.4) asked for: headRef,commitWatchGit,headSubject,diffTreeNames,showPrefix,shortHead,verifyCommitName,commitSubject,abbreviateCommit | — |
| `conductor-28` | `assert` | kept whole asked for: headRef | — |
| `conductor-29` | `assert` | kept whole asked for: headRef | — |
| `conductor-30` | `functional` | paired (assertion twin OWED — 5.4) asked for: headRef,batchCheckCommits | — |
| `conductor-31` | `functional` | paired (assertion twin OWED — 5.4) asked for: headRef,commitWatchGit,verifyCommitName | — |
| `conductor-33` | `assert` | kept whole asked for: headRef,diffNamesAgainstHead,shortHead | — |
| `conductor-34` | `assert` | kept whole asked for: headRef | — |
| `conductor-35` | `assert` | kept whole asked for: headRef | — |
| `conductor-36` | `functional` | paired (assertion twin OWED — 5.4) asked for: headRef,batchCheckCommits,revListNotReached,commitExists,refsContaining | — |
| `conductor-37` | `functional` | paired (assertion twin OWED — 5.4) | — |
| `conductor-38` | `assert` | kept whole asked for: headRef | — |
| `conductor-39` | `functional` | paired (assertion twin OWED — 5.4) asked for: headRef,isShallowRepository,logPickaxe,gitPath,diffNamesAgainstHead | — |
| `conformance` | `functional` | paired (assertion twin OWED — 5.4) asked for: headRef,lsFiles,commitWatchGit | — |
| `cross-spec-review` | `assert` | kept whole asked for: headRef | — |
| `delivered-obligations` | `functional` | paired (assertion twin OWED — 5.4) asked for: headRef,batchCheckCommits,revListNotReached | — |
| `detached-suppression` | `functional` | paired (assertion twin OWED — 5.4) asked for: headRef,commitWatchGit,describeExactTag,shortHead,headSubject,diffTreeNames,showPrefix | — |
| `detached-warning` | `functional` | paired (assertion twin OWED — 5.4) asked for: headRef,describeExactTag,worktreeList | — |
| `detour-frame-drop` | `assert` | kept whole asked for: headRef | — |
| `disposition-references` | `assert` | kept whole asked for: headRef | — |
| `emitted-invocations` | `functional` | paired (assertion twin OWED — 5.4) asked for: headRef,commitWatchGit,commitSubject,diffTreeNames,showPrefix,abbreviateCommit,verifyCommitName,batchCheckCommits,mergeBaseIsAncestor,commitExists,refsContaining,committerDate,revListNotReached,describeExactTag | — |
| `engine-resolution` | `assert` | kept whole | — |
| `flag-parsing` | `functional` | paired (assertion twin OWED — 5.4) asked for: headRef,batchCheckCommits | — |
| `gate-artifact-evidence` | `functional` | paired (assertion twin OWED — 5.4) asked for: committerDate,commitExists,refsContaining | — |
| `gate-guard-write-paths` | `assert` | kept whole asked for: headRef | — |
| `gate-verdict-withdrawal` | `functional` | paired (assertion twin OWED — 5.4) asked for: headRef,batchCheckCommits,commitExists,refsContaining,revListNotReached,committerDate | — |
| `git-gateway-double` | `functional` | paired (assertion twin OWED — 5.4) asked for: shortHead,headRef,abbreviateCommit,verifyCommitName,mergeBaseIsAncestor,committerDate,commitExists,refsContaining,diffNamesAgainstHead,batchCheckCommits,revListNotReached,isShallowRepository,gitPath,logPickaxe,diffTreeNames,showPrefix,commitSubject,headSubject,commitWatchGit,worktreeList,mergeBaseIsAncestorOfHead,lsFiles,describeExactTag | — |
| `git-gateway-guard` | `functional` | paired (assertion twin OWED — 5.4) | — |
| `head-attachment` | `functional` | paired (assertion twin OWED — 5.4) asked for: headRef | — |
| `hermetic-git` | `functional` | paired (assertion twin OWED — 5.4) | — |
| `hooks-schema` | `assert` | kept whole | — |
| `lessons-index` | `assert` | kept whole | — |
| `managed-rules-block` | `assert` | kept whole asked for: headRef | — |
| `no-inline-exit` | `assert` | kept whole | — |
| `nullable-clearing` | `assert` | kept whole asked for: headRef | — |
| `outcome-vocabulary` | `assert` | kept whole | — |
| `output-interpolations` | `sweeps` | kept whole (sweeps bucket) | — |
| `output-text-integrity` | `functional` | paired (assertion twin OWED — 5.4) asked for: headRef,shortHead,batchCheckCommits,revListNotReached,commitExists,refsContaining,commitWatchGit,commitSubject,diffTreeNames,showPrefix,abbreviateCommit,verifyCommitName,worktreeList,isShallowRepository,diffNamesAgainstHead,committerDate | — |
| `parity` | `functional` | paired (assertion twin OWED — 5.4) | — |
| `per-call-roots` | `functional` | paired (assertion twin OWED — 5.4) asked for: headRef,lsFiles,diffTreeNames,showPrefix | — |
| `platform` | `assert` | kept whole asked for: headRef,isShallowRepository,diffNamesAgainstHead | — |
| `positional-and-help-tokens` | `assert` | kept whole asked for: headRef | — |
| `reconcile-obligation` | `assert` | kept whole asked for: headRef,diffNamesAgainstHead | — |
| `recorded-sha-resolvability` | `functional` | paired (assertion twin OWED — 5.4) asked for: headRef,committerDate,commitExists,refsContaining,mergeBaseIsAncestor | — |
| `save-report-surface` | `assert` | kept whole asked for: headRef | — |
| `self-hosting` | `functional` | paired (assertion twin OWED — 5.4) | — |
| `state-file-refuses-to-guess` | `functional` | paired (assertion twin OWED — 5.4) asked for: headRef,commitWatchGit,describeExactTag,commitSubject,diffTreeNames,showPrefix,abbreviateCommit,verifyCommitName | — |
| `state-write-verification` | `functional` | paired (assertion twin OWED — 5.4) asked for: batchCheckCommits | — |
| `stored-value-integrity` | `assert` | kept whole asked for: headRef | — |
| `tool-currency` | `functional` | paired (assertion twin OWED — 5.4) asked for: headRef,lsFiles,diffNamesAgainstHead | — |
| `triage` | `assert` | kept whole asked for: headRef | — |
| `unconsidered-outcomes` | `assert` | kept whole asked for: headRef | — |
| `unknown-status-integrity` | `assert` | kept whole asked for: headRef | — |
| `upgrade-commit-nudge` | `functional` | paired (assertion twin OWED — 5.4) asked for: headRef,isShallowRepository,diffNamesAgainstHead | — |
| `verb-surface` | `functional` | paired (assertion twin OWED — 5.4) asked for: headRef,shortHead,commitWatchGit,verifyCommitName,worktreeList,isShallowRepository,diffNamesAgainstHead | — |
| `verb-surface-answers-back` | `functional` | paired (assertion twin OWED — 5.4) asked for: headRef,isShallowRepository,logPickaxe,batchCheckCommits | — |

## The debt this record carries

**44 functional files are `paired` and their assertion twins are NOT yet written.** 5.3's own text
requires the twin "WRITTEN in this same task, because a functional id with no twin is a refusal",
and 5.4's checks are what refuse it — but 5.4's tests land with the drift script in 6.1/6.4, so the
refusal does not exist yet and the twins are the one half of 5.3 that is outstanding. The task's
checkbox is deliberately LEFT UNTICKED for that reason: this commit moves every file to a home and
gives the split its runner, its floor and its enrolment check, and it does not claim the twin
coverage 5.3 also asks for. Writing 44 twins is the next batch, and it is a batch rather than a
footnote — each one is a test that has to make the fast half learn something the slow half knows.

**The functional half is 44 files, not the 25 an earlier derivation listed.** Every home was
derived from the probe plus a source scan for a spawn, not from a subject judgement: measured, `conductor-01/07/28/33/37/39`, `detached-*`,
`gate-artifact-evidence`, `gate-guard-write-paths`, `git-gateway-double/guard`, `head-attachment`,
`hermetic-git`, `managed-rules-block`, `nullable-clearing`, `parity`, `platform`,
`reconcile-obligation`, `self-hosting`, `state-file-refuses-to-guess`, `tool-currency` and
`upgrade-commit-nudge` all either spawn a child or need a real repository, and
`suite-certification`'s "The assertion half spawns no process and runs no git" admits neither.
Nine of them (`conductor-07/28/33`, `gate-guard-write-paths`, `managed-rules-block`,
`nullable-clearing`, `platform`, `reconcile-obligation`) had their ONLY spawn re-pointed to the
in-process invocation and stayed in the assertion half; the rest are functional because the thing
they spawn or the repository they need IS their subject.
