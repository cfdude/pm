# CLAUDE.md

> Project memory for **`pm`** — a Claude Code plugin: a project-management conductor that sits
> above OpenSpec and Superpowers. Extracted from `cfdude/cfdude-plugins` on 2026-07-14
> (`git subtree split --prefix=plugins/pm`, full history preserved). Referenced from that
> marketplace via a `github` source (`cfdude/pm`, `ref: main`) — this repo is now the sole
> source of truth for pm's code, tests, and release history.

## What this repo is

- A single Claude Code plugin: `.claude-plugin/plugin.json`, `commands/`, `skills/`, `hooks/`,
  `scripts/`, `agents/` — all at the repo root (no `plugins/pm/` nesting, unlike when this lived
  inside the marketplace repo).
- This repo IS pm-conductor-managed (`.conductor/state.json` tracks its own backlog) — pm
  dogfoods itself here, mirroring how `cfdude-plugins` did before the extraction.

## The `pm` engine — hard constraints (must follow)

- **`scripts/conductor.mjs` is ZERO-DEPENDENCY.** Node 18+ built-ins only (`node:fs`,
  `node:path`, `node:os`, `node:child_process`, `node:url`). **Never** add an npm package or a
  `package.json` dependency. If a format needs parsing, prefer JSON (native) over pulling a
  parser.
- **Tests:** `node --test scripts/test/*.test.mjs`. All tests pass before any commit — no
  exceptions, no `--no-verify`.
- **Architectural law — `pm` is an INSTRUCTION layer, never an INTEGRATION layer.** It emits
  instructions for the interactive Claude agent to act on (the managed `CLAUDE.md` rules block,
  the SessionStart/PreCompact brief, command-doc markdown). It must **never** open a network
  connection or call an external system (Jira, GitHub, Linear, …) itself. External tracker sync
  is the *agent's* job; the engine's only role is to know a tracker is in use and shape the
  instructions it already emits. No code path in the engine talks to a tracker. The one
  deliberate, documented exception is the **gate-guard hook** — a local `PreToolUse`
  mechanical block, on by default and unconditional whenever the active epic has
  `reconcileNeeded: true` (`set-gate-guard off` does not bypass that case); see
  `commands/gate-guard.md`.
- **Release discipline.** A feature: (1) bumps `.claude-plugin/plugin.json` `version`; (2) adds
  a `CHANGELOG.md` entry; (3) if the `state.json` schema changes in a way existing data must be
  *transformed* to remain valid, adds a `MIGRATIONS` entry keyed to the new release (additive,
  idempotent, backward-compatible — a state file written by the prior version must still load).
  `state.json` carries `pmVersion`. The user-facing update sequence for any repo using this
  plugin is: update the plugin → `/reload-plugins` (or restart) → `/pm:upgrade` per repo. The
  full end-to-end release procedure (engine, docs, Mintlify site including the Changelog page
  and Real Numbers, the branch dance) is the project-local `release-checklist` skill
  (`.claude/skills/release-checklist/SKILL.md`) — repo-maintenance tooling, not part of what
  the plugin ships to users. Follow it every time `plugin.json`'s version bumps; don't
  re-derive the checklist from memory.
- **Parity ledger.** Every file under `commands/`, `agents/`, `skills/`, `hooks/`, and
  `.claude-plugin/` must be claimed by exactly one capability in `docs/parity-ledger.json`, and
  every path it claims must exist. Git-ignored paths (e.g. a macOS `.DS_Store`) are skipped by
  the walk, so local cruft can never trip this gate. `scripts/test/parity.test.mjs` enforces
  both and fails CI otherwise. Adding a command/agent/skill file means adding it to a capability
  in the same commit — either an existing one or a new one with its `claude-code` mechanism
  described. Unported platforms are **absent** from `platforms[]`, never present with null
  values; a port adds itself and fills its column as it goes. See
  `docs/superpowers/specs/2026-07-31-platform-parity-mechanism-design.md`.
