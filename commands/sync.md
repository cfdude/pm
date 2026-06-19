---
description: Register any new OpenSpec proposals as epics in the conductor index
allowed-tools: Bash, Read, Edit
---

Pull any OpenSpec changes that aren't yet tracked into the conductor.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" sync
```
(If `${CLAUDE_PLUGIN_ROOT}` is empty:
`ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1); node "$ENGINE" sync`)

New proposals are added with `status: "untriaged"` and `priority: "P?"`. Then help the user
triage each: assign a priority, set its status (queued/later), and add any epic links
(e.g. `depends-on`) to other epics. Finish with `/pm:status`.
