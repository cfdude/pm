---
description: Turn the optional, opt-in reconcile-gate guard on or off (off by default)
allowed-tools: Bash, Read
---

Toggle the **gate guard** — an optional, opt-in `PreToolUse` hook that mechanically blocks
`Edit`/`Write`/`NotebookEdit` while the active epic still owes a reconcile after a detour POP.
This is the one place pm's law tolerates mechanical blocking over pure instruction: it protects
the single highest-stakes skip (writing source before the reconcile gate actually runs), and it
is **off by default** — the plugin never silently adopts this, you turn it on deliberately.

## Why off by default

pm's instruction-layer law means this is normally enforced by telling you (the interactive
agent) what to do, not by a hook mechanically stopping a tool call. That's usually enough — but
an instruction CAN be missed. If you want a hard backstop specifically for the reconcile gate
(the highest-stakes single skip), turn this on. If an instruction-only approach has worked fine
for you, leave it off.

## Turn it on or off

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" set-gate-guard on
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" set-gate-guard off
```

If `${CLAUDE_PLUGIN_ROOT}` is empty:
`ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1); node "$ENGINE" set-gate-guard on`

## What it checks

When enabled, every `Edit`/`Write`/`NotebookEdit` call is checked: if the currently active epic's
`reconcileNeeded` is `true` (it still owes a reconcile — see the conductor skill's POP protocol),
the tool call is blocked with a message pointing you at the reconciler agent. Run the reconcile
gate first, or `set-gate-guard off` if you need to bypass once. It never blocks anything else —
epics with no pending reconcile are unaffected regardless of the setting.
