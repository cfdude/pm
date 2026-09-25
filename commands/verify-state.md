---
description: Check whether state.json was hand-edited since PROJECT.md was last rendered
allowed-tools: Bash, Read
---

`state.json` is the state of record and changes only through the engine's verbs; `PROJECT.md` is
rendered from it. `verify-state` is the mechanical check that nothing wrote to `state.json`
behind the engine's back. It is read-only: it never modifies `state.json` or `PROJECT.md`.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" verify-state
```

If `${CLAUDE_PLUGIN_ROOT}` is empty:
`ENGINE="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/conductor.mjs}"; [ -f "$ENGINE" ] || ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1); node "$ENGINE" verify-state`

## What it compares

Every render records a stamp (`.conductor/render-stamp.json`) holding the record's `revision` and
`state.json`'s mtime at that moment, and every engine save adds its own `lastSave` (revision and
mtime) to the same stamp — including the saves of verbs that do not re-render, such as a claim or
`set-activity-log`. A hand-edit advances neither. The check compares the file against the engine's
LAST recorded write, whichever of the two is later.

| What it finds | Exit | Meaning |
| --- | --- | --- |
| same revision as the last engine write, file unchanged, nothing saved since the render | 0 | `state.json matches the last render — no hand-edit detected` |
| same revision as the last engine SAVE, file unchanged, saves after the render | 0 | no hand-edit, but `PROJECT.md` may be stale: run `/pm:status` |
| same revision as the last engine write, file changed after it | 1 | bytes moved with no engine save — an undetected hand-edit |
| revision AHEAD of the last recorded engine write | 1 | cannot rule out a hand-edit (or a save by an older pm that did not stamp it) |
| revision BEHIND the last engine write | 1 | the file was rewound or hand-edited; the engine only ever advances it |
| no stamp at all | 1 | never rendered, so a hand-edit cannot be ruled out — run `/pm:status` for a baseline |

On exit 1, run `/pm:status` to re-render, review the diff of `state.json`, and reconcile before
trusting `PROJECT.md` again. Never "fix" a finding by hand-editing the file back.

## What it cannot see

- A hand-edit followed by an engine save before `verify-state` runs: the save stamps the edited
  file as its own, so from then on it reads as the engine's.
- A hand-edit within the filesystem's mtime resolution of the last engine save, at the same
  revision.
- A merge, rebase or checkout that brings in `state.json` AND `render-stamp.json` together from
  another clone: the pair is internally consistent, so it reads as that clone's engine writes. One
  that brings in `state.json` alone is caught (its revision or mtime no longer matches the stamp).

Run it right after anything that touched the file outside the engine.
