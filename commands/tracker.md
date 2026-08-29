---
description: Make the conductor aware of an external issue tracker (Jira/GitHub/Linear) this project uses
allowed-tools: Bash, Read
---

Record (or update) the external **tracker** this repo mirrors conductor epics to. Tracker
awareness is **optional and additive**. Whether or not you set it, the conductor already tracks
everything locally — `.conductor/state.json` (the JSON system of record) and `PROJECT.md` (the
generated Markdown view). A tracker block ONLY adds *mirroring* to an external system; it never
replaces local tracking. When set, the CLAUDE.md rules block gains the sync section(s) the
tracker's `direction` calls for, and the brief surfaces what that direction makes actionable.
**The plugin never calls the tracker** — it
only shapes the instructions YOU (the interactive agent) act on, with whatever tooling the project
uses (a Jira/Linear MCP server, the GitHub CLI, an Atlassian connector, a Python lib — it does not
matter).

## Detection (run when the user asks to connect a tracker, or as an OPTIONAL offer during `/pm:init`/`/pm:upgrade`)

**Hosting is NOT a tracker signal.** Every hosted Git service — GitHub, GitLab, Bitbucket, and
others — offers issues and pull/merge requests, but the mere fact that a repo is *hosted* on one
(it has a remote, it is public) is NOT evidence that the team manages work there. Do not infer a
tracker from the remote. Only treat it as a real signal when work is *actively* managed in an
issue tracker:

- a connected issue-tracker MCP that is actually in use (`mcp__jira__*`, `mcp__linear__*`,
  a GitHub issues/projects tool, …),
- real issue-key conventions in commit/branch history (e.g. `JOB-123`, `#142`),
- an explicit statement in `CLAUDE.md`/`README` that "we track work in <X>".

Then:

1. **Offer it as a choice — never assume.** Present it plainly: *"This project could mirror epics
   to <service> (creating issues and tracking PRs there), or you can keep tracking locally only.
   Either is fine."* Saying **yes** is perfectly valid — it sets up the mirror between conductor
   epics and the tracker's issues/PRs. Saying **no** is equally valid.
2. **Reassure on "no":** declining changes nothing about tracking — the conductor still records
   every epic, status, priority, and story locally in `.conductor/state.json` and `PROJECT.md`.
   "No tracker" means "no external mirror," not "no tracking." If the user declines, record
   nothing and stop.
3. **On "yes", confirm the specifics** — `system` (jira | github | gitlab | bitbucket | linear |
   …), `projectKey` (e.g. `JOB`), `instance`, and `mechanism` (e.g. `mcp`/`cli`). Then map
   conductor lifecycle → a SEMANTIC target via `--intent` (NOT a literal tracker transition name —
   you resolve the real workflow transition yourself when syncing).

## Record it

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" set-tracker \
  --system jira --instance onvex --project JOB --mechanism mcp \
  --intent active:in-progress --intent paused:todo --intent archived:done
```

If `${CLAUDE_PLUGIN_ROOT}` is empty:
`ENGINE="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/conductor.mjs}"; [ -f "$ENGINE" ] || ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1); node "$ENGINE" set-tracker …`

`--intent` is repeatable; each `<status>:<target>` adds one entry to the map. Re-running
`set-tracker` merges (only the flags you pass change). It refreshes the CLAUDE.md rules block.

## Direction — `--direction inward|outward|both`

Which way work flows between this repo and the tracker. It is **explicit configuration**, never
inferred from the tracker's vendor name:

- `inward` — open items in the tracker become untriaged conductor epics. The rules block gains an
  inward sync section; it does **not** ask you to create issues for local epics.
- `outward` — conductor epics are mirrored out as issues and transitioned as their status changes.
  The rules block gains the "External tracker sync" section; nothing is pulled in.
- `both` — both sections are emitted.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" set-tracker --system jira --project JOB --direction inward
```

### ⚠️ A new primary tracker defaults to `inward` — a behavior change in 0.27.0

