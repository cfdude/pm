---
description: Record a significant decision an epic's work reached, so a postmortem can show what it cost; or withdraw one
allowed-tools: Bash, Read
---

A postmortem should say not only where tokens went but what DECISIONS they bought. `record-decision` appends a
numbered decision to an epic: what was decided, why, the alternatives considered, the phase, and the **window of
work** that reached it. The decision's cost is never typed and never stored: `decisions` computes it when read,
from the spend ledger (see `commands/decisions.md`).

Record a decision when the choice is worth reflecting on afterwards (a design fork, a re-plan, a split, a tier
change), not every choice made.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" record-decision <epicId> --what "<decision>" --why "<why>" --since <iso> [--until <iso>] [--alternative "<alt>"]... [--phase plan|build|review|docs|release]
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" record-decision <epicId> --withdraw <n> --reason "<why>"
```

If `${CLAUDE_PLUGIN_ROOT}` is empty:
`ENGINE="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/conductor.mjs}"; [ -f "$ENGINE" ] || ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1); node "$ENGINE" record-decision <epicId> ...`

| Flag | Effect |
| --- | --- |
| `--what` / `--why` | the decision and the reason; each non-blank, at most 2,000 characters |
| `--since <iso>` | the start of the window of work that reached it (required) |
| `--until <iso>` | the end of the window; defaults to the record time, and may not be before `--since` or in the future |
| `--alternative "<alt>"` | an alternative that was considered; repeatable |
| `--phase <phase>` | one of the spend phases |
| `--withdraw <n>` | mark decision `n` withdrawn (with `--reason`), keeping it; takes no other decision field |
| `--session <name>` | as on every epic-writing verb |

Numbers are per epic, start at 1 and are never reused, so `--withdraw 2` cannot hit a different decision after a
later append. An archived epic accepts a decision. A correction is a withdrawal plus a new entry: there is no edit.

## Off with spend tracking

Recording is **refused while spend tracking is off**, naming `set-spend-tracking on` and
`update-epic <id> --notes` (a decision whose cost can never be computed belongs in an epic note). Withdrawing reads
no ledger and stays accepted. Turning tracking off later deletes no decision; `decisions` then reads
`cost: not computed`. A fresh `init` or `upgrade` records none.
