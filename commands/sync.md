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

## The archive backfill — `openspec/changes/archive/`

`sync` also walks `openspec/changes/archive/`. An archived change the conductor holds no epic for
is registered as an epic **already in `archived` status**, so the record covers what a repository
actually shipped rather than only what it happened to register while the work was in flight. The
audit that motivated this release measured the gap: the conductor saw **49 of 87** archived
changes across 8 repositories — 56%.

The backfill is **visible, one-time and announced** — never a silent side effect. Its first run
prints what it registered; a state-level `archiveBackfilledAt` marker records that it happened,
and its presence alone is the marker (nothing is compared against it). A backfilled epic carries
`recordedBy: "archive-backfill"` on its disposition and **no `gate2` entry at all**: it never
passed through the conductor while in flight, so it has no verdict, no start time and often no
ticked tasks. Writing an `ungated` verdict for it would assert a permanent, unclearable condition
against every change archived before the conductor existed, and the completion-shaped integrity
checks exclude it for the same reason.

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

**The registration recipe runs as written.** Its epic id is derived (`<system>-<scope>-<number>`),
so the same item yields the same id in every repo and session and a re-run is refused as a
duplicate rather than landing as a second epic under an invented slug. Its `<lane>` comes from
**lane routing** (`suggest-lane "<issue-title>"`), never a fixed `claude-code` — the lane decides
whether the work leaves any spec, plan or gate record, so hardcoding it decides that silently for
every mirrored item. Override it when routing is wrong for a particular item, and record why:
`update-epic <id> --notes "lane: <chosen> not <routed> — <why>"`.

Record what you read:

```bash
# a plain re-read during sync, no verdict owed
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" update-epic <id> --external-updated-at <iso>
```

## The refresh gate — `record-tracker-refresh`

Before an epic becomes the active piece of work — the point at which specs or a plan get drawn
for it — its source of truth gets re-read. Which source depends on **provenance**, never on
direction:

- **The epic has an `externalId`** → re-read the linked item (body, comments, labels, state) and
  record the verdict. Both arguments are required, so a verdict can never be recorded without
  advancing the watermark:

  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" record-tracker-refresh <id> \
    --verdict unchanged|material-change --external-updated-at <iso> [--summary "<what changed>"]
  ```

  `<iso>` is the **tracker's own** updated timestamp, never a local clock reading.
- **The epic has no `externalId`** → re-read its LOCAL source: its plan document, or its OpenSpec
  proposal plus tasks. That is instruction only; nothing is recorded in state for it, and
  `record-tracker-refresh` refuses such an epic by name.

An outward-mirrored epic owes the same re-read as an inward-born one: a linked item accumulates
third-party context regardless of which way it was born. Origin decides only whose ask wins when
the item and a local spec disagree.

If you cannot reach the tracker — offline, unauthenticated, upstream item deleted — turn the
mechanical block off (`set-gate-guard off`) and say so. An honest bypass beats a blind
`--verdict unchanged`.
