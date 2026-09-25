# Contributing

## Branch workflow

`main` is protected on GitHub (`cfdude/pm`):

- No direct pushes to `main` — all changes land via pull request.
- Required status check: `test`, an AGGREGATE job in `.github/workflows/ci.yml`. It passes only
  when `node-majors` computed the supported Node majors (every LTS line that is not end-of-life,
  from Node's release schedule; 22, 24 and 26 today) AND every leg of the `test (node N)` matrix
  passed. Each leg runs a syntax check, then all THREE buckets, each with its own count floor:
  `node --test scripts/test/unit/*.test.mjs scripts/test/assert/*.test.mjs` (the per-commit
  assertion half — two RUNGS, one runner invocation), `… functional/*.test.mjs` (real git),
  `… sweeps/*.test.mjs` (the change-triggered bucket). See
  [The dev inner loop](#the-dev-inner-loop) for which rung a new test belongs in.
- 0 required approving reviews — this is a solo-maintainer repo, so PRs merge once CI is
  green, without waiting on a second reviewer.
- Merge method is squash-only (`allow_squash_merge: true`, `allow_merge_commit: false`,
  `allow_rebase_merge: false` at the repo level) — every PR collapses to one commit on `main`.

Day-to-day work happens on the `dev` branch (created from `main`'s tip). The flow is:

1. Branch from `dev` (or work directly on `dev`) for a change.
2. Push, open a PR from `dev` → `main`.
3. Wait for the `test` CI check to go green.
4. **Tag the pre-squash tip and push the tag**, then squash-merge:
   ```bash
   git tag presquash/pr-<n> "$(gh pr view <n> --repo cfdude/pm --json headRefOid --jq .headRefOid)"
   git push origin presquash/pr-<n>
   ```
   A squash-merge collapses the branch into one commit on `main` whose only parent is `main`'s
   previous tip, so every commit on the branch becomes reachable from nothing and is deleted by
   the next `git gc` — default prune expiry, two weeks. `.conductor/state.json` records commit
   shas (`attributedCommits`, and gate verdicts' `baseSha`/`headSha`), so orphaning them leaves
   a record that still reads fine while being unverifiable by anyone. One ref prevents it and
   nothing about `main`'s history changes. See `docs/lessons/squash-merge-orphans-the-evidence.md`.
5. Fast-forward `dev` back onto `main` (`git checkout dev && git merge --ff-only main && git push`)
   so `dev` never drifts ahead of what shipped.

This mirrors the ff-only `dev`/`main` convention used elsewhere in this project's tooling.

## Pre-commit hook (one-time setup)

The full test suite must pass immediately before every commit — not "it passed a few tool
calls ago in the same session." This is enforced mechanically via a checked-in git hook, not
left to memory (a genuinely failing test was committed once already, in 0.16.0, because a
prose reminder alone wasn't enough). One-time setup per clone:

```bash
git config core.hooksPath .githooks
```

After that, `git commit` runs `.githooks/pre-commit` automatically, which runs the DRIFT SCRIPT
(`node scripts/test/drift.mjs`, four checks over the index — enrolment, twin coverage, diff
coupling, record freshness) and then the ASSERTION HALF — BOTH of its rungs, in ONE runner
invocation:
`FORCE_COLOR=0 node --test --test-reporter=spec scripts/test/unit/*.test.mjs scripts/test/assert/*.test.mjs`
— and blocks the commit on any failure. **It tests the INDEX, not your working tree** (0.50.0): the
hook exports exactly what is staged — `git checkout-index -a` into a private directory under
`$TMPDIR` — and runs the half there, so a failing test you staged cannot pass on the strength of a
fixed copy you left unstaged, an untracked test file neither runs nor counts, and a partially
staged file is tested as its staged half. It honours the index git hands it, so `git commit -a`
and `git commit <path>` are tested as what they commit. It never writes your working tree or your
index, so an interrupted hook cannot lose work; the snapshot is removed on exit, Ctrl-C included.
The drift script that runs first is the snapshot's own copy, and every set it judges (certified
modules, test ids, conformance rows) is read from that index too. One known limit: a tracked
symlink is exported as a symlink, so an absolute one still reads outside the index — this repository
tracks none.
To run the suite over your working tree instead, run the command above yourself. The reporter is forced and colour is off so the summary is
the same bytes on every supported Node, and a count the hook cannot read, or a run of zero tests, is
a refusal rather than a pass. The drift script refuses, naming the file: a tracked
test file in NEITHER half
(no test runs it — enrol it), a functional test with no assertion twin of the same id, a
functional test or its twin changed without a fresh certification record, or a certified
module whose staged content no longer matches the record. The functional half and the sweep
bucket are triggered, not per-commit: CI runs them, and
`node scripts/test/certify.mjs functional` / `… sweeps` is what records a passing run when
you ran one locally. To satisfy a refusal, run the command it names.

## The dev inner loop

### Quickstart — clone, then test. There is no install step, and that is a decision

```bash
git clone https://github.com/cfdude/pm && cd pm
git config core.hooksPath .githooks        # the one-time setup above
node --test scripts/test/unit/*.test.mjs scripts/test/assert/*.test.mjs
```

pm supports the Node LTS lines that are not end-of-life — **Node 22+** today. The engine's own
`NODE_FLOOR_MAJOR` (`scripts/lib/runtime-support.mjs`) is where that number lives.

**`npm i` is not a step here, and it FAILS if you run it**: `npm error code ENOENT … Could not
read package.json`. `package.json` does not exist in this repository, and adding one so that the
quickstart could read `clone → npm i → test` was considered and declined — the engine is
zero-runtime-dependency (a hard constraint in `CLAUDE.md`), the suite is plain `node --test` over
Node's own built-ins, and a manifest added to make an install a no-op would carry nothing but its
own existence while removing the evidence that the zero-dependency claim is still true. Dev-only
dependencies ARE permitted by the amended hard constraint; if one is ever needed, the manifest
lands with it, and this section is where the install step appears.

**Verified by running it rather than described** (2026-09-24, a fresh clone of `a848988`, 16 CPUs,
darwin-arm64): on the support floor, Node v22.23.3, the command above reaches
`# tests 1296 / # pass 1296 / # fail 0` in **14.0 s**; on Node v26.9.0 (Homebrew) it reaches
`ℹ tests 1296 / ℹ pass 1296 / ℹ fail 0` in **18.0 s**. No install of any kind — clone, `config`,
test in well under a minute, and the time is the per-commit half itself rather than any setup
around it. (22's default reporter is TAP, 24's and 26's is spec; add `--test-reporter=spec` for the
same summary on every major.)

### `node --test --watch` — the loop

Both rungs in one runner invocation, the same file set the pre-commit hook runs — this runs your
working tree's copy; the hook runs the index's:

```bash
node --test --watch scripts/test/unit/*.test.mjs scripts/test/assert/*.test.mjs
```

That re-runs the whole half (~14–18 s on 16 CPUs) on every save. **While you are working on one file, name it**
— the unit rung's files are sub-second and most of the file rung's are too, so the loop is fast
enough to leave running:

```bash
node --test --watch scripts/test/assert/<file>.test.mjs
```

The runner gives every file its own process and runs up to CPUs−1 of them at once — on every
supported Node that measured about half the wall clock of the single-process mode 0.47.0 used,
which 0.49.0 retired. On a small machine, or to leave cores free, throttle it with
`--test-concurrency=<n>` (e.g. `node --test --test-concurrency=2 scripts/test/unit/*.test.mjs
scripts/test/assert/*.test.mjs`).

### Which rung does my new test belong in?

**By what the test OBSERVES, never by how fast it is.** The assertion half has two rungs, and a
test's rung is derived from its PATH — `scripts/test/unit/` or `scripts/test/assert/` — never
declared inside the file.

| the test's observable | rung | where |
| --- | --- | --- |
| a VALUE the engine produced — a verb's result, a refusal's wording, an exit status, anything `state.json` holds | **unit** | `scripts/test/unit/` |
| BYTES on disk — a rendered file's parity, the write-conflict log, the record FILE itself, a file that must be unparseable, a file the store does not own | **file** | `scripts/test/assert/` |

**The direction that is easy to get backwards:** a test asserting what the RECORD SAYS belongs to
the unit rung even though the value is persisted in a file. Reading `state.json`'s values back out
of an object is the unit rung's job; it is the test that needs BYTES that stays on the file rung.
This is not a nicety — 1,016 of the half's 1,243 tests (82%) assert on `state.json`'s values, and
a rule that put them on the file rung would leave the suite paying a durability flush per assertion.

The two are written differently and assert identically:

- **unit** — `memoryEngine(emptyRecord())` from `scripts/test/fixtures/unit-harness.mjs`, driven
  with `engine(args)` / `engine.result(args)` / `engine.combined(args)`. Declare the test with
  `unitTest(name, fn)` rather than `node:test`'s `test()`: the wrapper resets and then asserts the
  filesystem-work counter around each test, and a test that did that itself could forget the assert.
- **file** — `tmpRepo()` and `run(args, { cwd })` from `scripts/test/fixtures/assert-harness.mjs`.

Both hang off the same git double and the same in-process invocation, because the unit rung IS the
assertion half — a rung, not a third half. **Moving a test between rungs keeps its assertions
unchanged**; only the mechanism it obtains its values through moves.

### What the unit rung's guard refuses

`scripts/test/assert/assert-half-has-no-spawn.test.mjs` walks both rung directories on every run
and fails, naming the file and the call shape it found, when one:

- **imports `node:child_process` or calls a spawner** — `spawnSync`, `spawn`, `execFileSync`,
  `execFile`, `execSync`, `exec` — in EITHER rung. No TEST in the assertion half starts a process
  or runs real git (only the runner starts one process per file); a single `spawnSync` added "just
  for one real git call" takes that back for the whole half, and nothing else would say so.
- **does not install the run-time git counter itself** — every file in either rung imports
  `scripts/test/fixtures/assert-git-shim.mjs` (directly, or through `assert-harness.mjs` /
  `unit-harness.mjs`). Each file runs in its own process, so a counter another file installed
  covers nothing here.
- **performs filesystem work AT ALL** — this one is the unit rung's alone. A file under
  `scripts/test/unit/` may not import `node:fs`, may not read, write, create or remove a path, and
  may not flush a file to disk. That is the property the rung exists for (the half's cost was
  measured as durability flushing, ~12,524 `fsyncSync` calls per run), so a unit file that has
  drifted into disk work fails loudly instead of merely running slowly.

The guard strips comments first, so naming the prohibition in a header is not a violation — a
guard a comment can trip is a guard that gets weakened the first time someone documents it — and
it is exercised directly by its own second test against a source that imports the module, one that
calls a write, and one that mentions either only in a comment. A second, run-time counter
(`scripts/test/fixtures/fs-work-counter.mjs`) catches a call reached three modules away, which no
scan of the test file can see.

`scripts/test/functional/` and `scripts/test/sweeps/` are NOT rungs of the assertion half — they
are the two TRIGGERED buckets. They do not run per commit: CI runs them, and
`node scripts/test/certify.mjs functional` / `… sweeps` is what records a passing run when you ran
one locally. A drift-script refusal names the command to run.

## Developing pm with pm (required one-time setup)

**This repository is managed by the plugin it ships.** That is deliberate — pm dogfoods itself —
and it creates one problem you have to solve before your first commit, or you will fight it the
way this project's maintainer fought it for a whole release.

### The problem

Every hook and slash command pm ships invokes the engine through `${CLAUDE_PLUGIN_ROOT}`, which
resolves to the **installed** plugin in `~/.claude/plugins/cache/`. When the project you are
working in *is* pm, that engine is behind your working tree. Its `PostToolUse` hook then fires on
every commit and rewrites the tracked `PROJECT.md` using an engine that predates your change —
silently reverting rendering your branch just added, and staging it as an apparent regression if
you use a broad `git add`.

Nothing warns you. The hook is not something you invoke, so there is nothing to doubt.

### The fix — one environment variable, set once

```sh
# in ~/.zshrc, ~/.config/zsh/40-env.zsh, ~/.bashrc — wherever your shell reads
export PM_ENGINE_DELEGATION="$HOME/path/to/your/pm/checkout"
```

With it set, the installed engine hands off to **your checkout's** engine for that one tree, so
hooks and slash commands run the code you are editing.

**It must live outside the repository, and that is not an oversight.** A plugin's reach ends at
the project it is invoked in; it cannot write your shell profile. That boundary is exactly what
makes the variable trustworthy: the value names one checkout and is compared by `realpath`, so
authorization comes from your environment, which a repository cannot reach. A bare `=1` would
authorize the handoff in every project that shell ever opens — do not substitute one.

If you prefer per-project configuration, `.claude/settings.json`'s `env` block is worth testing
for your setup; whether it reaches plugin hook subprocesses has not been measured here.

### Who needs this

**Contributors to pm, and nobody else.** If you *use* pm on your own projects, you never set this
and should not: without it the installed plugin runs its own engine, which is the correct
behaviour. There is no configuration for pm's users to do — this whole section is a consequence
of pm being the thing under development.

Verify it took, from your checkout:

```sh
PM_VERBOSE_ENGINE_BANNER=1 node scripts/conductor.mjs status | head -1
# → conductor: engine <version> @ /your/checkout/scripts
```

## If main moves out from under your PR

The normal flow above assumes every change to `main` comes through a `dev` → `main` PR. That
can be bypassed — a direct GitHub web-UI edit landing on `main` while a `dev`-branch PR is
still open (this happened for real: PR #22, "added light logo", was merged directly to `main`
via the GitHub UI instead of through `dev`). When that happens, `dev` and `main` diverge, and
your open PR's diff is no longer against `main`'s actual tip.

Recover by rebasing `dev` onto the new `main` tip, then force-pushing (this repo is solo-
maintainer, so a force-push to `dev` — never to `main`, which stays protected regardless — is
low-risk, but still confirm nothing else is mid-flight on `dev` first):

```bash
git checkout dev
git fetch origin
git rebase main
git push --force-with-lease
```

`--force-with-lease` (not a bare `--force`) refuses the push if `dev` moved on the remote since
your last fetch, so it won't silently clobber someone else's concurrent work. If the rebase hits
conflicts, resolve them the normal way (`git status` shows the conflicting files; fix, `git add`,
`git rebase --continue`) before pushing.

## Running the EDD evaluation corpus (optional)

pm's engine is covered by the assertion half — `node --test scripts/test/unit/*.test.mjs
scripts/test/assert/*.test.mjs`, both rungs in one runner invocation, once per commit — then
`… scripts/test/functional/*.test.mjs` (real git, on the trigger) and
`… scripts/test/sweeps/*.test.mjs` (the output sweep). That suite cannot cover
pm's *agent-facing* artifacts — command docs, skills, the rules block, hooks — because their
correctness is a non-deterministic judgment made by an agent, not an assertable return value.
Those are covered by an evaluation corpus under `evals/`, built on
[`edd-harness`](https://github.com/cfdude/edd-harness).

**This setup is optional.** You only need it if you are changing an artifact the corpus
evaluates. Contributors touching only the engine, docs, or tests can skip it entirely — pm
itself needs only Node.

### The corpus measures this worktree — no install step needed

**No plugin install is required, and installing one can only get in the way.** The corpus runs
`claude -p` with `--plugin-dir` pointed at this worktree's own root (`evals/runners.py`), which
loads pm's commands, skills, hooks, and rules block directly from the files on disk here — the
same files you're editing. `--plugin-dir` *adds* a session-scope plugin; it does not remove
anything already installed at user scope. So before each run, `evals/fixtures.py`'s fixture
disables every enabled user-scope pm it finds (however it's named or wherever it's installed
from) via `enabledPlugins` in the fixture's `settings.local.json`, and `evals/observe.py`
records provenance for exactly which pm loaded — `plugin_id`, `plugin_install_path`,
`plugin_version`, `plugin_commit`, `plugin_dirty` — so a run that somehow measured the wrong
copy fails loudly (`plugin_id: None`) instead of silently.

The practical consequence: an edit to a command doc, an agent, a skill, or a hook is **live on
the very next run** — no `/plugin install`, no version bump, no restart. If you *do* have pm
installed from the marketplace for your own interactive use, leave it installed; the fixture
switches it off for the duration of each corpus run and your interactive sessions are
unaffected.

If you want to confirm which commit and version the corpus is currently measuring:

```bash
git rev-parse HEAD
jq -r .version .claude-plugin/plugin.json
```

**The committed `evals/.edd/baseline.json` is stale by construction.** It was blessed against
an installed marketplace copy of pm, from before `--plugin-dir` existed — it does not describe
this worktree and must be re-blessed before its comparisons mean anything.

When you re-bless, record provenance in the label — the baseline format has no dedicated
provenance field, so the label is the only place this survives:

```bash
uv run edd bless .edd/runs/<run>.jsonl --label "pm <version> @ <sha>"
```

### One-time setup

```bash
# 1. Python 3.13 + uv (Homebrew: brew install uv)
uv --version

# 2. Clone edd-harness as a sibling of this repo -- evals/pyproject.toml resolves it
#    from ../../edd-harness via [tool.uv.sources], so `uv sync` will fail if this
#    isn't done first
git clone https://github.com/cfdude/edd-harness ../edd-harness

# 3. Install the corpus's dependencies (from the repo root)
cd evals && uv sync
```

### Judge backend (only for judge scorers)

Every scorer in the current corpus is deterministic — it asserts on `.conductor` state, so it
needs no LLM. Only a `JudgeScorer` would. If you add one and need to run it, start a local
Ollama server:

```bash
ollama serve
```

The judge model **must differ from the model under test**, so a model never grades its own
homework. Local models are the flat-cost default; never point the judge at a metered API key.

### Running

Every `edd` invocation below needs `PYTHONPATH=.` — the `edd` console-script's `sys.path[0]`
is the venv's `bin/` directory, not the current working directory, so `corpus` (a plain
top-level module in `evals/`) can't be imported without it. Don't drop the prefix; a bare
`uv run edd run corpus:SCENARIOS ...` fails immediately with
`ModuleNotFoundError: No module named 'corpus'`.

```bash
cd evals
uv run pytest                                                                     # fast unit tests, no agent calls
PYTHONPATH=. uv run edd run corpus:SCENARIOS --model pm@claude-code --no-judge --samples 1   # one real run
PYTHONPATH=. uv run edd run corpus:SCENARIOS --model pm@claude-code --no-judge --samples 1 --baseline   # gate vs baseline
```

⚠️ **Both `--samples 1` lines above are for fast iteration only — never bless a run produced
by them.** See [Blessing a new baseline](#blessing-a-new-baseline) below: a bless must come
from at least 3 samples, and `baseline.json` has no way to record that it didn't.

**Each scenario sample costs roughly 45-110 seconds of wall-clock** (measured across four real
runs), because it spawns a real headless agent session. Use `--samples 1` and `--tags` while
iterating. This is why EDD is a deliberate gate rather than a pre-commit hook. Reported
`total_cost_usd` figures are **notional** under Claude subscription auth — an equivalent-API
estimate, not billed spend.

### Blessing a new baseline

`evals/.edd/baseline.json` is committed on purpose — its diff is the drift review. Re-bless
only when a behavior change is *intended*, and say why in the commit message:

**Bless only from a run of at least 3 samples** (each scenario's declared `samples` count).
`--samples 1` — as shown in the Running block above — is for fast iteration *only*; never bless
from it. `baseline.json` records just `{kind, status}` per check, with no sample count, so a
1-sample bless produces a git diff that is **shape-identical** to a 3-sample bless. The artifact
whose diff *is* the drift review would silently lose its statistical power with no visible
trace, and a flaky behavior that happens to pass once would be enshrined as expected. Drop the
`--samples` flag entirely to use each scenario's declared count:

```bash
PYTHONPATH=. uv run edd run corpus:SCENARIOS --model pm@claude-code --no-judge   # 3 samples
PYTHONPATH=. uv run edd bless .edd/runs/<run>.jsonl --label "<why this is the new expected behavior>"
```

State the sample count in the commit message, since the artifact itself cannot record it.

## What you inherit when you fork this repo

This repo plays two roles at once: it's the plugin's source code, and it's itself a project
managed by that plugin (`pm` dogfoods itself here — see `CLAUDE.md`). That means a fork of
`cfdude/pm` comes with more than just code:

- **`.conductor/state.json` and `PROJECT.md`** carry the maintainer's live backlog — every
  epic, story, and detour from developing `pm` itself. This is left as-is deliberately, not an
  oversight: it's a real, running example of what the plugin produces, and if you're
  contributing back to `cfdude/pm` you generally want the same shared context the maintainer
  has, not a blank slate.
- **The GitHub issue tracker is pre-configured** (`.conductor/state.json`'s `tracker` block)
  to `cfdude/pm` — the *upstream* repo, not your fork. That's intentional: `/pm:sync` will
  pull open issues from `cfdude/pm` into your local conductor state, which is exactly what you
  want if your goal is a PR back to upstream. If you instead intend to maintain your fork as
  its own independent project long-term, repoint it with
  `node scripts/conductor.mjs set-tracker --system github-issues --repo <your-org>/<your-repo>`.
- **The project-local skills** (`.claude/skills/release-checklist`, `pr-workflow`,
  `mintlify-doc-sync`) are repo-maintenance tooling for developing `pm` itself, not something
  the plugin ships to consumers. `release-checklist` and `pr-workflow` apply to your fork as
  much as upstream. `mintlify-doc-sync` won't work for you as written — it pushes to the
  maintainer's `cfdude/pm-docs` Mintlify deployment, which you won't have access to. If a
  change you're making warrants a docs update, either flag it in your PR description for the
  maintainer to sync, or open a separate PR against `cfdude/pm-docs` directly (a plain GitHub
  repo, no Mintlify account needed to submit a PR to it).
