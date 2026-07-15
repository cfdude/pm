---
description: Run a parent epic's children as a batched, unattended hierarchy
allowed-tools: Bash, Read, Task
---

Compute the execution plan for a parent epic's children, then dispatch them — batched by
priority and `depends-on` links, preflighted all at once, each child run by a fresh
`hierarchy-child-executor` subagent. See the `conductor` skill's "Epic-hierarchy orchestration"
section for the full process; this doc is the quick-reference for the CLI piece.

## Get the plan

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" plan-hierarchy --parent <id>
```

If `${CLAUDE_PLUGIN_ROOT}` is empty:
`ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1); node "$ENGINE" plan-hierarchy --parent <id>`

Prints `{ parent, batches: [{ batch, epics: [{ id, priority, autonomous, dependsOn }] }] }`.
`dependsOn` is each epic's list of sibling ids (within this hierarchy) it depends on — use it to
check, transitively, whether a later batch depends on a blocked child. Batches run in
order; epics within a batch have no dependency on each other and may dispatch in parallel. A
dependency cycle among children exits non-zero, naming the cycle — fix the offending `links`
before retrying.

**Before dispatching:** every epic in the plan should show `autonomous: true`. One that doesn't
was not cleared in the preflight step (see the `conductor` skill) — resolve that first; don't
dispatch a non-autonomous child.

## No new state

`plan-hierarchy` is a pure read — it recomputes the plan fresh from `parent`, `priority`,
`links`, and each child's `autonomy` block every time. There is no "hierarchy in progress" flag
to get out of sync; re-running it any time reflects current reality.
