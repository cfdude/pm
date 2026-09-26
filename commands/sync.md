---
description: Register any new OpenSpec proposals as epics in the conductor index
allowed-tools: Bash, Read, Edit
---

Pull any OpenSpec changes that aren't yet tracked into the conductor.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" sync
```
(If `${CLAUDE_PLUGIN_ROOT}` is empty:
`ENGINE="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/conductor.mjs}"; [ -f "$ENGINE" ] || ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1); node "$ENGINE" sync`)

New proposals are added with `status: "untriaged"` and `priority: "P?"`. Then help the user
triage each: assign a priority, set its status (queued/later), and add any epic links
(e.g. `depends-on`) to other epics. Finish with `/pm:status`.

## Superpowers plans — what stops one being registered twice

A plan file is matched to an epic by a recorded **association**, never by its filename. Plan
filenames carry a date prefix and epic ids do not, so a filename match fired only by luck — and
every other epic's plan was re-registered as a fresh untriaged epic on every sync, forever
(#64/#69). `sync` now decides in this order, per plan file:

1. **Some epic's `planPath` claims it** → skipped, naming that epic. This is status-blind and
   lane-blind on purpose: an archived epic still holds its `planPath`, so a shipped plan stops
   being offered as new work without anyone inferring completion from checkbox counts.
2. **A plan named exactly like an existing epic id** → skipped, as before.
3. **A sync-ignore tombstone on that path** → skipped. `remove-epic` writes one, so a removal
   survives the next sync instead of lasting only until it.
4. **An epic whose id is the plan id minus its date prefix** → skipped, and both exits are
   printed: associate it (`update-epic <epic> --plan <path>`) if it IS that epic's plan, or
   register it as distinct work (`add-epic --id <plan-id> --lane superpowers --plan <path>`) if
   it is not. `sync` reports this one; it never picks for you, because the match is a name
   collision and pointing an epic's progress source at an unrelated plan would read `0/N`
   forever.
5. **Otherwise** → registered as an untriaged `superpowers` epic, as before.

**Attach the plan and rung 1 does the rest.** `update-epic <id> --plan <path>` is the durable
answer for an epic registered before the association existed; it also clears any tombstone on
that path, since claiming an artifact says it is real work.

**And `--clear plan` is how you let go of one.** Clearing the association drops the epic out of
rung 1, so the next `sync` registers that file as a fresh untriaged epic. No sync-ignore tombstone
is written, deliberately — `remove-epic` tombstones because the epic is GONE, whereas here the epic
survives and clearing may well mean *let sync find this plan's real owner*. `--clear spec` does the
same for a design document.

## A name that cannot be an epic id is skipped, and named every run

An epic id is pasted into every command the engine prints and into PROJECT.md's tables, so
`sync` registers an entry only under an id `add-epic` itself would accept: `^[a-z0-9][a-z0-9._-]*$`
(lowercase letters, digits, `.`, `_`, `-`). Every registration path — change directories, plan
files, the archive backfill — asks the same validator `add-epic` and `add-many` do. A change
directory under `openspec/changes/`, a plan file, or an archive directory whose name fails it
(`x|y`, `.hidden`, `My Plan.md`, `MASTER-plan.md`, a name holding a newline) is **not registered**:
`sync` registers everything else in the same run and prints one stderr line naming the entry, with
its control characters escaped:

```
conductor: sync skipped <kind> '<name>' — its name is not a valid epic id (format ^[a-z0-9][a-z0-9._-]*$: lowercase letters, digits, `.`, `_`, `-`); rename it to register it
```

A **plan** whose lowercased name is a valid id gets a runnable registration instead of the rename
advice — `add-epic --id master-plan --lane superpowers --plan docs/superpowers/plans/MASTER-plan.md`
for `MASTER-plan.md` — and `add-epic --plan` claims the file, so
the next sync answers "already claimed". The run's final line counts what was skipped:
`conductor: synced (1 new epic(s) added as untriaged; 2 skipped — each named above, none registered)`.

The line is printed on **every** run while the entry exists, including the quiet sync the commit
hook runs, because a skipped change has no other reported condition — silencing it would make an
unregistered change look like a clean sync. **Rename it to register it** (or, for a plan, run the
`add-epic --plan` line it names); no verb can register it under its current name. The check runs at the final registration step, after the claimed, known,
tombstone and near-match rungs above, so a name an epic already holds prints nothing — an epic
stored under a legacy id (`MASTER-…`, `My Plan`) keeps loading, rendering and updating; only a NEW
registration is refused. An archive directory is additionally reported by `integrity`'s
`archive-directory-has-no-epic`, whose detail says it must be renamed rather than that `/pm:sync`
registers it.

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

## An archive older than the epic is not its archive

The drift heal archives an epic whose change sits under `openspec/changes/archive/` — but a
**name is not an identity**. An archive directory dated (`YYYY-MM-DD-<id>`) more than a day before
a LIVE epic's `createdAt` is some older, unrelated change that happens to share the name, so it
**neither ends the epic nor clears its active pointer**, and `set-active` still accepts the epic.
(The day of slack covers openspec's local date against `createdAt`'s UTC.) A live epic with no
`createdAt` at all is never ended by a bare name match. The rule decides only whether LIVE work is
ended: an epic that is already archived finds its archive by name, because `createdAt` is not proof
of order for it — pm's own date recovery can date an epic after its archive. Every surface asks the
same resolver, so none of them can disagree. `sync` names each directory it set aside for a live
epic, every run, and counts them in its final line:

```
conductor: sync set aside archive directory '2025-01-01-add-auth' — it predates epic 'add-auth' (registered 2026-09-25), so it is not that epic's archive and did not end it; rename the directory if it is unrelated work
```

For an epic with no registration date the line says so and names `recover-created-at`, which dates
it from git history; the next sync then decides by the rule. An epic registered BY the archive
backfill is exempt — it was built from that very directory.

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
  advance a watermark, or sync erases the drift it exists to find. Then run the **reciprocal**
  step: an epic linked to an item that did NOT appear in the open list has an item that is no
  longer open. Read that item (absence from a list also covers deleted, transferred and
  out-of-scope), and where the epic is not already `archived`, **propose** its disposition —
  never write one unasked. Which outcome it is, and the reason with it, is a judgment about what
  happened to the work; a closed item does not say which one and pm will not guess. Without this
  half, sync can create an epic from an item and never end one: 0.27.0 shipped, all twenty of
  its member issues closed, and all twenty epics stayed `queued` (#137).
- **Outward only** (or a tracker that names no scope): read nothing external. `sync` registers
  local OpenSpec/Superpowers sources and stops. Its confirmation line says so.

`sync` prints which of the two applies, so you never have to infer it. A secondary tracker is
inward by definition and always contributes its own inward pull.

**Clearing the link is what re-opens registration.** The `externalUrl` match above is the PRIMARY
dedup key, so `update-epic <id> --clear external-url` hands the item back to this step: it will be
mirrored again as a NEW untriaged epic on the next run. `--clear external-id` releases the FALLBACK
half of the key, compared only when neither side carries a URL. That is the intended way to say
*this epic is no longer that item*, and the reason to say it only when it is true.

**The registration recipe runs as written.** Its epic id is derived (`<system>-<scope>-<number>`),
so the same item yields the same id in every repo and session and a re-run is refused as a
duplicate rather than landing as a second epic under an invented slug. Its `<lane>` comes from
**lane routing** (`suggest-lane --ask=<issue-title>`, the title filled as one single-quoted word), never a fixed `claude-code` — the lane decides
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

  `<iso>` is the **tracker's own** updated timestamp, never a local clock reading — an ISO-8601
  date-time with a zone. A tracker's updated time only moves forward, so a watermark OLDER than the
  one already recorded (compared as instants, so `…Z` and `…+02:00` spellings compare correctly) is
  refused and nothing is written; if the recorded one is the wrong one, correct it with
  `update-epic <id> --external-updated-at <iso>`.
- **The epic has no `externalId`** → re-read its LOCAL source: its plan document, or its OpenSpec
  proposal plus tasks. That is instruction only; nothing is recorded in state for it, and
  `record-tracker-refresh` refuses such an epic by name.

An outward-mirrored epic owes the same re-read as an inward-born one: a linked item accumulates
third-party context regardless of which way it was born. Origin decides only whose ask wins when
the item and a local spec disagree.

If you cannot reach the tracker — offline, unauthenticated, upstream item deleted — turn the
mechanical block off (`set-gate-guard off`) and say so. An honest bypass beats a blind
`--verdict unchanged`.
