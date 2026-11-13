---
description: Record the project's name and its two- or three-letter key (the epic keys the boards show, such as PM-256); each has an --unset
allowed-tools: Bash, Read
---

`set-project` records what the project is called and the short key its epics carry on the boards. The engine never invents either:
it stores what a person or an agent says, and while they are unset `board --json` reports `project: {name: null, key: null}` and
every epic's `key` as `null`, so the boards show a prompt to set them instead of a guess.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" set-project --name "<project name>" --key <KEY>
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" set-project --unset name|key
```

If `${CLAUDE_PLUGIN_ROOT}` is empty:
`ENGINE="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/conductor.mjs}"; [ -f "$ENGINE" ] || ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1); node "$ENGINE" set-project --name "<project name>" --key <KEY>`

| Flag | Effect | Its inverse |
| --- | --- | --- |
| `--name "<text>"` | records the project name: at most 60 characters, no control character, no `<`. Either flag may be given alone | `--unset name` |
| `--key <KEY>` | records the key: two or three uppercase letters (`/^[A-Z]{2,3}$/`), such as `PM`. It is changeable at any time | `--unset key` |
| `--unset <name\|key>` | removes the field. Repeat it to remove both. An unset of a field that is not set writes nothing and says so | `--name` / `--key` |

A bad value, no operation, an unknown `--unset` field, or one field both set and unset is refused and writes nothing. A value the
record already holds writes nothing and says so. `set-project` writes `state.json` only: neither value appears in `CLAUDE.md`'s
managed block or in `PROJECT.md`.

**How the key shows on an epic.** Every epic carries an integer `number`, assigned when it is registered: a tracker issue number
where the epic is linked to one and no other epic holds it (issue #256 is number 256), otherwise the next number from the
project's counter. The key the boards show is `<KEY>-<number>` (`PM-256`), computed when the board is read, so changing the key
renames every epic at once and rewrites none. A number is never reassigned or reused by a plain registration, and an archived
epic keeps its own. Until `upgrade` runs once after updating to 0.55.0, an epic registered earlier has no number, and its `key` is
`null`.
