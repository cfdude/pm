---
lesson: git-rewinds-restore-tracked-conductor-state
date: 2026-09-16
trigger: You are writing a test fixture that records a conductor write (an attribution, a status, a gate verdict) and later in the same fixture runs `git reset --hard`, `git checkout -f`, `git checkout --orphan` or any other command that rewrites the working tree.
cost: Two tests in commit-nudge-reads-the-whole-move (5.3's amend-then-reset case and 5.3a) failed for a reason unrelated to the engine — the attribution the fixture recorded had silently vanished — and one debug cycle went to proving `update-epic --attribute-commit` worked before the cause was found. A third case (the undone amend) would have passed VACUOUSLY: its assertion was "no withdrawal is printed", which an unattributed commit satisfies for free.
rule: `.conductor/state.json` is TRACKED, so a working-tree rewind restores the committed copy and drops every uncommitted conductor write. Record conductor state AFTER the last git rewind in a fixture, or commit it first — and assert the state you depend on (`attributedCommits` holds the sha) immediately before the step under test.
enforced_in: habit; scripts/test/commit-observation.test.mjs 5.3 asserts the attribution is present before observing, as the worked example
tags: [testing, git, fixtures, false-signal]
---

**Cause.** pm keeps `state.json` in git on purpose — `git restore` is the documented undo. In a
fixture that is also a git repository, every command that makes the working tree match a commit
(`reset --hard`, `checkout -f`, switching to a branch that carries a different copy) quietly takes
the conductor's record back to that commit. Nothing errors: the engine reads a valid, older file.

**Why it looks like an engine bug.** The failing assertion is downstream — "the withdrawal was
printed" — and the missing input (an attribution) is two steps upstream of the git command that
removed it. Reading the hook's output shows `has attributed no commits yet`, which points at the
verb that wrote the attribution rather than at the rewind that erased it.

**The vacuous half is the more dangerous one.** A negative assertion ("prints no withdrawal for
C1") is satisfied by a fixture whose precondition was erased. Assert the precondition right before
the step under test; that turns the silent pass into a loud fixture failure.
