- **Added a mechanical test that catches README.md "Commands" drift from the real dispatch
  table**, mirroring the existing SKILL.md drift test. Running it against the current docs
  caught 8 real gaps (`commit-nudge`, `log-detour`, `honcho-memory`, `set-review-mode`,
  `verify-state`, `write-rules`, `snapshot`, `changesets`) — several of them genuinely
  undocumented user-facing subcommands (`honcho-memory`, `verify-state`, `changesets`), fixed
  in the same pass. `agents/hierarchy-child-executor.md`'s standing instructions and the
  conductor skill's epic-hierarchy preflight section now explicitly require a README.md update
  (not just SKILL.md) whenever a child epic adds/changes a user-facing command, flag, or
  behavior — the same class of gap that let `record-gate-review` ship in 0.16.0 with zero
  README mention.
