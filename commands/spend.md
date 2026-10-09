---
description: Opt-in per-epic token spend — which epic, phase, role and model the tokens went to
allowed-tools: Bash, Read
---

pm cannot tell you where the tokens went. A release can spend millions of sub-agent tokens and
most of it on one epic that needed seven review rounds, and nothing in `state.json` says so. The
spend ledger answers that from Claude Code's own transcript files, read-only and local.

**Off by default.** Measuring costs reads, so a repo that never opts in pays nothing.

```bash
conductor.mjs set-spend-tracking on|off
```

`set-spend-tracking on` stores `state.spendTracking = {enabled, enabledAt}`. `enabledAt` is the
time of the FIRST `on` and never moves: it bounds how far back an ingest ever looks. `init` and
`upgrade` never turn it on; `upgrade` lists it as `NOT SET` until you do. Turning it `off` stops
all reading and deletes nothing.

Run the verb again with the same value and it says so and writes nothing.
