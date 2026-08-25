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

## What sync does about your tracker(s) — decided by direction, not by vendor

The engine's `sync` only scans local files (OpenSpec changes, Superpowers plans) — it never
calls an external system, and it never will. What YOU do externally as part of `/pm:sync` is
decided by each tracker's `direction` (`/pm:tracker` → `set-tracker --direction
inward|outward|both`), and the rules block in this repo's project-instruction file already
carries the exact steps for whichever branch applies:

- **An inward procedure is emittable** (direction includes `inward` AND the tracker names a
  scope — a `repo` for `github-issues`, a `repo` or `--project` for anything else): follow the
  inward sync section in the rules block. List open items, register the ones whose
  `externalUrl` does not already match an epic, then compare each ALREADY-linked epic's
  `externalUpdatedAt` watermark against its item's tracker-side updated timestamp and read the
  ones that moved. Seeing an item in a list response is **not** reading it — listing must never
  advance a watermark, or sync erases the drift it exists to find.
- **Outward only** (or a tracker that names no scope): read nothing external. `sync` registers
  local OpenSpec/Superpowers sources and stops. Its confirmation line says so.

`sync` prints which of the two applies, so you never have to infer it. A secondary tracker is
inward by definition and always contributes its own inward pull.

Record what you read:

```bash
# a plain re-read during sync, no verdict owed
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" update-epic <id> --external-updated-at <iso>
```
