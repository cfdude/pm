# Call-site completeness sweep — gates-bind-to-verified-evidence (tasks 11.1, 11.2)

Derived with `rg` against `dev` after e540142 (the last implementation commit). Comment and JSDoc
lines are filtered out of each listing (`rg -v ':\s*(//|\*)'`); every remaining hit is classified
below. A site where a rule does not hold is a FINDING unless its justification is stated here.

## 1. Writers of a `may-invalidate` link vs. the 0.44.0 stamp

`rg -n "may-invalidate|linkOnce|mergeLinks|epicReferences|\.links\b" scripts/lib`

| Site | Writes | Arming record written | Verdict |
|---|---|---|---|
| `detour-stack.mjs:48-74` `linkOnce()` (called from `pushDetour`, :160) | creates or finds the paused epic's link | new: `arm === true`; found + `--reconcile`: `true` (re-arm moves `reconciled` → `superseded`); found + `--no-reconcile`: untouched | holds |
| `links.mjs:85-105` `mergeLinks()` ← `update-epic.mjs:780`, `add-epic.mjs:406`, `add-many.mjs:147` | creates a supplied link; corrects a reason in place | create: forced `false` whatever the input carried; correction: every stored key other than type/epic/reason kept | holds |
| `links.mjs:259-271` `stampReconcileKeys()` ← `migrations.mjs` 0.44.0 entry and `upgrade()` every run | keys every keyless link | `reconciled`-free, owing, other-and-existing target → `true`; else `false` | holds |
| `migrations.mjs:38` 0.5.0 `normalizeLink()` | repairs colon-string links into objects | none — but it only replays on a state stamped below 0.5.0, and MIGRATIONS apply sorted by release, so 0.44.0's stamp and `upgrade()`'s per-run stamp both run after it | justified |
| `update-epic.mjs:776` `--clear-links` | empties the array | n/a — refused while `holdsOwedReconcileRecord(epic)` | holds |
| `links.mjs:339` `epicReferences()` drop (← `remove-epic`) | strips a link to a removed epic | n/a — an armed/unmigrated link on an owing epic is `drop: null`, kind `owed-reconcile` | holds |
| creation sites `add-epic.mjs:420`, `add-many.mjs:139`, `subcommands.mjs:541/576/648`, `epic-progress.mjs:337` | `links: []` on a new epic | nothing to key | holds |

No path creates a keyless `may-invalidate` link after the stamp. A keyless link can still ARRIVE
from outside the engine (an unreloaded 0.43.0 session, a second machine sharing `state.json`); that
is why `upgrade()` stamps on every run and `record-reconcile` refuses naming `/pm:upgrade`.

Readers that are not writers: `reconciler-writeback.mjs:58,70` (unmigrated refusal, armed lookup),
`epic-progress.mjs:173` (heal), `links.mjs:200` (`supersededEpics`, type `supersedes` only),
`links.mjs:419-420` (`deferralHistory` counts every `may-invalidate` target — unchanged by arming,
by design: a hand-supplied edge was always counted), `dependency-order.mjs:57`, `epic-progress.mjs:402`,
`add-epic.mjs:273` (depends-on only), `briefing.mjs:254`, `render.mjs:107`, `integrity.mjs:472`
(unknown-type finding; names `record-reconcile` first on an owing epic), `add-many.mjs:116`
(type validation).

## 2. Writers of `reconcileNeeded` and `reconcileOnResume`

`rg -n "reconcileNeeded|reconcileOnResume" scripts/lib scripts/conductor.mjs`

`reconcileNeeded`:

| Site | Effect | Justification against the survival requirement |
|---|---|---|
| `detour-stack.mjs:146-147` push | SETS (OR) | never lowers |
| `detour-stack.mjs:235` pop | SETS from the popped frame | never lowers |
| `reconciler-writeback.mjs:101` accepted verdict | CLEARS only when `ownedDetours()` is empty and no live reconcile frame; a correction never raises it | the one verdict-driven clear the spec allows |
| `epic-progress.mjs:165` heal, live frame | SETS | — |
| `epic-progress.mjs:175` heal, nothing answerable | CLEARS, announced on stderr | the spec's one exception: no armed link, no unmigrated link, no frame — no verdict could ever be accepted |
| `add-epic.mjs:420`, `add-many.mjs:139`, `subcommands.mjs:541/576/648`, `epic-progress.mjs:337` | `false` on a NEW epic | a new record owes nothing |
| `active-pointer.mjs:62`, `links.mjs:278/335`, `gate-guard.mjs:50/109`, `briefing.mjs:64`, `render.mjs:55/128` | read only | — |

