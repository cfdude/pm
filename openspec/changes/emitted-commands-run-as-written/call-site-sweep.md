# emitted-commands-run-as-written — call-site completeness sweep (task 9.1) and inverses (9.2)

Derived with `rg` at dev after 4b2e4df, never typed from tasks.md. Each category: the command run, where
the rule holds, and each site where it does not, justified or fixed.

## 1. Gate-verdict remedy printers

`rg -n -U -e "--gate 2[^;]*?--verdict" -e "--gate <n>" -e 'record-gate-review \$\{' scripts/lib` plus
`rg -n "'record-gate-review|\"record-gate-review|\`record-gate-review" scripts/lib`.

- `archive-gate.mjs:221-222` — `gateRemedy()` itself, the one renderer (Gate 1 `--artifact`, Gate 2 range).
- Through `gateRemedy()`: archive refusal (via `DELIVERED_OBLIGATIONS`), `integrity` ungated / withdrawn
  checks, the malformed-value remedy (now GATE-AWARE: Gate 1 value → `--artifact`, Gate 2 value → range,
  attribution → withdraw), `briefing.mjs` ungated / withdrawn entries, update-epic's regression refusal.
- **FINDING, fixed in this commit:** `update-epic.mjs:384` — refusing to withdraw an `ungated` entry
  printed `record-gate-review ${id} --gate ${g} --verdict pass|fail`: no evidence (a pass is refused) and a
  bare id. Now `gateRemedy(id, g)` in a code span; a Layer B builder runs it (red-9.1.txt).
- `gate-review-writeback.mjs:63` and `integrity.mjs:760` are comments.

## 2. Writers and readers of the new exports

`rg -n "DELIVERED_OBLIGATIONS|BRIEF_REMEDIES|deliveredObligations\(" scripts`.

- `DELIVERED_OBLIGATIONS`: defined `archive-gate.mjs:337`; read by `obligationRemedy()` (413) and
  `deliveredObligations()` (433); the Layer B registry test reads it. No other writer.
- `deliveredObligations()`: `blockedDelivered()` (259), `archiveGate()` (525), update-epic's
  `deliveredRegression()` (145-146, compares by `kind`, unchanged — 2.8 guards it), `integrity`
  delivered-release (670), `subcommands.mjs` via `deliveredRegression()` (the nudge's amend suppression;
  commit-observation 5.2a/5.3 pass).
- `BRIEF_REMEDIES`: defined `briefing.mjs:25`, read only by `briefRemedy()` (55). Every brief line printing
  an engine verb in a code span is an entry (lines 30, 43, 51, and the two `gateRemedy` entries). The mirror
  line (✓) prints no verb.
- **FINDING at Gate 2 (E-I3), fixed:** the claim above that no brief line printed an engine verb outside the
  registry was false — `dependencyNotes()` (`dependency-order.mjs`) puts `update-epic <id> --link
  "depends-on:…"` in the brief's DEPENDENCY WARNINGS, with a raw id. It is now the entry
  `blocked-without-depends-on`, whose renderer is the same function `dependencyNotes()` calls, with a Layer B
  builder (a regular id and a legacy `My Plan`). Since E-I4 this category is no longer a typed claim: the
  suite's `printedTemplates()` scan requires every printed-invocation template in `scripts/lib` to be reached
  by a fixture whose whole output Layer A checks.

## 3. Item-sourced placeholders

`rg -n "<issue-(title|url|key)>" scripts/lib` — only `rules.mjs` `registrationStep()` (581-595), shared by
the primary and every secondary. Each placeholder it prints (`<issue-title>`, `<issue-url>`, and
`<issue-key>` for non-numeric keys) is named in the quoting sentence directly above the line.

## 4. Readers of suggest-lane's text

`rg -n "suggest-lane|suggestLane" scripts commands skills README.md` (tests excluded).

- Engine: `lane-routing.mjs:100-120` reads `--ask` or the positional, refuses both and neither.
  `triage.mjs` calls `laneSuggestion()` with its own ask (not argv) — unaffected.
- Emitted: the only emitted `suggest-lane` step is `rules.mjs:595`, `suggest-lane --ask=<issue-title>`.
  `rules.mjs:432` names the verb in prose (intake), not a line to fill.