- Engine subcommands are dispatched at the bottom of `conductor.mjs`; every new subcommand needs
  a matching command doc under `commands/` and coverage in `scripts/test/*.test.mjs`.
- **State-transition flags are not pure functions of current state.** `reconcileNeeded` in
  particular is set at detour-POP time and must survive until reconciliation completes — POP
  protocol removes the detour-stack frame *before* reconciliation runs, so deriving the flag
  from "is there still a live frame" breaks it at exactly the moment it needs to stay true. See
  `reconcileArchived()`'s comments in `conductor.mjs` before changing this logic again.

## Commits

Conventional commits (`feat|fix|docs|test|chore|refactor`). Never `git commit --no-verify`.

**Documentation currency — check on every PR into `main`, not just at release time.** Before
opening (or updating) a PR into `main`, ask: does this change anything a user or agent would
read about? If a change adds/removes a subcommand, flag, command, epic-level-autonomy behavior,
tracker behavior, or anything else user-facing, both **README.md** and **the Mintlify docs site**
(`pm-plugin.dev`, via the Mintlify MCP) must reflect it in the same PR cycle — follow the
`mintlify-doc-sync` skill for the exact procedure (which pages, how to merge and verify live,
branch cleanup). A change that is genuinely internal (a test, an engine-internal refactor, a
process-only doc fix) does not need either — but say so explicitly rather than silently
skipping the check.

<!-- BEGIN pm-conductor rules (managed by pm — safe to delete this block) -->
## PM Conductor — operating rules

This repo is managed by the `pm` plugin. The conductor sits ABOVE OpenSpec and Superpowers.
Epics are **lane-agnostic** (openspec | superpowers | claude-code | decision | external);
OpenSpec is one lane. Stories come from each epic's source (OpenSpec `tasks.md`, a Superpowers
plan, or a manual list). Follow these rules:

1. **Detours** — when something blocks the active epic, CLASSIFY before fixing:
   - *Minimal* (small, self-contained, no design ambiguity): fix → test → commit → push,
     then run `/pm:detour --minimal "<what>"` so it is recorded in `.conductor/detours.log`.
     Then resume.
   - *Substantial* (own design / changes shared behavior / multi-step): run `/pm:detour`.
     It becomes its own epic in the appropriate lane (OpenSpec proposal, Superpowers plan,
     etc.); PUSH the current epic onto the detour stack in `.conductor/state.json` with a
     concrete reason and `reconcileOnResume`.
2. **State of record is `.conductor/state.json`.** After any change to epics, status,
   priority, or the detour stack, re-render with `/pm:status`. Never hand-edit `PROJECT.md`.
3. **Resuming after a detour** — use `/pm:resume`. If the popped frame had
   `reconcileOnResume`, run the reconcile gate (reconciler agent) BEFORE writing code,
   then write its verdict back durably with `record-reconcile <id> --detour <id>
   --verdict valid|invalidated [--amendments "<a>;<b>"]` — this attaches
   `{verdict, amendments, reconciledAt}` to the paused epic's link to the detour and
   clears `reconcileNeeded`, instead of the judgment only ever living in conversation.
4. **Honcho** — on every PUSH and POP, also write a one-line memory to Honcho
   ("paused X for Y" / "resumed X, reconciled vs Y") so the relationship survives outside
   this repo.
5. **Keep `tasks.md` checkboxes truthful** — they are the source of truth for story progress.
6. **Roadmap as backlog** — work you intend to do but haven't proposed yet can be
   registered now with `/pm:epic add … --status planned` (any lane). Planned epics show
   as ordered backlog in `PROJECT.md` and a `planned: N` count in the briefing, without a
   "no change on disk" warning; `/pm:sync` flips an openspec planned epic to untriaged once
   its change is proposed. Have a roadmap doc? Read it in-session and load each item this way.

## The gate procedure — required task items

Every item below is a NUMBERED REQUIRED TASK ITEM in the change's own task list, carried
into both gates. They are not review guidance and must not be restated as prose bullets:
measured across one audited repository, a rule carried by a mandatory task section reached
14/14 subsequent changes, while the same rule written as a prose bullet reached 3/15.

