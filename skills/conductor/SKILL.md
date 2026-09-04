---
name: conductor
description: >
  Project-management discipline that sits ABOVE OpenSpec and Superpowers. Use whenever
  work spans more than one epic, when a review or build reveals something
  broken/orphaned/unwired that forces a detour, when deciding what to work on next, or
  when resuming after a context compaction. Keeps a single lane-agnostic index of epics,
  an explicit detour stack, and epic links so nothing is lost across pivots.
  Triggers: "what were we working on", "what's next", "this is broken, fix it first",
  "park this", "resume", "where did we leave off".
---

# Conductor — the PM layer above OpenSpec + Superpowers

## Mental model (read first)

- An **epic** is any backlog item, tagged by `lane` — `openspec | superpowers | claude-code
  | decision | external`. OpenSpec proposals are one lane, not the only one.
- **Stories/phases** live in the best available source: `tasks.md` checkboxes (openspec),
  `planPath` checkboxes (superpowers), inline `stories[]` (claude-code), or `—` (decision /
  external). Never copy these into `state.json` manually unless using inline `stories[]`.
- The conductor owns ONLY what no lane-specific tool can: cross-epic **priority/ordering**,
  the **detour stack**, and **epic links** (especially the reconcile relationship).
- State of record is `.conductor/state.json`. `PROJECT.md` is a generated view — never
  hand-edit it. After any state change, run `node "$ENGINE" render` (see "Running the engine").

You (Claude) are myopic across compactions. This skill is how you stop losing the thread.

## Running the engine (resolve the path — never version-pin)

When you invoke `conductor.mjs` from a Bash step, resolve it version-independently: prefer
`$CLAUDE_PLUGIN_ROOT`, and if that's unset (common outside a slash-command) fall back to the
newest installed copy. **Never** resolve it out of the PROJECT — `$CLAUDE_PROJECT_DIR` names a
directory whose contents the project itself writes, so a `-f` test there is a promise to run
whatever file happens to sit at `scripts/conductor.mjs` in whatever repo you opened. Self-hosting
does not need it; the paragraph below is how the checkout's engine wins — and note that there the
project dir is only the *comparand*, checked by realpath against a path your environment supplied,
never the thing granting the authority. **Never** hardcode a
versioned cache path like `…/pm/0.6.1/scripts/…` — it breaks on the next upgrade. Every invocation
prints `conductor: engine <version> @ <path>` to stderr, EXCEPT this is suppressed by default
whenever `$CLAUDE_PROJECT_DIR` is set (a self-hosting/dev context, where a stale-cache mismatch
is unlikely) — set `PM_VERBOSE_ENGINE_BANNER=1` to force it back on if you need to confirm the
source there. `PM_QUIET_ENGINE_BANNER=1` still works as an explicit suppress outside that
context too.

One line is NOT suppressed by either switch. If `$CLAUDE_PROJECT_DIR` resolves to a different
directory than your cwd AND your cwd has a `.conductor/` of its own, every invocation warns on
stderr and names both repositories — because in that situation every path the engine reads or
writes belongs to the other one. It is a warning, never a refusal: pointing the engine at a
sibling repo's conductor is a supported pattern. Running from a subdirectory, or targeting a
project from a directory with no conductor, is silent as before.

**Developing pm itself?** This is how the checkout's engine wins, for every caller at once —
including `hooks/hooks.json`, which invokes the engine through `$CLAUDE_PLUGIN_ROOT` with no
chance to resolve anything. Export `PM_ENGINE_DELEGATION=/abs/path/to/your/pm/checkout` and an
installed engine running in **that** tree hands the whole invocation off to its
`scripts/conductor.mjs` before doing any work. It is contributor setup, documented in
CONTRIBUTING.md and the README — ordinary users never set it and never need to.

It is **opt-in, and it names one path, deliberately**. Those four hooks fire in every project on
the machine, so anything a project could write about itself — a `.claude-plugin/plugin.json`
saying `"name": "pm"` is two lines — could be forged by a hostile repo to get its own code run.
A bare on/off flag would have the same problem in practice, since it gets exported in a shell
profile and is then set everywhere; a path names your checkout and matches nothing else.

Two caveats. It only exists once the *installed* plugin carries the release that added it, and
the snippet below will not cover for it — resolving the engine out of the project directory is
how that used to be papered over, and gh-139 deleted that arm because it executed
project-supplied code on nothing but a `-f` test. While developing a release the installed
plugin does not yet carry, run `node scripts/conductor.mjs <verb>` from the checkout directly.
And it makes the engine you TYPE non-authoritative: with it set, running a worktree's
`scripts/conductor.mjs` while `$CLAUDE_PROJECT_DIR` points at the main checkout runs the
**main checkout's** engine, because the project dir decides. In a repo that works in worktrees
as much as this one, that is worth knowing before you debug a change that seems not to take.

```bash
ENGINE="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/conductor.mjs}"
[ -f "$ENGINE" ] || ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1)
node "$ENGINE" <subcommand>
```

Below, `$ENGINE` means the path resolved this way.

## Commands

**Any verb's flags: `node "$ENGINE" <verb> --help`.** Per-verb since 0.37.0 — it prints that
verb's own surface rather than the global verb list, and it is derived from the engine's flag
registry, so it cannot disagree with what the parser accepts. Use it instead of reading source.

