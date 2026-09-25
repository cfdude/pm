---
lesson: a-commit-gate-must-read-the-index-git-hands-it
date: 2026-09-25
trigger: You are writing or editing a git hook, or any gate that runs "before a commit" — a test run, a lint, a drift check, a count — and it reads files from the checkout, or it scrubs `GIT_*` environment variables before doing its work.
cost: pm's pre-commit hook ran the suite over the WORKING TREE from the day it landed (a268cd1, 2026-07-19) through 0.49.0 — every release from 0.20.0 to 0.49.0, 35 of them (counted from CHANGELOG.md) — so a failing test that was staged, with a passing copy left unstaged, committed green while HEAD held the failure (code review 0.43.0, E2). Fixing it exposed a second hole of the same kind: the hook has unset GIT_INDEX_FILE since that same commit, and under `git commit -a` and `git commit -- <paths>` git hands the hook a different index (`.git/index.lock`, `.git/next-index-<pid>.lock`) while `.git/index` is stale. That became a wrong READ in 0.47.0 (407e4a9, 2026-09-21), when the drift check and the floor's `git ls-files` count started reading the index — 0.47.0 to 0.49.0, 3 releases — and it hit exactly the commit form `git-commit-takes-the-whole-index` RECOMMENDS. Neither hole failed a gate, because a gate that verifies the wrong bytes still produces a green result.
rule: A commit gate verifies the bytes being COMMITTED. Capture GIT_INDEX_FILE BEFORE any env scrub and make it absolute; export that index (`git checkout-index -a --prefix=<tmp>/`) and run there; read counts from the export, never the working tree; hand the captured index to every index reader but never to child processes the scrub exists to protect. Never stash to get there — a stash writes the working tree, fails before the first commit, and uses a stash stack every worktree shares.
enforced_in: scripts/test/functional/conductor-09.test.mjs IX-a…IX-g (staged-failing/unstaged-passing aborts; an alternate GIT_INDEX_FILE is honoured) and the IX shape test in scripts/test/assert/conductor-09.test.mjs. Beyond this hook, a habit.
tags: [git, hooks, verification]
---

**Cause.** A hook runs in the working tree, and the working tree is what is easy to read. The commit
is the index — and not always `.git/index`. Measured with git 2.55.0 in a scratch repository:

| Commit form | `GIT_INDEX_FILE` in the hook | `.git/index` after an `unset` |
|---|---|---|
| `git commit` | `.git/index` (relative) | the commit's content |
| `git commit -a` | `<abs>/.git/index.lock` | stale |
| `git commit -- <path>` | `<abs>/.git/next-index-<pid>.lock` | stale |
| linked worktree | `<common>/worktrees/<name>/index` | the commit's content |

**Why nothing noticed.** Every gate downstream reads the same wrong thing or reads nothing: the suite
passed, the count matched, drift was clean. The defect is visible only to a fixture that makes the
index and the working tree DISAGREE and asserts which one won — IX-a, and IX-d for the env half.

**The plan that compares the options, with measurements:**
`docs/superpowers/plans/2026-09-25-commit-gate-tests-working-tree-not-index.md`.
