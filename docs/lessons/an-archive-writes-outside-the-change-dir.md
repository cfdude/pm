---
title: openspec archive writes the main specs too — stage both halves of the move
trigger: You have just run `openspec archive <change>` and are about to stage or commit the result,
  or you are about to `git reset --hard` / `git checkout -- .` in a tree where an archive ran and its
  output has not been committed yet.
cost: 0.48.0's archive applied its delta specs to `openspec/specs/engine-invocation/` and
  `openspec/specs/suite-certification/`. The commit that recorded the archive (17a1225) staged only
  `openspec/changes`. The spec edits stayed in the working tree until a post-merge
  `git reset --hard origin/main` discarded them. Four ADDED requirements (store seam, CLI-store parity,
  fixture snapshots, rung membership by observable) were missing from the main specs for two days.
  They were found only because the 0.49.0 proposal agent tried to delta against them, and restoring
  them cost a dedicated sync run before Gate 1 could start.
rule: An archive is one move with two halves: the change directory relocating under `archive/`, AND
  every `openspec/specs/<capability>/spec.md` it rewrote. Stage `openspec/` as a whole — or run
  `git status --short openspec/` and stage everything it lists — never `openspec/changes` alone. Before
  any hard reset, `git status --short` must be empty of `openspec/specs/` paths.
enforced_in: Retrieval only, until 0.49.0's docs tasks add the staging line to the release-checklist
  skill's archive step (.claude/skills/release-checklist/SKILL.md).
---

## What happened

`openspec archive` printed "Specs updated successfully" and the working tree held the rewritten main
specs. The commit that followed was written as `git add openspec/changes .conductor PROJECT.md`. That
path list came from the idea that an archive "moves the change dir". Nothing failed and nothing warned:
the specs were just untracked modifications. The hook runs the suite, not `git status`. The post-merge
branch sync then reset the tree to `origin/main`, and the edits were gone.

The 0.47.0 archive did not lose its specs only because a subagent noticed them untracked and staged
them. That was luck, not procedure.

## Why nothing caught it

- `openspec validate --specs` passes on specs that are merely old.
- Gate 2 reviews the change's diff, and the main-spec rewrite lands after the reviewed range by
  construction.
- The archive gate checks dispositions and gate verdicts, not whether the main specs absorbed the
  deltas.
