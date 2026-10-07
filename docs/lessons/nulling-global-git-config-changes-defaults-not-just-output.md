---
lesson: nulling-global-git-config-changes-defaults-not-just-output
date: 2026-09-29
trigger: You are writing `GIT_CONFIG_GLOBAL=/dev/null` or `GIT_CONFIG_NOSYSTEM` into a test or fixture environment (or an env object handed to a spawned git) to make git's output hermetic.
cost: From 0.47.0 (407e4a91) every fixture `git commit` in the functional half ended in a DETACHED `git maintenance run --auto`, because nulling the global config hid the maintainer's `gc.autodetach=false`. The daemon took and dropped `objects/maintenance.lock` after the commit had returned. `functional/emitted-invocations`' `remedyRepo()` copied its fresh template in that window and failed with ENOENT inside `fs.cpSync` on about one functional certify in three (4 recorded occurrences in one epic). Each was re-run and waved through as "a temp directory removed under a running test" until a stress harness reproduced it (1–7 failures per 24–72 parallel runs). Native `cpSync` reports only the parent directory, so the failing entry had never been named.
rule: A null global config is not a neutral one. It resets every behavioural default the developer's config was pinning (auto-maintenance and its detach, gc, hooks, fsmonitor), not only the keys that shape output. When you null it, pin the behaviours your fixtures rely on in the same env (`maintenance.auto=false`, `gc.auto=0`). Test the pin with the global config nulled too, or a developer whose own config already disables the behaviour passes vacuously.
enforced_in: `scripts/test/fixtures/hermetic-git.mjs` sets `maintenance.auto=false` and `gc.auto=0` in the env config every fixture git inherits. `scripts/test/functional/hermetic-git.test.mjs` ("a fixture commit spawns no automatic maintenance or gc…") reads git's trace2 event stream under a nulled global config. Its twin `scripts/test/assert/hermetic-git.test.mjs` asserts the key/value pairs. There is no `detect:` matcher: the trigger is text written into a file through Edit or Write, and the matcher vocabulary (`pathEndsWith`, `commandMatches`) cannot see file content, so this lesson is retrieval-only.
tags: [git, testing, hermeticity, flake, silent-failure]
---

**Cause.** `GIT_CONFIG_GLOBAL=/dev/null` was added so a developer's `core.abbrev`,
`log.showSignature` or `core.autocrlf` could not change what git PRINTS. It also removed a key that
changes what git DOES. `maintenance.autoDetach` falls back to `gc.autoDetach`, and both default to
true, so every porcelain commit started a background daemon. No test here asks git to do maintenance,
so nothing looked at it.

**Why it hid.** CI never had the key, so it detached there too. It was never a machine difference, and
the race only fires when a fixture is copied or removed within a few hundred milliseconds of its last
commit. Load stretches the daemon's life, so the failure tracked load. That made "flaky under load"
look like the whole explanation. `fs.cpSync`'s native walk reports an entry-level failure against the
DESTINATION parent (`…/.git/objects`), which pointed away from the source repository.

**How it was found.** Re-running `cpSync` with `filter: () => true` forces Node's JS walk, which names
the syscall and the exact path: `lstat <template>/.git/objects/maintenance.lock`. `GIT_TRACE2_EVENT`
over the test process then showed `maintenance run --auto --detach`. A shell commit on the same machine
showed `--no-detach`. That difference is the whole bug.
