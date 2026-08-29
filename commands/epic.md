---
description: Register a non-OpenSpec epic in the conductor (lane-tagged)
allowed-tools: Bash, Read
---

Register an epic in a non-OpenSpec lane (superpowers, claude-code, decision, external) —
for work that is correctly routed away from OpenSpec but still belongs in the system of record.

Usage: `/pm:epic add <id> "<title>" <lane> [priority] [--status <untriaged|queued|active|paused|planned|archived>] [--parent <id>] [--external-id <KEY>] [--external-url <url>] [--plan <path>] [--link type:epic:reason]`

Use `--status planned` for roadmap work you intend to do but haven't proposed/scaffolded yet
(default status is `queued`). Use `--parent <id>` to nest this epic under an existing parent
epic (e.g. a sprint over its child tickets); the parent must already exist and the link may not
form a cycle. Use `--external-id`/`--external-url` to link the epic to an issue in a configured
external tracker (see `/pm:tracker`). The matching engine flags are added to the `add-epic`
invocation.

`--link "<type>:<epic>[:<reason>]"` (repeatable) is validated, not just parsed: `<epic>` must be
an already-known epic id, and the string must split into at least `type` and `epic`. A malformed
value (wrong segment order, a typo'd epic id) is rejected with a clear error instead of being
silently stored as a garbage link object — this used to succeed silently, which is how a bad
link could end up in `state.json` with no CLI path to fix it.

1. Parse the user's request into: id (kebab-case), title, lane (one of
   openspec|superpowers|claude-code|decision|external), priority (P0–P3, default P?),
   optional parent, optional external id/url, optional plan path, optional links.

2. Run the engine:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" add-epic \
     --id "<id>" --title "<title>" --lane "<lane>" --priority "<P?>" \
     [--status "<status>"] [--parent "<parent-id>"] \
     [--external-id "<KEY>"] [--external-url "<url>"] \
     [--plan "<docs/superpowers/plans/...md>"] [--link "blocks:<id>:<reason>"] \
     [--add-story "<milestone>" --add-story "<milestone>" …]
   ```

   `--add-story` is repeatable and lands the epic's milestones in the SAME write as the epic —
   see "Stories" below. Register the decomposition the planning phase already produced; adding
   it one call at a time afterwards is why most epics never get any.

   If `${CLAUDE_PLUGIN_ROOT}` is empty:
   `ENGINE="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/conductor.mjs}"; [ -f "$ENGINE" ] || ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1); node "$ENGINE" add-epic …`

3. Show the result with `/pm:status`.

---

## Bulk create — `add-many`

To register a parent epic and its children in one atomic operation (e.g. a sprint of audit
tickets), author a JSON batch and pass it with `--from <path>` (or `--from -` for stdin):

```json
{
  "parent":  { "id": "sprint-2026-06-25", "title": "Pre-staging sprint", "lane": "external", "priority": "P0", "status": "queued" },
  "epics": [
    { "id": "job-506", "title": "[JOB-506] HMAC-verify webhooks", "lane": "external", "priority": "P0", "externalId": "JOB-506", "externalUrl": "https://onvex.example/JOB-506" },
    { "id": "job-507", "title": "[JOB-507] …", "lane": "external", "priority": "P1", "externalId": "JOB-507",
      "stories": ["Verify the signature", {"title": "Backfill old events", "done": true}] }
  ]
}
```

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" add-many --from /path/to/batch.json
```

- If `parent` is present it is created first and each `epics[]` entry defaults its `parent` to it.
- **Atomic:** every entry is validated up front (id format, uniqueness vs existing AND within the
  batch, lane, status, parent refs/cycles). On any failure nothing is written and the command
  exits non-zero naming the offender. A valid batch is persisted in a single write — no `&&`
  chaining, no write race.
- JSON only (the engine is zero-dependency). `parent` is optional; a bare `{ "epics": [...] }`
  batch works too.
- **`stories`** is an array of plain titles, or `{"title": "...", "done": true}` objects where a
  milestone is already behind you. Validated in the same up-front pass as everything else — a
  blank title or a non-boolean `done` refuses the whole batch and creates nothing.

## Write-back — `update-epic`

To change an epic that already exists (notably, to record a tracker key after creating the issue):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" update-epic <id> \
  [--title <title>] [--external-id <KEY>] [--external-url <url>] [--parent <id>] \
  [--status <status>] [--priority <P?>] [--link "<type>:<epic>[:<reason>]"] \
  [--clear-links] [--lane <lane>] [--plan <path>]