Registering a **primary** tracker in a repo that has none, without `--direction`, records
`inward` — **regardless of the vendor**. That reverses 0.26.0's outcome for every system except
`github-issues`: `set-tracker --system jira --project JOB` used to produce the outward "External
tracker sync" section and no inward instruction, and now produces the opposite. Outward creation
of issues in someone else's tracker is the consequential default and has to be chosen rather than
inherited from what vendor you happen to use.

If outward is what you want, say so — this is the entire remedy:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" set-tracker --system jira --direction outward
```

**Existing repos are unaffected.** The no-`direction` fallback and the `0.27.0` migration both
preserve current behavior, and neither grants an inward pull to a repo that never had one.

An unrecognized value exits non-zero and writes nothing. **A secondary tracker is pinned to
`inward`** — it is pull-only by definition, so `--role secondary --direction outward` is refused.

A tracker with no recorded `direction` keeps the behavior its vendor produced before direction
existed: `github-issues` resolves to `inward`, every other system to `outward`. That fallback
holds whether or not the repo's state has been through `/pm:upgrade`.

**An inward section is only emitted when the tracker names what to read** — a `repo` for
`github-issues`, a `repo` or a `--project` for any other system. A tracker whose direction
includes `inward` but which names no scope gets no inward section at all, because the "list open
items in …" step would carry an unfilled placeholder and could not be run as written.

## Your ongoing responsibilities once a tracker is set

- An epic with no `externalId` → create the issue in the tracker, then record its key:
  `update-epic <id> --external-id <KEY> --external-url <url>`.
- An epic changes status → transition the linked issue toward the `statusIntent` semantic target,
  resolving the real workflow transition with your own tooling.
- A parent epic → create it as a tracker epic and link its children.

The brief's `TRACKER SYNC` line lists epics still needing an issue created. Transition sync is on
you at the moment of each status change — the engine cannot see the tracker's state and will not
fabricate transition drift.

## Inward sync, worked through on `github-issues` (items → new untriaged epics)

Any tracker whose direction includes `inward` pulls open items IN as new untriaged epics — the
same pattern `/pm:sync` already uses to auto-register OpenSpec changes/Superpowers plans found on
disk. `github-issues` is not special here any more; it is simply the one system whose CLI pm can
name concretely, so it makes the clearest worked example. Every other system receives the same
steps phrased as "list open items in `<system>` (`<scope>`) with your own tooling". Set it with a
`--repo`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" set-tracker --system github-issues --repo cfdude/pm
```

Once set, the CLAUDE.md rules block gains a "GitHub issue sync" section. As part of running
`/pm:sync`:

