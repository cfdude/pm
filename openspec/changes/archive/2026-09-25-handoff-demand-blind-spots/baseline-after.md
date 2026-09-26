# baseline-after (task 8.1) — 2026-09-26T05:16:39Z, dev e2ec53c5, orchestrator

## integrity
INTEGRITY — records that cannot be true.
Findings are reported, never repaired: nothing here writes state or blocks a command.

archived-with-zero-ticked-tasks — 0 finding(s): an archived epic whose task source exists and has nothing ticked
verdict-range-omits-cited-commits — 0 finding(s): a gate verdict's note cites commits its recorded range does not contain
archived-with-no-gate-2-review — 0 finding(s): an epic archived with an `ungated` Gate 2 — no review from anyone
archived-with-withdrawn-gate-2 — 0 finding(s): an archived openspec-lane epic whose Gate 2 verdict was withdrawn and not recorded again
delivered-epic-attributed-no-commits — 0 finding(s): a delivered epic with a passing Gate 2 whose attribution array is present and empty
archived-openspec-epic-with-no-gate-1 — 2 finding(s): an openspec-lane epic archived with a passing Gate 2 and no Gate 1 verdict
  • `conductor-mjs-module-split` — archived with a passing Gate 2 and no Gate 1 (spec review) verdict — the spec review either did not happen or was never recorded
  • `platform-parity-mechanism` — archived with a passing Gate 2 and no Gate 1 (spec review) verdict — the spec review either did not happen or was never recorded
archive-directory-has-no-epic — 0 finding(s): a directory under openspec/changes/archive/ that corresponds to no epic
heal-archived-epic-passed-gate-2 — 0 finding(s): an epic the heal archived reads `unknown` while carrying a passing Gate 2
gate-recorded-as-bookkeeping — 0 finding(s): a gate verdict recorded as bookkeeping rather than as review
change-registered-under-two-lanes — 4 finding(s): one change id registered as two epics under different lanes
  • `epic-hierarchy-orchestration` — registered 2 times under different lanes: `epic-hierarchy-orchestration` (decision) and `2026-07-14-epic-hierarchy-orchestration` (superpowers) — likely cause: #64/#69, `sync` registering a finished plan file as a second epic
  • `conductor-mjs-module-split` — registered 2 times under different lanes: `conductor-mjs-module-split` (openspec) and `2026-07-21-conductor-mjs-module-split` (superpowers) — likely cause: #64/#69, `sync` registering a finished plan file as a second epic
  • `edd-harness-agent-behavior-testing` — registered 2 times under different lanes: `edd-harness-agent-behavior-testing` (decision) and `2026-07-26-edd-harness-agent-behavior-testing` (superpowers) — likely cause: #64/#69, `sync` registering a finished plan file as a second epic
  • `platform-parity-mechanism` — registered 2 times under different lanes: `platform-parity-mechanism` (openspec) and `2026-08-03-platform-parity-mechanism` (superpowers) — likely cause: #64/#69, `sync` registering a finished plan file as a second epic
link-of-unknown-type — 0 finding(s): a stored link whose type nothing in the engine knows — an edge that reads as a relationship and is not one
epic-in-undefined-status — 0 finding(s): an epic in a status the engine does not define — a record no terminal rule can reach
dangling-epic-reference — 0 finding(s): a reference in the record that names an epic the record does not hold
self-referential-epic-id — 0 finding(s): a stored epic id whose value is the id of the epic that holds it
empty-epic-id — 0 finding(s): a stored epic id whose value is an empty string
grant-names-nothing — 0 finding(s): an autonomy pre-authorization whose action and category are both empty
superseded-epic-never-ended — 0 finding(s): an epic another epic declares it supersedes, still carrying a non-terminal status
delivered-release-epic-left-open — 0 finding(s): an epic still open in a release that has already delivered, and was not deliberately cut
delivered-epic-spec-deltas-absent — 0 finding(s): a delivered epic whose archived spec deltas are absent from the main specs in git's index
recorded-sha-the-repository-cannot-resolve — 0 finding(s): a recorded commit sha this repository can no longer resolve — orphaned, or already gone
tracker-repo-not-a-github-repository — 0 finding(s): a github-issues tracker whose recorded repo is not [HOST/]owner/name — it gets no `gh` listing step
advisory-claim-shape — 0 finding(s): an advisory claim that cannot be true — expired, or held on an epic that has ended

6 finding(s) across 22 check(s).

## unconsidered-outcomes
{
  "count": 0,
  "unconsidered": []
}

## archived epics reading 0/0 (was 17 in baseline-before)
211 archived epics