- **FINDING, deferred to section 10 (docs after Gate 2):** `commands/tracker.md:170` and
  `commands/sync.md:103` still teach `suggest-lane "<issue-title>"`. Both pass the argv check; sync.md was
  not named in section 10, so 10.1 is amended in this commit to cover both. Other doc mentions
  (`commands/lane-routing.md`, SKILL.md 969, README 791) route a text the user typed, where the positional
  form is unchanged and correct.

## 5. Readers of a tracker's `direction`

`rg -n "directionOf|\.direction\b" scripts/lib`.

- `constants.mjs` `directionOf` (1308) and its two predicates (1317, 1351): read the recorded value first,
  so a direction the vendor switch RECORDS is read exactly as one set explicitly — unaffected.
- `migrations.mjs:125-129`: stamps a direction only where none is recorded — unaffected (the switch records
  one, and a migrated state already has one).
- `tracker.mjs`: the secondary branch (94, 99) and the primary new-tracker default (172) are unchanged; the
  switch record (142-144) runs only when a system is recorded, `--system` differs and no direction is
  given or recorded.

## 6. Printers of `--outcome` choices

`rg -n "dispositionInvocation|deliveredObligations|unconsideredOutcomes" scripts/lib`, `rg -n
"AGENT_OUTCOMES" scripts/lib`.

- Epic-aware (omit `delivered` where an obligation fails): `unconsideredOutcomes()` (295),
  `integrity` epic-in-undefined-status (537). `keepDelivered`: update-epic's regression refusal (227).
- Placeholder-id with the Gate 2 sentence: `rules.mjs` `closedItemStep()` (145 + its sentence), and
  **FINDING, fixed in this commit:** the rules block's "End work by recording a disposition" item
  (`rules.mjs:329`) printed the same placeholder-id outcome list with no Gate 2 sentence; it now carries
  it (tested).
- Justified: `archive-gate.mjs:449,455` state the vocabulary in the refusal for a MISSING or UNKNOWN
  `--outcome` — not an invocation to copy; an agent that then passes `delivered` on a blocked epic receives
  the obligation refusal with its remedy. `update-epic.mjs:277` is the usage line.

## 7. Emitted `gh` lines and inward/secondary steps

`rg -n "gh issue|inwardProcedureEmittable|secondaryInwardProcedureEmittable|usesGhIssueList|mirroredEpicIdPrefix|trackerScope" scripts/lib`.

- The only `gh issue list` line is `inwardListStep()` (`rules.mjs:547`), called by the primary (843-) and
  every secondary (876-); both use the shared dedup, registration and watermark steps.
- `usesGhIssueList()` requires `isGithubRepo()`, so the `--repo` interpolated at 547 always has the shape.
- `trackerScope()`, `mirroredEpicIdPrefix()` and the emittable predicates are unchanged (design Decision 4).

## 8. Readers of `tracker.repo` / a secondary's `repo`

`rg -n "\.repo\b" scripts/lib`.

- Shell-bound (requires the shape): `rules.mjs:547` (through `usesGhIssueList`).
- Code span, gated: `rules.mjs:899` — a github-issues repo failing the shape is quoted as data, not spanned.
- Prose / key / slug (tolerate a legacy value): `rules.mjs:51` (secondary identity key — `--remove` matches
  it exactly), `constants.mjs:1338-1340` (`trackerScope`, feeding headings and the id slug),
  `briefing.mjs:359` (brief label), `tracker.mjs:90,105,135,153` (writes and messages).
- `claims.mjs:158,240` read `--repo` of the `claim` verb, an unrelated boolean flag.
- Added at Gate 2 (E-I2): `integrity.mjs` `tracker-repo-not-a-github-repository` reads both roles' `repo`
  through `isGithubRepo()` — prose JSON-quoted, and the secondary's `--remove` line shell-quoted as one
  word (or described without the value where it holds a control character). The shape now accepts an
  optional `HOST/`; every shell-bound reader above goes through the same predicate, so none needed a
  separate edit, and `mirroredEpicIdPrefix()` slugs the host into the id (`gh-ghe-example-com-o-n-<n>`),
  which Layer C runs through `sh` for a GitHub Enterprise secondary.

