# emitted-invocations-copy-flake — fixture commits spawn a DETACHED git maintenance daemon

## Goal

`functional/emitted-invocations`' first Layer B test (`archived-with-zero-ticked-tasks`) fails about
one functional certify in three with `ENOENT … <tmp>/pm-test-*/.git/objects` inside `fs.cpSync`
(`remedyRepo()`). Fix the cause so that no fixture repository has a background git process writing
into it after the fixture step returned. Not a retry.

## Root cause (verified 2026-09-29, before writing any fix)

1. **Reproduced.** `scratchpad/stress/file.sh` runs the test file N-way parallel with
   `--test-name-pattern="^Layer B integrity:archived-with-zero"` (so the only work before the copy is
   building the template). Native `cpSync`: 3/24, 1/24, 1/36, 2/36, 1/48, 3/72 processes failed.
   Always the same test, always the error path `<copy>/.git/objects` — Node's native
   `CpSyncCopyDir` reports the DESTINATION parent for an entry-level failure, which is why the
   message never named the entry.
2. **Named the entry.** The same run with `filter: () => true` (forces Node's JS walk, which reports
   the exact syscall) failed 7/48, every one:
   `ENOENT: no such file or directory, lstat '<TEMPLATE>/.git/objects/maintenance.lock'`.
   The copy listed a lock file in the template's object store and it was gone by the `lstat`.
3. **Named the writer.** `GIT_TRACE2_EVENT` over the same test process shows the template's
   `git commit -q -m "chore: baseline"` spawning `git maintenance run --auto --quiet --detach`.
   A poller on the template's `objects/` saw `maintenance.lock` APPEAR ~600 ms AFTER the commit
   returned, with PPID-1 (daemonized) git processes alive. The copy runs in that window.
4. **Why it detaches here and not in a shell.** `maintenance.autoDetach` defaults to true and falls
   back to `gc.autoDetach`. The maintainer's global config has `gc.autodetach=false`, so a shell
   commit runs `--no-detach` (synchronous). The functional harness chain
   (`functional-harness → harness → fake-git → git-gateway-repo`, since 0.47.0 / 407e4a91) sets
   `GIT_CONFIG_GLOBAL=/dev/null`, which hides that setting, so every fixture commit in every
   functional process daemonizes its auto-maintenance. CI has no such global key at all, so it
   detaches there too. Load stretches the daemon's life, which is why the flake tracks load.
5. **Static copies never fail:** 3,600 `cpSync`s of one settled template, 12-way parallel: 0 failures.

The same daemon can also create the lock while `removeAtExit()`'s exit-time `rmSync` is walking a
fixture, which is an ENOTEMPTY waiting to happen; the fix closes that too.

## The fix

`scripts/test/fixtures/hermetic-git.mjs` — the one module every fixture git process's env comes
from — adds two environment-config keys: `maintenance.auto=false` (porcelain commands never run
`maintenance run --auto`) and `gc.auto=0` (older git, where commit runs `gc --auto` directly).
`GIT_CONFIG_COUNT` 2 → 4. `GIT_CONFIG_GLOBAL=/dev/null` stays: it is correct hermeticity; this pins
the one behaviour it unpinned.

## Tasks

### 1. RED — a fixture commit spawns no maintenance or gc
- [ ] 1.1 `functional/hermetic-git.test.mjs`: commit in a fixture repo under
      `GIT_TRACE2_EVENT=<scratch dir>`; assert no `start`/`child_start` argv names `maintenance` or
      `gc`. Seen failing on today's module (commit spawns `maintenance run --auto`).
- [ ] 1.2 `assert/hermetic-git.test.mjs` (twin): walk `GIT_CONFIG_KEY_n`/`VALUE_n` up to
      `GIT_CONFIG_COUNT` and assert `maintenance.auto=false` and `gc.auto=0` are present, alongside
      the two signing keys. Pure value check, no spawn. Seen failing.

### 2. GREEN — the keys
- [ ] 2.1 `hermetic-git.mjs`: COUNT 4, the two keys, a comment carrying the evidence above.
- [ ] 2.2 Both tests pass. Trace2 over the real test process shows no `maintenance`/`gc` argv.
- [ ] 2.3 Stress rerun (native `cpSync`, unchanged test file): 0 failures where the baseline failed.

### 3. REGRESSION GUARD — mutation proof
- [ ] 3.1 Drop `maintenance.auto` → both tests red. Restore COUNT to 2 → both red. Restore → green.

### 4. Call-site completeness sweep (required)
- [ ] 4.1 `rg -n "GIT_CONFIG_COUNT|GIT_CONFIG_KEY"` over `scripts/` and `.githooks/`: every site that
      sets the env-config list itself. Known: `functional/per-call-roots.test.mjs` `nestedRepo()`
      REPLACES it with COUNT=1 and makes porcelain commits — it drops the new keys. Fix it to spread
      the hermetic env instead of re-declaring it.
- [ ] 4.2 `rg -n "env: \{" scripts/test` for any env object built without `process.env` that runs a
      porcelain commit/merge/pull; list each and why it holds.
- [ ] 4.3 `certify.mjs` `cleanEnv()`: its git steps are `clone --shared`/`checkout-index`/`read-tree`
      class plumbing that runs no auto-maintenance, and every bucket test process imports
      hermetic-git itself. State it.
- [ ] 4.4 Inverse: the operation is "disable automatic maintenance in fixture repos". Its inverse
      (enabling it) has no caller — no test exercises git maintenance — so no helper is shipped. A
      test that ever needs it passes `git -c maintenance.auto=true`: per git-config(1),
      `GIT_CONFIG_COUNT` values override configuration files but are overridden by `-c`. Verify
      that precedence once and state it in the module comment.

### 5. Verify against the commit (required)
- [ ] 5.1 For every task commit: `git show --stat <sha>` lists every file the task claims.

### 6. Siblings (report only unless they share the cause)
- [ ] 6.1 certify-index 1.2 SIGTERM process-lifetime and state-file-refuses-to-guess G2-C1/I2
      lock-timing: state whether either shares this cause, with evidence.

### 7. Route what the work taught (required)
- [ ] 7.1 Name it: a PROCESS lesson candidate (a hermetic env that nulls global config can change
      git's defaults, not only its output) — reported to the orchestrator, not filed from here.
