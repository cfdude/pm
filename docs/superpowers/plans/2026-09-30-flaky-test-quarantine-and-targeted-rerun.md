# flaky-test-quarantine-and-targeted-rerun — retry only the failed test FILES, once, and say so

Epic: `flaky-test-quarantine-and-targeted-rerun` (0.51.0 batch 2, superpowers lane). Dev tooling only: nothing
here ships to plugin users, so there is no changeset.

## Design

- ONE implementation, `scripts/test/flake-retry.mjs`: parse the spec output's `✖ failing tests:` section
  (`test at <file>:<l>:<c>` + `✖ <name>`), re-run only those files once, classify, append the ledger. IO is
  injected so the unit rung covers every branch. Two callers: `scripts/test/certify.mjs` (functional and
  sweeps, inside the run tree, same observer env, ledger to the real repo root) and `.githooks/pre-commit`
  (assertion half, through the module's `hook` CLI; the floor still reads the FIRST run's total).
- Outcomes: pass on retry + listed in `scripts/test/known-flakes.json` -> pass, "known flake"; pass on retry +
  unlisted -> pass, "UNLISTED flake: <file> <test>"; fail twice -> real failure. Never retried: a status that
  is not 1 (timer/signal), an unreadable or zero fail count, any failure whose file the runner was not given
  (a test declared through a helper reports the helper's path, which is what `unitTest()` does, so a unit-rung
  failure is never retried).
- Ledger: gitignored `.test-flakes.log` at the repo root, one JSON line per retried test
  `{at, file, test, load1 (os.loadavg()[0]), outcome}`. Repo-only: in the root `.gitignore`, NOT `ENGINE_IGNORED`.
- `known-flakes.json`: `[{file, test (substring of the name), owningEpic, note}]`. Seeded with the two known
  flakes (certify-index 1.2 SIGTERM; state-file-refuses-to-guess G2-C1/I2 2000 ms bound), `owningEpic: null` —
  **both need an owning epic** (orchestrator to register).

## Why not Vitest, and why not node:test's own rerun

Vitest has `retry` and per-test reruns, but adopting it means rewriting every `node:test` file and the
machinery that reads them (the `unitTest()` filesystem counter, the observer loaded through `NODE_OPTIONS`, the
hook floor that counts `^test(` declarations and the spec-summary parse). The measured problem is two flaky files;
a file-level retry is ~170 lines. Node 26 here has `--test-rerun-failures <state-file>` (measured: it re-ran
nothing differently on a plain second invocation, and it needs a state file the floor and certify do not
manage); it is not verified on the Node 22 floor (`NODE_FLOOR_MAJOR`), and it carries no known-flake
classification or ledger. A runner swap does not earn its place against this problem; revisit if flakes spread
beyond a handful of files.

## Tasks

- [x] 1. `scripts/test/flake-retry.mjs` + `scripts/test/unit/flake-retry.test.mjs` (11 value tests)
- [x] 2. certify.mjs retry (same tree + env, ledger to root, pass line names the retry); header comment fixed
- [x] 3. `.githooks/pre-commit` retry branch; ledger-write comment fixed
- [x] 4. `scripts/test/known-flakes.json`, `.gitignore`, `functional/flake-retry.test.mjs` (certify + real hook)
- [x] 5. certify-index 1.2 snapshot exempts the ledger (Twin-Unchanged: it leaves the twin's subject untouched)
- [ ] 6. Orchestrator: attribute commits, register owning epics for the two seeded flakes, archive <!-- pm:lifecycle -->
