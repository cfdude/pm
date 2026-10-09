* **pm can now tell you which epic, phase, role and model the tokens went to — opt-in, off by default.**
  `set-spend-tracking on|off` turns on a local, read-only ledger built from Claude Code's own transcript files
  (`spend` is the only reader; no hook reads a transcript, and a repo with tracking off pays nothing new on
  any hot path). It stores counts and identifiers only, never prompt or response text, folds the 2-3 transcript
  entries one API message is written as, and discovers the repo's `--claude-worktrees-agent-<id>` sessions.
  Sub-agents are attributed by a `pm-spend: epic=<id> role=<role> phase=<phase> [round=<n>]` line the rules block
  asks you to begin each dispatch prompt with (the block carries that section only while tracking is on);
  orchestrator spend by an active-epic timeline the engine records; the rest is reported as **unattributed**,
  by reason, with a coverage share, so unmeasured spend never looks like zero. `spend [--epic] [--since]
  [--until] [--json] [--no-ingest]` reports per-epic totals by actor, role, phase, gate round and model tier;
  it computes no cost (pm ships no price table). Every write has an inverse: `spend --clear --yes`,
  `spend --rebuild --yes` (keeps rows whose transcript Claude Code has pruned), `spend --clear --timeline --yes`,
  each printing its plan without `--yes`. The ledger lives in the main working tree's git-ignored
  `.conductor/spend/`. `upgrade` lists the switch as `NOT SET` until you opt in. See `commands/spend.md`.
