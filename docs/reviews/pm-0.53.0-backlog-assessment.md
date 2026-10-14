# pm 0.53.0 — backlog assessment and proposed scope

Date: 2026-10-13 (PDT) · branch `rc/0.52.0` · engine reports `0.51.0` (version not bumped yet) ·
read-only assessment, nothing written to `.conductor/`.

Sources: `.conductor/state.json` read from disk; `gh issue view` for every open epic with an
`externalUrl`; `node scripts/conductor.mjs triage` for overlap; `node scripts/conductor.mjs spend` run
once. `spend` ingests into `.conductor/spend/`, which is gitignored (`.gitignore:14`). `git status`
was otherwise unchanged by every command run.

## 1. Population

- 50 open epics (status not `archived`). 13 belong to release 0.52.0, which is built, so they are
  excluded. That leaves **37 to assess**, 2 of which (`token-spend-analysis-and-recommendations`,
  `decision-cost-log`) are already members of release 0.53.0.
- All 7 linked GitHub issues are still **OPEN**: #114, #204, #207, #208, #211, #228, #239. None has
  changed since it was mirrored. The `externalUpdatedAt` watermarks match.
- No openspec change on disk exists for any of the 37. `openspec/changes/` holds only the three
  0.52.0 changes. A design doc exists only for `codex-platform-support`
  (`docs/superpowers/specs/2026-07-25-codex-platform-support-design.md`). `epic-session-attribution`
  points at the generic cross-repo design (`docs/superpowers/specs/2026-08-23-cross-repo-orchestration-design.md`).

## 2. Themes

| Theme | # | Epics |
| --- | --- | --- |
| A. Spend analysis and 0.52 follow-ups | 4 | token-spend-analysis-and-recommendations, decision-cost-log, spend-guard-rules-section-follows-live-limits, epic-session-attribution |
| B. Records, verbs and refusal honesty | 7 | gh-cfdude-pm-204, gh-cfdude-pm-239, gh-cfdude-pm-207, gh-cfdude-pm-228, record-gate-review-fail-requires-shas, integrity-reports-legacy-duplicate-attributions, hierarchy-run-has-one-state-writer |
| C. Test infra and test honesty | 6 | flake-owner-certify-index-sigterm, flake-owner-g2-c1-i2-2000ms-bound, unit-rung-flake-retry-gap, engine-source-extraction-vacuity, retire-single-file-certification-record, store-owns-claude-md-managed-block |
| D. Gate-procedure practices (required items and rules-block text) | 5 | mutation-pass-is-a-required-task-item, gh-cfdude-pm-211, registry-bound-poison-sweep-practice, planning-completeness-orient-and-autonomy-boundary, gh-cfdude-pm-208 |
| E. Backlog and fleet tooling | 3 | backlog-grooming-pass, fleet-upgrade-after-release, gh-114-lane-routing-blind-to-product |
| F. Instruction text and OpenSpec alignment | 2 | dehardcode-openspec-change-root-in-instructions, openspec-1-14-workflows-evaluation |
| G. Platform support | 7 | hermes-platform-support, codex-platform-support, platform-switch-orphans-old-rules-block, parity-reassessment-per-platform, remaining-platform-investigation, rules-block-cli-fallback, init-detects-foreign-agent-instruction-files |
| H. EDD (agent-behaviour evals) | 2 | edd-corpus-expansion-nondeterministic-surfaces, edd-run-policy-when-behavior-artifacts-change |
| I. Docs site | 1 | changelog-page-too-long-archive-older-releases |

## 3. Per-epic assessment

Size: S <2h · M 2–8h · L >8h. "Spec" means a spec or design on disk.