1. **Call-site completeness sweep.** For every rule, guard or invariant this change introduces
   or modifies, enumerate ALL call sites of the thing being guarded — derived mechanically
   (`rg` for the callers), never a list typed from memory, which goes stale the moment a
   caller is added. Then state where the rule holds and where it does not, and
   justify each omission. A guard added at one call site while an identical sibling site is
   left untouched is a FINDING, not a detail: raise it even though the unedited site never
   appears in the diff. Both gates are diff-scoped and structurally cannot see an edit that
   is absent from a file the diff never touched — the dominant defect class in this
   repository's own audit, ~38 instances in one shard.
   A DATA reference is a call site too: for every field the change adds that holds another
   record's id, enumerate the places that write it, read it and REMOVE it. A deletion path
   that strips one holder and not its siblings leaves a dangling reference — the record
   rendering a pointer to something that no longer exists — and it is invisible to both
   gates for the same diff-scoped reason.
2. **Verify against the commit, not the working tree.** The commit is the unit of verification.
   Reading a file in the working tree is NOT verification. For every task, run
   `git show --stat <that task's sha>` and assert that
   every file the task claims to change appears in THAT commit. A task whose claimed file is
   absent from its commit FAILS, even though the working tree holds the intended edit, the
   suite passes and both gates are green. Audited here: two commits each claimed to remove a
   file's code and neither staged it, because a `git add` with an explicit path list aborted
   on an already-removed path — all four verification layers were reading the working tree,
   so nothing caught it, and it recurred after being written down in a commit message in the
   same epic.
3. **Declare lifecycle bookkeeping.** A task that is bookkeeping about the change's own
   lifecycle rather than its work — above all the task that ARCHIVES THE CHANGE ITSELF, which
   always qualifies — carries the literal marker `<!-- pm:lifecycle -->` ON THE TASK LINE.
   The engine infers this from nothing else: not the wording, not the commands the text
   names, not the position in the file. Mark it at the moment the task source is AUTHORED
   OR AMENDED — a source written before this capability existed gets the marker the first
   time you touch it, or its archive task counts as outstanding work forever.
4. **Attribute every commit to its epic.** At the moment each commit is made, record it:
   `update-epic <id> --attribute-commit <sha>`. The engine infers attribution from NOTHING —
   not the files a commit touches, not an epic id in a message — so an unrecorded commit is
   a commit the epic's Gate 2 cannot be checked against. The per-task conventional commit of
   an OpenSpec apply loop always qualifies. Work already in flight is covered too, but ONLY
   BEFORE the first attribution: catch up in the order the commits landed, then keep
   attributing forward. The array is append-only — the engine neither reorders nor
   de-duplicates it — so catching up AFTER attributing forward leaves an ancestor as the
   last entry, and the LAST entry is the endpoint a recorded Gate 2 `headSha` is compared
   against. If forward attribution has already begun, attribute forward only and say so;
   a wrong endpoint reads as a stale verdict and refuses the archive.
   ONE EXCLUSION, and it is not a judgment call: the commit that moves
   `openspec/changes/<id>/` under `archive/`, and any commit that only relocates or deletes a
   change's artifacts rather than implementing its work, is lifecycle bookkeeping and
   MUST NOT be attributed. That move lands after the reviewed range by construction, so
   attributing it
   makes the epic's own Gate 2 stale at the instant the archive gate reads it.
