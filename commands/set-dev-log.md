---
description: Turn the developer session log on or off (developer-only, off by default, needs spend tracking)
allowed-tools: Bash, Read
---

`set-dev-log` is the switch for the developer session log: a per-session record, kept for someone developing pm
or tuning a repo that uses it, of which pm features were on, the SHAPE of each request and response, and the token
breakdown. It is off by default, `init` and `upgrade` never turn it on, and it needs `set-spend-tracking on`
because it is captured by the same ingest, from the same transcript reader, as the spend ledger.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" set-dev-log on|off
```

If `${CLAUDE_PLUGIN_ROOT}` is empty:
`ENGINE="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/conductor.mjs}"; [ -f "$ENGINE" ] || ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1); node "$ENGINE" set-dev-log on`

- `on` is refused while spend tracking is off, naming `set-spend-tracking on`.
- Both directions are refused in a linked worktree and while the main working tree's HEAD is detached: the
  switch and the log belong to the main working tree.
- A repeat writes nothing and says so.
- `off` stops capture and deletes nothing. `dev-log --clear --yes` removes the file.

What is stored: byte COUNTS by kind (user text, tool results per tool name, attachments, an image count, the
response's text and thinking) and identifiers, in `.conductor/spend/devlog.jsonl` (git-ignored with the spend
directory). No prompt, response, tool input or tool output text is stored. Read it back with `/pm:dev-log`.
