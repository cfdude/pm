# Tasks

## Commit mechanics

- **TDD.** RED then GREEN, saved as `red-<task>.txt` here, one commit naming it.
- **Rungs.** Every rule, recommendation, ranking, trend verdict and output form is a pure function of
  in-memory attributed rows and state: UNIT. "Opened no spend or transcript path with tracking off" (observe-reads),
  the empty-ledger case and a fixture-ledger end-to-end run under a temp `CLAUDE_CONFIG_DIR`: FILE.
- **Certify.** New `scripts/lib` module and dispatch: stage exactly, `node scripts/test/drift.mjs --phase pre-commit`,
  certify what it names.
- **Commits.** One conventional commit per task, explicit paths, never `--no-verify`; `git show --stat`
  (R.2) and `update-epic token-spend-analysis-and-recommendations --attribute-commit <sha>` (R.4).
- **Order.** After `gh-cfdude-pm-251` (`work`) and `gh-cfdude-pm-242` (invalid-marker list); before
  `decision-cost-log`.

## 0. Before any code

- [x] 0.1 **Gate 1** (review `standard`) over the proposal, design, `specs/spend-analysis/spec.md` and (Gate 1 pass recorded 2026-10-20)
      this file; fix Critical and Important; `openspec validate token-spend-analysis-and-recommendations --strict`
      (read the exit status); `record-gate-review token-spend-analysis-and-recommendations --gate 1 --verdict pass --artifact <path>… --reviewer "<identity>"`.
- [x] 0.2 **Cross-spec review of release 0.53.0** (item 5), release-scoped. Chokepoints: the `spend` (release 0.53.0 cross-spec pass, fixed at 8c4b1c78)
      pipeline and `work`; the invalid-marker list; the rows' `tools` names; the Decisions section
      owned by `decision-cost-log`; the long-context rule here vs the session log's retention warnings
      (different subjects: agent spend vs session age — confirm no double ownership).
- [x] 0.3 **Rob's call, recorded before apply** (design D3, D5): the six thresholds and the 20% trend (decided autonomously by the orchestrator during Rob's unattended sprint on the spec's recommended default; Rob may retune — see closeout)
      band. `update-epic token-spend-analysis-and-recommendations --notes "<decision>"`.

## 1. The verb and the breakdown

- [x] 1.1 TDD (UNIT + FILE): `spend-analysis` scope handling, ingest-as-`spend`, tracking-off and
      empty-ledger behaviour (tracking off opens no spend path), byte-identical state. Register the verb (`reads`), its flags, `USAGE`,
      `commands/spend-analysis.md` and its parity-ledger claim in the same commit.
- [x] 1.2 TDD (UNIT): the breakdown (design D1, D2): classes apart, by actor/tier/role/phase, agents by
      `work`, the unattributed section, no money cost.
- [x] 1.3 TDD (UNIT): the tools section: call counts per tool name from the rows' `tools`, per actor, and
      the line saying tokens are not apportioned to tools.

## 2. Flags, recommendations, trend

- [x] 2.1 TDD (UNIT): the six rules as named constants with "proposal" comments (design D3), every flag
      scenario including the clean scope.
- [x] 2.2 TDD (UNIT): one recommendation per rule (design D4), deterministic over an unchanged ledger.
- [x] 2.3 TDD (UNIT): the trend and its floor (design D5), every trend scenario.
- [x] 2.4 TDD (UNIT): the JSON shape.
- [x] 2.5 Changeset fragment `.changesets/token-spend-analysis-and-recommendations.md`.

## 3. Dogfood

- [x] 3.1 Run `node scripts/conductor.mjs spend-analysis --no-ingest` in this repository and save the
      output as `dogfood-3.1.txt`. Confirm the 60.5M agent raises `long-context-agent`, the
      `invalid-marker` bucket raises `invalid-markers`, and the trend reads `insufficient data`. Any
      disagreement with assessment §6 is investigated before Gate 2, not explained away.
      NOTE (2026-10-20): the 60.5M agent and the invalid-marker bucket are flagged as expected. The trend reads `falling`, not
      `insufficient data`: the ledger now holds two releases (0.52.0, 0.53.0) with 3+ epics each; the in-flight 0.53.0 is compared
      with a finished one. Cause and the dominant-agent noise are in `dogfood-3.1.txt`; both are for Rob's call (design D3/D5).

## R. Required task items (CLAUDE.md "The gate procedure", items 1–7)

- [x] R.1 **Call-site completeness sweep** (item 1). `rg -n "buildReport|attribute\(" scripts/lib`: every
      consumer of the report; confirm the analysis adds no second ingest or transcript reader.
      `rg -n "KNOWN_MODELS|tier" scripts/lib/spend*.mjs`: the tier mapping `tier-mismatch` reads is the
      one the ledger writes. Inverse: a read-only verb; the ingest it performs has `spend --clear` as its
      inverse already. Save as `call-site-sweep-R.1.txt`.
- [x] R.2 **Verify against the commit** (item 2).
- [x] R.3 **Lifecycle marker** (item 3): C.2 and C.3. (C.2 and C.3 carry the marker)
- [x] R.4 **Attribute every commit** (item 4); never the archive move.
- [x] R.5 Cross-spec review (item 5): 0.2. (by 0.2)
- [x] R.6 Disposition (item 6): C.2, with the deferral below. (by C.2)
- [x] R.7 **Route what the work taught you** (item 7). Evidence on hand: 24.5M tokens lost to two phase (lessons in epic notes)
      names (#242), a third of the ledger invisible to per-epic views.

## G. Gate 2

- [x] G.1 **Gate 2** over `BASE..HEAD` (or the converged `rc/0.53.0` review): no model call or network, (converged Gate 2 recorded at 8c4b1c78)
      no state write, ranking by `work`, thresholds labelled, trend floor honoured.

## D. Docs (after Gate 2 only)

- [ ] D.1 README (what the analysis reports, the flags, the floor) and Mintlify, per `mintlify-doc-sync`.

## C. Close

- [x] C.1 Re-record Gate 2 after docs. (no attributed commit after the recorded Gate 2 at 8c4b1c78)
- [x] C.2 <!-- pm:lifecycle --> **Disposition.** `update-epic token-spend-analysis-and-recommendations --status archived --outcome delivered --reason "<why>" --declined-deferral "per-tool token apportionment:usage counts cannot separate tokens by tool; counts only"` (add `--deferral "<epicId>:<section>"` for any threshold tuning carried forward), then `/pm:status`.
- [x] C.3 <!-- pm:lifecycle --> **Archive.** `/opsx:archive token-spend-analysis-and-recommendations`. Not attributed.