5. **Review a release's specs against each other.** Gate 1 and Gate 2 each take ONE CHANGE
   as their unit, so nothing above them asks whether a release's specs AGREE. Before
   `/opsx:apply` on any release holding two or more spec files — counted FLAT across its
   member changes, so one change carrying six specs qualifies — and again after any round
   of concurrent amendment, dispatch FRESH-CONTEXT reviewers at the release's whole spec
   set (one under `standard`, two with different lenses under `thorough`) and ask the six
   questions: contradiction, double ownership, unmeetable requirements, gaps against the
   proposal's Resolves list, vocabulary forks, and shared chokepoints. Split every finding
   into BLOCKS and POLISH, fix the BLOCKS, decline most POLISH and say why — a review of a
   large document always returns something, so "no findings" is not a stopping condition.
   A contradiction is never POLISH. Then record the verdict:
   `record-cross-spec-review <releaseId> --verdict pass|fail --reviewer "<identity>"`.
   The engine enumerates the spec set from disk and hashes it, so a spec ADDED to the
   release afterwards — or a reviewed spec amended — marks the verdict stale on every
   surface; a set you assert instead would go stale in exactly the way this gate exists to
   catch. Measured here: this pass returned 5 Critical and 10 Important against six specs
   that had each passed `openspec validate --strict` and would each have passed Gate 1
   alone, including a flagship scenario that was unreachable.
6. **End work by recording a disposition.** An epic, a story, a deferral or a release
   exclusion ENDS by recording a terminal disposition carrying its required reason, and
   never by removing the record. The archive verb takes TWO halves in ONE invocation — the
   disposition AND a deferral assertion — because the gate refuses either half alone:
   `update-epic <id> --status archived --outcome delivered|killed|superseded|abandoned --reason "<why>" --no-deferrals`
   (every outcome except `delivered` requires the reason). `--no-deferrals` is the explicit
   "there are none" and is a claim, not a default — swap it for `--deferral
   "<epicId>:<artifact section>"` where work is now held by a registered epic, or
   `--declined-deferral "<what>:<why not>"` where you are deliberately not doing it; both
   repeat, and the engine will not read your artifacts to guess.
   Deletion removes the record of projected work, which is
   precisely what a disposition exists to preserve. `remove-epic` stays available and
   ungated for what it is for: an epic registered in error, a duplicate, a mistake made a
   minute ago — where there is no disposition to record because there was no work.

## Epic-level autonomy

An epic's `autonomy` block (`.conductor/state.json`) can grant it broad execution trust —
`level: "off"` by default (today's behavior, unchanged). Setting `level: "autonomous"`
removes the need to ask before each phase transition, but NEVER removes a genuine safety stop.
This is development-time only — it never covers actions with irreversible EXTERNAL side
effects (sending email/Slack, deploying to production, third-party API calls, pushing to a
shared branch); those are out of scope regardless of autonomy level.

1. **Preflight before flipping the switch** — see the `conductor` skill's
   "Epic-level autonomy — the preflight scan" section for the full process. In short: read
   the epic's full source, produce a short batch of destructive-risk-points +
   genuine-unknowns questions, get the user's answers, THEN record them:
   `set-autonomy <id> --preauthorize "<action>:<reason>"` / `--context "<note>"`, and only
   then `set-autonomy <id> --level autonomous`. For routine, repeated categories of action
   instead of enumerating each one, use the shorthand
   `--preauthorize "category:<filesystem|network|schema|external-api>:<reason>"` — see the
   `conductor` skill's "Epic-level autonomy" section for the exact keyword heuristic each
   category matches at decision-rule time.
2. **Execution-time decision rule** — check every destructive action against these, in
   order, before treating it as a stop:
   a. Already pre-authorized in the preflight — either an exact `action` match or the
      action falls under a granted `category` (per the category heuristic)? → proceed,
      record via `--notify`.
   b. No backup/restore path exists? → STOP regardless of autonomy level.
   c. Destructive but restorable (backed up first)? → WARN — `--notify` it immediately, proceed.
   d. No context to act on? → STOP — a real gap, not a false stall.
   e. Consequential and not yet notified? → `--notify` it immediately, then proceed.
3. **Notify incrementally, not at the end** — `--notify` writes durably to `state.json`'s
   `notifications[]` the moment a WARN-class (c) or consequential (e) decision is made. Do this
   AS EACH DECISION HAPPENS, not batched — a session can be compacted or interrupted mid-epic,
   and anything not yet `--notify`'d is lost when that happens.
4. **End-of-epic report** — on completion, read back the accumulated `notifications[]` and
   report what was asked, what was done, and the decisions made in the user's absence (drawn
   from that log, not from memory), with an explicit "are you OK with these?" checkpoint, THEN
   run tests. Leave room to iterate — including rewriting code — if the user is not satisfied.

