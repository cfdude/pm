---
description: Advisory claim/release on epics and on the repo — who owns work, and whether a conductor is quiescent
allowed-tools: Bash, Read
---

Three verbs — `claim`, `unclaim`, `owners` — for the question `state.json` could not answer:
**who is working on this epic, since when, and is it safe for another session to write here?**

They exist for multi-session and multi-repo work: an orchestrator dispatching epics into a
sibling repo's conductor needs to know whether a session is mid-operation there before it
writes, and needs to tell "in progress" from "abandoned when a session died".

## It is ADVISORY, and here is exactly what that means

| | |
|---|---|
| **What honours a claim** | `claim` and `unclaim`. Nothing else. |
| **What ignores it** | Every other verb — `update-epic`, `record-gate-review`, `sync`, the hooks. They behave against a claimed epic exactly as they always did. |
| **Two sessions both claim** | The second is told who holds it and until when, and **exits non-zero having written nothing**. Not silent corruption — not a write at all. |
| **The real write race** | Handled separately by `state.json`'s revision guard (optimistic concurrency). `--steal` does **not** touch it. |

A marker nobody honours is worse than no marker, because it looks like coordination. So exactly
one surface refuses, and it is the one whose entire job is coordination.

## Claiming an epic

```bash
conductor.mjs claim <epic-id> --session <name> [--ttl <minutes>] [--steal]
```

Writes `epic.claim = {session, claimedAt, ttlMinutes}` in `.conductor/state.json`.

- `--session` is required. `PM_SESSION` in the environment supplies it; an explicit `--session`
  beats the environment, so an orchestrator can act *as* a named identity without exporting a
  variable every child process then inherits.
- Re-claiming as the **same** session succeeds and **extends** the TTL. That is the heartbeat.
- Claiming over someone else's **expired** claim succeeds and reports the takeover on stderr.
- Claiming over someone else's **live** claim is refused; `--steal` overrides it and says so.
- An **archived** epic cannot be claimed — the work has ended.

## What expires a claim

Its own stated TTL, recorded on the claim (`ttlMinutes`), so a claim taken under one default
keeps its meaning when the default changes. Default **120 minutes** for an epic.

This is deliberately a TTL rather than the `heartbeatAt` the original request suggested. A
heartbeat nothing beats is `claimedAt` in a costume: it makes the staleness threshold wrong in
both directions — a live session reads stale after N quiet minutes, and a crashed one reads live
for N minutes after its last write. Nothing sweeps expired claims; expiry is a *reading* of the
record, which is what lets `owners` and `integrity` agree without either of them writing.

## Releasing

```bash
conductor.mjs unclaim <epic-id> --session <name> [--steal]
```

Named `unclaim`, not `release` — `release` already means "a version of this project" here.

- Releasing a claim you do **not** hold is refused. That is the move that turns an advisory
  marker into a lie: the holder keeps working believing it is still theirs. `--steal` overrides.
- Unclaiming something not claimed is a **no-op that exits 0**. Idempotent on purpose — the
  natural caller is a session cleaning up on the way out, and a cleanup that fails when there is
  nothing to clean up is a cleanup people stop running.
- Archiving an epic clears its claim automatically, and says so.

## The repo-level quiescence marker

```bash
conductor.mjs claim   --repo --session <name> [--ttl <minutes>] [--steal]
conductor.mjs unclaim --repo --session <name> [--steal]
```

"Some session is mid-operation in this repository." This is **strictly later** than "the work is
done": a code review after the work routinely files follow-up stories, so the session is finished
coding and still writing to the conductor. Release it when you are done touching the conductor,
not when you are done with the work.

Default TTL **30 minutes**, shorter than an epic claim on purpose: a crashed session holding a
"do not write here" flag for two hours is exactly the false signal this feature must not create.

It lives in a git-ignored sidecar, `.conductor/session-claim.json`, **not** in `state.json` — it
answers "is it safe to write to `state.json` right now", so putting it inside the file it is
worried about, where setting and clearing it bump `revision` and can themselves conflict, would
invert its purpose.

## Reading it

```bash
conductor.mjs owners [--json]
```

Read-only, and behaviourally verified as such by the suite (`verb-effects.mjs`) — an orchestrator
inspecting a sibling repo must not dirty it on the way to asking whether it is safe to write
there.

Reports the repo marker and every epic claim as `HELD` or `STALE`, with when each expires.
With no claims at all it says `QUIESCENT` — and says in the same breath what that does *not*
mean: a session that never claimed is invisible here. It is a cooperative signal, not a lock.

`conductor.mjs integrity` is the surface that finds a stale claim **without being asked**, which
matters because a stale claim is by construction left by a session that is no longer there to
ask. It reports two shapes: an expired claim (ordinary — how a dead session looks) and a claim
on an archived epic (a record that cannot be true).

## One edge worth knowing

`claim --steal e1 --session x` refuses with the usage line: the shared flag parser takes the token
after any flag as its value, so `--steal` swallows `e1`. That is this engine's behaviour for every
valueless flag (`--done`, `--no-deferrals`, `--clear-links`), not something new here. Put the
positional first — `claim e1 --session x --steal` — which is the order every usage line shows.

## Per-session accountability

`owners` answers the present. The claim's `session` and `claimedAt` also give an after-the-fact
trail of which session held which epic, which is useful for auditing an autonomous multi-session
run even when nothing went wrong.
