---
description: Developer-only per-session log - which pm features were on, request/response composition, tokens, and context-retention warnings
allowed-tools: Bash, Read
---

`dev-log` reads the developer session log (`set-dev-log on`) back, one block per Claude Code session: how many
messages, the first and last time, the token classes and `work`, the BYTE composition of the requests and
responses, which pm features were on, and warnings when a session has been kept alive too long. It is for
someone developing pm or tuning a repo that uses it; the spend ledger (`spend`) answers "which epic spent it".

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" dev-log [--session-id <id>] [--since <iso>] [--until <iso>] [--json] [--no-ingest]
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" dev-log --clear [--yes]
```

If `${CLAUDE_PLUGIN_ROOT}` is empty:
`ENGINE="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/conductor.mjs}"; [ -f "$ENGINE" ] || ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1); node "$ENGINE" dev-log`

| Flag | Effect |
| --- | --- |
| `--session-id <id>` | one Claude Code transcript session. This is NOT `--session`, which is pm's own session identity |
| `--since <iso>` / `--until <iso>` | half-open window `[since, until)` on each message's own time |
| `--json` | machine-readable sessions, warnings and the thresholds |
| `--no-ingest` | report from what is already recorded; read no transcript |
| `--clear` | print what would be removed (only `devlog.jsonl`) and change nothing; with `--yes`, remove it |

With the log off, or with spend tracking off, it prints which switch is off and the verb to run first
(`set-spend-tracking on`, then `set-dev-log on`), and opens nothing under the spend directory or the
transcript directory. `--clear` is refused while spend tracking is off.

## What a block shows

- **tokens**: input, cache-write, cache-read, output and `work`, joined from the ledger row with the same
  message id. A message whose row is gone (after `spend --clear`) reports `tokens: not in ledger`.
- **composition, in BYTES, never converted to tokens**: user text, attachments (system reminders and other
  injected blocks), an image count, tool results per tool name, and the response's text and thinking.
- **features**: which pm features were on, from the latest snapshot at or before the first message, or, when
  none is that old, the earliest (the block says it was taken after the session began). A snapshot that
  changed during the session is named.

## Warnings

Each is a PROPOSAL, printed with its evidence and its threshold.

- `stale-session`: first to last message at least 7 days apart.
- `large-context`: a message whose input + cache-write + cache-read is at least 300,000 tokens.
- `compacted`: the transcript recorded a compaction.

No prompt, response, tool input or tool output text is stored, so none can be shown.
