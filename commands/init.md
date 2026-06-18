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
   `ENGINE=$(find ~/.claude -name conductor.mjs -path '*pm*' 2>/dev/null | head -1); node "$ENGINE" init`

2. Read `.conductor/state.json` and help the user TRIAGE:
   - set `active` to the epic currently being built,
   - assign each epic a `priority` (P0–P3) and `status` (active | queued | later),
   - leave `detourStack` empty unless work is already paused.

3. Show the result with `/pm:status`.

Note: until this runs, the plugin's hooks stay dormant in this repo by design — like
`openspec init`. The conductor sits ABOVE OpenSpec and Superpowers; epics are lane-agnostic
(openspec | superpowers | claude-code | decision | external). It does not replace either.
