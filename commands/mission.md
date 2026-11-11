---
description: Record the project mission, its mission milestone and exit criteria; read them back with `mission show`
allowed-tools: Bash, Read
---

`mission` records what this project is trying to ship. The engine never writes a statement it was not given: it stores what a
person or an agent says the mission is, with the reason, and keeps every replaced statement in an append-only history. The
mission shows in `/pm:status`, as one line in the SessionStart brief (at most 200 bytes) and as a one-line `## Mission`
section of the managed rules block (at most 280 bytes), because a subagent receives `CLAUDE.md` and the mission is what
bounds autonomous work.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" mission --statement "<one line>" --reason "<why>"
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" mission show [--history]
```

If `${CLAUDE_PLUGIN_ROOT}` is empty:
`ENGINE="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/conductor.mjs}"; [ -f "$ENGINE" ] || ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1); node "$ENGINE" mission show`

"Mission milestone" is the name for the release that meets the mission. A plan's story milestones are a different thing, so
every surface says "mission milestone".

| Operation | Effect | Its inverse |
| --- | --- | --- |
| `--statement "<text>" --reason "<why>"` | records the current mission (one line, at most 300 characters). A new statement moves the previous one into history, stamped with when it was replaced and the new reason. The same statement twice writes nothing and says so | a new statement, or `--end` (history is kept) |
| `--end --reason "<why>"` | ends the current mission and appends it to history. The mission milestone and the criteria are left as they are. Refused when there is no current mission | `--statement` records a new one |
| `--milestone <releaseId>` | the release that meets the mission. Refused when the release does not exist | `--clear-milestone` |
| `--add-criterion "<text>" [--check "<how to check it>" \| --needs-human]` | appends an exit criterion with the next stable id (`c1`, `c2`, ...). Ids are never reused or renumbered. `--needs-human` marks one that needs a human-supplied number. `--check` and `--needs-human` apply only here, and not together | `--remove-criterion` |
| `--remove-criterion <cN> --reason "<why>"` | marks the criterion removed, with the time and the reason. It stays in `mission show --history` and is absent from the board | (the record is kept, by design) |

`--reason` serves exactly one of `--statement`, `--end` and `--remove-criterion`: giving two of them in one call is refused, and
each of the three requires it. Every refusal writes nothing. `show` is a reserved word: `mission show` reads the mission, the
mission milestone, the active criteria and the number of history entries, and `--history` adds every history entry and every
removed criterion. It writes nothing.

Releases at or before the mission milestone, by `release <id> --order <n>`, are **critical path**; every other release is off
it. With no mission milestone, or a milestone release with no order, nothing is marked. `release show`, the `render` verb
(`/pm:status`) and `board --json` carry the marks. The brief's release lines do not.
