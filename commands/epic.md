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

---

## Bulk create — `add-many`

To register a parent epic and its children in one atomic operation (e.g. a sprint of audit
tickets), author a JSON batch and pass it with `--from <path>` (or `--from -` for stdin):

```json
{
  "parent":  { "id": "sprint-2026-06-25", "title": "Pre-staging sprint", "lane": "external", "priority": "P0", "status": "queued" },
  "epics": [
    { "id": "job-506", "title": "[JOB-506] HMAC-verify webhooks", "lane": "external", "priority": "P0", "externalId": "JOB-506", "externalUrl": "https://onvex.example/JOB-506" },
    { "id": "job-507", "title": "[JOB-507] …", "lane": "external", "priority": "P1", "externalId": "JOB-507" }
  ]
}
```

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" add-many --from /path/to/batch.json
```

- If `parent` is present it is created first and each `epics[]` entry defaults its `parent` to it.
- **Atomic:** every entry is validated up front (id format, uniqueness vs existing AND within the
  batch, lane, status, parent refs/cycles). On any failure nothing is written and the command
  exits non-zero naming the offender. A valid batch is persisted in a single write — no `&&`
  chaining, no write race.
- JSON only (the engine is zero-dependency). `parent` is optional; a bare `{ "epics": [...] }`
  batch works too.

## Write-back — `update-epic`

To change an epic that already exists (notably, to record a tracker key after creating the issue):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" update-epic <id> \
  [--external-id <KEY>] [--external-url <url>] [--parent <id>] [--status <status>] [--priority <P?>]
```

The id is positional. Parent/status changes are validated like `add-epic` (no self-parent, no
cycle, known status). On an unknown id it exits non-zero and writes nothing.
