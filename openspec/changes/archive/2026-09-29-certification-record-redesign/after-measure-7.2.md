# After-measure (task 7.2), 2026-09-29, against baseline-before.md 0.3(a)

## (a) The 0.50.0 range, e71c63a3..presquash/pr-234, 126 non-merge commits

Two measurements, one per method:

1. The SAME method as 0.3(a): `node openspec/changes/certification-record-redesign/measure.mjs . e71c63a3 presquash/pr-234`.
2. The SHIPPED derivation: `node openspec/changes/certification-record-redesign/measure-shipped.mjs . e71c63a3 presquash/pr-234`.
   It judges each commit with this checkout's `bucketSubject()` and `demandedPaths()`, the functions
   drift uses, over that commit's own tree (subject(index)) and its parent's (subject(HEAD)).

| measure | 0.3(a) before | measure.mjs today | SHIPPED functionalSubject() |
|---|---|---|---|
| functional half demanded (D3's choice, deletions judged against HEAD) | 70 (`B_widenedPlusHeadDeletions`) | 70 | **70** |
| functional demand under the pre-change rule (`gitOps(` scan) | 15 (`A_certified_today`) | 15 | — (retired) |
| sweeps demanded | 51 (`sweeps_engineSource_today`) | 51 | **52** |
| functional demanded only by a deletion | 0 | 0 | 0 |
| derivation errors (lexer misparse, fail closed) | — | — | 0 |
| functional subject size at the range head | 178 (`headSizes.widened`) | 178 | 178 |

`measure.mjs` reproduces 0.3(a) exactly: every field matches, including `headSizes` and
`headExecutedAssertion`. The shipped derivation agrees on the functional count, 70 of 126, and on the
subject size, 178. The sweeps count differs by one, and the difference is the spec, not a defect. The
shipped sweeps subject also holds the sweep's own method (`scripts/test/sweeps/*.mjs`,
`scripts/test/js-lexer.mjs`; "A change to the sweep's own method demands the sweep bucket").
3f68971d staged only `scripts/test/sweeps/output-interpolations.mjs`, which the engine-source rule
did not demand. Found by listing every commit the shipped rule demands sweeps for whose diff holds
no `scripts/conductor.mjs` or `scripts/lib/*.mjs`: exactly one.

## (b) This change's own range, 59461425^..7f78e9c9 (32 non-merge commits, through 6.6)

| measure | measure.mjs | SHIPPED |
|---|---|---|
| functional demanded | 18 (`B_widenedPlusHeadDeletions`) | **18** |
| under the pre-change `gitOps(` rule | 0 (`A_certified_today`) | — |
| sweeps demanded | 1 (`sweeps_engineSource_today`: fe328b52, store.mjs) | 2 (+ be100e04, which moved the lexer into `js-lexer.mjs`) |
| functional subject size at 7f78e9c9 | 186 | 186 |

Under the old rule, no commit of this change would have demanded the functional half. Under the
shipped rule, 18 do: every L1-L4 implementation commit, and 6.2 (`CLAUDE.md`). Each of them was
certified functional over its staged commit, by hand before 2.4 (B9) and by the gate's own demand from
2.4 on. The 14 that demand nothing are the proposal, Gate 1 and 0.x (3); the section 5 records 5.1-5.5, 5.8
and 5.9 (7); and 6.1, 6.3, 6.5 and 6.6 (4).

## (c) Two worktrees certify and commit concurrently, with no lock

Transcript: `worktrees-7.2.txt`, from `<scratch>/run72.sh`. The setup is a scratch clone of this
repository at 7f78e9c9, with `core.hooksPath` set to its own `.githooks` and two linked worktrees,
A and B. Each staged a comment-only change to a different functional test (A
`functional/drift-script.test.mjs`, B `functional/certify-index.test.mjs`), with a `Twin-Unchanged`
trailer in place of the twin.

- **Both certifies ran at once** (05:56:29-06:09:00 UTC, 750 s and 751 s, load ~34-113 at start).
  Each passed 1258/1258, and each wrote its OWN entry into the shared common dir's
  `pm-suite-certification.d/functional/` (`06aab369…` and `1a19be89…`). Neither lost the other's.
- **Both plain `git commit`s then ran at once.** Both landed: wt-a 106a46a3 and wt-b 8501155f. Each
  pre-commit accepted its freshness from the entry its own worktree wrote. Each commit-msg printed its
  coupling exemption and accepted it. B's pre-commit waited 36 s on `pm-suite.lock`, the load lock
  around the assertion half (D6), and never re-certified.
- **Neither worktree re-certified:** the record held 2 entries after both commits, the 2 the
  certifies wrote. Verify of 7.2 met: both commits land, and neither worktree re-certifies.
- The scratch worktrees were removed afterwards (`git worktree remove`, `git worktree prune`), and
  this repository's `git worktree list` holds only the main tree.
