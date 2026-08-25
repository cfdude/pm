---
lesson: worktrees-with-claude-agents
date: 2026-08-25
trigger: About to run Claude agents in git worktrees, or about to kill an agent that is running a test suite in one.
cost: A full machine freeze — a shell builtin (`echo`) produced ZERO bytes over 140 seconds, twice. Two worktree agents lost, ~40 minutes of recovery, and two orphaned worktrees left behind that can stop every Claude Code instance from starting. The maintainer reports the same class of failure on every prior worktree attempt.
rule: Worktrees fix CORRECTNESS, not RESOURCE contention. One writing agent per machine when the suite is expensive. Always run the preflight and the postflight — scripts/wt-preflight.sh and scripts/wt-cleanup.sh.
enforced_in: scripts/wt-preflight.sh, scripts/wt-cleanup.sh; detect matcher on worktree creation
detect: {"tool":"Bash","commandMatches":"(^|[;&|]\\s*)git worktree add"}
tags: [git, worktrees, subagents, concurrency, outage]
---

**What worktrees DO fix.** Wave 2 put three agents in one checkout: `.git/index.lock` serialised them,
`COMMIT_EDITMSG` crossed messages between trees, and one agent's `git commit --amend` erased
another's commit. Worktrees eliminated all three — separate index, separate `COMMIT_EDITMSG`,
separate HEAD. That part worked exactly as advertised.

**What they do NOT fix.** Two agents each running an 18-file suite with `--test-isolation=process`,
where nearly every test shells out to the CLI, took the machine to a state where a shell could not
start. The isolation was perfect and irrelevant.

**Root cause: not established.** Investigated after recovery and could not prove it:

- The hang was in **shell startup** — `echo`, a builtin touching no files, wrote zero bytes twice.
  The Bash tool sources a snapshot on every invocation, which registers starship `precmd` hooks.
- A **stale `.git/index.lock`** existed, dated 23:57 — the freeze minute. Its removal was required
  before any git command worked again.
- **Ruled out:** process-table exhaustion (1227 of 10666 in use), memory pressure and jetsam (no
  events logged in the window, 53% free after), and starship alone (28ms, and it honours its
  `command_timeout = 2000`).

Post-hoc process counts cannot recover the state at freeze time. **That is the real finding:** this
class of failure is undiagnosable after the fact, so the fix is instrumentation, not theory.

**Why worktrees are implicated even without proof.** Worktree work is exactly the git activity most
likely to leave a stale `index.lock` when a process is killed — and every shell afterwards that
touches git state inherits the block. Whatever the trigger, the recovery cost lands on worktrees.

**The procedure.** `scripts/wt-preflight.sh` refuses to create a worktree when a stale lock exists or
a suite is already running; `scripts/wt-cleanup.sh` removes, prunes and verifies, and is safe to run
blind after a crash. Run cleanup even if the session died — an orphaned worktree can stop every
Claude Code instance from starting, and `claude-fix` is the recovery.
