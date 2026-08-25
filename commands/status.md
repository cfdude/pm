---
description: Show the current conductor briefing — active epic, detour stack, next up
allowed-tools: Bash, Read
---

Show where the project stands.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" render
```
(If `${CLAUDE_PLUGIN_ROOT}` is empty:
`ENGINE="${CLAUDE_PROJECT_DIR:+$CLAUDE_PROJECT_DIR/scripts/conductor.mjs}"; [ -f "$ENGINE" ] || ENGINE="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/conductor.mjs}"; [ -f "$ENGINE" ] || ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1); node "$ENGINE" render`)

Then read `PROJECT.md` and summarize for the user:
- the **active** epic and its live story progress,
- the **detour stack** (what's paused and why), flagging any ⚠ reconcile-on-resume,
- the **next-up** queue by priority.

Story counts are derived live from each proposal's `openspec/changes/<id>/tasks.md` — if
they look stale, the tasks.md checkboxes are the source of truth, not the index.

## Auditing the record itself

`integrity` is a READ-ONLY audit of the conductor's own record — shapes that cannot be true: an
archived epic with nothing ticked, one change registered under two lanes, a gate verdict that
does not reach the commits it cites, an archive directory no epic corresponds to. It reports
every check with its count, including the ones that found nothing, so a check that measured
nothing is visibly a check that ran.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" integrity
```

It writes no state, blocks no command, and repairs nothing. Each finding names the epic and the
remediation is a command you run — recording a real Gate 2 verdict, recording the disposition an
epic actually ended with, or removing a duplicate registration. Run it when the record looks
wrong, before a release, or when you want to know what the numbers in `PROJECT.md` are hiding.

## Release planning — `release`

A release is a named grouping of epics the agent declares: an id, intent prose, an optional
target, and the epics deliberately cut from it. It exists because a release's scoping judgments
otherwise survive only in the session that made them — "what is in 0.27.0" has to be answerable
from `.conductor/state.json` alone, months later, without a conversation transcript.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" release 0.27.0 --intent "<what this release is for>" [--target <t>]
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" release 0.27.0 --member <epicId> [--member <epicId>]...
```

- **Intent prose is required to create one** and the same refusal covers naming a release that
  does not exist — an id with no statement of what it is for is unreadable later, which is the
  failure this records against.
- **Membership is one-way**: it lives on the epic as `epic.release`, at most one, and the release
  object carries no member list to fall out of step with it. Re-associating an epic MOVES it.
- **The engine proposes nothing.** No epic is auto-assigned, and adding, re-prioritizing or
  archiving epics changes membership for none of them. Grouping is a scope judgment, and the
  scope judgment is the thing being preserved.
- Re-running `release <id> --intent …` amends that release in place rather than registering a
  second one.
