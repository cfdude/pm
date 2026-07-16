- **The `github-issues` tracker no longer tells the agent to auto-create a GitHub issue for
  every unmirrored local epic.** `rulesBlock()` now suppresses the outward "External tracker
  sync" section entirely when `tracker.system === "github-issues"`, leaving only the existing
  inward "GitHub issue sync" section (open issues → untriaged epics) in effect. Filing a public
  GitHub issue for any local claude-code epic just because a `github-issues` tracker is
  configured is a materially bigger, more consequential default than mirroring toward an
  internal Jira/Linear instance, so `github-issues` is now documented and implemented as
  INWARD-ONLY by design. Jira, Linear, and any other tracker `--system` keep the full
  bidirectional outward-mirror behavior unchanged.
