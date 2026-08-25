# Commit-trail integrity — read this before running task 16.2

Task **16.2** verifies that every file a task claims appears in **that task's commit**. Three
episodes of git damage during implementation left parts of that trail imprecise. This file records
them so 16.2 reports a **known** imprecision rather than failing on damage it cannot distinguish
from a real gap — and so it does not pass over one either.

**Nothing was lost.** Every implementation is on the branch and the suite is green. What is damaged
is attribution.

## 1. Crossed commit messages — three commits carry another agent's subject

Three agents shared one checkout for wave 2. `COMMIT_EDITMSG` is a **single file per worktree**, so
concurrent `git commit` runs wrote each other's messages while committing their own trees.

Three subjects appear twice on the branch:

- `feat(engine): the freshness watermark — externalUpdatedAt on every epic-writing surface`
- `feat(sync): make /pm:sync's tracker instructions follow direction`
- `test(engine): the emitter-coherence matrix and the no-local-direction source scan`

**Contents are correct in all six. Labels are not.** 16.2 must verify by **tree**, not by subject.

## 2. Commits carrying more than one task

Where git hunk boundaries could not separate interleaved edits, one commit carries several tasks.
Reported by the implementing agents:

| Commit carries | Reason |
|---|---|
| 5.1 / 5.2 / 5.3 · 5.4 / 5.6 · 6.1 / 6.3–6.6 · 6.8 / 6.9 · 6.2 / 6.10 / 6.11 · 6.7 with 5.5's rendered half | interleaved edits in one file |
| 8.4 + 8.5 (`26b421b`) | both test-only against one fixture |
| 10.9 (inside a gate-verdict commit) · 11.4 (`f165ca3` + `b2fe656`) · 10.12 (`0855e41` + `60c734f`) | split or absorbed |

For these, "the task's commit" is a **set**, not a single sha.

## 3. Orchestrator commits that absorbed agent work

A bare `git commit` after a scoped `git add` commits the **whole index**, including files another
process staged. This happened three times, in both directions:

| Commit | Absorbed |
|---|---|
| `d534b5e` (since split into `e876168` + `f7a1708`) | task 3.6's implementation |
| `60b3972` (task 7.6) | `.claude/hooks/lessons-advisor.mjs`, `.claude/settings.json`, `.claude/skills/lessons/SKILL.md`, `docs/lessons/*` |
| `e282599` (task 9.13) | `docs/lessons/README.md`, `docs/lessons/commit-without-push-is-one-disk.md` |

The absorbed files belong to the lessons lane, not to tasks 7.6 or 9.13. Only `d534b5e` was
repaired; the other two were left rather than rewrite 13 commits of shared history.

## What 16.2 should do

1. **Verify by tree.** `git show --stat <sha>` against the task's `(files: …)` claim. Ignore subjects.
2. **Accept a set of commits** for the tasks listed in §2.
3. **Ignore the absorbed paths in §3** — `.claude/**` and `docs/lessons/**` in `60b3972` and
   `e282599` are not those tasks' files.
4. **Report, do not repair.** Rewriting pushed history to tidy attribution would cost more than the
   imprecision.
5. **A task claiming no files is a finding**, not a pass — that is the vacuous half 16.2 exists to
   close, and it is unaffected by any of the damage above.

## Root causes, recorded as lessons

`docs/lessons/shared-checkout-parallel-agents.md` · `docs/lessons/git-commit-takes-the-whole-index.md`

Both now carry `detect:` matchers, so the PreToolUse advisor surfaces them before the next
occurrence rather than after.