```

**Every flag `update-epic` accepts.** The list below is the whole surface — an unlisted flag
exits non-zero naming itself, so a flag you cannot find here is a flag that does not exist. All
of them are declared once in `EPIC_FLAGS` (`scripts/lib/constants.mjs`), which is also what
`add-epic`'s and `add-many`'s surfaces are projected from, so the three can never drift apart.

| Flag | Writes | Notes |
|------|--------|-------|
| `--title "<t>"` | `title` | |
| `--status <s>` | `status` | validated; `archived` runs the archive gate — see below |
| `--priority <P?>` | `priority` | |
| `--lane <l>` | `lane` | re-routes in place |
| `--plan <path>` | `planPath` | attaches a plan to an epic created without one |
| `--parent <id>` | `parent` | no self-parent, no cycle |
| `--link "<type>:<epic>[:<reason>]"` | `links` | **repeatable**; REPLACES the array wholesale |
| `--clear-links` | `links` | empties it; may not be combined with `--link` |
| `--description "<why>"` | `description` | durable rationale, REPLACED wholesale on each set |
| `--notes "<what>"` | `notes` | APPEND-only trail of `{at, actor, text}`; reads as activity |
| `--external-id <KEY>` | `externalId` | |
| `--external-url <url>` | `externalUrl` | the globally unique dedup key |
| `--external-updated-at <iso>` | `externalUpdatedAt` | the **tracker's own** timestamp, never a local clock |
| `--attribute-commit <sha>` | `attributedCommits` | **repeatable**, append-only, in landing order |
| `--outcome <o>` | `disposition` | `delivered\|killed\|superseded\|abandoned` |
| `--reason "<why>"` | `disposition` | required for every outcome except `delivered` |
| `--carried-to <epicId>` | `disposition` | where unfinished work went |
| `--correct-disposition "<why the recorded one was wrong>"` | `disposition` | corrects an agent-recorded disposition; keeps the prior one under `superseded` |
| `--deferral "<epicId>:<section>"` | `deferralAssertion` | **repeatable** |
| `--declined-deferral "<what>:<why not>"` | `deferralAssertion` | **repeatable** |
| `--no-deferrals` | `deferralAssertion` | the explicit "there are none" |
| `--review-mode <m>` | `reviewMode` | per-epic escalation above the repo dial |
| `--add-story "<title>"` | `stories` | **repeatable**; appends `{title, done: false}` |
| `--story <n> --done` | `stories[n-1].done` | 1-indexed |
| `--story <n> --wont-do "<reason>"` | `stories[n-1].disposition` | 1-indexed; the reason is REQUIRED |

`--description` and `--notes` are DISTINCT and neither substitutes for the other: a description
says why the epic exists and what would make it worth revisiting; notes are a trail of what
happened. Collapsing them would lose one of the two readings. Stories used to be the only
free-text carrier an epic had, which is why four epics in the audit archived with "incomplete"
stories that were actually completion notes.

**Attribution is explicit and the engine infers it from nothing** — not the files a commit
touches, not an epic id in a message. `--attribute-commit` repeats because `parseFlags`
overwrites a non-repeatable flag on each occurrence, so two hashes would silently become one with
the order that gives the array its meaning destroyed. Catch up on work already in flight ONLY
before the first attribution, in landing order; after that, attribute forward only. The array is
append-only and the LAST entry is what a recorded Gate 2 `headSha` is compared against, so a
late-inserted ancestor reads as a stale verdict and refuses the archive. **Never attribute the
commit that moves `openspec/changes/<id>/` under `archive/`.**

**`--attribute-commit` reads back what it wrote before it says `updated`.** If the sha is not in
`.conductor/state.json` when the command ends, it exits **1** and names the shas that are not
there instead of reporting success — because a verb that reports success for a write nobody can
find is worse than one that fails. `state.json`'s write path verifies its own bytes too, so this
holds for every verb; `--attribute-commit` checks again at the END of the command, after the
render that follows the save has had its own turn at the file.

**Ending an epic takes two halves in one invocation.** `--status archived` runs the archive gate,
which demands a disposition (`--outcome`, plus `--reason` unless the outcome is `delivered`) AND
a deferral assertion (`--no-deferrals`, or one or more `--deferral`/`--declined-deferral`). It
also refuses to archive an `openspec`-lane epic as `delivered` without a passing, non-stale
Gate 2, and demands `--carried-to <epicId> --reason "<which tasks moved>"` where outstanding work
remains. `killed`, `superseded` and `abandoned` are exempt from the Gate 2 and handoff demands by
design: the code was never written or was thrown away, and the required reason already answers
where the work went.

An engine-written disposition — the migration's stamp, the archive-drift heal's — may be REPLACED
by an agent recording a real one. Another agent's recorded judgment may not: re-running the verb
is refused, because replacing a judgment somebody made is exactly what a disposition exists to
prevent.

**A wrong record is corrected, never overwritten.** `--correct-disposition "<why the recorded one
was wrong>"` is the one way past that refusal, and it costs three things rather than none:

