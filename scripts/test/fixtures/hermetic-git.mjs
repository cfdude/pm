// HERMETIC GIT FOR THE TEST SUITE — a side-effect module, imported first by helpers.mjs and by any
// test file that spawns git without importing helpers.
//
// Every fixture here runs `git init` and `git commit` in a throwaway temp repo, and git reads the
// DEVELOPER'S global config while doing it. Two keys in that config turned the suite into a
// measurement of the machine rather than of the engine:
//
//   init.templateDir — `git init` copies the template's hooks into every fixture, so every fixture
//   commit ran whatever pre-commit the developer installs globally. On the maintainer's machine
//   that is a secret scanner (TruffleHog + Trivy) per fixture commit. Under load it timed out
//   inside those temp repos — "semaphore acquire: context deadline exceeded" on a fixture's
//   `.conductor/render-stamp.json` — and 92 of 1313 tests failed on `git commit -q -m baseline`
//   with nothing wrong in the engine. CI has no template directory, so CI never saw it.
//
//   commit.gpgsign — every fixture commit was signed with the developer's key.
//
// `GIT_TEMPLATE_DIR` outranks `init.templateDir` (and `--template` outranks both, so a test that
// wants a template can still pass one). An EMPTY value copies nothing — measured, not assumed.
// Signing is forced off through git's environment config, which outranks global and system
// config and reaches every child process that inherits `process.env`, which `run()` does.
//
// What this deliberately does NOT touch: `core.hooksPath`. Tests that exercise the real
// `.githooks/pre-commit` install it into their fixture explicitly, and must keep working.
//
// AUTOMATIC MAINTENANCE IS OFF (emitted-invocations-copy-flake). A porcelain `git commit` ends by
// running `git maintenance run --auto`, which DETACHES unless `maintenance.autoDetach` (falling back
// to `gc.autoDetach`) says otherwise. The functional harness points GIT_CONFIG_GLOBAL at /dev/null
// (fixtures/git-gateway-repo.mjs, 0.47.0), which hid the maintainer's `gc.autodetach=false`, and CI
// never had one — so every fixture commit left a daemon that took and dropped
// `objects/maintenance.lock` AFTER the commit returned. A fixture copied in that window failed:
// `functional/emitted-invocations`' `remedyRepo()` hit ENOENT in `fs.cpSync` on about one functional
// certify in three (the JS walk names the file: `lstat …/.git/objects/maintenance.lock`), and an
// exit-time `removeAtExit()` walk can meet the same file. `maintenance.auto=false` stops the run;
// `gc.auto=0` covers a git old enough to run `gc --auto` from commit instead. A test that wants
// maintenance can pass `git -c maintenance.auto=true`: `-c` outranks this environment config
// (measured), which itself outranks every config file.

process.env.GIT_TEMPLATE_DIR = "";
process.env.GIT_CONFIG_COUNT = "4";
process.env.GIT_CONFIG_KEY_0 = "commit.gpgsign";
process.env.GIT_CONFIG_VALUE_0 = "false";
process.env.GIT_CONFIG_KEY_1 = "tag.gpgsign";
process.env.GIT_CONFIG_VALUE_1 = "false";
process.env.GIT_CONFIG_KEY_2 = "maintenance.auto";
process.env.GIT_CONFIG_VALUE_2 = "false";
process.env.GIT_CONFIG_KEY_3 = "gc.auto";
process.env.GIT_CONFIG_VALUE_3 = "0";
