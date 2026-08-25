---
lesson: shared-checkout-parallel-agents
date: 2026-08-23
trigger: About to run two or more subagents that will each commit to the same git checkout.
cost: ~1M tokens, 4+ hours, one commit rewritten out of existence taking three tasks' implementations with it, three commits carrying another agent's message, ~20 wasted commit attempts, a scrambled per-task audit trail.
rule: Parallel subagents get isolated worktrees or they run serially. Never two agents committing to one checkout.
enforced_in: subagent brief template; CLAUDE.md § Subagents & worktrees
detect: {"tool":"Bash","commandMatches":"(^|[;&|]\\s*)git (worktree add|commit --amend)"}
tags: [git, subagents, concurrency, cost]
---

**Cause.** `.git/index.lock` is held for the whole pre-commit hook (~4 min with a full suite), so
three agents serialise to roughly one commit per hook run. `COMMIT_EDITMSG` is a single shared file,
so concurrent `git commit` runs cross messages between trees. One agent then ran `git commit --amend`
on history another had built on, leaving HEAD importing a function that no longer existed.

None of this is unusual git behaviour. It is what a shared working tree does.

Serial was measurably cheaper than the parallelism saved. Worktrees are the deliberate exception,
not the default — an orphaned one crashes every Claude Code instance.