Every former clear is gone: the heal's "archived → clear" and "not active → clear" branches were
deleted (3122274); `record-reconcile`'s unconditional `= false` was replaced (709554e); `push-detour`'s
assignment became an OR (b93e41c).

`reconcileOnResume` — on a LINK: written at `links.mjs:95` (false), `links.mjs:266` (stamp),
`detour-stack.mjs:64/73` (push); read at `links.mjs:220/229` (`isArmed`/`isUnmigrated`). On a FRAME
(pre-existing field): written at `detour-stack.mjs:154`; read at `detour-stack.mjs:235`,
`links.mjs:242` (`liveReconcileFrame`), `epic-progress.mjs:160`, `briefing.mjs:123`, `render.mjs:79`.
`migrations.mjs:100` and `verb-effects.mjs:98` are prose.

## 3. Sites moving `state.active`

`rg -n "activate\(|state\.active\s*=" scripts/lib` — listed with warn/exempt in 3122274's message
and re-checked here unchanged: `setActive` (warns), `clearActive` (warns), `update-epic` pointer
sync (warns), `add-epic` creation at active (warns), `add-many` batch activation (warns),
`pop-detour` (warns — the pointer leaves the detour), `push-detour` (EXEMPT, the parking itself),
the heal nulling a pointer to an archived/missing epic (exempt: that epic has ended and gate-guard
ignores it; its obligation is kept), `epicReferences` dropping `state.active` on `remove-epic` of the
active epic (exempt: the record, flag included, is removed).

## 4. Readers of a `drop: null` reference

`rg -n "epicReferences\(" scripts/lib`: `remove-epic.mjs:72` — words each blocking reference by
`kind` (frame → resume/pop; owed-reconcile → `record-reconcile <holder> --detour <id>`);
`integrity.mjs:546` (`dangling-epic-reference`) — an owed-reconcile reference is no longer called a
frame. No third reader.

## 5. Commit values

`rg -n "attributedCommits|withdrawnCommits|baseSha|headSha|withdrawnGateReviews" scripts/lib`

