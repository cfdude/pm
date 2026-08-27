# Contributing

## Branch workflow

`main` is protected on GitHub (`cfdude/pm`):

- No direct pushes to `main` — all changes land via pull request.
- Required status check: the `test` job in `.github/workflows/ci.yml`
  (`node --test scripts/test/*.test.mjs` plus a syntax check).
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

After that, `git commit` runs `.githooks/pre-commit` automatically, which runs
`node --test scripts/test/*.test.mjs` and blocks the commit on any failure.

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

pm's engine is covered by `node --test scripts/test/*.test.mjs`. That suite cannot cover
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
