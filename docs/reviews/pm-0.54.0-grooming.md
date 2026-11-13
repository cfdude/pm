# pm 0.54.0 — backlog grooming and proposed scope

Date: 2026-10-17 · branch `dev` · engine `0.52.0` (`.claude-plugin/plugin.json`) · read-only pass.
Nothing was written to `.conductor/`, no pm verb that writes was run, nothing was staged.

**This proposal is PROVISIONAL.** Rob's direction is to groom after 0.53.0 deploys. 0.53.0 is not
built yet: 19 members, no `rc/0.53.0` branch, and the engine still reports 0.52.0. Several 0.54
decisions read 0.53 output. §7 lists exactly what to re-check when 0.53 lands. That is a short
re-check, not a second grooming.

Sources:
- `.conductor/state.json` read with `jq`.
- `gh issue list` and `gh issue view` against cfdude/pm.
- 14 `node scripts/conductor.mjs triage` probes. They are read-only, and `.conductor/` was unchanged afterwards.
- `rules --sections`, `CHANGELOG.md`, `rg` over `scripts/lib`, and the installed CLIs' `--version` output.
- Method and per-epic facts come from `docs/reviews/pm-0.53.0-backlog-assessment.md`. Every fact used
  here was re-checked against the record or the code. Each one that changed is marked **changed**.

Sizes are **estimates** on the 0.53 bands: S under 2h, M 2–8h, L over 8h.

## 1. Population

- 38 open epics. 19 belong to 0.53.0 and are not re-proposed. **19 are open outside any release.**
- Since the 0.53 assessment:
  - `gh-114` was declined. Its local-data remainder is `triage-surfaces-open-release-intents`.
  - `edd-run-policy-when-behavior-artifacts-change` was folded into the EDD corpus epic, as recorded.
  - `rules-block-cli-fallback` was folded into `remaining-platform-investigation`, as recorded.
  - 0.52.0 is delivered.
