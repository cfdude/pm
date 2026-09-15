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

process.env.GIT_TEMPLATE_DIR = "";
process.env.GIT_CONFIG_COUNT = "2";
process.env.GIT_CONFIG_KEY_0 = "commit.gpgsign";
process.env.GIT_CONFIG_VALUE_0 = "false";
process.env.GIT_CONFIG_KEY_1 = "tag.gpgsign";
process.env.GIT_CONFIG_VALUE_1 = "false";
