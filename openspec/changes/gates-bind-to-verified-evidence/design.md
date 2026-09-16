## Context

See proposal.md "Why" for the defects and their reproductions. The constraints that shape the fix:

- `scripts/conductor.mjs` and `scripts/lib/*.mjs` are zero-dependency and zero-network. Every git
  call added here reads the local object database through `execFileSync` with an argv array.
- CLAUDE.md: "State-transition flags are not pure functions of current state." `reconcileNeeded` is
  set at push/pop and must survive until reconciliation completes. POP removes the frame before the
  verdict exists, so nothing may re-derive the flag from "is there a live frame". Today's
  `reconcileArchived()` (`epic-progress.mjs:149-170`) encodes that rule as "the legitimate window is
  exactly `e.id === state.active`" — and repro 2a/2b show the active pointer moves out of that
  window through ordinary verbs.
- The reconcile gate is specified in no main spec. `tracker-sync` "Mechanical enforcement of the
  refresh gate is opt-out" only says `set-gate-guard off` cannot bypass it. This change therefore ADDS
  the reconcile requirements to `gate-integrity`, whose subject is exactly "a gate binds to evidence
  it can check"; minting a new capability mid-release would add a seam the cross-spec review has to
  police, and `tracker-sync` is about external trackers.
- This repository squash-merges. Pre-squash commits survive only on `presquash/*` tags
  (`.claude/skills/pr-workflow/SKILL.md`), which are pushed to origin. CI's `actions/checkout` runs
  with `fetch-depth: 0` (`.github/workflows/ci.yml`) but leaves HEAD detached, so no rule may read the
  current branch. Measured: 183 distinct recorded values, all resolve locally; 74 `presquash/*` tags.

Line anchors below were re-derived with `rg` against `dev` at 50485a3, after changes 1
(`every-verb-refuses-what-it-does-not-read`) and 2 (`state-file-refuses-to-guess`) merged (task 0.3).

## Goals / Non-Goals

**Goals:** the three reconcile bypasses closed with no wedge introduced; every commit value resolved
once, at write; staleness decided over every attributed commit; legacy records loading, never
crashing, and never reading fresh when they cannot be checked.

**Non-Goals:**
- No migration of stored sha values (Decision 7). The one migration is the arming-record stamp on
  `may-invalidate` links (Decision 3).
- No change to which verdicts `integrity`'s existing arms report, beyond the non-object-name arm.
- `record-reconcile`'s missing unknown-flag refusal (FINDINGS:46) is change 1's. So is every
  argv-shape refusal on the verbs touched here.
- The reconcile AMENDMENTS wire contract (`agents/reconciler.md`: lines joined with `;`) is kept;
  `--amendment` is added beside it, not instead of it.

## Decisions

### 1. The obligation is recorded per detour, on the link, at PUSH

