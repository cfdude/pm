# project-boards gate items R.1 R.2 R.3 R.4 R.7 (audit at release cut, base 15a67915)

## R.1 Call-site sweep: PASS with 3 findings
Searches run as named. Guards and sites:
- Untriaged summary warning (warnSummary): add-epic.mjs:522, add-many.mjs:266, update-epic.mjs:1195, active-pointer.mjs:136, detour-stack.mjs:179-180. Status writers that do NOT warn, each justified: subcommands.mjs:1009 (writes `untriaged`, owes nothing), subcommands.mjs:963 (creates `archived`), 1028/1112 (create `untriaged`), epic-progress.mjs:208 (`archived`), active-pointer.mjs:151 clearActive (active -> queued; epic was already past untriaged), detour-stack.mjs:150 (-> paused, same). owesSummaryWarning (epic-summary.mjs:~50) exempts untriaged/archived targets, so no sibling is unguarded.
- pushEpic creation sites: 5 (add-epic:513, add-many:250, subcommands:962/1028/1112), matches 8.6 claim; epic number rule bound in the sink.
- externalUrl: board.mjs:176-183 scheme check (http/https); templates re-check via safeUrl/linkOrText. No other board reader of externalUrl.
- Template `${` interpolations: every value in backlog.html / release-plan.html goes through esc()/H()/num(); no raw interpolation seen (spot-read all hits).
- reserved id `here`: releases.mjs:58 `const SHOW="show"` is the only "show" hit in releases.mjs (the rg `"show"` pattern matches no quoted literal); the reserved-id wiring for `here` is not visible by that search, verify via the 3.2 test rather than the rg.
FINDINGS:
1. design.md "Inverses" has THREE `no` rows (release --intent, artifact delete, answers submitted) but R.1 says "justify the two that are not shipped". Each is justified in the table; fix the count wording in R.1.
2. Data reference `releasePlan.here` / `mission.milestoneRelease`: the export reports a stale value (board.mjs:259-261 reject; 239-242), but text surfaces degrade silently: release-plan.mjs:55 planOf() maps a stale `here` to null and milestoneOf() (release-plan.mjs:38) maps a stale milestone to null, so status/brief show nothing; mission-record.mjs:31 and rules.mjs:135 print the stale milestone id verbatim. No release-removal verb exists (only `--unmember`), so staleness needs a hand edit; justify or add an integrity finding.
3. dependsOn removal: remove-epic sweeps via epicReferences (links.mjs:344) and the export reports dangling depends-on (board.mjs:189). Holds. `proposals/rank` ids live in the artifact DB, not state: removal is the page/agent refresh (design Inverses row), not engine-enforced; state this as the justified omission.

## R.2 Verify against the commit: PASS (with one process deviation)
`git show --stat` run for all 17 attributed commits plus 606a9b63, 1c365d34, f9b23a7b. Every task-claimed path that exists in the repo appears in an attributed commit (97 distinct paths touched). Untouched claimed paths are all legitimate: plugin.json, CHANGELOG.md (release cut 6c92f3b0, V tasks), CLAUDE.md/commands/list.md/commands/release.md/subcommands.mjs/parity.test.mjs (named as unchanged or negated: "No commands/board.md exists", "no commands/release.md"), archive/ red files (other changes).
Red files land with their GREEN: red-1.2/2.1/3.1/4.1 (820f08e0), 5.1 (ab128ee9), 6.1/6.2 (75c8cf4c), 8.1/8.2 (9cdbd672), 8.3-8.5 (3ae4f250), 9.1 (020f73fe).
Deviation: tasks.md "Commit mechanics" says one commit per task; 820f08e0 bundles tasks 1.2-4.2 (46 files; its message says why: shared registry files, one certify per commit). Also 6.3 and 7.2 share 75c8cf4c/other commits. Not a missing-file failure.

