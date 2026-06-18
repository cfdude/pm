---
description: Register a non-OpenSpec epic in the conductor (lane-tagged)
allowed-tools: Bash, Read
---

Register an epic in a non-OpenSpec lane (superpowers, claude-code, decision, external) —
for work that is correctly routed away from OpenSpec but still belongs in the system of record.

Usage: `/pm:epic add <id> "<title>" <lane> [priority] [--plan <path>] [--link type:epic:reason]`

1. Parse the user's request into: id (kebab-case), title, lane (one of
   openspec|superpowers|claude-code|decision|external), priority (P0–P3, default P?),
   optional plan path, optional links.

2. Run the engine:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" add-epic \
     --id "<id>" --title "<title>" --lane "<lane>" --priority "<P?>" \
     [--plan "<docs/superpowers/plans/...md>"] [--link "blocks:<id>:<reason>"]
   ```

   If `${CLAUDE_PLUGIN_ROOT}` is empty:
   `ENGINE=$(find ~/.claude -name conductor.mjs -path '*pm*' 2>/dev/null | head -1); node "$ENGINE" add-epic …`

3. Show the result with `/pm:status`.
