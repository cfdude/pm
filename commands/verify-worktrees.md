---
description: Flag hierarchy-dispatch worktrees that were never cleaned up after their work landed
allowed-tools: Bash, Read
---

Epic-hierarchy orchestration runs each child epic in its own git worktree on a branch named
`hierarchy-child/<epic-id>`. A worktree left behind after its work landed keeps its branch checked
out and its directory on disk. `verify-worktrees` lists the ones whose work has ended. It is read-only: it flags and never deletes, because a
worktree could still hold work the bookkeeping has not caught up with.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" verify-worktrees
```

If `${CLAUDE_PLUGIN_ROOT}` is empty:
`ENGINE="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/conductor.mjs}"; [ -f "$ENGINE" ] || ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1); node "$ENGINE" verify-worktrees`

It prints one JSON document, `{ "orphaned": [{ "path", "branch", "epicId", "reasons" }] }`. A
worktree is flagged for either reason, and `reasons` names which:

- `epic-archived` — the epic the branch is named for is archived;
- `branch-merged` — the branch tip is already an ancestor of the current `HEAD`, whatever the epic's
  status says (the case where `git branch -d` failed with "used by worktree" after the merge).

Only `hierarchy-child/*` branches are considered; any other worktree is yours and is never listed.
Outside a git repository — when git itself answers "not a git repository" — it prints
`{ "orphaned": [] }` rather than failing: there are no worktrees there. Any other failure to list
them (an older git, dubious ownership, a corrupt repository, git missing from PATH) is refused with
git's own message instead of an empty list; it reads `git worktree list --porcelain -z`, which
needs git 2.36 or later.

To clean up a flagged worktree: `git worktree remove <path>`, then `git worktree prune`, then
`git branch -d hierarchy-child/<epic-id>`.
