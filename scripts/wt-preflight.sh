#!/usr/bin/env bash
# Preflight before creating a worktree for an agent. Refuses rather than warns.
#
# Written after a machine freeze during two-agent worktree work: a shell builtin produced zero
# bytes for 140s, both agents were lost, and a stale .git/index.lock from the freeze minute had to
# be cleared by hand before any git command worked. Root cause was never established, which is why
# this checks conditions rather than trusting a diagnosis.
set -euo pipefail
REPO="${1:-$(git rev-parse --show-toplevel)}"
fail() { printf '\033[31mBLOCKED:\033[0m %s\n' "$1" >&2; exit 1; }

# 1. A stale lock makes every later git command hang. Clear it BEFORE adding load, not after.
if [ -f "$REPO/.git/index.lock" ]; then
  if pgrep -f "[g]it " >/dev/null 2>&1; then
    fail "index.lock exists AND a git process is running — wait, do not remove the lock."
  fi
  printf 'stale index.lock (no git process) — removing: %s\n' "$(ls -l "$REPO/.git/index.lock")"
  rm -f "$REPO/.git/index.lock"
fi

# 2. One writing agent at a time when the suite is expensive. This is the rule the outage bought.
if pgrep -f "node --test" >/dev/null 2>&1; then
  fail "a test suite is already running — one writing agent at a time on this machine."
fi

# 3. Never start on top of an orphan; an orphaned worktree can stop Claude Code from starting.
git -C "$REPO" worktree prune
n=$(git -C "$REPO" worktree list | wc -l | tr -d ' ')
[ "$n" -gt 1 ] && fail "$((n-1)) worktree(s) already exist — run scripts/wt-cleanup.sh first."

printf '\033[32mOK:\033[0m clean to create a worktree.\n'
git -C "$REPO" worktree list
