# Proposal: certification-record-redesign

## Why

The certification record that lets a commit skip the functional half was built for one checkout
committing serially. 0.50.0 built its epics in up to seven parallel worktrees, and the record failed
there in four ways, each filed separately:

- **#226, a shared record keyed per trigger.** The record is one JSON file under
  `$(git rev-parse --git-common-dir)` (`scripts/test/certification.mjs:27-30`), holding ONE entry per
  certified id. `writeEntry()` reads it, changes it and renames it back
  (`certification.mjs:361-367`). Every worktree shares it. So a certify in worktree B overwrites the
  entry worktree A just wrote, and A's commit is refused as stale. A second failure mode is not a
  race at all. `recordRefusals()` resolves the `covers` of EVERY entry against the CURRENT tree,
  whether or not that entry is about this tree (`certification.mjs:439-483`). When B certified, its
  `scripts/lib/git.mjs` entry named `spec-sync-index`, a functional test that existed only on B's
  branch. The drift script in every other worktree then refused with `dangling-covers`.
- **#230, certify hashes the working tree.** `moduleEntry()` and `triggerEntry()` hash
  `fs.readFileSync` bytes (`certification.mjs:293-323`) and `runBucket()` runs the bucket in the
  checkout (`certify.mjs:78-88`). The commit and, since 0.50.0, the pre-commit hook both judge the
  INDEX (`.githooks/pre-commit:112-118`, `drift.mjs:120-132`). A partial stage certifies bytes the
  commit does not contain.
- **#229, the functional trigger is "calls `gitOps(`".** `certifiedModules()` is every
  `scripts/lib` module whose source matches `/\bgitOps\s*\(/`, plus `conductor.mjs`
  (`certification.mjs:191-201`). That is 8 of the 65 engine files today. A change to any other engine
  module demands only the sweeps. In 0.50.0, b4ffe164 reworded a refusal in
  `scripts/lib/archive-gate.mjs` and passed its pre-commit (1,328/1,328), while
  `functional/conductor-13` still pinned the old text. It failed two commits later
  (`docs/lessons/an-uncertified-module-change-skips-the-functional-half.md`).
- **#227, the coupling check forces no-op twin edits.** `couplingRefusals()` refuses any staged
  functional file unless its assertion twin is also staged (`certification.mjs:164-178`), whatever
  the change was. gh-cfdude-pm-224 wrapped temp dirs in five functional files. Each got a comment-only
  twin edit purely to pass the check.

**Measured in 0.50.0** (the evidence this change answers to):

- **The lock.** Parallel worktrees worked around #226 with a hand-rolled `mkdir` lock at
  `$(git rev-parse --git-common-dir)/pm-certify.lock`, held across certify AND commit.
  - It serialized every engine commit across 7 agents.
  - It could not fix the second failure mode: one agent was blocked for 25 minutes or more on a
    `covers` id that existed only in a peer's tree.
