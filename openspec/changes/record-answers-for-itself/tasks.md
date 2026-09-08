## 0. Release object first

- [x] 0.1 Create the `0.40.0` release object with its intent and member epics BEFORE task 8.4. The
      cross-spec gate enumerates the spec set from the release's member epics and refuses when the
      release does not exist — so recording that verdict is unrunnable until this exists. This
      ordering is itself a finding from Gate 1. <!-- pm:lifecycle -->

## 1. The clock — `createdAt` and `touchedAt`

- [x] 1.1 RED: test that a newly registered epic carries `createdAt`, that it is unchanged by a
      later mutation, and that an epic written without it reads as unknown rather than as a date
- [x] 1.2 RED: test that a save which changes nothing stamps nothing — no `touchedAt` advance, no
      revision bump, `state.json` byte-identical. This is the `state-write-guard` contract and the
      first draft's mechanism broke it
- [x] 1.3 RED: test that on a save which does write, only the epics whose stored content changed
      carry an advanced `touchedAt`
- [x] 1.4 GREEN: bind `createdAt` to `pushEpic` in `scripts/lib/state.mjs` — the single creation
      sink, already carrying the `attributedCommits` rule and covered by the source scan in
      `conductor-13.test.mjs` that forbids bypassing it. Do NOT enumerate creation surfaces: that
      approach was already tried here for the sibling field and already went stale
- [x] 1.5 GREEN: stamp `touchedAt` inside `saveState` AFTER the no-op early return, comparing each
      epic against the disk pre-image already read into `currentBody` at `state.mjs:197`
- [x] 1.6 Verify absence tolerance: a `state.json` written by 0.39.0 loads, renders and passes
      integrity with neither field present
- [x] 1.7 Confirm the three byte-idempotence tests still pass — `conductor-02.test.mjs:40`,
      `conductor-15.test.mjs:107`, `conductor-01.test.mjs:80`

## 2. History recovery — a re-runnable verb, not a migration body

- [x] 2.1 RED: test that the verb recovers a real date for an id whose introducing commit exists in
      the tracked history
- [x] 2.2 RED: test each degradation path independently — no git, untracked state file, shallow
      history, id absent from history — and assert every one yields ABSENT, never an error and
      never a fabricated date
- [x] 2.3 RED: test that re-running never overwrites a date already present, AND that an absent date
      is re-attempted and recovered when the checkout later has the history. The first draft froze
      the opposite and that was a Gate 1 Critical
- [x] 2.4 RED: test against a fixture carrying an epic in `status: "done"`, asserting the verb
      handles it like any other and does NOT repair the status
- [x] 2.5 RED: test that the release migration leaves `touchedAt` ABSENT on pre-existing epics.
      This is the Gate 1 round-2 Critical and it is NOT free: `upgrade()` applies every pending
      migration to one in-memory state and calls `saveState` ONCE (`migrations.mjs:183-188`), so the
      recovery writing `createdAt` makes every pre-existing epic differ from its disk pre-image. The
      per-record comparison MUST exclude both timekeeping fields — the same shape as `revision`'s
      exclusion from the whole-body comparison — or all 27 repositories read "last touched: upgrade
      day". Test the standalone re-run of the recovery verb the same way; it is the same write on a
      different day