## R.3 Lifecycle marker: PASS
`rg -n "pm:lifecycle"` returns line 389 (R.3's own prose), 467 (C.2), 468 (C.3). Exactly C.2 and C.3 carry the marker on their task lines. C.1 (re-record Gate 2) is unmarked, as the task says.

## R.4 Attribution: PASS (judgment call noted)
All 17 project-boards commits are in attributedCommits, in landing order: e563df07 820f08e0 ab128ee9 75c8cf4c 016babf0 47528b6a 89dbbf46 378831d9 9cdbd672 3ae4f250 3d2098ef a2326b19 75479c06 f8d2f201 3f4bf6a8 020f73fe 22533808. Missing: none.
Correctly not attributed: release-prep (6c92f3b0, fd461b00), docs c6640eb8, bookkeeping chore(conductor) commits, 6c90e231 upgrade, taxonomy proposal (1be14d72..72b39649, 3f78aeef), #262 plan 115b867b.
Judgment calls (not attributed, left so): 606a9b63 and 1c365d34 (docs/artifacts/artifacts.md rows for the live boards; registry bookkeeping), f9b23a7b (pm-dev state upgrade/numbering via the 0.55.0 migration, a fleet run of the shipped migration, not change code), 9fa0f384 (state record of mission). Attributing them after Gate 2 would stale the verdict; do not.

## R.7 Routing (seeds verified against history)
| Lesson | Class | Evidence | Action |
|---|---|---|---|
| set-active/update-epic demotes prior active epic; made 0.54.0 look delivered, 7 false `delivered-release-epic-left-open` findings | tooling friction | proving-run-notes.md item 3 (47528b6a); active-pointer.mjs:42,151. set-active DOES print movedActiveNotice (active-pointer.mjs:63-70), so "silently" is only true of update-epic --status active | Already filed: cfdude/pm#249 (open). Comment with the false-delivered-findings consequence, do not file new |
| ~8 hand-edited tables per new verb | tooling friction (recurrence) | 3ae4f250 (set-project) touches conductor.mjs, constants.mjs, verb-effects.mjs, parity-ledger.json, commands/set-project.md, README, 2 SKILL.md, 3 test tables = 28 files; 820f08e0 message: "every commit costs a functional certify" | Closed issue #206 matches; reopen/comment with this evidence, no new issue |
| no method to seed >50 artifact-DB docs | tooling friction (skill gap) | proving-run-notes.md item 1: SKILL.md:31 says "batches of at most 50", gives no way to supply 108 docs; run used one JSON file per write + a subagent | New /pm:feedback (draft below) |
| record-gate-review silently fails on strict-validation warning (>500 char requirement) | UNSUPPORTED, dropped | Nothing in 15a67915..HEAD or project-boards notes records it. Related shipped fix: gh#243 (openspec-validate.mjs:1-8) already makes the engine run validate unpiped and refuse a Gate 1 pass | Drop unless Rob has the transcript |
| certify wrapper exit status easy to misread | UNSUPPORTED, dropped | No evidence in repo history for this range | Drop |
| unshipped vs superseded counting gap on release board | NOT friction; deliberate design | design.md D22: only `declined` leaves the denominator, superseded/killed keep release below 100% until `release --unmember`; mitigated by `unshipped` rows (020f73fe). Related open #254 | No filing; at most comment on #254 |
| follow-up epics mission-anti-spawn-rule, backlog-trend-view, commit-time-close-check, epic-summary-required-on-triage | practice/backlog | state.json: all four registered, status planned | Done already |
| Template raw-interpolation lesson | process | No recurrence found in shipped pages | None |

Draft issue body (seed-batching gap), for cfdude/pm, label feature:
"The project-boards skill tells the agent to write artifact-database documents in batches of at most 50 but gives no way to supply the documents. A first population of a real project is about 108 documents (87 epics, 20 releases, one info doc). One inline batch of 50 is roughly 12 KB of tool input, so inlining everything is slow and error-prone. The proving run worked around it by writing one local JSON file per document and passing `file_path` on each write, with a subagent applying six batches. Suggested fix: have the skill document this recipe, or have `board --json` optionally emit a directory of per-document JSON files plus a batch manifest so the agent can apply them without composing the payloads by hand."
