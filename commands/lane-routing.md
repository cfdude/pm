---
description: Define per-repo keyword/glob overrides that pick an epic's lane before the generic heuristic runs
allowed-tools: Bash, Read
---

Most repos never need this — the generic lane heuristic (documented in `CLAUDE.md`'s "Routing
rule" and the `conductor` skill: `>8h`/cross-system/new capability → openspec; `2-8h`
single-subsystem → superpowers; `<2h` tweak → claude-code; procurement/product → decision;
other-repo → external) is usually right. **Lane routing overrides** exist for the repos where it
isn't — e.g. this repo always wants anything touching `openspec/` proposals routed to the
`openspec` lane regardless of estimated size, or a repo has a standing rule that anything titled
"hotfix" skips design entirely and goes straight to `claude-code`.

This is an **optional, additive, local-only** config block — `laneRouting.overrides` in
`.conductor/state.json`. Like `set-tracker`, the engine never enforces it on its own: `add-epic`
still always takes an explicit `--lane`. What this gives you is `suggest-lane`, a lookup the
interactive agent should consult BEFORE applying the generic heuristic whenever it needs to
choose a lane for a new epic (at `/pm:epic add`, at `/pm:sync`, at hierarchy-planning time).

## Record overrides

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" set-lane-routing \
  --add "billing-*:openspec" --add "hotfix:claude-code"
```

- `--add "<match>:<lane>"` — repeatable. `match` is either a plain case-insensitive substring
  (`hotfix` matches "urgent hotfix for prod") or a `*`-glob (`billing-*` matches
  "billing-refund-flow"). `lane` must be one of `openspec | superpowers | claude-code | decision |
  external`. Adding the same `match` again replaces the earlier rule (last one wins).
- `--remove "<match>"` — repeatable, drops a rule by its exact `match` string.
- `--clear` — empties the whole overrides list.
- All three flags can be combined in one invocation (clear/remove are applied before add).

Re-running `set-lane-routing` merges: only what you pass changes.

## Consult it before assigning a lane

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" suggest-lane "hotfix: fix broken login button"
# {"lane":"claude-code","matched":"hotfix"}

node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" suggest-lane "add a brand-new subsystem"
# {"lane":null,"matched":null}   -- no override matched, fall back to the generic heuristic
```

Overrides are checked in the order they were added; the first match wins. `lane: null` means
nothing matched — apply the documented generic heuristic as usual.

If `${CLAUDE_PLUGIN_ROOT}` is empty:
`ENGINE="${CLAUDE_PROJECT_DIR:+$CLAUDE_PROJECT_DIR/scripts/conductor.mjs}"; [ -f "$ENGINE" ] || ENGINE="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/conductor.mjs}"; [ -f "$ENGINE" ] || ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1); node "$ENGINE" suggest-lane "…"`
