---
description: List the epics in the record, optionally filtered by status, lane or link
allowed-tools: Bash, Read
---

`list` is the engine's answer to "which epics exist". Intake, the tracker-sync dedup and a
disposition's `--deferral "<epicId>:<section>"` all need that set; before this verb the only way to
get it was to read `.conductor/state.json`, which the rules forbid hand-editing and whose shape an
agent had to guess. It is read-only: it writes nothing, and it decides nothing.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" list [--status <status>] [--lane <lane>] [--linked-to <epicId>] [--json]
```

If `${CLAUDE_PLUGIN_ROOT}` is empty:
`ENGINE="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/conductor.mjs}"; [ -f "$ENGINE" ] || ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1); node "$ENGINE" list`

| Flag | Narrows to |
| --- | --- |
| `--status <status>` | epics with that status (`untriaged`, `queued`, `active`, `paused`, `later`, `blocked`, `planned`, `archived`) |
| `--lane <lane>` | epics in that lane; an epic with no lane counts as `openspec`, as everywhere else |
| `--linked-to <epicId>` | epics that carry a link whose target is `<epicId>` (INCOMING: "which epics point at this one"). What an epic itself links to is in its own `links` in `--json` |
| `--json` | machine-readable: `{count, epics: [{id, title, status, lane, priority, links: [{type, epic}]}]}` |

Filters combine (all must match). Epics come back in record order. A `--status` or `--lane` outside
the vocabulary is refused naming the accepted values; a filter with no value is refused.

Without `--json` it prints one line per epic (`id  status  lane  priority  title`), or `No epics match.`

It is not a substitute for `/pm:triage`: `list` filters on fields, `triage` reads an ask and returns
the epics that share its vocabulary. Run `triage` before registering an ask; use `list` to enumerate.
