---
description: Upgrade this repo's conductor state/rules to the current pm plugin version
allowed-tools: Bash, Read
---

Bring this repository in line with the currently-installed `pm` plugin version. Safe to run
anytime; idempotent. Use it when the briefing shows a "pm <old> → <new>" upgrade nudge.

1. Run the engine's upgrade (applies any pending migrations, refreshes the CLAUDE.md rules
   block, re-renders PROJECT.md, and re-stamps the recorded version):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" upgrade
   ```

   If `${CLAUDE_PLUGIN_ROOT}` is empty:
   `ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1); node "$ENGINE" upgrade`

2. Show the result with `/pm:status`.