`push-detour --reconcile` writes `reconcileOnResume: true` onto the paused epic's `may-invalidate`
link to the detour (the frame's field name, deliberately); `--no-reconcile` writes
`reconcileOnResume: false` on a link it creates, never lowers an existing `true`, and never writes a
key onto an existing unmigrated link (Decision 3). `mergeLinks()` writes `reconcileOnResume: false`
on a `may-invalidate` link it CREATES (`update-epic --link`, `add-epic --link`, `add-many`) and keeps
the stored key on a same-target correction (Decision 5). `linkOnce()` (`detour-stack.mjs:46`) returns early on an existing
link today, so it becomes the site that applies these writes to the link it finds. `link.reconciled`
(today's `{verdict, amendments, reconciledAt}`) is its answer.

**Armed is decided per link**, by one helper `isArmed(link)`: `link.reconcileOnResume === true`.
It reads neither the epic's flag nor its other links. `isUnmigrated(link)` = the key is absent.
`ownedDetours(epic)` = targets of armed links with no `reconciled`.

Why per link and not the epic flag alone: with only `reconcileNeeded`, the engine cannot tell which
detour a verdict must name. Repro 3's variant — owed against `d`, `--no-reconcile` push to `d2` — would
let a verdict against `d2` clear an obligation owed against `d`. The advisor-suggested lighter predicate
("any link naming `--detour` while `reconcileNeeded` is true") admits exactly that, so it was rejected.

Why at PUSH and not at POP: the frame is removed at POP, and the link is the durable record that
survives it. Arming at push also means a frame still on the stack is detectable (Decision 2).

Alternatives rejected:
- An epic-level `owedDetours: []` array. A second holder of detour ids is a new DATA reference every
  sweep (`epicReferences`, `mergeLinks`, `remove-epic`) must learn; the link is already swept.
- Deriving the obligation from frames. Forbidden by the CLAUDE.md constraint above.

### 2. `record-reconcile` acceptance, clearing, correction

Accepted only when all hold, evaluated before `loadState()` returns to any write:
1. `--detour` differs from the epic;
2. the epic has a `may-invalidate` link to `--detour` that `isArmed()` accepts (Decision 1); if it is
   and the epic holds no unmigrated `may-invalidate` link at all (else the refusal names `/pm:upgrade`);
3. no `detourStack` frame has `pausedEpic === epic && spawnedDetour === --detour`.

Refusals name `ownedDetours(epic)` — the armed, unanswered link targets — or say none is owed.
The verb never pushes a link (today's `if (!link) epic.links.push(...)` at
`reconciler-writeback.mjs:43-46` is deleted).

Prior answers live in ONE place: `link.superseded`, a sibling of `link.reconciled` holding the
previous `reconciled` object, one level deep (a deeper `superseded` is dropped, as
`gate-review-writeback.mjs:144-148` does for gate verdicts).

- On accept, in this order: if `link.reconciled` exists, it moves to `link.superseded`; the new
  verdict is written to `link.reconciled`; THEN `epic.reconcileNeeded = ownedDetours(epic).length > 0
  || liveReconcileFrame(epic)`. `ownedDetours` reads link keys and verdicts, never the flag it feeds,
  so the order is only "verdict before flag".
- **Re-arm at push:** `push-detour --reconcile` onto a link holding `reconciled` moves it to
  `link.superseded` and deletes `link.reconciled`, so the link reads unanswered and the earlier
  verdict stays readable. The verdict that later answers it finds no `reconciled` to move.

The flag write on accept is a write AT the verdict transition, computed from durable per-link
records — not a render-time derivation. The CLAUDE.md constraint forbids the heal re-deriving the
flag from frames, and that stays forbidden.

### 3. The 0.44.0 migration stamps every link; unmigrated links wait for it

A `MIGRATIONS` entry keyed `0.44.0` (`migrations.mjs`), additive, idempotent, reading only `state`:
for every epic, for every `may-invalidate` link WITHOUT a `reconcileOnResume` key, write
`reconcileOnResume = (epic.reconcileNeeded === true && !link.reconciled && link.epic !== epic.id && ids.has(link.epic))` — a self-link or a link to a missing epic is stamped false, because acceptance rule 1 and the unknown-detour refusal make it unanswerable and arming it would wedge the epic (Gate 1 round 4). Keyed links are untouched,
so a second run changes nothing. The entry and `upgrade()` call ONE exported state-only function,
`stampReconcileKeys(state)`: the entry for the version bump, and `upgrade()` again on EVERY run,
immediately before `reconcileArchived()`. The per-run call exists because `MIGRATIONS` apply only when
`release > pmVersion`: a keyless link written after the stamp (an unreloaded 0.43.0 session, or a
second machine sharing `state.json` through git) would otherwise make the `/pm:upgrade` a refusal names
a no-op, and with its detour archived nothing else could clear the obligation.

Why a migration and not read-time legacy rules: two rounds of Gate 1 found every remaining Critical
and Important in the read-time "keyless counts as armed while the epic owes" rule — an epic-wide
mode that a later `--no-reconcile` push, a same-detour push, or a hand-added link could each flip.
With every link keyed, arming is one per-link boolean. Measured population: 0 owing epics and 2
`may-invalidate` links across 24 pm-managed repositories on this machine.

**Before `upgrade` runs** (plugin updated, `/pm:upgrade` not yet run), a keyless link is
**unmigrated**: never armed; while the epic holds one, EVERY `record-reconcile` on that epic is refused
naming `/pm:upgrade` (not only one naming the unmigrated detour: a verdict against a new armed detour
would otherwise set the flag from `ownedDetours`, which cannot count the unmigrated obligation); it is
never grounds for the heal's no-armed-link clear; and Decision 5 refuses removing it while its epic
owes. `push-detour --reconcile` onto it writes `true` (an explicit arming is a fact), and
`--no-reconcile` leaves it keyless rather than guessing. Nothing is lost in the window, and
`/pm:upgrade` is a CLI verb the guard never blocks; the briefing already nudges when `pmVersion`
lags the installed plugin.

Trade-off (also in the spec): an owing epic whose every link already carries a verdict — a re-push
after a verdict under 0.43.0, the `r-repush` repro — is stamped all-false, and the heal then clears
its flag with its stderr notice. Declined here: re-arming, during the stamp, the answered link a live
0.43.0 `reconcileOnResume` frame names (a re-push still on the stack) — it needs the push's re-arm
semantics (moving the verdict to `superseded`) inside the stamp, for 0 live frames across 24
repositories. The directed rule prefers "no verdict recorded" as the only evidence
of an open obligation over guessing which answered link a later push re-opened.

How each round-2 finding dissolves:
- same-detour `--no-reconcile` push on an owing `p`: the link is `true` (armed by push, or stamped by
  the migration) and a `--no-reconcile` push never lowers it; pre-upgrade it stays keyless, which the
  heal never clears on. Spec scenario "A no-reconcile push to the same detour never lowers its arming".
- a later `--reconcile` re-arming a hand-added or old no-reconcile link: hand-added links are written
  `false` and the migration stamps an old no-reconcile link (epic not owing) `false`; only a real
  `--reconcile` push arms, and the obligation it creates is genuine, so `--clear-links` refusing is
  correct, not a forced fake verdict.
- answered-but-owing `--clear-links`/`remove-epic d` then heal-clear: Decision 5 now refuses removing
  ANY armed link (answered or not) or unmigrated link while the epic owes, and an answered armed link
  still counts for the heal, so the flag survives.

### 4. The heal, the active pointer, and the warning

`reconcileArchived()` keeps one of today's branches: live frame with `reconcileOnResume` → set. The
archived → clear branch is DELETED: archive-then-unarchive (`--outcome abandoned`, then `--status
active`) otherwise cleared the flag with the armed link unanswered, and `gate-guard.mjs` and
`briefing.mjs` already ignore an archived active epic, so keeping the flag never blocks Edit/Write.
It is NOT inert, and that is deliberate: Decision 5's refusals still bind the archived epic, and
render still marks its row. The honest ending for abandoned or killed work is a verdict:
`record-reconcile p --detour d --verdict invalidated --amendment "<outcome>: <why the work will not
resume>"` — the plan IS invalidated for work that will not resume. The third branch (not archived, no frame, not active → clear) is REPLACED by a narrower one:
no live frame, no link `isArmed()` accepts (answered or not) and no unmigrated link → clear, and push a
line onto the heal's stderr notices naming the epic. A stale flag that still holds an armed link has one CLI exit, `record-reconcile`.

Why the narrow branch rather than an explicit discharge verb (`record-reconcile <id> --orphaned
--reason`): `{reconcileNeeded: true, links: []}` is reachable today (`repro-integrity.txt`: `push`,
`pop`, `remove-epic d`), so is `{reconcileNeeded: true}` with only `reconcileOnResume: false` links
(hand-edited), and under this change no `record-reconcile` can be accepted for it, so
without an exit the unconditional guard wedges Edit/Write on that epic — the case
`gate-guard.mjs:92-104` was written to avoid. After this change the engine cannot create the state
(pushing arms a link; Decision 5 refuses removing an armed one), so the branch only ever meets
hand-edited state or the migration tradeoff (Decision 3); a new flag and its doc surface would buy a recorded discharge for a
population measured at zero. Rejected alternative: widening acceptance to any epic in that state,
which reopens repro 1b.

Warn, not refuse, on pointer moves — precedent `detour-stack.mjs:164-167` ("refusing here would leave
a stack … with no CLI way out … It warns, which is the honest shape"). The warning is emitted by a
single helper, `owedReconcileNotice(state, previousActiveId)`, called after `saveState` at every
site that can move `state.active` off an epic: `setActive`, `clearActive`, `update-epic` (`activate`
of another epic, or `state.active = null` at `update-epic.mjs:858`), `add-epic`/`add-many` creating
an epic at `active`. The call-site list is re-derived at sweep time with
`rg -n "activate\(|state\.active\s*=" scripts/lib`, which also finds `pop-detour`'s `activate` —
it moves the pointer off the detour, and warns when that detour itself owes. The one exemption is
`push-detour` moving the pointer off the epic it parks. The guard (`gate-guard.mjs`) stays keyed on the active epic: writing another epic's
code is not building on the invalidated plan, and an "any epic owes" guard would block a nested
detour's own edits.

### 5. Writes that would destroy the record

- `update-epic --clear-links`: refused when the epic owes a reconcile and holds any armed link
  (answered or not) or any unmigrated link — including the one-write clear-and-re-supply repair, which
  the `epic-annotation` delta carves out. Its two emitted instructions (`links.mjs`
  `unknownLinkTypeMessage`, `integrity.mjs` unknown-link-type finding) name `record-reconcile` first
  when the epic owes; the `links.mjs` message gains the epic id it needs to ask.
- `mergeLinks()` (`links.mjs:85-95`) replaces the object on a same type+target reason change, which
  drops `reconcileOnResume`, `reconciled` and `superseded`. It will carry every key other than
  `type`/`epic`/`reason` from the stored link onto the supplied one. This binds `update-epic --link`,
  `add-epic --link` (new epics hold no stored link, so a no-op there) and `add-many`.
- `remove-epic <d>`: `epicReferences()` gives a link reference `drop: null` (the frame precedent at
  `links.mjs:277-280`) when the link is `may-invalidate`, armed (answered or not) or unmigrated, and its
  holder owes a reconcile, and gives every reference a `kind` (`frame` | `owed-reconcile` | …). The two readers that
  word a `drop: null` today assume it is a frame and must word by `kind` instead:
  `remove-epic.mjs:78-84` ("detour-stack reference(s) … Resume or pop the detour first") names
  `record-reconcile` for an owed-reconcile reference, and `integrity.mjs:~544`
  (`dangling-epic-reference`) stops calling every undroppable reference a frame.
- Removing the PAUSED epic itself is not refused: its record, flag included, goes with it.

### 6. `pop-detour` and `push-detour` wording

`pop-detour`: compute `owed = ownedDetours(epic)` after writing the flag. If `epic.reconcileNeeded`,
print the RECONCILE GATE notice naming every `owed` id (not only `frame.spawnedDetour`) and return
before `appendHonchoMemory("pop", …)`. Only an epic that owes nothing gets the POP line.
`push-detour`: `paused.reconcileNeeded = paused.reconcileNeeded === true || reconcileOnResume`,
written before `isArmed()` is consulted for the report. Its
report: `— reconcile gate armed for /pm:resume` when `--reconcile`; `— no reconcile for '<d2>'; '<p>'
still owes a reconcile against <ids>` when `--no-reconcile` while owing; today's `— NO reconcile on
resume` only when nothing is owed.

Amendments: `--amendments` whose `trim().toLowerCase() === "none"` → `[]`; otherwise split on `;` as
documented. `agents/reconciler.md` emits `AMENDMENTS: none` as its empty form; the docs name
`--amendments none` as the one emitted spelling, and the rule above covers it. `--amendment` is
registered in `VERB_FLAGS` (`constants.mjs`) for `record-reconcile`, `repeats: true` — it is not an
epic field — so change 1's unknown-flag refusal admits it; each occurrence kept verbatim (not trimmed
of inner `;`). Both flags together → refused.

### 7. Commit resolution at write

New `git.mjs` export `resolveCommits(values) → {resolved: Map<value, fullName>, unresolved: value[]}`,
one `git cat-file --batch-check` process fed `<value>^{commit}` per line (a `missing`/`ambiguous`
line marks the value unresolved). Output is mapped to input BY LINE ORDER, so a value containing
whitespace or a control character is refused before the process starts (it could split one input
line into two). No fallback: git has shipped `--batch-check` for over a decade, and a second
resolution path is a second behaviour. Every new git call sets `GIT_NO_LAZY_FETCH=1` in its env, so a
partial clone never fetches from its promisor remote. No `cwd` other than `ROOT`.

Called before `loadState()` at: `update-epic --attribute-commit`, `--withdraw-commit`
(identity only, Decision 8), `record-gate-review --base-sha/--head-sha`. A refusal names every
unresolved value in one message. Stored value = full object name (40 hex, or 64 in a SHA-256
repository — the code tests `/^[0-9a-f]{40}([0-9a-f]{24})?$/`, never a hardcoded 40).

**Forbidden as a resolution or freshness criterion**, because a presquash-only commit fails each and
CI's detached clone fails more (`repro-tagonly.txt`: branch-contains 0, `--is-ancestor <sha> HEAD`
false, `rev-parse` resolves even after the tag is deleted while the object remains):
`merge-base --is-ancestor <x> HEAD`, `branch --contains`, `for-each-ref --contains`, `rev-parse
--abbrev-ref`, anything reading the current branch. `reachableFromAnyRef()` stays a reporting-only
helper for the orphaned arm of integrity.

Consequences to handle in the same commits:
- `missingAttributions()` (`update-epic.mjs:45-49`) compares resolved names, not the typed strings —
  otherwise a short typed sha stored in full reads "NOT in state.json" and exits 1.
- The withdrawal read-back (`update-epic.mjs:889-902`) compares the removed entry, not the typed value.
- The attribution nudge (`subcommands.mjs:349`) keeps printing whatever sha it holds; it now resolves.

No migration: resolvability is clone-local (tags, `gc`), and the existing spec already forbids a
migration that collapses distinguishable states (`gate-integrity` "The migration SHALL NOT add the array").

### 8. Withdrawal by identity

For each requested value: if it resolves, remove the LAST attributed entry whose resolution equals
it (resolve stored entries in the same batch); else remove the LAST entry `===` the value. The
withdrawal record's `sha` is the stored entry removed. The attribute-and-withdraw-together refusal
compares resolved names where both resolve, strings otherwise.

### 9. Staleness over every entry, batched

`gateStaleness(epic, entry)` keeps its states and adds no new one:

1. `none` / absent array → `unverifiable` / empty → `none-attributed` or `attribution-withdrawn` /
   no range → `unverifiable` — unchanged, same order.
2. Shape: any of `headSha` or attributed entries failing `isCommitNameShaped(v)` → collected as
   `malformed` (never passed to git). Malformed is ALWAYS stale. `isCommitNameShaped` is ONE exported
   predicate in `git.mjs` (`/^[0-9a-f]{4,64}$/`), shared with Decision 10 so the staleness rule and
   the integrity arm cannot disagree about what is malformed.
3. `resolveCommits([headSha, ...attributed hex])` (cached per process by value). Hex values that do
   not resolve to exactly one commit (missing, ambiguous, or a non-commit object) are `unanswerable`: write-time resolution guaranteed they were
   commits, so a clone lacking one cannot answer, which is `unverifiable`, not a finding.
4. If `headSha` is hex and resolved: one `git rev-list <resolved attributed…> ^<headSha>` over the
   RESOLVED entries only (a missing argument makes it exit non-zero); every entry whose full name
   appears in the output is `uncovered`. If `headSha` is hex but unresolved, skip `rev-list`. A
   non-zero exit → treated as unanswerable (never `fresh` — the direction of the bug at
   `archive-gate.mjs:112`).
5. `malformed.length || uncovered.length` → `{state: "stale", uncovered, malformed, headSha}`;
   else any `unanswerable` → `unverifiable`; else `fresh`.

`deliveredObligations()` and `archiveGate()` name `malformed` values in the refusal; `stalenessMarking()` is unchanged (` ⚠ stale`). Rendering
escapes values with the existing `escapeControls`.

Measured (`measure2.mjs`, this repository's record): today's `gateTableRows` ~911 ms; a per-commit
`merge-base` loop would add 139 calls / ~711 ms; one `rev-list` per verdict is 14 calls / ~70 ms.

### 10. Integrity: non-object-name values

Extend `recorded-sha-the-repository-cannot-resolve` (`integrity.mjs:656`) rather than adding a check:
a third arm, "not a commit object name" (decided by the same `isCommitNameShaped` Decision 9 uses), over `attributedCommits` and the CURRENT `gateReview.gateN`
`baseSha`/`headSha` only, reported before the object-store probe and independent of it. Its
`recordedShas()` input already enumerates those holders; the new arm filters to the current ones.

## Risks / Trade-offs

- [Existing tests use fake shas (`aaaaaaa`, `abc1234`, `root`, `later`) in ~15 test files] →
  a helper in `scripts/test/helpers.mjs` that makes a real commit per name in the fixture repo and
  returns its full sha; converted file by file, each conversion in the commit of the task that breaks
  it. A test asserting on a typed literal in `state.json` changes to the resolved value.
- [A repository with no git, or git absent, can no longer record a `--base-sha`/`--head-sha`, so a
  `delivered` openspec archive is unreachable there] → accepted: a range nobody can check is the
  defect being removed; `killed`/`superseded`/… outcomes still archive, and every pm-managed repo on
  this machine is a git repository.
- [A clone that does not hold the reviewed range — a fresh clone after a squash-merge, CI — now
  REFUSES `record-gate-review --base-sha/--head-sha` where it used to store the typed strings] →
  accepted and documented in `commands/epic.md` and the `release-checklist`/`pr-workflow` skills'
  gate step: record Gate 2 from the authoring clone before the squash-merge (the documented order
  already), or fetch the `presquash/*` tags first; a stored range this clone cannot check is the
  defect being removed.
- [`conductor-13.test.mjs` is the documented-flag harness and feeds a fake value per flag (27 hits)] →
  teach the harness a resolvable default commit from the 1.1 fixture rather than editing each call;
  `archive-gate-reads-what-it-writes` 4.1a hit the same harness for the same reason.
- [A hex value this clone lacks — or a short legacy hash that became ambiguous — reads unverifiable
  and does not refuse the archive] → write-time resolution means every new value was a commit when
  written; the legacy population is 152 short hashes, 0 of 183 ambiguous today, and `integrity`'s
  existing absent/orphaned arms report missing objects.
- [An authoring clone where `gc` removed every recorded commit reads `unverifiable` and archives] →
  the same undecidable case `recorded-sha-the-repository-cannot-resolve` already documents; write-time
  resolution means no NEW record can start in that state.
- [The every-entry rule could refuse an epic that attributed a commit on a branch the reviewed head
  does not contain, e.g. a post-squash fix commit] → that IS uncovered work; measured 0 live verdicts
  change classification. Remedy is the documented one: re-review and record over the range.
- [An owing epic whose every link already carries a verdict loses its flag at upgrade] → Decision 3;
  the heal's stderr notice names it; 0 owing epics measured across 24 repositories.
- [An archived or abandoned epic that still owes keeps `--clear-links`/`remove-epic <detour>` refused
  and its row marked] → deliberate (Decision 4); the ending is `record-reconcile … --verdict
  invalidated` with the outcome as its amendment, or `remove-epic <paused epic>` for a registration
  made in error.
- [7.5 changes the heal's behaviour on `{reconcileNeeded: true, links: []}`, which existing fixtures
  rely on (`conductor-03`, `conductor-05`, `conductor-14`)] → tasks 7.5 sweeps
  `rg -n "reconcileNeeded" scripts/test` and moves each fixture onto an armed link.
- [`remove-epic p` then `add-epic --id p` yields a clean `p` whose `gate-guard` exits 0] → accepted:
  `remove-epic` is the verb for a record registered in error, the removed record (flag and links) is
  in git history, and refusing removal of an owing epic would leave a mistaken registration
  unremovable.
- [Warning, not refusing, on pointer moves lets an agent work elsewhere while an obligation stands] →
  the obligation survives, PROJECT.md marks the epic `⚠`, and the guard fires again on return.

## Migration Plan

One `MIGRATIONS` entry, `0.44.0`: the arming-record stamp (Decision 3) — additive (it only adds a
key to links lacking one), idempotent, reads only `state`, and a 0.43.0 state file loads before and
after it. Stored sha values are never rewritten. Rollback is reverting the release; 0.43.0 ignores `reconcileOnResume` and `superseded` on links.

## Coordination

- **Change 1 (`every-verb-refuses-what-it-does-not-read`)** lands first and makes `record-reconcile`
  refuse unknown flags, so an unregistered `--amendment` is refused until this change registers it in
  `VERB_FLAGS`. All line anchors above must be re-derived after it merges.
- **Change 2 (`state-file-refuses-to-guess`)** also edits `migrations.mjs` `upgrade()`, where this
  change adds the per-run `stampReconcileKeys` call. It owns the rules-block WRITER. This change edits the
  CONTENT of `scripts/lib/rules.mjs` (the `record-reconcile` invocation form, and attribution-endpoint
  wording now that every entry is compared) and the mirrored declared claims; expect a textual
  conflict in `rules.mjs`, not a semantic one. Change 2 also edits the top of `gate-guard.mjs`; this
  change does not edit that file's logic (the guard stays keyed on the active, unarchived epic), only
  its comments if the sweep finds them stale.
- Mintlify page sync is not a task here; it belongs to the 0.44.0 release cut.
- `gateStaleness` also serves Gate 1 rendering; no change to that caller.
