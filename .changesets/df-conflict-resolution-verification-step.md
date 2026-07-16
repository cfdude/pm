### Added

- **Mandatory post-resolution verification for the epic-hierarchy merge-conflict ladder.**
  After ANY conflict resolution (self-resolved by the orchestrator, via
  `agents/merge-conflict-resolver`, or via an escalated model/`advisor()` opinion), before the
  merge is committed: grep every touched file for leftover `<<<<<<<`/`=======`/`>>>>>>>` markers,
  and run `node -c` on every touched `.mjs`/`.js` file. Either failure means the file is still
  unresolved. This closes a gap found during this repo's own 0.14.0 dogfood run, where a
  resolution removed only the closing conflict markers and left the opening `<<<<<<< HEAD`
  marker in place — caught only by a manual re-grep, not by any required step. Documented in
  `skills/conductor/SKILL.md`'s epic-hierarchy orchestration section and in
  `agents/merge-conflict-resolver.md`'s own reporting contract.
