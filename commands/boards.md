---
description: Publish or refresh the project's backlog and release-plan boards (the project-boards skill); also documents the read-only `board --json` snapshot and the `set-boards` switch
allowed-tools: Bash, Read, Write
---

## `/pm:boards` — publish or refresh the boards

Invoke the `project-boards` skill and follow it. Before anything else, read `boardsEnabled` from `board --json` first; while it
is `false`, say so, name `set-boards on`, and stop before any artifact write. The skill owns the whole procedure, so this
document restates none of it.

## `board` — the snapshot

`board` is the engine's one export for a page or a script that needs the backlog, the releases and the mission as data. It
reads `.conductor/state.json` and prints a single JSON object; before it, every consumer read `state.json` directly, guessed at
release order and status, and treated `archived` as delivered. It is read-only: it writes no file, runs no git command and
opens no network connection, and it keeps working whatever the boards setting says.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" board [--json] [--archived <n>|all]
```

If `${CLAUDE_PLUGIN_ROOT}` is empty:
`ENGINE="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/conductor.mjs}"; [ -f "$ENGINE" ] || ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1); node "$ENGINE" board --json`

| Flag | Effect |
| --- | --- |
| `--json` | print the snapshot. Without it, `board` prints three lines: the open-epic count, the `here` release (or `none`) and the mission statement (or `no mission`) |
| `--archived <n>` | include the `n` most recently ended epics. The default is 50 |
| `--archived all` | include every ended epic. Anything else (`0`, `-1`, `1.5`, text) is refused naming "a positive integer or all", and no JSON is printed |

## The JSON shape (`schemaVersion` 1)

An unknown value is `null` or `[]`, never omitted. A change to the meaning of an existing key increments `schemaVersion`; keys added since (`project`, an epic's `number` and `key`, a release's `progress`) are additive and did not.

| Key | Holds |
| --- | --- |
| `schemaVersion`, `pmVersion`, `asOf` | the integer `1`, the pm version, the time of the read |
| `boardsEnabled` | `true` unless boards are recorded off |
| `project` | `{name, key}` from `set-project`, each `null` while unset (nothing is derived: an unset project is a prompt to ask the user, never a guess) |
| `counts` | `open`, `unregisteredChanges`, `unassigned`, `byPriority` (`P0`..`P3`, `P?`, by effective priority), and `delivered` / `notPursued` / `unknownOutcome` over the whole record, never only the window |
| `mission` | `null` or `{statement, setAt, reason}` |
| `milestone` | `null` or `{release, criteria: [{id, text, check, needsHuman}]}`, active criteria only, in id order |
| `plan` | `{here, hereText, nextText}`, each `null` when unset |
| `releases` | every release by `order` then id, unordered last: `id`, `intent`, `target`, `theme`, `rationale`, `exit`, `order`, `size`, `status` (`planned`, `in-progress` or `shipped`, derived), `delivered`, `criticalPath` (`null` with no milestone), `progress` (`{done, total}`: members delivered over members not declined, over every member and not only the ended window), `members`, `deferred` |
| `epics` | open epics first, then the ended window |
| `rejected` | what was left out, each `{kind, id, field, value, reason}` |

Each entry in `epics` carries `id`, `number` (its integer, or `null` on a record not yet upgraded to 0.55.0), `key` (`<KEY>-<number>`, `null` while the project key is unset), `title`, `summary`, `whyNow`, `description`, `lane`, `status`, `priority` (effective),
`meritPriority`, `rank`, `position`, `release`, `externalUrl`, `dependsOn`, `delivered`, `outcome`, `outcomeReason`,
`createdAt`, `endedAt` and `updatedAt`.

- **Order.** Open epics come in the order `resolveEpics()` gives `PROJECT.md`: effective priority, merit priority, rank, lane, id,
  with no dependency pass. That is not the brief's NEXT UP order. `position` is the index in that order (`null` for an ended epic).
  Ended epics follow, most recently ended first; one that ended with no recorded time comes last, by id.
- **`delivered` has three states.** `true` only for an ended epic whose recorded outcome is `delivered`; `false` for an open epic or
  an ended one with another outcome; `null` for an ended epic whose outcome is `unknown` (an engine stamp) or that has no disposition.
  `outcome` is the engine's one outcome reader, `null` when the epic carries no disposition.
- **Unregistered changes** (a change directory with no registered epic) are counted in `counts.unregisteredChanges` and not listed.
- **`dependsOn`** lists the registered targets of the epic's `depends-on` links, in order, without duplicates. A target that names
  no epic is reported in `rejected`.
- **`rejected` and its reasons.** `kind` is `epic`, `release`, `link`, `url`, `plan`, `milestone` or `project`. `reason` is `id format`,
  `dangling depends-on`, `url scheme`, `here names no release`, `milestone names no release` or `project format`. Every emitted id must match
  `/^[A-Za-z0-9._-]+$/` and `externalUrl` is emitted only when it is an absolute http or https URL, so a page can interpolate
  either without a second check of its own. `value` has its control characters escaped.

## `set-boards on|off` — the switch

The boards are **on by default**. An absent setting reads as on, `init` writes nothing for them, and `upgrade` lists
`boards: on (default)` with the command that turns them off.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" set-boards on|off
```

If `${CLAUDE_PLUGIN_ROOT}` is empty:
`ENGINE="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/conductor.mjs}"; [ -f "$ENGINE" ] || ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1); node "$ENGINE" set-boards off`

- `off` records `state.boards = {enabled: false}` and removes the `## Boards` section of the managed rules block and the boards line of
  the SessionStart brief. `overhead` then reports 0 bytes for the `boards` feature.
- `on` removes that setting again, so each undoes the other exactly, and the section and the brief line come back.
- A repeat of either says so and writes no state (the rules block and `PROJECT.md` are re-rendered either way). Any argument other than `on`
  or `off`, and a missing one, is refused.
- `board --json` keeps working whichever way the switch is set, because it is a read.
- Boards already published stay where they are: deleting a hosted page is the user's own action.
- On the upgrade that crosses release 0.55.0, `upgrade` prints one extra line telling the agent to tell the user the boards are on by
  default and that `set-boards off` turns them off. It is derived from the from- and to-versions, writes no state, and a second
  upgrade prints nothing.

Cost, measured by `overhead`: `rules:boards` is the `## Boards` section (at most 280 bytes) and `brief:boards` is the brief's boards line
(at most 160 bytes), both under the `boards` feature. `brief` is measured without that line, so no byte is counted twice.
