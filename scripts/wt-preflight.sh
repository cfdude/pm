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
# A CAP, not a ban. This refused on any existing worktree, citing the outage as its evidence;
# that outage's leading explanation is now a denied macOS TCC prompt, not concurrency
# (docs/lessons/tcc-denial-breaks-getcwd.md), so a blanket ban is stricter than the evidence
# supports. What genuinely does not scale is the suite, and that is now serialized by a lock in
# .githooks/pre-commit rather than by forbidding a second tree. Override with WT_MAX.
n=$(git -C "$REPO" worktree list | wc -l | tr -d ' ')
existing=$((n - 1))
[ "$existing" -ge "${WT_MAX:-3}" ] && fail "$existing worktree(s) already exist, cap is ${WT_MAX:-3} — run scripts/wt-cleanup.sh first."

printf '\033[32mOK:\033[0m clean to create a worktree.\n'
git -C "$REPO" worktree list
