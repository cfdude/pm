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
`state.json`'s mtime at that moment. Every engine save advances the revision; a hand-edit does not.

| What it finds | Exit | Meaning |
| --- | --- | --- |
| same revision, file unchanged | 0 | `state.json matches the last render — no hand-edit detected` |
| revision AHEAD of the stamp | 0 | the engine saved since the render (a claim, `set-activity-log`, …) — no hand-edit, but `PROJECT.md` may be stale: run `/pm:status` |
| same revision, file changed after the render | 1 | bytes moved with no engine save — an undetected hand-edit |
| revision BEHIND the stamp | 1 | the file was rewound or hand-edited; the engine only ever advances it |
| no stamp at all | 1 | never rendered, so a hand-edit cannot be ruled out — run `/pm:status` for a baseline |

On exit 1, run `/pm:status` to re-render, review the diff of `state.json`, and reconcile before
trusting `PROJECT.md` again. Never "fix" a finding by hand-editing the file back.

## What it cannot see

A hand-edit followed by an engine save before `verify-state` runs: the save advances the revision
over the edit, and from then on the file reads as the engine's own. Nor a merge, rebase or checkout
that brings in a `state.json` at a HIGHER revision: that reads as engine saves (exit 0, "may be
stale"). What it does catch after one is a file rewound to a lower revision, or changed at the same
one — so run it right after anything that touched the file outside the engine.
