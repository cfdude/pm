---
lesson: stacked-background-commits-collide-on-the-lock
date: 2026-09-08
trigger: About to start a background `git commit` in a repository whose pre-commit hook runs a test suite, when a previous commit may still be running one.
cost: Three commits in a row failed and were reported to the user as landed. The pre-commit suite here takes about two minutes; every commit fired inside that window died on `.git/index.lock`. The wrapper still exited 0 and `git log` printed the PRIOR head, so the failure read as success at every surface checked. It also produced a false diagnosis — the lock was briefly attributed to another session, and ten minutes went into investigating a concurrent writer that was in fact this session's own earlier commit.
rule: Serialize commits when the hook is slow. Before committing, wait until `.git/index.lock` is absent AND no `git commit` and no `hooks/pre-commit` process is running. Then verify the new SHA — `git log --oneline -1` before and after — because a failed commit leaves the old head in place and says nothing.
enforced_in: habit — the wait-then-verify wrapper at `scratchpad/final-commit.sh`; pm's own pre-commit hook already holds a suite lock and prints "another worktree is running the suite — waiting", which is the mechanism this lesson wants and which does NOT cover the index lock. The `detect:` matcher fires on a `git commit` backgrounded with a trailing `&`; a commit started with the Bash tool's `run_in_background` is a tool-input field no matcher reads, so that half stays a habit.
detect: {"tool":"Bash","commandMatches":"(^|[;&|]\\s*)git commit\\b.*[^&]&\\s*$"}
tags: [git, concurrency, false-signal, silent-failure]
---

**Cause.** `git commit` takes `.git/index.lock` for the whole of its run, and with a hook that runs
a test suite that run is minutes, not milliseconds. A second commit started inside that window
fails immediately with `fatal: Unable to create '.git/index.lock': File exists.` Staged content
survives, so the working tree looks correct afterwards and the next `git status` shows the files
still staged — which reads as "not committed yet" rather than "commit failed".

**Why it is reported as success.** Three surfaces all lie in the same direction:

1. The wrapping shell exits 0 if the last command in it succeeds — and `git log --oneline -1`,
   appended to confirm the commit, succeeds while printing the *previous* head.
2. `git status` shows staged files, which is the state both before a commit and after a failed one.
3. A background task's completion notification says the command completed, not that it did what
   it intended.

So the honest-looking check — "run the commit, then print the head" — prints a real SHA that is
simply the wrong one. Confirming a commit requires comparing the head to what it was, not reading
it once.

**The false-diagnosis trap.** A held lock looks exactly like another process working in the
repository, because that is precisely what it is — but the other process may be *you*, two minutes
ago. Check `pgrep -f 'git commit'` and `pgrep -f 'hooks/pre-commit'` before concluding anything
about a concurrent session. In this instance a genuine second session did exist and was editing
different files, which made the wrong explanation fit even better.

**What to do instead.** Wait for a clear index, then commit, then verify the SHA moved:

```bash
for i in $(seq 1 120); do
  [ ! -f .git/index.lock ] && ! pgrep -f 'git commit' >/dev/null \
    && ! pgrep -f 'hooks/pre-commit' >/dev/null && break
  sleep 5
done
before=$(git rev-parse HEAD)
git commit -F msg.txt || exit 1
[ "$(git rev-parse HEAD)" != "$before" ] || { echo "commit did not land"; exit 1; }
```

Never remove a lock file to get past this. It is held by a real process often enough that removing
it corrupts the index, and the wait costs less than the recovery.

Related: [[git-commit-takes-the-whole-index]] covers what a commit sweeps in when another process
is *staging*; this one covers what happens when another commit is *running*. Both are the same
underlying fact — the index is a single shared resource — pointed at different failure modes.
