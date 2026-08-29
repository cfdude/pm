---
description: Optional activity log — what this conductor actually did, and the reader that answers for it
allowed-tools: Bash, Read
---

`.conductor/state.json` is a snapshot of the present. It cannot answer a single question about
*how* a project got there. The activity log records the transitions; `activity` reads them back.

**Off by default. On in the maintainer's repos.** Same posture as the EDD harness: not obviously
valuable to a daily consumer, decisive for improving the product.

```bash
conductor.mjs set-activity-log on|off
conductor.mjs activity [--since <iso>] [--epic <id>] [--json]
conductor.mjs purge-logs [--kind activity|conflicts|detours|all] [--keep <n>]
                         [--over <size>] [--older-than <days>] [--dry-run] [--yes]
```

## The reader ships with the writer — that was the condition

A log nothing reads is a data graveyard: it costs write-path complexity, rotation, retention and
a purge CLI, all paid immediately, for a benefit that stays speculative until something consumes
it. So every section `activity` prints answers a question the feature was filed to answer, and
nothing is recorded "in case it is useful later".

| Question | Section |
|---|---|
| How long did an epic sit `queued` before it was picked up? | **TIME TO PICKUP** |
| How many detours interrupted it? | **DETOURS** |
| Which lane was chosen, and did the work prove it wrong? | **LANES** (registrations + re-routes) |
| When was a gate verdict recorded, relative to everything else? | **GATES** |
| How often does an agent take the instructed path vs. work around it? | **OUT-OF-BAND WRITES** |

**The last row is why the log earns its overhead.** Every event carries the `state.json` revision
range it covers. A revision the file reached that no event accounts for is a write the *engine*
did not make — a hand-edit. That is #110 (a gate defeated silently, previously discoverable only
by `jq` across 15 repos) turned into a query.

## One chokepoint, not an instrumentation sweep

Events are **derived** by diffing `state.json` across one invocation, from the engine's dispatch —
not emitted by hand from each of the ~25 verbs that write state. A list of emit sites typed from
memory goes stale the moment a verb is added, and a verb that forgot to emit would be invisible in
exactly the log built to find invisible things. The diff cannot forget.

It is registered on `process.on("exit")` rather than in a `finally`, because one mutating verb
writes state and then calls `process.exit()` — which skips `finally` and runs exit handlers.

Every filesystem call on this path is inside a `try/catch`, `mkdirSync` included: observability
must never break the run it observes.

## Rotation, retention, purge — sized, not guessed

| | |
|---|---|
| One event, JSON line | ~191 bytes measured |
| **Segment size** | **128 KB** — 128 KB ÷ 191 B ≈ 680 events ≈ 37k tokens, a comfortable single read for an agent that still has a task to do. Anything larger stops satisfying that constraint; anything smaller multiplies files for no gain. |
| **Naming** | `activity-<ISO segment start>.log`. Timestamped, not sequential — retention (prune oldest) and scoping (read only the window in question) are answerable **from the filename**, without opening a file. `--since` therefore skips whole segments. |
| **Retention** | **1 GB total per project**, oldest first. ≈ 5.5 million events ≈ centuries at the measured rate: a backstop against pathology, not an operating point. It is per project and this runs in ~22 of them, so the stated worst case is 22 GB and the real case is a few megabytes. |
| **When pruning runs** | At the **rotation boundary only**, never on the write path. Age-based pruning requires reading, which the write-conflict log deliberately avoids; prune-on-rotate pays that read once per segment instead of once per event. |

Segments live in `.conductor/activity/`, which `init` **and** `upgrade` add to `.gitignore` —
the #106 backfill rule.

## `purge-logs` refuses to guess, twice

Automatic retention only ever fires at the cap. An operator managing disk, or clearing noise
before a fresh measurement window, needs a direct tool — and will otherwise reach for `rm`, which
is the same thing without a plan printed first.

1. **With no selector it removes nothing.** "Purge the logs" has no safe reading, and defaulting
   it to everything is how a tool deletes a record somebody wanted. Say `--keep`, `--over` or
   `--older-than`; the removal set is their **union**.
2. **Without `--yes` it prints the plan and removes nothing.** That is the non-interactive form of
   "requires confirmation": this engine is driven by agents and hooks, so a prompt on stdin would
   hang rather than confirm. `--dry-run` spells the same thing explicitly.

## Known edges, stated rather than discovered

- **The out-of-band list is a bounded sample; the count is exact.** The span between the log's
  earliest and latest revision is set by a number a hand-edit chooses, so listing every element
  would make a report about a pathological record pathological itself. `missingCount` is the
  number; `missing` holds the first 50.
- **A valueless flag before the epic id eats it.** `claim --steal e1 --session x` refuses with the
  usage line, because the shared flag parser takes the token after any flag as its value. That is
  this engine's behaviour for every valueless flag (`--done`, `--no-deferrals`, `--clear-links`),
  not something new here — put the positional first: `claim e1 --session x --steal`.

## What it does not do

- **Nothing is recorded retroactively.** Turning it on today says nothing about yesterday. The
  window before that moment stays answerable only by forensics — which is the gap, not a bug.
- **It joins nothing to git.** GATES reports when a verdict was recorded, in sequence; comparing
  that against the commit dates its range covers is a join `activity` deliberately does not make,
  because it would mean the engine shelling out to git on a read path.