- **Twin edits.** Five comment-only twin edits were made purely to satisfy check 3 (#227).
- **The trigger.** Over the 126 non-merge commits of the 0.50.0 build (`e71c63a3..presquash/pr-234`),
  today's functional trigger fired on 15. 51 commits touched engine source, so **36 engine commits
  never demanded the functional half** (`measure-0.50.0.json`, produced by `measure.mjs` in this
  directory).

## What Changes

- **The record becomes content-keyed and append-only.** Each passing run writes ONE new file, named
  by the content it certifies, under a record DIRECTORY in the git common dir. No run ever rewrites
  another run's file. A run's entry is a MANIFEST: the git blob id of every file in its bucket's
  subject, as that run's index held it. The subject includes the test files that ran.
  - A commit is fresh for a bucket when one passing entry agrees with the commit's index on every
    staged path in that bucket's subject.
  - An entry that does not agree is not about this tree, so it does not apply. It is never a
    refusal.
  - The dangling-entry and dangling-covers refusals of 7.2 retire. A deleted or renamed test, a
    renamed module or a removed conformance row is now a staged change to the subject, and it
    demands a fresh run.
  - **BREAKING (dev-only):** the old `pm-suite-certification.json` is not read and is removed on the
    first new-format write.
- **Certify runs over the index.** It copies the index, exports it with `git checkout-index`, runs the
  bucket over those bytes, and records the manifest read from that same index copy. A partial stage
  certifies exactly its staged half.
- **The functional trigger is derived from what the functional half observes.** The subject is the
  static import closure of `scripts/test/functional/*.test.mjs` and of the entry point, plus every
  tracked file under `scripts/`, `.githooks/` or `hooks/` whose name a closure test file spells as a
  literal, plus the shipped-surface roots (`commands/`, `skills/`, `agents/`, `.claude-plugin/`) and
  `README.md`/`CLAUDE.md`/`docs/parity-ledger.json` that the half reads. The assertion half and the
  repository's own record (`openspec/`, `.conductor/`, `CHANGELOG.md`, the rest of `docs/`) are
  excluded. A guard keeps the derivation honest. This replaces the
  `gitOps(` scan.
- **The coupling check takes a declared, audited exemption.** Check 3 moves from the pre-commit
  drift run to a new `.githooks/commit-msg` run of the same script, because only that hook can read
  the message.
  - A `Twin-Unchanged: <id> — <reason>` trailer exempts the named id.
  - The drift script refuses a trailer that names an id not staged, or that has no reason.
  - Gate 2 audits every such trailer in the reviewed range.
- **The certify lock becomes unnecessary for correctness.** CONTRIBUTING documents parallel-worktree
  use. The hook's `pm-suite.lock`, which limits machine load, stays.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `suite-certification`:
  - **The trigger.** The functional trigger is derived from what the functional half observes.
  - **Freshness.** Freshness is judged per content-keyed run manifest over the index, not per
    trigger id over working-tree bytes.
  - **Dangling ids.** The dangling-id refusals retire in favour of freshness demands.
  - **Coupling.** Check 3 takes a declared exemption and runs in the commit-msg hook.
  - **New requirements (ADDED).** Certification over the index, and concurrent worktrees that do not
    interfere.

## Impact

- **Code (dev-only, nothing shipped):**
  - `scripts/test/certification.mjs`
  - `scripts/test/certify.mjs`
  - `scripts/test/drift.mjs`
  - `.githooks/pre-commit`
  - a new `.githooks/commit-msg`
- **Tests:**
  - `assert/drift-script.test.mjs` (20 tests on the old record shape)
  - `functional/drift-script.test.mjs`, which writes `RECORD_NAME` (`:78`)
  - `assert/certify-count.test.mjs`
  - the pre-commit hook tests in `functional/conductor-09.test.mjs`
- **Comments:** `scripts/lib/store.mjs:624-631` exists only because of the `gitOps(` scan, and goes
  stale when the scan is retired.
- **Docs:**
  - `CONTRIBUTING.md`: the pre-commit section, the triggered buckets, and a new parallel-worktree
    section;
  - `CLAUDE.md`'s "Tests:" bullet;
  - the lesson `an-uncertified-module-change-skips-the-functional-half` (its `enforced_in` moves
    from habit to mechanism);
  - `.changesets/`.
- **Engine and shipped surface:** unchanged. No runtime dependency. No `state.json` migration: the
  record is machine state in the git common dir, never committed.
- **Cost:** 70 of the same 126 commits would have demanded the functional half, against 15 today.
  One functional certify took 173 s and 418 s under 0.50.0's load (the lesson's figures), and 672 s
  on 2026-09-28 at a load average above 140. The trade is deliberate: 36 of those
  55 extra demands are engine commits that today reach the functional half only in CI or at the next
  certify.
- **CI:** CI runs every bucket and never reads the record, so it is unaffected.
