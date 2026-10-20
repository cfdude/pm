* **The rules block's `## Spend guard` section now follows whether a limit is live, after any verb.** Whether a
  spend limit is configured depends on epic status (an epic-layer limit counts only on an epic that is not
  archived), but only `set-spend-guard` refreshed the block. Archiving or removing the only epic holding a limit
  left the "run `spend-guard <epic>` before every review or fix dispatch" instruction in `CLAUDE.md` after the
  limit stopped being live, and un-archiving it left the instruction absent while the limit was live. The dispatch
  wrapper now compares the block on disk with `guardConfigured()` after any state-writing verb and refreshes it
  only when they disagree, so a write that leaves liveness alone rewrites nothing and a refused invocation touches
  nothing. A hook never does this work (it adds no read to a hook path); a liveness change a hook's self-heal made
  is picked up by the next non-hook write. A failed refresh is a warning naming `write-rules`, never a failed verb.