- It is **deliberate** — never reachable by re-running the ordinary verb, and refused outright
  when there is no agent-recorded disposition to correct (an engine stamp is replaced the
  ordinary way; an epic with no disposition has nothing to supersede).
- It is **self-describing** — the flag's value IS the justification, required by the flag's own
  shape, and it is kept on the record.
- It is **non-destructive** — the prior record survives verbatim under `superseded`, and every
  surface renders `· corrected (was <prior outcome>)` beside the new one, so a correction is
  distinguishable from an original by anyone reading afterwards. One level deep, exactly as
  `record-gate-review` caps its own nest: the prior record's own `superseded` is dropped, its
  `correction` string kept.

That is disclosure rather than authority, and it is deliberate. The engine cannot gate on WHO
corrects: an agent's record carries no identity by construction — absence of `recordedBy` is
what marks a record as an agent's — so "only the agent who recorded it may correct it" would be
unenforceable rather than strict. What it can require is that a correction leave evidence that a
correction happened. It is also not time-boxed: a wrong `delivered` noticed next week is exactly
as false as one noticed in the same minute, and the alternative — no verb at all — is a
hand-edit of `.conductor/state.json`, on the terminal record.

```bash
update-epic <id> --status archived --outcome <the one you meant> --reason "<why>" \
  --correct-disposition "<why the recorded one was wrong>"
```

Every other archive demand still applies to a correction: the required reason, the Gate 2
demand, the handoff demand, and the deferral assertion (already-recorded assertions satisfy it).