- [x] 2.6 GREEN: implement the verb, invoked with an argv array and never a shell string
      (`git.mjs:141-142`; ids may predate `add-epic.mjs:345`'s validation)
- [x] 2.7 GREEN: add the `MIGRATIONS` entry keyed to 0.40.0 that INVOKES the verb once. Note in the
      entry why it delegates: `migrations.mjs:44-48` forbids a one-shot migration from reading disk
- [x] 2.8 Confirm no network connection is opened and only local history is read

## 3. Unknown-status integrity check

- [x] 3.1 RED: test that an epic whose status is outside `KNOWN_STATUSES` is reported with the epic
      id, the offending value, and the remedy
- [x] 3.2 RED: test that the finding names the consequence — exempt from every archived-status rule,
      and any dependency edge pointing at it reads unsatisfied permanently
- [x] 3.3 RED: test that the check repairs nothing and that a clean state file reports nothing
- [x] 3.4 GREEN: implement alongside `link-of-unknown-type` in `integrity.mjs`, following its shape
- [x] 3.5 Verify against a copy of a real repository's state file carrying `status: "done"` epics
- [x] 3.6 Assert the SEAM deliberately: a `done` epic is not `archived`, so the section-4 walker
      cannot reach it. This check reports the illegal status; the walker reaches those epics only
      after a human moves them to `archived`. Two halves of one measured number, split across two
      capabilities on purpose — test that the partition holds rather than leaving it implied

## 4. The unconsidered-outcome walker

- [ ] 4.1 RED: test the predicate is engine-stamped AND `outcome: unknown` — an evidence-derived
      engine stamp (`delivered` written by migration from a passing Gate 2) is EXCLUDED, and an
      agent-recorded outcome is excluded
- [ ] 4.2 RED: test that each returned epic carries the invocation that would record a disposition
- [ ] 4.3 RED: test `unreconstructable` is recordable with its required reason, and that afterwards
      the epic leaves the unconsidered set
- [ ] 4.4 RED: test that an `unreconstructable` epic with unticked tasks does NOT fire the
      zero-ticked check
- [ ] 4.5 GREEN: implement the walker and the `unreconstructable` outcome. This grows a CLOSED enum,
      and the consumers were enumerated mechanically rather than from memory:
      `KNOWN_OUTCOMES`; `AGENT_OUTCOMES`; `dispositionError`'s reason rule;
      `integrity.mjs:32` `EXPLAINED_OUTCOMES` (this IS the gate-integrity exclusion list, consumed
      at `:46`); **BOTH** literal alternations in `rules.mjs` — `:132` AND `:279`, not one; and
      `conductor-13.test.mjs:394`, which asserts the exact six-value set with the comment "a seventh
      outcome added without a rule fails it". Missing any of the last three fails CI immediately —
      `conductor-16.test.mjs:553` derives its normalizer from `AGENT_OUTCOMES` and warns that "a
      literal here silently stops matching". THREE MORE, none of which any test guards:
      `constants.mjs:310` (the `--outcome` placeholder, i.e. the `--help` text a user reads);
      `commands/epic.md:238` and `skills/conductor/SKILL.md:274` (the exemption-list mirrors)
- [ ] 4.5b FIX THE EXISTING STALENESS IN THE SAME EDIT — this is the evidence, not a prediction,
      and the count is FIVE, arrived at by `rg` over `README.md commands/ skills/ scripts/` rather
      than by reading the three sites someone remembered. `declined` was added to this same closed
      set in an earlier release, reached the engine (`disposition.mjs:33`, `integrity.mjs:32`,
      `constants.mjs:310`, `rules.mjs:132` and `:279`), and reached NONE of: `README.md:561`;
      `commands/epic.md:199` (the `--outcome` flag-table row a user reads); `commands/epic.md:238`
      and `skills/conductor/SKILL.md:274` (the exemption prose); and `conductor-18.test.mjs:253`.
      That last one is the finding inside the finding: it asserts
      `/--outcome delivered\|killed\|superseded\|abandoned/` against the emitted block and PASSES
      BY PREFIX MATCH, so the test that should have caught this drift is blind to it and will stay
      blind after `unreconstructable` lands. Anchor it or make it exact
- [ ] 4.5c Make the next growth fail loudly rather than ship stale: either render the emitted and
      mirrored `--outcome` enumeration FROM `KNOWN_OUTCOMES`, or declare a `mustSay` claim covering
      it so the drift guard sees it. Without one of the two, site 4.5b recurs on the growth after
      this one — the generic doc-currency line in 8.1 is the prose form this repo measures at 3/15
- [ ] 4.6 Assert the walker's INVARIANT against a fixture — every returned epic satisfies the
      predicate and no epic satisfying it is omitted. Do NOT assert a live count: a test naming a
      live number is a known failure mode here, and this release's own dispositions change it

## 5. Nullability, uniform clearing, and `--link` appends

- [ ] 5.1 GREEN first (the registry is a prerequisite, not an outcome): add `nullable: true` to the
      relevant `EPIC_FLAGS` rows in `constants.mjs`, `setOnly: "<reason>"` to any field deliberately
      left set-only, and register `--clear` itself as a value-bearing repeatable flag on
      `update-epic`. Without the declaration neither clearing shape can fail loudly; without the
      registration the shared flag-allowlist check fails against `commands/epic.md`. Declare `links`
      SET-ONLY for the generic form with its reason — `--clear-links` is grandfathered and is
      required in one invocation with `--link` for the atomic repair, which `--clear` cannot express
- [ ] 5.2 RED: test BOTH directions of the declaration, not one. (a) every `nullable: true` row is
      reachable by `--clear <field>`, derived from the registry so a later nullable row with no
      clearing path fails the suite; (b) every SETTABLE `EPIC_FLAGS` row carries one marker or the
      other — `nullable: true` or `setOnly: "<reason>"`. Without (b) an undeclared row passes
      silently, and undeclared rows are the population the requirement is about
- [ ] 5.3 RED: test that `--clear` names fields by FLAG spelling, not state key — `constants.mjs`
      warns these are two namespaces
- [ ] 5.4 RED: test that clearing one field leaves the others unchanged, and that `--clear` on a
      non-nullable field exits non-zero naming it
- [ ] 5.5 RED: test that `--link` appends; that a repeat of an already-recorded `(type, target)`
      UPDATES that entry's reason in place rather than adding a second entry or silently discarding
      the correction; that an exact repeat of all three changes nothing and says so; and that
      `--clear-links --link a --link b` is accepted as ONE atomic replace
- [ ] 5.6 RED: test the BROADENED surface, not the two paths this change introduces — setting any
      field to the value it already holds reports "nothing changed" rather than the generic success
      line, and a no-op link supply and a no-op clear are instances of that rule. `saveState`
      already returns `unchanged: true` for every no-op (`state.mjs:201`); `update-epic.mjs:527`
      discards it and `:564` prints success unconditionally, which is why same-valued `--title`,
      `--status` and `--priority` ALREADY report writes that did not happen — the
      `update-epic.mjs:356` defect class (#79)
- [ ] 5.7 GREEN: implement `--clear`, the append semantics, and the mutual-exclusion relaxation at
      `update-epic.mjs:134-137`
- [ ] 5.8 GREEN: update ALL SIX sites documenting replacement, two of which the engine emits at
      runtime — `links.mjs:76-83` (`unknownLinkTypeMessage`), `integrity.mjs:387-388` (the
      finding's own remedy), `commands/epic.md:189,321,329`, `commands/next.md:43`,
      `update-epic.mjs:49-51` docstring, and the assertion at `conductor-14.test.mjs:1049`
- [ ] 5.8b GREEN: update the sites documenting the MUTUAL EXCLUSION, which the relaxation makes
      false — `commands/epic.md:190` (the flag-table row "may not be combined with `--link`"),
      `commands/epic.md:338` (the same claim in prose), and the usage blocks at
      `commands/epic.md:172` and `update-epic.mjs:78`, which must also gain `[--clear <field>]`.
      The usage line is not cosmetic: the shared flag-allowlist check reads the documented flag
      surface AT CHECK TIME, so registering `--clear` in `EPIC_FLAGS` without it still fails
- [ ] 5.9 Add a SIBLING sweep asserting set-implies-clear, driven from `EPIC_FLAGS`. Do NOT widen
      `conductor-20.test.mjs:264-281` — that sweep asserts every field appears on all three of
      `add-epic`/`update-epic`/`add-many`, which two nullable fields fail BY DESIGN (`notes` is
      `["add-epic","update-epic"]` at `constants.mjs:250`; `review-mode` is `["update-epic"]` at
      `:351`), and it is driven by a different registry (`EPIC_SOURCE_ARTIFACTS`). It remains the
      sweep `gh-66`'s disposition referred to — that citation was the correction; the widening was
      not implementable

- [ ] 5.10 SURFACE THE WALKER. `unconsideredOutcomes()` landed in group 4 as a library export with
      NO consumer outside tests, so the release would ship an enumeration nobody can ask for while
      `epic-disposition/spec.md:25` says "an agent asks the engine". Add a dispatched verb — the
      shape every other ask-the-engine surface here uses — which needs `FLAGLESS_VERBS` in
      `constants.mjs`, a `verb-effects.mjs` entry (read-only), `USAGE` and dispatch in
      `conductor.mjs`, a `commands/` doc, and a `docs/parity-ledger.json` claim for that doc.
      NOT an integrity CHECKS entry: `conductor-15.test.mjs:1362-1374` asserts the archived
      `integrity-day-one.md` names every finding's epic, so ~66 ids would have to be written into
      a closed change's document. Group 4 declined to wire this rather than guess, and named the
      three candidate surfaces with the evidence against two — the right call; this is the
      orchestrator's decision recorded rather than a silent scope widening

## 6. The emitted inverse-operation obligation

- [x] 6.1 RED: test the rendered block carries the obligation inside required task item 1, as a
      numbered task item and not prose
- [x] 6.2 RED: test the obligation is present as a `mustSay` CLAIM, not only in `lines`. The drift
      guard at `conductor-16.test.mjs:502-530` iterates `mustSay` only — amend `lines` alone and the
      suite stays green while all three mirrors carry the old rule, which is this change's own
      defect class reproduced inside it
- [x] 6.3 GREEN: amend `GATE_PROCEDURE_ITEMS[0]` in `rules.mjs` — BOTH `.lines` and `.mustSay`
- [x] 6.4 GREEN: update the three mirrored surfaces the guard reads — `commands/epic.md`,
      `commands/status.md`, `skills/conductor/SKILL.md`
- [x] 6.5 Regenerate this repository's own managed `CLAUDE.md` block and confirm it carries the rule
- [x] 6.6 Verify the emitted block for all three platform variants in `KNOWN_PLATFORMS` — correct,
      but insufficient alone, which is why 6.2 and 6.4 exist

## 7. Gate procedure — required task items, carried into both gates

- [ ] 7.1 **Call-site completeness sweep, INCLUDING INVERSE OPERATIONS.** Enumerate all call sites
      mechanically (`rg`, never from memory); state where each rule holds and where it does not;
      justify every omission. A guard at one call site with an untouched sibling is a FINDING even
      though the unedited site never appears in the diff. **Then enumerate the INVERSE of every
      operation this change adds** and justify each not shipped. This change adds that obligation to
      the product and must satisfy it first. Data references count: enumerate every place
      `createdAt` and `touchedAt` are written, read and REMOVED. Named call sites already known:
      `--clear` is repeatable and `repeatableFlagNames()` is global, so `set-lane-routing --clear`
      (`constants.mjs:461`, consumed at `lane-routing.mjs:37` by truthiness) is in scope
- [ ] 7.2 **Verify against the commit, not the working tree.** For every task run
      `git show --stat <that task's sha>` and assert every file the task claims appears in THAT
      commit
- [ ] 7.3 **Declare lifecycle bookkeeping.** Every task in this list that is bookkeeping about the
      change's own lifecycle rather than its work carries the literal `<!-- pm:lifecycle -->` on its
      task line — 0.1, 8.6 and 8.7 as authored, plus the archive task. The engine infers this from
      nothing else
- [ ] 7.4 **Attribute every commit to its epic** at the moment it is made:
      `update-epic record-answers-for-itself --attribute-commit <sha>`. Attribute forward only. The
      archive commit is excluded and MUST NOT be attributed
- [ ] 7.5 **Cross-spec review before `/opsx:apply`.** FIVE delta specs, so this gate is mandatory.
      Two fresh-context reviewers, different lenses (review mode `thorough`), the six questions:
      contradiction, double ownership, unmeetable requirements, gaps against the proposal,
      vocabulary forks, shared chokepoints. Split BLOCKS from POLISH, fix the BLOCKS, decline most
      POLISH with reasons. Record it:
      `record-cross-spec-review 0.40.0 --verdict pass|fail --reviewer "<identity>"` — requires 0.1
- [ ] 7.6 **Gate 1 — spec review before code.** Fresh-context reviewers over the artifacts by file
      path. Fix Critical and Important, re-validate. FIRST ROUND COMPLETE: four reviewers, four
      FAILs, 13 BLOCKS; this document is the rewrite. A second round runs against the rewrite
- [ ] 7.7 **Gate 2 — implementation review, committed, before docs.** Full `BASE..HEAD` diff, two
      independent fresh-context reviewers under `thorough`. Record with `record-gate-review`
- [ ] 7.8 **End work by recording a disposition** for every member epic, in one invocation carrying
      both halves. Never end work by removing the record
- [ ] 7.9 **Route what the work taught you** — a practice becomes an epic with its evidence;
      tooling friction becomes a `/pm:feedback` filing; a process failure becomes a lesson file in
      `docs/lessons/`. Name which of the three each is out loud

## 8. Documentation and release

- [ ] 8.1 Update `README.md`, `commands/epic.md`, `commands/status.md`, `commands/next.md` and the
      `conductor` skill. `commands/status.md` is one of the three files the drift guard reads and
      was missing from the first draft's doc list
- [ ] 8.2 Confirm `docs/parity-ledger.json` claims every file this change adds under `commands/`,
      `skills/`, `agents/` or `.claude-plugin/` — `parity.test.mjs` fails CI otherwise
- [ ] 8.3 Sync the Mintlify site at `pm-plugin.dev` in the same PR cycle, per `mintlify-doc-sync`
- [ ] 8.4 Bump `.claude-plugin/plugin.json` to 0.40.0 and add the `CHANGELOG.md` entry
- [ ] 8.5 Full suite green — every test, including ones this change did not write
- [ ] 8.6 Record the release's member epics and any deliberate exclusions on the 0.40.0 object
      created in 0.1 <!-- pm:lifecycle -->
- [ ] 8.7 Archive this change <!-- pm:lifecycle -->