`/pm:init` scaffold · `/pm:status` show · `/pm:next` decide · `/pm:detour` park ·
`/pm:triage` screen an incoming ask against the whole backlog before registering it ·
`snapshot` (PreCompact hook only — re-renders PROJECT.md and writes `.conductor/brief.txt`
right before the context window collapses, so nothing is lost to compaction) ·
`write-rules` (invoked by `/pm:init`/`/pm:upgrade` — refreshes the managed rules block in
CLAUDE.md, or the recorded `--platform`'s equivalent file; not meant to be run standalone) ·
`rules-target` (read-only query — prints the absolute path of the file the recorded platform's
rules block belongs in, resolving that platform's first-match-wins chain. Exists so a consumer
never has to mirror the chain: a second copy of platform knowledge is drift waiting to happen.
Does not record a platform, unlike `write-rules`) ·
`/pm:resume` resume + reconcile (writes the reconciler's verdict back durably via
`record-reconcile`) · `record-gate-review <id> --gate 1|2 --verdict pass|fail` records an
epic's Gate 1/Gate 2 review verdict on ANY lane (see "OpenSpec build" below); a `pass` requires
`--base-sha`/`--head-sha`. Recording is lane-agnostic, ENFORCEMENT is not: `update-epic
--status archived` on an openspec-lane epic requires a passing Gate 2 verdict already recorded,
and no other lane gains that obligation ·
`record-tracker-refresh <id> --verdict unchanged|material-change --external-updated-at <iso>`
records the re-read a tracker-linked epic owes before specs are drawn for it, and advances that
epic's freshness watermark in the same write (an epic with no external id re-reads its local
plan/proposal instead — instruction only, nothing recorded)
· `/pm:sync` register new proposals and plans ·
`/pm:epic add` register any epic (`--parent`, `--external-id`, repeatable `--add-story
"<milestone>"` so a plan's milestones land in the SAME write) · `/pm:epic` → `add-many`
(atomic bulk create, each entry taking a `stories` array) / `update-epic` (write-back, incl.
`--title`/`--link`/`--add-story "<title>"`/`--story <n> --done` [1-indexed] / `--story <n>
--wont-do "<reason>"` — closes the hand-edit-of-state.json risk for inline `stories[]`) /
`remove-epic`
(hard-delete, `--cascade` for a parent + descendants) ·
**`push-detour <parent> --detour <id> --reason "<why>" (--reconcile | --no-reconcile)` /
`pop-detour [<paused-id>]`** the substantial detour's PUSH and POP — verbs since 0.35.0, where
both used to be a documented hand-edit of `state.json` (see "PUSH protocol" / "POP protocol")
· **`set-active <id>` / `clear-active`**
set the top-level active epic · `set-autonomy <id>` grant an epic broad execution trust (see
"Epic-level autonomy" below) · `plan-hierarchy --parent <id>` batched execution plan for a
parent's children (see "Epic-hierarchy orchestration" below) · `verify-worktrees` flag orphaned
hierarchy-dispatch worktrees · `verify-state` fail loudly if state.json's mtime is newer than
the last render's stamp (a mechanical check for an undetected hand-edit) · `render --diff-summary`
prints `epic-relevant: yes|no` — normalizes away the "Last rendered" timestamp and "Recent
detours" table rotation (both change on nearly every render without meaning anything actually
changed) so deciding whether a PROJECT.md diff is safe to discard as noise is mechanical
instead of eyeballed · `set-review-mode` the
repo's bounded review-count dial (off/standard/thorough), `update-epic <id> --review-mode`
escalates a single epic above the repo dial · `set-lane-routing` / `suggest-lane` per-repo
lane-routing overrides checked before the generic heuristic (see "Lane routing overrides" above)
· `/pm:gate-guard` hard reconcile-gate backstop — ON BY DEFAULT for any epic with
`reconcileNeeded: true` and cannot be turned off for that case; `set-gate-guard on|off` still
exists but only gates any future generalization of the hook, not the reconcile-owed check itself
· `lesson-advice` the PreToolUse LESSON ADVISOR (hook-invoked; you never run it by hand) — it
matches the pending tool call against every `docs/lessons/*.md` entry carrying a `detect:`
matcher and injects that lesson's rule BEFORE the mistake. Advisory only: it never blocks and
always exits 0, unlike the gate guard above. See the `lessons` skill for the corpus shape
· `/pm:tracker` make the conductor tracker-aware · `/pm:feedback [bug|feature] "<summary>"`
file a bug report or feature request for `pm` itself against `cfdude/pm` — writes the report to
`.conductor/feedback/` first, then `gh issue create` when `gh` is installed AND authenticated
(deduping against open issues), else a prefilled `issues/new` URL, else `bugs@pm-plugin.dev`;
`gh` is an OPTIONAL dependency and the command checks for it rather than assuming it (#105) ·
`/pm:changelog` what changed since your version · `/pm:upgrade` refresh rules + run migrations
+ print the changelog delta.

## Hierarchy & external trackers

- **Hierarchy:** epics form a single-parent tree via `parent`. Nest with `--parent <id>`
  (validated: parent exists, no self/cycle) or bulk-create a parent + children atomically with
  `add-many --from <json>`. PROJECT.md indents children and rolls up `X/Y children archived`;
  NEXT UP keeps global priority order (grouping is render-only).
- **Effective priority (computed, never stored):** an epic's effective priority is the best of
  its own and every epic that transitively `depends-on` it. A `planned` P2 that a `queued` P1
  needs sorts as P1 and renders `P2 → P1`; the merit priority stays visible, so you can still
  tell the goal from the means. An ARCHIVED dependent lifts nothing — a satisfied dependency has
  nothing left to unblock. Deprioritise the dependent and the lift drops with it.
- **Tracker awareness (instruction layer ONLY — never call the tracker yourself from the
  engine): DIRECTION decides what is emitted, never the vendor.** Every tracker carries an
  explicit `direction` — `inward` | `outward` | `both` — set with `set-tracker --direction <d>`
  and read by every emitter. **Do not reason from the system name.** `github-issues` is not
  inward-only any more and `jira`/`linear` are not outward-only; before you act on a tracker,
  read its recorded `direction` out of `.conductor/state.json`.
  - **`outward`** — create an issue for any epic lacking `externalId`, record the key with
    `update-epic <id> --external-id <KEY> --external-url <url>`, and transition the linked issue
    toward the `statusIntent` semantic target on each status change. The brief lists only
    unmirrored epics; it never fabricates transition drift.
  - **`inward`** — as part of `/pm:sync`, list open items in the tracker's scope and register the
    ones whose `externalUrl` matches no epic, using the recipe the rules block emits. That recipe
    **runs as written**: it carries a derived `--id` (`<system>-<scope>-<number>`, so the same
    item yields the same epic id in every repo and session and a re-run is refused as a duplicate
    rather than inventing a slug), a `<lane>` from `suggest-lane` rather than a hardcoded
    `claude-code`, and `--external-updated-at` so a freshly mirrored epic starts with a watermark.
    A `P0`/`P1`/`P2`/`P3` label overrides the `P2` default.
    The pull has a **reciprocal half**: the list is of OPEN items, so an epic linked to an item
    that is not in it has an item that is no longer open. Read that item — absence from a list
    also covers deleted, transferred and out-of-scope — and where the epic is not already
    `archived`, PROPOSE its disposition rather than writing one. The outcome and its required
    reason are a judgment about what happened to the work, and an engine-inferred one would be
    unreplaceable (#130). Without this half, sync creates epics from items and never ends one:
    0.27.0 shipped with all twenty member issues closed and all twenty epics still `queued`
    (#137). The engine's half of the same defect is the `delivered-release-epic-left-open`
    integrity check, which needs no tracker at all.
  - **An inward section is emitted only when the tracker also names a SCOPE to read** — a `repo`
    for `github-issues`, a `repo` or `--project` for anything else. Direction alone does not turn
    it on, because pm may not emit a command line with an unfilled placeholder.
  - **A NEW primary tracker registered with no `--direction` defaults to `inward`, whatever the
    vendor** — a deliberate reversal in 0.27.0. Outward creation of issues in someone else's
    tracker is the consequential default and must be chosen. Remedy:
    `set-tracker --system jira --direction outward`. Existing repos are unaffected; the migration
    stamped each tracker with the direction it already behaved with.

  See `commands/tracker.md` and `commands/sync.md`.
- **Primary + secondary trackers:** exactly one **primary** tracker (`state.tracker`, everything
  above, unchanged) plus zero or more **secondary** trackers (`state.secondaryTrackers[]`), set
  via `set-tracker --role secondary --system <sys> --repo <repo>` (or `--project <key>`), removed
  with the same flags plus `--remove`. Re-running with a matching `system`+`repo`/`project`
  upserts in place (namespace-prefixed key — `repo`- and `project`-keyed entries never collide
  even if the string values match). A secondary tracker gets inward pull (same as `github-issues`
  above, but deduped by `externalUrl` — globally unique — not bare `externalId`, since two
  secondary trackers can each have an issue numbered the same) plus a new capability, **status
  writeback**: when an epic sourced from a secondary tracker reaches `archived`, you close the
  linked issue there too. It NEVER gets outward-created issues — that stays exclusive to the
  primary tracker. `rulesBlock()` emits one "Secondary tracker sync" section per configured
  entry, in addition to the primary section. See `commands/tracker.md`.
- **Resync after completion:** where at least one configured tracker has an **emittable inward
  procedure** (direction includes `inward` AND it names a scope), `rulesBlock()` also emits a
  "Sync after completing tracker-linked work" section — after closing/transitioning a
  tracker-linked issue as part of completing an epic, re-sync with your tracker(s) (`/pm:sync`)
  right away, phrased tracker-count-agnostic so it holds whether one or several trackers are
  configured. `buildBrief()` mirrors this with a one-line, non-blocking SessionStart nudge on the
  same condition — no `lastSyncedAt` tracking, just a reminder; the agent decides whether it's
  worth the round trip that session. Both used to fire for any tracker at all; an outward-only
  repo now gets neither, which is deliberate.
- **Freshness and the refresh gate:** a tracker-linked epic carries `externalUpdatedAt` — the
  **tracker's own** updated timestamp as of the last time you actually READ that item. Seeing it
  in a list response is not reading it; advancing the watermark from a listing erases the drift
  the watermark exists to find. Before an epic becomes the active piece of work its source of
  truth is re-read, and the obligation is cleared with `record-tracker-refresh <id> --verdict
  unchanged|material-change --external-updated-at <iso> [--summary "<what>"]`. The gate keys on
  **provenance** — does this epic have an `externalId` — never on direction: an epic with none
  re-reads its LOCAL source (plan, or proposal plus tasks) and `record-tracker-refresh` refuses it
  by name.
- **The brief's freshness line counts only epics that can still become work.** `⚠ N
  tracker-linked epic(s) never re-read since mirroring` excludes every `archived` epic: the
  ARCHIVE DISPOSITION discharges the refresh obligation outright, whatever the outcome, because
  work that ended never becomes the work again. Nothing needs a terminal watermark. The closed
  half is the agent's, not the engine's — the engine cannot know an item is closed without
  integration it must never do, so the inward-sync step that reads the open list is what turns
  "item no longer open" into a proposed disposition, and the disposition is what clears the
  count. Measured on this repo when the behavior was filed as a bug: 59 counted, 29 of them
  ended or closed, and `/pm:sync` — the action the line names — provably could not clear those
  29, because an epic that ended has no open item to read.

## OpenSpec build — the two-gate mechanical check

CLAUDE.md's "OpenSpec build — TWO mandatory gates" section describes the discipline: Gate 1
(fresh-context spec review, before code) and Gate 2 (fresh-context implementation review,
before docs/archive). Until this mechanism existed, nothing checked that either gate actually
happened — an epic could go straight from `apply` to `archive` on narration alone. The engine
now enforces Gate 2 mechanically. Keep the two halves apart, because they are scoped
differently: a verdict is RECORDABLE on any lane, and it is ENFORCED at archive time strictly on
the `openspec` lane.

- After a real fresh-context review, write the verdict back with `node "$ENGINE"
  record-gate-review <epicId> --gate 1|2 --verdict pass|fail --base-sha <a> --head-sha <b>
  [--reviewer "<who>"]` — this writes `{verdict, reviewedAt, baseSha, headSha, reviewer?}` onto
  `epic.gateReview.gate1`/`gate2` in `.conductor/state.json`, mirroring how `record-reconcile`
  writes the reconciler's verdict. Rejects (writes nothing) if the epic id is unknown, `--gate`
  isn't `1`/`2`, `--verdict` isn't `pass`/`fail`, or a `pass` arrives without both shas. **The
  epic's LANE is not a rejection reason.** It used to be, which left pm telling every lane to run
  reviews while it could record the verdict for exactly one of them — `set-review-mode` is
  lane-agnostic and its own table names "a Superpowers task review". The consequences were the
  defects the next bullet describes, displaced by one lane: the shas became prose in `--notes`,
  which nothing compares, so a non-openspec verdict could never read stale; `integrity` keys off
  `gateReview` and could not see it; and silence was indistinguishable from reviewed-and-clean.
- **The range is evidence, and a verdict can go STALE.** `--base-sha`/`--head-sha` record what
  was actually reviewed. If the epic later attributes commits the recorded head does not reach,
  the archive is refused by name until the range is re-reviewed or the attribution is corrected.
  A review of `a..b` on an epic that then shipped `b..c` used to be byte-identical to one that
  covered everything. Pass `--head-sha` in the same abbreviated form `attributedCommits` already
  holds — identity is tested on the raw strings first, and only then resolved through git.
- **An archive that reached `archived` with no review records `verdict: "ungated"`** rather than
  nothing. That is the archive-drift heal's own record of the bypass; it carries `recordedBy` and
  no `reviewer` (a path name must never surface in an audit query over reviewers). It is a
  STANDING condition — reported by the brief and by `integrity` at every composition, never
  consumed — and it clears only when a real passing verdict supersedes it. The superseded entry
  is kept, not destroyed.
- `update-epic <id> --status archived` on an `openspec`-lane epic REQUIRES
  `gateReview.gate2.verdict === "pass"`, non-stale, when the outcome is `delivered` — if it's
  missing, `fail`, `ungated` or stale, the transition is rejected with a clear error naming what's
  missing, and nothing is written. `killed`, `superseded` and `abandoned` are exempt: the code was
  never written or was thrown away, so demanding a verdict would make those outcomes recordable
  only by fabricating one. Gate 1 is not itself required at archive time (it gates code, which
  already happened earlier), though recording it via the same subcommand is good practice and
  `integrity` reports an archived openspec epic that passed Gate 2 with no Gate 1.
- **The gate binds every path to `archived`, not just this verb.** `reconcileArchived()` — reached
  from `upgrade`, `render`, the commit nudge and `sync` — used to flip an epic with no lane check
  and no gate check. It now records how it bypassed instead of passing silently.
- Non-openspec-lane epics (`superpowers`/`claude-code`/`decision`/`external`) gain no OBLIGATION
  from any of this — they have no two-gate process, the archive check never runs for them, and an
  epic with no verdict (or a stale one) archives exactly as it always has. What they gained is
  somewhere to PUT a review they actually ran: `record-gate-review` accepts them, and the verdict
  renders in `PROJECT.md`'s Gate reviews table and the briefing alongside every other. Recording
  evidence must never create an obligation, which is why only the recording side moved.
- An epic running under autonomy (`autonomy.level: "autonomous"`) must still call
  `record-gate-review` after each real gate review rather than only narrating it in
  conversation — narration alone does not satisfy the archive-time check, and there is no
  bypass flag.

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
   counts as outstanding work forever. The marker is pm's alone and it collides with an upstream
   lint: `openspec validate --archived` knows nothing about it, counts raw checkboxes, and
   therefore FAILS every correctly archived pm change — reporting `1 incomplete task` against the
   same file pm reports complete with `· N lifecycle`. Its own help text offers it for pre-commit
   linting; do NOT wire it into a pm-managed repo. Nothing clears that failure: ticking the archive
   task would be a false record and dropping the marker would break pm's own archive gate. Ignoring
   a marked line upstream is the clean fix and it is not pm's to make.

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
   **Separate `--declined-deferral`'s halves with `::` whenever either carries a colon.** Both
   halves are free text, so there is no correct guess between them: a single colon still splits
   as it always did, but two or more with no `::` are REFUSED rather than truncated, and a value
   with no separator at all is refused too. First-colon used to record
   `"Set alwaysLoad:false to reclaim RAM:declined because X"` as `what: "Set alwaysLoad"` — which
   reads as an instruction to DO the thing being declined. `--deferral` keeps the first-colon
   rule and needs no `::`: its left half is an epic id, which cannot contain one.
   **All three flags are refused outside an archive.** The assertion is written only in the
   archive transition, so supplying them anywhere else used to compute it, drop it, and print
   `updated`. Correct one already recorded by re-running the archive with
   `--correct-disposition "<why the recorded one was wrong>"` alongside the corrected flags.
   Deletion removes the record of projected work, which is
   precisely what a disposition exists to preserve. `remove-epic` stays available and ungated for
   what it is for: an epic registered in error, a duplicate, a mistake made a minute ago — where
   there is no disposition to record because there was no work.
7. **Route what the work taught you.** A change teaches three kinds of thing and each has a
   different destination. Route them BEFORE the change closes, while the evidence is still
   recoverable. Nothing above this asks, so silence here reads as "nothing was learned" rather
   than "nobody looked", and the two are indistinguishable afterwards.
   A **practice, gate or discipline** you adopted to get this change done: register it as an
   epic, and file it with the tracker as well when it belongs to a product other people use.
   **The evidence goes with it** — what went wrong that made the practice necessary, with
   numbers. That evidence is the strongest part of the eventual spec and it is unrecoverable
   later; a practice registered without it reads as a preference.
   **Friction in the tooling** that you routed around: file it — `/pm:feedback [bug|feature]
   "<summary>"` for `pm` itself, and wherever it is tracked for anything else. **This is the
   direction that gets missed**, and the reason is mechanical: a workaround produces working
   output, so nothing looks broken and nothing prompts. Hand-editing a file a tool owns because
   no verb exists for it, a command the tool EMITTED that did not run as written, a convention
   you invented that the tool should have supplied, anything you did twice by hand that it could
   have done once — each of those is a filing, not a footnote. Measured: two sessions hit one
   broken recipe in an afternoon, each invented a workaround, neither reported it until asked.
   A **process failure** — how we work, rather than what the tool should do: a lesson file in
   `docs/lessons/`, carrying its `trigger` written as the situation BEFORE the mistake, a
   concrete `cost`, and `enforced_in` naming where its rule actually binds. Give it a `detect:`
   matcher only where the situation is recognisable with near-certainty — the `lesson-advice`
   hook fires on that matcher before the next mistake, and a hook that is wrong 7 times in 8
   trains everyone to ignore the one time it is right, so a lesson that cannot be matched
   precisely stays retrieval-only.
   Name which of the three it is out loud. A process lesson filed as a feature request never
   gets built, and a product gap written down as a lesson never gets fixed.

## When something blocks progress: classify the detour FIRST

Do not start fixing. Decide which kind this is and say so.

**Minimal detour** — small, self-contained, no design ambiguity.
Fix → test → commit → push, then record it so it leaves a trail:
`node "$ENGINE" log-detour "<what you fixed>"` (appends a
timestamped line + commit SHA to `.conductor/detours.log`). Then resume. No proposal, no
stack entry. Rule of thumb: fits before the next compaction and doesn't change the shape of
the current proposal.

**Substantial detour** — needs its own design, changes shared behavior, or is multi-step.
This becomes its own **epic in the appropriate lane** (openspec, superpowers, or claude-code
as fits the scope). Run PUSH. When unsure, treat as substantial — a needless stack entry is
cheap; a lost thread is the whole problem we're solving.

## PUSH protocol (entering a substantial detour)

**`push-detour` is the transition. Never hand-edit `.conductor/state.json` to push a frame** —
this protocol used to say to, and none of the engine's guarantees applied to it: no validation
that either epic exists or is live, no non-empty reason, no deliberate `reconcileOnResume`, no
write-conflict guard, no read-back verification, no record that it happened.

1. Make the current epic's progress source reflect reality; commit so nothing is uncommitted.
2. Register the detour as an epic FIRST — a frame cannot name work that does not exist yet.
   `/pm:epic add`, or:
   ```bash
   node "$ENGINE" add-epic --id <new-id> --title "<what it is>" \
     --lane <openspec|superpowers|claude-code> --priority P0
   ```
3. Push:
   ```bash
   node "$ENGINE" push-detour <parent-epic-id> --detour <new-id> \
     --reason "<why, concretely>" (--reconcile | --no-reconcile)
   ```
   In ONE guarded write this sets the parent to `paused`, pushes the frame
   (`pausedEpic` / `pausedAt` / `reason` / `spawnedDetour` / `reconcileOnResume`), records both
   protocol links (detour `resolves-blocker-for` parent; parent `may-invalidate` detour), makes
   the detour active, and re-renders.

   **Exactly one of `--reconcile` / `--no-reconcile` is required, and there is no default.**
   Whether the detour can invalidate the paused epic's plan is a judgment; a default would make
   an absent decision look like a considered one, on the one flag whose documented property is
   that it must survive until reconciliation completes. Say `--reconcile` unless you are certain
   the detour touches nothing the paused epic depends on.
4. Build the detour through the appropriate lane's workflow, then archive/close it.
5. **Paste the Honcho memory.** `push-detour` printed `paused <parent> for <reason>` on stdout
   and appended a timestamped copy to `.conductor/honcho-memories.log` — the engine only formats
   and logs the string, never calling Honcho itself, per the instruction-layer law. Paste the
   printed line into your actual Honcho MCP memory/conclusion tool call so the pivot survives
   outside this repo. (`honcho-memory push <parent-epic-id> "<reason>"` remains available for a
   pivot you are recording after the fact.)

## POP protocol (leaving a detour) — the RECONCILE GATE

The step otherwise lost after compaction. Do not skip it.

1. Confirm the detour epic is archived and committed/deployed.
2. Pop with the verb — **not a hand-edit**, for the reasons PUSH gives above:
   ```bash
   node "$ENGINE" pop-detour [<paused-epic-id>]
   ```
   It removes the top frame, resumes the paused epic (`status: "active"`, `active` pointing at
   it), and — where the frame had `reconcileOnResume` — writes `reconcileNeeded: true` in the
   SAME write. That ordering is load-bearing: POP removes the frame before reconciliation runs,
   so a separate write would let the archive-drift self-heal clear the obligation it had just
   created. The optional epic id is an ASSERTION, not a selector — the stack is LIFO, so naming
   an epic that is not on top is refused rather than popping a different one.
3. If `reconcileOnResume` was true, RECONCILE before writing code: delegate to the
   **reconciler** agent with the paused id + detour id. It re-reads the paused proposal,
   diffs what the detour shipped, and reports back `VERDICT: valid|invalidated` +
   `AMENDMENTS:` (one per line) — see `agents/reconciler.md`.
   - Invalidated → amend the proposal + `tasks.md` first.
   - Still valid → say so explicitly.
   - Either way, **write the verdict back durably** — this is what actually clears
     `reconcileNeeded` now (don't hand-clear it): `node "$ENGINE" record-reconcile
     <paused-id> --detour <detour-id> --verdict <valid|invalidated> --amendments
     "<a>;<b>;..."`. This attaches `{verdict, amendments, reconciledAt}` to the paused
     epic's link to the detour in `.conductor/state.json` (creating a `may-invalidate`
     link if one doesn't already exist), so the judgment survives past this
     conversation instead of only ever living in the transcript.
   - **Hard backstop (on by default):** a PreToolUse hook mechanically blocks
     `Edit`/`Write`/`NotebookEdit` while `reconcileNeeded` is still true on the active epic —
     this is unconditional, regardless of the repo's `gateGuard` setting; see `/pm:gate-guard`.
4. **Write a one-line Honcho memory.** With a reconcile gate armed, `pop-detour` deliberately
   emitted none — `resumed X, reconciled vs Y` is not true until step 3's verdict exists. Get the
   exact ready-to-copy string (and log it) via:
   ```bash
   node "$ENGINE" honcho-memory pop <parent-epic-id> "<detour-id>; reconcile = valid | amended …"
   ```
   This prints `resumed <parent>, reconciled vs <detour-id>; reconcile = valid | amended …`
   and appends a timestamped copy to `.conductor/honcho-memories.log`. Paste the printed line
   into your actual Honcho MCP memory/conclusion tool call.
5. Render. State the exact next story to build.

## Reporting — pm owns what is recorded and what is said; you own how you say it

A plugin must not have a house style that outranks the user's. Users configure verbosity and
format deliberately, once, globally, and user instructions outrank a plugin's preferences. But
pm's shapes are not uniformly cosmetic, so "defer to the user" applied flat would delete
obligations — the same failure pointed the other way. The line is **content vs container**.

A user configures theirs in one of two places, and pm honours both: an **output style**, or a
**communication contract** written into their CLAUDE.md.

| Band | Examples | Bends to the user's output style / communication contract? |
|---|---|---|
| **Recorded** | `--outcome`/`--reason`, `--no-deferrals`, gate verdicts, `--attribute-commit`, `--notify`, `record-reconcile`, `record-cross-spec-review` | **No** — these are writes to `.conductor/state.json`, not sentences |
| **Parsed** | `hierarchy-child-executor`'s `STATUS/DONE/DECISIONS/CONCERNS`; `merge-conflict-resolver`'s `STATUS/FILES/RESOLUTION_SUMMARY/CONCERNS`; `reconciler`'s `VERDICT/AMENDMENTS/NOTES` | **No** — a wire format between agents. The prose INSIDE a field is ordinary writing and does |
| **Narrated** | the consolidated end-of-hierarchy report, the end-of-epic autonomy report, the preflight question batch, gate summaries, `/pm:status` narration, `/pm:next`'s recommendation | **Yes** — this is presentation, and it follows the user |

Everything in the **Narrated** row renders in the user's shape when they have one. pm's own
headings are a default for a user who has configured none — never a style that outranks one, and
two competing formats in one session is the defect.

**Scope.** This governs how you REPORT, never what the rest of this skill instructs you to DO. A
brevity contract shortens prose; it does not authorise skipping a required task item, a gate, or
a recorded disposition.

**Map the content into their shape; never drop it to fit.** Reshaping is always allowed, omitting
never. Where the user's shape has no slot for something pm requires — the `notifications[]`
read-back, the explicit *"are you OK with these?"* checkpoint, the deferral list, a blocked child,
a `CONCERNS` line worth flagging — add a slot rather than drop the element.

**Why the Parsed band cannot bend.** The orchestrator branches on `STATUS` to decide whether to
start the next batch, escalates on `STATUS: uncertain`, and transcribes `VERDICT` straight into
`record-reconcile`, whose value space the engine enforces one hop later. A reshaped field name is
a report nobody reads back.

**CLAUDE.md is the only channel that reaches a subagent.** A subagent inherits every level of the
CLAUDE.md hierarchy the main conversation loads, `~/.claude/CLAUDE.md` included; an **output style
applies to the main conversation only** and does not reach one. So a user's contract that lives
only in an output style never arrives at a `hierarchy-child-executor` or the `reconciler` — carry
it into the dispatch prompt yourself, or the child cannot honour a preference it was never given.

## Delegate discovery — your context is the scarce resource

**If you do not already know the file path, do not go looking yourself.** A subagent's transcript
never enters yours; only its final report does. So an open-ended read costs you a conclusion
instead of a transcript the moment it is delegated — a structural saving, independent of any
output-style or verbosity setting.

| The question | Where it goes |
|---|---|
| "where is X handled", "does a spec for this already exist", "what does this epic touch", "what did the last three changes here do" | an `Explore` or `general-purpose` subagent; use its conclusion |
| "what is on line 40 of the file I am editing", "what does this epic's `lane` say" | read it inline — you already know the path |

**This binds YOU, the orchestrating agent.** It is the half with no such rule today: a dispatched
`hierarchy-child-executor` is already told to return a fixed report and not to narrate its
process, and pm already delegates review, execution and conflict resolution. Discovery was the one
category left inline. It binds hardest across a hierarchy run or a multi-epic backlog, where your
context survives many epics and is therefore the scarce resource — discovery you perform inline is
paid for once per epic and never reclaimed.

**Delegating never weakens a full-read requirement.** Two places below demand the WHOLE document —
the epic-level-autonomy preflight scan, and re-reading an epic's source before it becomes the
work. Delegating those means the subagent reads the whole document and returns the finding. What
is forbidden is substituting a keyword grep for a full read, and that is forbidden whoever
performs it.

## Choosing what's next

Resume the **top of the detour stack** first if non-empty. Otherwise the highest-priority
`queued` epic (P0→P3). Surface ties to the user.

**Read `## Dependency warnings` in PROJECT.md first** (and the brief's `DEPENDENCY WARNINGS`
block — same lines). An epic named on the left of one of those lines is not workable, whatever
its priority: name the dependency, state its status and effective priority, and put the choice
to the user — *pull the dependency forward, or descope the epic waiting on it*. That is the
whole value; the alternative is a stall nothing asks about. A `blocked` epic with no
`depends-on` link is reported there too, because `blocked` otherwise records nothing about what
it waits on.

## Keeping the index honest (non-blocking enforcement)

- After completing stories: tick `tasks.md` checkboxes (OpenSpec), then render.
- After a commit: the PostToolUse hook reminds you — update `state.json` status, it
  re-renders automatically.
- Set the active epic with `set-active <id>` (never hand-edit the `.active` pointer); it also
  keeps `status: "active"` in sync and demotes any prior active epic. `clear-active` drops it.
- On PUSH/POP/priority change: edit `state.json` (or use the verbs above), then render.
- New proposal outside this flow? `/pm:sync` registers it as `untriaged`; then triage.
- Archived an OpenSpec change? The conductor self-heals — `sync`/`commit-nudge` clear the
  `active` pointer and stamp `archived` automatically (OpenSpec's date-prefixed archive dirs are
  detected), so `/pm:next` advances without hand-editing `state.json`.
- `state.json` always wins over `PROJECT.md` — just re-render.
- Want to know what the index is HIDING? `integrity` — a read-only audit reporting records that
  cannot be true (an archived epic with nothing ticked, one change under two lanes, a verdict
  that does not reach the commits it cites, an archive directory with no epic). It reports every
  check with its count including zeros, writes no state, blocks nothing and repairs nothing: each
  finding's remediation is a command you run.
- Want to know which DESIGN DOCUMENTS have no epics? `verify-specs` — a read-only inventory of
  every `.md` under a spec root (default `docs/superpowers/specs/`, `--root` to point elsewhere)
  with the epics claiming each, plus the epics naming a document that is not on disk. Uncovered
  is INVENTORY, not a finding: a note or an abandoned sketch legitimately has no epic, so it
  never speaks up on its own — you run it. Where a document does imply unregistered work, author
  an `add-many` batch whose entries each carry its `specPath`.
- Working alongside ANOTHER SESSION, or dispatching into a sibling repo's conductor? `claim <id>
  --session <name>` records who owns an epic and until when; `unclaim <id> --session <name>`
  hands it back (named `unclaim` because `release` already means a version here); `owners` reports
  who holds what and how stale, and is behaviourally verified read-only so you can point it at a
  repo you do not own. `claim --repo` sets a repo-level "I am mid-operation here" marker in a
  git-ignored sidecar — release it when you are done touching the CONDUCTOR, which is strictly
  later than when the work is done, because a review routinely files follow-up stories.
  **It is advisory.** `claim`/`unclaim` are the only verbs that refuse because of a claim;
  everything else writes to a claimed epic exactly as before. A claim expires on its own stated
  TTL, so a session that died mid-epic shows as STALE rather than owning the work forever, and
  `integrity`'s `advisory-claim-shape` check reports one without being asked.
- Want to know HOW this project got here, not just where it is? `set-activity-log on` starts an
  append-only record of conductor state transitions, and `activity` reads it back — time an epic
  waited before it went active, detour frequency, lane choices and re-routes, gate verdicts in
  sequence, and **out-of-band writes**: `state.json` revisions no engine verb accounts for, which
  is what a hand-edit looks like from the record's side. Off by default; it records nothing
  retroactively, so turning it on says nothing about yesterday. `purge-logs` is the manual
  cleanup — it removes nothing without a selector, and nothing without `--yes`.

These rules are also installed into the project's `CLAUDE.md` by `/pm:init` — or `AGENTS.md`
(or `HERMES.md`-chain equivalent) on a repo running a declared non-Claude-Code `--platform` —
and re-injected by the SessionStart hook (so they survive compaction). Two artifacts back them up: every
commit made while a detour is active is auto-logged to `.conductor/detours.log` by the hook
(deterministic), and minimal detours are logged there by `log-detour` (rule-driven).

Two commits are deliberately NOT logged, so the trail describes the detour rather than itself
(#81). A commit touching ONLY pm's own generated output — `state.json`, `PROJECT.md`,
`render-stamp.json`, `commit-watch.json` — is bookkeeping, not detour work; and a commit whose
SHA already has a row of that kind is never given a second one. `MINIMAL` rows are exempt from
that de-duplication: they record what you DECLARED, not what git observed, so two minimal detours
between one pair of commits are two real entries.

## Intake — triage an ask BEFORE it becomes an epic

The conductor has always ACCEPTED work; it has not TRIAGED it. `add-epic` validates the id, the
lane and the priority, refuses a duplicate `externalId`, and appends — that is the entire
admission process, and its dedup is **identity-based**: same id, or the same `externalUrl`. That
catches a re-run of `/pm:sync` and nothing else. It cannot see that the same ask has already been
registered under a different name.

The ask is the ONLY moment the whole backlog is cheap to consider. After registration nothing
ever re-reads it as a set. *Measured in `pm`'s own repository: `integrity`'s
`change-registered-under-two-lanes` reports four live pairs that are one change registered twice
under different lanes and different names — identity dedup found none of them.*

**1. Get the candidate set mechanically.**

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" triage "<the ask, in its own words>" [--limit N]
```

Read-only. Returns JSON: `candidates` (existing epics sharing distinctive vocabulary, each with
the `shared` tokens that put it there and a `superseded` flag), `lane` (this repo's `suggest-lane`
answer, carried along so intake is one call), `backlog` (counts by status + the active epic), and
`verdict: null`.

**2. READ the candidates.** Not the scores — the epics. Vocabulary the whole backlog uses counts
for almost nothing in the ranking and rare vocabulary counts for a lot, so the list is short and
worth opening. A high score with unrelated intent is a miss; a low score on an epic whose
description turns out to cover the ask is a hit.

**`verdict` is always `null`, and that is the design.** `pm` is an instruction layer. The engine
computes what is WORTH READING and never decides:

| Mechanical — the engine's | Judgment — yours |
|---|---|
| which epics share distinctive vocabulary | whether one of them is **the same ask** |
| which lane the repo's routing picks | whether that lane is right here |
| what the backlog looks like as a set | where this sits against what is in flight |
| which candidates are already superseded | consolidate, decline, or register |

**3. Record the relationship** rather than leaving it in the conversation —
`--link "relates-to:<id>:<why>"`, or `--link "supersedes:<id>:<why>"` plus
`update-epic <old> --status archived --outcome superseded --reason "replaced by <new>"
--no-deferrals`. A consolidation that leaves both epics open has consolidated nothing, and a
candidate already flagged `superseded: true` is dead — never consolidate into it.

**4. Decide the lane; do not inherit it.** `triage` already ran `suggest-lane` for you, and its
answer reads THE ASK — the words, the size, this repo's `laneRouting` overrides — and nothing
else. It cannot ask what a person would ask, whether this work SERVES something already committed
to, because pm holds no milestone or product context to weigh and the engine will not invent one.
The suggestion is an input; the lane is your call.

**The tie-break is asymmetric**, and it is not a matter of taste. `claude-code` means no spec, no
plan, no gate and no stories — right for a genuine sub-2-hour tweak, and the reason a misrouted
epic leaves no record of what it was FOR. Over-processing costs hours; under-processing costs the
record permanently, and nothing later can reconstruct it. So an unresolved routing question
resolves AWAY from `claude-code`, never into it. Whenever you register in a lane other than the
one routing suggested, say why on the epic:

```bash
update-epic <id> --notes "lane: <chosen> not <routed> — <why>"
```

The tracker-sync procedures already demand that line. It binds every path that registers an epic —
manual `epic add`, a roadmap read in-session, and intake — not only the mirrored ones. *Measured
in `pm`'s own repository: 83% of epics sat in `claude-code`, 51 of them already archived, none
carrying an artifact link.*

**What is NOT solved.** Weighing an ask against a milestone the project committed to needs a
product layer pm does not have. This step makes the decision deliberate and its departures
recorded; it does not make the routing itself smarter. Tracked as
[#114](https://github.com/cfdude/pm/issues/114).

**5. Say no out loud when the answer is no.** Not every ask should be taken on. Declining by
never registering it destroys the record that anybody considered it — the same objection that
made every other ending recordable. Register it, then:

```bash
update-epic <id> --status archived --outcome declined --reason "<why not>" --no-deferrals
```

Two commands deliberately: creating an epic directly at `--status archived` stamps an ENGINE
record carrying no reason, which is exactly the silence this step exists to remove. `declined` is
a terminal **outcome**, not a status — `archived` already means terminal, so no status-driven
behavior changes. It requires a reason like every non-`delivered` outcome, and because it is not
`delivered` the archive gate's Gate 2 demand and handoff demand both pass it by (no code was
written, so there is nothing to review and nothing to hand over).

Triage and the tracker-sync `externalUrl` check are **not substitutes for each other**: the URL
match answers *"have I already mirrored THIS item"*, triage answers *"is this ask already in the
backlog under another name"*. Run both.

## Importing an existing roadmap

If you have a roadmap doc (any markdown), register each item interactively — the conductor
does **not** parse roadmap files automatically.

1. Read the roadmap file; list the items for the user to confirm.
2. For each item: `/pm:epic add --id <slug> --title "…" --lane <lane> --priority P2 --status planned`
   - Choose lane: `openspec` | `superpowers` | `claude-code` | `decision` | `external`
3. `planned` items appear in PROJECT.md but are excluded from NEXT UP and lanes rollup. They are
   still NAMED: a `planned` epic something queued `depends-on` carries the dependent's effective
   priority and is called out under `## Dependency warnings`. Not scheduled and not nameable are
   different claims — promoting it to `queued` stays a decision you make.
4. When you create an OpenSpec change for a `planned` epic and run `/pm:sync`, it
   auto-transitions to `untriaged` and enters the normal triage flow.
5. Triage the backlog: set priorities, promote items to `queued` as work becomes ready.

`/pm:epic add` validates `--status` — unknown values are rejected with a clear error.

## Lane routing overrides (per-repo)

The lane heuristic above (`>8h`/cross-system → openspec; `2-8h` single-subsystem →
superpowers; `<2h` tweak → claude-code; procurement/product → decision; other-repo →
external) is generic and usually right, but some repos have a standing local rule that
overrides it — e.g. "anything touching billing always goes through openspec regardless of
size" or "anything titled hotfix skips design and goes straight to claude-code." Rather than
carve that rule into CLAUDE.md prose (which nothing checks), record it as real per-repo
config: `laneRouting.overrides` in `.conductor/state.json`, set via `set-lane-routing` and
looked up via `suggest-lane` (see `commands/lane-routing.md` for full syntax).

**When assigning a lane to a new epic** (at `/pm:epic add`, at `/pm:sync`, at hierarchy
planning), consult overrides FIRST, before applying the generic heuristic:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" suggest-lane "<epic title/description>"
```

- `{"lane":"<lane>","matched":"<rule>"}` — an override matched; use `<lane>`, and note which
  rule matched if you're reporting the decision.
- `{"lane":null,"matched":null}` — no override configured or none matched; fall back to the
  generic heuristic as documented above.

This is purely local, additive config — like `set-tracker`, the engine does not enforce
lanes on its own (`add-epic` always still takes an explicit `--lane`); `suggest-lane` only
surfaces the match for you to act on.

## Epic-level autonomy — the preflight scan

An epic can be granted broad execution trust so it runs through phase transitions and
destructive actions without a human present for each one — but ONLY after a preflight scan, and
autonomy never removes a genuine safety stop. This section defines the scan; the decision rule
and reporting obligations that consume its output are in the rules block re-injected into
CLAUDE.md (see `/pm:epic` → `set-autonomy`).

**When:** before setting any epic's `autonomy.level` to `"autonomous"` (see `set-autonomy` below).

**How to scan an epic (`epicId`):**

1. Read that epic's FULL source, not a summary — whichever is its lane's real progress source:
   - `openspec` lane: `openspec/changes/<epicId>/{proposal,design,tasks}.md` and everything under
     its `specs/` directory.
   - `superpowers` lane: the file at the epic's `planPath`.
   - `claude-code` lane: the epic's inline `stories[]` in `.conductor/state.json`.
   - `external`/tracker-linked: see the tracker-specific addendum below — pull the tracker issue
     first, it IS the source.
2. Reason over the WHOLE document — do not keyword-grep for "DROP"/"migration"/"rm". A shallow
   scan is worse than no scan: it creates false confidence and lets a real risk slip through
   silently. Full read is the only approach approved for this primitive (see the design doc's
   "Approaches considered" table for why keyword-triggered scanning was rejected).
3. Produce exactly two sections:
   - **Destructive-risk points** — anything that changes/deletes/migrates existing data or state
     in a way that could be hard to undo. For each: what it is, why it's risky, and whether a
     backup/restore path is obvious from the plan or not.
   - **Genuine unknowns** — real ambiguities or missing decisions that should NOT just be
     guessed on — things needing explicit human approval or clarification before this epic could
     run start-to-finish unattended.
   - **Session-continuity impact** — if the epic makes any live change to external
     infrastructure (branch protection rules, credential/token rotation, webhook/API config,
     required reviewers, etc.), the preflight questions batch presented to the user MUST include
     a standing question: "will this change affect how the orchestrator itself operates for the
     rest of the current session (or any future session)?" This is not optional padding — it is
     what would have caught the real incident where `branch-protection-and-pr-workflow` applied
     live branch-protection settings to `main` and the orchestrator's very next
     `git push origin main` was rejected, discovered only empirically because neither the
     preflight scan nor the executor's completion report had flagged it. The
     `hierarchy-child-executor` agent enforces the matching check at report time — see its
     "Required check: session-continuity impact on the orchestrator" section.
   - **Documentation currency** — `SKILL.md` and `README.md` drift from the real dispatch table
     independently (two separate tests in `scripts/test/*.test.mjs` check each one; passing
     one does not mean the other is current). Any child epic that adds/changes a user-facing
     command, flag, or behavior must update `README.md`, not just `SKILL.md` — this bit the
     project once already (`record-gate-review` shipped with no README mention). See
     `hierarchy-child-executor`'s "Required: check README.md, not just SKILL.md" section.
4. Keep it SHORT and high-signal. If there is nothing destructive, say so plainly. If there is
   no genuine unknown, say so plainly. Padding the output with non-issues defeats the entire
   point — it is exactly what turns autonomous execution into a wall of blockers.
5. Present the findings as ONE batch of questions to the user, before execution starts. Record
   the answers with `set-autonomy <epicId> --preauthorize "<action>:<reason>"` (repeatable, one
   per approved item) and `--context "<note>"` (repeatable, one per piece of background supplied)
   — then, only once recorded, `set-autonomy <epicId> --level autonomous`.

   For a whole class of routine, low-risk actions the epic will repeat many times (creating
   scratch files, calling a local dev API, etc.), enumerating each exact action string is
   needless overhead. Use the category shorthand instead:
   `set-autonomy <epicId> --preauthorize "category:<name>:<reason>"`, where `<name>` is one of
   the default taxonomy below. This is stored as a distinct grant shape
   (`{ category, reason, grantedAt }`, no `action` field) alongside exact-action grants
   (`{ action, reason, grantedAt }`) in the same `preAuthorized[]` array — `set-autonomy`
   rejects any category outside this list, so a typo fails loudly instead of silently granting
   nothing.

   **Default category taxonomy and matching heuristic** (this is inherently approximate —
   treat it as a coarse filter, not a precise classifier; when in doubt about whether an
   action falls under a granted category, don't guess, fall through to the decision rule's
   exact-match / genuine-unknown handling instead):
   - `filesystem` — matches an action description whose text is dominated by file/directory
     verbs: create, delete, move, rename, write, copy — applied to a file or directory (not a
     database row, not a remote resource).
   - `network` — matches an action description whose text names an HTTP request, an API call,
     or a socket/connection operation.
   - `schema` — matches an action description whose text names a change to `.conductor/state.json`'s
     own schema (adding/removing/renaming a field, a migration) — NOT changes to epic content
     within the existing schema.
   - `external-api` — matches an action description whose text names a call to a specific
     named third-party service (Jira, GitHub, Linear, Slack, a payment processor, etc.), as
     opposed to a generic `network` call to code you own.
   - This taxonomy is fixed at four categories by default; a project needing a different
     taxonomy should say so explicitly during the preflight scan rather than silently
     inventing new category names (`set-autonomy` will reject anything not in this list).

This same read-and-scan process is the one reused, unchanged, by any future work that needs to
scan several epics at once (e.g. a parent epic's children) — it takes one epic id at a time
regardless of caller.

## Epic-hierarchy orchestration

Runs a whole parent epic's children unattended — batched by priority and dependency, each
dispatched as a fresh subagent. Builds on epic-level autonomy above; read that section first if
you haven't. No new persistent state: everything below is recomputed fresh from `parent`,
`priority`, `links`, and each child's `autonomy` block every time.

**When:** the user wants to run an entire hierarchy (a parent epic + its children) unattended,
not just one epic.

**The process:**

1. **Preflight EVERY child up front, not one at a time — and DISPATCH each scan rather than
   running it in your own context.** The preflight is a full read of each child's entire source
   (proposal + design + tasks + every spec, or the whole plan), so running it inline for N
   children spends N full documents of your context before the first child is dispatched, and
   never gets it back. Send one subagent per child, ask it for the preflight scan's sections
   against that child's full source, and consolidate what comes back. The full-read requirement
   is unchanged — it is about depth, not about who performs it; a keyword grep is no more
   acceptable from a subagent than from you. Consolidate all findings into ONE batch of
   questions presented to the user — across the whole hierarchy, not per-child. Record answers
   per child exactly as epic-level autonomy already works: `set-autonomy <child-id>
   --preauthorize "<action>:<reason>"` / `--context "<note>"`, then `set-autonomy <child-id>
   --level autonomous` once a child is cleared.
2. **Get the execution plan:** `node "$ENGINE" plan-hierarchy --parent <id>`. This prints
   `{ parent, batches: [{ batch, epics: [{ id, priority, autonomous, dependsOn }] }] }` —
   `dependsOn` is each epic's list of sibling ids (within this hierarchy) it depends on. If any epic in the
   plan shows `autonomous: false`, that child wasn't cleared in step 1 — resolve that before
   dispatching it (do not dispatch a non-autonomous child; it will immediately hit decision-rule
   item (d), "no context to act on").
   - If `plan-hierarchy` exits non-zero naming a dependency cycle, that's a real data problem
     (two children `depends-on` each other) — fix the `links` before re-running, don't retry
     blindly.
3. **Dispatch batch by batch, in order, each child isolated in its own git worktree.** For each
   batch: create a worktree + branch `hierarchy-child/<epic-id>` per epic in that batch (per
   `superpowers:using-git-worktrees`), then dispatch one `agents/hierarchy-child-executor` per
   epic, working inside its own worktree — **in parallel** (multiple dispatches in the same turn)
   when the batch has more than one epic, since batch membership already means they have no
   dependency on each other. Do **not** start the next batch until every dispatch in the current
   batch has reported back AND its worktree has merged (see below).
   - **Children never write `.conductor/state.json` themselves** — they only return their fixed
     report. You (the orchestrator) are the sole writer of state transitions, applied in one pass
     after the batch (mark each merged child `archived`), not interleaved with dispatch. This is
     what makes parallel dispatch safe for the state file specifically: there's only ever one
     writer, so there's nothing to merge-conflict on `state.json` itself.
   - **Same sole-writer pattern applies to `CHANGELOG.md`.** A child does NOT edit
     `CHANGELOG.md`'s shared `## [Unreleased]` section directly — every parallel batch that tried
     guaranteed a merge conflict there (100% collision rate across the first two dogfood batches:
     N children editing the same header every time). Instead each child writes its changelog
     entry to its own fragment file, `.changesets/<epic-id>.md`, in the same bullet format
     `CHANGELOG.md` entries already use (a bold one-line summary, then wrapped prose). Fragments
     never conflict with each other because each child touches only its own file. You (the
     orchestrator) remain the sole writer of `CHANGELOG.md` and consolidate fragments at release
     time only — see step 4.
   - **Merge each child's worktree branch back sequentially**, one at a time, even though the
     *work* happened in parallel. On an ordinary merge conflict (two children's code genuinely
     touched overlapping lines): this is NOT a stop condition — it's decision-rule item (c)
     (destructive but restorable; git history means it's always recoverable), never item (b).
     Resolve it via this ladder, in order: (1) attempt the merge normally; (2) on conflict,
     dispatch `agents/merge-conflict-resolver` to read both sides + the merge base and resolve it;
     (3) if that agent reports `STATUS: uncertain`, escalate — retry with a more capable model
     (e.g. Opus) and/or consult the `advisor()` tool for a second opinion before finalizing; (4) if
     still genuinely unresolvable, commit the best-effort resolution anyway (still recoverable via
     git history) and **log a new follow-up epic under the same parent** describing the residual
     issue, then continue. Never tell the human "we can't merge this, you handle it" for an
     ordinary code conflict — that outcome is explicitly designed out.
   - **🚨 MANDATORY POST-RESOLUTION VERIFICATION — applies after ANY conflict resolution on this
     ladder, regardless of which rung resolved it (self-resolved by you the orchestrator, or via
     `merge-conflict-resolver`, or via an escalated model/`advisor()` opinion), BEFORE committing
     the merge:**
     1. **Grep every touched file for leftover conflict markers** — `<<<<<<<`, `=======`,
        `>>>>>>>`. Any hit, anywhere, on either an opening or closing marker, means the file is
        **still unresolved** — go back and fix it. Do not assume "I removed the closing markers"
        implies the opening marker is also gone; check both explicitly.
     2. **For every touched `.mjs`/`.js` file, run `node -c <file>`.** A syntax error means the
        file is **still unresolved** — go back and fix it.
     3. Only commit the merge once both checks pass clean on every touched file. Neither check
        is optional and neither substitutes for the other (a file can pass the syntax check while
        still containing a marker inside a comment or string, and vice versa for non-JS files).
     - **Why this exists:** during this repo's own 0.14.0 dogfood run, a conflict resolution
       removed only the *closing* conflict markers and left the opening `<<<<<<< HEAD` marker in
       place in a committed file. There was no required step that would have caught this — it was
       only caught by chance, via a manual re-grep after the fact. This verification step exists
       so that catch is never left to chance again.
   - Once a child's branch has merged (cleanly or via the ladder above), remove its worktree and
     delete its branch immediately — never leave it dangling. `node "$ENGINE" verify-worktrees`
     cross-references `git worktree list` against epic status and flags any `hierarchy-child/*`
     worktree whose epic is already archived but wasn't cleaned up; run it after a batch if you're
     ever unsure everything was torn down correctly.
   - A dispatch reporting `STATUS: blocked` — check every later epic's `dependsOn` list
     (transitively, since a dependency chain can be more than one hop) for the blocked child's
     id; do not advance any batch containing an epic that depends on it, directly or
     transitively. Batches with no such dependency may still proceed. Flag the blocked child for
     the human in the end-of-hierarchy report; do not auto-retry it.
   - A dispatch reporting `STATUS: stopped-for-genuine-unknown` — this is decision-rule item (d)
     firing correctly, not a bug. Surface it to the human now, same as a single-epic stop would.
4. **After all batches, write ONE consolidated end-of-hierarchy report:** what was asked (the
   step-1 preflight batch), what was done (fold in every dispatch's `DONE`), every `DECISIONS`
   entry across the whole hierarchy, any follow-up epics logged from unresolvable merge conflicts,
   and an explicit **controversial** flag on anything from `CONCERNS` or a WARN-class decision —
   these may affect other backlog items, which is exactly the seed a future portfolio-consistency
   pass would need. The parent epic's own status is **never auto-archived** by this process —
   that stays a human call, same as epic-level autonomy never auto-closes an epic either.
   - **Release step — consolidate `.changesets/*.md` into `CHANGELOG.md`.** Run
     `node "$ENGINE" changesets` to list pending fragments (`{ changesets: [{ id, path, body }] }`,
     sorted by epic id). Fold each fragment's `body` into `CHANGELOG.md`'s `[Unreleased]` section
     (or a new version section, if this is a release), then delete the consumed fragment files
     (`.changesets/<id>.md`) — you are the sole writer of `CHANGELOG.md`, so there is nothing to
     merge-conflict here even though the fragments were written by parallel children. This is a
     manual `cat`-and-edit step, not automated by the engine; `changesets` only makes the fragment
     set visible and machine-readable so the step is mechanical rather than a guess.

## Further reference — two channels, and only one of them can lie

**What THIS engine accepts: ask the engine.** `node "$ENGINE" <verb> --help` prints that verb's
real flag surface — every flag, which ones take no value, which ones repeat — projected from the
same registry rows the unknown-flag guards read. It is therefore version-exact by construction and
cannot advertise a flag your engine refuses. Reach for it BEFORE reading engine source, and before
guessing a flag name. A verb that takes no flags says so explicitly.

**Procedure, concepts and rationale: the docs.** This skill and `README.md` cover the recurring
essentials. For more — a command's full docs, a guide, a concept page —
`https://pm-plugin.dev/llms.txt` is a lightweight, AI-agent-oriented index of every doc page
(~9KB), and its entries are already markdown URLs, so no extension needs appending. A free,
no-auth MCP server at `https://pm-plugin.dev/mcp` answers the same questions in one call where it
is configured, which is cheaper than index-then-fetch.

`https://pm-plugin.dev/llms-full.txt` is the entire site as one document and is **~360KB** — tens
of thousands of tokens. Fetch it only if you genuinely need everything at once; it is not a
default, and for a single question it is strictly worse than the index or the MCP.

**The site documents the LATEST release.** A flag the docs show that your engine refuses is a
version gap, not a bug — `/pm:changelog` says what your repo is missing.

## state.json reference

```
active        : "<epic-id>" | null
pmVersion     : "<semver>" — release that last touched this repo (set by init/upgrade)
tracker?      : { system, instance?, projectKey?, mechanism?, repo?, statusIntent? }  — optional;
                opt-in. `repo` (`owner/name`) is used by the `github-issues` inward-pull shape.
reviewMode?   : "off" | "standard" | "thorough" — repo-level dial (default "standard" if unset)
gateGuard?    : boolean — repo-level PreToolUse guard toggle; does NOT gate the reconcile-owed
                check (that blocks unconditionally whenever reconcileNeeded is true). What it
                does gate is the TRACKER REFRESH check, which blocks only while it is on.
                Absent means off. Read it back with a bare `set-gate-guard`, which also reports
                whether anything is blocked right now: `on` alone never means something is,
                since the guard also needs a live active epic owing one of those two things
laneRouting?  : { overrides: [{ match, lane }] } — optional per-repo lane overrides, checked
                before the generic lane heuristic (see "Lane routing overrides" above);
                set via set-lane-routing, looked up via suggest-lane
epics[]       : { id, title, priority, status, role, lane, parent?, externalId?, externalUrl?, planPath?, stories[]?, links[], reconcileNeeded?, autonomy?, gateReview? }
gateReview?   : { gate1?: {verdict, reviewedAt, baseSha?, headSha?, reviewer?, note?}, gate2?: same } —
                ANY lane; verdict ∈ pass|fail; set via record-gate-review, which requires both
                shas for a `pass` (a legacy `note` is the pre-fields shape, kept unparsed).
                Recording is lane-agnostic; the archive gate is not — `update-epic --status
                archived` requires gate2.verdict === "pass" on an openspec-lane epic ONLY
autonomy?     : { level: "off"|"autonomous", preAuthorized[], context[], notifications[] } — per epic
preAuthorized[] entries are either { action, reason?, grantedAt } (exact-action grant) or
  { category, reason?, grantedAt } (category-shorthand grant, category one of
  filesystem|network|schema|external-api) — never both on the same entry
detourStack[] : { pausedEpic, pausedAt, reason, spawnedDetour, reconcileOnResume }
status   ∈ active | paused | queued | later | blocked | archived | untriaged | planned
role     ∈ epic | detour
lane     ∈ openspec | superpowers | claude-code | decision | external   (default: openspec)
priority ∈ P0 | P1 | P2 | P3 | P?   — MERIT priority, the only one stored
rank?         : manual placement WITHIN one priority band, dense 1..N. Written ONLY by
                `reorder <id> <id> …` (which takes the whole band and refuses a partial one);
                cleared by `update-epic --priority` on a real band change. Absent is legal and
                sorts after every ranked epic. LAST sort key: dependencies → priority → rank.
parent        : id of another epic — single-parent tree (validated: exists, no self/cycle)
externalId/externalUrl : link to a tracker issue (system comes from the tracker block)
tracker.statusIntent   : { <conductor-status>: "<semantic target>" } — NOT a literal transition
link.type ∈ depends-on | supersedes | may-invalidate | relates-to | blocks | resolves-blocker-for
               (the CLOSED vocabulary — `KNOWN_LINK_TYPES` in lib/constants.mjs; anything else
                is refused at write time)
               (`supersedes` = this epic REPLACES that one — recorded at intake when triage
                finds the same ask already registered; end the superseded epic with
                `--outcome superseded` in the same breath, or the consolidation is only half done)
planPath      : repo-relative path to a markdown plan (progress source for superpowers lane,
                and the epic↔plan ASSOCIATION `sync` dedups on — a plan some epic claims is
                never registered a second time, whatever the epic's id, lane or status)
specPath      : repo-relative path to the DESIGN DOCUMENT this epic's work was drawn from
                (`--spec`, on add-epic/update-epic/add-many). Provenance only — no progress is
                read from it and no scan registers epics from it — and MANY-TO-ONE by design:
                a design too large for one plan yields N epics all naming the same document.
                `verify-specs` reports the coverage that association makes answerable.
syncIgnore[]  : [{ path, at, removedEpic?, reason? }] — source artifacts `sync` must not
                register. Written by the removal verb so a removal survives the next sync;
                cleared by attaching that artifact to an epic (`update-epic --plan <path>`,
                or `--spec` for a design document — the message names the right flag).
                `removedEpic` is HISTORICAL and dangles by construction — never swept, never
                reported as a dangling reference. Absent means empty; no migration.
stories[]     : [{ title, done, disposition? }] — inline progress (highest-priority source).
                `disposition` = { state: "wont-do", reason, recordedAt } — the THIRD state a
                checklist needs: not open, not completed, deliberately not being done. The row
                and its reason always survive (deletion would destroy the record that the work
                was ever projected); a disposed story leaves BOTH sides of the ratio, exactly as
                a `<!-- pm:lifecycle -->` task does, so it renders `3/3 stories · 2 disposed`.
                Write it with `update-epic <id> --story <n> --wont-do "<reason>"`; the reason is
                required and a recorded disposition is never silently replaced.
```
