---
lesson: git-commit-takes-the-whole-index
date: 2026-08-23
trigger: About to commit while any other process (subagent, watcher, script) may be staging files.
cost: One task's entire implementation landed inside a commit labelled as unrelated bookkeeping, leaving the release's own verify-against-the-commit remedy nothing to audit for that task. Happened twice.
rule: Never run a bare `git commit` while another process may be staging. Use `git commit -- <paths>`, or check `git diff --cached --stat` immediately before.
enforced_in: subagent brief template (hard constraint)
tags: [git, subagents, concurrency]
---

**Cause.** `git add -A <path>` is correctly scoped. `git commit` is not — it commits **the whole
index**, including anything another process staged in the meantime.

It happened to me while committing a scope ruling (swallowing a subagent's task), and again in the
other direction when a subagent's `git add -A` swallowed the file documenting this very lesson.

Best available fix: do not commit at all while an agent is running. Hold orchestrator commits until
a wave boundary.
