---
description: Groom the open backlog as a set — propose merges, declines and dead-premise findings; record nothing until confirmed
allowed-tools: Bash, Read
---

Invoke the `backlog-grooming` skill and follow its procedure. It reads the OPEN backlog through
`list` (one `list --status <status> --json` per open status), runs `triage` on suspicious epics, and
reports proposals plus the epics it judged alive.

It is read-only until you confirm: no write verb runs before then. Every confirmed consolidation is
recorded as a disposition (`--outcome superseded|declined` with `--reason`, and a `supersedes` link on
the survivor); the record of the work is kept. The engine adds no verb and no verdict;
`/pm:triage` screens one incoming ask, this screens the whole backlog.
