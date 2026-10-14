* **pm can now stop a review loop that will not converge, and say who to hand it to — opt-in, no limit on by default.**
  Every accepted `record-gate-review` now keeps a per-gate round tally on the epic (`epic.gateRounds`: fails,
  passes, the consecutive-fail streak, the time of the last verdict and of the last pass), in the same write as
  the verdict and with no setting needed. Epics recorded before this release start at zero. `set-spend-guard
  [--epic <id> | --lane <lane>] [--max-failed-rounds <n>] [--tokens <n>] [--warn-at <pct>] [--unset <field>]`
  turns it into limits at the project, a lane or an epic (most specific wins; every set has an `--unset`).
  `spend-guard <epic> [--json] [--no-ingest]` compares the epic's rounds (the larger of its recorded fail streak
  and, with spend tracking on, the distinct `phase=review` rounds in the ledger since its last recorded pass) and
  its attributed token total with those limits. It exits **2** while the epic is stuck, after printing a STOP
  that names the escalation target (one model tier above the resolved `review` or `implement` model, else the
  user) and says autonomy does not bypass it; with tracking off it checks rounds only and says so, and when the
  ledger cannot be read it says that and still applies the recorded-verdict check. A failed verdict is always
  recorded; when it leaves the epic stuck the STOP follows on stderr. The SessionStart/PreCompact brief carries
  one `STOP: spend guard —` line for a stuck active epic, from state alone, and the rules block carries a
  `## Spend guard` section only while a limit is configured. `override-spend-guard <epic> --signal rounds|tokens
  --escalated-to user|<model> --reason "<why>"` records the decision (only while tripped, at or above the
  target; no autonomy grant covers it; a later pass spends a rounds override), and `--revoke --reason` marks it
  revoked without deleting it. No hook reads the ledger, and a repo with no limit pays nothing on any hook
  path. `upgrade` lists the guard as `NOT SET: spendGuard` until you set a limit. Never wire `spend-guard`
  into a hook (exit 2 is the hook block code). See `commands/spend-guard.md`, `commands/set-spend-guard.md`
  and `commands/override-spend-guard.md`.
