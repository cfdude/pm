# Tasks — operations-ship-their-inverses

Epic id below is written `<epicId>`; it is the conductor epic registered for this change. Every
`record-*` / `update-epic` line is a WRITE to `.conductor/state.json`, not a sentence — no
communication contract shortens one.

The pre-commit hook runs the whole suite, so a RED test cannot land alone. Each RED/GREEN pair below
is committed as ONE commit: the failing run is saved in this change directory as `red-<task>.txt`
and named in that commit's message.

## 0. Gates before code

- [x] 0.1 **Gate 1 — spec review.** Dispatch TWO fresh-context reviewers (review mode is
  `thorough`) over the artifacts BY PATH, not by SHA range:
  `openspec/changes/operations-ship-their-inverses/proposal.md`,
  `.../design.md`, `.../specs/epic-autonomy/spec.md`, `.../specs/epic-disposition/spec.md`,
  `.../specs/gate-integrity/spec.md`, `.../tasks.md`. Lens A: WHEN/THEN testability and whether each
  scenario fails on today's engine. Lens B: cross-capability consistency — does the `epic-disposition`
  write-time refusal and the `gate-integrity` read-time check agree about the same set of
  id-holding fields, and does the frame-drop requirement contradict `A reconcile obligation survives
  until a verdict answers it`? Fix Critical + Important, re-run `openspec validate
  operations-ship-their-inverses --strict`, then record:
  `record-gate-review <epicId> --gate 1 --verdict pass --reviewer "<identity>" --artifact openspec/changes/operations-ship-their-inverses/proposal.md --artifact openspec/changes/operations-ship-their-inverses/design.md --artifact openspec/changes/operations-ship-their-inverses/specs/epic-autonomy/spec.md --artifact openspec/changes/operations-ship-their-inverses/specs/epic-disposition/spec.md --artifact openspec/changes/operations-ship-their-inverses/specs/gate-integrity/spec.md --artifact openspec/changes/operations-ship-their-inverses/tasks.md`
