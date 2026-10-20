---
description: List an epic's recorded decisions with what reaching each one cost, computed from the spend ledger
allowed-tools: Bash, Read
---

`decisions` prints the decisions `record-decision` stored on an epic, each with the tokens its window of work
cost. The cost is **computed when read** from the spend ledger and never stored: it is the epic's attributed
`work` and `total` (as `spend` reports them) with `since <= at < until`, plus that window's coverage share. A
re-attribution (a fixed marker) re-prices a decision with no write to the record.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" decisions <epicId> [--json] [--no-ingest]
```

If `${CLAUDE_PLUGIN_ROOT}` is empty:
`ENGINE="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/conductor.mjs}"; [ -f "$ENGINE" ] || ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1); node "$ENGINE" decisions <epicId>`

| Flag | Effect |
| --- | --- |
| `--json` | one object: `epic`, `tracking`, `decisions[]` (the stored fields plus `withdrawn` and `cost`) and the note below |
| `--no-ingest` | cost from the ledger as it stands; read no transcript |

Each decision's `cost` is `work`, `total`, `messages` and `coverage` when computed, else `computed: false` with a
reason ("spend tracking is off", or "withdrawn"). A withdrawn decision is listed as withdrawn with no cost.

## What the number means

It is **the epic's spend in the window, not spend caused by the decision alone**: parallel work in the same
window is in it. Windows may overlap, so the costs are never summed. Read it as "this much was spent while this
decision was being reached", a prompt for self-reflection and not an invoice.

## Tracking off

With spend tracking off each decision prints `cost: not computed — spend tracking is off`, and no path under the
spend or transcript directory is opened. `spend-analysis --epic <id>` carries the same Decisions section.
