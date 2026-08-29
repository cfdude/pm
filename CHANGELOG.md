# Changelog

All notable changes to the `pm` plugin are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

## [0.34.0] — 2026-08-29

### Added

- **Link types are a closed vocabulary now** (#100). `--link "<type>:<epic>[:<reason>]"` validated
  the epic half and not the type half, so `depends_on` or `realtes-to` was stored silently, ignored
  by every consumer forever, and then copied as precedent by the next agent reading `state.json`.
  `KNOWN_LINK_TYPES` is declared in `lib/links.mjs` in three honest bands — types the engine
  **reads** (`depends-on` orders the queue, `supersedes` drives triage and integrity), protocol
  state it **writes** (`may-invalidate`), and **annotation only** (`relates-to`, `blocks`,
  `resolves-blocker-for`) — and an unknown type is refused at every write path (`add-epic`,
  `update-epic`, and an `add-many` batch's `links` array) with a message naming the whole set and
  the way out. `update-epic`'s usage line, `README.md` and `/pm:epic` now publish the vocabulary
  rather than only the syntax.
- **`integrity` reports a stored link whose type nothing knows** — `link-of-unknown-type`. Records
  written before the vocabulary existed still load and still render; validation is on WRITE only,
  so an old state file can never become unloadable. Nothing is rewritten: `resolves-blocker-for`
  is deliberately not an alias for `depends-on` (the detour protocol puts it on the detour naming
  the parent, so the equivalent dependency edge points the other way, and a "repair" would invert
  a queue-ordering edge).
- **The detour stack says how long a pause has run and how often it has recurred** (#94). The
  brief's existing DETOUR STACK block now carries `paused 11d · 3rd deferral of this epic (detours
  recorded: …)`, and `honcho-memory push` discloses the same on stderr at the point of deferral.
  Derived from the record (`may-invalidate` links plus live frames), not a stored counter.

- **The `lessons` skill and the `lesson-advice` PreToolUse advisor** (#132). A project's process
  knowledge is only consulted by someone who already suspects there is something to know — which
  is the same recall dependency this repo measured at roughly 20% effective (14/14 for a rule
  carried by a required task, 3/15 for the same rule as a prose bullet). The advisor is the mode
  that needs no recall: it matches the pending tool call against every `docs/lessons/*.md` entry
  declaring a `detect:` matcher in its frontmatter and injects that lesson's `rule` **before** the
  mistake. Registered in `hooks/hooks.json` as its own `PreToolUse` entry — separate from the gate
  guard, and with a wider `Bash|Edit|Write|NotebookEdit` matcher, because half the matchable
  lessons match on a *command*. **Advisory only: it never blocks and always exits 0.** Dormant
  until `/pm:init`, and silent in any project with no `docs/lessons/`.

  *Precision is the constraint, not coverage.* A lesson that cannot be matched with near-certainty
  carries no `detect:` and stays retrieval-only, and only the command's **first line** is matched,
  so a heredoc body or an `echo` that merely names a command is data rather than a trigger —
  observed live here, a lesson's own text firing its own matcher twice. Adding a matcher is a
  frontmatter edit, never a code change. **pm ships the mechanism and never the corpus:** which
  lessons a repository holds, and what counts as one, stays the repo's and the agent's judgment.

- **The `dogfooding` skill** (#127) — the two directions nobody travels. A practice invented to
  get the work done becomes a registered candidate improvement *with its evidence attached*; a
  workaround invented for a tool's friction becomes a filed bug. The second direction is the one
  that gets missed, and the reason is mechanical: a workaround produces working output, so nothing
  looks broken and nothing prompts.

- **A seventh numbered required task item in the emitted gate procedure: "Route what the work
  taught you."** It names the three-way fork — a practice goes to the backlog, tooling friction
  goes to `/pm:feedback`, a process failure goes to `docs/lessons/` — because mis-routing buries
  the finding in either direction. A required task rather than a prose bullet on this repo's own
  measurement, which is what #127 asked for by name.

## [0.33.0] — 2026-08-29

### Added

- **`commit-nudge` names the attribution command at the moment the commit lands** (#129). The
  emitted gate procedure asks for `update-epic <id> --attribute-commit <sha>` *at the moment each
  commit is made*, and until now nothing checked until the archive gate read the array — by which
  time the commits were made, often across sessions, and the append-only ordering rule may already
  have been broken irrecoverably. The `PostToolUse` hook already runs on every commit and, since
  0.32.0, knows from the repository (HEAD watermark + reflog) whether one actually landed. It now
  appends the exact runnable command for the epic that commit belongs to.
  - **The epic is the DETOUR epic while a detour is live**, never the paused parent `state.active`
    still names. The id is resolved against `state.epics` rather than trusted, so
    `detourContext`'s `"-"` fallback can never produce a command that will not run.
  - **Louder exactly once.** While the epic's `attributedCommits` is still empty the clause carries
    item 4's catch-up-in-order rule, because that is the only state in which catching up is still
    available — after the first append it would leave an ancestor as the Gate 2 endpoint. After
    that it is one line. The escalation extinguishes itself off state the *agent* wrote; the hook
    keeps no epic→sha bookkeeping of its own.
  - **The exclusion travels with the command**: a commit that only moves or deletes a change's
    artifacts (the `/opsx:archive` move above all) must not be attributed. The engine states the
    rule and classifies nothing — it reads no commit message and inspects no commit's contents.
  - **Silent wherever the engine would be guessing**: no active epic (gh#91's lesson), an epic with
    no `attributedCommits` array at all (archive-backfilled — the staleness gate's one forgiven
    case), a sha that is not a sha, a commit already attributed, and every commit on the
    `unverifiable` rung, where `obs.head` can be a real sha while nothing is known to have landed.

No migration: nothing is added to, removed from, or transformed in `state.json`. The nudge reads
`attributedCommits` and writes nothing.

- **A stated contract for which verbs mutate the working tree** (#85). Reaching for `render` to
  "just look at" a sibling repo's backlog silently dirtied it, producing drift the caller then
  went to reconcile. `lib/verb-effects.mjs` now declares every dispatched verb as `read-only` or
  `mutates`, and the suite checks it two ways: COMPLETENESS against `conductor.mjs`'s own dispatch
  object read from source, so a verb added later without an entry fails rather than defaulting to
  an unstated claim; and BEHAVIOUR for every read-only verb, running it against a repo with a
  render pending and hashing the whole tree by content **and** mtime before and after. A write
  added to a verb that used to be safe now fails CI rather than someone else's checkout. Want the
  current state without touching anything: `brief`, not `render`.

  Two things the measurement corrected. `render` no longer dirties the tree on *every* call —
  the `PROJECT.md`-is-never-clean fix made both of its writes content-conditional — but it is
  still declared `mutates`, because idempotent-when-nothing-changed is not read-only. And a
  `--read-only` enforcement flag is declined: it would be threaded through or argv-sniffed at
  forty verbs and still asks a caller to trust it was wired up, while the CI-time check gives the
  same guarantee without shipping anything.

- **A round-trip guard for every flag `add-epic` registers** (#136). `add-epic --notes` was
  accepted, exited 0 and stored nothing; the fix shipped, but the guard that would catch the next
  flag to do it did not — the guard that existed asserted *registration*, which is the half that
  stays green through exactly this defect. The check is driven by the `EPIC_FLAGS` projection, so
  a row added later with no exercise entry is a hard failure naming the flag. It does not
  supersede the documentation-driven check for `update-epic`: the two catch opposite directions
  (registered-but-not-honoured here, documented-but-not-registered there).

### Fixed

- **`/pm:feedback` no longer assumes the `gh` CLI and a GitHub account** (#105). Both it and the
  emitted inward tracker-sync step shelled out to `gh` with the dependency stated nowhere — not
  the README, not the install instructions, not the command doc. It worked for the maintainer
  (gh installed, logged in, tracker repo their own) and for nobody else, failing with a bare
  shell error that explains nothing. `curl` is not a substitute: anonymous issue creation returns
  HTTP 401, and a PAT is strictly worse than `gh` — same account requirement, hand-managed token
  instead of the system keyring. The dependency was never on the CLI; it is on holding a GitHub
  credential at all.

  Feedback is OUTWARD, so credential-free channels exist, and it now runs three in order:
  `gh issue create` when `command -v gh` **and** `gh auth status` both pass — the preferred path
  whenever available, not merely a faster one; else a prefilled `issues/new?title=…&body=…` URL,
  which needs no token, no CLI and no account and attributes the issue to whoever actually hit
  the bug; else `bugs@pm-plugin.dev`, so declining GitHub never means losing the feedback. The
  report is written to `.conductor/feedback/` **first** on every path, so nothing is lost when a
  channel fails — and so a body over the measured ~6 KB URL ceiling (≈ 3 KB of raw markdown after
  percent-encoding) has somewhere to live rather than being silently truncated.

  The inward SYNC half is fixed differently and deliberately: listing issues is a READ and
  anonymous listing does not exist, so there is no credential-free substitute. The rules block
  now emits a preflight naming both checks and instructing the agent to STOP that section rather
  than report a clean sync it could not perform — from ONE shared constant at both the primary
  and secondary emitters, which are separate loops behind separate predicates.

- **The retry half of "retry once, then skip" is now provable** (#131). 0.26.0 specified hook
  writes as retry-once-then-skip and shipped the retry as five lines copied into two files.
  Measured on 0.32.0 before the fix: delete the retry from **both** sites and all 856 tests still
  pass — the heal is idempotent and hook-driven, so a later hook covers for the loss and the
  suite never notices. The policy is now one function (`lib/hook-write.mjs`) with `load`/`save`
  injectable, unit-tested including that the retry RE-LOADS and RE-HEALS rather than re-saving
  the stale in-hand object; plus an end-to-end test at the `render` site driven by a real conflict
  injected between `loadState()` and `saveState()` inside one invocation, through a Node preload
  that lives entirely under `scripts/test/` — no test-only branch, env var or verb ships in the
  engine. Both sites call the shared policy and a source scan forbids re-implementing it.

  Honest scope: the commit-nudge site cannot be covered end to end. `commitNudge()` calls
  `render()` two lines later and render's heal is idempotent, so from outside a single invocation
  the retry running and the retry being absent are indistinguishable — identical final state,
  identical revision, identical conflict log. That cover is the mechanism that hid the defect;
  the source scan is what binds that site.

## [0.32.0] — 2026-08-27

### Added

- **An epic can record the design document it came from — `--spec` → `specPath` (#92).** Settable
  on `add-epic`, `update-epic` and as a `specPath` key in an `add-many` batch, so the association
  is reachable for epics that already exist and not only at creation. Provenance only: no progress
  is read from it and no scan registers epics from it. It joins `planPath` in the
  `EPIC_SOURCE_ARTIFACTS` family and therefore inherits `sync`'s claim check, tombstone clearing
  on claim, and the `remove-epic` tombstone sweep — but it is deliberately **many-to-one**, which
  `planPath` is not: a design too large for one implementation plan enumerates N chunks and every
  one of those epics names the same document. That was the missing concept behind a Tier-2 design
  whose six chunks produced exactly one epic, the other five being found by hand 11 days later
  after they had blocked every release in between. Scanning a specs directory would not have
  fixed it — that yields one epic per document, which closes when chunk 1 ships.
- **`verify-specs` — which design documents have no epics? (#93).** A read-only inventory:
  for every `.md` file under a spec root (default `docs/superpowers/specs/`, recursive, minus
  `README`/`INDEX`/`CONTRIBUTING`; `--root <path>` to point elsewhere) it prints how many epics
  claim it and which ones, then the other half of the set difference — the epics whose `specPath`
  names a document that is not on disk. Coverage is status-blind, so an archived epic for chunk 1
  still counts as coverage of chunk 1. It writes no state, repairs nothing, and always exits 0.

  **Deliberately not an `integrity` check.** `integrity`'s unit is a shape that *cannot* be true;
  a design document with no epic *can* be true and usually is — a note, a reference, an abandoned
  sketch. Reporting every one as a defect is the noise that got the plan-freshness warning cut
  back in 0.30.x (it was wrong 7 times out of 8), so this is its own verb in the `verify-*`
  family, uses none of `integrity`'s finding vocabulary, and never speaks up on its own. An
  absent root reports **no spec root** rather than zero uncovered: silence and clean must never
  look the same. Enumerating what a design implies stays with the agent — heading conventions
  vary too much to parse, and 23 of the 125 deferred items in the survey behind this sat under no
  heading at all — so the agent authors the `add-many` batch and the engine computes only the
  difference.

### Fixed

- **A command that merely *mentions* `git commit` no longer nudges (#104).** The `PostToolUse`
  hook decided a commit had happened by testing the Bash command's TEXT against
  `/git\s+commit/`, so an `rg` for the phrase, a heredoc writing commit-convention docs, or an
  `echo` produced an advisory asserting a commit that never happened — repeated noise arguing for
  bookkeeping in response to an event that did not occur. It now watches HEAD: a small
  git-ignored watermark (`.conductor/commit-watch.json`) records where HEAD was on **every**
  Bash call, and the hook speaks only when HEAD has moved AND `git reflog` says the move was a
  commit (`commit:`, `commit (initial):`, `commit (amend):` — a `checkout`, `reset`, `merge`,
  `rebase` or `pull` moves a pointer at objects that already existed and is silent).
- **No AUTO-DETOUR is logged when there is no active epic (#91).** A detour is by definition an
  interruption of an active epic; with none there was nothing to detour FROM, and the entry
  carried an empty epic field (`AUTO-DETOUR\t-\t…`) describing an interruption that never
  happened — then asked the human to hand-clean `detours.log`, the exact hand-editing pm exists
  to remove. Observed twice in one session against `/pm:upgrade`'s own
  `chore(pm): upgrade conductor to <ver>` commit. The sibling `DETOUR-COMMIT` branch needed no
  change: it is already gated on a live detour frame, which is strictly stronger.
- **Every commit FORM is now noticed, because none of them is parsed.** `git commit -am`,
  `-F file`, a heredoc, an editor commit with no message flag at all, and a message carrying an
  escaped quote were each invisible to the `-m "([^"]*)"` capture. The first four produced an
  empty subject that short-circuited the landed-check — so a REJECTED `-am` commit still wrote a
  false `DETOUR-COMMIT` line, gh#65's original symptom surviving in a flag form — and the last
  truncated at the first `\"`, which HEAD then CONTRADICTED, silently suppressing a commit that
  genuinely landed. On the observed path the subject now comes from the commit itself, so this
  closes as a class rather than one flag at a time, including flags git has not invented yet.

- **#130 — a mistyped disposition had no correction verb.** An agent-recorded disposition was
  unreplaceable, so recording `delivered` where `superseded` was meant (or attaching the wrong
  reason) left hand-editing `.conductor/state.json` as the only route — on the *terminal* record
  of what happened to a piece of work. `update-epic <id> --status archived --outcome <o>
  --correct-disposition "<why the recorded one was wrong>"` now corrects it. The ordinary verb
  still refuses, and its refusal now names the correction route instead of being a dead end.

  A correction is **deliberate** (never reachable by re-running the ordinary verb; refused when
  there is no agent-recorded disposition to correct), **self-describing** (the flag's value is the
  justification and is kept on the record as `disposition.correction`), and **non-destructive**
  (the prior record survives verbatim under `disposition.superseded`, one level deep, exactly as
  `record-gate-review` caps its own nest). PROJECT.md and the brief render
  `· corrected (was <prior outcome>)` beside the new outcome, so a correction is distinguishable
  from an original by anyone reading afterwards. The superseded record's `carriedTo` joins the
  dangling-epic-reference sweep like every other holder of an epic id.

- **#133 — recording an honest disposition on a backfilled epic reverted its archived task
  counts.** `isArchiveBackfilled()` asked the DISPOSITION record who registered the epic
  (`recordedBy: "archive-backfill"`), but the interactive verb replaces the disposition wholesale
  with an agent's own, which carries no `recordedBy` by design. Registration provenance therefore
  lived inside the one field whose entire contract is that an agent overwrites it — so a change
  registered at `2/3` rendered `—` the moment somebody recorded the truth about it. Registration
  provenance now lives on the EPIC as `registeredBy`, orthogonal to the disposition and untouched
  by any disposition write.

- **`remove-epic`'s tombstone message named the wrong flag.** It said
  `update-epic <id> --plan <path>` unconditionally, which was correct while the source-artifact
  family held one row and wrong the moment it held two — telling an operator to re-attach a design
  document as a *plan* points that epic's progress source at a file with no checkboxes.
  `tombstoneArtifacts()` now returns each recorded artifact with the flag that writes its field,
  and the message names it.

## [0.31.0] — 2026-08-27

### Added

- **`scripts/lib/source-artifacts.mjs`** declares the epic source-artifact field family once —
  `planPath` today, `specPath` (#92) by adding one row plus its `EPIC_FLAGS` entry. Claim
  checking, tombstone clearing and the removal sweep all read that table, so the next artifact
  field inherits them instead of becoming a second shape with its own half-covered call sites.

- **`--add-story` is repeatable and works on `add-epic` and `add-many`, not just `update-epic`.**
  An epic's milestones now land in the SAME write as the epic:
  `add-epic --id deploy-pipeline --lane superpowers --add-story "Build" --add-story "Cut over"`.
  An `add-many` batch entry carries a `stories` array of plain titles or `{"title", "done"}`
  objects, validated in the same up-front pass as everything else — a blank title refuses the
  whole batch and creates nothing. Measured cause of the gap: with stories addable only one
  `update-epic` call at a time after registration, 91.7% of epics in a 108-epic audit had none.
- **`update-epic <id> --story <n> --wont-do "<reason>"`** — a story's terminal disposition. A
  `done` boolean holds two states and the record needs three: open, completed, and deliberately
  not being done. Deletion is never the third state, so the row and its title always survive and
  only the terminal state differs. The reason is required; a recorded disposition is never
  silently replaced; a `done` story cannot be dropped and a disposed one cannot be ticked.

### Fixed

- **The never-re-read warning no longer counts epics whose work can never happen** (#138). The
  brief's `⚠ N tracker-linked epic(s) never re-read since mirroring` line counted every linked
  epic with no watermark, `archived` ones included. Measured on this repository when the issue
  was filed: 59 counted, 29 of them archived or with an already-closed item — twenty of those
  epics 0.27.0 had *delivered*. Half the number was work that can never happen, and the remedy
  the line names could not clear it: `/pm:sync` reads OPEN items, and an epic that ended has no
  open item to read. An inflated count is how a true warning gets ignored, and an ignored
  warning enforces nothing. The line now counts only non-terminal linked epics, so it names a
  number the action it prescribes can actually reach.

  **The archive disposition is the discharge** — deliberately, rather than a terminal watermark.
  An epic that ended never becomes the work again, whatever its outcome, and the rules block's
  closed-item sync step already ships that semantics ("an epic that is already `archived` owes
  nothing here"). A terminal watermark would be a second mechanism for what the disposition
  already accomplishes, with its own writer, verb and staleness story. The engine half is a pure
  function of `state.json` (`status !== "archived"`, the same reading of "terminal" 0.30.0's
  `superseded-epic-never-ended` and `delivered-release-epic-left-open` use); the closed half
  stays with the inward-sync instruction the agent runs, which lists open items anyway. Dated
  observation on this repository, 2026-08-27: the count goes 60 → 31.

- **`sync` dedups a plan file on a recorded epic↔plan association, not on the plan's filename**
  (#64, #69). The dedup keyed on the plan's filename-derived id, so it fired only when a plan
  happened to be named exactly like its epic — the uncommon case, since plan filenames carry a
  date prefix and epic ids do not. Every other epic's plan was re-registered as a fresh
  untriaged epic on **every sync, forever**: reported four times across three repos, one
  operator hand-deleted the same phantom four times in a day, and one phantom duplicated the
  epic that was *active* at that moment. `sync` now walks a ladder per plan file — claimed by
  some epic's `planPath` (status- and lane-blind, so an archived epic's plan is never re-offered:
  the done-signal #69 asks for, with no completion heuristic); the pre-existing id guard,
  unchanged; a sync-ignore tombstone; an epic whose id is the plan id minus its date prefix,
  which is **reported with both exits named** rather than repaired; otherwise registered.
- **`remove-epic` now survives the next `sync`** (#64). Removal used to be durable only until
  the next sync — byte-identical ids came straight back within the hour. It leaves a
  `syncIgnore` tombstone for every source artifact every removed epic claimed, over the whole
  `--cascade` set rather than the named epic alone. Attaching that artifact to an epic
  (`update-epic <id> --plan <path>`, or any creation path) clears the tombstone, so the
  un-ignore is an action operators already take rather than a verb nobody would find.

## [0.30.0] — 2026-08-27

### Added

- **`integrity`: `delivered-release-epic-left-open`** — an epic still carrying a non-terminal
  status in a release that has already delivered, which that release's `deferred[]` does not name.
  Purely a function of `state.json`; it would have reported all twenty of 0.27.0's member epics.
  "The release delivered" is read from its members (at least one holds a `delivered` disposition)
  and a release with any `active` or `paused` member is silent, so a staged release in flight is
  not reported. (#137)
- **`integrity`: `superseded-epic-never-ended`** — an epic another epic declares it `supersedes`,
  still `queued`, `active` or otherwise non-terminal. `triage` already treats such an epic as dead
  so an agent does not consolidate into it; nothing said the epic itself was never ended, which
  leaves two live rows for one piece of work. The superseded set now has one declaration
  (`links.mjs`'s `supersededEpics()`), read by `triage` and by the check, so the two surfaces
  cannot disagree about which epics are dead. (#112's deferred follow-up)
- **The inward tracker-sync procedure gains its reciprocal step.** Sync lists OPEN items, so an
  epic linked to an item absent from that list has an item that is no longer open — sync could
  create an epic from an item and never end one. The agent now reads that item (absence also
  covers deleted, transferred and out-of-scope) and, where the epic is not already `archived`,
  **proposes** the disposition rather than writing one: which outcome it is, and the reason with
  it, is a judgment about what happened to the work. Emitted into both the primary inward section
  and the secondary tracker loop. (#137)

## [0.29.0] — 2026-08-27

### Added

- **Effective priority — dependency ordering that can finally see the backlog (gh#101).** An
  epic's *effective* priority is now the best of its own and every epic that transitively
  `depends-on` it, computed over the whole record instead of only the `queued`/`untriaged` set.
  A `planned` P2 that a `queued` P1 needs sorts as P1 and renders `P2 → P1` in PROJECT.md — P2
  on merit, P1 because a P1 needs it. Computed and never written back, so nothing is
  hand-maintained, the merit priority stays legible (you can still tell the goal from the
  means), and deprioritising the dependent drops the lift with it. An ARCHIVED dependent lifts
  nothing.
- **`DEPENDENCY WARNINGS` in the brief and `## Dependency warnings` in PROJECT.md.** One line per
  inversion, naming both endpoints, both statuses, why it is a problem and the effective priority
  the blocker now carries — so "the highest-priority thing is unstartable, here is what to pull
  forward" is a decision the record forces rather than one a human has to find by reading the
  link list by eye. Both surfaces render the same lines: `/pm:next` reads PROJECT.md, not the
  brief, so a warning that lived only in the brief would be absent from the surface the
  next-up decision is actually made from.
- **A `blocked` epic with no `depends-on` link is now reported.** `blocked` was otherwise a dead
  end — an epic could sit in it indefinitely with nothing recording what it waits on. Derived
  from `depends-on` rather than a new `blockedBy` field: one mechanism, not two.

- **`reorder <id> <id> …` — manual rank for genuine ties (gh#101).** Places the epics of ONE
  priority band top to bottom, rewriting ranks dense `1..N` on every call. It is the only writer
  of `rank`, and it takes the whole band and refuses a partial one, so contiguity holds by
  construction rather than being checked afterwards — which is also why there is no per-epic
  `--rank` flag (one-at-a-time reordering is tedious and racy). Rank is the LAST sort key:
  dependencies → priority → rank. It breaks the tie that previously fell through to alphabetical
  order and never outranks a dependency or a priority. Unranked epics are legal and sort after
  every ranked one; `update-epic --priority` clears a rank on a real band change, with a notice.

- **`triage "<ask>"` — intake screening against the whole backlog** (#112). The conductor
  accepted work but never triaged it: `add-epic` validated the id, lane and priority, refused a
  duplicate `externalId`, and appended. That dedup is identity-based — same id, or the same
  `externalUrl` — so it stops `/pm:sync` mirroring an issue twice and does nothing about the same
  ask arriving under a different name. Measured in this repo: `integrity`'s
  `change-registered-under-two-lanes` reports four live pairs that are one change registered
  twice under different lanes and names, and identity dedup found none of them.

  The new read-only verb returns the existing epics that share **distinctive** vocabulary with an
  ask — weighted so words the whole backlog uses count for almost nothing and rare words count
  for a lot — each carrying the shared tokens that put it there and a `superseded` flag, plus the
  lane this repo's routing picks and the backlog's current shape. `commands/triage.md`,
  `/pm:triage`.

- **`declined` terminal outcome.** An ask that is considered and turned down is now recordable:
  `update-epic <id> --status archived --outcome declined --reason "<why not>" --no-deferrals`.
  Declining by never registering the ask destroyed the record that anybody considered it — the
  same objection that made every other ending recordable. It is an **outcome, not a status**:
  `archived` already means terminal, so no status-driven behavior changes anywhere in the engine.
  It requires a reason like every non-`delivered` outcome, and because it is not `delivered` the
  archive gate's Gate 2 demand and handoff demand pass it by (no code was written). A declined
  epic is also out of the completion-shaped integrity checks' scope, for the same reason `killed`
  and `abandoned` are.

- **`supersedes` link type**, documented in the epic-schema vocabulary and surfaced by `triage`:
  a candidate that some other epic already supersedes is flagged, so a fourth ask is never
  consolidated into an epic that is already dead.

- **An always-on `## Intake` section in the emitted rules block**, carrying the four-step intake
  procedure. It applies to every path that registers an epic — the tracker-sync procedures,
  `/pm:epic add`, and a roadmap document read in-session — and says explicitly that it is not a
  substitute for the sync procedures' `externalUrl` check, nor they for it.

**Where the line is drawn.** `pm` is an instruction layer, so the engine computes a **candidate
set** and never a **verdict**: it emits `verdict: null`, labels no candidate a duplicate, and
makes no claim that two asks are the same. Which epics share distinctive vocabulary, which lane
the repo's routing picks, what the backlog looks like as a set, and which candidates are already
superseded are mechanical. Whether an ask is the same ask, whether the lane is right, where it
sits against what is in flight, and whether to consolidate, decline or register are judgment, and
they belong to the agent — prompted by the emitted Intake procedure.

- **`integrity` check `recorded-sha-the-repository-cannot-resolve`** (#142). The shas in
  `attributedCommits` and in a gate verdict's `baseSha`/`headSha` *are* the evidence — "a reviewer
  read this range" is checkable only while the range exists. A squash-merge leaves every commit on
  the merged branch reachable from no ref and the next `git gc` deletes them (default
  `gc.pruneExpire`: two weeks); measured on `cfdude/pm` right after 0.28.0 merged, **36 recorded
  shas, 0 reachable from any ref**, with every existing check green. Two arms, because the reports
  are different: **orphaned** (in the object store, reachable from nothing — recoverable *now*
  with `git tag`, gone at the next `gc`) and **already gone** (unrecoverable locally). The
  already-gone arm is gated on a probe — if the clone resolves *none* of the record's shas it says
  nothing, because a fresh, shallow or single-ref clone lacks that history rather than having
  destroyed it.
- **`git.mjs`: `objectExists(sha)` and `reachableFromAnyRef(sha)`** — local, argv-array
  `execFileSync`, no network, matching the module's existing contract.

### Fixed

- **`update-epic --attribute-commit` now reads back what it wrote** and exits 1 naming the shas
  that are not in `.conductor/state.json` when the command ends, instead of printing `updated`
  (#140). The check runs at the END of the command, after the `render()` that follows the save has
  had its own turn at the file.
- **Every `state.json` write verifies its own bytes reached the disk.** `saveState()` re-reads
  after `rename(2)` and throws `StatePersistError` when the file does not hold what it just wrote.
  A *newer* revision on disk is a supersession, not a failure, so this does not fire on the benign
  interleave the existing revision guard already handles.

## [0.28.0] — 2026-08-27

### Added

- **A release-scope review gate** (#126). pm's gate vocabulary was per CHANGE — Gate 1 reviews one
  change's artifacts, Gate 2 its implementation — so nothing asked whether a release's specs agree
  WITH EACH OTHER. On 0.27.0 that question returned 5 Critical and 10 Important against six specs
  that had each passed `openspec validate --strict` and would each have passed Gate 1 alone,
  including a flagship scenario that was unreachable and a shared flag allowlist four capabilities
  all needed to grow.
  - New subcommand `record-cross-spec-review <releaseId> --verdict pass|fail [--reviewer "<who>"]`
    records the verdict on `state.releases[].crossSpecReview`. The **engine** enumerates the
    release's spec set from disk and stores a SHA-256 per file it read — an agent never supplies
    the list, because a spec list typed by the party being reviewed goes stale in exactly the way
    this gate exists to catch.
  - A spec **added** to the release after the verdict, or a reviewed spec **amended**, marks it
    `⚠ stale` on PROJECT.md and the session brief; an unreadable spec reads `⚠ unverifiable` and a
    `pass` is refused rather than recorded against evidence that does not exist. The record is
    keyed change-relative, so the `/opsx:archive` move never reads as staleness. Re-recording
    supersedes the prior verdict and keeps it readable, one nested level.
  - The gate applies at **two or more spec files counted flat** across a release's member changes,
    so one change carrying six specs qualifies exactly as six changes carrying one each do. Below
    it the verb refuses: Gate 1 covers a single spec completely.
  - A multi-spec release with no verdict at all renders `⚠ no cross-spec review (N specs)` —
    silence would be indistinguishable from "reviewed and clean".
  - New slash command `/pm:cross-spec-review` carries the procedure, the six questions
    (contradiction, double ownership, unmeetable requirements, gaps, vocabulary forks, shared
    chokepoints) and the BLOCKS/POLISH adjudication, and the rules block now emits it as a
    **numbered required task item** alongside the other five.
  - The `review-mode` dial covers it: `standard` gets one fresh-context reviewer, `thorough` two
    with different lenses (coherence/contradiction, falsifiability/dependency-order).

No migration: `crossSpecReview` is a purely additive optional field on the release object that
shipped in 0.27.0, and a state file written by the prior version loads unchanged.

- **OpenSpec currency check (gh#128)** — `pm` and `superpowers` are plugins that auto-update, but
  OpenSpec is a CLI the user upgrades by hand, and `openspec update` — which regenerates the
  per-project instruction files, slash commands and skills the whole OpenSpec lane runs on — is a
  separate manual per-project step that nothing anywhere asked about. Measured in pm's own
  repository: four minor versions stale (1.6.0 artifacts against a 1.10.0 CLI) while actively
  running an OpenSpec change, with two upstream slash commands its agents could not know existed.
  The SessionStart/PreCompact brief and `/pm:upgrade` now both report the drift, from one shared
  emitter so the two surfaces cannot disagree.
  - The project's generated version is read from the `generatedBy` stamp in the frontmatter of
    each `SKILL.md` under a `.claude/skills/openspec-…` directory; where they disagree after a
    partial update, the **oldest** governs, because that is the text the agent is actually reading.
  - The installed CLI version comes from a read-only `openspec --version`. **`pm` never runs
    `openspec update`** — it emits the instruction and the user runs the terminal command, exactly
    as with `openspec init`. A source scan in the suite fails the build if any engine file ever
    passes the `openspec` binary an argv other than `--version`.
  - Either version being undeterminable is **cannot-tell**, never stale — the same third answer
    `git.mjs`'s `isAncestor()` gives. Nothing is spawned at all unless the repo has an `openspec/`
    directory *and* a readable generated stamp.
  - **The nudge holds mid-change rather than suppressing itself.** `openspec update` rewrites the
    instruction files an in-flight change is being authored against, so with an active change the
    drift is still reported but the imperative becomes "hold until `<change>` is archived".
    Suppressing outright would silence it permanently in any repo that usually has a change open —
    which is exactly how the measured drift accumulated unseen.
  - **The review instruction adapts to whether a diff will exist.** Where the generated files are
    git-tracked, `git diff` after the run *is* the review; where they are not tracked (or that
    cannot be confirmed), the nudge says to copy them aside first, because the rewrite would
    otherwise destroy local edits to `.claude/skills/openspec-…` with no trace and no diff.
    Tracked-ness is scoped to THIS project even when it is nested inside a larger repository —
    `git ls-files` walks up, but a cwd-relative pathspec keeps both the match and the printed
    paths under the project root, so an enclosing repo's own `openspec-…` skills are never
    mistaken for this project's. Pinned by a test in both directions.

No `state.json` schema change and therefore no `MIGRATIONS` entry: this is a read of the working
tree, reported.

### Fixed

- **Developing `pm` no longer runs a stale engine.** Every entry point the plugin ships —
  `hooks/hooks.json` and each `commands/*.md` — invokes the engine through
  `${CLAUDE_PLUGIN_ROOT}`, which resolves to the *installed* plugin rather than the checkout
  being edited. Export `PM_ENGINE_DELEGATION=/abs/path/to/your/pm/checkout` and the engine
  hands the whole invocation off to `<checkout>/scripts/conductor.mjs` before doing any work,
  so the `PostToolUse` commit hook stops re-rendering the tracked `PROJECT.md` with output a
  release behind the working tree. The handoff repoints `CLAUDE_PLUGIN_ROOT` at the checkout,
  propagates the child's exit code (the `gate-guard` `PreToolUse` hook blocks by exit code),
  and falls back to running in place if it cannot start. (#134)

  It is **opt-in**, and the opt-in names one absolute path, because this decision is evaluated
  in **every project on the machine** — initialized or not, by four hooks, on roughly every
  turn — and it decides whether to execute code the *project* supplies. Nothing readable from
  inside a repository can enable it: a `.claude-plugin/plugin.json` naming `pm` is two lines a
  hostile repo writes, so it authorizes nothing and only ever acts as a sanity check on a path
  the user already named. Unset, which is the default, no handoff is considered at all.

## [0.27.0] — 2026-08-25

**The conductor tells the truth.** A retrospective delivery audit of 49 archived OpenSpec epics
across 8 repositories found that the conductor's records were wrong and its guards did not fire:
**42 of 49 epics archived with `gateReview: null`** — by following the documented `/opsx:archive`
workflow, because Gate 2 was enforced by `update-epic` and bypassed by the archive hook — and
`sync` never walked `openspec/changes/archive/`, so the conductor saw **49 of 87 archived changes
(56%)**. Every number this project has published about its own effectiveness was computed from
those records. This release makes them true: 20 issues, 6 specs, 59 requirements, 115 tasks.

### Added

- **`integrity` — a read-only audit of the conductor's own record.** Ten checks over
  `state.json`, each one a shape that cannot be true: an archived epic with zero ticked tasks; a
  gate verdict whose note cites commits its recorded range does not contain; an epic archived with
  an `ungated` Gate 2; a `delivered` epic with a passing Gate 2 that attributed no commits; an
  archived openspec epic with no Gate 1; an archive directory the conductor holds no epic for; an
  epic the heal archived that reads `unknown` while carrying a passing Gate 2; a gate verdict
  recorded as bookkeeping rather than review; one change id registered under two lanes; a dangling
  epic reference. **It reports and never
  repairs** — a check that repaired would be a second writer racing the paths that produce the
  records it reads, and one that blocked would turn an audit finding into an outage. Every check
  that finds nothing still says it ran, because "the check measured nothing" is exactly the
  failure this release exists to end.
- **`release` — a release is a first-class object.** `state.releases[{id, intent, target,
  deferred[]}]`, with membership recorded one-way as `epic.release` so the two can never disagree.
  A deliberate exclusion is recorded in `deferred[]` with its required reason and the excluded
  epic stays in the backlog rather than being ended. `PROJECT.md` and the brief render
  `<release>: N epics, M deferred`.
- **`record-tracker-refresh <epicId> --verdict unchanged|material-change --external-updated-at
  <iso> [--summary "<what>"]`** — records the verdict that clears a tracker-linked epic's refresh
  obligation and advances its freshness watermark.
- **Terminal dispositions with a required reason, at four scopes.** An epic ends by recording
  `--outcome delivered|killed|superseded|abandoned --reason "<why>"`, never by deletion. The same
  concept covers a **deferral** recorded in a design doc, a **handoff** of unfinished work
  (`--carried-to <epicId>`), and a **release exclusion**. A change dropped at Gate 1 for a good
  reason used to record byte-identically to one that shipped.
- **A deferral assertion is required at archive time** — `--deferral "<epicId>:<section>"`,
  `--declined-deferral "<what>:<why not>"`, or the explicit `--no-deferrals`. The engine does not
  read your artifacts and will not guess; an absence you never looked for is indistinguishable
  from an absence you confirmed.
- **Gate verdicts carry checkable evidence.** `record-gate-review` gains `--base-sha`,
  `--head-sha` and `--reviewer`, stored as fields. A verdict whose recorded head does not reach
  the commits the epic attributed to itself now reads **stale** and refuses the archive. `gate1`
  acquires a reader — it was previously stored, documented, and consumed by nothing.
- **Commit attribution** — `update-epic <id> --attribute-commit <sha>`, repeatable and
  append-only. The engine infers attribution from nothing: not the files a commit touches, not an
  epic id in a message. **One exclusion:** the commit that moves `openspec/changes/<id>/` under
  `archive/` must not be attributed, or the epic's own Gate 2 goes stale at the instant the
  archive gate reads it.
- **Epic annotation** — `--description` (durable rationale, replaced wholesale), `--notes`
  (append-only trail that reads as activity), and `--clear-links` as the named way to empty the
  links array. Stories used to be the only free-text carrier, which is why four epics archived
  with "incomplete" stories that were actually completion notes.
- **`sync` reconciles `openspec/changes/archive/`**, registering an unknown archived change as an
  epic already in `archived` status. The backfill is a visible, announced, one-time action marked
  by `archiveBackfilledAt` — never a silent side effect.
- **The gate procedure pm emits gains five required task items**, not prose bullets: the
  call-site completeness sweep, commit-based verification, the lifecycle-marker declaration,
  commit attribution, and ending work by recording a disposition. Measured in the audit: a rule
  carried by a mandatory task section reached **14/14** adoption in subsequent changes; the same
  rule as a prose bullet reached **3/15**.
- **`<!-- pm:lifecycle -->`** — an agent-declared marker on a task line that excludes lifecycle
  bookkeeping from progress. A task reading "run `/opsx:archive <this change>`" cannot be ticked
  before the thing that ticks it, and used to render as outstanding work forever.

### Changed

- **BREAKING — tracker `direction` replaces direction-by-vendor.** Every tracker carries
  `inward`, `outward` or `both`, set with `set-tracker --direction <d>` and read by every
  emitter. Direction is no longer inferred from the vendor name at any site. `rules.mjs` used to
  suppress the outward section with a literal `sys !== "github-issues"` test while `briefing.mjs`
  emitted outward drift gated only on a tracker existing, so a repo could receive a `CLAUDE.md`
  with no outward instructions and a brief demanding outward action for 29 epics.
- **BREAKING — a NEW primary tracker with no `--direction` now defaults to `inward`,
  regardless of vendor.** This reverses today's outcome for a newly registered non-`github-issues`
  tracker: `set-tracker --system jira …` used to produce the outward mirror section and now
  produces the inward one. Outward creation of issues in someone else's tracker is the
  consequential default and must be chosen, not inherited. **One-line remedy:**
  `set-tracker --system jira --direction outward`. **Existing repos are unaffected** — the
  migration stamps the direction each tracker already behaves with, and an un-migrated repo's
  fallback resolves to the same values.
- **BREAKING — the archive transition is gated on every path, not just `update-epic`.**
  `reconcileArchived()` used to flip an epic to `archived` with no lane check and no gate check;
  the rule now binds the function wherever it is invoked — `upgrade`, `render`, the commit nudge
  and `sync`. An archive that today succeeds silently will either refuse, or record how it
  bypassed (`gateReview.gate2.verdict: "ungated"`, a standing condition that clears only when a
  real passing verdict supersedes it).
- **BREAKING — an epic that ends carries a disposition.** An openspec-lane epic cannot be
  archived as `delivered` without a passing, non-stale Gate 2; `killed`, `superseded` and
  `abandoned` are exempt by design, because the code was never written or was thrown away, and
  demanding a verdict there would make those outcomes recordable only by fabricating one.
- **Three deliberate changes to what pm emits for existing repos.** Diffing 0.27.0 output
  against 0.26.0 will show exactly these three and nothing else; treat a fourth as a regression.
  1. The "Sync after completing tracker-linked work" reminder leaves the rules block where no
     inward procedure is emitted — it used to cite "the writeback steps above" that the same
     block never emitted.
  2. The `N tracker(s) configured — consider /pm:sync` nudge leaves the brief for outward-only
     repos, for the same reason.
  3. Progress renders `· N lifecycle` where tasks are lifecycle-excluded, and `0/0 · N lifecycle`
     where `—` used to appear if every task is excluded.
- **`update-epic` gains `--lane` and `--plan`.** A mis-routed epic used to be correctable in
  exactly one way — remove it and register it again — which discarded its start time, its gate
  verdicts, its links and its stories. A misplaced `--id <x>` is now answered by name instead of
  with a bare usage dump.
- **The emitted inward-sync recipe runs as written.** It used to instruct `add-epic` without the
  required `--id`; two independent sessions hit it the same afternoon and each silently invented a
  slug. The recipe now carries a deterministic derived id, so a re-run is refused as a duplicate
  rather than creating a second epic. Lane at mirror time comes from `suggest-lane` instead of a
  hardcoded `--lane claude-code`.
- **The write-conflict warning latches instead of sampling `count === 3`.** A burst past the
  threshold between two briefings warned zero times — so the warning was least likely to fire in
  exactly the wedged-writer scenario it exists for. `snapshot()` also stops consuming the warning
  into a file nothing reads back.
- **One shared flag registry.** `EPIC_FLAGS` in `constants.mjs` is the single declaration of the
  flag surface every epic-writing command shares; `update-epic`'s allowlist, `add-epic`'s
  repeatable set and `add-many`'s permitted keys are all projections of it.

### Fixed

- `#71`, `#79`, `#80`, `#88`, `#102`, `#103`, `#107`, `#109`, `#110`, `#113`, `#115`, `#116`,
  `#117`, `#118`, `#119`, `#120`, `#121`, `#122`, `#124`, and the minimum slice of `#125`.
- **Partially resolved and deliberately left open:** `#66` (`update-epic` gains `--lane` and
  `--plan`; its `--link` complaint is covered only as far as `epic-annotation` reaches) and `#114`
  (mirrored items are routed instead of hardcoded, but the routing *decision* still weighs no
  product or milestone context). Both reasons are recorded in the `0.27.0` release object's
  `deferred[]`, in this repository's own `state.json`.

### Migration — `0.27.0`

One `MIGRATIONS` entry, additive, idempotent, backward-compatible; a `state.json` written by
0.26.0 still loads. It stamps two things and reads nothing outside `state`:

| Existing | Stamped | Preserves |
|---|---|---|
| `github-issues` primary | `direction: inward` | inward pull; outward stays suppressed |
| any other primary | `direction: outward` | outward create + transition; **no** inward pull is introduced |
| any secondary entry | `direction: inward` | inward pull + completion writeback, never outward creation |

Every **archived** epic is stamped with a terminal outcome regardless of lane — `delivered` only
where a passing Gate 2 exists, `unknown` everywhere else, both carrying `recordedBy: "migration"`.
Lane-scoping this would be wrong on measured data: of this repository's 69 archived epics only 3
are openspec-lane, so stamping one lane would leave 66 with no outcome and the outcome invariant
would fail on pm's own repository the instant the migration ran. An explicitly set value is never
overwritten, so a second `/pm:upgrade` is a no-op.

### Upgrading — what to expect on the first run

Update the plugin → `/reload-plugins` (or restart) → `/pm:upgrade` in each repo.

**Expect a burst of `heal-archived-epic-passed-gate-2` findings the first time you run
`/pm:integrity`.** Every repo that followed the documented `/opsx:archive` → heal flow lands on
`outcome: unknown` rather than `delivered`: the migration only stamps epics already `archived` in
state, and the heal flips the rest *afterwards*, so they miss it by one step. Across the ~22 repos
running pm this will be the common shape, and it is **expected, not a bug**. The integrity check
reports each one with the exact remedy —
`update-epic <id> --status archived --outcome delivered --no-deferrals` — and the archive gate's
replacement rule accepts an agent correcting an engine stamp, so the fix is one command per epic
and nothing is frozen at `unknown`.

## [0.26.0] — 2026-08-18

### Added

- **`state.json` writes are now guarded against lost updates.** Two processes that both read the
  same state and wrote it back produced a **silent** lost update: the second write won wholesale
  and the first one's change vanished with no error. The atomic `rename(2)` already guaranteed
  the *write*; the unguarded thing was the read-modify-write *cycle*. `loadState()` now stamps
  the on-disk revision onto the object it returns and `saveState()` refuses a write whose
  revision is stale. A lockfile was rejected deliberately — a session killed mid-write leaves a
  lock held forever, whereas a revision comparison leaves nothing behind.
- **A no-op save is a no-op.** A `saveState` whose content is unchanged (revision aside) neither
  writes nor bumps, so re-running a command that changes nothing leaves `state.json` byte-identical.
  This preserves two existing idempotence guarantees that the revision bump would otherwise have
  broken, and stops rewriting an unchanged file for no reason.
- **A conflict on an interactive verb exits `9`**, distinct from the `1` every validation failure
  already uses, so an agent can tell "someone else wrote, retry" from "you passed a bad flag".
- **`--force` overwrites deliberately, bypassing the revision check.** Read straight from
  `argv` rather than threaded through every call site, the same shape as `platformFlag()`.
  Without a documented override people learn to hand-edit `state.json` to get around the guard,
  which is strictly worse than a flag that leaves a trace in the command line. A forced write's
  new revision always advances strictly past whatever is currently on disk (not just past the
  forcing writer's own stale read) — otherwise the forced write can land on a revision a later
  writer already saw as `found`, and *that* writer's own next save would pass the guard and
  silently clobber the forced change, reopening the exact lost-update window one hop removed.
- **Hook writes degrade instead of failing.** Two hook writes exist —
  `reconcileArchived()`'s self-heal in both `render()` (PostToolUse via `commit-nudge`,
  PreCompact via `snapshot`, and `render` itself) and `commit-nudge`'s own self-heal call — and
  both re-run on the next hook, so a conflict on either is recorded and skipped rather than
  surfaced as a mid-session error for a write that did not matter. **Three consecutive skips
  warn once in the briefing** — and delivering that warning *consumes* it, rotating the log to
  `.prev` so the count resets. Without that, `conflictCount()` stays pinned at the threshold once
  contention stops, and the briefing re-warns on every SessionStart about a problem that resolved
  days ago. Rotating rather than deleting keeps the evidence the warning cites. Consumption is
  scoped to the entry points that actually *deliver* a briefing to a session (`brief`,
  `snapshot`) — composing PROJECT.md's embedded "Briefing" section via `render()` never consumes,
  so a warning produced and rendered in the same call is still there for the next real briefing.
- Skips are recorded in `.conductor/write-conflicts.log`, which rotates at 8 KB keeping one
  `.prev`. Size-triggered rather than count-based on purpose: enforcing "keep the last N" means
  reading and rewriting the file, and this is the failure path of a *write* guard.

### Fixed

- **`init` now git-ignores the conductor's generated logs** (#106). `.conductor/detours.log` had
  never been ignored by anything pm ships — it was invisible on the maintainer's machine only
  because their personal global gitignore carries `*.log`, so every other user had carried a
  permanently untracked file since it shipped. `state.json`, `render-stamp.json` and `PROJECT.md`
  remain tracked; they are the state of record and the generated index. Both `init` and `upgrade`
  perform the backfill — `/pm:upgrade` is the documented update path, so wiring it to `init`
  alone would have fixed the issue for new repos and missed every existing one.

### Compatibility

- A `state.json` written by 0.25.2 has no `revision`; it loads unchanged and takes revision `1`
  on its first write. **No migration is required.**

## [0.25.2] — 2026-08-17

### Fixed

- **A help flag no longer has a side effect** (#98). Nothing parsed `--help`, and the usage string
  was only reached by the dispatch fallback for an *unknown* subcommand — so on a known one,
  `--help` fell through and was consumed as data. `log-detour --help` wrote a real row to
  `.conductor/detours.log` with `--help` as the detour description. That log is append-only with
  no verb to remove a row, and it is what a future session reads to reconstruct history, so the
  entry was a false statement in the project's own record. `--help`/`-h` are now handled before
  dispatch — covering every subcommand, not just the one where the damage was visible — and a
  bare invocation with no subcommand prints usage and exits 0 instead of erroring.

## [0.25.1] — 2026-08-17

### Fixed

- **A missing progress source now warns instead of rendering an em dash** (#86). `bar()` renders
  `—` for three different states — "this epic has no progress source", "the source exists and is
  empty", and "the source is missing" — so an openspec epic whose `changes/<id>/tasks.md` had
  moved or been deleted was indistinguishable from healthy work with nothing ticked yet. It now
  renders `⚠ tasks.md missing`, mirroring the plan lane's existing `⚠ planPath missing`.
- **Archived epics no longer warn about a missing progress source.** Archiving is precisely when
  a source legitimately goes away: OpenSpec removes `changes/<id>/`, and finished plans are moved
  out of `docs/superpowers/plans/` (which is also how repos stop `sync` re-registering shipped
  work). Measured on a 108-epic repo, 7 of the 8 epics carrying a `planPath` dangled and **all 7
  were archived** — a warning wrong 7 times out of 8 trains the reader to ignore the once it is
  right.
- **`sync` no longer registers a plans directory's own index file as an epic** (#87).
  `docs/superpowers/plans/README.md` became an untriaged epic titled after its H1 — observed live
  as *"Superpowers Plans — Active"*. `readme.md`, `index.md` and `contributing.md` are excluded by
  filename; deciding from file contents would make registration depend on heading conventions.

## [0.25.0] — 2026-07-30

### Added

- **`rules-target` — a read-only query printing the absolute path of the file the resolved
  platform's rules block belongs in**, walking that platform's first-match-wins chain. It
  deliberately does **not** record a platform: a query must not mutate state the way
  `write-rules` does.

  It exists so tooling around pm never has to mirror `PLATFORM_RULES_CHAIN`. `evals/observe.py`
  hardcoded `CLAUDE.md`, which 0.24.0 quietly turned into a *second* platform seam — once the
  engine began writing a per-platform target, the observer reported `rules_block_present: false`
  for any platform whose block lands elsewhere. That is a confident wrong answer, and it would
  have surfaced on the first Hermes or Codex run as a parity failure that is not real. Copying
  the chain into Python was rejected: a second copy of platform knowledge only *moves* the
  drift instead of removing it.

## [0.24.0] — 2026-07-30

### Added

- **Platform-aware rules block.** The managed rules block is no longer Claude-Code-only. The
  host agent declares itself via `--platform <claude-code|hermes|codex>` in the hook command pm
  authors for that platform, and the active platform is recorded in `.conductor/state.json`.
- Per-platform slash-command form: `/pm:status` on Claude Code and Hermes, `/pm-status` on Codex.
  The namespace is retained wherever supported because Hermes silently skips a plugin command
  that collides with a built-in, and it ships a built-in `status`.

### Changed

- **The test suite is now `scripts/test/*.test.mjs` (11 files) instead of one
  `scripts/conductor.test.mjs`, so it runs in parallel.** Contributor-facing: the
  command is `node --test scripts/test/*.test.mjs`. Measured rather than guessed — one engine
  spawn costs ~73ms and the suite makes 676 of them, so ~49s was pure `node` startup, serialized
  in a single file on a 16-core machine; `node --test` parallelizes across *files* only. The
  split is verbatim, verified by test-name-set equality (255 → 255).

  **How much faster depends entirely on free cores, so take a single headline number with
  salt.** Measured on this project: an otherwise-idle 16-core workstation went ~118s → ~46s
  (2.6×), but the *same* machine under load (~12) went ~146s → ~122s — only 1.2×, because
  parallel execution is exactly what suffers when cores are already contended. On CI, whole-
  workflow time went from ~52–58s to ~38–48s (~1.3×). If you are on a busy laptop or a
  few-core runner, expect the low end.

  Note `node --test scripts/test` (a **directory**) does not work — Node treats the argument as a
  module to execute and dies with `MODULE_NOT_FOUND` while reporting "1 test". It exits non-zero
  so it cannot pass silently, but use the glob.

  Rejected: converting to in-process testing to skip `node` startup entirely. It would be faster
  still, but would stop exercising the real CLI contract — flag parsing, exit codes, stderr text,
  the dispatch table — which is where the bugs this suite catches actually live.

- **`.githooks/pre-commit` now aborts if the suite runs fewer tests than are declared.** The glob
  makes a partial-suite pass possible in a way the single file never did: if a file stops
  matching, everything still goes green, just on a subset. The hook cross-checks the runner's
  count against `grep -c '^test('` across the files — self-maintaining, with no constant to bump
  as tests are added.

### Fixed

- The rules block is now written to the file the host platform will actually read. Hermes
  resolves project context first-match-wins over `HERMES.md` > `AGENTS.md` > `CLAUDE.md`, so in a
  repo already carrying an `AGENTS.md` the block was silently invisible — no error, just an agent
  running without the conductor's instructions.

- **The auto-detour hook no longer writes a `detours.log` entry for a commit that did not land
  in this repo** (closes [#65](https://github.com/cfdude/pm/issues/65) and
  [#68](https://github.com/cfdude/pm/issues/68)). `PostToolUse` fires when the Bash tool
  *returns*, which is not the same as "a commit landed here." Three divergences were observed
  live, each writing a false line attributed to this repo's **stale HEAD**: the commit was
  rejected by `pre-commit` so HEAD never advanced; the commit was backgrounded (the documented
  way to avoid an agent-harness tool timeout) and was still running; or the commit landed in a
  *different* repo — a paired repo, a submodule, `git -C elsewhere` — leaving our HEAD untouched
  while `gitShortSha()` and `headChangedFiles()`, which both read the pm repo, attributed it here.

  Comparing subjects is subtler than it looks, and getting it wrong is worse than the original
  bug. `git log -1 --format=%s` yields only the **first line**, while a `-m` capture spans
  newlines and swallows the whole message — so a naive comparison suppresses every commit that
  has a body, silently disabling the hook for the common case. The comparison is therefore
  first-line-to-first-line, and a message the shell assembled (`-m "$(…)"`, a heredoc,
  `-m "$MSG"`) is treated as *unverifiable* rather than mismatched, because the command string
  holds the shell source rather than the text git received.

  All three reduce to one question: does HEAD hold the commit whose subject we just parsed?
  Comparing SHAs would need a stored baseline; the subject is already in hand. Note an
  **exit-code check would not have been sufficient** — a backgrounded commit has no exit code
  yet — which is why the two independently-reported issues share one fix.

  The guard is deliberately three-state. Only *contradicted* (a subject was parsed, git works,
  and HEAD disagrees) suppresses the entry. *Unverifiable* — no `-m` to parse, or git unusable
  in this directory — keeps the previous behavior, because the archived-epic self-heal must still
  run in a repo with no git at all.

  A local `detours.log` that confidently points at the wrong commit is worse than a missing
  line, since anything reconstructing "what happened around commit X" gets a confidently wrong
  answer. Note the log is untracked under a common global `*.log` ignore pattern, so the damage
  was confined to a working copy rather than repo history.

### Migration

- `0.24.0` stamps `platform` on existing state files, defaulting to `claude-code`. Additive and
  idempotent; a `0.23.1` state file still loads.

## [0.23.1] — 2026-07-23

### Fixed

- **`/pm:upgrade`'s own instructions now defend against a real misread: an agent treating the
  command invocation itself as passive local-command output and skipping it entirely.** When
  `/reload-plugins` and `/pm:upgrade` land in the same turn — the exact sequence this command's
  own preamble recommends — the harness wraps that turn's local command output in a caveat meant
  for `/reload-plugins`'s passive stdout, and an agent can over-apply that caveat to `/pm:upgrade`
  itself. Self-inflicted by this command's own documented workflow, not fixable by controlling
  the harness, so the command's own text now states plainly: if you're seeing these instructions,
  the command was invoked — execute it.

## [0.23.0] — 2026-07-21

### Added

- **`update-epic <id> --add-story "<title>"` and `update-epic <id> --story <n> --done`.**
  Closes a recurring hand-edit-of-`state.json` risk for inline `stories[]` — the toggle gap
  alone recurred across several sessions per user feedback, and the add gap was hit live
  again this session. `--add-story` appends `{ title, done: false }` (creating the array on
  its first inline story); `--story <n>` is **1-indexed** and currently requires `--done` (the
  only supported mutation today) — both reject out-of-range/empty input and write nothing on
  failure. Documented in README.md and `skills/conductor/SKILL.md`.
- **`render --diff-summary`** — prints `epic-relevant: yes` or `epic-relevant: no` after
  rendering. The "Last rendered" timestamp and the "Recent detours" table (which rotates as
  new entries land) both change PROJECT.md on nearly every render even when nothing about the
  epics themselves changed, forcing manual `git diff` eyeballing before every "is this safe to
  discard" call — and this repo hit a near-miss where a legitimately-updated PROJECT.md was
  discarded as assumed noise. `--diff-summary` normalizes both known-trivial sources away and
  reports whether anything else differs, making the check mechanical. A PROJECT.md that's
  never been rendered before always reports `yes` (no baseline to compare against).

### Fixed

- **The `conductor: engine <version> @ <path>` banner no longer prints on every single
  invocation in a self-hosting/dev context.** It's now suppressed by default whenever
  `CLAUDE_PROJECT_DIR` is set (the stale-cache scenario the banner exists to guard against is
  unlikely there) — set `PM_VERBOSE_ENGINE_BANNER=1` to force it back on. The existing
  `PM_QUIET_ENGINE_BANNER=1` explicit-suppress opt-out still works unchanged outside that
  context (e.g. as an installed plugin). Deliberately not a cached "last-seen-version" marker
  file — this repo had a real prior incident (`df-stale-cache-silent-fallback`) from a similar
  cache-file pattern going silently stale.
- **`.githooks/pre-commit` is now quiet on success.** It used to dump the full
  `node --test` output (every test name, the engine banner, tens of thousands of characters)
  on every single commit, even when everything passed — noisy enough that a genuine
  tool-output-truncation warning was once misread as a real git failure with the actual
  issue buried in it. Now it captures output to a temp file, checks the real exit code, and
  prints a one-line `pre-commit: N/N passing` summary on success; the full output (and a
  non-zero exit) only surfaces when a test actually fails.
- **`verify-worktrees` now also flags a hierarchy-child worktree whose branch is already
  merged, not just ones whose epic status is `archived`.** Added a second, independent
  trigger — `git merge-base --is-ancestor <branch-tip> HEAD` — that fires regardless of the
  epic's status field. Fixes the real scenario hit this session: `git branch -d` failed with
  "used by worktree" after a merge because the worktree was never removed, and the epic's
  status hadn't been (or wasn't going to be) flipped to `archived` either. Each flagged
  worktree's `reasons` array now lists which trigger(s) fired (`epic-archived`,
  `branch-merged`, or both) — still a pure read/report function, it never deletes anything
  itself.

### Changed

- **`scripts/conductor.mjs` split into `scripts/lib/*.mjs` modules — no behavior change.**
  The engine (2,537 lines, 85 functions) is now a 121-line entry point (CLI dispatch table +
  imports) plus 20 focused `scripts/lib/*.mjs` modules, one per pre-existing section (the
  "helpers" grab-bag split further into 6 cohesive modules: state I/O, git plumbing, plugin
  metadata, epic progress/resolution, link validation, autonomy). Motivated by AI-agent
  token-efficiency — editing a monolith costs a full-file read/orient regardless of change
  size — not human-readability tech debt. Purely internal: the CLI's subcommands, flags, and
  output are unchanged, verified by all 250 pre-existing black-box tests passing unchanged
  throughout every step of the split.

## [0.22.0] — 2026-07-20

### Added

- **On-demand AI-agent doc reference: `llms.txt`/`llms-full.txt`.** Mintlify auto-publishes both
  at `pm-plugin.dev` — `llms.txt` is a lightweight (~7KB) index of every doc page, `llms-full.txt`
  is the entire site as one markdown document (~200KB, tens of thousands of tokens). Referenced
  from the one-time orientation points that already exist (`/pm:init`'s step 0, the `conductor`
  skill's new "Further reference" section) rather than the persistent CLAUDE.md rules block —
  same "deep orientation is on-demand, not recurring" design as pointing at README since 0.6.0.
  `llms-full.txt` carries an explicit size/token warning at every reference point so it's never
  reached for as a default. Also added a docs-site pointer to README.md's intro, which had no
  link to `pm-plugin.dev` at all until now.

## [0.21.1] — 2026-07-20

### Added

- **Security scanning via `.github/workflows/security.yml`.** Calls the two reusable
  `workflow_call` workflows published in `cfdude/.github` — Semgrep SAST
  (`p/javascript`/`p/typescript`/`p/secrets`/`p/security-audit`) and a Trivy filesystem scan
  (CRITICAL/HIGH) — on push/PR to `main` and a weekly schedule, publishing SARIF results to the
  repo's Security tab. Both are non-blocking (never fail CI) by design in the reusable
  workflows themselves. `security-events: write` is granted explicitly in the caller since the
  repo's default `GITHUB_TOKEN` permission is read-only.
- **`SECURITY.md`** — vulnerability reporting instructions and a short architecture note (the
  engine's zero-dependency, instruction-layer-only design narrows its own attack surface).

### Repo settings (live GitHub changes, not code)

- Attempted to enable `secret_scanning_validity_checks` and
  `secret_scanning_non_provider_patterns` via the repo API — both accepted the request (200 OK)
  but did not change state, most likely gated behind a GitHub Advanced Security /
  Enterprise-tier entitlement not available on this account even though the repo is public.
  Basic secret scanning and push protection were already enabled and are unaffected.
- Confirmed `main`'s branch protection already covers required-status-check, required
  signatures, admin enforcement, and no force-push/delete — no changes needed there.
- Confirmed `delete_branch_on_merge` stays **off** — `dev` is a persistent branch reused every
  release, not a throwaway feature branch; auto-delete would break the `pr-workflow` skill's
  sync step.
- Renovate (org config in `cfdude/.github`) considered and explicitly skipped for now — `pm` is
  zero-dependency, so it would only manage the two GitHub Actions version pins in `ci.yml`.

## [0.21.0] — 2026-07-20

### Added

- **CLAUDE.md rules block gains an unconditional "Feedback" section** encouraging the agent to
  proactively use `/pm:feedback [bug|feature] "<summary>"` (or ask the user "want me to file
  this as feedback?") whenever it hits a bug, a missing CLI verb, or repeated friction — instead
  of silently working around it. Motivated by a real gap: `/pm:feedback` shipped in 0.14.0 and
  was never used once, while the friction of hand-editing `.conductor/state.json` to flip a
  story's `done` flag (no CLI verb exists for it) recurred silently across several sessions
  before being reported. Registered `df-update-epic-no-story-toggle-verb` as the concrete
  backlog fix this section should have prompted sooner.

## [0.20.1] — 2026-07-20

### Added

- **`/pm:upgrade` now recommends adopting relevant new capabilities.** After printing the
  changelog delta, the command's instructions tell the agent to review each `Added` headline,
  judge whether it's an opt-in capability (a new flag/subcommand/behavior, not a bug fix or
  automatic change) relevant to the repo's current `.conductor/state.json`, and recommend it —
  one line, one reason, the command to run — without enabling anything itself. Instruction-only
  change (`commands/upgrade.md`, `README.md`); no engine code or schema touched.

## [0.20.0] — 2026-07-20

### Added

- **Completion-time tracker resync instruction.** When an inward-pull-capable tracker is
  configured (a `github-issues` primary, or any secondary tracker), the CLAUDE.md rules block
  now adds a "Sync after completing tracker-linked work" section: after closing/transitioning a
  tracker-linked issue as part of completing an epic, re-sync with your tracker(s) (`/pm:sync`)
  right away, since you're already doing tracker I/O for that epic. Phrased tracker-count-
  agnostic ("your tracker(s)") so it reads correctly whether a repo has one tracker or several
  (primary + secondary).
- **Session-start sync nudge.** The SessionStart brief now includes a one-line, non-blocking
  nudge — "N tracker(s) configured (...) — consider `/pm:sync` this session to pull in any new
  issues" — whenever any tracker (primary or secondary) is configured. This is a reminder only;
  the engine never calls a tracker itself, and the agent decides whether syncing is worth it.
  Deliberately does not track a last-synced-at timestamp — the nudge is enough without it.

## [0.19.0] — 2026-07-19

### Added

- **Support a primary tracker plus zero or more secondary trackers.** `state.tracker` is
  unchanged and is now, implicitly, the **primary** tracker — full existing bidirectional
  behavior (outward issue creation on new epics, `statusIntent`-driven status transitions),
  including the `github-issues`-as-primary inward-only special case, byte-for-byte unchanged.
  New optional `state.secondaryTrackers[]` lets a repo also watch additional trackers — e.g.
  Jira as the real dev tracker plus a GitHub repo for inbound issues from outside contributors or
  another internal repo publishing cross-project notifications — via `set-tracker --role
  secondary --system <sys> --repo <repo>` (or `--project <key>`), removable with `--remove`.
  Secondary trackers get inward pull (open issues become untriaged epics) plus a new capability
  that didn't exist even for the old inward-only `github-issues` case: **completion status
  writeback** — when an epic sourced from a secondary tracker reaches `archived`, the agent
  closes the linked issue there too. Secondary trackers never receive outward-created issues;
  that stays exclusive to the primary tracker. Dedup for both inward pull and writeback now
  matches on `externalUrl` (globally unique) rather than bare `externalId` (only unique within
  one tracker/repo) — fixing a latent cross-tracker collision risk (e.g. issue `#42` existing in
  two different secondary-tracker repos) surfaced during this change's own Gate 1 review, before
  any code shipped.

## [0.18.0] — 2026-07-17

### Added

- **Mechanical pre-commit hook: the full test suite must pass immediately before every
  commit, enforced, not just documented.** A genuinely failing test was committed once already
  (0.16.0) because a prose reminder alone wasn't enough — "run the tests one more time before
  committing" is exactly the kind of rule that gets skipped under momentum. `.githooks/pre-commit`
  runs `node --test scripts/conductor.test.mjs` and blocks the commit on any failure. One-time
  setup per clone: `git config core.hooksPath .githooks` (documented in `CONTRIBUTING.md`). Found
  and fixed a real bug on first live use: git sets `GIT_DIR`/`GIT_INDEX_FILE`/etc. for hook
  processes, which leaked into the test suite's own child `git` processes (tmp-repo fixtures),
  causing them to operate against the outer repo's locked index instead of their own tmp dirs —
  the hook now unsets those variables before running tests.

## [0.17.0] — 2026-07-17

### Added

- **Added a mechanical test that catches README.md "Commands" drift from the real dispatch
  table**, mirroring the existing SKILL.md drift test. Running it against the current docs
  caught 8 real gaps (`commit-nudge`, `log-detour`, `honcho-memory`, `set-review-mode`,
  `verify-state`, `write-rules`, `snapshot`, `changesets`) — several of them genuinely
  undocumented user-facing subcommands (`honcho-memory`, `verify-state`, `changesets`), fixed
  in the same pass. `agents/hierarchy-child-executor.md`'s standing instructions and the
  conductor skill's epic-hierarchy preflight section now explicitly require a README.md update
  (not just SKILL.md) whenever a child epic adds/changes a user-facing command, flag, or
  behavior — the same class of gap that let `record-gate-review` ship in 0.16.0 with zero
  README mention.

## [0.16.0] — 2026-07-16

### Added

- **OpenSpec's two mandatory gates are now mechanically enforced at archive time, not just
  narrated.** Nothing previously checked that an `openspec`-lane epic actually passed Gate 1
  (spec review, before code) and Gate 2 (implementation review, before docs) before it was
  archived — an epic could go straight from `apply` to `archive` on narration alone. A new
  `record-gate-review <epicId> --gate 1|2 --verdict pass|fail [--reviewer "<note>"]` subcommand
  writes a fresh-context reviewer's verdict durably onto the epic (`gateReview.gate1`/`gate2`,
  mirroring `record-reconcile`'s shape), and `update-epic --status archived` now REJECTS the
  transition for any `openspec`-lane epic that doesn't already have a recorded
  `gateReview.gate2.verdict === "pass"`. Scoped strictly to the `openspec` lane —
  `superpowers`/`claude-code`/`decision`/`external` epics are completely unaffected, since they
  have no two-gate process.
- **Added a mechanical test that catches SKILL.md "Commands" drift from the real dispatch
  table.** `conductor.test.mjs` now extracts every subcommand key from `conductor.mjs`'s
  dispatch table and asserts each one is mentioned somewhere in `skills/conductor/SKILL.md`,
  failing CI the next time a new subcommand ships without a doc mention (the same bug class
  fixed once by hand in 0.12.0, now enforced instead of relying on someone remembering). Running
  it against the current docs caught two real gaps — `snapshot` (the PreCompact-hook-only
  re-render) and `write-rules` (the `/pm:init`/`/pm:upgrade`-only CLAUDE.md rules-block
  refresher) were both real, invoked subcommands with no mention anywhere in SKILL.md — fixed by
  adding a line for each to the Commands section.

### Changed

- **The `github-issues` tracker no longer tells the agent to auto-create a GitHub issue for
  every unmirrored local epic.** `rulesBlock()` now suppresses the outward "External tracker
  sync" section entirely when `tracker.system === "github-issues"`, leaving only the existing
  inward "GitHub issue sync" section (open issues → untriaged epics) in effect. Filing a public
  GitHub issue for any local claude-code epic just because a `github-issues` tracker is
  configured is a materially bigger, more consequential default than mirroring toward an
  internal Jira/Linear instance, so `github-issues` is now documented and implemented as
  INWARD-ONLY by design. Jira, Linear, and any other tracker `--system` keep the full
  bidirectional outward-mirror behavior unchanged.

### Fixed

- **`commit-nudge`'s auto-detour heuristic no longer false-positives on routine conductor
  bookkeeping.** A commit touching only pm's own state-output files (`.conductor/state.json`,
  `PROJECT.md`, `.conductor/render-stamp.json`) is never auto-logged as a stray minimal detour,
  even if it matches the `fix:`/`chore:` + `<=3 files` shape — this fired 3 separate times in
  one session (registering epics, archiving epics, granting autonomy), always on commits that
  were routine administration, never a real detour. `CLAUDE.md` is deliberately excluded from
  this allowlist: it's user-authored content, not purely engine-generated output, so a commit
  touching it could still be a genuine detour.
- **`render-stamp.json` no longer produces a spurious diff on every `render()` call when
  nothing meaningful changed.** Root cause: `writeRenderStamp()` unconditionally rewrote
  `.conductor/render-stamp.json` on every `render()` invocation, bumping its `renderedAt`
  timestamp even when `state.json` (and therefore the rendered `PROJECT.md` content) hadn't
  changed at all — producing a byte-only diff that had to be manually discarded roughly a
  dozen times across a single dogfooding session. `verify-state` (the mechanism this stamp
  exists for) only ever compares the recorded `stateMtimeMs` against `state.json`'s current
  mtime; it never reads `renderedAt` back for correctness. `writeRenderStamp()` now skips the
  rewrite entirely when the existing stamp's `stateMtimeMs` already matches `state.json`'s
  current mtime, so the sidecar file is only ever touched when something that actually matters
  changed. `.conductor/brief.txt` was confirmed already gitignored in this repo (a prior fix);
  no further action was needed there.

## [0.15.0] — 2026-07-15

### Added

- **Changesets-style fragment files replace direct `CHANGELOG.md` edits for hierarchy children.**
  Every parallel hierarchy-child batch was hitting a 100% collision rate on `CHANGELOG.md`'s
  shared `## [Unreleased]` header — every dispatched child edited the same section, guaranteeing
  a merge conflict on every multi-child batch. Children now write their changelog entry to
  `.changesets/<epic-id>.md` instead (same bullet format `CHANGELOG.md` already uses: a bold
  one-line summary, then wrapped prose). The orchestrator remains the sole writer of
  `CHANGELOG.md` — consistent with it already being the sole writer of `.conductor/state.json` —
  and consolidates all pending fragments into the real `[Unreleased]`/new-version section once,
  at release time, then deletes the consumed fragment files. A new zero-dependency `changesets`
  engine subcommand (`node conductor.mjs changesets`) lists `.changesets/*.md` fragments as
  `{ changesets: [{ id, path, body }] }`, sorted by epic id, to make that consolidation step
  mechanical rather than a manual `cat` + guesswork. (First real-world test, this very release:
  zero CHANGELOG.md conflicts across 3 parallel children, versus a 100% collision rate before.)
- **Mandatory post-resolution verification for the epic-hierarchy merge-conflict ladder.**
  After ANY conflict resolution (self-resolved by the orchestrator, via
  `agents/merge-conflict-resolver`, or via an escalated model/`advisor()` opinion), before the
  merge is committed: grep every touched file for leftover `<<<<<<<`/`=======`/`>>>>>>>` markers,
  and run `node -c` on every touched `.mjs`/`.js` file. Either failure means the file is still
  unresolved. Closes a gap found during this repo's own 0.14.0 dogfood run, where a resolution
  removed only the closing conflict markers and left the opening `<<<<<<< HEAD` marker in place
  — caught only by a manual re-grep, not by any required step.
- **Session-continuity check for live external-infra epics.** The `hierarchy-child-executor`
  agent now has a required checklist item: before finalizing its report, if the epic's work made
  a live change to external infrastructure the orchestrator itself depends on for the rest of the
  session (branch protection rules, credential/token rotation, webhook/API changes, etc.), it
  must explicitly answer "does this change affect how the orchestrator itself needs to operate
  for the rest of this session?" in CONCERNS — even an explicit "no" is required output, not
  silence. Fixes a real incident: `branch-protection-and-pr-workflow` applied live branch-
  protection settings to `main`, and the orchestrator's very next `git push origin main` was
  rejected — discovered only empirically, not flagged by that epic's own report.
- **README.md fully revamped.** Replaces the agent-facing, all-over-the-place structure with a
  Comet-inspired layout: a real banner image, honest badges (CI/version/license only — no
  DeepWiki/CodeCov/trending until the tooling behind them actually exists), a "Why Use PM?"
  section built from real, verifiable repo history (not a fabricated benchmark), a genuine
  "From Industry-Frontier Practice" write-up of the design patterns PM's architecture actually
  mirrors, a Supported Platforms table with an honest Status column (Claude Code: Supported;
  Codex/Gemini CLI/Grok Build/`AGENTS.md` format: Planned, tracked under
  `multi-platform-agent-support`), collapsible `<details>` command reference instead of one
  long flat table, and a Star History chart. Resolves `df-readme-stale-since-gate-guard`
  (README hadn't been touched since `f77d774`, missing everything shipped since).
- **Branch protection + PR workflow on `cfdude/pm`.** `main` now requires pull requests (no
  direct pushes), the `test` job from `.github/workflows/ci.yml` as a required status check,
  0 required approving reviews (solo maintainer), and squash-merge-only at the repo level.
  Day-to-day work moves to a new `dev` branch (created from `main`'s tip); PRs merge
  `dev` → `main`. See `CONTRIBUTING.md` for the full workflow. This is a live GitHub repo
  settings change, not a code change — no `state.json` schema impact.

---

## [0.14.0] — 2026-07-15

### Added

- **`github-issues` tracker: inward pull (open issues → new untriaged epics).** `set-tracker
  --system github-issues --repo <owner/name>` records a repo alongside the tracker's `system`.
  The rules block now gains a "GitHub issue sync" section (in addition to the existing outward
  "External tracker sync" mirror) telling the interactive agent — as part of `/pm:sync` — to
  `gh issue list --repo <repo> --state open`, skip issues already mapped to an epic via
  `externalId`, and register the rest with `add-epic --status untriaged --external-id <n>
  --external-url <url> --lane claude-code --priority P2` (a `P0`/`P1`/`P2`/`P3` label on the
  issue overrides the P2 default). The engine itself never calls `gh` — same instruction-layer
  law as every other tracker. `add-epic` now also rejects a duplicate `--external-id` outright
  (exits non-zero, writes nothing), so re-running sync can never create a duplicate epic for the
  same issue even off a stale local view. See `commands/tracker.md`, `commands/sync.md`, and the
  conductor skill's "Hierarchy & external trackers" section.
- **`.github/workflows/ci.yml`.** A GitHub Actions CI workflow on push to `main` and on every
  pull request targeting `main`, running Node 18.x: a `node -c` syntax check on
  `scripts/conductor.mjs` and `scripts/conductor.test.mjs`, then the full test suite via
  `node --test scripts/conductor.test.mjs`. This repo is zero-dependency, so "lint" here means
  the syntax check rather than a third-party linter. The job is named `test` (`jobs.test`) —
  a follow-up epic wires this job into required branch-protection status checks.
- **`/pm:feedback [bug|feature] "<summary>"`.** File a bug report or feature request against
  `pm` itself directly as a GitHub issue on `cfdude/pm`, from any session using the plugin —
  replacing the previous workflow of manually copy-pasting details between sessions. Pure
  command-doc addition: the interactive agent gathers the report, searches open issues on
  `cfdude/pm` for a near-duplicate title (commenting on a match instead of filing a new issue),
  and otherwise runs `gh issue create --repo cfdude/pm` with a `bug`/`enhancement` label,
  reporting back the issue URL. No engine code involved — `scripts/conductor.mjs` never calls
  GitHub itself; all `gh` calls are agent-invoked Bash, per the instruction-layer law. See
  `commands/feedback.md`.

## [0.13.0] — 2026-07-15

### Added

- **`record-reconcile <epicId> --detour <detourId> --verdict valid|invalidated
  [--amendments "<a>;<b>"]`.** The reconciler agent's verdict at the POP-protocol reconcile
  gate previously only ever lived in the conversation transcript. This subcommand writes a
  structured `{verdict, amendments, reconciledAt}` object onto the paused epic's link to the
  detour that triggered reconciliation (creating a `may-invalidate` link if none exists yet),
  and clears `reconcileNeeded` — so the judgment is durable in `.conductor/state.json` and
  visible in `PROJECT.md`, not just something Claude said once. `agents/reconciler.md`'s
  report format, `commands/resume.md`, and the conductor skill's POP protocol / rules block
  now describe this writeback step.
- **Per-repo lane-routing overrides.** New optional `laneRouting.overrides` config block in
  `.conductor/state.json` — keyword/glob rules (`{match, lane}`) checked BEFORE the generic
  lane heuristic when an agent decides which lane should build an epic. Set via the new
  `set-lane-routing --add "<match>:<lane>" [--add ...] | --remove "<match>" | --clear`
  subcommand; looked up via the new `suggest-lane "<free text>"` subcommand, which prints
  `{lane, matched}` JSON (`lane: null` means no override matched — fall back to the generic
  heuristic). Replaces the need for a CLAUDE.md prose carve-out when the generic heuristic is
  wrong for a repo (e.g. "anything touching billing always goes through openspec"). See
  `commands/lane-routing.md` and the `conductor` skill's "Lane routing overrides" section.
  Pure local state write — the engine still never assigns a lane itself; `add-epic` always
  takes an explicit `--lane`.
- **Per-epic review-mode override (escalation-only).** `update-epic <id> --review-mode
  off|standard|thorough` sets an epic-level override that can only ESCALATE above the
  repo-global `set-review-mode` dial — never de-escalate below it (an attempt to set a lower
  mode than the current global dial is rejected outright, state unchanged). `currentReviewMode`
  now accepts an optional `epicId` and returns the effective mode for that epic: the
  higher-ranked of the global dial and the epic's override. `rules --epic <id>` surfaces the
  effective per-epic mode in the emitted "Current mode" line. Lets one security-sensitive epic
  force `thorough` review without flipping an otherwise-`standard` repo's global dial.
- **Auto-detected minimal detours from commit diff shape.** `commit-nudge` (the
  `PostToolUse(Bash)` hook that already fires after every `git commit`) now recognizes an
  UNLOGGED minimal detour by its shape — a small commit (<=3 files changed) with a
  `fix:`/`chore:` conventional-commit subject, made while no detour is active, and not
  scoped to the currently active epic (a `fix(<active-epic-id>): ...` subject is read as
  that epic's own work, not a stray detour) — and appends an `AUTO-DETOUR` entry to
  `.conductor/detours.log` automatically, without waiting for `/pm:detour --minimal` to be
  run by hand. Three separate dogfooding sessions converged on "the agent forgets to log
  the minimal detour" as the #1 pain point; this closes that gap at the mechanism level
  (hook-driven, not agent-remembered) rather than relying on the agent to recall the rule.
  See `looksLikeUnloggedMinimalDetour()` / `headChangedFileCount()` in `conductor.mjs`.
- **`honcho-memory <push|pop> <epicId> "<reason>"` subcommand.** Formats the exact
  ready-to-copy one-line Honcho memory string for a detour-stack PUSH/POP (per CLAUDE.md rule
  4), prints it to stdout, and appends a timestamped copy to the new
  `.conductor/honcho-memories.log`. Previously the interactive agent had to compose that
  string itself from context on every PUSH/POP, with no engine support and no durable record
  of what was actually sent — easy to forget or word inconsistently. The engine still never
  calls Honcho itself (pure string formatting + local logging, staying inside the
  instruction-layer law); `commands/detour.md`, `commands/resume.md`, and the `conductor`
  skill's PUSH/POP protocols now call it and paste its output into the actual Honcho MCP call.
- **Dependency-aware ordering for the top-level queue, not just hierarchy siblings.** The
  brief's NEXT UP list (and thus `/pm:next`'s recommendation) now applies the same
  `depends-on` topological ordering `plan-hierarchy` already used for one parent's children to
  ALL top-level queued/untriaged epics: a higher-priority epic with an unresolved `depends-on`
  link to another still-queued epic is no longer listed (or picked) ahead of the dependency
  it's waiting on, even across otherwise-unrelated epics with no shared parent. When ordering
  overrides plain priority this way, the brief prints a one-line note naming the blocker, e.g.
  `⚠ epic \`high-blocked\` ready but waiting on \`low-dep\``. Unlike `plan-hierarchy`, a
  dependency cycle among queued epics does not error here — it's a display/selection helper,
  not an execution plan, so it falls back to the original priority order for the stuck
  remainder.
- **SessionStart upgrade nudge now inlines top Added-bullet headlines.** The
  `pm X.Y.Z → A.B.C available` nudge previously named only the old/new versions, forcing a
  separate `/pm:changelog` round trip to judge whether upgrading was worth mid-epic churn. It
  now inlines up to 3 "Added" bullet headlines (first line only, not the full multi-line body)
  drawn from every CHANGELOG.md section strictly between the stamped and newest version, so a
  session can judge upgrade value inline.
- **Category-based `--preauthorize` shorthand for epic-level autonomy.** `set-autonomy <id>
  --preauthorize "category:<filesystem|network|schema|external-api>:<reason>"` grants routine
  actions by category instead of requiring every one enumerated individually. Stored as a
  distinct `{ category, reason?, grantedAt }` grant shape alongside existing exact-action
  `{ action, reason?, grantedAt }` grants in the same `preAuthorized[]` array — exact-action
  matching is unchanged. Unknown categories are rejected with a non-zero exit and no state
  write. The matching heuristic each category expands to at decision-rule time (approximate
  by design) is documented in the `conductor` skill's "Epic-level autonomy — the preflight
  scan" section.

### Changed

- **Epic-level-autonomy decision rule now says "`--notify` incrementally as it happens," not
  "record for the end-of-epic report."** The `--notify` mechanism already writes durably to
  `state.json`'s `notifications[]` array; the prior wording implied WARN-class (c) and
  consequential (e) decisions were only gathered in-memory for a report assembled at the end
  of the epic, which loses them if the session is compacted or interrupted mid-epic. Fixed in
  both `CLAUDE.md`'s rules block and the identical generated block in
  `scripts/conductor.mjs`'s `renderRulesBlock`-equivalent. The end-of-epic report step now
  reads back `notifications[]` rather than being the primary record. No code change —
  `--notify`/`notifications[]` already worked this way; this is a wording fix so the documented
  process matches the existing mechanism.
- **Gate guard is now on by default whenever an epic owes a reconcile.** `gateGuardCheck()`
  now blocks `Edit`/`Write`/`NotebookEdit` unconditionally when the active epic's
  `reconcileNeeded` is `true`, regardless of the repo's `gateGuard` setting in
  `state.json` — `set-gate-guard off` no longer bypasses this specific case. Applies
  retroactively to any epic that already has `reconcileNeeded: true`, not just future detour
  POPs. Reverses the original opt-in design after real-usage feedback
  (`docs/feedback/2026-07-14-pm-plugin-improvement-feedback.md`) showed the guard had never
  actually been turned on across several sessions where it would have caught a real skip. The
  repo-level `gateGuard` flag and `set-gate-guard on|off` command still exist, reserved for any
  future generalization of the hook to other checks. See `commands/gate-guard.md` and the
  `conductor` skill's POP protocol.

### Fixed

- **`missing()` now excludes `status === "archived"` epics.** An already-archived openspec
  epic (proposed, built, and archived — its `openspec/changes/<id>` directory legitimately
  moved to `openspec/specs/` by the archive process) could still render the unresolvable
  "⚠ no change on disk" warning forever if its on-disk archive-dir name didn't match
  `isArchived()`'s dated-prefix convention. Same class of bug already fixed for
  `planHierarchy()` (`df-plan-hierarchy-includes-archived-children`, 0.12.1), applied here to
  the missing-change-warning code path.

## [0.12.2] — 2026-07-15

### Added

- **`startedAt`/`completedAt` timestamps on epics, and a staleness indicator.**
  `set-active` now stamps `startedAt` (ISO string) the first time an epic goes active
  (re-activation after a demotion does not reset it); `update-epic --status archived` stamps
  `completedAt`. Both fields are purely additive — existing epics simply lack them until
  touched, so no migration is needed. `PROJECT.md`'s epic table, its "Now" section, and the
  brief's `NOW`/`NEXT UP` lines all surface `⚠ stale, Nd active` for any epic with `startedAt`
  set, no `completedAt`, and more than 14 days elapsed — supporting velocity tracking and the
  weekly Ship-Real-Software check.
- **`verify-state` subcommand.** `render()` now writes `.conductor/render-stamp.json`
  (`renderedAt` + the state.json mtime it rendered from) every time it runs. `verify-state`
  compares state.json's current filesystem mtime against that stamp and fails loudly
  (non-zero exit, clear stderr) if state.json was modified after the last recorded render —
  mechanical evidence of an undetected hand-edit, which CLAUDE.md explicitly forbids
  (state.json/PROJECT.md must only change through the engine's subcommands). Also fails
  loudly if no stamp exists yet (state.json has never been rendered).
- **Engine version+source banner on every invocation.** `conductor.mjs` now prints
  `conductor: engine <version> @ <path>` to stderr on every run (silenceable via
  `PM_QUIET_ENGINE_BANNER=1`). Discovered live while dogfooding: `$ENGINE` resolution had
  silently picked up the installed plugin cache's `0.12.0` copy while this repo — the plugin's
  own source — was already at `0.12.1`, with no signal anything was stale.

### Fixed

- **ENGINE-resolution snippets (skill doc + every command doc) now prefer a repo-local
  `$CLAUDE_PROJECT_DIR/scripts/conductor.mjs` before `$CLAUDE_PLUGIN_ROOT` and the installed-cache
  fallback.** When the repo being worked on IS the pm plugin source (self-hosting), that copy is
  always the one under active development and should win over a stale cached install.

## [0.12.1] — 2026-07-15

### Fixed

- **`plan-hierarchy` no longer includes already-archived children in a hierarchy plan.**
  Children were filtered by `parent` only, with no status check — a done child (e.g. one
  already merged and archived from a prior dispatch batch) still showed up in the plan,
  indistinguishable from real pending work. Discovered via the first live dogfood resumption
  against `pm-plugin-improvements-2026-07-14`. Excluding `status === "archived"` from the
  children filter also correctly makes a `depends-on` reference to an archived sibling fall
  outside the hierarchy's dependency graph — the same existing behavior as a link to any epic
  outside the hierarchy, since a done dependency imposes no wait.

## [0.12.0] — 2026-07-15

### Added

- **`verify-worktrees` — orphaned hierarchy-dispatch worktree detection.** Cross-references
  `git worktree list` against epic status: any worktree on a `hierarchy-child/<epic-id>` branch
  whose epic is already archived (successfully merged and closed out) is flagged. Bakes worktree
  hygiene into the plugin itself — checkable on any fresh install — rather than depending on a
  user's personal CLAUDE.md discipline. Pure read, flags without deleting.
- **Worktree-isolated epic-hierarchy dispatch, replacing the original "just dispatch in
  parallel" instructions.** Discovered via the first live dogfood attempt against a real
  hierarchy (every child touched `scripts/conductor.mjs`): concurrent children mutating shared
  files was a real, unaddressed race. Each child now works in its own git worktree; children
  never write `.conductor/state.json` themselves (the orchestrator is the sole writer, applied
  once per batch); worktree branches merge back sequentially. An ordinary merge conflict is
  never a hard stop — it's resolved via a tiered ladder (normal merge → dispatch the new
  `agents/merge-conflict-resolver` → escalate to a stronger model/`advisor()` → commit
  best-effort + log a follow-up epic under the same parent) — a direct, consistent application
  of epic-level autonomy's existing decision rule, since a git-tracked conflict is always
  recoverable via history (criterion (c), never the unconditional-stop criterion (b)).
- **`agents/merge-conflict-resolver.md`** — a new packaged agent (mirrors `reconciler.md`'s
  shape) dispatched to resolve a worktree-merge conflict, reporting `resolved`/`uncertain`/
  `failed` so the orchestrator knows whether to escalate further.

### Fixed

- Doc drift in the conductor skill's Commands line: `remove-epic`, `plan-hierarchy`, and
  `verify-worktrees` were all missing despite `remove-epic`/`plan-hierarchy` already having
  shipped in prior releases.

---

## [0.11.0] — 2026-07-15

### Added

- **`remove-epic <id> [--cascade]` — hard-delete an epic**, replacing the raw `git checkout`
  workaround that was the only prior recovery from a mis-registered epic. Blocked by default if
  the epic has children: prints a concise `(id, title, lane/priority/status)` table of the parent
  plus every child and exits non-zero, so removing a parent with descendants is always a
  deliberate, informed choice; `--cascade` removes the epic and all descendants together in one
  atomic write. Any other epic's `links[]` entries referencing a removed id are stripped
  automatically, with a warning naming the affected epics. Recoverable only via git history —
  deliberately no in-app undo, since this verb exists specifically to replace that workaround, not
  add a softer one next to it.

---

## [0.10.0] — 2026-07-14

### Added

- **`plan-hierarchy --parent <id>` — batched execution plan for a parent epic's children.**
  Computes batches from data pm already tracks (no new persistent state): `priority` and
  `depends-on` links between siblings drive a topological sort — children with no dependency on
  each other land in the same batch (dispatchable in parallel), children in a dependency chain
  land in separate, ordered batches. Each child is annotated with whether it already has
  `autonomy.level: "autonomous"` (from epic-level autonomy), so a hierarchy dispatch never fires
  a child that hasn't been preflighted. Each child also carries `dependsOn`, its sibling
  dependency ids within the hierarchy, so a blocked-child handler can check whether a later
  batch depends on it (directly or transitively) rather than guessing from batch order alone.
  A dependency cycle among children is rejected outright, naming the cycle path, rather than
  producing a bogus order.
- **`agents/hierarchy-child-executor.md` — a packaged subagent** dispatched once per child epic
  in a batch: front-loaded with the epic's full context and its autonomy grant, works the epic
  to completion using its lane's normal workflow, follows epic-level autonomy's decision rule
  for genuine stops, and returns a fixed report (`STATUS`/`DONE`/`DECISIONS`/`CONCERNS`).
- The `conductor` skill documents the full end-to-end process: preflight every child up front
  (reusing epic-level autonomy's scan, consolidated into one batch of questions) → `plan-hierarchy`
  → dispatch batch by batch (parallel within a batch, sequential across batches) → one
  consolidated end-of-hierarchy report flagging anything controversial.
- Deferred to a later release: the fuller execution-strategy-selection framework (plain
  subagents vs. the Workflow tool vs. other execution modes) — this release covers only
  subagent-per-child dispatch.

---

## [0.9.3] — 2026-07-14

### Fixed

- **`add-epic --link` accepted a malformed value silently instead of erroring.** It split the
  string on `:` and stored whatever came out with no validation — a typo like
  `type:related:epic:...` parsed successfully as `{type:"type", epic:"related"}` since nothing
  checked that `"related"` was a real epic id. `parseLinkFlags()` now requires at least two
  segments and that `<epic>` references a known, existing epic id, rejecting otherwise with a
  clear error (shared by `add-epic` and `update-epic`).
- **`update-epic` had no `--link` flag**, so a malformed link (from before this validation
  existed, or from a hand-edit) had no CLI path to fix — forcing a direct `state.json` edit,
  which is what caused a reported em-dash JSON-escaping corruption across unrelated epics.
  `update-epic <id> --link "<type>:<epic>[:<reason>]"` now REPLACES the epic's links wholesale
  (unlike the other flags, which patch a single field) — the intended fix path.

---

## [0.9.2] — 2026-07-14

### Added

- **`set-gate-guard <on|off>` — optional, opt-in `PreToolUse` guard hook.** Blocks
  `Edit`/`Write`/`NotebookEdit` while the active epic still owes a reconcile after a detour
  POP (`reconcileNeeded`). Off by default and dormant until `/pm:init`. This is the one place
  pm's law tolerates mechanical blocking over pure instruction — it protects the single
  highest-stakes skip (writing source before the reconcile gate runs) as a deliberate,
  reversible opt-in, never a silent default.

### Fixed

- **POP protocol never actually told you to SET `reconcileNeeded`.** The conductor skill
  documented clearing it after reconciliation, but never setting it true on the paused epic
  before its detour-stack frame is popped — without that, the flag (and the new gate guard)
  would never actually trigger. Documented as a hand-edited step, mirroring how the frame
  itself is already hand-edited.
- **Doc drift in the conductor skill:** the Commands line and `state.json` reference were
  missing `set-autonomy`, `set-review-mode`, `autonomy`, `reviewMode`, and `gateGuard` — none
  had been added when those features shipped in 0.8.0/0.9.0.

---

## [0.9.1] — 2026-07-14

### Fixed

- **Regression from 0.8.4: `reconcileNeeded` was cleared on an active epic with no live
  detour frame, defeating the post-pop reconcile gate.** POP protocol removes the detour-
  stack frame BEFORE reconciliation runs, so deriving the flag purely from live-frame
  presence wiped it out at exactly the moment it needed to stay true (just-resumed,
  reconcile not yet done). `reconcileArchived()` now only recomputes what's safely
  derivable from current state: an archived epic always clears it (reconcile is moot); a
  still-paused epic with a live `reconcileOnResume` frame gets it forced true; anything
  else stale heals to false only if it's NOT the current active epic, since that's exactly
  the legitimate post-pop-pre-reconcile window.

---

## [0.9.0] — 2026-07-14

### Added

- **`set-review-mode <off|standard|thorough>` — a bounded, repo-level review-count dial.**
  Incorporates Comet's `review_mode` concept: a single setting (not per-epic) replacing an
  ad-hoc "how many reviews, when" judgment call with an explicit, dedup'd table. `off` = self-
  review only; `standard` (default when unset) = one fresh-context reviewer per gate; `thorough`
  = two independent reviewers per gate with disagreement adjudicated by you. Writes
  `state.reviewMode` and refreshes the CLAUDE.md rules block's new unconditional "## Review
  mode" section, which always shows the currently active mode. Pure instruction-layer — no
  external calls.

---

## [0.8.4] — 2026-07-14

### Fixed

- **Recompute-don't-remember: `.active` validity and `reconcileNeeded` are re-derived from
  disk, not trusted as stored flags.** `reconcileArchived()` previously only cleared `.active`
  when it pointed at an *archived* epic — a pointer referencing an epic id missing entirely
  from `state.epics` was never healed. `reconcileNeeded` was pure remembered state (set/cleared
  only by hand-editing per the PUSH/POP protocol), with no recovery if a session lost context
  mid-detour. Both are now recomputed from ground truth (the epics array, the detour stack's
  `reconcileOnResume` frames) every time `render()` runs — including at the end of `/pm:resume`
  — healing stale flags in either direction. `brief()` stays deliberately read-only, displaying
  the same recomputed truth in-memory without persisting.

---

## [0.8.3] — 2026-07-14

### Fixed

- **`state.json` writes are now atomic (tmp+rename).** `saveState()` previously wrote directly
  via `writeFileSync`; a crash or kill mid-write could leave a truncated, unparseable
  `state.json` with no recovery path. Now writes to a `.tmp-<pid>-<ts>` file in the same
  directory and `rename(2)`s over the real path — atomic on the same filesystem, so a crash
  leaves a truncated tmp file instead of corrupting the system of record.

---

## [0.8.2] — 2026-07-14

### Fixed

- **`KNOWN_STATUSES` omitted `later`/`blocked` despite both being documented** in the README's
  Epic statuses table and `commands/init.md` — `add-epic`/`update-epic --status later` (or
  `blocked`) was rejected outright. Both statuses now validate and persist correctly; NEXT UP
  already excluded them (only `queued`/`untriaged` are included) with no other code change
  needed, and they correctly still count in the lanes rollup (only `planned` is excluded from
  both NEXT UP and the rollup, per the documented distinction).

---

## [0.8.1] — 2026-07-14

### Fixed

- **`update-epic` silently no-op'd on an unrecognized flag.** A typo'd or unwired flag would
  parse, run `saveState`/`render`, and print `conductor: updated '<id>'` even though nothing
  changed — the only way to catch it was cross-checking `git diff`. `update-epic` now validates
  its flags against a known set and exits non-zero with an "unknown flag" error instead of a
  false success.
- **`update-epic` had no `--title` flag.** `add-epic` supports `--title` at creation, but
  correcting a title after an investigation changes what an epic is actually about (a common,
  legitimate mid-epic event) had no CLI path and required hand-editing `state.json`, which the
  tool explicitly discourages. `update-epic <id> --title "..."` now works.

---

## [0.8.0] — 2026-07-13

### Added

- **`set-autonomy <id>` — per-epic autonomy contract.** An epic can be granted broad execution
  trust (`autonomy.level: "autonomous"`, default `"off"` — unchanged behavior) so it runs through
  phase transitions without stopping for permission each time. Autonomy is granted only after a
  preflight risk-scan (documented in the `conductor` skill) records the user's pre-authorized
  actions and supplied context via `--preauthorize`/`--context` (repeatable, additive). A
  five-criteria execution-time decision rule (injected into the CLAUDE.md rules block) still
  hard-stops for anything with no backup/restore path or no context to act on — autonomy never
  overrides a genuine safety gate, only removes false ones. `PROJECT.md` and the session brief
  mark an autonomous epic with 🤖. Tracker-linked epics (Jira etc.) get an addendum covering
  lane-aware source reading, non-authoritative comment-mirroring of approvals, and mid-run drift
  as its own stop condition.
- Development-time scope only — this does not cover actions with irreversible EXTERNAL side
  effects (sending email/Slack, deploying to production, third-party API calls, pushing to a
  shared branch); those remain out of scope regardless of autonomy level.

---

## [0.7.0] — 2026-07-08

### Added

- **`set-active <id>` / `clear-active` — a CLI verb for the top-level active epic** (closes
  [#1](https://github.com/cfdude/cfdude-plugins/issues/1)). Previously `.active` — the pointer the
  briefing's "NOW" line reads — had *no* CLI setter, so `/pm:next`'s "make it active" forced
  hand-editing `state.json`, against the "CLI is the safe interface" model. `set-active <id>`
  (positional id) sets the pointer; `clear-active` drops it.

### Fixed

- **`.active` and `status: "active"` can no longer silently disagree.** They were independent
  fields — `update-epic --status active` flipped the status but left `.active` null, so the brief
  reported "no active epic" despite an active epic. Now a single-active invariant is enforced
  through every CLI path: `set-active`, `update-epic --status active`, and `add-epic --status
  active` all set `.active` **and** the epic's status together and demote any previously-active
  epic to `queued`; moving the active epic off `active` (or `clear-active`) clears the pointer.
  `set-active` rejects an unknown or archived id.

### Changed

- **Skills/commands resolve the engine version-independently.** The `conductor` skill and `/pm:next`
  now prefer `$CLAUDE_PLUGIN_ROOT` and fall back to the newest installed `conductor.mjs`
  (`ls -t …/pm/*/… | head -1`) instead of embedding a versioned cache path like `…/pm/0.6.1/…`,
  which broke on upgrade. `set-active`/`clear-active` are documented in `/pm:next`, `/pm:epic`, the
  skill, and the README.

### Upgrade

Minor release — no schema change, no data migration. Update the plugin → `/reload-plugins` →
`/pm:upgrade`.

---

## [0.6.1] — 2026-06-26

### Fixed

- **Archived OpenSpec epics stayed stuck as the active epic.** `isArchived()` only matched an
  archive dir named exactly `<id>`, but OpenSpec archives a change as
  `openspec/changes/archive/<YYYY-MM-DD>-<id>`. So the engine never detected the archive: the epic
  kept its `active` status, `state.active` kept pointing at it, `/pm:status` showed a finished epic
  as **NOW**, `/pm:next` wouldn't advance, and the epic could even be mis-flagged "⚠ no change on
  disk." Fixed three ways:
  - `isArchived()` now matches both the exact id and OpenSpec's date-prefixed dir.
  - **Display honesty:** `render`/`brief` no longer present an archived epic as the active one —
    they show "(no active epic — `X` was archived)", so `/pm:status` and `/pm:next` are correct
    immediately, with no state mutation.
  - **Self-heal:** a new `reconcileArchived()` clears an `active` pointer aimed at an archived epic
    and stamps `status: archived`. It runs in `sync`, `commit-nudge` (so the state heals on the
    same commit that archives the change), `init`, and `upgrade` — no more hand-editing
    `state.json` after an archive.

### Upgrade

Patch release — no schema change, no data migration. Update the plugin → `/reload-plugins` →
`/pm:upgrade`.

---

## [0.6.0] — 2026-06-25

### Added

- **Knowledge surfacing — the plugin now teaches the agent at the two moments that matter.**
  Previously an upgrade exposed new commands but never explained *what* it brought, and a
  first-time install gave the agent no orientation beyond command descriptions. Closed both:
  - **`/pm:upgrade` prints a changelog delta.** After applying migrations, the engine reads its
    own `CHANGELOG.md` and prints every entry in `(stamped, running]` — so the agent and user see
    exactly what the version added, not just that it happened.
  - **New `changelog` subcommand + `/pm:changelog [--since <x.y.z>]`.** On-demand changelog delta;
    defaults its floor to the version stamped in this repo's `state.json`. Zero-dependency
    markdown parsing (sections split on `## [x.y.z]` headers); graceful when no CHANGELOG ships.
  - **`/pm:init` orients the agent first.** Init now instructs the agent to load the `conductor`
    skill (the agent-facing how-to) — and points at the shipped `README.md` for deeper reference —
    so even a cold install of a much-later version knows how to drive the plugin. Deep orientation
    stays a one-time/on-demand load; the persistent CLAUDE.md rules block remains the recurring
    anchor (no full-orientation injection every session).

### Upgrade

Minor release — no schema change, no data migration. Update the plugin → `/reload-plugins` →
`/pm:upgrade`; the upgrade will now print what this version (and any you skipped) brought.

---

## [0.5.1] — 2026-06-25

### Fixed

- **Multi-version upgrade ordering (hardening).** `upgrade()` already replayed every migration
  newer than the stamped version, so a repo several versions behind (e.g. `0.2.0 → 0.5.x`) was
  upgraded correctly. This release makes that guarantee robust: migrations are now applied **sorted
  by release** (independent of array authoring order), the `MIGRATIONS` array is documented as
  **append-only / never-reorder**, and a regression test asserts a two-versions-behind repo replays
  *both* the 0.3.0 (lane) and 0.5.0 (link-normalize) migrations in order.

- **Tracker detection no longer over-triggers on Git hosting.** The `/pm:tracker`, `/pm:init`, and
  `/pm:upgrade` detection guidance previously let the agent infer a tracker from the fact that a
  repo is hosted on GitHub. Hosting on any Git service (GitHub, GitLab, Bitbucket, …) is **not** a
  signal — they all have issues/PRs, but a remote is not evidence that work is managed there.
  Detection now requires a *real* signal (an in-use tracker MCP, issue-key conventions, or an
  explicit statement), frames tracker mirroring as an **optional choice**, and reassures that
  declining loses nothing — the conductor always tracks everything locally in
  `.conductor/state.json` + `PROJECT.md`; a tracker only *adds* an external mirror. Choosing a Git
  host as the tracker (issues + PRs) remains fully valid.

### Upgrade

Patch release — no schema change, no data migration. Update the plugin → `/reload-plugins` →
`/pm:upgrade` to stamp `0.5.1` and refresh the rules/command docs.

---

## [0.5.0] — 2026-06-25

### Added

- **First-class epic hierarchy.** Epics gain an optional `parent` field (single-parent tree,
  arbitrary depth). `add-epic --parent <id>` validates the reference (must exist, no self-parent,
  no cycle) via a shared `parentError()` ancestor-walk helper. `PROJECT.md` renders children
  indented beneath their parent (`└─`, deepened per level), groups families ordered by parent
  priority, and shows an `X/Y children archived` rollup in the parent's Progress cell. The
  briefing's NEXT UP annotates a child with its parent id. **Grouping is render-only** — the
  `resolveEpics` priority sort is untouched, so a P0 child of a P2 parent keeps its NEXT UP slot.

- **External-tracker awareness (instruction layer only).** An optional `tracker` block in
  `state.json` (`system`, `instance`, `projectKey`, `mechanism`, and a semantic `statusIntent`
  map) makes the conductor *aware* a project mirrors epics to Jira/GitHub/Linear. **The engine
  never calls the tracker** — it only shapes the instructions it already emits:
  - the CLAUDE.md rules block gains an "External tracker sync" section assigning the interactive
    agent ownership (create issue + record key; transition on status change toward the semantic
    `statusIntent`; parent epic → tracker epic);
  - the briefing gains a `TRACKER SYNC` block listing only honestly-computable drift — active-work
    epics (`queued`/`active`/`paused`, excluding `missing()` ghosts) with no `externalId`. No
    transition-drift is fabricated (the engine cannot see tracker state).
  - New `set-tracker` subcommand (repeatable `--intent <status>:<target>`; `parseFlags` now
    accumulates `intent` like `link`) writes the block and refreshes the rules.
  - New per-epic `externalId`/`externalUrl` fields (on `add-epic` and `update-epic`).
  - New **`update-epic <id>`** write-back subcommand (positional id) mutates
    `externalId`/`externalUrl`/`parent`/`status`/`priority` on an existing epic under the same
    validation as creation — closing the sync loop after the agent creates an issue.
  - New `/pm:tracker` command doc; `/pm:init` and `/pm:upgrade` gain an agent-driven detection
    step (detect signals → confirm with the user → `set-tracker`; upgrade only when unset).

- **Atomic bulk creation.** New `add-many --from <path|->` reads a JSON `{ parent?, epics[] }`
  batch. If `parent` is present it is created first and children default their `parent` to it.
  Every entry is validated up front (id format, uniqueness vs existing AND within the batch, lane,
  status, parent refs + intra-batch cycles); on any failure nothing is written and it exits
  non-zero. A valid batch persists in a single write — removing the race that forced chaining
  individual `add-epic` calls. JSON only (the engine stays zero-dependency).

### Fixed

- **Stale-link rendering.** `render()` and the briefing now emit a link only when both its `type`
  and `epic` are strings (shared `validLink()` helper), so malformed or older-schema link entries
  no longer render as `undefined undefined`.

### Migration

- **0.5.0 migration (repair-first).** `MIGRATIONS` gains a `0.5.0` entry that normalizes stored
  `links`: valid `{type, epic}` objects pass through, the documented colon-string encoding
  `type:epic[:reason]` is repaired into an object, and unrecoverable entries are dropped. Additive
  and idempotent. Defensive rendering (above) is the shape-agnostic durable fix.

### Compatibility

All additions are optional and backward-compatible: a `state.json` written by v0.4.1 loads
unchanged, and a 0.5.0-written state remains loadable by the older engine (it ignores the new
optional fields).

### Upgrade

**Existing repos:** update the plugin → `/reload-plugins` (or restart) → `/pm:upgrade` per repo.
The upgrade runs the additive, idempotent 0.5.0 migration, refreshes the rules, and stamps
`pmVersion: 0.5.0`. To make a repo tracker-aware, run `/pm:tracker` (or answer the detection
prompt during `/pm:upgrade`).

---

## [0.4.1] — 2026-06-22

### Added

- **`/pm:upgrade` staleness guard.** `/pm:upgrade` now checks whether the running engine
  version matches the newest installed version before proceeding. If they differ (i.e. the
  plugin was updated but Claude Code has not been reloaded), it refuses with a clear message
  — "this is pm <old> but <new> is installed; run `/reload-plugins` or restart Claude Code
  first" — instead of silently re-stamping an old version. From 0.4.1 forward every upgrade
  is self-guarding.

- **SessionStart nudge fires from newest installed version.** The upgrade nudge in the
  SessionStart briefing now keys on the newest installed version (from the plugin's
  `plugin.json`) rather than the running engine version. This means the nudge fires even
  before you reload Claude Code, and it names the full sequence: (1) reload/restart; (2)
  `/pm:upgrade` per repo.

- **Documented update sequence.** `upgrade.md` and README both document the required
  three-step sequence: update the plugin → `/reload-plugins` or restart → `/pm:upgrade`
  per project. The upgrade command note now explains why the reload step is mandatory
  (Claude Code loads the engine at session start).

### Limitation

The staleness guard ships inside 0.4.1, so the first upgrade *into* 0.4.1 still runs the
old 0.4.0 engine until you `/reload-plugins`. From 0.4.1 forward every upgrade is
self-guarding.

### Upgrade

**Existing repos:** run `/pm:upgrade` after updating — refreshes rules, stamps 0.4.1 into
`state.json`. Idempotent; safe to run multiple times. No data migration required. Remember
to `/reload-plugins` first (see above).

---

## [0.4.0] — 2026-06-18

### Added

- **`status: planned` — roadmap as ordered backlog.** A new epic status for items that are
  known, sequenced, but not yet ready to start. `planned: N` appears as a brief summary line
  in the briefing; planned epics are excluded from NEXT UP and the lanes rollup, but are
  shown in the PROJECT.md epics table so the full backlog is visible.

- **`sync` auto-transitions proposed planned epics → untriaged (openspec lane).** When
  `sync`/`init` discovers a new OpenSpec change on disk and an epic with the same id already
  exists with `status: planned`, it transitions that epic to `untriaged` automatically so it
  enters the normal triage flow without manual state editing.

- **PROJECT.md stamp-on-content-change only.** `render` now compares the new output to the
  current file before writing; if the content is identical, the file is not touched. Prevents
  mtime churn and spurious git diffs when nothing meaningful changed.

- **`add-epic` validates `--status` against known statuses.** Passing an unknown status to
  `/pm:epic add` is now an error rather than silently stored. A valueless-flag guard also
  catches `--status` with no argument (e.g. `--status --lane`) and reports a clear error
  instead of treating the next flag as the status value.

- **Portable `ls -t` glob in command docs.** The `find`-based file listing in `sync` command
  documentation is replaced with a portable `ls -t` glob, removing a macOS/GNU `find`
  incompatibility.

- **`--status` documented in `/pm:epic`.** The `add` sub-command now shows all valid status
  values (including `planned`) in its help text and the commands table.

- **Roadmap on-ramp guidance.** README and SKILL document how to import an existing roadmap
  into the conductor without parsing: in an interactive session, read the roadmap doc and
  register each item via `/pm:epic add … --status planned`, choosing the appropriate
  execution lane. The conductor does not parse roadmap files automatically.

### Changed

- Rules block wording updated: documents `planned` status (roadmap on-ramp), auto-transition
  of planned epics on `sync`, and stamp-on-content-change behaviour.

### Upgrade

**Existing repos:** run `/pm:upgrade` after updating — refreshes rules, stamps 0.4.0 into
`state.json`. Idempotent; safe to run multiple times. No data migration required.

---

## [0.3.0] — 2026-06-18

### Added

- **Lane-agnostic epics.** Epics are no longer restricted to OpenSpec proposals. Every epic
  now carries a `lane` tag — `openspec | superpowers | claude-code | decision | external` —
  so the conductor tracks the full backlog regardless of how work is executed.

- **Epic schema fields.**
  - `lane` (string, optional, backward-compatible): execution lane. Defaults to `"openspec"`
    on read so existing `state.json` files are unaffected.
  - `planPath` (string, optional): repo-relative path to a Superpowers/markdown plan file.
    Used as a progress source when `stories[]` is absent.
  - `stories` (array, optional): inline `{ title, done }` story list. Highest-priority
    progress source.

- **Progress precedence resolver.** `epicProgress(epic)` replaces `storyProgress(id)` and
  resolves progress in order: `stories[]` → `planPath` checkboxes → `openspec/changes/<id>/tasks.md`
  → `—`. A dangling `planPath` renders `⚠ planPath missing` rather than silent `0/0`.

- **Non-OpenSpec epics in the briefing.** Non-OpenSpec epics now appear in NEXT UP and the
  Epics table. Only OpenSpec epics missing their on-disk change are flagged `⚠ no change on
  disk`; other lanes are shown as-is.

- **Bounded briefing.** NEXT UP is capped at **top-5** by priority-then-lane, with a
  per-lane count summary (`lanes: openspec 4 · superpowers 12 · claude-code 9`) and a
  `(+N more — see PROJECT.md)` overflow line, so the briefing stays compact regardless of
  backlog size.

- **`/pm:epic add`.** Registers a new epic directly (no `state.json` edit required):
  ```
  /pm:epic add --id X --title "…" --lane superpowers --priority P1
  ```
  Validates id format (`^[a-z0-9][a-z0-9._-]*$`), lane, and uniqueness. Optional flags:
  `--plan PATH`, `--status STATUS`, `--link "type:id:reason"`.

- **`sync` imports Superpowers plans.** `docs/superpowers/plans/*.md` are scanned on
  `sync`/`init` and registered as lane-`superpowers` epics (id = filename without `.md`,
  `planPath` set, title from first `#` heading). Additive and id-collision-safe (colliding
  ids are skipped with a warning). The plans directory may be absent — the scan returns `[]`
  gracefully.

- **Version-aware upgrade subsystem.**
  - `init` and `upgrade` stamp `pmVersion` (the running release) into `state.json`.
  - `brief()` compares the stamped version to the running release; if older, prepends a
    one-line upgrade nudge (re-shown every SessionStart and PreCompact until resolved).
  - **`/pm:upgrade`** runs registered migrations (those whose `release` is newer than the
    stamped version), then unconditionally refreshes the CLAUDE.md rules block, re-renders
    `PROJECT.md`, and re-stamps `pmVersion`. Idempotent — a second run is a no-op.
  - **0.3.0 migration:** stamps an explicit `lane: "openspec"` on any epic lacking one,
    making `state.json` self-describing.

- **Lane-agnostic detour rules.** A substantial detour becomes its own **epic in the
  appropriate lane** (not necessarily an OpenSpec proposal). The `rulesBlock()` wording and
  PUSH/POP templates are updated accordingly.

### Changed

- Epics table header changed from `Epic (OpenSpec change)` to `Epic`; a **Lane** column is
  added. Epics are sorted by priority rank then lane rank in both `PROJECT.md` and the brief.
- NOW line includes the lane tag.
- `rulesBlock()`: "epics = proposals" replaced with "epics are lane-agnostic; OpenSpec is
  one lane (openspec | superpowers | claude-code | decision | external)."

### Upgrade

**Existing repos:** after updating the plugin, run `/pm:upgrade` once. It will:

1. Refresh the CLAUDE.md rules block with lane-agnostic wording.
2. Stamp explicit `lane: "openspec"` on all pre-0.3.0 epics.
3. Record `pmVersion: "0.3.0"` in `state.json` so the upgrade nudge stops appearing.

The command is **idempotent** — running it more than once is safe and produces no changes on
the second run. No data is lost; the migration is purely additive.

---

## [0.2.0] — 2026-06-01

Initial public release. Tracks OpenSpec proposals as epics, maintains an explicit detour
stack, and enforces a reconcile gate so nothing is lost when development pivots or context
is compacted.
