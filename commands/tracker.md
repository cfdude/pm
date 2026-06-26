---
description: Make the conductor aware of an external issue tracker (Jira/GitHub/Linear) this project uses
allowed-tools: Bash, Read
---

Record (or update) the external **tracker** this repo mirrors conductor epics to. Tracker
awareness is **optional and additive**. Whether or not you set it, the conductor already tracks
everything locally — `.conductor/state.json` (the JSON system of record) and `PROJECT.md` (the
generated Markdown view). A tracker block ONLY adds *mirroring* to an external system; it never
replaces local tracking. When set, the CLAUDE.md rules block gains an "External tracker sync"
section and the brief surfaces epics not yet mirrored. **The plugin never calls the tracker** — it
only shapes the instructions YOU (the interactive agent) act on, with whatever tooling the project
uses (a Jira/Linear MCP server, the GitHub CLI, an Atlassian connector, a Python lib — it does not
matter).

## Detection (run when the user asks to connect a tracker, or as an OPTIONAL offer during `/pm:init`/`/pm:upgrade`)

**Hosting is NOT a tracker signal.** Every hosted Git service — GitHub, GitLab, Bitbucket, and
others — offers issues and pull/merge requests, but the mere fact that a repo is *hosted* on one
(it has a remote, it is public) is NOT evidence that the team manages work there. Do not infer a
tracker from the remote. Only treat it as a real signal when work is *actively* managed in an
issue tracker:

- a connected issue-tracker MCP that is actually in use (`mcp__jira__*`, `mcp__linear__*`,
  a GitHub issues/projects tool, …),
- real issue-key conventions in commit/branch history (e.g. `JOB-123`, `#142`),
- an explicit statement in `CLAUDE.md`/`README` that "we track work in <X>".

Then:

1. **Offer it as a choice — never assume.** Present it plainly: *"This project could mirror epics
   to <service> (creating issues and tracking PRs there), or you can keep tracking locally only.
   Either is fine."* Saying **yes** is perfectly valid — it sets up the mirror between conductor
   epics and the tracker's issues/PRs. Saying **no** is equally valid.
2. **Reassure on "no":** declining changes nothing about tracking — the conductor still records
   every epic, status, priority, and story locally in `.conductor/state.json` and `PROJECT.md`.
   "No tracker" means "no external mirror," not "no tracking." If the user declines, record
   nothing and stop.
3. **On "yes", confirm the specifics** — `system` (jira | github | gitlab | bitbucket | linear |
   …), `projectKey` (e.g. `JOB`), `instance`, and `mechanism` (e.g. `mcp`/`cli`). Then map
   conductor lifecycle → a SEMANTIC target via `--intent` (NOT a literal tracker transition name —
   you resolve the real workflow transition yourself when syncing).

## Record it

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" set-tracker \
  --system jira --instance onvex --project JOB --mechanism mcp \
  --intent active:in-progress --intent paused:todo --intent archived:done
```

If `${CLAUDE_PLUGIN_ROOT}` is empty:
`ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1); node "$ENGINE" set-tracker …`

`--intent` is repeatable; each `<status>:<target>` adds one entry to the map. Re-running
`set-tracker` merges (only the flags you pass change). It refreshes the CLAUDE.md rules block.

## Your ongoing responsibilities once a tracker is set

- An epic with no `externalId` → create the issue in the tracker, then record its key:
  `update-epic <id> --external-id <KEY> --external-url <url>`.
- An epic changes status → transition the linked issue toward the `statusIntent` semantic target,
  resolving the real workflow transition with your own tooling.
- A parent epic → create it as a tracker epic and link its children.

The brief's `TRACKER SYNC` line lists epics still needing an issue created. Transition sync is on
you at the moment of each status change — the engine cannot see the tracker's state and will not
fabricate transition drift.
