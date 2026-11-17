# Call-site completeness sweep (gate item 1) — release-planning-taxonomy

Re-derived mechanically on 2026-11-16 with the `rg` commands of tasks.md R.1, run from `~/Documents/Repos/pm` against HEAD at the
fix pass. Line numbers are from that run and will drift; the commands are the record. Compared with design.md "Call sites", "Data
references" and "Inverses".

## 1. Rules and where each holds

| Rule or guard | Derived by | Sites | Holds at | Omission and why |
|---|---|---|---|---|
| The planning challenge warning (leaving `untriaged`) | `rg -n "warnSummary\(\|owesSummaryWarning" scripts/lib` | `active-pointer.mjs:136`, `detour-stack.mjs:179` and `:180`, `update-epic.mjs:1225`, `add-epic.mjs:538`, `add-many.mjs:289` (`epic-summary.mjs` defines it) | All five transition sinks call `warnSummary(epic, before, state)` with the record, so the planning half reads the open initiatives. | None. The design listed `add-many.mjs:266`; the call moved to a loop over `registeredForWarning` at `:289`, same sink. |
| One-line, length-limited text fields | `rg -n "lineFieldError\(" scripts/lib` | `non-goals.mjs:24`, `update-epic.mjs:593`, `initiative.mjs:51`, `epic-planning.mjs:58`, `add-epic.mjs:497`, `add-many.mjs:150` | Every new free-text field (title, capability, source, reasons, milestone text, evidence, non-goal) is checked through it. `release --split-reason` uses its own `oneLineError` (`releases.mjs:179`, 400 characters). | `oneLineError` in `releases.mjs` is a sibling of `lineFieldError`, not a caller: it predates this change and carries the same newline and length checks, with the release verb's own refusal wording. Left as is; the newline half of each is mutated and killed (evidence, second pass), and `--split-reason` has its own length mutant. |
| New epic rows reach `add-many` and `--help` | `rg -n "epicBatchKeys\|epicFlagsFor" scripts/lib` | `constants.mjs` (projections), `update-epic.mjs:38`, `add-many.mjs:87`, `help.mjs:97` | Every new row in the flag registry is projected into the three surfaces from one list. | None. |
| Creation sink | `rg -n "pushEpic\(" scripts/lib` | `state.mjs:136`, `add-epic.mjs:529`, `add-many.mjs:273`, `subcommands.mjs` x3 | No new epic field is seeded at creation (all optional), so no creation site changes. Planning fields enter through `applyPlanning` after `pushEpic`. | `subcommands.mjs` x3 (sync paths) never carry planning fields by design. |
| Unknown initiative id refused | `rg -n "planningError" scripts/lib` | `add-epic.mjs:511`, `add-many.mjs:162`, `update-epic.mjs:617`; `release --initiative` checks `findInitiative` itself (`releases.mjs`) | All four writers of an initiative reference refuse an unknown id before any write. Each is mutated and killed (second pass). | `initiative.mjs` takes no reference to another initiative. |
| `releaseJoinedAt` written only on a join | `rg -n "\.release = \|delete [a-zA-Z.()]*\.release\b\|releaseJoinedAt" scripts/lib scripts/conductor.mjs` | one writer pair `releases.mjs:442-443` (`--member`); removers `releases.mjs:451` (`--defer`) and `:475-476` (`--unmember`); readers `release-plan.mjs:146`, `board.mjs:210` | One writer of `epic.release`, so one writer of the join time. A repeat keeps it (the `joining` guard), a move replaces it, both removers delete it in the same block. | `remove-epic` filters the whole record out (`remove-epic.mjs:134`), which takes the key with it. |
| `initiativeJoinedAt` written only when the primary changes | `rg -n "initiativeJoinedAt" scripts/lib` | writer `epic-planning.mjs:90` (reached from add-epic, update-epic and add-many through `applyPlanning`; `add-many.mjs:264` skips the key in its generic loop); remover `update-epic.mjs:1078`; reader `board.mjs:208` | One writer, one remover (`--clear initiative`), and a primary change replaces it. | None. |
| The member warning on `release --member` | `rg -n "does not serve" scripts/lib` | `releases.mjs` (inside the one membership writer) | Holds on the one writer. Fixed in this pass: it now fires on a JOIN only (a repeat `--member` for the same release is silent). | `add-many`/`add-epic` cannot name a release, so no other site can add a member. |
| Non-goal shape, add and remove | `rg -n "nonGoals\|nextNonGoal" scripts/lib` | all four records go through `non-goals.mjs` (`addNonGoals`, `removeNonGoal`, `activeNonGoals`); readers `board.mjs:161,211,352`, `rules.mjs:1450`, `mission-record.mjs:18-19` | Add: mission, initiative, release, add-epic, update-epic, add-many. Remove: `mission.mjs:105`, `initiative.mjs:168`, `releases.mjs:266`, `update-epic.mjs:610` each refuse an unknown or removed id BEFORE calling `removeNonGoal` (all four mutated and killed, second pass). | A milestone carries no non-goals: no flag or reader touches one (stated in the first pass of the evidence). `add-epic` has no remove: a new record has nothing to remove. |
| The attribution nudge's destinations | `rg -n "attributionNudge\|attributionCandidates" scripts/lib` | `subcommands.mjs:442,540,668,677,699` | Only the untied branch changed; the tied and no-candidate branches are untouched (the 0.55.0 text is asserted unchanged). | None. |
| The rules-block sections | `rg -n "rulesBlock\(\|writeRules\(\|currentMissionSection\(\|currentBoardsSection\(" scripts/lib scripts/conductor.mjs` | builders: `rules.mjs` (`writeRules`), `conductor.mjs:532` (the `rules` verb), `overhead.mjs:186`; writers through `writeRules`: `initiative.mjs:309`, `mission.mjs:232`, `set-boards.mjs:41`, tracker verbs, `review-mode.mjs:31`, `profile-verbs.mjs:36`, `spend-*`, `subcommands.mjs:190`, `migrations.mjs:252` | All three builders of the block carry `## Initiatives` and `## Mission non-goals`; every other writer calls `writeRules`, which builds both. | None. The two sections are outside `CONDITIONAL_SECTIONS` (verb-refreshed, like Mission and Boards), asserted by the rules-section tests. |
| Reserved id `show` | `rg -n '"show"' scripts/lib/initiative.mjs scripts/lib/releases.mjs scripts/lib/mission.mjs` | `initiative.mjs:41`, `releases.mjs:60`, `mission.mjs:39` | Refused by all three verbs that take an id and a `show` read keyword. | `initiative` and `release` reject at create; `mission` takes no id. |
| Template interpolation | `rg -n '\$\{' skills/project-boards/templates/release-plan.html` | 38 template interpolations | Every new field goes through `esc()` (or `H()` over already-escaped markup); title, capability, source, milestone text, evidence, non-goal text and split reason are each mutated to unescaped and killed by the hostile-text test. | None. |
| Integrity of initiative references | `rg -n "\.initiative\b\|secondaryInitiatives" scripts/lib` | `integrity.mjs:1314-1348` | Names a dangling epic primary, epic secondary and release initiative, a malformed initiative id, and a malformed milestone id (both branches mutated, second pass). | A dangling reference on an INITIATIVE is impossible: an initiative holds no reference to another. |

