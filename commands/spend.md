---
description: Opt-in per-epic token spend — which epic, phase, role and model the tokens went to
allowed-tools: Bash, Read
---

pm cannot tell you where the tokens went. A release can spend millions of sub-agent tokens, most of
it on one epic that needed seven review rounds, and nothing in `state.json` says so until it is over.
The spend ledger answers that from Claude Code's own transcript files: read-only, local, and
**off by default**, because measuring costs reads.

```bash
conductor.mjs set-spend-tracking on|off
conductor.mjs spend [--epic <id>] [--since <iso>] [--until <iso>] [--json] [--no-ingest]
conductor.mjs spend --clear [--timeline] [--yes]
conductor.mjs spend --rebuild [--yes]
```

`set-spend-tracking on` stores `state.spendTracking = {enabled, enabledAt}`. `enabledAt` is the time
of the FIRST `on` and never moves: it bounds how far back an ingest ever looks (a transcript whose
mtime is older is not even opened). `init` and `upgrade` never turn it on; `upgrade` lists it as
`NOT SET` until you do. It is refused in a linked worktree (the switch and the ledger belong to the
main working tree) and while the main working tree's HEAD is detached. Run it again with the same value
and it says so and writes nothing.

## What it reads, and what it does not

`spend` is the **only** reader. No hook reads a transcript or a ledger file, with tracking on or off,
and a repo with tracking off pays nothing new on any hot path. With tracking on, the only extra work
per engine invocation is one read of `state.json` to compare `state.active` before and after, and one
timeline line when it changed.

Ingest reads `$CLAUDE_CONFIG_DIR/projects` (default `~/.claude/projects`), in the directory named for
the main working tree's path with every character outside `[A-Za-z0-9]` replaced by `-`:

- the repo's own sessions (`*.jsonl`) and each session's `subagents/agent-*.jsonl`;
- every sibling directory named with that encoding plus `--claude-worktrees-agent-<id>`, which Claude
  Code creates for a worktree-isolated agent. Its entries look like a main session (`isSidechain` is
  false and `agentId` is null) and are not: the agent id comes from the directory name.

It opens transcripts read-only, opens no network connection and invokes no model. It stores **counts
and identifiers only** — token counts, the model, message, session and agent ids, a timestamp and the
names of the tools called. Never a prompt, a response, a tool input or output, a file's content, a
working directory, or a sub-agent's description.

One API message appears in a transcript as two or three entries sharing a `message.id`, with the
output count growing as it streams. The ledger folds them to one: the counts of the entry with the
greatest `output_tokens`, the tool names merged. `usage.iterations` and the thinking tokens are
subsets of those counts and are never added.

The ledger lives in the **main** working tree's `.conductor/spend/` (git-ignored by `init` and
`upgrade`) from any working tree. A linked worktree reads the main tree's `state.json` for the switch,
`enabledAt` and the epic set.

## Attribution

Computed when the ledger is **read**, never stored, so an epic registered after its spend still gets
the credit and a removed epic's rows report as `unknown-epic`. First rule that applies wins:

1. **tracking-off** — the row falls in a period the switch was off. `set-spend-tracking off` appends an
   off entry to the timeline, so spend made then is never credited to an epic, whatever its marker.
2. **marker** — a **sub-agent** row takes epic, role, phase and round from its agent's marker.
3. **window** — an **orchestrator** row takes the epic the timeline says was active at its time.
4. **unattributed**, with a reason from a closed list: `tracking-off`, `unmarked-subagent`,
   `invalid-marker`, `unknown-epic`, `no-active-epic`, `before-timeline`.

A sub-agent row is never window-attributed: background sub-agents build several epics at once, so a
window would credit them to whichever epic the orchestrator last activated.

### The dispatch marker

While tracking is on, the rules block tells you to begin every sub-agent dispatch prompt with one line:

```
pm-spend: epic=<id> role=<role> phase=<phase> [round=<n>]
```

- `role` is one of `implement`, `test`, `review` — the execution profile's `KNOWN_JOB_ROLES`; the
  ledger declares no role list of its own.
- `phase` is one of `plan`, `build`, `review`, `docs`, `release`.
- `round` is a positive integer, 1 when omitted. A review gate's retry is `phase=review` with
  `round` above 1.

The engine reads the first such line of a sub-agent's first user entry, once, and stores the four raw
tokens. A marker naming a role or phase outside those lists, or a round that is not a positive
integer, is `invalid-marker`; one naming an epic that is not registered (now) is `unknown-epic`.

## The report

`spend` ingests (unless `--no-ingest`, tracking is off, or the main tree's HEAD is detached), then
prints per-epic totals split by actor, role, phase, round and model tier, each sub-agent's own totals,
the **unattributed total by reason** and a **coverage share**. The unattributed line is printed even
when it is 0: spend that was not measured must never look like spend that did not happen.
`--epic`, `--since` and `--until` (half-open: `since <= at < until`) narrow what is summed.

`--json` prints one object — `tracking`, `ingest`, `epics`, `unattributed`, `coverage`, `cost`. Every
totals object holds `input`, `cacheCreation`, `cacheRead`, `output`, `total` (the four summed, nothing
else) and `messages`. `epics.<id>` holds `totals`, `byActor`, `byRole`, `byPhase`, `byRound`, `byTier`,
`firstAt`, `lastAt` and `agents.<agentId>` (`role`, `phase`, `round`, `tier`, `totals`).

**No cost is computed.** pm ships no price table: a hardcoded per-token price is an invented number
that goes stale silently. Tokens are the measure, and Claude Code's own cost figures are notional
under subscription auth.

## Every write has an inverse

| Write | Inverse |
|---|---|
| `set-spend-tracking on` | `set-spend-tracking off` — stops all reading and deletes nothing |
| ingest (rows, markers, cursor) | `spend --clear --yes` |
| rows lost or corrupt | `spend --rebuild --yes` — re-derives from the transcripts still on disk |
| the timeline | `spend --clear --timeline --yes` — the timeline cannot be rebuilt, so it is never removed implicitly |
| the rules-block section | `set-spend-tracking off` re-renders the block without it |

Without `--yes`, `--clear` and `--rebuild` print their plan and change nothing (this engine is driven by
agents and hooks, so a prompt on stdin would hang rather than confirm). `--clear --timeline` says that
the off intervals and active-epic windows are lost, and that spend from an off period may be credited
to epics by marker after a re-ingest. `--rebuild` is refused while tracking is off, because it reads
transcripts; it keeps the timeline and **keeps every row and marker whose transcript is gone** — Claude
Code prunes old transcripts (`cleanupPeriodDays`), and once one is gone the ledger is the only copy, so
the plan names how many rows were kept for that reason. `--clear` and `--rebuild` do not combine,
`--timeline` needs `--clear`, and neither takes the report filters.

## What it does not measure

- **Claude Code's own background calls** (the small-model calls behind titles and summaries) never
  appear as assistant entries, so they are not in the ledger. `cost-state` includes them; the ledger
  does not reconcile with it.
- **Spend before `enabledAt`**, and **spend while tracking was off**.
- **Anything a platform other than Claude Code writes.**
- **A transcript Claude Code has already pruned**, unless an earlier ingest read it.
- **The orchestrator's own spend during a release candidate** is window-attributed to whichever epic
  is active, though it serves the whole release. A release-level bucket is for the analysis epic.

Two ingests never interleave: a second `spend` while one runs reports from the existing ledger and says
an ingest was in progress (`ingest.lock`, broken after ten minutes). The ledger is machine-local.
