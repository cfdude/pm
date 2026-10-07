# hook-fixtures-couple-to-every-hook-step — plan

**Epic:** `hook-fixtures-couple-to-every-hook-step` (superpowers lane, release 0.51.0).

## Goal

A fixture that runs the real git hooks DERIVES what those hooks need from the hooks themselves, so a
hook step (or a hook file, or an import inside a script a hook runs) added later cannot silently leave a
fixture holding a hook without the script it runs. The hand-typed copy lists go away.

## The premise, verified against today's code (dev @ ce6674b6)

Hand-mirrored lists of hook machinery, found with
`rg -n '"scripts/test/(drift|certification|js-lexer)\.mjs"' scripts/test` and
`rg -n '"(certify|certification|drift|js-lexer)\.mjs", ' scripts/test`:

| # | Call site | Hand list |
|---|-----------|-----------|
| 1 | `scripts/test/fixtures/helpers.mjs` `runHookAgainstFixture` | `drift`, `certification`, `js-lexer` + a "minimum tree" (`scripts/lib/`, `conductor.mjs`, two bucket dirs) |
| 2 | `scripts/test/fixtures/helpers.mjs` `hookedRepo` | the same three scripts, AND the three hook names |
| 3 | `scripts/test/functional/conductor-09.test.mjs` IX-k | the same three scripts, as tracked `extraFiles` |
| 4 | `scripts/test/functional/certify-index.test.mjs` fixture | certify's six: `certify`, `certification`, `drift`, `js-lexer`, `fixtures/temp-dir`, `fixtures/observe-reads` |
| 5 | `scripts/test/functional/drift-script.test.mjs` fixture | the same six |

Each of the release's additions had to be typed into these by hand: `js-lexer.mjs` (3.1) into 1-3,
`observe-reads.mjs` (3.2) into 4-5, and `commit-msg`/`prepare-commit-msg` (D4) into 2.

`record-isolation.mjs` is named in the dispatch as another hand-mirrored case. Checked: `git log
-S'record-isolation.mjs' -- scripts/test/fixtures scripts/test/functional` gives 5642336f and ee4517bd,
and neither adds it to a copy list. The hook reaches it only through `PM_TEST_PROTECTED_ROOT` and test
files import it. There is **no list for it**, so there is nothing to derive.

**The minimum tree is PARTLY OBSOLETE (to be proven, not assumed).** A scratch probe ran drift's pre-commit
phase in a repository with no `scripts/lib/`, no `conductor.mjs` and no bucket dirs. Drift passed,
because since 0.50.0 drift reads the INDEX (`indexReaders()`), where an untracked empty directory or an
untracked empty file does not exist. The probe covered only the pre-commit phase, with zero functional
ids. Task 3 deletes those lines and treats the claim as proven only after every real hook test passes
without them.

## Design

A new fixture module, `scripts/test/fixtures/hook-machinery.mjs`, holds three functions. It keeps no
list of script names.

- `hookNames({ root, readdir, isExecutable })` returns every EXECUTABLE regular file in `.githooks/`.
  A new hook file is installed with no edit anywhere. A stray `.DS_Store` is not.
- `hookInvokedScripts(text)` returns every `scripts/…\.mjs` path a hook spells in its CODE. Shell
  comments are stripped first: the pre-commit prose names `certify.mjs` and `record-isolation.mjs`,
  and the hook runs neither. A glob such as `scripts/test/unit/*.test.mjs` is not a script.
- `scriptClosure(roots, { root, readFile, exists })` walks from the given roots and returns the full
  set. It reuses certification's import walker, exported as `relativeImports()`, which `functionalSubject()`
  now calls. There is still ONE `IMPORT_SPEC`. The closure also follows every repo-relative
  `"scripts/….mjs"` string literal in comment-stripped code, which is how certify reaches
  `OBSERVER` (`fixtures/observe-reads.mjs`).
- `hookMachinery()` is `scriptClosure(⋃ hookInvokedScripts(hook))`. `certifyMachinery()` is
  `scriptClosure(["scripts/test/certify.mjs"])`.

