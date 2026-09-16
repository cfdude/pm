---
description: Resume a paused epic after a detour — runs the mandatory reconcile gate
allowed-tools: Bash, Read, Edit, Task
---

Resume the epic at the top of the detour stack. This is where context is normally lost, so
be deliberate.

1. Confirm the detour epic is **archived** and its work is committed/deployed. If not, it's
   not time to resume — finish the detour first.

2. **Pop** — `pop-detour` does it, in one guarded write. **Do not hand-edit
   `.conductor/state.json`**; this used to say to, and it had the same missing guarantees the
   PUSH hand-edit did.
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" pop-detour [<paused-epic-id>]
   ```
   It removes the top frame, sets the paused epic's `status` back to `active`, points `active`
   at it, and — where the frame had `reconcileOnResume` — writes `reconcileNeeded: true` in the
   *same* write. The obligation is ALSO recorded per detour on the paused epic's `may-invalidate`
   link (`reconcileOnResume: true`, armed at PUSH), which is what survives the frame's removal and
   what the verdict must name. The optional
   epic id is an ASSERTION, not a selector: the stack is LIFO, so naming an epic that is not on
   top is refused rather than popping a different one.

3. **RECONCILE GATE** — if `pop-detour` printed `RECONCILE GATE`, do NOT write code yet. It
   prints it whenever the resumed epic still owes a reconcile — for this detour, or for an EARLIER
   `--reconcile` detour still unanswered (a later `--no-reconcile` push never cancels an earlier
   obligation) — and names every detour owed:
   ```text
   conductor: resumed 'p'
   conductor: RECONCILE GATE — 'p' carries reconcileNeeded and owes a verdict against 'd'. Run the reconciler BEFORE writing code, then `record-reconcile p --detour d --verdict valid|invalidated`, then `honcho-memory pop p "<detour>; reconcile = …"` for the memory line
   ```
   Delegate a clean-context review to the **reconciler** agent (via the Task tool) for each
   detour named: give it the paused epic id and the detour epic id. It re-reads the paused
   proposal, diffs what the detour actually changed, and reports back `VERDICT: valid|invalidated`
   plus `AMENDMENTS:` (stories to add/remove/amend, one per line).
   - **Invalidated** → amend the OpenSpec proposal and `tasks.md` first.
   - **Still valid** → say so explicitly.
   - Either way, **write the verdict back durably** — never clear the flag by hand. ONE form,
     mapped from the reconciler's report:
     ```bash
     # AMENDMENTS: none
     node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" record-reconcile <paused-id> \
       --detour <detour-id> --verdict <valid|invalidated> --amendments none
     # otherwise: one --amendment per AMENDMENTS line, verbatim
     node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" record-reconcile <paused-id> \
       --detour <detour-id> --verdict invalidated --amendment "<line 1>" --amendment "<line 2>"
     ```
     This attaches `{verdict, amendments, reconciledAt}` to the paused epic's `may-invalidate`
     link to that detour. `--amendments none` records no amendments; each `--amendment` is one
     amendment even when its text holds a `;`; the two flags together are refused.
     `reconcileNeeded` clears only when no armed detour is left unanswered, so with two owed
     detours the first verdict leaves the gate armed. Recording again against the same detour
     is a correction: the earlier verdict moves to `superseded` on the link.
   - **What is refused, with nothing written** — each refusal names what IS owed:
     ```text
     conductor: 'p' cannot answer a reconcile against itself — 'p' owes a verdict against: 'd'. Nothing was written.
     conductor: 'other' is not a detour 'p' was paused for with --reconcile, so there is no reconcile obligation for this verdict to answer — 'p' owes a verdict against: 'd'. Nothing was written.
     conductor: 'p' is still paused for 'd' — pop the detour (/pm:resume) before recording the verdict against it — 'p' owes a verdict against: 'd'. Nothing was written.
     ```
     The same "not a detour … paused for with --reconcile" refusal answers a `--no-reconcile`
     detour. The verb never creates a link. A misspelled flag is refused before anything is
     recorded, and `--help` anywhere on the line prints help and records nothing.
   - **Links written before 0.44.0.** A `may-invalidate` link with no `reconcileOnResume` key
     (written by an older engine) makes EVERY verdict on that epic refuse until the record is
     upgraded:
     ```text
     conductor: 'p' holds 1 may-invalidate link(s) written before reconcile arming was recorded ('d'). Run /pm:upgrade first (`upgrade`): it stamps each link with whether a reconcile is owed against it, and only then can a verdict be matched to the detour it answers. Nothing was written.
     ```
     Run `/pm:upgrade`, then record. The stamp arms a keyless link when its epic owes a reconcile,
     the link carries no verdict, and it targets another epic that exists — it cannot tell an old
     `--reconcile` link from an old `--no-reconcile` one, so an owing epic may come out owing a
     verdict against both. Answer each; `valid` with `--amendments none` is the honest verdict for
     a detour that never touched the plan.
   - **The work will not resume.** An owing epic keeps its obligation through archive and
     unarchive, `clear-active` and `set-active` (moving the active pointer off it warns and keeps
     it), and while it owes, `update-epic --clear-links` and `remove-epic <detour>` are refused.
     The honest ending for abandoned or killed work is a verdict, not a workaround:
     `record-reconcile <paused-id> --detour <detour-id> --verdict invalidated --amendment
     "abandoned: <why the work will not resume>"` — the plan IS invalidated. (`remove-epic
     <paused-id>` stays available for an epic registered in error.)

4. **Write a Honcho memory** for the resume. While the resumed epic owes any reconcile,
   `pop-detour` deliberately did NOT emit one — `resumed X, reconciled vs Y` is not true until
   the verdicts in step 3 exist. Get the exact ready-to-copy line now via:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" honcho-memory pop <parent-epic-id> "<detour-id>; reconcile = valid | amended: …"
   ```
   Prints `resumed <parent>, reconciled vs <detour-id>; reconcile = valid | amended: …` and
   appends it to `.conductor/honcho-memories.log`. Paste that printed line into your actual
   Honcho MCP memory/conclusion tool call.

5. Re-render: `node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" render`, then state the
   exact next story to build on the resumed epic.