## 9. `/pm:epic` and `state.json` in emitted engine text

`rg -n "pm:epic|state\.json" scripts/lib/rules.mjs scripts/lib/briefing.mjs scripts/lib/subcommands.mjs`.

- No emitted `/pm:epic list` remains (3.5). The outward section names `/pm:epic`, a shipped command.
- Every `state.json` mention in emitted text is a READ (`rules.mjs:564` dedup), a statement of record
  (661, 733, 829), or a prohibition (654, 787, 491). `subcommands.mjs:103,108` report init's file creation.
  None directs a write (6.1-6.3's scanner and output assertions hold it).

## 10. Shipped gate forms and agent-doc invocations

Every passing `record-gate-review` form in shipped docs carries its own gate's evidence (7.1, asserted by
scan); every invocation in `agents/*.md` passes Layer A (1.3), and the child doc's Gate 1 and Gate 2 forms
exit 0 filled (7.1).

## 11. Epic ids in printed invocations — `printedId()` (added at Gate 2, E-I3)

Derived mechanically by the suite, never typed: `rawEpicIdSites()` in `emitted-invocations.test.mjs` walks
`printedTemplates()` (every code span, indented invocation line and function-built invocation template in
`scripts/lib`, with each `${…}` hole and each `" + value` concatenation, including one wrapped onto the next
line) and reports every WHOLE-token value placed in an epic-id slot — the positional after a verb taking an
epic id (`honcho-memory`'s after its action word), or the value of `--id`, `--detour`, `--parent`,
`--carried-to` — that is not `printedId(…)`. Cross-checked by hand with
`rg -n '(\`|")\s*(<verbs>) [^\`"]*(\$\{|" \+)' scripts/lib | rg -v printedId`.

- **FINDING at Gate 2, fixed:** raw ids at `active-pointer.mjs` (owedReconcileNotice), `dependency-order.mjs`
  (the blocked note), `detour-stack.mjs` (push-detour's not-found `add-epic --id`; pop-detour's
  `record-reconcile` paused id AND detour id, and its `honcho-memory pop`), `integrity.mjs` (the
  missing-detour `add-epic --id` and `--detour`), `links.mjs` (unknownLinkTypeMessage), `remove-epic.mjs`
  (the owed `record-reconcile` holder and detour), `subcommands.mjs` (sync's near-name `update-epic` and
  `add-epic --id`), `update-epic.mjs` (the `--clear-links` refusal), `verify-specs.mjs` (`--headers`'
  proposed `update-epic`). The last two found beyond the reviewer's list: `honcho-memory pop` and
  `verify-specs`. All now print `printedId(…)`.
- Justified, not epic ids: `release`/`record-cross-spec-review` positionals are RELEASE ids;
  `retract-detour`'s is a commit sha; `reorder`, `suggest-lane`, `triage` take no epic-id positional.
  `integrity.mjs`'s `unclaim … --session <session>` value is a session identity, not an id slot.
- Reach extended at Gate 2 (R-M4): a span opened inside a single-quoted literal (`'\`add-epic --id ' + id`),
  and a double-quoted literal ending `" +` whose raw value opens the next line. The template list on
  today's tree is identical before and after (82), so the extension adds no false positive.
- Limit, stated: a hole the scan cannot see — an id assembled into a variable before the literal, or a
  template split over more than one wrapped line — is reported by no test; the Layer B `2.7a` legacy-id
  builders and the brief's legacy `My Plan` case are the behavioural backstop for the printers they cover.

## 12. Printers offering `--outcome delivered` for one epic (added at Gate 2, R-I1)

Derived with `rg -n "outcome (<)?delivered|AGENT_OUTCOMES.join" scripts/lib`. The rule: a printer offering
`delivered` for a specific epic consults `deliveredObligations()` — an obligation with a remedy command is
named first, and a checkbox source's handoff (`obligationArchiveFlags()`) travels on the archive itself.

- `integrity.mjs` `delivered-release-epic-left-open` — holds (Gate 2 E-I5).
- `update-epic.mjs` regression refusal, through `dispositionInvocation({ keepDelivered, carry })` — **FINDING
  at Gate 2 (R-I1), fixed:** it kept `delivered` but carried no handoff flag, so re-pointing a fully ticked
  plan at one with an open task printed an invocation refused "task(s) outstanding". `carry` is computed on
  the record the edit leaves, and a flag the invocation already names (`--reason`) is not printed twice.
- `integrity.mjs` `heal-archived-epic-passed-gate-2` — **FINDING at Gate 2 (R-I1 sweep), fixed:** a
  hardcoded `--outcome delivered --no-deferrals` consulting nothing; an openspec epic carrying a `--plan`
  with an open task, or an open inline story, got a refused step. Now the E-I5 shape.
- `dispositionInvocation()`'s other callers (`unconsidered-outcomes`, `integrity`'s
  `epic-in-undefined-status`) — hold without `carry`: they do not pass `keepDelivered`, so a failing handoff
  omits `delivered` from the choices and `deliveredBlockedBy` names the obligation.
