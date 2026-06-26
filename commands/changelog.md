---
description: Show what changed in the pm plugin — the changelog delta since this repo's version
allowed-tools: Bash
---

Surface the pm plugin's own CHANGELOG entries that are newer than a given version, so you (the
agent) and the user know *what a version actually brought*, not just that an upgrade happened.
By default the floor is the version stamped in this repo's `.conductor/state.json` (`pmVersion`).

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" changelog [--since <x.y.z>]
```

If `${CLAUDE_PLUGIN_ROOT}` is empty:
`ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1); node "$ENGINE" changelog`

- No `--since` → entries newer than this repo's stamped version (what you'd gain by upgrading,
  or what the last upgrade brought).
- `--since 0.3.0` → everything released after 0.3.0.
- `/pm:upgrade` already prints this delta automatically for the versions it crosses; use this
  command to review it again or to inspect a different range on demand.
