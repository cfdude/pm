---
description: Analyse the token spend ledger as a postmortem - where tokens went, which agents are outliers, and what to change
allowed-tools: Bash, Read
---

`spend` says how many tokens each epic used. `spend-analysis` says where they went: it keeps the four token
classes apart, ranks sub-agents by `work` (never by `total`, which is mostly cache-read), counts tool use,
flags outliers from a closed list of rules, and renders one recommendation per flag. It reads the existing
ledger only, never turns tracking on, writes nothing to `state.json`, opens no network connection and calls no
model.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" spend-analysis [--epic <id> | --release <id>] [--json] [--no-ingest]
```

If `${CLAUDE_PLUGIN_ROOT}` is empty:
`ENGINE="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/conductor.mjs}"; [ -f "$ENGINE" ] || ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1); node "$ENGINE" spend-analysis`

| Flag | Effect |
| --- | --- |
| `--epic <id>` | one epic (it must exist) |
| `--release <id>` | the epics whose `release` is that id (the release must be declared) |
| `--json` | one object: `tracking`, `scope`, `breakdown`, `agents`, `unattributed`, `coverage`, `tools`, `flags`, `trend`, `cost` |
| `--no-ingest` | analyse the ledger as it stands; read no transcript |

`--epic` and `--release` are exclusive. With neither, the scope is the whole ledger.

## What it reports

- **Breakdown.** `input`, `cache-write`, `cache-read`, `output`, `work` and `total` for the scope, split by actor
  (orchestrator against sub-agents), model tier, role and phase. Each list is ordered by `work`.
- **Sub-agents**, ranked by `work`, with `total`, message count and the mean context per message
  (`input + cacheCreation + cacheRead`).
- **Unattributed spend and coverage** as their own section. They are ledger-wide under `--epic` and
  `--release`, because a row with no epic belongs to no scope.
- **Tools.** The number of messages that called each tool, per actor. A ledger row stores a message's tool names
  once, so a message calling `Read` twice counts once. Tokens are not apportioned to tools: a message's usage is
  one number for everything in it.
- **Outliers**, from a closed list of rules. Each flag prints its evidence, its threshold and exactly one
  recommendation, rendered from fixed text for the rule (no model call). Every threshold is a named constant
  labelled a PROPOSAL, tuned on one release's data, not a measurement:

  | Rule | Raised when | Recommendation |
  | --- | --- | --- |
  | `long-context-agent` | a sub-agent has at least 100 messages and at least 200,000 mean context per message (`input + cacheCreation + cacheRead`) | split the batch or hand off to a fresh context |
  | `dominant-agent` | one agent holds at least 50% of an epic's work, on an epic with 2 or more agents | the plan left one executor too much to decide: sharpen it |
  | `tier-mismatch` | role `mechanical`, `rudimentary` or `test` on an opus or fable tier; role `plan` or `review` on a haiku tier | `set-profile --model <role>=<model>` |
  | `review-loop` | an epic's `phase=review` rows carry at least 3 distinct round values (not the spend guard's rounds signal, which counts from the pass anchor) | `spend-guard <epic>`, escalate |
  | `low-coverage` | ledger coverage is below 90% | mark dispatches and keep an epic active |
  | `invalid-markers` | any `invalid-marker` tokens | fix the phase and role names `spend` lists |

  A scope with no flag says so and prints each rule's threshold. `low-coverage` and `invalid-markers` describe
  the whole ledger whatever the scope.
- **Trend.** Mean `work` per epic for each release with attributed epics (newest release first, by
  registration). A verdict (`growing` or `falling` at a 20% band, else `flat`, a proposal) needs 2 releases each
  holding at least 3 epics with attributed rows; below that it prints `insufficient data` with the counts.
  Ledger-wide, whatever the scope.
- **Cost.** Not computed, as in `spend`: tokens are the measure.

## Tracking off

With spend tracking off it says so and names `set-spend-tracking on`. It opens no path under the spend or
transcript directory. It never switches tracking on.
