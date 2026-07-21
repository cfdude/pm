# Contributing

## Branch workflow

`main` is protected on GitHub (`cfdude/pm`):

- No direct pushes to `main` — all changes land via pull request.
- Required status check: the `test` job in `.github/workflows/ci.yml`
  (`node --test scripts/conductor.test.mjs` plus a syntax check).
- 0 required approving reviews — this is a solo-maintainer repo, so PRs merge once CI is
  green, without waiting on a second reviewer.
- Merge method is squash-only (`allow_squash_merge: true`, `allow_merge_commit: false`,
  `allow_rebase_merge: false` at the repo level) — every PR collapses to one commit on `main`.

Day-to-day work happens on the `dev` branch (created from `main`'s tip). The flow is:

1. Branch from `dev` (or work directly on `dev`) for a change.
2. Push, open a PR from `dev` → `main`.
3. Wait for the `test` CI check to go green.
4. Squash-merge the PR.
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
`node --test scripts/conductor.test.mjs` and blocks the commit on any failure.

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
