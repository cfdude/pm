# test-isolation-guard — no test may write the developer's real `.conductor` record

Epic: `test-isolation-guard` (0.51.0, superpowers lane). Branched from `dev` at c37b20e5.

## Goal

Every process the suite starts — the unit rung, the file rung, the functional half, the sweep bucket,
and the pre-commit hook's run over the INDEX SNAPSHOT — (1) pins `CLAUDE_PROJECT_DIR` away from the
developer's repository before any test body runs, and (2) proves at exit that the real record is
byte-identical to what it was when the process started, failing the file (exit 1, `✖ <file>`) and
naming every changed path when it is not.

## Premise, as verified today

- The evidence (2026-09-21: epics `alpha` and `from-caller` from `functional/per-call-roots` and 554
  `honcho-memories.log` lines in the real repo's `.conductor`) was cleaned up in c96240ab ("leaked
  test epics removed"). It **does not reproduce today**: `per-call-roots` alone, and the whole
  functional half, run with `CLAUDE_PROJECT_DIR` pointed at a copy of the record, left that copy
  byte-identical. The leak predates per-file isolation (0.49.0) and the per-call roots of 0.47.0.
- **No guard exists**: `rg -n "byte-identical|real record" scripts/test` finds only per-test
  assertions about fixture repos, and nothing pins `CLAUDE_PROJECT_DIR` for a whole process.
  `hermetic-git.mjs` is the precedent for a process-wide env pin; `assert-git-shim.mjs` is the
  precedent for an exit listener that fails a file (`process.exitCode = 1` → `✖ <file> 'test failed'`,
  measured there on Node 22/24/26).
- So the epic is NOT obsolete: nothing stops the next leak, and nothing would notice it. The guard is
  the deliverable.
- The vector: the developer runs the suite inside a Claude Code session, which exports
  `CLAUDE_PROJECT_DIR=<real repo>`. The engine resolves its root as `CLAUDE_PROJECT_DIR || cwd`
  (`scripts/lib/invocation.mjs:51`), so any spawn or in-process call whose env is built from
  `...process.env` without overriding the variable acts on the real repository.
- Pin shape measured before choosing: the assertion half with `CLAUDE_PROJECT_DIR` set to an EMPTY
  non-conductor scratch dir passes 1600/1600 and writes nothing into it. The functional half is
  compared against an unset baseline before the pin shape is fixed (task 3).

## Design

`scripts/test/fixtures/record-isolation.mjs`, a side-effect module (like `hermetic-git.mjs`):

- PROTECTED roots, taken at import: the repository the module belongs to (module-relative — in the
  hook this is the snapshot, in certify the run tree), `PM_TEST_PROTECTED_ROOT` (the hook and certify
  export their REAL top level through it, because the module-relative root there is a copy), and an
  inherited `CLAUDE_PROJECT_DIR` unless it is a pin a parent test process made (`PM_TEST_PINNED_ROOT`).
- SNAPSHOT: every regular file under `<root>/.conductor/`, relative path → sha256; an absent
  directory is recorded as absent.
- PIN: `process.env.CLAUDE_PROJECT_DIR` = a fresh empty scratch dir (`removeAtExit`), also exported as
  `PM_TEST_PINNED_ROOT`.
- EXIT: re-snapshot; any added / changed / removed file under a protected record → stderr names each
  path and `process.exitCode = 1`.

Wiring: `assert-git-shim.mjs` (every unit- and file-rung file loads it), `helpers.mjs` (every
functional file that uses the harness), the sweep test file directly; any functional file that loads
neither is found by the closure guard, not guessed.

## Tasks

### 1. RED/GREEN — the pure snapshot/compare, and the closure guard (id `record-isolation`, assert rung)
- RED: `scripts/test/assert/record-isolation.test.mjs` imports `snapshotRecord`/`diffRecords` and
  asserts every tracked `*.test.mjs` in unit/, assert/, functional/, sweeps/ reaches
  `fixtures/record-isolation.mjs` through its static relative-import closure — fails: module absent.
- GREEN: the module; wire into the shim, helpers and the sweep file.
- GUARD mutation: drop the shim's import → the closure test names the unit/assert files; restore.

### 2. RED/GREEN — the exit check fails a file end to end (functional twin, same id)
- `scripts/test/functional/record-isolation.test.mjs` spawns `node --test` on generated fixture files
  in a temp repo with a protected `.conductor`: a file that writes into it is `✖` and the run exits 1
  naming the path; a clean file passes; a file sees `CLAUDE_PROJECT_DIR` equal to the pin, not the
  inherited value.
- GUARD mutation: remove the exit check's `exitCode = 1` → the writing case passes → the test fails.

### 3. Pin shape confirmed on the functional half
- Functional half with the pin vs. the unset baseline: same failure set → keep pin-to-scratch; new
  breakage → pin by deleting the variable instead (CI's environment) and keep the exit check.

- RESULT (measured): pinned to scratch, the certify run failed 9 tests and one file that the unset
  baseline passes: conductor-13 16.3, conductor-15 9.2–9.5, and gate-artifact-evidence. Each calls lib
  functions directly and relies on `CLAUDE_PROJECT_DIR || cwd` resolving to the repository. So the
  pin is UNSET (CI's environment), and the exit check catches a write through a cwd inside a
  protected repository.

### 4. Hook and certify pass the real top level (`PM_TEST_PROTECTED_ROOT`)
- `.githooks/pre-commit` runner line and `certify.mjs` `runBucket` env; `rg` the hook-fixture tests
  that assert on the hook's steps first.

### 5. CONTRIBUTING — one paragraph under "Temp directories"/"Parallel worktrees" naming the guard,
  what a failure means, and the false-positive case (another session writing the same record mid-run).

## Required task items (CLAUDE.md "The gate procedure")

1. **Call-site sweep** (`rg -n '\.\.\.process\.env' scripts/test`): every env built from the
   inherited environment. Harness `run()` (`harness.mjs:70`, `helpers.mjs:627/672`,
   `assert-harness.mjs:51`) overrides `CLAUDE_PROJECT_DIR: cwd` — safe. `conductor-27.test.mjs:192`,
   `state-file-refuses-to-guess.test.mjs:843` delete it — safe. `helpers.mjs:389/470` (hook fixtures),
   `certify-index`, `drift-script`, `git-shim`, `temp-dir-cleanup`, `conductor-06/09/39`,
   `per-call-roots:91`, `git-gateway-repo.mjs:85`, `store-seam.test.mjs:149` (root given explicitly)
   inherit it — after this change they inherit the PIN, which is the point. Where the rule does not
   hold: a test that builds a path to the real repo from a literal or `import.meta.url` and writes it
   — not reachable by the pin, caught by the exit check (module-relative root is protected).
2. **Inverse**: pin ↔ unset. Tests that need the variable UNSET (`runSplit` in conductor-27,
   state-file-refuses-to-guess:843, self-hosting) delete it from their own env — confirmed. Snapshot ↔
   exit compare ship together. The guard never RESTORES a changed record (it reports): restoring
   could clobber a legitimate concurrent write — declined, justified.
3. **Verify against the commit**: `git show --stat <sha>` after every task commit.
4. Lifecycle / attribution: the orchestrator attributes commits after merge (brief).