## Review mode

Review intensity is a bounded dial, not a free-form call each time — set via
`set-review-mode --mode <off|standard|thorough>` (default: `standard` if never set).

| Mode | Reviewer budget | Trigger |
|------|-----------------|---------|
| `off` | none — self-review only | tiny, low-risk, single-file claude-code tweaks |
| `standard` | one fresh-context reviewer per gate | the default: OpenSpec Gate 1/Gate 2, a Superpowers task review |
| `thorough` | two independent fresh-context reviewers per gate; adjudicate any disagreement yourself | schema/migration changes, security-sensitive work, or anything explicitly flagged high-stakes |

Current mode: **thorough**.

## Feedback — don't let friction stay silent

If you hit a bug, a missing CLI verb, an unexpected limitation, or repeated friction
working with this plugin — in this repo or any repo using it — don't just work around it
and move on. File it: `/pm:feedback [bug|feature] "<summary>"` against `cfdude/pm`, or ask
the user "want me to file this as feedback?" if you're not sure it's worth it. The failure
mode this guards against is silent: hand-editing `.conductor/state.json` to flip a story's
`done` flag (no CLI verb exists for it) recurred across several separate sessions before
anyone reported it, even though `/pm:feedback` existed the whole time. A filed issue is
cheap; an unreported recurring papercut is not — silent pain is where a product fails its
users.

## GitHub issue sync (cfdude/pm)

This tracker is inward: open items in github-issues become conductor epics, same pattern as the
OpenSpec/Superpowers auto-registration `sync` already does for on-disk changes/plans. The
pm plugin NEVER calls github-issues itself — as part of running `/pm:sync`, YOU (the interactive
agent) do:
1. `gh issue list --repo cfdude/pm --state open --json number,title,url,updatedAt,labels`.
2. For each item, check whether an epic's `externalUrl` already matches that item's URL
   (`/pm:epic list` or read `.conductor/state.json`) — if so, skip it (already
   mirrored; re-running sync must never create a duplicate epic for the same item). Match
   on `externalUrl` when both sides carry one, never on a bare `externalId`: item numbers
   are unique only within one tracker/repo, so two trackers can each hold an item numbered
   the same without those being the same item. Where one side has no URL, they are not a
   duplicate either — a URL-less legacy epic must not block a genuinely distinct item.
3. Otherwise register a new untriaged epic, running this line as written with only its
   placeholders filled in:
   `add-epic --id gh-cfdude-pm-<issue-number> --title "<issue-title>" --status untriaged --external-id <issue-number> --external-url <issue-url> --external-updated-at <issue-updated-at> --lane <lane> --priority P2`
   Take `<lane>` from LANE ROUTING, never a fixed value: run `suggest-lane "<issue-title>"`
   and use the lane it returns; when it returns none, apply this repo's generic lane
   heuristic. The lane decides whether the work leaves any spec, plan or gate record, so
   a hardcoded one decides that silently for every mirrored item. If the routed lane is
   wrong for a particular item, register it in the lane you judge correct and record the
   reason on the epic: `update-epic <id> --notes "lane: <chosen> not <routed> — <why>"`.
   The id is DERIVED, never invented: `gh-cfdude-pm-<issue-number>` — this tracker's
   system and scope, then the item's own number. The same item therefore yields the same
   epic id in every repo and every session, so a second registration of it is refused as a
   duplicate instead of landing as a second epic under a different invented slug. Use a
   `P0`/`P1`/`P2`/`P3` label's priority when the item carries one, `P2` otherwise.
