## 0. Before any code

- [x] 0.1 Gate 1 — two fresh-context lenses over these artifacts BY PATH (lens A: correctness and
      testability of every WHEN/THEN against today's engine; lens B: absent edits — call sites,
      DATA references and inverses the specs do not name); fix every Critical and Important,
      re-validate with `openspec validate gates-bind-to-verified-evidence --strict`, then record
      `record-gate-review gates-bind-to-verified-evidence --gate 1 --verdict pass --reviewer "<identity>"
      --artifact openspec/changes/gates-bind-to-verified-evidence/proposal.md --artifact
      openspec/changes/gates-bind-to-verified-evidence/design.md --artifact
      openspec/changes/gates-bind-to-verified-evidence/tasks.md --artifact
      openspec/changes/gates-bind-to-verified-evidence/specs/gate-integrity/spec.md`
- [x] 0.2 **Cross-spec review** (required task item 5) — release 0.44.0 holds this change's spec and
      its two siblings' (`every-verb-refuses-what-it-does-not-read`, `state-file-refuses-to-guess`).
      Run the `cross-spec-review` skill after all three pass Gate 1 and again after any later
      amendment; record `record-cross-spec-review 0.44.0 --verdict pass|fail --reviewer "<identity>"`
- [x] 0.3 Re-derive every line anchor in design.md with `rg` after changes 1 AND 2 have merged into `dev`
      (change 2 edits `migrations.mjs` `upgrade()`, the top of `gate-guard.mjs`, `commitNudge` and
      `conductor.mjs`'s catch),
      and correct design.md in the first implementation commit if any moved

## 1. Test fixtures that hold real commits

The pre-commit hook runs the whole suite, so every RED test below lands in the SAME commit as the
GREEN task that turns it green; the pairs are named per section. Before that commit, the new test
run against the pre-GREEN engine is saved in this change directory as `red-<task>.txt`, and the
GREEN commit message names that file. New test files: `scripts/test/commit-resolution.test.mjs` and
`scripts/test/reconcile-obligation.test.mjs`, importing `helpers.mjs`.

- [x] 1.1 REFACTOR: add a `helpers.mjs` fixture that creates one real commit per requested name in
      the fixture repo and returns its full object name. `tmpRepo()` does not create a git
      repository (`conductor-13`'s harness uses it), so the fixture runs a hermetic `git init` in the
      directory first when none exists; suite green with no test converted yet
      (verify: `node --test scripts/test/*.test.mjs` exit 0, output saved and read from the file)

## 2. A recorded commit is resolved when it is written

Pairs: 2.1–2.5 land with 2.6.

- [x] 2.1 RED: `update-epic <id> --attribute-commit not-a-commit` exits non-zero naming it;
      `state.json` byte-identical (repro A's first step)
- [x] 2.2 RED: `record-gate-review <id> --gate 2 --verdict pass --base-sha main~1 --head-sha HEAD
      --reviewer r`, then a new commit — stored `baseSha`/`headSha` equal the full names of `main~1`
      and `HEAD` at call time (repro B)
- [x] 2.3 RED: `--attribute-commit <unique short hash of C>` stores C's full name, and exits 0 (the
      read-back does not report it missing)
- [x] 2.4 REGRESSION GUARD: a commit reachable only from a `presquash/*` tag, attributed while another
      branch is checked out, is accepted and stored in full (`repro-tagonly.sh` shape)
- [x] 2.5 RED: `--base-sha root --head-sha <commit>` exits non-zero naming `root`; no verdict recorded
- [x] 2.6 GREEN: `resolveCommits()` in `git.mjs` (design Decision 7) called before `loadState()` in
      `update-epic` (`--attribute-commit`) and `record-gate-review` (both range flags, both gates);
      store full names; `missingAttributions()` compares resolved names; convert every test that
      feeds a fake sha to these flags to the 1.1 fixture in this same commit (sweep:
      `rg -n -- "--attribute-commit|--base-sha|--head-sha" scripts/test`; `conductor-13`'s documented-flag
      harness gets a resolvable default commit rather than per-call edits); 2.1–2.5 pass, suite green

## 3. A commit withdrawal matches the attributed commit, not its spelling

Pairs: 3.1–3.3 land with 3.4.

- [x] 3.1 RED: attributed short C, `--withdraw-commit <C full> --withdrawal-reason x` exits 0, the
      entry is gone, and the withdrawal record names the stored entry (repro E)
- [x] 3.2 REGRESSION GUARD: a state file attributing the literal `not-a-commit` withdraws it with
      `--withdraw-commit not-a-commit --withdrawal-reason x`
- [x] 3.3 RED: on an epic that ALREADY attributes C in full (otherwise today's "never attributed"
      refusal passes this vacuously), `--attribute-commit <C short> --withdraw-commit <C full>
      --withdrawal-reason x` exits non-zero, `state.json` byte-identical
- [x] 3.4 GREEN: design Decision 8 in `update-epic.mjs` — identity matching removing the LAST match,
      exact-string fallback for unresolvable values, the contradictory-pair check by identity, and the
      withdrawal read-back comparing the removed entry; existing `--withdraw-commit` tests
      (`gate-verdict-withdrawal.test.mjs`, `conductor-36`) converted to the fixture; suite green

## 4. Staleness over every attributed commit

Pairs: 4.1–4.6 land with 4.7.

- [ ] 4.1 RED: attributed `[descendant of A, A]`, passing Gate 2 at A, `--status archived --outcome
      delivered --no-deferrals` exits non-zero naming the descendant; PROJECT.md renders `⚠ stale`
      (repro D; absorbs `gate-staleness-reads-only-last-attribution`)
- [ ] 4.2 RED: a passing Gate 2 whose `headSha` is a commit sharing no history with the attributed
      commits refuses a `delivered` archive and renders stale (repro C)
- [ ] 4.3 RED: a state file attributing `not-a-commit` beside a resolving `headSha` refuses a
      `delivered` archive naming `not-a-commit`; renders `⚠ stale`, not `⚠ unverifiable` (repro A)
- [ ] 4.4 RED: a state file whose `attributedCommits` is exactly `[<one resolvable fixture commit>]`
      and whose Gate 2 `headSha` is the literal `HEAD` renders stale in PROJECT.md and the brief, and
      refuses `delivered` naming `HEAD` (repro B's legacy form)
- [ ] 4.5 REGRESSION GUARD: a hexadecimal `headSha` or attributed entry absent from the fixture's
      object store, with no resolvable attributed commit unreached → `⚠ unverifiable`, archive not
      refused; absent array → unverifiable; empty array → `no attributed commits`; withdrawn-to-empty →
      `attribution withdrawn`
- [ ] 4.6 REGRESSION GUARD: `headSha` = last attributed and every earlier entry its ancestor, with
      unrelated commits past it on `main` → fresh and archives; the archived-epic regression check
      still refuses `--attribute-commit <descendant>` on an archived `delivered` epic and does not lock
      one whose Gate 2 already failed
- [ ] 4.7 GREEN: design Decision 9 in `archive-gate.mjs` `gateStaleness()` (batched `rev-list`,
      per-process cache, no reachability probe) and the refusal wording in `deliveredObligations()`
      and `archiveGate()`; timing of `gateTableRows` over this repository's own state recorded in the
      commit message against the design's ~911 ms baseline. In this same commit, sweep and convert
      every existing assertion whose staleness classification changes — derived with
      `rg -n "attributedCommits|headSha|unverifiable|stale" scripts/test` (known at proposal time:
      `gate-artifact-evidence` seeds `attributedCommits: ["HEAD"]`; `delivered-obligations`,
      `archive-gate-order`, `recorded-sha-resolvability`, `conductor-22`, `conductor-25`,
      `conductor-06`, `conductor-14`, `gate-verdict-withdrawal` hand-seed states), each converted test named in the commit message; suite green

## 5. Integrity reports a non-object-name value

Pairs: 5.1 lands with 5.3.

- [ ] 5.1 RED: a state file whose Gate 2 `headSha` is `HEAD` — `integrity` names the epic, the field
      and `HEAD`; `state.json` unchanged
- [ ] 5.2 REGRESSION GUARD: after re-recording that Gate 2 over resolvable shas, no finding of this
      kind names the epic; a resolving short hash is never named by it
- [ ] 5.3 GREEN: the third arm of `recorded-sha-the-repository-cannot-resolve` (design Decision 10);
      suite green

## 6. A reconcile verdict answers only a detour the epic owes

Pairs: 6.1–6.8 and 6.9a–6.9g land with 6.10.

- [ ] 6.1 RED: after push `p`→`d` `--reconcile` and pop, `record-reconcile p --detour p --verdict valid` exits
      non-zero naming `d`; `state.json` byte-identical; `gate-guard` exits 2 (repro 1a)
- [ ] 6.2 RED: `record-reconcile p --detour other --verdict valid` exits non-zero and writes no link (repro 1b)
- [ ] 6.3 RED: owed vs `d`, then push `p`→`d2` `--no-reconcile` and pop; `record-reconcile p --detour
      d2 --verdict valid` exits non-zero naming `d`
- [ ] 6.4 RED: with the `p`→`d` frame still on the stack, `record-reconcile p --detour d --verdict valid` exits
      non-zero, byte-identical
- [ ] 6.5 REGRESSION GUARD: owed vs `d` only; `record-reconcile p --detour d --verdict valid` exits 0,
      verdict readable, flag false, `gate-guard` exits 0
- [ ] 6.6 RED: push/pop `d` then push/pop `d2`, both `--reconcile`; a verdict vs `d` leaves the flag
      true and `gate-guard` exiting 2 until `d2` is answered
- [ ] 6.7 RED: push/pop/answer `valid` vs `d`, push/pop `d` again `--reconcile`, answer
      `invalidated` — exits 0, flag false, `valid` still readable on the link (repro `r-repush`)
- [ ] 6.8 RED: correcting an answered verdict keeps the replaced one readable and does not set the flag
- [ ] 6.9a RED: owed vs armed `d`, `update-epic p --link "may-invalidate:x:why"` — the `x` link
      carries `reconcileOnResume: false` and `record-reconcile p --detour x --verdict valid` is refused naming `d`
- [ ] 6.9b RED: a 0.43.0 state file (`reconcileNeeded: true`, keyless unanswered link to `d`) before
      `upgrade` — `record-reconcile p --detour d --verdict valid` exits non-zero naming `/pm:upgrade`, byte-identical,
      and, `p` being active, `render` leaves `p` owing
- [ ] 6.9f RED: that 0.43.0 `p`, then `push-detour p --detour d2 --reason r --reconcile` and pop before
      `upgrade` — `record-reconcile p --detour d2 --verdict valid` exits non-zero naming `/pm:upgrade`,
      byte-identical, `p` still owes
- [ ] 6.9g RED: a state file stamped `pmVersion` 0.44.0 holding owing `p` with a keyless
      `may-invalidate` link to an archived detour — `upgrade` leaves that link carrying
      `reconcileOnResume: true` (today's upgrade adds no key, so this half is what fails), then
      `record-reconcile p --detour <it> --verdict valid` exits 0. Plus the self-link case: a keyless
      `may-invalidate:p` link on owing `p` is stamped `false`, and after `d` is answered `p` owes
      nothing (lands with 6.10: `stampReconcileKeys` runs on every `upgrade`)
- [ ] 6.9c RED (migration): that 0.43.0 file through `upgrade` — the `d` link carries `true`, then
      `record-reconcile p --detour d --verdict valid` exits 0 and clears; a keyless link on an epic
      with `reconcileNeeded: false` becomes `false`; a keyless link already carrying a verdict becomes
      `false`
- [ ] 6.9d REGRESSION GUARD (migration): applying the 0.44.0 entry twice leaves `state.json`
      unchanged, and a link already carrying a key is untouched
- [ ] 6.9e REGRESSION GUARD: a 0.43.0 state file loads and every read-only verb (`brief`,
      `integrity`, `gate-guard`) exits as before on it
- [ ] 6.10 GREEN: design Decisions 1–3 in `reconciler-writeback.mjs`, `detour-stack.mjs`, `links.mjs`
      and `migrations.mjs` (arming on the link at push via `linkOnce`, `false` on links `mergeLinks`
      creates, per-link `isArmed()`/`isUnmigrated()`, re-arm, acceptance predicate, `link.superseded`,
      flag written from `ownedDetours`, the refusal on any epic holding an unmigrated link, the `0.44.0`
      MIGRATIONS entry and the per-run `stampReconcileKeys` call in `upgrade()`); existing record-reconcile tests (`conductor-09`, `conductor-31`) that record
      against an unarmed or self detour corrected and named in the commit; and, in this same commit, every `record-reconcile` call in the suite — derived with
      `rg -n "record-reconcile" scripts/test` at commit time, change 1's `verb-surface.test.mjs`
      `DISPATCH_BASELINE` (`record-reconcile e1 --detour other --verdict valid`, no push) included —
      moved onto a pushed, armed and popped detour; if that shared fixture now arms `other`, re-check
      the `remove-epic` baseline against 9.4's refusal; suite green

## 7. A reconcile obligation survives until answered

Pairs: 7.1–7.4 and 7.4a land with 7.5.

- [ ] 7.1 RED: owed `p` active, `clear-active` then `render` — flag still true, and `clear-active`'s
      stderr names `p` and `d` (repro 2a)
- [ ] 7.2 RED: `set-active other` then `set-active p` — flag true, `gate-guard` exits 2 (repro 2b)
- [ ] 7.3 RED: `update-epic other --status active` — `p`'s flag still true after the render, and that
      command's stderr names `p` and `d`; `add-epic --id q --title q --lane claude-code --status active` likewise
- [ ] 7.4 RED: owed vs `d`, `update-epic p --status archived --outcome abandoned --reason r
      --no-deferrals`, then `update-epic p --status active` — flag true, `gate-guard` exits 2
- [ ] 7.4b REGRESSION GUARD: an archived owing epic does not make `gate-guard` block
- [ ] 7.4a RED: a state file with active `p`, `reconcileNeeded: true`, no frame, and no
      `may-invalidate` link other than one carrying `reconcileOnResume: false` — `render` clears the flag and stderr names `p` (`repro-integrity.txt` shape); and owed `p`
      holding an armed link keeps the flag through `clear-active` + `render`
- [ ] 7.5 GREEN: delete `reconcileArchived()`'s archived → clear branch and replace its third branch
      with the no-armed-link branch (design Decision 4); `owedReconcileNotice()` at every site
      that moves `state.active` off an epic (design Decision 4, site list derived with
      `rg -n "activate\(|state\.active\s*=" scripts/lib` at this commit and pasted into its message);
      rewrite the `detour-stack.mjs` header's "ORDERING TRAP" paragraph and the heal's comment to the
      new rule; the `conductor-09` assertion FINDINGS calls unfailable now fails if the heal clears.
      In this same commit, sweep and convert every existing fixture that relies on the old heal —
      derived with `rg -ln "reconcile|detour" scripts/test` (known at proposal time: `conductor-03`'s
      "render never clears an active epic with no frame" fixture `{reconcileNeeded: true, links: []}`,
      `conductor-14`'s `set-gate-guard` block expectation, `conductor-05` fixtures) — each moved onto
      an armed link or re-asserted against the new rule, and named in the commit message; suite green

## 8. A later detour never overwrites an earlier obligation

Pairs: 8.1–8.2 and 8.2a land with 8.4 (8.2a needs the arming of 6.10, the heal of 7.5 and the OR of 8.4).

- [ ] 8.1 RED: owed vs `d`, `push-detour p --detour d2 --reason r --no-reconcile` — flag stays true
      and the report does not state no reconcile is owed on resume (repro 3)
- [ ] 8.2 RED: then `pop-detour p` — stdout has no `no reconcile was required` line,
      `.conductor/honcho-memories.log` gains no POP line for `p`, stderr names `d`, `gate-guard` exits 2
- [ ] 8.2a RED: owed vs armed `d`, `push-detour p --detour d --reason r --no-reconcile`, pop, `render` —
      `p` still owes vs `d` and `record-reconcile p --detour d --verdict valid` exits 0
- [ ] 8.3 REGRESSION GUARD: an epic owing nothing pushed `--no-reconcile` and popped still emits and
      logs its POP line
- [ ] 8.4 GREEN: design Decision 6 in `detour-stack.mjs`; suite green

## 9. A write never destroys an owed reconcile's record

Pairs: 9.1–9.3b land with 9.4.

- [ ] 9.1 RED: owed vs `d`, `update-epic p --clear-links` exits non-zero naming `record-reconcile`,
      byte-identical
- [ ] 9.2 RED: owed vs `d`, `remove-epic d` exits non-zero with a message naming `record-reconcile`
      and not telling the reader to resume or pop a detour; byte-identical; `p` still owes vs `d`
- [ ] 9.3 RED: `update-epic p --link "may-invalidate:d:corrected reason"` on an answered armed link
      keeps the verdict and arming, changes the reason
- [ ] 9.3a RED: `p`'s armed `d` answered while `p` owes vs armed `d2` — `update-epic p --clear-links`
      and `remove-epic d` each exit non-zero, byte-identical
- [ ] 9.3b RED: owing `p` holding a malformed link — the integrity finding names `record-reconcile`
      before the repair, and `update-epic p --clear-links --link "<kept>"` is refused byte-identical
- [ ] 9.4 GREEN: design Decision 5 in `update-epic.mjs`, `links.mjs` (`mergeLinks`,
      `epicReferences` with a reference `kind`), `remove-epic.mjs`'s refusal and `integrity.mjs`'s
      `dangling-epic-reference` detail worded by `kind`; both clear-and-re-supply repair messages
      (`links.mjs` `unknownLinkTypeMessage`, `integrity.mjs` unknown-link-type finding) name
      `record-reconcile` first when the epic owes (epic-annotation delta), with a RED 9.3b asserting
      it and the refused repair; the existing "corrected reason, same position" tests stay green; suite green

## 10. Amendments

Pairs: 10.1–10.3 land with 10.4.

- [ ] 10.1 RED: `--amendments none` (and `None`) records `[]`
- [ ] 10.2 RED: `--amendment "rename x; keep y" --amendment "drop z"` records exactly those two
- [ ] 10.3 RED: `--amendment a --amendments b` exits non-zero, byte-identical, and its message does
      NOT contain `unknown flag` and does state that the two flags cannot be combined (change 1's
      unknown-flag refusal already names `--amendments`, so naming the flags alone would pass vacuously)
- [ ] 10.4 GREEN: register `--amendment` (`repeats: true`) for `record-reconcile` in `VERB_FLAGS`
      (`constants.mjs`) and read it in `reconciler-writeback.mjs`; the parity ledger and the flag
      registry tests pass; suite green

## 11. Required task items

- [ ] 11.1 **Call-site completeness sweep** — derived with `rg` at sweep time, never from this list:
      - the `0.44.0` MIGRATIONS entry against every other writer of a `may-invalidate` link, so no
        path can create a keyless one after the migration;
      - every writer of `reconcileNeeded` and `reconcileOnResume`
        (`rg -n "reconcileNeeded|reconcileOnResume" scripts/lib scripts/conductor.mjs`), each stated as
        setting, clearing or preserving, and every clear justified against the survival requirement;
      - every site moving `state.active` (`rg -n "activate\(|state\.active\s*=" scripts/lib`), each
        stated as warning or exempt;
      - every writer and reader of `links[]` entries of type `may-invalidate`, derived with
        `rg -n "may-invalidate|linkOnce|mergeLinks|epicReferences|\.links\b" scripts/lib` (expected to
        include `linkOnce` in `detour-stack.mjs`, `mergeLinks`, `epicReferences`, `--clear-links`,
        the two emitted clear-and-re-supply repair messages — `unknownLinkTypeMessage` in `links.mjs`
        and the unknown-link-type finding in `integrity.mjs` (`rg -n "clear-links" scripts/lib`) — each
        naming `record-reconcile` first on an owing epic,
        `add-many`, `deferralHistory`, render and briefing);
      - every reader of a `drop: null` reference from `epicReferences` (expected: `remove-epic`,
        `integrity`), each stated as wording by reference kind;
      - every writer of `attributedCommits`, `withdrawnCommits`, `gateReview.gateN.baseSha/headSha`
        (incl. `superseded`, `withdrawnGateReviews`, migrations, the archive-drift heal) and every
        reader that passes one to git (`rg -n "isAncestor|sameCommit|commitDate|objectExists|reachableFromAnyRef|merge-base|rev-parse|rev-list" scripts/lib`),
        each stated as resolving-at-write, reading-full, or legacy-tolerant.
      DATA references added: `links[].reconcileOnResume`, `links[].superseded` (hold no epic id; the
      link's `epic` is already swept by `epicReferences`) — state where each is written, read and
      removed.
      A site where a rule does not hold is a FINDING unless justified in the commit.
- [ ] 11.2 **Inverse of every operation added or modified** — arming (inverse: answering, and ending
      the epic); answering (inverse: re-arm by push, correction by re-record — no un-answer verb, and
      say why); write-time resolution (inverse: `--withdraw-commit`, which must reach legacy values);
      the destroying-write refusals (inverse: `record-reconcile` then the same write); the 0.44.0
      arming stamp (no inverse shipped: a migration is one-way by construction, and a wrong stamp is
      corrected by `push-detour --reconcile` or by `record-reconcile`). Each unshipped
      inverse named and justified in the commit message
- [ ] 11.3 **Verify against the commit** — `git show --stat <sha>` for every task commit; every file
      the task claims is present in THAT commit, including each converted test file and each
      `red-<task>.txt`
- [ ] 11.4 **Attribute every commit** as it lands: `update-epic gates-bind-to-verified-evidence
      --attribute-commit <sha>` — full sha, which the engine will now resolve and store in full. The
      archive commit, and any commit that only relocates this change's artifacts, is excluded
- [ ] 11.5 **Dispositions** <!-- pm:lifecycle --> — `update-epic gates-bind-to-verified-evidence --status archived --outcome delivered --no-deferrals`
      (swap `--no-deferrals` for `--deferral "<epicId>:<section>"` or `--declined-deferral
      "<what>:<why not>"` for anything Gate 2 defers), then record and end the absorbed epic:
      `update-epic gates-bind-to-verified-evidence --link "supersedes:gate-staleness-reads-only-last-attribution:absorbed — every-entry staleness"`
      and `update-epic gate-staleness-reads-only-last-attribution --status archived --outcome superseded
      --reason "absorbed by gates-bind-to-verified-evidence: its 2026-09-14 Gate 2 lens 2 repro (ancestor attributed after an uncovered descendant) is task 4.1; its 2026-09-15 note (--attribute-commit notasha stored, read unverifiable, uncounted by the regression check) is tasks 2.1 and 4.3" --no-deferrals`
- [ ] 11.6 **Route what the work taught** — name each as a practice (register an epic, with its
      evidence), tooling friction (`/pm:feedback [bug|feature] "<summary>"`), or a process failure (a
      lesson in `docs/lessons/` with `trigger`, `cost`, `enforced_in`). At minimum decide whether the
      fake-sha test fixtures that hid write-time validation for ten releases are a lesson

## 12. Docs (after Gate 2)

- [ ] 12.1 `agents/reconciler.md`, `commands/resume.md`, `commands/detour.md` — the armed-detour rule,
      the refusals, what pop prints while owed; ONE emitted amendments form: the reconciler's
      `AMENDMENTS: none` maps to `--amendments none`, other lines to one `--amendment` each; the
      honest ending for an owing epic whose work was abandoned (`--verdict invalidated` with the outcome
      as its amendment); `/pm:upgrade` before recording against a link written by 0.43.0
- [ ] 12.2 `scripts/lib/rules.mjs` emitted text and `skills/conductor/SKILL.md` — the
      `record-reconcile` form; "LAST entry is the endpoint" wording replaced by "every attributed
      commit must be reached by `headSha`"; the declared load-bearing claims updated so the mirror
      guard stays meaningful
- [ ] 12.3 `commands/epic.md` and `commands/gate-guard.md` — write-time resolution of
      `--attribute-commit`/`--withdraw-commit` and the range flags (incl. that a clone without the
      reviewed range refuses the range flags); the pointer-move warning; the no-link heal notice
- [ ] 12.3a `.claude/skills/release-checklist/SKILL.md` and `.claude/skills/pr-workflow/SKILL.md` —
      record Gate 2 from the authoring clone before the squash-merge, or fetch `presquash/*` tags first
- [ ] 12.4 `README.md` where these flags or the reconcile gate are described
- [ ] 12.5 `CHANGELOG.md` `[Unreleased]` — Fixed (three reconcile bypasses, four sha bypasses) and
      Changed (write-time resolution refuses fake shas; staleness over every entry)
- [ ] 12.6 Full suite green, written to a file and read from the file

## 13. Gate 2 and close

- [ ] 13.1 Gate 2 — two fresh-context lenses over the committed range (A: spec alignment and real
      tests; B: absent edits against 11.1's sweep); fix Critical and Important; record
      `record-gate-review gates-bind-to-verified-evidence --gate 2 --verdict pass --reviewer "<identity>"
      --base-sha <parent of first attributed> --head-sha <last attributed>`
- [ ] 13.2 Archive this change <!-- pm:lifecycle --> — `/opsx:archive gates-bind-to-verified-evidence`,
      then the dispositions in 11.5
