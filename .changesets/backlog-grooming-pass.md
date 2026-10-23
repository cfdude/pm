* **`/pm:backlog-grooming`: a repeatable pass that reads the open backlog as a set.** A new skill and command
  re-read the open epics (one `list --status <s> --json` per open status), run `triage` on suspects, and PROPOSE
  merges, declines and dead-premise findings, naming the epics it left alone. Nothing is written before you
  confirm, and every confirmed consolidation records a disposition (`--outcome superseded|declined`, a
  `supersedes` link on the survivor, a note on the survivor first), never `remove-epic`. Findings cite epic ids,
  verb output and shas, never line numbers. No new verb and no new flag.
* **`list` rows gain `release`, `createdAt`, `description` and `outcome`.** Copies of the epic's own fields,
  `null` when absent or not a string (never inferred; a null `createdAt` means age unknown). `{count, epics}`
  and the text form are unchanged, and there is still no `--release` or `--priority` flag: filter the `--json`.
