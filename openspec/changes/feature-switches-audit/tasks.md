# Tasks

## Commit mechanics

- **TDD.** RED then GREEN, saved as `red-<task>.txt` here, one commit naming it.
- **Rungs.** `OPT_INS` rows, the `upgrade` lines, a switch's state and refusals, `rulesBlock()` with a
  feature off, and `overhead`'s zero for it: UNIT. The README table check and `CLAUDE.md` after a switch:
  FILE.
- **Certify.** `rules.mjs` is a managed-rules surface; stage exactly, `node scripts/test/drift.mjs --phase pre-commit`,
  certify what it names.
- **Commits.** One conventional commit per task, explicit paths, never `--no-verify`; `git show --stat`
  (R.2) and `update-epic feature-switches-audit --attribute-commit <sha>` (R.4).
- **Order.** After `pm-overhead-baseline` (the map and the numbers) and `developer-session-log`
  (`devLog` exists as a feature id).

## 0. Before any code

- [ ] 0.1 **Gate 1** (review `standard`) over the proposal, design, `specs/feature-switches/spec.md` and
      this file; fix Critical and Important; `openspec validate feature-switches-audit --strict` (read the
      exit status); `record-gate-review feature-switches-audit --gate 1 --verdict pass --artifact <path>… --reviewer "<identity>"`.
- [ ] 0.2 **Cross-spec review of release 0.53.0** (item 5), release-scoped. Chokepoints: `OPT_INS` and the
      `upgrade` opt-in lines (also grown by `developer-session-log`), the surface map (`pm-overhead`),
      the rules block (also edited by `dehardcode-…` and `spend-guard-rules-section-…`).
- [ ] 0.3 **Rob's call, recorded before 2.x:** the threshold (design D1) and the never-switched list
      (design D2). `update-epic feature-switches-audit --notes "<decision>"`.

## 1. The audit

- [ ] 1.1 Run `overhead --all-features` at the head that holds `pm-overhead-baseline` and
      `developer-session-log`; write `docs/measurement/2026-10-feature-switch-audit.md` with one row per
      surface id (design D0): feature, cost, conditional or not, decision and reason. Zero switches is a
      valid outcome.
- [ ] 1.2 TDD (FILE): the README table check (design D5), with the table written from 1.1, including the
      `set-spend-tracking on` row and the listings' `no switch` row.

## 2. Switches the audit justified (one task per switch; none if 1.1 adds none)

- [ ] 2.0 **Amend before building a switch.** For each switch 1.1 justifies: amend this change's spec
      (a requirement naming the new `OPT_INS` id, its verb and the surface ids it takes from `core`) and
      `pm-overhead`'s map entries; re-validate with `openspec validate feature-switches-audit --strict`;
      re-run Gate 1 on the amended artifacts and re-run the release 0.53.0 cross-spec review (its verdict
      goes stale on the amendment), recording both, BEFORE 2.1 starts.

- [ ] 2.1 For each switch 1.1 adds: TDD (UNIT + FILE) its `OPT_INS` row, `set-<feature> on|off`
      (idempotent, refusing other arguments), absent = today's behaviour, `rulesBlock()` gating, the
      `upgrade` `on (default)` line (design D3), `overhead` reporting 0 bytes when off, `CLAUDE.md` refreshed
      on toggle; its command doc and parity-ledger claim in the same commit. Name each switch as a sub-task
      (2.1a, 2.1b, …) when it is added.
- [ ] 2.2 Changeset fragment `.changesets/feature-switches-audit.md`.

## R. Required task items (CLAUDE.md "The gate procedure", items 1–7)

- [ ] R.1 **Call-site completeness sweep** (item 1). For each new switch: `rg -n "<section heading>" scripts/lib`
      lists every emitter of its text (rules block, brief, hooks, command docs) and each is gated or
      justified. `rg -n "OPT_INS" scripts/lib`: every registry reader handles a default-on row. Inverse:
      on ↔ off for each switch; state that no switch ships without both. Save as `call-site-sweep-R.1.txt`.
- [ ] R.2 **Verify against the commit** (item 2).
- [ ] R.3 **Lifecycle marker** (item 3): C.2 and C.3.
- [ ] R.4 **Attribute every commit** (item 4); never the archive move.
- [ ] R.5 Cross-spec review (item 5): 0.2.
- [ ] R.6 Disposition (item 6): C.2.
- [ ] R.7 **Route what the work taught you** (item 7). Hand 1.1's numbers to the 0.54.0 rules-block budget
      (G0, #248) as its input.

## G. Gate 2

- [ ] G.1 **Gate 2** over `BASE..HEAD` (or the converged `rc/0.53.0` review): no upgrade behaviour change,
      off removes every mapped surface, safety rules unswitched, table and map agree.

## D. Docs (after Gate 2 only)

- [ ] D.1 README (table written in 1.2) and Mintlify, per `mintlify-doc-sync`.

## C. Close

- [ ] C.1 Re-record Gate 2 after docs.
- [ ] C.2 <!-- pm:lifecycle --> **Disposition.** `update-epic feature-switches-audit --status archived --outcome delivered --reason "<why>"` with `--declined-deferral "automatic section selection:GitHub #248, the 0.54.0 rules-block budget"` (or `--deferral` once #248 is mirrored as an epic), then `/pm:status`.
- [ ] C.3 <!-- pm:lifecycle --> **Archive.** `/opsx:archive feature-switches-audit`. Not attributed.
