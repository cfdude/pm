---
description: Decide what to work on next (resume a detour, or the top-priority epic)
allowed-tools: Bash, Read
---

Determine the next thing to work on and state it clearly.

Resolve the engine version-independently (never hardcode a versioned cache path):

```bash
ENGINE="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/conductor.mjs}"
[ -f "$ENGINE" ] || ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1)
```

Read the current state (`node "$ENGINE" render` then `PROJECT.md`), and apply this order:

1. **If the detour stack is non-empty** → the next action is to finish/resume the TOP
   frame. If its detour epic is already archived, this is a `/pm:resume` (which triggers
   the reconcile gate). Do not start new work while a detour is unresolved.
2. **Otherwise** → the highest-priority epic with status `queued` (P0 → P3). If the active
   epic still has open stories, that is the default next action.
3. Surface ties or ambiguity to the user instead of guessing.

Once you've chosen the epic to work on, **make it the active epic through the CLI — do not
hand-edit `state.json`**:

```bash
node "$ENGINE" set-active <epic-id>
```

`set-active` sets the top-level `.active` pointer AND the epic's `status: "active"` together (and
demotes any previously-active epic), so the briefing's "NOW" line is correct. `clear-active` drops
the pointer.

End with a single, concrete recommendation: "Next: \<epic\> — \<the specific story/phase\>."
