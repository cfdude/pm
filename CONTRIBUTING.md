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