**Not derived, and why:** `RUNNER_CODE` in `scripts/test/certify.mjs`. It is the set of files whose
bytes enter the manifest key, and it is curated on purpose (`temp-dir.mjs` is omitted: certify only
removes the run dir with it). `unit/certify-index` pins it. It is not a fixture copy list, and deriving
it would change which edits certify refuses. It is out of scope.

## Tasks

### Task 1: the derivation and its guard (assert rung)

- **RED:** `scripts/test/assert/hook-machinery.test.mjs` imports `../fixtures/hook-machinery.mjs`,
  which does not exist yet, so the run fails at import.
- **GREEN:**
  - export `relativeImports(text, fromRel)` from `certification.mjs` and have `functionalSubject()` use it;
  - write `hook-machinery.mjs`.
- **REGRESSION GUARD, with mutation proof.** The test uses injected in-memory readers and spawns
  nothing. It covers the three shapes that broke fixtures this release:
  - (a) a new hook step `node "$SNAP/scripts/test/new-step.mjs"` → `new-step.mjs` is in the set;
  - (b) a new import inside a script already in the closure (the `js-lexer` shape) → the new module is in;
  - (c) a new hook FILE (the `commit-msg` shape) → `hookNames()` returns it, and its scripts are in the set.

  It also has two negative cases: a commented-out step and a glob are not in the set, and a
  non-executable file in `.githooks/` is not a hook. Against the real repository,
  `hookMachinery()` ⊇ {drift, certification, js-lexer} and `certifyMachinery()` ⊇ {…, observe-reads,
  temp-dir}. The existing check-4 test (`assert/drift-script`) guards the `functionalSubject()`
  refactor.

  Mutation: break `hookInvokedScripts`'s comment strip, then its path regex, and see the named cases go red.

### Task 2: the five call sites consume it

- `helpers.mjs`:
  - `runHookAgainstFixture` copies `hookMachinery()`;
  - `hookedRepo` copies/tracks `hookMachinery()` and installs `hookNames()`.
- `conductor-09` IX-k builds its tracked `extraFiles` from `hookMachinery()`.
- `certify-index` and `drift-script` copy `certifyMachinery()`.
- **Live mutation proof, run once and never committed.** In this worktree:
  - add a real pre-commit step `node "$ROOT/scripts/test/hook-probe.mjs"`, where `hook-probe.mjs`
    imports a new `./hook-probe-dep.mjs`;
  - add an import of a new module to `certification.mjs`.

  Then run the hook functional tests: with dev's `helpers.mjs` they fail for the wrong reason (RED);
  with the derived one they pass (GREEN). Revert. `core.hooksPath` resolves to the MAIN checkout's
  `.githooks`, so the mutated hook never runs on this worktree's commits.

### Task 3: drop the obsolete minimum tree

Delete the `scripts/lib/`, `conductor.mjs` and bucket-dir lines from both builders. The claim is
proven only when these pass: every `runHookAgainstFixture` caller (conductor-09 IX-*), every
`hookedRepo`/`hookedGit` caller, and a functional certify.

### Required task items (CLAUDE.md "The gate procedure")

1. **Call-site sweep.** The rg above gives the five sites. After Task 2, the same rg must find no
   hand list in `scripts/test/fixtures/` or `scripts/test/functional/`. One site is deliberately left
   out: `RUNNER_CODE`, justified above. The assertion tests that spell these names are asserting,
   not copying, and they stay.
2. **Inverses.** The derivation adds paths when a hook step or import appears, and drops them when one
   is removed, because it is recomputed on every call. No inverse is missing.
3. **Verify against the commit.** Run `git show --stat <sha>` after every task commit, and check that
   every claimed file is in it.
4. **Commit coupling.** The functional files that change are `conductor-09`, `certify-index` and
   `drift-script`. Their subjects are untouched (fixture construction only), so each carries a
   `Twin-Unchanged` trailer. `helpers.mjs`/`certification.mjs` are in the functional subject: certify
   functional before those commits.
5. **Route what was learned.** The `/pm:feedback` filing the epic asks for is handed to the orchestrator
   (this worktree does no conductor writes). This is internal test tooling, so no README or docs-site change.
