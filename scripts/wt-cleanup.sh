#!/usr/bin/env bash
# Remove every worktree, prune, and verify. Safe to run blind after a crash — that is the point.
#
# An orphaned worktree can make EVERY Claude Code instance fail to start (see CLAUDE.md).
# Run this even when the session that created the worktree is gone.
set -uo pipefail
REPO="${1:-$(git rev-parse --show-toplevel)}"

if [ -f "$REPO/.git/index.lock" ] && ! pgrep -f "[g]it " >/dev/null 2>&1; then
  printf 'clearing stale index.lock\n'; rm -f "$REPO/.git/index.lock"
fi

git -C "$REPO" worktree list --porcelain | awk '/^worktree /{print $2}' | tail -n +2 | while read -r wt; do
  printf 'removing %s\n' "$wt"
  git -C "$REPO" worktree remove "$wt" --force || printf '  (already gone)\n'
done

git -C "$REPO" worktree prune
printf '\n\033[32mworktrees remaining:\033[0m\n'
git -C "$REPO" worktree list

# Branches a worktree left behind, unmerged, are the next session's confusion.
git -C "$REPO" branch --list 'wt/*' | while read -r b; do
  printf 'leftover branch: %s — delete with: git -C %s branch -D %s\n' "$b" "$REPO" "$b"
done
