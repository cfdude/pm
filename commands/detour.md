---
description: Handle a mid-build interruption — classify it, and park current work if needed
argument-hint: "[what came up]"
allowed-tools: Bash, Read, Edit
---

Something came up mid-build: **$ARGUMENTS**

Do NOT start fixing yet. Follow the `conductor` skill's detour protocol.

1. **Classify out loud:**
   - **Minimal** — small, self-contained, no design ambiguity, fits before the next
     compaction, doesn't reshape the current proposal → fix → test → commit → push, then
     **record it** so it leaves a trail:
     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" log-detour "<what you fixed>"
     ```
     (Appends a timestamped line + commit SHA to `.conductor/detours.log`.) Then resume.
     Quote the text. The log is append-only, so the engine refuses a line it would record wrong
     rather than writing it: an unquoted word shaped like a flag is refused
     (`log-detour fixed --no-verify usage`<!-- pm:refused unknown-flag --> →
     `conductor: unknown flag --no-verify for log-detour — it accepts: --force`, then
     `If '--no-verify' is part of the text, quote the whole value.`), and `--help` anywhere after
     the verb prints help instead of appending. `--force` is never part of the text:
     `log-detour fixed it --force` records `fixed it`.
     No proposal, no stack entry. If invoked as `/pm:detour --minimal "<what>"`, do exactly
     this and stop.
   - **Substantial** — needs its own design, changes shared behavior, or is multi-step →
     it becomes its OWN OpenSpec proposal. Run PUSH below. When unsure, treat as substantial.

2. **PUSH (substantial only)** — `push-detour` does the whole transition. **Do not hand-edit
   `.conductor/state.json`**: this used to be a documented hand-edit, and none of the engine's
   guarantees applied to it (no validation, no write-conflict guard, no read-back verification,
   no record that the transition happened).
   - Make the current epic's `tasks.md` reflect reality; commit so nothing is uncommitted.
   - Register the detour as an epic FIRST — it has to exist before a frame can name it:
     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" add-epic --id <new-id> \
       --title "<what it is>" --lane <openspec|superpowers|claude-code> --priority P0
     ```
   - Then push:
     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" push-detour <parent-epic-id> \
       --detour <new-id> --reason "<why, concretely>" (--reconcile | --no-reconcile)
     ```
     In one guarded write it sets the parent to `paused`, pushes the frame
     (`pausedEpic` / `pausedAt` / `reason` / `spawnedDetour` / `reconcileOnResume`), records both
     protocol links (detour `resolves-blocker-for` parent; parent `may-invalidate` detour), makes
     the detour active, re-renders, and prints the Honcho line — so step 3 below is no longer a
     separate step.
   - **Exactly one of `--reconcile` / `--no-reconcile` is required.** There is no default:
     whether the detour can invalidate the paused epic's plan is a judgment, and a default would
     make an absent decision look like a considered one. Say `--reconcile` unless you are certain
     the detour touches nothing the paused epic depends on.
   - **The choice is recorded on the link, per detour.** `--reconcile` writes
     `reconcileOnResume: true` onto the parent's `may-invalidate` link to this detour — the ARMED
     record `/pm:resume`'s `record-reconcile` must later answer, and the only thing that arms one
     (a link supplied by hand with `--link` is written `false`). `--no-reconcile` writes `false` on a
     link it creates and never lowers an existing `true`. Pushing `--reconcile` again to a detour
     already answered re-arms it: the earlier verdict moves to `superseded` and a new one is owed.
   - **A `--no-reconcile` push never cancels an earlier obligation.** The parent's
     `reconcileNeeded` is ORed, not overwritten, so pausing an epic that still owes a verdict says
     so instead of claiming there is nothing to reconcile:
     ```text
     conductor: paused 'p' and made detour 'd2' active — no reconcile for 'd2'; 'p' still owes a reconcile against 'd'
     ```
     and the later pop prints the RECONCILE GATE for `d` rather than a Honcho line saying no
     reconcile was required.
   - **While the parent owes, its record is protected.** `update-epic <parent> --clear-links`
     (including the one-write clear-and-re-supply repair) and `remove-epic <detour>` are refused
     until the verdict is recorded, because each would strip the link the verdict must name:
     ```text
     conductor: cannot remove 'd' — still held by 1 reference(s) that cannot be stripped.
       1 reconcile obligation link(s): epic `p` links[] (a reconcile it owes is recorded against it) → `d`. Removing it would leave the owed verdict nothing to be recorded against. Answer it first — `record-reconcile p --detour d --verdict valid|invalidated` — then remove.
     ```
     `remove-epic` is for a detour registered in error, and even then it waits for the verdict.
     Correcting a link's reason with a same-target `--link` keeps its arming record and any verdict.
   - Then create the OpenSpec proposal for the detour and build it through your normal
     propose → review → apply → review → commit → archive loop.

3. **Paste the Honcho memory.** `push-detour` printed `paused <parent> for <reason>` on stdout
   and appended it to `.conductor/honcho-memories.log`. Paste that printed line into your actual
   Honcho MCP memory/conclusion tool call — the engine only formats and logs it, it never calls
   Honcho itself. This keeps the relationship recoverable even outside this repo.
   (`honcho-memory push <parent-epic-id> "<reason>"` still exists for a pivot you are recording
   after the fact.)

## Rows the commit hook writes for you — and `retract-detour`

The `commit-nudge` hook runs after every Bash call, on success (`PostToolUse`) and on failure
(`PostToolUseFailure`). It reads HEAD's reflog from the position it recorded last time and reports
every commit that landed since, oldest first — including one followed by a `checkout` in the same
call, and every commit of a call that made several.

- **When it logs a row.** While a detour is live it writes `DETOUR-COMMIT` against the detour epic.
  With no detour but an active epic, a small (≤3 files) `fix:`/`chore:` commit that does not name
  the active epic is logged as `AUTO-DETOUR` — a minimal detour nobody declared.
- **When it does not.** A commit touching any of the active epic's own artifacts
  (`openspec/changes/<id>/`, its plan path, its spec path) is that epic's work, not a detour. A
  commit confined to a paused epic's own artifacts writes no `DETOUR-COMMIT`. A commit touching
  only pm's own generated files (`state.json`, `PROJECT.md`, `render-stamp.json`, the observation
  record) is bookkeeping — in a nested conductor too, because paths are compared from the
  conductor root. A commit reachable from no branch (rewritten by `pull --rebase`, reset away,
  abandoned on a detached HEAD) is named as rewritten or abandoned and gets no row and no
  attribution command; attribute what a rebase produced by hand. A commit that already has a row
  is never given a second one, whatever that row's sha length.
- **Provenance.** Every report says the commits *landed since the last observation — this call,
  another terminal, or a parallel call; the hook cannot tell which*. It never claims the call made
  them, so a commit from another terminal can still be logged against the active epic.
- **An amend replaces.** When a `commit --amend` leaves the replaced commit on no branch, the engine
  retracts that commit's automatic row (reason `amended into <new sha>`) and, for each epic whose
  `attributedCommits` holds it, prints `update-epic <id> --withdraw-commit <replaced>
  --withdrawal-reason "…"` before any attribution command. It never withdraws anything itself.
  Where `update-epic` would refuse that withdrawal (a delivered epic whose record it would break),
  the hook prints no command and says the refusal names the remedy. An undone amend
  (`reset --hard HEAD@{1}`) replaces nothing.

A wrong automatic row is corrected with the verb, never by editing the log — `detours.log` is
git-ignored while the `PROJECT.md` it renders is tracked, so a hand-removal leaves the false row in
what gets committed:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" retract-detour <sha> --reason "<why the row is wrong>"
```

It appends one `RETRACTED` row covering every `AUTO-DETOUR` and `DETOUR-COMMIT` row of that commit,
removes nothing, and re-renders `PROJECT.md` without them. `<sha>` is a commit sha, not a ref
(`HEAD` is refused — run `git rev-parse <ref>`); a sha whose commit has been pruned must be at least
7 hex characters and match one commit's rows. It refuses, naming the reason and writing nothing: no
matching row, a `MINIMAL`-only row (a declaration, not retractable), an already-retracted commit, a
missing or empty `--reason`, and a detached tree. There is no un-retract: re-declare with
`log-detour`.

When the detour is archived, use `/pm:resume` — do not skip the reconcile gate.