| Epic | Status · P | Lane | Size | Spec | Dependencies and notes |
| --- | --- | --- | --- | --- | --- |
| token-spend-analysis-and-recommendations | planned · P1 · rel 0.53.0 | openspec | L | no | Reads the 0.52 ledger (`spend-ledger.mjs`/`spend-report.mjs`). **Needs real ledger data**, which exists only since 2026-10-09: 4 epics, 1 release. The cross-release trend has a single point until 0.53's own build lands. See §6. |
| decision-cost-log | planned · P2 · rel 0.53.0 | superpowers | M | no | Ledger plus activity log (`activity-log.mjs`). New verb → constants.mjs, dispatch, parity ledger. **Needs ledger data** to price a decision. Renders inside the analysis output, so it should be built after or with that epic. |
| spend-guard-rules-section-follows-live-limits | planned · P3 | superpowers | S | no | 0.52 Gate 2 minor on the spend guard. Touches `rules.mjs`, `update-epic.mjs`, `remove-epic.mjs`. A correctness gap in a 0.52 surface (the per-dispatch guard instruction goes missing while a limit is live). |
| epic-session-attribution | planned · P3 | claude-code | S | generic design | Mostly shipped (activity trail). The remaining work: `--session` is registered for claim/unclaim only (`constants.mjs:764`), and nothing lands on the epic record. Relevant to spend because 20.5M tokens are `no-active-epic` (orchestrator). |
| gh-cfdude-pm-204 — list verb | untriaged · P2 | superpowers | M | no | **Premise re-confirmed this session**: this assessment could not enumerate epics without raw `state.json` reads. New verb → constants.mjs, `conductor.mjs` dispatch, `verb-effects`, command doc, parity ledger. Prerequisite for backlog-grooming-pass. |
| gh-cfdude-pm-239 — log-detour stamps wrong HEAD | untriaged · P2 | superpowers | M | no | Verified live: `log-detour --help` has no `--sha`, and `retract-detour` takes only `--reason`. Touches `subcommands.mjs` and constants.mjs. A user-reported bug from a consumer repo (market-intelligence-dev). |
| gh-cfdude-pm-207 — "quote the whole value" hint | untriaged · P3 | superpowers | S | no | **Reproduced in this session**: `triage --ask='…'` printed "quote the whole value" for an already-quoted value. Also, `triage` has no `--ask=` form at all, unlike `suggest-lane`, so an ask starting with `--` cannot be triaged. Touches `argv-surface.mjs`. |
| gh-cfdude-pm-228 — consumer lesson rejects unreported | untriaged · P2 | superpowers | S | no | Option 1 (a brief line when N>0) touches `briefing.mjs`, which 0.52's hook-payload work just changed, so build it on top of 0.52. |
| record-gate-review-fail-requires-shas | planned · P3 | claude-code | S | no | `gate-review-writeback.mjs` and refusal. |
| integrity-reports-legacy-duplicate-attributions | planned · P3 | claude-code | S | no | **Premise confirmed**: 7 epics in this repo carry duplicate `attributedCommits`. The worst is `functional-assertion-test-split`, with 58 entries of which 35 are unique. `integrity.mjs`. |
| hierarchy-run-has-one-state-writer | planned · P2 | openspec | L | no | Real design work (child vs orchestrator state writes, attribution of merge commits). It deserves its own release theme. Defer. |
| flake-owner-certify-index-sigterm | planned · P3 | claude-code | S–M | no | Named as `owningEpic` in `scripts/test/known-flakes.json`. Keep it as its own epic; merging it would dangle that reference. |
| flake-owner-g2-c1-i2-2000ms-bound | planned · P3 | claude-code | S | no | Same: it is the `owningEpic` in known-flakes.json. |
| unit-rung-flake-retry-gap | planned · P3 | claude-code | S | no | Test runner. |
| engine-source-extraction-vacuity | planned · P3 | superpowers | M | no | One helper plus a migration across about 8 test files. Tests only. |
| retire-single-file-certification-record | planned · P3 | claude-code | S | no | **Precondition now met**: 0.51.0 is on main and the fleet is 29/29. `.git/pm-suite-certification.json` was last written 2026-09-28. It touches certify runner code, and certify refuses while that code is dirty, so it must **commit first and alone**. |
| store-owns-claude-md-managed-block | planned · P3 | openspec | L | no | Deferred from 0.51.0 because the quiet-machine n=3 measurement was never taken. That has now happened twice. Its premise (the file rung is dominated by init's CLAUDE.md write) predates 0.52's `rules-block-session-cost`, which changed the managed block. Decline, or measure first. |
| mutation-pass-is-a-required-task-item | planned · P2 | superpowers | M | no | Adds a numbered required item to the rules block (`rules.mjs`) and its mirrors. That grows the block 0.52 just measured for session cost. |
| gh-cfdude-pm-211 — RED notes go stale | untriaged · P2 | superpowers | M | no | The mechanical option is an apply-time re-run of RED assertions. Same "a test that cannot fail" family as mutation-pass. Triage shows a 0.40 lexical overlap with mutation-pass; the intent differs, so they are not duplicates. |
| registry-bound-poison-sweep-practice | planned · P3 | openspec | M–L | no | A completeness assertion over the flag registry. Pairs with mutation-pass. |
| planning-completeness-orient-and-autonomy-boundary | planned · P3 | superpowers | S–M | no | Remainder of 0.51 B3. Changes rules-block and skill text. |
| gh-cfdude-pm-208 — pm:refused marker for consumers | untriaged · P3 | superpowers | M | no | No consumer demand on record. Decline candidate. |
| backlog-grooming-pass | planned · P1 | openspec | L | no | Depends in practice on #204's list verb. The manual pass works; this report is one. |
| fleet-upgrade-after-release | planned · P2 | superpowers | M | no | The title's "23 of 26 stale" figure is dead (already noted on the epic). The live argument is nested-conductor discovery. The fleet is now 29 repos. Directly reduces the cost Rob pays per release. |
| gh-114-lane-routing-blind-to-product | later · P2 | claude-code | ? | no | The mechanical half shipped in 0.27 and 0.36. The rest needs a product/milestone layer, and pm will not integrate one. Rob's open question from 2026-10-06 (consumer-facing or contributor-only?) is still unanswered. |
| dehardcode-openspec-change-root-in-instructions | planned · P2 | claude-code | S–M | no | **Premise grew**: from 4 sites in 3 files to **17 lines in 7 files** (`rules.mjs`, `agents/reconciler.md`, `skills/conductor/SKILL.md`, and `commands/{cross-spec-review,status,detour,epic}.md`). `rules.mjs` emits the literal into every fleet repo's CLAUDE.md, so it spreads on each upgrade. Should be superpowers rather than claude-code given the 7-file spread. |
| openspec-1-14-workflows-evaluation | planned · P2 | openspec | L | no | The untracked `.claude/commands/opsx/{bulk-archive,continue,ff,new,onboard,verify}.md` and 6 `.claude/skills/openspec-*` dirs on `rc/0.52.0` belong to this epic. |
| hermes-platform-support | queued · P2 | openspec | L | no | All four of its `depends-on` targets are archived as delivered. Still blocked by platform-switch-orphans and parity-reassessment. The facts are from Hermes v0.19.0 (2026-07-20) and need re-verifying. Two open design problems need a brainstorm. |
| codex-platform-support | later · P3 | openspec | L | design doc | Goes after Hermes. CLI facts are from Codex 0.145.0 (July) and are stale. |
| platform-switch-orphans-old-rules-block | queued · P2 | claude-code | S–M | no | Blocks Hermes. Unreachable today. |
| parity-reassessment-per-platform | planned · P2 | claude-code | M | no | Recurring per port. Blocks Hermes. |
| remaining-platform-investigation | planned · P3 | claude-code | M | no | Gemini CLI, Grok Build, generic AGENTS.md. Investigation only. |
| rules-block-cli-fallback | later · P3 | claude-code | ? | no | No triggering platform. Already depends on remaining-platform-investigation. |
| init-detects-foreign-agent-instruction-files | planned · P3 | claude-code | S | no | AGENTS.md half still valid (init reads no instruction file). Platform-adjacent. |
| edd-corpus-expansion-nondeterministic-surfaces | queued · P2 | superpowers | L | EDD design | **Still 1 scenario** (`evals/corpus.py:19` `LANE_ROUTING_TYPO`). Semantic parity for Hermes needs this first. |
| edd-run-policy-when-behavior-artifacts-change | planned · P2 | claude-code | S | no | Depends on corpus expansion. Better as that epic's final story. |
| changelog-page-too-long-archive-older-releases | planned · P2 | superpowers | M | no | **Premise grew**: CHANGELOG.md is now 3888 lines / 67 `##` headings (2460 / 56 at last grooming). The real target is the cfdude/pm-docs Mintlify source, a separate repo. It needs no plugin release and no fleet upgrade. |

## 4. Proposed 0.53.0 scope

**Intent:** *"Know where the tokens went, and keep the record honest."* The first analysis over real
ledger data, the follow-ups the 0.52 gates logged, the record and refusal bugs users actually hit,
and the known flakes paid down. Nothing platform-shaped.

16 epics in 3 batches:

| # | Epic | Lane | Size | Batch |
| --- | --- | --- | --- | --- |
| 1 | token-spend-analysis-and-recommendations | openspec | L | 1 Spend |
| 2 | decision-cost-log | superpowers | M | 1 Spend |
| 3 | spend-guard-rules-section-follows-live-limits | superpowers | S | 1 Spend |
| 4 | epic-session-attribution | claude-code | S | 1 Spend |
| 5 | dehardcode-openspec-change-root-in-instructions | superpowers (re-lane from claude-code) | S–M | 1 Spend (shares `rules.mjs`) |
| 6 | gh-cfdude-pm-204 (list verb) | superpowers | M | 2 Records |
| 7 | gh-cfdude-pm-239 (log-detour HEAD / retract MINIMAL) | superpowers | M | 2 Records |
| 8 | gh-cfdude-pm-207 (refusal hint; add `triage --ask=`) | superpowers | S | 2 Records |
| 9 | gh-cfdude-pm-228 (brief line for rejected lessons) | superpowers | S | 2 Records |
| 10 | record-gate-review-fail-requires-shas | claude-code | S | 2 Records |
| 11 | integrity-reports-legacy-duplicate-attributions | claude-code | S | 2 Records |
| 12 | retire-single-file-certification-record | claude-code | S | 3 Test infra (commit first, alone) |
| 13 | flake-owner-certify-index-sigterm | claude-code | S–M | 3 Test infra |
| 14 | flake-owner-g2-c1-i2-2000ms-bound | claude-code | S | 3 Test infra |
| 15 | unit-rung-flake-retry-gap | claude-code | S | 3 Test infra |
| 16 | engine-source-extraction-vacuity | superpowers | M | 3 Test infra |

### Batch plan and the shared-file map

The map comes from `rg` over `scripts/lib`. It is not guessed.

- **Shared chokepoints:** `scripts/lib/constants.mjs` (1824 lines; the flag registry), the
  `conductor.mjs` dispatch table, `docs/parity-ledger.json`, and `scripts/lib/rules.mjs` (1237 lines).
  - New verbs or flags: #204 `list`, #239 `--sha`, decision-cost-log's verb, the analysis flags, and
    epic-session-attribution's `--session` widening. All of these hit constants.mjs, dispatch and
    the parity ledger.
  - `rules.mjs`: spend-guard-rules-section and dehardcode.
  - `briefing.mjs`: #228.
- **Batch 2 (Records)** and **Batch 3 (Test infra)** start in parallel, one subagent each, in
  separate worktrees.
  - Batch 2 is one agent working serially: every item touches constants.mjs or refusal surfaces.
  - Batch 3 touches `scripts/test/**` and runner code only. `retire-single-file-certification-record`
    commits first and alone, because certify refuses while runner files differ from the index.
- **A collision outside `scripts/lib`:** `engine-source-extraction-vacuity` migrates source-reading
  tests, among them `verb-surface` and `emitted-invocations`. Batch 2's new `list` verb and
  `--sha` flag must update those same tests. So it runs **last in Batch 3, after Batch 2 merges**
  to `rc/0.53.0`.
- **Batch 1 (Spend)** runs propose and Gate 1 for the analysis epic **in parallel** with Batches
  2 and 3 (planning touches no engine files). Its **build waits until Batch 2 merges** to
  `rc/0.53.0`: both batches add verbs to constants.mjs and dispatch, and serializing that one file
  is cheaper than a conflict resolution. Build order inside Batch 1:
  1. spend-guard-rules-section and dehardcode (`rules.mjs`)
  2. epic-session-attribution
  3. analysis
  4. decision-cost-log, which renders inside the analysis output
- **Gates and review:** the project review mode is `standard`, and no member needs `thorough`, so
  each gate gets one reviewer and one round, with only a Critical reopening it. One converged Gate 2
  runs on `rc/0.53.0`. If the analysis change carries two or more spec files, required item 5
  (cross-spec review) runs before `/opsx:apply`.
- **Models:** Opus for the analysis spec and the reviews. Sonnet for the Batch 2 and 3 builds.
  Haiku is enough for gh-cfdude-pm-207 (the refusal hint), record-gate-review-fail-requires-shas
  and integrity-reports-legacy-duplicate-attributions.

### Deferred to 0.54+ (with reasons)

| Group | Epics | Why not 0.53 |
| --- | --- | --- |
| **0.54 "second platform"** | hermes-platform-support, platform-switch-orphans-old-rules-block, parity-reassessment-per-platform, init-detects-foreign-agent-instruction-files, edd-corpus-expansion-nondeterministic-surfaces (+ edd-run-policy folded in) | One coherent theme. Hermes is L, needs a brainstorm on two open design problems, and must re-verify July-era Hermes facts. Semantic parity needs the EDD corpus (still 1 scenario) first. Mixing it with spend work would double the review surface. |
| Later platforms | codex-platform-support, remaining-platform-investigation, rules-block-cli-fallback | Sequenced after Hermes by design. |
| **Gate-procedure theme** | mutation-pass-is-a-required-task-item, gh-cfdude-pm-211, registry-bound-poison-sweep-practice, planning-completeness-orient-and-autonomy-boundary | Each adds rules-block or required-item text right after 0.52 measured the block's session cost. Ship them together under a block-size budget, not piecemeal. |
| Backlog/fleet tooling | backlog-grooming-pass, fleet-upgrade-after-release | The grooming pass should be built on #204's `list` verb, which ships in 0.53. See the questions below. |
| Design-heavy | hierarchy-run-has-one-state-writer, openspec-1-14-workflows-evaluation | Each is L with open design questions. |
| Out-of-band | changelog-page-too-long-archive-older-releases | Lives in cfdude/pm-docs. Do it outside the release cadence; no fleet pass needed. |
| Hold or decline | store-owns-claude-md-managed-block, gh-114, gh-208 | See §5. |

## 5. Disposition recommendations

Nothing here was written. The orchestrator owns state writes. Triage shows **no open-to-open
duplicate**: every probe scored 1.0 only against its own epic. The nearest open pair is
mutation-pass and #211 at 0.40, with different intent.

- **Merge (supersede):**
  - `edd-run-policy-when-behavior-artifacts-change` → `edd-corpus-expansion-nondeterministic-surfaces`,
    as its final story. The policy is explicitly worthless until the corpus grows.
  - `rules-block-cli-fallback` → `remaining-platform-investigation`. It has no triggering platform and
    already depends on that epic.
- **Decline candidates:**
  - `store-owns-claude-md-managed-block`: deferred twice with no measurement, and the premise
    predates 0.52's block changes.
  - `gh-cfdude-pm-208`: no consumer demand on record.
  - `gh-114`: see Q4.
- **Stale or changed premises:**
  - **Grew:** dehardcode (4 sites → 17 lines in 7 files) and the changelog (2460 → 3888 lines).
  - **Unblocked:** retire-cert (precondition met) and Hermes (all depends-on archived as delivered).
  - **Stale data:** Hermes and Codex CLI facts are from July. fleet-upgrade's "23 of 26" figure is
    dead; the fleet is now 29.
- **Re-lane:** dehardcode from claude-code to superpowers (a 7-file spread, plus the emitted
  surface).
- **Friction to file** (`/pm:feedback`, not filed; this run is read-only):
  1. `triage` has no `--ask=` form, so an ask starting with `--` is untriageable. It could fold
     into #207.
  2. Spend markers using `phase=gate-1` or `phase=spec` are rejected as `invalid-marker`
     (`spend-attribution.mjs:75`). That cost 24.5M tokens, 17% of the ledger, verified by joining
     rows to markers (§6). The orchestrator's natural phase names fork from `KNOWN_SPEND_PHASES`.
     Either accept the aliases or emit the valid set at dispatch time. This belongs in the
     analysis epic's first story or as its own small fix. Those rows are re-attributable only if
     the ledger re-resolves stored markers after a fix.

## 6. Data note — the ledger (`node scripts/conductor.mjs spend`, once)

Tracking has been on since 2026-10-09T22:28Z. The ledger holds **141,174,593 tokens**, of which
**68.1%** is attributed to an epic.

| Epic | Total | Cache-read share | Output | Note |
| --- | --- | --- | --- | --- |
| spend-budget-and-stuck-loop-guard | 68.7M | 97.1% | 236K (0.34%) | One Sonnet implement agent (`ad8f953038e6443aa`) used **60.5M (88%)**: 156 messages at about **379K cache-read per message**. The epic has 211 messages across 5 agents. |
| execution-profile-planning-and-light-roles | 19.4M | 93.1% | 70K | One implement agent used 13.5M. |
| token-spend-tracking-per-epic | 7.0M | 96.8% | 20K | One Opus review. |
| token-spend-analysis-and-recommendations | 1.1M | 86.4% | 4K | This assessment (role=plan). |
| unattributed | 45.0M | — | — | 24.5M `invalid-marker`, 20.5M `no-active-epic` (orchestrator turns; the orchestrator total is exactly 20,465,520). |

**The invalid-marker bucket was verified by joining** `.conductor/spend/rows.jsonl` with
`markers.json`. All 24,509,352 tokens are real 0.52 work, dispatched with phase names outside
`KNOWN_SPEND_PHASES = ["plan","build","review","docs","release"]` (`constants.mjs:1539`):

| Epic | Marker | Tokens |
| --- | --- | --- |
| execution-profile-planning-and-light-roles | plan/`spec` | 9.57M |
| spend-budget-and-stuck-loop-guard | plan/`spec` | 8.07M |
| spend-budget-and-stuck-loop-guard | review/`gate-1` | 3.49M |
| execution-profile-planning-and-light-roles | review/`gate-1` | 3.38M |

Every role in those markers is valid. Only the phase is wrong.

Across attributed tokens, cache-read is **96.2%** and output is **0.34%**. Only 3 of the 13 0.52.0
members appear in the ledger. That is not because of unmarked dispatches (`unmarked-subagent` is 0).
Most of 0.52 was built before tracking was enabled at 2026-10-09T22:28Z, and the Gate 1 and spec
spend of the two epics above sits in the invalid bucket.

**Implications for the analysis epic's design:**

1. **Never rank on raw totals.** Report the token classes separately: input, cache-write,
   cache-read, output. A raw-total ranking is a ranking of context size times turn count, not of
   work done.
2. **The actionable signal is long-lived, large-context agents.**
   - Messages per agent approximates turns.
   - Cache-read per message approximates context size.
   - One agent at 156 turns re-reading about 379K of context each turn is the 60M outlier.
   - So the recommendations should fire on turn count, context growth per turn, and
     single-agent share. Batch splitting and fresh-context handoffs are the levers, not output
     volume.
3. **Coverage and orchestrator spend need their own sections.** A third of the spend is invisible
   to per-epic views today.
4. **The "one release of data" premise is thin.** There are 4 epics and 1 release. The per-epic
   trend has one point until 0.53's own build is ingested. Recommendation: build now, and treat
   0.53's build as the second dataset.
5. **Cost stays notional** under subscription auth, as `spend` already says. If a weighted view is
   wanted, weight token classes by published price ratios and label the result notional.

## 7. Decisions only Rob can make

1. **Build the analysis on one release of data?** Only 4 epics are in the ledger. My
   recommendation is yes: build now, and let 0.53's own build supply the second dataset for the
   trend.
2. **backlog-grooming-pass (P1) in 0.53 or 0.54?** It pairs with #204. My recommendation is 0.54:
   build it on the shipped `list` verb, which keeps 0.53 at 16.
3. **Hermes:** defer to a 0.54 "second platform" release with its blockers and the EDD corpus? My
   recommendation is yes. It is the right next theme, but it is not a 0.53 add-on.
4. **gh-114:** is product-aware lane routing consumer-facing (it conflicts with the
   instruction-layer rule) or contributor-only? My recommendation is to decline the consumer half,
   close #114 with the 0.27/0.36 partials cited, and re-file any contributor-only analysis under the
   spend/analysis theme.
5. **store-owns-claude-md-managed-block:** decline, or take the n=3 quiet measurement first? My
   recommendation is decline (`--outcome declined`). It has been deferred twice unmeasured, and 0.52
   changed the block.
6. **The untracked opsx workflow files on `rc/0.52.0`:** commit, discard, or hold them for
   `openspec-1-14-workflows-evaluation`? My recommendation is to hold them untracked until that
   epic runs, and keep them out of the 0.52 commit.
7. **The invalid-marker vocabulary:** widen `KNOWN_SPEND_PHASES` to accept `gate-1`/`spec`, or keep
   it strict and emit the valid list at dispatch? My recommendation is to keep it strict and print
   the accepted phases in the rules-block Spend section. Aliases fork the vocabulary that the
   analysis groups by.

Bookkeeping for the orchestrator, if the scope is approved: add 14 members to release `0.53.0`,
widen its recorded intent, re-lane dehardcode, and record the two supersessions and any declines.
