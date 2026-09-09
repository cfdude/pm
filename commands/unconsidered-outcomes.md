---
description: List the archived epics whose outcome nobody considered, with the invocation that would record one
allowed-tools: Bash, Read
---

Ask the engine which archived epics ended with an outcome **nobody was asked about** — and get,
for each one, the exact invocation that would record a real disposition.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" unconsidered-outcomes
```

If `${CLAUDE_PLUGIN_ROOT}` is empty:
`ENGINE="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/conductor.mjs}"; [ -f "$ENGINE" ] || ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1); node "$ENGINE" unconsidered-outcomes`

Read-only. It reports; it never repairs, and it never writes state.

## What it returns

```json
{
  "count": 2,
  "unconsidered": [
    {
      "id": "some-old-epic",
      "title": "Some old epic",
      "lane": "claude-code",
      "recordedBy": "migration",
      "recordedAt": "2026-07-02T10:04:00.000Z",
      "invocation": "update-epic some-old-epic --status archived --outcome <delivered|killed|superseded|abandoned|declined|unreconstructable> --reason \"<why>\" --no-deferrals"
    }
  ]
}
```

`recordedBy` is carried through rather than summarised, because "the migration wrote this" and
"the archive-drift heal wrote this" are different histories, and which one you are looking at
changes how much of the epic's story is still recoverable.

## The predicate, and why it is two halves

An epic is in this set when its disposition is an **engine stamp** *and* its outcome is
`unknown`. Both halves are load-bearing:

- **An engine stamp alone is not enough.** A stamp can be evidence-derived — the 0.27.0 migration
  wrote `delivered` wherever a passing Gate 2 verdict existed. Handing those back would ask an
  agent to re-derive what the record already derived correctly.
- **An `unknown` value alone is not enough either.** An epic carrying no disposition at all also
  reads `unknown`, and an absent disposition is deliberately outside the population: every
  archive path binds the outcome invariant, so a predicate handling absence would handle a state
  no path produces.

An **agent-recorded** outcome is never in this set, whatever its value. Somebody was asked.

## What to do with the answer

Work through them and record a disposition per epic, using the invocation the engine handed you.
Where the record genuinely cannot be reconstructed — the history is gone, nobody remembers, and a
guess would be a fabrication — that is what `unreconstructable` is for, and like every outcome
except `delivered` it requires its reason:

```bash
node "$ENGINE" update-epic <id> --status archived \
  --outcome unreconstructable \
  --reason "archived before dispositions existed; no tasks.md, no commits attributed" \
  --no-deferrals
```

Recording one removes that epic from this set. That is the loop: the set shrinks only by
somebody deciding, never by the engine guessing.

## What this verb is NOT

It is not an integrity check, and that was a decision rather than an omission. `integrity`
findings are each expected to name their epic in the archived `integrity-day-one.md` document, so
registering this population there would mean writing every id in it into a closed change's
document. It is a question you ask, not a finding filed against you.

It also does not reach an epic whose `status` is something other than `archived` — a `done` epic,
say. That is the **unknown-status** integrity check's half of the same measured number: it reports
the illegal status, and this walker reaches those epics only after a human moves them to
`archived`. Two halves of one problem, split across two surfaces on purpose.