## 2. Data references (holder, writers, readers, removers)

| Holder | Writers | Readers | Removers |
|---|---|---|---|
| `epic.initiative` | `epic-planning.mjs:89` via add-epic, update-epic, add-many | `board.mjs:201`, `release-plan.mjs:114,130`, `epic-summary.mjs:80`, `releases.mjs:438`, `initiative-record.mjs:68` (`primaryEpicCount`), `integrity.mjs:1341` | `update-epic --clear initiative` (`update-epic.mjs:1078` removes the join time with it); `remove-epic` removes the holder. An initiative is never deleted, so the target cannot vanish. |
| `epic.initiativeJoinedAt` | `epic-planning.mjs:90` | `board.mjs:208` | `--clear initiative`; replaced by a new primary; kept by the same value |
| `epic.secondaryInitiatives[]` | `epic-planning.mjs:94-96` | `board.mjs:203`, `release-plan.mjs:130`, `releases.mjs:438`, `integrity.mjs:1342` | `--remove-secondary-initiative` (`epic-planning.mjs:99-100`, deletes the key when emptied); `remove-epic` |
| `epic.releaseJoinedAt` | `releases.mjs:443` | `release-plan.mjs:146`, `board.mjs:210` | `--unmember` (`:476`), `--defer` (`:451`), replaced by a move, `remove-epic` |
| `release.initiative` | `releases.mjs:250` | `board.mjs:343,351`, `releases.mjs:434,624,632,639`, `integrity.mjs:1345` | `--clear-initiative` (`:258`), `--maintenance` (`:253`, which also replaces it) |
| `release.maintenance` | `releases.mjs:253` | `board.mjs:351`, `releases.mjs:434,623,631` | `--clear-initiative` (`:259`), `--initiative` (`:251`) |
| initiative milestones and non-goals | `initiative.mjs` | `board.mjs:161`, `initiative show` | marked removed only, never deleted |

No holder can dangle through a verb. A hand edit is named by `integrity` (`dangling-initiative-reference`) and read as `null` by the export.

## 3. Inverses (every operation this change adds or modifies)

Confirmed against the code for each row of design.md "Inverses" (all shipped rows have a unit test and a mutant). The deliberate omissions:

- `initiative --title`, `--capability`: no clear. Required on create, as a release's `intent`; replace with a new value.
- initiative delete: none. Ending records a work disposition, deletion would destroy it (gate item 6); `--reopen` is the inverse of `--end`.
- the 80/20 report and the scope report: none. They are derived reports, not settings.
- `--secondary-initiative`: no bulk clear (`setOnly` in the registry), one entry at a time with `--remove-secondary-initiative`.
- `--add-non-goal`: no bulk clear (`setOnly`); each removal is marked with its reason.
- `release <id> --member` join time: inverse is the existing `--unmember` and `--defer`, which this change extends to delete the time.
- the warnings: no switch, deliberately. A recorded reason silences them per epic, and the registry scan asserts no switch row exists.

## 4. Result

No unguarded sibling site found. One defect found and fixed in the same pass: the `release --member` warning ran before the join check, so a
repeat for the same release warned again (`releases.mjs`, red-fix-member-warning.txt). Three guards the first mutation pass had not exercised
(the integrity milestone-id branch and the epic and initiative callers' check before `removeNonGoal`) survived their first mutation and now have tests.