- `unconsidered-outcomes`' `deliveredBlockedBy` (`blockedDelivered()`) — **FINDING at Gate 2 (U-I1),
  fixed:** for a CHECKBOX source the handoff entry was `{kind: "handoff", detail: "N of M task(s)
  outstanding", remedy: []}` (reproduced at 8ac7817, `red-U-I1.txt`) — a block with no way past it. Its
  remedy is now the `delivered` archive carrying `obligationArchiveFlags()`, rendered by the new
  `deliveredArchiveInvocation()`, which integrity's two sites above now call too, so the three print one
  line from one source. Layer B `unconsidered:handoff-checkbox` runs it and asserts the entry clears and the
  epic stays; `unconsidered:handoff-stories` is a REGRESSION GUARD (its `--story <n> --done` remedy was
  already non-empty and passes before the fix).
- Every other consumer of an obligation remedy, re-derived with `rg -n "obligationRemedy\(|blockedDelivered|
  deliveredBlockedBy" scripts/lib` — holds: `archiveGate()`'s handoff refusal prints `--carried-to` and
  the lifecycle marker in prose for a checkbox source and reads `remedy[0]` only for stories;
  `archiveGate()`'s Gate 2 cases and integrity's attribution-withdrawn arm read Gate 2 variants, whose
  remedies are never empty; update-epic's regression refusal and integrity's two delivered steps pair an
  empty handoff remedy with `carry` (R-I1, E-I5).
- Justified: `rules.mjs`' closed-item step and the disposition rule are epic-agnostic instructions over
  `<id>` (their Gate 2 condition is stated beside them, E-M3), and `archive-gate.mjs`' own refusal lists
  the vocabulary in prose; neither is a command for a known record.

## DATA references

This change adds no stored field. `deliveredBlockedBy` is output only (`unconsidered-outcomes` JSON). The
`externalUpdatedAt` the outward record-the-key line now supplies is written by `update-epic
--external-updated-at` and read by the brief's never-re-read count and the refresh gate
(`record-tracker-refresh`) — existing writers and readers.

## Inverses (task 9.2)

- Vendor-switch scope DROP — inverse: re-supply the field (`set-tracker --repo|--project|--instance`). No
  restore verb, deliberately: the dropped value is printed in full at the moment it is dropped.
- Vendor-switch direction RECORD — inverse: `set-tracker --direction <inward|outward|both>`.
- `--repo` shape REFUSAL — writes nothing, so no inverse is needed; `--remove` stays exempt ON THE SECONDARY
  so a legacy malformed entry is never stranded (4.5). Not on the primary (Gate 2 E-C1): it has no remove
  handler, so exempting it there saved the refused value.
- Omitting `delivered` from a disposition invocation — inverse: record the blocking obligation (e.g. the
  Gate 2 `deliveredBlockedBy` names); the output is recomputed per call and re-offers `delivered`.
- `suggest-lane --ask` — a read; no inverse.
- Primary `set-tracker --remove` is a MISSING inverse that predates this change (reproduced, `repro.txt`
  §B4-B6) and is carried to `code-review-0-43-0-minors` (task 9.5), not shipped here. Re-decided at Gate 2
  (E-C1) and kept carried: no verb unconfigures a primary tracker, so a refusal would name no remedy.