The id is positional. Parent/status/lane/link changes are validated like `add-epic` (no
self-parent, no cycle, known status, known lane, `--link`'s epic must be a known epic id). On an
unknown id, or any invalid flag value, it exits non-zero and writes nothing — including an
unrecognized flag name, which used to silently no-op and print a false "updated" success.

**`--lane` re-routes an epic in place, and `--plan` attaches a plan to one created without
one.** Both were settable only at creation, so the sole correction for a mis-routed epic was to
remove it and register it again — discarding its start time, its gate verdicts, its links and
its stories along the way. Both are in-place field writes: the epic keeps its position in
`state.epics[]` and every other field it carries.

> [!WARNING]
> **`--link` REPLACES the whole links array. It does not append.** Adding one `depends-on` edge
> to an epic that already has links means passing **every** link that epic should end up with,
> in one invocation — read its current `links[]` first (`/pm:epic list`, or `.conductor/state.json`).
> Three separate `update-epic --link` calls, each adding one edge, silently dropped seven
> existing annotation edges; they were recovered from git, which is not a recovery path that
> always exists. This bites hardest doing exactly what gh#101 asks for — wiring up dependency
> edges in bulk.

**`--link` REPLACES the epic's links wholesale**, unlike the other flags which patch a single
field — this is the intended CLI path to fix a malformed link (recorded with a bad `add-epic
--link` before this validation existed, or hand-edited) without touching `state.json` directly.
Pass every link you want the epic to have; omitting `--link` entirely leaves existing links
untouched.

**To EMPTY an epic's links, say so: `--clear-links`.** `--link` with no value used to do it by
accident — it is a repeatable flag, so a bare `--link` parsed as one non-string element, was
filtered away, and replaced the array with an empty one while printing "updated". That spelling
now exits non-zero and points here. `--clear-links` takes no value and may not be combined with
`--link`.

## Stories — decomposition at registration, and the third state a checklist needs

`--add-story` is **repeatable and available on `add-epic` and `add-many` as well as
`update-epic`**, so an epic's milestones land in the SAME write as the epic:

```
add-epic --id deploy-pipeline --lane superpowers \
  --add-story "Build the image" --add-story "Cut over staging DNS" --add-story "Retire the old worker"
```

An `add-many` batch entry carries a `stories` array of the same thing — plain titles, or
`{"title": "...", "done": true}` where a milestone is already behind you. Measured cause: with
stories addable only one `update-epic` call at a time AFTER registration, 91.7% of epics in a
108-epic audit had none at all.

**`--wont-do` is how a story ENDS without being done.** A story's `done` boolean holds two
states and the record needs three — open, completed, and *deliberately not being done*.
Deletion is not the third state: removing the row destroys the evidence that the work was ever
projected, which is exactly the history an archived epic's reader needs. So the row and its
title always survive, and only the terminal state differs:

```
update-epic deploy-pipeline --story 3 --wont-do "old worker was decommissioned by infra instead"
```

The reason is required — a terminal state with no recorded why reproduces the original problem
one level down. A disposed story is refused a second disposition and cannot be ticked `--done`
afterwards; a story already `--done` cannot be dropped.

A disposed story leaves **both** sides of the progress ratio, exactly as a `<!-- pm:lifecycle -->`
task does: `3/3 stories · 2 disposed`, never `5/5` (which would claim completion for work nobody
did) and never `3/5` (which would leave the archive gate refusing forever with no honest key).

> **There is no new archive refusal here.** The gate already refuses `--outcome delivered` while
> any work is outstanding, and inline stories are the FIRST progress source it reads — so an
> epic with an unticked story has been blocked since that gate shipped. What was missing was a
> way past it that tells the truth: the refusal's other remedy, the `<!-- pm:lifecycle -->`
> marker, cannot be written on an inline story at all (there is no task source), leaving only
> `--carried-to`, which names a receiving epic for work that was dropped rather than moved.
> That is the fabricated record the refusal itself warns against. `--wont-do` is the honest key.


---

## Order equals by hand — `reorder`

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" reorder <id> <id> <id>
```

Sets the **manual rank** of one whole priority band: the ids you pass, in the order you want
them, top to bottom. Ranks are rewritten dense `1..N` on every call.

**Rank is the LAST sort key.** The layering is `dependencies (hard constraint) → priority
(merit) → rank (tie-break)`. Its job is the tie that today falls through to alphabetical order —
three undifferentiated P1s sorting by id reads as if it meant something, and it does not. A rank
that outranked a dependency would just re-create the starvation inversion with a number
defending it, and one that outranked priority would make the priority field decorative.

**It takes the WHOLE band and refuses a partial one.** That is what keeps the numbering
contiguous by construction rather than checked afterwards, and it is why there is no per-epic
`--rank` flag: one-at-a-time reordering is tedious, and racy — two agents each setting one rank
produce a numbering neither chose. A refusal names exactly which epics were left out.

Also refused, writing nothing: a duplicate id, an unknown id, an archived id (ranking finished
work orders a band nobody reads), ids spanning two priority bands, and an empty invocation.

Around the edges:

- **A newly registered epic has no rank** and sorts *after* every ranked epic in its band — it
  does not jump a deliberate order because its id happens to sort first. Re-run `reorder` to
  place it.
- **`update-epic --priority` clears the epic's rank** (with a notice on stderr) when the band
  actually changes. A placement among one band's peers is meaningless among another's, and
  carrying the number across would collide with the destination band's own numbering.
- **`remove-epic` leaves a gap** in the numbering. Harmless — a gap changes no ordering — and the
  next `reorder` closes it.
- `rank` is not `order`: `order` sequences stories *inside* an epic. Different container,
  different question.

## Remove an epic — `remove-epic`

The only prior recovery from a mis-registered epic was a raw `git checkout` on `state.json`.
`remove-epic` hard-deletes an epic (recoverable only via git history — there is no in-app undo,
by design: this replaces the git-checkout workaround, it doesn't add a softer one):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" remove-epic <id> [--cascade]
```

- **Every dangling reference is cleaned up automatically** — not just `links[]`. Any other
  epic's `links[]` and `parent`, a disposition's `carriedTo` handoff (including the one on a prior
  record a correction kept), a deferral assertion's
  `deferrals[]`, a release's `deferred[]` and the active pointer are all swept, and the command
  reports where each reference was held — a dangling reference is worse than a silently smaller
  graph. (A `deferred[]` entry left behind used to render in `PROJECT.md` as a deferral pointing
  at nothing.) `integrity`'s `dangling-epic-reference` check reads the same declaration, so it
  reports any that a hand-edit leaves behind.
- **Blocked while a detour-stack frame names the epic.** A frame is control state rather than a
  record: dropping it would discard a paused epic's resume path, and keeping it would leave
  `/pm:resume` popping a frame that names nothing. Resume or pop the detour first.
- **Blocked by default if the epic has any descendants** (`parent: <id>`, walked recursively —
  children, grandchildren, etc.). The command prints a short `(id, title, lane/priority/status)`
  table of the parent plus every descendant at any depth and exits non-zero — reassign or remove
  the descendants first, or pass `--cascade` to remove the epic and *all* of its descendants
  together in one atomic write. The preview table and `--cascade`'s actual blast radius always
  agree — a human confirming from the table is confirming the real deletion set, not just the
  direct children.
- **`--cascade` is a real "delete N epics" action** — before you run it, show the human the table
  the blocked attempt printed and get explicit confirmation. The engine has no interactive
  prompt of its own; that confirmation step is the agent's job, not the CLI's.
- If the removed epic was `.active`, the pointer is cleared automatically.
- **A removal now survives the next `sync`.** Removing an epic that claimed a source artifact
  (its `planPath`) records a `syncIgnore` tombstone for that path, over the whole `--cascade` set
  and not just the named epic — previously `remove-epic` bought you only until the next sync,
  which re-registered byte-identical ids within the hour. The tombstone is inspectable in
  `.conductor/state.json` and reversible by the action that contradicts it: attaching that
  artifact to an epic (`update-epic <id> --plan <path>`) clears it.

## Set the active epic — `set-active` / `clear-active`

The top-level `.active` pointer (what the briefing's "NOW" line reads) has its own verbs — never
hand-edit `state.json` for this:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" set-active <id>     # make <id> the active epic
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" clear-active        # no active epic
```

`set-active <id>` (positional id) sets `.active = <id>` **and** the epic's `status: "active"`
together, demoting any previously-active epic to `queued` — so the pointer and status can never
disagree. It rejects an unknown or archived id. `update-epic <id> --status active` keeps them in
sync too (it sets `.active`), and moving the active epic off `active` clears the pointer.

## Grant epic-level autonomy — `set-autonomy`

Before an epic can run unattended through phase transitions and destructive actions, it needs a
preflight scan (see the `conductor` skill's "Epic-level autonomy — the preflight scan" section)
and the user's recorded answers.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" set-autonomy <id> \
  --preauthorize "drop-scratch-table:reviewed, safe to drop" \
  --context "staging DB only, no prod access" \
  --level autonomous
```

`--preauthorize`/`--context`/`--notify` are repeatable and additive — re-running `set-autonomy`
APPENDS, it never clobbers prior entries. `--level` replaces (default `"off"` — today's
behavior, unchanged). `PROJECT.md` and the session brief mark an autonomous epic with 🤖.

## Record a gate verdict — `record-gate-review`

An OpenSpec gate review is recorded against the epic with the evidence a later reader can
check, as FIELDS rather than as prose in a note:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" record-gate-review <id> \
  --gate 1|2 --verdict pass|fail \
  --base-sha "<a>" --head-sha "<b>" --reviewer "<identity>"
```

`--base-sha`/`--head-sha` record the commit range the review actually covered, and `--reviewer`
records who (or what) performed it. A review of `a..b` on an epic that later shipped `b..c` used
to be byte-identical in `state.json` to one that covered everything; recorded as fields, the two
are distinguishable without reading prose, and the range is what later tells a covering verdict
from a stale one.

Verdicts recorded before these fields existed carry a free-text `note` instead. They load
unchanged and are reported as carrying no checkable evidence — never deleted, never rewritten,
never mined for a range by parsing that note.

## The gate procedure — required task items

Carried into every change's own task list as NUMBERED REQUIRED TASK ITEMS, never as review
guidance. The form was measured, not guessed: across one audited repository a rule carried by a
mandatory task section reached 14/14 subsequent changes, while the same rule written as a prose
bullet reached 3/15.

1. **Call-site completeness sweep.** For every rule, guard or invariant the change introduces or
   modifies, enumerate ALL call sites of the thing being guarded — derived mechanically (`rg` for
   the callers), never a list typed from memory — then state where the rule holds and where it
   does not, and justify each omission. A guard added at one call site while an identical sibling
   site is left untouched is a FINDING, not a detail: both gates are diff-scoped and structurally
   cannot see an edit absent from a file the diff never touched.
   A DATA reference is a call site too: for every field the change adds that holds another
   record's id, enumerate the places that write it, read it and REMOVE it. A deletion path that
   strips one holder and not its siblings leaves a dangling reference — the record rendering a
   pointer to something that no longer exists — and it is invisible to both gates for the same
   diff-scoped reason.
2. **Verify against the commit, not the working tree.** The commit is the unit of verification.
   Reading a file in the working tree is NOT verification. For every task, run
   `git show --stat <that task's sha>` and assert that every file the task claims to change
   appears in THAT commit. A task whose claimed file is absent
   from its commit FAILS, even though the working tree holds the intended edit, the suite passes
   and both gates are green.
3. **Declare lifecycle bookkeeping.** A task that is bookkeeping about the change's own lifecycle
   rather than its work — above all the task that archives the change itself, which always
   qualifies — carries the literal marker `<!-- pm:lifecycle -->` on the task line. The engine
   infers this from nothing else: not the wording, not the commands the text names, not the
   position in the file. Mark it when the task source is authored OR AMENDED — a source written
   before this capability existed gets the marker the first time you touch it, or its archive task
   counts as outstanding work forever.
4. **Attribute every commit to its epic.** At the moment each commit is made, record it:
   `update-epic <id> --attribute-commit <sha>`. The engine infers attribution from nothing — not
   the files a commit touches, not an epic id in a message — so an unrecorded commit is a commit
   the epic's Gate 2 cannot be checked against. The per-task conventional commit of an OpenSpec
   apply loop always qualifies. Work already in flight is covered too, but **only before the first
   attribution**: catch up in the order the commits landed, then keep attributing forward. The
   array is append-only — the engine neither reorders nor de-duplicates it — so catching up AFTER
   attributing forward leaves an ancestor as the last entry, and the last entry is the endpoint a
   recorded Gate 2 `headSha` is compared against. If forward attribution has already begun,
   attribute forward only and say so; a wrong endpoint reads as a stale verdict and refuses the
   archive. **One exclusion:** the commit that moves
   `openspec/changes/<id>/` under `archive/`, and any commit that only relocates or deletes a
   change's artifacts rather than implementing its work, is lifecycle bookkeeping and
   MUST NOT be attributed — that move lands after the reviewed range by construction, so attributing it makes
   the epic's own Gate 2 stale at the instant the archive gate reads it.
5. **Review a release's specs against each other.** Gate 1 and Gate 2 each take ONE CHANGE as
   their unit, so nothing above them asks whether a release's specs AGREE. Before `/opsx:apply`
   on any release holding **two or more spec files** — counted FLAT across its member changes, so
   one change carrying six specs qualifies — and again after any round of concurrent amendment,
   dispatch FRESH-CONTEXT reviewers at the release's whole spec set (one under `standard`, two
   with different lenses under `thorough`) and ask the six questions: contradiction, double
   ownership, unmeetable requirements, gaps against the proposal's Resolves list, vocabulary
   forks, and shared chokepoints. Split every finding into BLOCKS and POLISH, fix the BLOCKS,
   decline most POLISH and say why — a review of a large document always returns something, so
   "no findings" is not a stopping condition. A contradiction is never POLISH. Then record the
   verdict: `record-cross-spec-review <releaseId> --verdict pass|fail --reviewer "<identity>"`.
   The engine enumerates the spec set from disk and hashes it, so a spec ADDED to the release
   afterwards — or a reviewed spec amended — marks the verdict stale on every surface; a set you
   assert instead would go stale in exactly the way this gate exists to catch. Measured here:
   this pass returned 5 Critical and 10 Important against six specs that had each passed
   `openspec validate --strict` and would each have passed Gate 1 alone, including a flagship
   scenario that was unreachable.
6. **End work by recording a disposition.** An epic, a story, a deferral or a release exclusion
   ENDS by recording a terminal disposition carrying its required reason, and
   never by removing the record. The archive verb takes TWO halves in ONE invocation — the
   disposition AND a deferral assertion — because the gate refuses either half alone:
   `update-epic <id> --status archived --outcome delivered|killed|superseded|abandoned|declined --reason "<why>" --no-deferrals`
   (every outcome except `delivered` requires the reason). `--no-deferrals` is the explicit
   "there are none" and is a claim, not a default — swap it for `--deferral
   "<epicId>:<artifact section>"` where work is now held by a registered epic, or
   `--declined-deferral "<what>:<why not>"` where you are deliberately not doing it; both
   repeat, and the engine will not read your artifacts to guess.
   Deletion removes the record of projected work, which is
   precisely what a disposition exists to preserve. `remove-epic` stays available and ungated for
   what it is for: an epic registered in error, a duplicate, a mistake made a minute ago — where
   there is no disposition to record because there was no work.