1. `gh issue list --repo <repo> --state open --json number,title,url,labels`.
   - **Preflight first (#105):** this step needs the `gh` CLI **and** an authenticated
     GitHub account — `command -v gh` and `gh auth status`. Neither is a pm dependency, so
     check rather than assume. If either is missing, say so, name what to install or
     authenticate, and stop the section. An inward sync is a READ of the tracker and has no
     credential-free substitute (anonymous listing is not available), so reporting a clean
     sync you could not perform is the failure mode to avoid.
2. For each issue, check whether an epic already carries that item's `externalUrl` — if so, skip
   it. Re-running sync must never create a duplicate epic for the same issue. `externalUrl` is
   globally unique; a bare `externalId` is only unique within one tracker/repo.
3. Otherwise register it with the recipe the rules block emits, which **runs as written**:
   `add-epic --id <derived> --status untriaged --external-id <issue-number> --external-url
   <issue-url> --lane <lane> --title "<issue-title>" --external-updated-at <iso> --priority P2`,
   unless the issue carries a `P0`/`P1`/`P2`/`P3` label, in which case use that label's priority.
   - **`--id` is derived, not invented** — `<system>-<scope>-<number>`, so the same item yields
     the same epic id in every repo and every session and a second run is refused as a duplicate
     rather than landing under a slug the agent made up from the title. Two sessions hit exactly
     that failure the same afternoon, back when the emitted recipe omitted the required `--id`.
   - **`<lane>` comes from lane routing** (`suggest-lane "<issue-title>"`), never a hardcoded
     `claude-code`. The lane decides whether the work leaves any spec, plan or gate record;
     hardcoding it decided that silently for every mirrored item. Override where routing is wrong
     and record why: `update-epic <id> --notes "lane: <chosen> not <routed> — <why>"`.
   - **`--external-updated-at`** carries the item's own updated timestamp, so a freshly mirrored
     epic starts with a watermark instead of instantly polluting the "never re-read" count.
4. `add-epic` rejects a duplicate (exits non-zero, writes nothing) as a second line of defense
   against a stale local view producing one.

The engine never calls `gh` itself — steps 1–3 are yours, the same "instruction layer, not
integration layer" law as every other tracker.

## Primary + secondary trackers

A repo can have exactly one **primary** tracker (everything above, in whichever direction it
records) plus zero or more **secondary** trackers.
Secondary trackers cover a different, real case: your actual dev tracker is Jira, but you also
want to watch a GitHub repo for inbound issues — from outside contributors, or from another
internal repo publishing cross-project notifications (e.g. a service filing a GitHub issue in a
downstream repo to flag a breaking change) — without Jira losing its primary spot.

A secondary tracker gets exactly two behaviors, both narrower than primary:

1. **Inward pull** — open issues become untriaged epics, same shape as the inward sync above and
   deduped by `externalUrl` (globally unique) rather than bare `externalId` (only unique within
   one tracker/repo — two secondary trackers can each have an issue numbered `#42` without
   colliding).
2. **Completion status writeback** — when an epic sourced from a secondary tracker reaches
   `archived`, you close/transition the linked issue there too. This is new: even the primary
   `github-issues` inward-only case never did this.

A secondary tracker **never** gets outward-created issues — a new local epic, or any status
change, never causes an issue to be created there. That's what makes it secondary.

```bash
# Add a secondary tracker (role defaults to primary, so this always needs --role secondary)
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" set-tracker --role secondary \
  --system github-issues --repo acme/market-intelligence

# A repo can have more than one
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" set-tracker --role secondary \
  --system github-issues --repo acme/risk-engine

# Remove one that's gone stale
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" set-tracker --role secondary \
  --system github-issues --repo acme/decommissioned-repo --remove
```

Identify a secondary entry the same way you'd identify the primary tracker (`--system` plus
`--repo` or `--project`) — re-running `set-tracker --role secondary` with a matching
`system`+`repo`/`project` merges into the existing entry instead of adding a duplicate. `--remove`
against a key with no match exits non-zero and changes nothing.

Once configured, the CLAUDE.md rules block gains one "Secondary tracker sync" section per entry,
in addition to (never instead of) the primary tracker's own section above.

## Resyncing after completion

Where at least one configured tracker has an **emittable inward procedure** — its direction
includes `inward` *and* it names a scope to read — the rules block also gains a "Sync after
completing tracker-linked work" section: after you close/transition a tracker-linked issue as part
of completing an epic, re-sync with your tracker(s) (`/pm:sync`) right away — you're already doing
tracker I/O for that epic, so this is the cheapest moment to also pull in anything new that
appeared while you were heads-down. The instruction is phrased tracker-count-agnostic ("your
tracker(s)") so it reads correctly whether a repo has one tracker or several. The SessionStart
brief mirrors this with a non-blocking, one-line nudge on the same condition — it never runs a
sync itself.

> **Changed in 0.27.0.** Both used to fire more widely — the reminder appeared in every rules
> block that had a tracker at all, citing "the writeback steps above" that the same block never
> emitted, and the brief's nudge appeared whenever any tracker existed. An outward-only repo now
> gets neither. This is one of exactly three deliberate differences between 0.26.0's and 0.27.0's
> emitted output; treat a fourth as a regression.
