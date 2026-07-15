---
description: Register any new OpenSpec proposals as epics in the conductor index
allowed-tools: Bash, Read, Edit
---

Pull any OpenSpec changes that aren't yet tracked into the conductor.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" sync
```
(If `${CLAUDE_PLUGIN_ROOT}` is empty:
`ENGINE="${CLAUDE_PROJECT_DIR:+$CLAUDE_PROJECT_DIR/scripts/conductor.mjs}"; [ -f "$ENGINE" ] || ENGINE="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/conductor.mjs}"; [ -f "$ENGINE" ] || ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1); node "$ENGINE" sync`)

New proposals are added with `status: "untriaged"` and `priority: "P?"`. Then help the user
triage each: assign a priority, set its status (queued/later), and add any epic links
(e.g. `depends-on`) to other epics. Finish with `/pm:status`.

## If a `github-issues` tracker is configured

The engine's `sync` only scans local files (OpenSpec changes, Superpowers plans) — it never
calls an external system. When `.conductor/state.json`'s `tracker.system` is `github-issues`
(set via `/pm:tracker` → `set-tracker --system github-issues --repo <owner/name>`), YOU also do
the inward pull as part of `/pm:sync`: see `commands/tracker.md`'s "GitHub-issues tracker:
inward sync" section for the exact steps (`gh issue list` → dedup by `externalId` → `add-epic
--status untriaged --external-id <n> --external-url <url> --lane claude-code --priority P2`,
label-driven priority override, P2 default).