- [x] 0.2 **Cross-spec review for release 0.46.0.** This release holds two changes and five spec
  files flat across them (three here, plus `the-guard-covers-every-write-path`'s). Invoke the
  `cross-spec-review` skill over the WHOLE release spec set, with two lenses under `thorough`, and
  ask the six questions — contradiction, double ownership, unmeetable requirements, gaps against
  each proposal's Resolves list, vocabulary forks, shared chokepoints. Named chokepoint to check:
  both changes constrain a write that happens while `reconcileNeeded` is true. Split findings into
  BLOCKS and POLISH; fix the BLOCKS. **Preflight:** `record-cross-spec-review` enumerates the spec
  set from disk against a REGISTERED release, so confirm `release show 0.46.0` returns one and both
  changes' epics are members before running the verb — create it with `release 0.46.0 --intent
  "<what this release is for>"` if not. Then record:
  `record-cross-spec-review 0.46.0 --verdict pass|fail --reviewer "<identity>"`

## 1. Autonomy — the revoke that was never shipped

- [x] 1.1 **RED** — tests: a granted exact action is revoked with a reason and no longer authorises;
  a category grant is revoked by naming the category; the revoked entry is still present in
  `preAuthorized[]` carrying its revocation and reason. Save `red-1.1.txt`.
- [x] 1.2 **GREEN** — `scripts/lib/autonomy.mjs`: add the revoke path to `setAutonomy()`, marking
  **the matched entries that are not already revoked** rather than splicing, and never rewriting an
  existing revocation stamp — re-granting is the documented un-revoke, so a live and a revoked entry
  for the same action legitimately coexist and a whole-set mark would overwrite the earlier reason
  and date (design Decision 1). Add the mixed-match case to 1.1's RED list. Two flags, per design Decision 1: `--revoke <action |
  category:<name>>` and `--revoke-reason "<why>"`, both registered in `constants.mjs` `VERB_FLAGS`
  for `set-autonomy`, matching against the STORED value after the identical first-colon split the
  grant went through. `getAutonomy()` stays the only direct reader of `epic.autonomy`. Commit RED+GREEN together, naming `red-1.1.txt`.
- [x] 1.3 **RED** — tests: revoking a grant the epic does not hold exits non-zero writing nothing;
  revoking an already-revoked grant exits non-zero writing nothing; revoking with no reason or an
  empty reason exits non-zero writing nothing. Save `red-1.3.txt`.
- [x] 1.4 **GREEN** — the three refusals, each before `loadState()`-derived mutation so a refusal
  leaves the file byte-identical. Commit RED+GREEN together.
- [x] 1.5 **RED** — tests: `--level off` leaves grants intact and unrevoked; `--level autonomous`
  reports the count and identity of the live grants it arms, reports nothing about revoked ones, and
  says so explicitly when there are none; a revoked grant is not restored by re-arming; and
  **setting an already-autonomous epic to autonomous again still prints the same report**, so the
  `reportSave()` `unchanged` branch does not swallow it. Save `red-1.5.txt`.
- [x] 1.6 **GREEN** — the re-arm report, printed on BOTH of `reportSave()`'s branches. Commit
  RED+GREEN together.
- [ ] 1.7 **RED** — tests: `--preauthorize ":x"` exits non-zero writing nothing and the epic gains
  no autonomy block; an action with no reason is still accepted; a grant already on disk whose
  action is empty is not named by the re-arm report. **The empty-CATEGORY case is NOT in this RED
  list** — it already passes on 0.45.0 (`KNOWN_PREAUTHORIZE_CATEGORIES`, `autonomy.mjs:72-77`,
  verified exit 1), so it is a regression guard in 1.9 and a test that would go GREEN before the fix
  is written proves nothing. Save `red-1.7.txt`.
- [ ] 1.8 **GREEN** — the non-empty guard on the **ACTION half only** — the half that decides what is
  authorised. It is the same rule `declinedPairs()` carries, applied to the half that needs it, NOT a
  copy of its both-halves behaviour: "a grant with an action and no reason is still accepted" is a
  scenario this change keeps. Commit RED+GREEN together.
- [ ] 1.9 **REGRESSION GUARD** — assert that a state file written before this change (grants with no
  revocation field) reads back with every grant live, so the read-time default is exercised rather
  than assumed. Also assert the pre-existing empty-CATEGORY refusal still fires and still names the
  known category vocabulary — behaviour this change keeps, not behaviour it adds.
- [ ] 1.10 **RED** — tests for the emitted instruction text and the actor that reads a grant: the
  emitted rules block states the grants-with-no-revoke instance in the **past tense as measured
  evidence** rather than as a live present-tense claim, and its execution-time decision rule says that
  neither a REVOKED grant nor a grant naming nothing satisfies rule (a) — that emitted rule is the
  third surface `epic-autonomy` names for an on-disk empty grant, alongside the re-arm report (1.5)
  and the integrity check (2.5). Save `red-1.10.txt`.
- [ ] 1.11 **GREEN** — `scripts/lib/rules.mjs` (`:216-217` the claim this change falsifies, `:759` — `:753` before the sibling shifted it
  the decision rule) plus every fixture under `scripts/test/fixtures/` and every
  `output-text-integrity` expectation the reword moves; derive that list by running the suite, not
  from this sentence. **Reword, do not delete** — the evidence is what makes the required item stick,
  and `gate-integrity`'s sweep requirement cites the same instance at `openspec/specs/gate-integrity/
  spec.md:945` as a past measurement, which stays true and needs no delta; what stops being true is
  the emitted present tense. Check the mirrored surfaces (`skills/conductor/SKILL.md`, command docs)
  and the declared-load-bearing-claim parity guard that keeps them in step — a mirror left carrying
  the older claim is the exact failure that requirement names. Commit RED+GREEN together.

## 2. Disposition references — refuse what cannot be true

- [ ] 2.1 **RED** — tests against `update-epic`: `--carried-to <self>` on the archiving epic exits
  non-zero writing nothing; `--carried-to <unknown>` exits non-zero writing nothing; `--carried-to
  <unknown>` alongside `--outcome killed` exits non-zero too. Save `red-2.1.txt`.
- [ ] 2.2 **GREEN** — validate `--carried-to` in `scripts/lib/update-epic.mjs` before the gate
  decides, refusing empty / unknown / self and naming which. Commit RED+GREEN together.
- [ ] 2.3 **RED** — tests: `--deferral ":"` exits non-zero writing nothing; `--deferral
  "ghost:sec"` exits non-zero writing nothing; `--deferral "<self>:sec"` exits non-zero writing
  nothing; `--deferral "<other-registered>:sec"` still archives and reads back. Save `red-2.3.txt`.
- [ ] 2.4 **GREEN** — apply the same validation to the `pairs()` output for `--deferral`, **to the
  EPIC half only**: the artifact-section half may be empty today and this change keeps it that way
  (the epic-disposition scenario now supplies an empty section explicitly), so this is not
  `declinedPairs()`'s both-halves rule copied over. One helper shared with 2.2, not two — a second
  copy is the sibling-site defect this change is about.
  Commit RED+GREEN together.
- [ ] 2.5 **RED** — tests for the three integrity checks: a self-referential `carriedTo` is
  reported; a self-referential DEFERRAL is reported (same declared set, not `carriedTo` alone); an
  empty deferral epic is reported; an autonomy grant whose action and category are both empty is
  reported; and a record whose references all name other existing epics and whose grants all name
  something reports none of them. Save `red-2.5.txt`.
- [ ] 2.6 **GREEN** — `scripts/lib/integrity.mjs`: the checks, driven from `epicReferences()`'s
  declared set rather than an inline enumeration of holders. **That declaration must first become
  VALUE-AGNOSTIC**: `add()` at `links.mjs:324` is `if (typeof epic === "string" && epic)`, so an
  empty id never enters the emitted set and a check driven from it can never fire. Enumerate the
  holder whatever its value and let each consumer apply its own predicate — `dangling-epic-reference`
  and `remove-epic`'s sweep keep their existing non-empty test (2.7 asserts it). Self-reference and
  empty-id cover the SAME declared set, not `carriedTo` alone. The grant check is separate and is not
  driven from that set: a grant is not a reference. Commit RED+GREEN together.
- [ ] 2.7 **REGRESSION GUARD** — the value-agnostic enumeration in 2.6 changes what every consumer
  of `epicReferences()` sees, so assert each is unchanged: `dangling-epic-reference` still reports a
  non-empty unknown id exactly once and is not duplicated by the new empty-id check; `remove-epic`'s
  reference sweep and its `frame` / `owed-reconcile` refusals behave exactly as before, in particular
  it neither sweeps nor refuses on a holder whose value is empty. A fix that shipped the defect class
  this change is about, inside this change, is the failure mode being guarded here.

## 3. The detour frame's inverse

**3.1-3.4 LAND AS ONE COMMIT.** The archive refusal's own scenario requires its message to name the
operation that ends the frame, and that operation is not dispatched until 3.4 — a guard whose message
names a verb the engine does not have is the exact defect class this change closes, applied inside
it, and the delta says so as a prohibition ("THE REFUSAL IS NOT SUFFICIENT ON ITS OWN AND SHALL NOT
SHIP ON ITS OWN"). The pre-commit hook runs the whole suite, so an intermediate commit must be green
on its own terms as well. Write the RED files for 3.1 and 3.3 separately, name both in the single
commit message, and commit the refusal and the verb together.

- [ ] 3.1 **RED** — tests: archiving an epic named by a live frame through `update-epic --status
  archived` exits non-zero writing nothing, and the message names the spawned detour and
  `drop-detour`; archiving an epic with no frame is unaffected. Save `red-3.1.txt`.
- [ ] 3.2 **GREEN** — the live-frame arm in `scripts/lib/archive-gate.mjs`, bound to the interactive
  verb only. Commit RED+GREEN together.
- [ ] 3.3 **RED** — tests for `drop-detour`: drops the top frame and the one beneath becomes
  resumable; drops a BURIED frame leaving the frame above it untouched; does not change status and
  does not move the active pointer; accepts an already-archived epic. Save `red-3.3.txt`.
- [ ] 3.4 **GREEN** — `scripts/lib/detour-stack.mjs`: `dropDetour()`, selecting by epic rather than
  by position. **A new dispatched verb has more registry surface than the dispatch table** — the
  `verb-surface` capability enforces all of it suite-wide, so each of these lands in THIS commit or
  the suite fails on it: dispatch in `scripts/conductor.mjs` and the `USAGE` line; a `VERB_FLAGS`
  row for `--reason` on `drop-detour`; a positional row in `constants.mjs` (line 923, beside
  `"set-autonomy": EPIC_ID`) so an undeclared positional is refused; `--force` accepted because it
  writes; `--platform` declared if it is passed; `reportSave()` with a `changed`/`unchanged` pair so
  a save that changes nothing writes nothing (`state-write-guard`); a `verb-effects.mjs` row; and
  `--help` output describing exactly that surface. Derive the list with
  `rg -n "pop-detour" scripts/lib/*.mjs scripts/conductor.mjs` rather than from this sentence — a
  transcribed list goes stale. Commit RED+GREEN together.
- [ ] 3.5 **RED** — tests: a dropped frame's armed `may-invalidate` link stops being reported as
  owed, the record shows it dropped with its reason and NOT as reconciled, no reconcile verdict is
  written, and `remove-epic` on that epic is then no longer blocked by a frame or an owed reconcile.
  Save `red-3.5.txt`.
- [ ] 3.6 **GREEN** — end the obligation in the SAME `saveState` as the frame removal; a transition
  half-written is a record that disagrees with itself (this module's own header). Recompute
  `reconcileNeeded` by the SAME rule `reconciler-writeback.mjs` applies at its verdict transition
  (`ownedDetours(epic).length > 0 || liveReconcileFrame(state, id)`), not by a rule written fresh
  here — two spellings of "is anything still owed" is the sibling-site defect. **Both helpers are
  exported from `scripts/lib/links.mjs` (`:234`, `:241`)**, which `reconciler-writeback.mjs` imports;
  import them from there. There is a THIRD spelling — `reconcileArchived()`
  (`scripts/lib/epic-progress.mjs:108`), which re-derives the flag from live frames on every write
  path — so assert by test that a render after the drop neither re-arms nor re-clears anything.
  **Disarm the link; do not remove it** (`gate-integrity`'s *A write never destroys the record of an
  owed reconcile*), and note that clearing the flag here is the second exception the delta's MODIFIED
  block adds. Commit RED+GREEN together.
- [ ] 3.7 **RED** — tests: `drop-detour` on an epic with no live frame exits non-zero writing
  nothing; with no reason or an empty reason exits non-zero writing nothing. Save `red-3.7.txt`.
- [ ] 3.8 **GREEN** — the two refusals. Commit RED+GREEN together.
- [ ] 3.9 **REGRESSION GUARD** — assert `record-reconcile` refuses a verdict against a DROPPED
  detour, and that it refuses through its existing unarmed-link arm
  (`reconciler-writeback.mjs` check 2, `isArmed(link)`) rather than through a new arm. A drop that
  left the link armed would leave the epic able to record a verdict for an obligation nobody
  answered. Also assert `pop-detour` is unchanged for every case that worked before.
- [ ] 3.10 **REFACTOR** — if 3.4 and `popDetour()` now share frame selection or link handling,
  factor it once; do not leave two spellings of the same rule in one module.

## 4. Required task items (CLAUDE.md 1–7)

- [ ] 4.1 **Call-site completeness sweep — derived with `rg` AT SWEEP TIME, never typed from
  memory.** Sweep and state where each rule holds and where it does not, justifying every omission:
  - `rg -ni "pre-authoriz|preauthoriz" scripts/ commands/ skills/ agents/ hooks/` — WIDER than
    `getAutonomy|epic\.autonomy|preAuthorized` on purpose: that narrower pattern returns 0 hits in
    `scripts/lib/rules.mjs`, which emits the instruction text asserting the defect this change
    removes (`:216-217`) and the execution-time decision rule a revoked grant must not satisfy
    (`:759`, `:753` before the sibling shifted it). Run BOTH patterns. Every reader of a grant must honour the revocation stamp. Known at
    proposal time: `render.mjs:128` and `briefing.mjs:108` read `level` only;
    `agents/hierarchy-child-executor.md:50` is the only actor that acts on `preAuthorized`.
  - `rg -n "carriedTo|carried-to" scripts/ ` — DATA references: writers, readers **and removers**.
    `links.mjs:343` already sweeps `disposition.carriedTo` and `:351` sweeps
    `disposition.superseded.carriedTo`; state whether the new validation covers both.
  - `rg -n "deferralAssertion|deferrals\[\]" scripts/` — same three roles; `links.mjs:357` is the
    remover.
  - `rg -n "detourStack" scripts/` — every reader of the stack; state which ones a dropped frame
    changes the answer for.
  - `rg -n "isArmed|ownedDetours|reconcileOnResume|reconcileNeeded" scripts/` — every consumer of the
    obligation the drop ends.
- [ ] 4.1b **Emitted-remedy sweep** — the sibling `the-guard-covers-every-write-path` ships a Bash
  write-shape scanner and **lands FIRST** (Coordination 1), so its own task 4.1b cannot see any
  command line THIS change emits. Enumerate them with `rg` at sweep time — never from this list —
  and run each through the scanner as shipped: `rg -n '\Wdrop-detour|--revoke|--revoke-reason'
  scripts/ commands/ skills/ agents/` plus the usage and refusal strings 1.2, 1.4, 3.4 and 3.8 add
  to `scripts/lib/autonomy.mjs`, `scripts/lib/detour-stack.mjs` and `scripts/lib/constants.mjs`,
  the instruction text 1.11 rewrites in `scripts/lib/rules.mjs` (`:216-217`, `:759`), and the
  `commands/detour.md` text 5.1 writes. State per case whether it stays runnable or is accepted as
  blocked. Known at proposal time and to be RE-DERIVED rather than trusted: the UNFILLED template
  spelling — `drop-detour <pausedEpicId> --reason "<why>"` and `set-autonomy <id> --revoke <action
  | category:<name>>` each carry a `>` the redirection arm matches — is **ACCEPTED**, the filled
  command passes, and the class is PRE-EXISTING and owned by the sibling's design D7 rather than
  fixed at the emitting site here (Coordination 4). Anything else this change emits that the
  scanner blocks is a FINDING unless it is justified in that same place. A remedy pm prints that
  the guard then refuses shows up in no diff, because neither change's files need to move for it
  to be true.
- [ ] 4.2 **Inverses — enumerate and justify.**
 For every operation this change adds or modifies,
  name its inverse and say whether it ships: `--preauthorize` ↔ `--revoke` (ships, pair complete);
  `push-detour` ↔ `drop-detour` (ships, pair complete); `--revoke` ↔ re-granting (ships: granting
  again writes a new grant, and this is the documented un-revoke); `--context` and `--notify`
  (**NO inverse shipped** — justify: both are declared `repeats: true` with no `key`
  (`constants.mjs:741-742`) so `update-epic --clear` cannot reach either, and each is an append-only
  record of something that happened rather than a standing authorisation, so there is nothing live to
  take back; this is why the `epic-autonomy` spec scopes its inverse claim to `--preauthorize` rather
  than to every operation the capability offers); a grants clear-all (**NOT
  shipped** — justify: it is deletion, which Decision 1 rules out); `drop-detour` ↔ re-pushing the
  frame (**NOT shipped as an undo** — justify: `push-detour` already re-creates a frame, and an
  "un-drop" would have to resurrect an obligation deliberately ended). Any inverse not shipped and
  not justified here is a FINDING.
  **Enumerate `pushDetour()`'s FIELD writes too, not only the verbs** — an inverse is owed per
  write, and `push-detour` performs five: the frame, `paused.status`, `paused.reconcileNeeded`,
  `detour.role = "detour"`, and two links via `linkOnce()`. `drop-detour` addresses the frame and
  the obligation, and deliberately does not touch `paused.status` (3.3). State out loud whether
  `detour.role` and the detour's `resolves-blocker-for` link are un-done, and justify each answer —
  the likely justification is that both are historical record rather than control state, but this is
  the change whose thesis is that an unjustified missing inverse is a FINDING, so "obviously fine"
  is not an answer.
- [ ] 4.3 **Verify against the commit, not the working tree.** For every task above, run
  `git show --stat <that task's sha>` and assert every file the task claims to change appears in
  THAT commit. A task whose claimed file is absent FAILS even if the working tree holds the edit and
  the suite is green.
- [ ] 4.4 **Attribute every commit to this epic, at the moment it is made:**
  `update-epic <epicId> --attribute-commit <sha>`. The archive commit in 6.2 is lifecycle
  bookkeeping and MUST NOT be attributed.
- [ ] 4.5 **Route what this work taught.** Name which of the three each item is, out loud: a
  PRACTICE/GATE adopted → register it as an epic with its evidence; FRICTION in pm itself →
  `/pm:feedback [bug|feature] "<summary>"`; a PROCESS failure → a lesson file in `docs/lessons/`
  with `trigger`, a concrete `cost`, and `enforced_in`. Candidate already visible: the inverse
  obligation is itself a practice this change is exercising, and whether the required-task wording
  in CLAUDE.md caught it or the independent review did is the evidence.

## 5. Docs — after Gate 2

- [ ] 5.1 `commands/detour.md` — document `drop-detour`, when it is the right operation and when
  `/pm:resume` is, and that ending an obligation is not answering it.
- [ ] 5.2 `commands/epic.md` — the three refusals on `--carried-to` and `--deferral`.
- [ ] 5.3 `README.md` and `skills/conductor/SKILL.md` — the revoke, the re-arm report, and
  `drop-detour`. The SKILL's "Epic-level autonomy" section is where the revocation semantics belong.
- [ ] 5.4 `agents/hierarchy-child-executor.md` — decision rule (a) must say that neither a REVOKED
  grant nor one naming nothing covers an action. It is the only actor that acts on `preAuthorized`, and leaving it unedited would
  ship a revoke every engine reader honours and the one agent reader ignores.
- [ ] 5.5 `CHANGELOG.md` `[Unreleased]` entry, and the `.claude-plugin/plugin.json` version bump.
  (Mintlify sync belongs to the release cut, not to this change.)

## 6. Gate 2 and close

- [ ] 6.1 **Gate 2 — implementation review.** TWO fresh-context lenses over the committed
  `BASE..HEAD` diff (`thorough`). Lens A: spec alignment and real tests passing. Lens B: the
  call-site sweep's omissions and the inverse enumeration — re-derive both with `rg` rather than
  trusting 4.1/4.2's list. Fix Critical + Important; note Minor. Then record:
  `record-gate-review <epicId> --gate 2 --verdict pass --reviewer "<identity>" --base-sha <parent of first attributed commit> --head-sha <last attributed commit>`
- [ ] 6.2 Archive the change. <!-- pm:lifecycle -->
  `update-epic <epicId> --status archived --outcome delivered --reason "<what shipped>" --no-deferrals`
  — swap `--no-deferrals` for one `--deferral "<epicId>:<artifact section>"` per deferral actually
  held by a registered epic, or `--declined-deferral "<what>::<why not>"` per one deliberately not
  done. The assertion is a claim, not a default. Then `/opsx:archive
  operations-ship-their-inverses` and `/pm:status`. This commit is NOT attributed (4.4).