4. Set `--title` from the item title so the epic is legible before you triage it further.
5. For every epic ALREADY linked to an item here, compare that item's tracker-side
   updated timestamp against the epic's `externalUpdatedAt` watermark, and READ the ones
   whose timestamp is newer. Record what you read with `update-epic <id>
   --external-updated-at <iso>` (or `record-tracker-refresh` when you owe a verdict) —
   seeing an item in the list response is not reading it, so listing alone must never
   advance the watermark or sync erases the drift it exists to find.

## Sync after completing tracker-linked work

After you close/transition a tracker-linked issue as part of completing an epic (the
writeback steps above), immediately re-sync with your tracker(s) — run `/pm:sync` — to pull
in anything new that appeared while you were heads-down. You're already doing tracker I/O
for this epic, so this is the cheapest moment to catch it; this applies whether you have one
tracker or several (primary + secondary) configured.

## Re-read the source before an epic becomes the work

An epic becoming active is the moment specs or a plan get drawn for it. Before that, re-read
what it is FOR. Which source depends on provenance, never on any tracker's direction:
- The epic has an `externalId` → re-read the LINKED ITEM (body, comments, labels, state), then
  record what you found: `record-tracker-refresh <id> --verdict unchanged|material-change
  --external-updated-at <iso> [--summary "<what changed>"]`. The timestamp is the tracker's
  own, never a local clock reading, and recording it clears the obligation.
- The epic has NO `externalId` → re-read its local source: its plan document, or its OpenSpec
  proposal plus its tasks. This one is instruction only — nothing is recorded in state for it,
  and `record-tracker-refresh` refuses such an epic by name rather than accepting a verdict
  about a linked item that does not exist.
An outward-mirrored epic owes the same look as an inward-born one: a linked item accumulates
third-party context regardless of which way it was born. Origin decides only whose ask wins
when the item and a local spec disagree.
<!-- END pm-conductor rules -->

### 🔗 Cross-spec review — now a shipped gate, not a repo practice

**#126 landed it in the product.** The procedure lives in the shipped `skills/cross-spec-review/`
skill and in the emitted rules block as a NUMBERED REQUIRED TASK ITEM — the form this repo
measured at 14/14 adoption against 3/15 for a prose bullet. The old `.claude/skills/` copy is now
a stub redirecting there, so repo practice and product cannot drift apart.

**Invoke the `cross-spec-review` skill** before `/opsx:apply` on any release holding two or more
spec files, and after any round of concurrent amendment. Record the outcome:
`record-cross-spec-review <releaseId> --verdict pass|fail --reviewer "<who>"`. The engine
enumerates the spec set from disk and hashes each file it read, so the verdict goes stale on its
own when a spec is added or amended — a release-scope staleness a change-scoped gate structurally
cannot see. A multi-spec release with no verdict renders `⚠ no cross-spec review (N specs)`,
because silence and "reviewed and clean" must never look the same.

*Evidence:* on 0.27.0 that pass returned **5 Critical and 10 Important** against six specs that
had each passed `openspec validate --strict` and would each have passed Gate 1 alone — including
a flagship scenario that was unreachable, and a shared 11-element flag allowlist four
capabilities all needed to grow. The re-review then found **two more Criticals introduced by the
fixes**. That verdict is now recorded against the `0.27.0` release object, marked retroactive.

### 🐕 Dogfooding — invoke the skill when you adopt a practice or work around friction

`pm` is a project-management conductor and this repo is a project it manages, so **anything
invented to work here is something `pm`'s users could use** — and any papercut worked around
silently here is one every user is working around too. **Invoke the `dogfooding` skill** when you
adopt a practice, hand-edit `.conductor/state.json`, find a command `pm` emitted that does not
run, or catch yourself thinking *"I'll just…"* about something the tool should do. Filed as #127.

**Standing bias, measured, and it applies to every rule in this file:** a rule carried by a
**required task** reached 14/14 subsequent changes in the audited corpus; the same rule as a
**prose bullet** reached 3/15. Prefer a skill over a paragraph, and a task over a sentence — this
section is a pointer for exactly that reason.