| Writer | Class |
|---|---|
| `update-epic.mjs:783-784` `--attribute-commit` | resolving-at-write (full name) |
| `update-epic.mjs:709-710` `--withdraw-commit` | identity match; the record stores the removed entry verbatim (legacy-tolerant by design) |
| `gate-review-writeback.mjs:148-149` range bounds | resolving-at-write |
| `gate-review-writeback.mjs` `superseded` carry | history: the prior entry moves as stored, never re-resolved |
| `update-epic.mjs:729` `withdrawnGateReviews` | history: the whole entry moves as stored |
| `state.mjs:94-95` `pushEpic` | seeds `[]` |
| migrations / archive-drift heal | write no sha (the heal's `ungated` gate2 carries no range) |

Readers that hand a value to git (`rg -n "isAncestor|sameCommit|commitDate|objectExists|reachableFromAnyRef|merge-base|rev-parse|rev-list" scripts/lib`):

| Reader | Class |
|---|---|
| `archive-gate.mjs:126-131` `gateStaleness` | reading-full: shape-gated, `resolveCommits` + one `rev-list`; a malformed value never reaches git |
| `update-epic.mjs:252/262/681` | resolving-at-write / identity (stored entries resolved only when shaped) |
| `gate-review-writeback.mjs:112` | resolving-at-write |
| `integrity.mjs:755-756` recorded-sha arms 1-2 | reading-full, shape-gated since efaa8b8 (arm 3 reports the rest) |
| `integrity.mjs:229` `verdict-range-omits-cited-commits` → `isAncestor(sha, entry.headSha)` | shape-gated in `isAncestor()` itself since the Gate 2 follow-up: a value not shaped as a commit name answers `null` (no finding, as for any unanswerable pair) and never reaches git; revisions follow `--end-of-options` |
| `integrity.mjs:387` `commitDate(last attributed)` | shape-gated in `commitDate()` (non-commit-name → `null`, "arm does not apply"), `--end-of-options` before the revision |
| `worktree-hygiene.mjs:72` `isAncestorOfCurrentHead` | a worktree head from `git worktree list`, not a stored value — still moved from a shell string to argv, shape-gated and after `--end-of-options` |
| `commit-watch.mjs:62-65`, `created-at.mjs:60-63`, `git.mjs:10` | not recorded values (HEAD, repository probes) — out of scope |

**Gate 2 correction.** An earlier version of this table excused rows 229 and 387 under the design's
Non-Goal ("no change to which verdicts integrity's existing arms report"). That Non-Goal is about
WHICH VERDICTS are reported, and it never covered what git does with the argument: a stored
`attributedCommits: ["--output=<path>"]` reached `git show` as an OPTION and created `<path>` when
`integrity` ran. Every git call taking a stored value — `isAncestor`, `commitDate`, `objectExists`,
`reachableFromAnyRef` (value inside `--contains=`), `commitsNotReachedBy` (full names only) — now
refuses a value not shaped as a commit name before spawning git and passes revisions after
`--end-of-options`; `resolveCommits` feeds values on stdin, never as arguments. Enumerated with
`rg -n 'execFileSync\("git"|execSync\(' scripts/lib`. `sameCommit()` had no caller and was deleted.

Emitted text still describing the LAST-entry rule — `rules.mjs:266` and the attribution nudge in
`subcommands.mjs:361-366` — is task 12.2's (docs, after Gate 2), not an engine site.

## 6. DATA references added

- `links[].reconcileOnResume` — holds no epic id. Written: push (`linkOnce`), `mergeLinks` (create),
  `stampReconcileKeys`. Read: `isArmed`, `isUnmigrated` and everything built on them. Removed: only
  with its link (`--clear-links`, `remove-epic` sweep, removal of the holding epic) — each of which is
  refused while the link protects an owed obligation.
- `links[].superseded` — holds no epic id (a prior `{verdict, amendments, reconciledAt}`). Written:
  push re-arm, verdict correction (one level deep: the verdict moved in never carries its own
  `superseded`). Read: by humans/state readers only. Removed: with its link; kept across reason
  corrections (`mergeLinks`).
- The link's `epic` itself was already swept by `epicReferences`; it now carries `kind`.

## 7. Inverses (task 11.2)

| Operation | Inverse | Shipped? |
|---|---|---|
| Arming (`push-detour --reconcile`) | answering (`record-reconcile`); ending the epic (`remove-epic <paused>`) | yes |
| Answering (`record-reconcile`) | re-arm by a new `--reconcile` push; correction by re-recording (prior kept in `superseded`) | yes. **No un-answer verb, deliberately:** a verdict records a judgment somebody made, and withdrawing it without a replacement would recreate an owed obligation with no new pause to justify it — the re-arm is the honest route when the work pauses again |
| Write-time resolution | `--withdraw-commit`, which matches by identity and still reaches legacy unresolvable entries by exact spelling (3067eb0, test 3.2) | yes |
| Destroying-write refusals (`--clear-links`, `remove-epic <detour>`) | `record-reconcile`, then the same write (once nothing is owed the link is no longer protected) | yes |
| 0.44.0 arming stamp | none shipped: a migration is one-way by construction; a wrong `false` is corrected by `push-detour --reconcile`, a wrong `true` by `record-reconcile` | justified |
| `--amendment` / `--amendments none` | re-record the verdict (correction) | yes |

## Conclusion

Every rule holds at every derived call site except the two legacy-tolerant integrity readers in
§5, which the design's Non-Goals exempt and arm 3 covers, and one dead export (`sameCommit`) noted
for Gate 2. No site creates a keyless link after the stamp, no write clears `reconcileNeeded` outside
the verdict and the announced unanswerable case, and every pointer move off an owing epic warns or is
exempt with its reason stated.
