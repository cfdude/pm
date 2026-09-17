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
      "invocation": "update-epic some-old-epic --status archived --outcome <delivered|killed|superseded|abandoned|declined|unreconstructable> --reason \"<why>\" --no-deferrals",
      "deliveredBlockedBy": []
    },
    {
      "id": "old-spec-change",
      "title": "Old spec change",
      "lane": "openspec",
      "recordedBy": "migration",
      "recordedAt": "2026-07-02T10:04:00.000Z",
      "invocation": "update-epic old-spec-change --status archived --outcome <killed|superseded|abandoned|declined|unreconstructable> --reason \"<why>\" --no-deferrals",
      "deliveredBlockedBy": [
        {
          "kind": "gate2-missing",
          "detail": "missing a passing Gate 2 (implementation review) verdict — the record shows no Gate 2 review of this work, and recording `delivered` requires a real one",
          "remedy": ["record-gate-review old-spec-change --gate 2 --verdict pass --base-sha <sha> --head-sha <sha>"]
        }
      ]
    }
  ]
}
```

## `delivered` is offered only where the archive gate would accept it

Each entry's `invocation` offers only the outcomes the archive gate accepts **for that epic**. An
openspec-lane epic never reviewed at Gate 2 is **not offered `delivered`** — before this, the
choice list named it, and substituting `delivered` produced a command that exited 1 (gh-189
measured 12 of 20 entries blocked that way). Nothing about the gate changed; only what is offered.

`deliveredBlockedBy` says why, and is always present — `[]` when nothing blocks. Each entry is
`{kind, detail, remedy}`:

- `kind` — the obligation: `gate2-missing`, `gate2-withdrawn`, `gate2-stale`,
  `gate2-attribution-withdrawn` or `handoff` (outstanding work).
- `detail` — the finding. For `gate2-missing` it states the process fact plainly: the record shows
  no Gate 2 review of this work, and `delivered` requires a real one.
- `remedy` — the command lines that meet it, **in order**, each one runnable once its placeholders
  are filled.

**The entries are ordered too, and you run them in that order** — every Gate 2 obligation before
the handoff, because a checkbox source's handoff is met by the `delivered` archive itself, which
the gate refuses while Gate 2 is unmet.

A **checkbox source's handoff** (an OpenSpec `tasks.md` or a plan with open tasks) has no
standalone command — no verb ticks a checkbox — so its remedy is the `delivered` archive carrying
the handoff:
`update-epic <id> --status archived --outcome delivered --carried-to <epicId> --reason "<which tasks moved>" --no-deferrals`,
where `<epicId>` is the registered epic now holding the moved work. A stories source's handoff
names `update-epic <id> --story <n> --done` instead.

Once the blocking obligation is met — Gate 2 recorded, say — re-run `unconsidered-outcomes`: the
output is recomputed from the record on every call, and `delivered` is offered again.

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
