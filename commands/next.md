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

> Progress is claimed completion — ticked checkboxes, not verified delivery. An epic reading `12/12` is a claim its
> gate verdicts have not confirmed, so say so when you report progress rather than presenting
> it as delivery.

1. **If the detour stack is non-empty** → the next action is to finish/resume the TOP
   frame. If its detour epic is already archived, this is a `/pm:resume` (which triggers
   the reconcile gate). Do not start new work while a detour is unresolved.
2. **Read `## Dependency warnings` in `PROJECT.md` BEFORE picking anything.** It is absent when
   there is nothing to say. Each line names an epic that cannot be started, what it waits on,
   and what status that dependency is in. An epic named on the LEFT of one of those lines is
   **not workable** — do not offer it as next-up, however high its priority. Say so, name the
   dependency, and put the decision to the user in one line:

   > Highest priority is `evidence-overhaul` (P1) — blocked by `gate2-write-path` (P2, planned,
   > effective P1). Next: `gate2-write-path` — or descope the P1.

   Sometimes the right answer *is* "drop the P1", and nothing else asks.
3. **Otherwise** → the highest-priority epic with status `queued` (P0 → P3), reading the
   **effective** priority where the Priority column shows two values. `P2 → P1` means P2 on
   merit, sorting as P1 because a P1 depends on it: the merit priority is what the epic is worth
   on its own, the effective one is what the record needs next. A `planned` or `later` epic is
   still not in NEXT UP — pulling it forward means promoting it to `queued` first (`update-epic
   <id> --status queued`), which is a decision, not an inference the engine makes for you.
   If the active epic still has open stories, that is the default next action.
4. An epic in status `blocked` with no `depends-on` link records nothing about what it waits on.
   PROJECT.md says so. Fix it while you are there:
   `update-epic <id> --link "depends-on:<blocker-id>:<why>"` — noting that `--link` REPLACES the
   links array, so pass every link the epic should end up with.
5. Surface ties or ambiguity to the user instead of guessing.

Once you've chosen the epic to work on, **make it the active epic through the CLI — do not
hand-edit `state.json`**:

```bash
node "$ENGINE" set-active <epic-id>
```

`set-active` sets the top-level `.active` pointer AND the epic's `status: "active"` together (and
demotes any previously-active epic), so the briefing's "NOW" line is correct. `clear-active` drops
the pointer.

End with a single, concrete recommendation: "Next: \<epic\> — \<the specific story/phase\>."
