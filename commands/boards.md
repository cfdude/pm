---
description: The read-only board snapshot (`board --json`) that the project boards, and anything else that draws the backlog, read
allowed-tools: Bash, Read
---

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

An unknown value is `null` or `[]`, never omitted. A change to the meaning of an existing key increments `schemaVersion`.

| Key | Holds |
| --- | --- |
| `schemaVersion`, `pmVersion`, `asOf` | the integer `1`, the pm version, the time of the read |
| `boardsEnabled` | `true` unless boards are recorded off |
| `counts` | `open`, `unregisteredChanges`, `unassigned`, `byPriority` (`P0`..`P3`, `P?`, by effective priority), and `delivered` / `notPursued` / `unknownOutcome` over the whole record, never only the window |
| `mission` | `null` or `{statement, setAt, reason}` |
| `milestone` | `null` or `{release, criteria: [{id, text, check, needsHuman}]}`, active criteria only, in id order |
| `plan` | `{here, hereText, nextText}`, each `null` when unset |
| `releases` | every release by `order` then id, unordered last: `id`, `intent`, `target`, `theme`, `rationale`, `exit`, `order`, `size`, `status` (`planned`, `in-progress` or `shipped`, derived), `delivered`, `criticalPath` (`null` with no milestone), `members`, `deferred` |
| `epics` | open epics first, then the ended window |
| `rejected` | what was left out, each `{kind, id, field, value, reason}` |

Each entry in `epics` carries `id`, `title`, `summary`, `whyNow`, `description`, `lane`, `status`, `priority` (effective),
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
- **`rejected` and its reasons.** `kind` is `epic`, `release`, `link`, `url`, `plan` or `milestone`. `reason` is `id format`,
  `dangling depends-on`, `url scheme`, `here names no release` or `milestone names no release`. Every emitted id must match
  `/^[A-Za-z0-9._-]+$/` and `externalUrl` is emitted only when it is an absolute http or https URL, so a page can interpolate
  either without a second check of its own. `value` has its control characters escaped.
