---
description: Make the conductor aware of an external issue tracker (Jira/GitHub/Linear) this project uses
allowed-tools: Bash, Read
---

Record (or update) the external **tracker** this repo mirrors conductor epics to. This makes the
conductor *tracker-aware*: the CLAUDE.md rules block gains an "External tracker sync" section and
the SessionStart brief surfaces epics not yet mirrored. **The plugin never calls the tracker** —
it only shapes the instructions YOU (the interactive agent) act on, with whatever tooling the
project uses (a Jira MCP server, an Atlassian connector, a CLI, a Python lib — it does not matter).

## Detection (run this when the user asks to connect a tracker, or during `/pm:init`/`/pm:upgrade`)

1. Look for signals that this project uses a tracker:
   - a connected Jira/Atlassian/Linear/GitHub MCP server (tools like `mcp__jira__*`,
     `mcp__*Atlassian*`, `mcp__linear__*`),
   - mentions of Jira/Linear/GitHub Issues in `CLAUDE.md`, `README`, or `.mcp.json`,
   - issue-key conventions in branch names or commit history (e.g. `JOB-123`).
2. **Confirm with the user** — do not guess. Ask which `system` (jira | github | linear | …),
   the `projectKey` (e.g. `JOB`), the `instance` (e.g. `onvex`), and the `mechanism` they use
   (e.g. `mcp`). If the user does not use a tracker, record nothing and stop.
3. Map conductor lifecycle → a SEMANTIC target via `--intent` (NOT a literal tracker transition
   name — you resolve the real workflow transition yourself when syncing).

## Record it

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" set-tracker \
  --system jira --instance onvex --project JOB --mechanism mcp \
  --intent active:in-progress --intent paused:todo --intent archived:done
```

If `${CLAUDE_PLUGIN_ROOT}` is empty:
`ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1); node "$ENGINE" set-tracker …`

`--intent` is repeatable; each `<status>:<target>` adds one entry to the map. Re-running
`set-tracker` merges (only the flags you pass change). It refreshes the CLAUDE.md rules block.

## Your ongoing responsibilities once a tracker is set

- An epic with no `externalId` → create the issue in the tracker, then record its key:
  `update-epic <id> --external-id <KEY> --external-url <url>`.
- An epic changes status → transition the linked issue toward the `statusIntent` semantic target,
  resolving the real workflow transition with your own tooling.
- A parent epic → create it as a tracker epic and link its children.

The brief's `TRACKER SYNC` line lists epics still needing an issue created. Transition sync is on
you at the moment of each status change — the engine cannot see the tracker's state and will not
fabricate transition drift.