- **New and not yet in the backlog: 11 open GitHub issues (#241–#252) have no epic** (§4). Every
  one was filed against pm 0.51.0 or 0.52.0 from a consumer repo or a 0.52 session. A `/pm:sync` is
  owed before scope is final. This pass cannot run it because it writes.

## 2. Recommended 0.54.0

**Name:** *"Portable, and within budget."*

**Intent:** pm runs on a second platform (Hermes) at checked parity. The rules block every session
and sub-agent pays for gets a size budget that new gate-procedure items must fit inside. The backlog
gets a repeatable grooming pass built on 0.53's `list` verb.

Core membership is 19, the same size as 0.53. Two more are listed as stretch.

### Batch P — second platform

| # | Epic (what it does) | Size | Lane | Why it is in | Needs from 0.53 |
| --- | --- | --- | --- | --- | --- |
| P1 | `platform-switch-orphans-old-rules-block`: switching platforms leaves the old platform's rules block live but no longer refreshed | S–M | claude-code | Blocks Hermes. Premise re-verified: `writeRules()` writes only `rulesTarget(platform)` (`scripts/lib/rules.mjs:1201-1240`). | none |
| P2 | `init-detects-foreign-agent-instruction-files`: `/pm:init` reads an existing `AGENTS.md` before writing its own | S | claude-code | Hermes reads `HERMES.md` > `AGENTS.md` > `CLAUDE.md` (`README.md:204`). Re-verified that init reads no instruction file. | none |
| P3 | `edd-corpus-expansion-nondeterministic-surfaces`: grow the agent-behaviour eval corpus from 1 scenario to the judgment-heavy surfaces, with the run policy as its last story | L | superpowers | Semantic parity for Hermes cannot be shown without it. Still 1 scenario (`evals/corpus.py:94`). | none |
| P4 | `parity-reassessment-per-platform`: the per-port procedure that adds Hermes to the parity ledger and runs the corpus against the Claude Code baseline | M | claude-code | Blocks Hermes. `docs/parity-ledger.json` still lists only `claude-code`, with 0 exemptions. | none |
| P5 | `hermes-platform-support`: ship pm's hooks, commands and skills for Hermes Agent | L | openspec | The theme's lead. All 3 of its depends-on targets are delivered (re-verified). **Facts changed** (§5.3); brainstorm first. | dehardcode (0.53) touches the same emitted text |
| P6 | `remaining-platform-investigation`: a hands-on written finding for Gemini CLI, Grok Build and generic `AGENTS.md` consumers. Proposed widening: a Codex fact refresh. | M | claude-code | **Cheaper now**: `gemini` and `grok` are installed (`/opt/homebrew/bin/gemini`, `~/.local/bin/grok`). Investigation only, no port. | none |

### Batch G — gate-procedure practices, under a rules-block budget

| # | Epic (what it does) | Size | Lane | Why it is in | Needs from 0.53 |
| --- | --- | --- | --- | --- | --- |
| G0 | **Rules-block budget.** Vehicle: GitHub #248 ("lighter rules block: emit sections only for the features a repo uses"), once mirrored | M–L | openspec | Every other G item adds block text, so the budget lands first (§6). Partly built already: tracker, spend and spend-guard sections are conditional today. | **yes**: `feature-switches-audit` and `pm-overhead-baseline` |
| G1 | `mutation-pass-is-a-required-task-item`: a required item to prove each new guard can fail, with a saved mutation artifact | M | superpowers | No such item exists (`rg mutation scripts/lib/rules.mjs` finds nothing). Not a duplicate of the archived `guards-that-read-engine-source-drift-silently` (triage 0.765), which mutated its own hits once and shipped no item. | none |
| G2 | `gh-cfdude-pm-211`: a RED note ("fails today") goes stale when an earlier task in the same change already makes it pass | M | superpowers | Same class as G1: a test that cannot go red. **Build G1 and G2 as ONE required item** (mutation pass, plus re-running RED at task start), and keep both epics so #211 closes. | none |
| G3 | `registry-bound-poison-sweep-practice`: a completeness assertion that every value-bearing flag has a hostile-input recipe | M–L | openspec | Pairs with G1. Under the budget it becomes a one-line item plus a skill, with the assertion in pm's own suite. | none |
| G4 | `planning-completeness-orient-and-autonomy-boundary`: Orient reads the spec inventory (`verify-specs` exists), and the propose/apply boundary limits an autonomy grant | S–M | superpowers | The leftover of 0.51 B3. Small, and it edits the same text. | none |
| G5 | **#243** (to mirror): Gate 1 can be recorded while `openspec validate --strict` fails, because a piped `tail` hid the failure | S–M | superpowers | Mechanical fix. The engine already runs `openspec` locally (`scripts/lib/tool-currency.mjs:140`), so a refusal opens no network connection and stays inside the instruction-layer law. | none |
| G6 | **#252** (to mirror): `record-gate-review --artifact <directory>` records no digest, so every Gate 1 reads "unverifiable" | S | superpowers | Gate evidence that cannot go stale is the same defect class. Touches `gate-artifact-evidence.mjs`. | none (could go in 0.53, see Q2) |
| G7 | `openspec-1-14-workflows-evaluation`: compare OpenSpec's 6 extra workflows (verify, bulk-archive, ff and others) with pm's gates and archive handling | M (evaluation only) | openspec | Any check `openspec verify` already covers is block text pm can stop emitting, which offsets the budget. Installed: OpenSpec **1.14.2**. Rob runs `openspec update` first (epic note, 2026-10-14). | none |

### Batch B — backlog and fleet tooling

| # | Epic (what it does) | Size | Lane | Why it is in | Needs from 0.53 |
| --- | --- | --- | --- | --- | --- |
| B1 | `backlog-grooming-pass`: a repeatable procedure that re-reads the backlog as a set and proposes merges, declines and stale premises | L | openspec | P1 priority, cut from 0.41 and 0.53. Its `relates-to epic-registration-clock` is now delivered. | **yes**: the #204 `list` verb |
| B2 | `triage-surfaces-open-release-intents`: `triage` shows open releases' intents and each candidate's release | S–M | superpowers | Grooming and intake read the same surface. | **yes**: #207 adds `triage --ask=` in the same `triage.mjs` |
| B3 | `fleet-upgrade-after-release`: an engine answer to "which repos on this machine are behind", plus the per-repo upgrade recipe | M | superpowers | Cuts the per-release fleet cost Rob pays. **Number changed**: `fd` finds 30 `.conductor` directories at depth 9 or less under three roots. That includes nested and breadcrumb-only directories, so it is not a repo count. The title's "23 of 26 stale" is dead. | none |
| B4 | **#246** (to mirror): NEXT UP silently drops a queued openspec epic that has no change on disk | S | superpowers | The top priority vanishes from the one view re-sent every session. Brief honesty. | none |
| B5 | **#249** (to mirror): `update-epic --status active` silently moves the active pointer and demotes the active epic | S–M | superpowers | Mis-attributed 10.7M tokens to `no-active-epic` in a consumer repo. It also corrupts the spend ledger 0.53 analyses. | 0.53's analysis is its main reader |

**Stretch, only if Batch B finishes early. Otherwise 0.55:**
- **#245** `rename-epic`: rewrites an epic's id everywhere it is held, plus `notes` in `add-many`. M. It needs a full sweep of id holders, and grooming consolidations would use it.
- **#247** `--waits-on`: records what a blocked epic waits on when that is not an epic. S–M. It must ship with its `--clear` inverse.

## 3. What stays out, and the proposed disposition

| Epic or issue | Proposal | Why |
| --- | --- | --- |
| `codex-platform-support`: port pm to Codex CLI | **keep `later`** | Its own `depends-on hermes-platform-support` link says Hermes goes first so Codex can reuse its layout. Two L ports in one release make a long serial chain and double the review surface. Facts are stale (0.145.0; installed is **0.149.1**). P6 refreshes them as a written note. |
| `hierarchy-run-has-one-state-writer`: during a hierarchy run, only the orchestrator writes `state.json` | **keep planned → 0.55 lead** | L, with open design questions. **New sibling #241**: parallel epic branches conflict on `state.json`, and gate records were lost on replay. That is a different cause (consumer branches, not hierarchy children) in the same design space. Propose a `relates-to` link and build them together as one theme. |
| `gh-cfdude-pm-208`: offer the `pm:refused` doc-marker convention to consumer repos | **decline** | 0 comments and no consumer demand since 2026-09-17. It would add block text against the budget. |
| `store-owns-claude-md-managed-block`: move init's CLAUDE.md and .gitignore writes into the store so tests leave the disk | **keep planned; decide at re-check** | Decision rule (`pm-overhead-baseline` story): build only if disk-write tests carry 10s or more of the assert rung. If they do, it becomes a 0.54 member. If not, `--outcome declined` with the numbers. Both of its links are delivered (re-verified). |
| `changelog-page-too-long-archive-older-releases`: split the long Mintlify changelog page | **out-of-band** | Lives in cfdude/pm-docs, so no plugin release and no fleet pass. **Grew**: CHANGELOG.md is 4013 lines with 68 `## ` headings (3888 at 0.53 grooming). |
| **#242**: an invalid spend-marker phase is rejected without naming the value or the accepted set | **fold into 0.53** (Q2) | This is the 0.53 assessment's own Q7 friction, never filed until now. `token-spend-analysis-and-recommendations` has no stories yet. S. |
| **#251**: the spend guard's token ceiling counts cache-read, so it measures session length | **fold into 0.53's analysis design, or open a 0.54 spend follow-up** (Q2) | The same "never rank on raw totals" finding as the 0.53 assessment §6. It is a bug in a shipped 0.52 surface, reported by two repos. |
| **#250**: tell a converging review loop from a stuck one, and support a scoped confirmation round | **0.55** | Needs per-round severity data. The 0.53 analysis is the first place that data exists. |

## 4. The 11 unmirrored issues: proposed homes

| Issue | Kind | One-line summary | Proposed home |
| --- | --- | --- | --- |
| #241 | feature | Parallel branches conflict on state.json, PROJECT.md and render-stamp.json, with no merge verb | 0.55, with hierarchy-run-has-one-state-writer |
| #242 | bug | Invalid marker phase not named | 0.53 (Q2) |
| #243 | feature | Gate 1 recorded while validate fails | 0.54 G5 |
| #245 | feature | rename-epic, plus notes in add-many | 0.54 stretch |
| #246 | bug | NEXT UP drops a no-change openspec epic | 0.54 B4 |
| #247 | feature | Text-form waits-on for blocked epics | 0.54 stretch |
| #248 | feature | Conditional rules-block sections | 0.54 G0 (budget vehicle). Read with `feature-switches-audit`; its intent overlaps, but triage missed it lexically. |
| #249 | bug | --status active silently moves the pointer | 0.54 B5 |
| #250 | feature | Converging review loops in the spend guard | 0.55 |
| #251 | bug | Token ceiling counts cache-read | 0.53 or 0.54 (Q2) |
| #252 | feature | Directory artifact gets no digest | 0.54 G6, or 0.53 (Q2) |

Triage found **no open duplicate** for any of the 11. The closest lexical hits were archived epics
with a different intent. The intent overlaps (#248 with feature-switches-audit, #251 with the analysis,
#241 with hierarchy) came from reading the candidates, not from their scores.

## 5. Stale or changed beyond what the 0.53 assessment caught

1. **The inward sync is behind by 11 issues** (§4). The last sync predates 2026-10-13.
2. **8 GitHub issues are OPEN while their epics are closed:**
   - #226, #227, #229 and #230: superseded into `certification-record-redesign`, delivered in 0.51.0. Their reasons say "closes when it ships".
   - #223: folded into `gh-cfdude-pm-213`, delivered in 0.52.0.
   - #190: folded into `gh-cfdude-pm-198`, delivered in 0.51.0.
   - #185: delivered in 0.41.0.
   - #114: declined 2026-10-14.
   - Propose closing each with a comment that cites the delivering release (Q7). That is an external write, so it is Rob's call.
   - **Friction to file**: the release issue-close step does not follow a superseded epic to the epic that delivered it. `/pm:feedback bug`, not filed.
3. **The Hermes facts moved.** Installed: **Hermes Agent v0.21.4 (2026.9.21)**. The epic says v0.19.0. From the vendored docs (`~/.hermes/hermes-agent/website/docs/user-guide/features/hooks.md`):
   - Open design problem 1 (the briefing would repeat on every turn) **probably has an answer now**:
     - `register_system_prompt_section` runs **once per new session** and is frozen across compression (hooks.md:401-437).
     - `pre_llm_call` now carries `is_first_turn` (hooks.md:456).
   - **New constraint:** a prompt section is capped at **4,000 characters**, and all plugin sections together at 8,000. pm's brief cap is 16,384 bytes, and pm's own brief is 8,242 bytes. The brief does not fit as-is, so Hermes needs its own brief cap. That feeds G0.
   - Open design problem 2 partly stands. Shell hooks are still declared in `config.yaml` (plugins.md:358). Python plugins declare hooks in `plugin.yaml`, which makes a thin Python plugin that calls `conductor.mjs` the natural route.
   - Still no PreCompact-equivalent hook found.
   - These are pointers for the brainstorm, not a verified design.
4. **`remaining-platform-investigation`: one half is done.** `README.md:212-213` now point the Gemini and Grok rows at this epic. The README correction its note demanded has happened. The investigation itself has not.
5. **`fleet-upgrade-after-release`**: its title numbers are dead (above).
6. **`openspec-1-14-workflows-evaluation`**: the installed version is 1.14.2. The 12 generated files (6 `.claude/commands/opsx/*.md` and 6 `.claude/skills/openspec-*`) are still untracked on `dev`.
7. Re-verified and **still valid**:
   - Hermes's 3 depends-on targets are delivered.
   - The `platform-switch` premise holds.
   - init still reads no `AGENTS.md`.
   - The EDD corpus is still 1 scenario.
   - The parity ledger is still claude-code only.
   - `engine-source-extraction-vacuity` (0.53) is the declared remainder of the delivered guards epic, not a duplicate. This pass did not re-test its sites.

## 6. Batches, order, chokepoints

**Shared chokepoints**, taken from the epics' own file lists and the code checked above:
- **`scripts/lib/rules.mjs`**: G0 (section emission), G1–G5 (gate-procedure text), P1 (`writeRules`), and P5 (per-platform rendering). 0.53's `dehardcode` and `spend-guard-rules-section` also touch it, so 0.54 starts from 0.53's merged file.
- **`docs/parity-ledger.json`**: P5 adds a Hermes column to every capability. Any new command doc (from B1, B3 or G5) must be claimed in it. So **P4 and P5's ledger pass run after every new command has landed.**
- **`scripts/lib/constants.mjs`** (the flag registry) and dispatch: new verbs or flags from B1, B3, B5, G5 and G6.
- **`scripts/lib/briefing.mjs`**: B4, the Hermes brief cap, and possibly G0.
- **`scripts/lib/triage.mjs`**: B2 (after 0.53's #207).

**Order**:
1. **Wave 0. After 0.53 deploys; nothing builds yet.**
   - Run the §7 re-check.
   - Run `/pm:sync` to mirror #241–#252.
   - Rob runs `openspec update`.
   - Hermes brainstorm on Opus against v0.21.4.
   - The store-owns decision.
2. **Wave 1, in parallel, one agent per stream, separate worktrees:**
   - P-early: P1, then P2. Both touch rules.mjs and init; merge P1 first.
   - P3: EDD corpus. `evals/` is Python and isolated.
   - P6: investigation only, no code.
   - G-plan: G0's design plus the G7 evaluation. Planning only, so no engine files.
   - B: one agent, serial: B4 → B5 → B2 → B1 → B3. All of them touch the constants, dispatch and briefing chokepoints.
3. **Wave 2. G build, one agent, serial, after P1 merges:** G0 (the budget test and conditional sections) → G1+G2 as one item → G3 → G4 → G5 → G6. Every item after G0 must pass G0's ceiling.
4. **Wave 3. Hermes:** P5's build starts after G0 merges, because Hermes needs the final block shape and its own brief cap. P4 (ledger column, corpus run) goes **last**.
5. **Gates.**
   - Review mode `standard`. No member needs `thorough`, because there is no schema migration (a fact to re-confirm at Hermes design).
   - One reviewer, one round. Only a Critical reopens a gate.
   - **Cross-spec review is required** before `/opsx:apply`, because several openspec changes are expected: P5, G0, G3, B1.
   - One converged Gate 2 on `rc/0.54.0`.
6. **Models.**
   - Opus: the Hermes brainstorm and spec, the G0 design, and the reviews.
   - Sonnet: the builds.
   - Haiku is enough for B4 and G6.

## 7. Re-check when 0.53 deploys

| Waits on (0.53 output) | Decides |
| --- | --- |
| #204 `list` verb shipped, and its flags | B1's design. B1 must not read `state.json` raw. |
| #207 `triage --ask=` merged into `triage.mjs` | B2's starting point |
| `pm-overhead-baseline` re-baseline story (assert-rung split, disk-write share) | store-owns: build if 10s or more, else decline with the numbers |
| `pm-overhead-baseline` per-session block and brief cost | G0's ceiling numbers |
| `feature-switches-audit`: which sections got switches | G0's remaining scope. Merge #248 into it if 0.53 already did conditional sections. |
| `dehardcode-openspec-change-root-in-instructions`, `spend-guard-rules-section-follows-live-limits` merged into `rules.mjs` | G0, G1–G5 and P1 rebase onto them |
| Whether #242, #251 and #252 were folded into 0.53 (Q2) | Their row in §4 |

## 8. Rules-block budget approach (for Batch G)

**Facts:**
- **0.52.0 capped the SessionStart brief at 16,384 bytes.** The cap shortens lists and never cuts warnings or obligations. pm's own brief fell from **78,275 bytes (about 19.5K tokens) to 8,242** (`CHANGELOG.md:95-102`).
- 0.52 added `rules --sections` and a session-cost line, and **left the block itself unchanged** (`CHANGELOG.md:62-65`).
- Today on pm's own repo, the block is **42,242 bytes, about 10,561 tokens** by the bytes/4 estimate.
- The gate procedure is **11,963 bytes (28.3%)** across 7 items, about 1,709 bytes per item (computed). The GitHub issue sync is 5,498, present because a tracker is configured. Autonomy is 3,137 and release candidate 1,173.
- #248 reports **34,654 bytes** for a fresh 8-epic repo with no tracker. That figure is from the issue and was not measured here.

**Approach:**
1. **The budget is an authoring-time ceiling, not a runtime cap.** The brief can shorten its lists because they are history. Every line of the block is an obligation, so truncating it at session time would silently drop a rule.
   - Proposed form: an assert-rung test over `rules --sections`.
   - It holds a per-section ceiling, and a total ceiling for a fresh repo with every feature off.
   - The test fails when an edit exceeds either one.
2. **Proposed ceilings. These are proposals, not measurements; set them from 0.53's baseline:**
   - Gate procedure: **zero net growth**, at or below today's 11,963 bytes.
   - Fresh-repo total: at or below 34,654 bytes now, lowered once conditional sections land.
3. **How a new item pays for itself.** Each new numbered required item is **one numbered line in the block**: the obligation, plus a pointer to a shipped skill that carries the procedure and the evidence.
   - Precedent: item 5 plus `skills/cross-spec-review/`.
   - This keeps the form measured at 14/14 adoption (against 3/15 for a prose bullet), because the task item stays.
   - Only the prose moves out.
4. **Offsets that make room for G1–G5:**
   - (a) Apply the same one-line-plus-skill form to items 1–7, moving their evidence paragraphs into the skill.
   - (b) #248's conditional sections for autonomy and release candidate, the ones not already conditional.
   - (c) Whatever G7 finds OpenSpec already enforces.
5. **Per-platform caps.** Hermes's prompt-section limit (4,000 characters) means the budget table carries a column per platform. The Hermes brief needs its own cap.

## 9. Questions for Rob

1. **Accept this as a provisional scope, finalized by the §7 re-check after 0.53 deploys?** My recommendation is yes. A full second grooming would repeat this pass.
2. **Fold #242, #251 and #252 into the not-yet-built 0.53?** My recommendation is #242 yes (S, and 0.53's own finding), #251 yes as a requirement on the analysis design, and #252 to stay in 0.54.
3. **Codex in 0.54?** My recommendation is no. Keep it `later` behind Hermes, as its own link says, and refresh its facts in P6.
4. **`hierarchy-run-has-one-state-writer` in 0.54, as listed in your direction?** My recommendation is to make it the 0.55 lead, paired with #241. Both are L design on who writes `state.json`, and 0.54 already carries two L epics plus Hermes.
5. **Decline `gh-cfdude-pm-208`?** My recommendation is decline. There is no demand, and it adds block text.
6. **Hold the store-owns rule as stated (build at 10s or more, else decline)?** My recommendation is yes. Decide in Wave 0 with the numbers recorded in the disposition.
7. **Close the 8 stale GitHub issues (#114, #185, #190, #223, #226, #227, #229, #230) with comments citing the delivering release, and file the release-close friction?** My recommendation is yes to both.
8. **Adopt zero net growth for the gate procedure, with each new item as one line plus a skill?** My recommendation is yes, ceilings set from 0.53's baseline.
9. **Stretch items #245 (rename-epic) and #247 (waits-on)?** My recommendation is 0.55 unless Batch B finishes early.
10. **Name: "Portable, and within budget"?** My recommendation is yes. It names both themes that carry the release.

Bookkeeping, if approved. The orchestrator does all of it; none was done here:
- `/pm:sync` to mirror the 11 issues.
- Create release `0.54.0` with the 19 members.
- Add a `relates-to` link from #241's epic to `hierarchy-run-has-one-state-writer`.
- Decline `gh-cfdude-pm-208`, with its reason.
- Note G1 and G2's single-item build on both epics.
- Widen P6's scope note to include the Codex fact refresh.

## 10. Section 7 re-check outcome (2026-10-22, after the 0.53.0 deploy)

| Row | Outcome |
| --- | --- |
| #204 `list` | Shipped (`--status --lane --linked-to --json`). No `--release`/`--priority`/text filter, so B1 must filter output itself or add a flag. Never read `state.json` raw. |
| #207 `--ask=` | NOT shipped. 0.53.0 only improved the refusal text. `triage` still takes one positional (`scripts/lib/triage.mjs:205-221`). The "B2 after #207" wording in §2 and §6 is wrong; B2 may add `--ask=` itself. |
| store-owns re-baseline | Gate reads met (`docs/measurement/2026-10-commit-gate-rebaseline.md`: write-reaching tests ~26-28s wall-equivalent, load 6-16). Quiet-machine rerun and sizing of movable tests (of 525) still owed. Verdict recorded on the epic; it stays out of the core 19 until sized. |
| Overhead per-session | `overhead --all-features`: 14,504 est. tokens unconditional (core 10,592; gate procedure 3,006; intake 1,006; tracker 1,476; spend-guard 202). Estimates only (bytes/4). G0's ceiling is provisional until the calibration run. |
| `feature-switches-audit` | Audit shipped, zero switches built. #248 stays G0's vehicle; the calibration epic carries the remaining switch work. G0's first question: `rules:intake` switch or shrink under 1,000. |
| dehardcode + live-limits | Merged (`rules.mjs:301`, `:114`, `:1191-1199`). G and P1 text must say "the change's directory as OpenSpec reports it"; the dispatch wrapper refreshes the block after any state-writing verb. |
| #242, #251, #252 | #242 and #251 shipped in 0.53.0 (drop from §4). #252 open: stays G6. |

Membership change: `pm-overhead-calibration-and-feature-switches` added as a Wave-0 item. Its run count and token ceiling need Rob's confirmation before any run.
