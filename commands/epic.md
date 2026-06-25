---
description: Register a non-OpenSpec epic in the conductor (lane-tagged)
allowed-tools: Bash, Read
---

Register an epic in a non-OpenSpec lane (superpowers, claude-code, decision, external) —
for work that is correctly routed away from OpenSpec but still belongs in the system of record.

Usage: `/pm:epic add <id> "<title>" <lane> [priority] [--status <untriaged|queued|active|paused|planned|archived>] [--parent <id>] [--external-id <KEY>] [--external-url <url>] [--plan <path>] [--link type:epic:reason]`

Use `--status planned` for roadmap work you intend to do but haven't proposed/scaffolded yet
(default status is `queued`). Use `--parent <id>` to nest this epic under an existing parent
epic (e.g. a sprint over its child tickets); the parent must already exist and the link may not
form a cycle. Use `--external-id`/`--external-url` to link the epic to an issue in a configured
external tracker (see `/pm:tracker`). The matching engine flags are added to the `add-epic`
invocation.

1. Parse the user's request into: id (kebab-case), title, lane (one of
   openspec|superpowers|claude-code|decision|external), priority (P0–P3, default P?),
   optional parent, optional external id/url, optional plan path, optional links.

2. Run the engine:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" add-epic \
     --id "<id>" --title "<title>" --lane "<lane>" --priority "<P?>" \
     [--status "<status>"] [--parent "<parent-id>"] \
     [--external-id "<KEY>"] [--external-url "<url>"] \
     [--plan "<docs/superpowers/plans/...md>"] [--link "blocks:<id>:<reason>"]
   ```

   If `${CLAUDE_PLUGIN_ROOT}` is empty:
   `ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1); node "$ENGINE" add-epic …`

3. Show the result with `/pm:status`.
