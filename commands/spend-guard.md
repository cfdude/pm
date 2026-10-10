---
description: Check whether an epic is stuck in a review loop or past its token ceiling, and who to hand the failure to
allowed-tools: Bash, Read
---

A review loop that cannot converge keeps spending tokens until a person notices. `spend-guard` is the
check. It counts an epic's failed review rounds, compares its attributed token spend with a ceiling, and
exits **2** while the epic is stuck, printing a STOP block that names who to hand the failure to. It
dispatches nothing and kills nothing: pm is an instruction layer, and the agent or the user acts on the
STOP.

```bash
conductor.mjs spend-guard <epicId> [--json] [--no-ingest]
```

No limit is on by default. Set one with `set-spend-guard` (see `commands/set-spend-guard.md`); until then
the guard reports counts and never trips. The gate-round counter itself is always recorded, with or without
a limit: every accepted `record-gate-review` updates `epic.gateRounds.gate<N>` in the same write as the
verdict.

## What it reports

| Signal | Counted from | Trips when |
|---|---|---|
| `rounds` | the larger of the epic's highest recorded **fail streak**, and (tracking on) the distinct `round` values on its attributed `phase=review` ledger rows since the epic's last recorded pass, minus one | the count, minus the live override baseline, reaches `maxFailedRounds` |
| `tokens` | the epic's **attributed** total from the spend ledger (the figure `spend` reports) | the total, minus the live override baseline, reaches `tokenCeiling`; it warns from `warnAt` percent (default 80) |

The report prints each signal's count, limit and the layer each limit came from (`epic`, `lane:<lane>` or
`project`), which of the two rounds counts decided, the live overrides, and the escalation target for each
signal. `--json` prints one object: `epic`, `stuck`, `signals.rounds` and `signals.tokens` (each with
`state`, `count`, `limit`, `source` and `baseline`), `overrides`, `escalation`, `tracking`, `coverage`,
`notes`, and `stop` when stuck.

**Exit codes.** 0: no signal is tripped. 2: a signal is tripped (the STOP block is printed first). 1: wrong
arguments or an unknown epic, and nothing else. Exit 2 is also Claude Code's hook "block" code, so
**never wire `spend-guard` into a hook**; the rules block asks the agent to run it before each review or fix
dispatch instead.

## The STOP

A STOP means: stop dispatching same-tier retries for the epic, hand the failure evidence (the last failing
findings or tests, the verdicts recorded, the diff) to the escalation target and ask "what is wrong and how
do we resolve it?", then record the decision with `override-spend-guard`. **Epic-level autonomy does not
bypass a STOP**, and no autonomy grant covers continuing past it.

The escalation target is the next model above the resolved model of the role tied to the signal (`review`
for rounds, `implement` for tokens) in the order `haiku < sonnet < opus < fable`; the user is always also
valid. The resolved model counts whatever its source, a built-in default included, and the block names the
source. Only `fable`, a model outside that order, or no model at all gives `user`.

## Which tree it reads

Limits, tallies and overrides come from the `state.json` of the tree the verb runs in, the file
`record-gate-review`, `set-spend-guard` and `override-spend-guard` write there. Only the tracking switch and
the ledger come from the **main** working tree, as `spend` reads them.

## It degrades, and says so

- **Tracking off.** The token ceiling is `not checked` and the rounds signal uses recorded verdicts only. The
  report says ledger review rounds were not read because tracking is off. No spend or transcript path is opened.
- **Ingest cannot run** (another ingest holds `ingest.lock`, the main tree's HEAD is detached, or
  `--no-ingest`). The existing ledger is read, both ledger-fed signals are computed from it and may trip, and
  the report says the ledger was not refreshed, why, and that counts may be stale.
- **The ledger cannot be read** (an unreadable `enabledAt`, an unreadable main-tree `state.json` seen from a
  linked worktree, a failing ledger read). The ledger side and the token signal read `not-read` with the
  reason, tracking is `unknown` where it could not be told (never "off"), the recorded-verdict check still
  applies, and the exit code is 0 or 2, never 1.
- **A withdrawn verdict.** Withdrawing a gate verdict does not un-count the round. When a gate's latest verdict is
  withdrawn the report says so, and that a withdrawn pass still anchors the ledger side and override liveness.

## What it does not detect

Repeated failing `certify` runs (a certify run is bound to the index, not to an epic, so there is nothing to
count against), per-test failures, and review rounds nobody marked: with tracking on a dispatch must begin
with `pm-spend: epic=<id> role=review phase=review round=<n>`, or its tokens are unattributed and its round is
not seen. The brief's STOP line (below) is computed from recorded verdicts alone, because no hook reads the
ledger, so it can miss a ledger-only trip; the per-dispatch `spend-guard` call covers that.

## Where else it speaks

- `record-gate-review` still records every verdict, however many have failed. When the accepted verdict leaves
  the recorded rounds signal tripped, the same invocation prints the STOP block on stderr after the success
  line and exits 0.
- The SessionStart and PreCompact brief carries one `STOP: spend guard —` line for a stuck active epic.
- The managed rules block carries a `## Spend guard` section, only while a limit is configured.
