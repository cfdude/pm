---
name: backlog-grooming
description: Read the OPEN backlog as a set and propose merges, declines and dead-premise findings, then record each confirmed one as a disposition. Fills the sprint-planning role that /pm:triage (which runs once, at registration) does not. Use when the backlog has grown, before planning a release, when a newly synced item looks familiar, or when asked to "groom", "prune" or "dedupe" the backlog. Triggers: "groom the backlog", "backlog grooming", "prune the backlog", "are any of these duplicates", "what is stale".
---

# Backlog grooming — re-read the backlog as a set

After intake nothing asks whether an epic still matters, duplicates another, or was already delivered
under a different name. This pass asks. It is invoked (`/pm:backlog-grooming`), never scheduled, and it
PROPOSES: the engine supplies fields and overlap, never a verdict (`triage` returns `verdict: null`).

**Nothing is written before the user confirms.** No `update-epic`, `add-epic` or `remove-epic` runs
during the read or while proposals are being drafted.

## Procedure

1. **Read the open set through `list`, never `state.json`.** One call per open status, because
   `--status` takes one value: `untriaged`, `queued`, `active`, `paused`, `later`, `blocked`,
   `planned`.
   `node "$ENGINE" list --status <status> --json`
   Each row carries `id, title, status, lane, priority, links, release, createdAt, description, outcome`.
   Do not read `.conductor/state.json` directly; the engine is the one reader. Archived epics are NOT
   proposed for change. Read them as reference, on demand: `list --linked-to <id> --json` for the epics
   tied to one id, or `list --status archived --json` once when a re-report needs the delivered set.
2. **Age comes from `createdAt`.** A null `createdAt` means age UNKNOWN, never "old": do not propose an
   epic for decline on age alone, and report its age as unknown.
3. **Run `triage` on each suspect.** For an epic that looks like a duplicate, a re-report or a dead
   premise, run `node "$ENGINE" triage "<its title and description, in its own words>"`. It returns the
   epics sharing distinctive vocabulary. READ each candidate (title, `description`, `outcome`); a high
   score with unrelated intent is a miss, a low score on an epic whose description covers the ask is a hit.
4. **Find re-reports of delivered work by reading archived epics.** When an open epic's ask overlaps an
   archived epic whose row shows `outcome: "delivered"`, YOU decide, after reading both, whether it is a
   re-report. If it is, propose a dead-premise decline naming the delivering epic's id, carrying a
   `relates-to` link to it.
5. **Propose, with evidence.** For each finding report: the epic ids, the evidence, and the proposed
   disposition (merge A over B, decline C, rescope, reprioritize, or leave alone).
6. **Cite evidence that does not rot.** Cite epic ids, verb output and commit shas. NEVER cite a line
   number (or any `file:line`) as evidence, in a finding or in a recorded `--reason`: they rotted within
   two days on the pass this skill came from. If a draft finding's only evidence is `file:line`,
   replace it with an id, a verb's output or a sha before reporting.
7. **Report what you left alone.** List the open epics you read and judged alive, each with a one-line
   reason or grouped under a stated common reason, so that silence never reads as "not looked at".
   Also report any consolidation you find unfinished (see step 9).
8. **Wait for the user to confirm**, per proposal.
9. **Record each confirmed proposal as a disposition. Never `remove-epic`**: deletion removes the record
   of projected work.
   - **Merge** (A survives, B is superseded), in this order: (1) `update-epic A --notes "..."` citing B's
     id and B's `description` as read from its `list` row (notes and link reasons are not in the row, so
     carry nothing else); (2) record the link `supersedes:B:<why>` on A; (3) `update-epic B --status
     archived --outcome superseded --reason "<what replaced it>" --no-deferrals`. Context first: once B
     is archived the merge is easy to forget.
   - **Decline**: `update-epic C --status archived --outcome declined --reason "<why not>" --no-deferrals`.
   - **Unfinished consolidation**: a superseded epic archived without a `supersedes` link on its
     survivor, or without a reason, is reported as unfinished, not done. (The engine requires `--reason`
     for `superseded` on new writes, so this appears only in legacy data.)

## Undoing a consolidation (lossy)

`update-epic B --status untriaged` reopens B, but A keeps `supersedes:B`, so `triage` keeps marking B
superseded, and `update-epic` offers only `--clear-links`, which drops ALL of A's links. The real undo:
reopen B, clear A's links, re-add each link to keep with its reason. No single-link removal exists; that
gap is filed as feedback, not worked around here.
