# Tasks

## Commit mechanics

- **TDD.** Every behaviour task is RED then GREEN, saved as `red-<task>.txt` here and landed in ONE commit
  whose message names that file.
- **Rungs.** The work total, the resolver, the token signal, the warning text, the override's basis and
  every refusal are values over an in-memory store: UNIT. `CLAUDE.md` bytes are not touched by this
  change (a basis alone is not a limit, so the Spend guard section does not move).
- **Certify.** Every task here touches `scripts/lib`: stage exactly, `node scripts/test/drift.mjs --phase pre-commit`,
  certify each bucket it names, commit plainly.
- **Commits.** One conventional commit per task, explicit paths, never `--no-verify`; after each,
  `git show --stat <sha>` (R.2) and `update-epic gh-cfdude-pm-251 --attribute-commit <sha>` (R.4).
- **Order.** This change defines `work` (spend-ledger) and so lands BEFORE
  `token-spend-analysis-and-recommendations`, `developer-session-log` and `decision-cost-log`, which read it.

## 0. Before any code

- [x] 0.1 **Gate 1** (review `standard`) over `proposal.md`, `design.md`, both spec files and this file. (Gate 1 pass recorded 2026-10-20)
      Fix Critical and Important, re-run `openspec validate gh-cfdude-pm-251 --strict` reading its exit
      status, then `record-gate-review gh-cfdude-pm-251 --gate 1 --verdict pass --artifact <path>… --reviewer "<identity>"`.
- [x] 0.2 **Cross-spec review of release 0.53.0** (item 5), release-scoped. Name the chokepoints this (release 0.53.0 cross-spec pass, fixed at 8c4b1c78)
      change shares: the `spend` totals object (`work`, read by the analysis, the session log and the
      decision log), `GUARD_FIELDS` and the `spend-guard` requirements also edited by
      `spend-guard-rules-section-follows-live-limits` (a different requirement; confirm no overlap).
- [x] 0.3 **Rob's call, recorded before apply** (design D1): absent basis = `total` (chosen) or a (decided autonomously by the orchestrator during Rob's unattended sprint on the spec's recommended default; Rob may retune — see closeout)
      migration stamping existing ceilings `total` with `work` the default for new ones. Record with
      `update-epic gh-cfdude-pm-251 --notes "<decision>"`. If (b), amend the "absent basis" scenario and
      add a `MIGRATIONS` task before 2.1.

## 1. The work total

- [x] 1.1 TDD (UNIT): `work` on every totals object `buildReport()` returns (epic, agent, unattributed),
      and on the text totals line. Cover the spec's three scenarios, including the issue's numbers.

## 2. The basis field

- [x] 2.1 TDD (UNIT): add `tokenBasis` to `GUARD_FIELDS` with its check (`total|work`), default `total`
      with source `default`; `--token-basis` in the flag registry (`constants.mjs`) for `set-spend-guard`
      only; `--unset token-basis`. Cover every scenario of the two MODIFIED configuration requirements,
      including "A basis alone is not a limit" against the `OPT_INS` row and `rulesBlock()`.
- [x] 2.2 TDD (UNIT): the token signal counts in the resolved basis (MODIFIED "The token signal"
      requirement, every scenario including "A work basis ignores cache-read").
- [x] 2.3 TDD (UNIT): the breakdown line and `signals.tokens.{basis,breakdown}`; nothing computed when
      tracking is off.
- [x] 2.4 TDD (UNIT): the low total-basis warning (floor 10,000,000 as a named constant, labelled a
      suggestion in its comment and the line it prints).
- [x] 2.5 TDD (UNIT): the override records `basis`; a mismatched basis is set aside with its notice; a
      0.52 entry with no basis reads as `total`.

## 3. Docs in the engine commit

- [x] 3.1 `commands/set-spend-guard.md`: `--token-basis`, the unset, the floor warning, and the worked
      example (design D6) with its provenance (GitHub #251). `commands/spend-guard.md`: the breakdown.
      `commands/spend.md`: `work`. Changeset fragment `.changesets/gh-cfdude-pm-251.md`.

## R. Required task items (CLAUDE.md "The gate procedure", items 1–7)

- [x] R.1 **Call-site completeness sweep** (item 1). `rg -n "tokenCeiling|GUARD_FIELDS|\.total\b" scripts/lib`:
      every reader of the ceiling and of an epic's `total`; state where the basis now applies and where
      `total` stays on purpose. Data references: every writer, reader and REMOVE path of `tokenBasis` and
      of an override's `basis`. Inverses: `--token-basis` has `--unset token-basis`; the override's
      `basis` is removed only with the override record, which is never deleted (revoke marks it).
- [x] R.2 **Verify against the commit** (item 2): `git show --stat <sha>` per task.
- [x] R.3 **Lifecycle marker** (item 3): `rg -n "pm:lifecycle"` lists C.2 and C.3. (C.2 and C.3 carry the marker)
- [x] R.4 **Attribute every commit** (item 4), landing order; never the archive move.
- [x] R.5 Cross-spec review (item 5): satisfied by 0.2. (by 0.2)
- [x] R.6 Disposition (item 6): satisfied by C.2. (by C.2)
- [x] R.7 **Route what the work taught you** (item 7), each lesson named as practice, tooling friction or (lessons in epic notes)
      process failure, with evidence.

## G. Gate 2

- [x] G.1 **Gate 2** over `BASE..HEAD` (or the converged `rc/0.53.0` review): spec alignment, no 0.52 (converged Gate 2 recorded at 8c4b1c78)
      ceiling re-meant, one definition of `work`, the override basis rule. Record with
      `--base-sha`/`--head-sha` reaching every attributed commit.

## D. Docs (after Gate 2 only)

- [ ] D.1 README and Mintlify: the basis, the worked example, the cache-read explanation, per the
      `mintlify-doc-sync` skill (or carried to the 0.53.0 release cut).

## C. Close

- [x] C.1 Re-record Gate 2 after docs. Re-record, never withdraw. (no attributed commit after the recorded Gate 2 at 8c4b1c78)
- [x] C.2 <!-- pm:lifecycle --> **Disposition.** `update-epic gh-cfdude-pm-251 --status archived --outcome delivered --reason "<why>" --no-deferrals`, then `/pm:status`.
- [x] C.3 <!-- pm:lifecycle --> **Archive.** `/opsx:archive gh-cfdude-pm-251`. The archive-move commit is NOT attributed.
