---
lesson: commit-without-push-is-one-disk
date: 2026-08-24
trigger: About to dispatch a wave of agents, end a work session, or step away — and the branch is ahead of its remote.
cost: 120 commits and four days of work existed on exactly one disk. Nothing was lost, but a disk failure, a bad reset, or a `git gc` on a detached state would have taken the entire 0.27.0 release. The user asked whether I was pushing; I was not.
rule: Push at every wave boundary and before stepping away. A commit is durable on ONE machine; a push is the backup.
enforced_in: wave-boundary checklist in the orchestrator's own procedure; detect matcher fires when dispatching agents
detect: {"tool":"Bash","commandMatches":"git worktree add"}
tags: [git, durability, backup, orchestration]
---

**Cause.** The pre-commit hook makes committing feel like the safety step — it runs the full suite,
so a green commit reads as "this is saved". It is not. It is saved *here*.

Long autonomous runs make it worse: the branch grows by dozens of commits between human turns, and
nothing in the loop prompts a push. Four days passed with the remote untouched while a 20-issue
release was built on top of it.

**Why the rule is a cadence, not a reflex.** Pushing after every commit fights concurrent agents and
adds noise. The right unit is the **wave boundary** — the moment agents are dispatched or reaped,
which is already the point where the tree is quiet and coherent. That is also the moment worth
protecting, because the next wave will churn it.

The detect matcher fires on worktree creation because that is the reliable signal a wave is starting.
There is no honest matcher for "you have not pushed in a while" at `PreToolUse` — the hook sees one
tool call, not the branch's divergence — so this lesson stays mostly a discipline, and says so.
