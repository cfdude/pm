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

**At least one operation is required.** A bare `set-lane-routing` used to write an empty
`laneRouting: {overrides: []}` block where none existed and report success. It now exits 1
before reading or writing anything:

```text
conductor: set-lane-routing needs an operation — --add "<match>:<lane>", --remove "<match>" or --clear. Nothing was written.
```

There is no read form; `.conductor/state.json` holds the overrides, and `suggest-lane` below
applies them.

## Consult it before assigning a lane

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" suggest-lane "hotfix: fix broken login button"
# {"lane":"claude-code","matched":"hotfix"}

node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" suggest-lane "add a brand-new subsystem"
# {"lane":null,"matched":null}   -- no override matched, fall back to the generic heuristic
```

Overrides are checked in the order they were added; the first match wins. `lane: null` means
nothing matched — apply the documented generic heuristic as usual.

**Quote the text.** `suggest-lane` reads ONE argument. Unquoted, `suggest-lane fix a typo`<!-- pm:refused extra-positional --> used to
route `fix` alone; it is now refused before anything runs:

```text
conductor: suggest-lane takes "<free text>" — 'a' is an extra argument it does not read. Nothing was written.
  suggest-lane reads ONE text argument — quote it.
```

A quoted text that begins with `--` but is not shaped like a flag (it contains a space, say) is
still text. `--help` anywhere after either verb prints its
help and writes nothing.

### `--ask=<text>` — a text shaped like a flag

Quoting changes what the shell passes, never how the engine classifies a token, so a text that IS
flag-shaped cannot be passed positionally: `suggest-lane '--limit=5 ignored'`<!-- pm:refused unknown-flag --> is refused as an
unknown flag, quoted or not, and a text reading `--help` prints help. Pass it attached to `--ask`
instead — the value after `=` is never reclassified:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" suggest-lane --ask='--limit=5 ignored'
```

The positional form is unchanged and is still the one to use for text you typed. `--ask` exists for
text you did not write — a tracker item's title — which is why the emitted inward-sync recipes
route with `suggest-lane --ask=<issue-title>`, the title filled as one single-quoted word. Giving
both `--ask` and a positional text is refused as an extra argument (one verb, one text), and giving
neither prints the usage.

**`suggest-lane` is an input, not an answer.** It reads THE ASK and nothing else: the words, the
size, the overrides recorded here. It cannot ask what a person would ask — whether this work
SERVES something the project already committed to — because pm holds no milestone or product
context to weigh, and the engine will not invent one.

**The tie-break is asymmetric.** `claude-code` means no spec, no plan, no gate and no stories —
right for a genuine sub-2-hour tweak, and the reason a misrouted epic leaves no record of what it
was FOR. Over-processing costs hours; under-processing costs the record permanently. So an
unresolved routing question resolves AWAY from `claude-code`, never into it. When you register in
a lane other than the one this returned, say why on the epic:
`update-epic <id> --notes "lane: <chosen> not <routed> — <why>"`.

If `${CLAUDE_PLUGIN_ROOT}` is empty:
`ENGINE="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/conductor.mjs}"; [ -f "$ENGINE" ] || ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1); node "$ENGINE" suggest-lane "…"`
