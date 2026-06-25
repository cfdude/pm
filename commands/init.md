---
description: Initialize the PM conductor in this repo (scaffold state, register epics)
allowed-tools: Bash, Read, Edit
---

Initialize the `pm` conductor for the current project.

1. Run the engine's init (it creates `.conductor/state.json`, registers existing OpenSpec
   changes as untriaged epics, and renders `PROJECT.md`):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" init
   ```

   If `${CLAUDE_PLUGIN_ROOT}` is empty, locate the engine first:
   `ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1); node "$ENGINE" init`

2. Read `.conductor/state.json` and help the user TRIAGE:
   - set `active` to the epic currently being built,
   - assign each epic a `priority` (P0–P3) and `status` (active | queued | later),
   - leave `detourStack` empty unless work is already paused.

3. **Detect an external tracker (optional).** Check whether this project tracks work in an
   external issue tracker (Jira/GitHub/Linear) — look for a connected tracker MCP server, tracker
   mentions in `CLAUDE.md`/`.mcp.json`, or issue-key conventions in history. If so, follow the
   detection + `set-tracker` procedure in `/pm:tracker` (confirm system/projectKey/instance with
   the user first). If the project does not use a tracker, skip this — the conductor stays
   tracker-unaware by default.

4. Show the result with `/pm:status`.

Note: until this runs, the plugin's hooks stay dormant in this repo by design — like
`openspec init`. The conductor sits ABOVE OpenSpec and Superpowers; epics are lane-agnostic
(openspec | superpowers | claude-code | decision | external). It does not replace either.
