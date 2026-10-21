# Tasks

## Commit mechanics

- **TDD.** RED then GREEN, saved as `red-<task>.txt` here, one commit naming it.
- **Rungs.** The record after each verb, every refusal, the cost over in-memory attributed rows and both
  output forms: UNIT. "Opened no ledger file with tracking off" (observe-reads) and the cost over a
  fixture ledger under a temp `CLAUDE_CONFIG_DIR`: FILE.
- **Certify.** New `scripts/lib` module and dispatch: stage exactly, `node scripts/test/drift.mjs --phase pre-commit`,
  certify what it names.
- **Commits.** One conventional commit per task, explicit paths, never `--no-verify`; `git show --stat`
  (R.2) and `update-epic decision-cost-log --attribute-commit <sha>` (R.4) after each.
- **Order.** Last in Batch 1: after `gh-cfdude-pm-251` (`work`) and
  `token-spend-analysis-and-recommendations` (the verb its section renders in).

## 0. Before any code

- [x] 0.1 **Gate 1** (review `standard`) over the proposal, design, `specs/decision-cost-log/spec.md` and (Gate 1 pass recorded 2026-10-20)
      this file; fix Critical and Important; `openspec validate decision-cost-log --strict` (read the
      exit status); `record-gate-review decision-cost-log --gate 1 --verdict pass --artifact <path>… --reviewer "<identity>"`.
- [x] 0.2 **Cross-spec review of release 0.53.0** (item 5), release-scoped. Chokepoints: the `spend` (release 0.53.0 cross-spec pass, fixed at 8c4b1c78)
      pipeline and its `work` total (`gh-cfdude-pm-251`), the `spend-analysis` output (owned by
      `token-spend-analysis-and-recommendations`, except the Decisions section owned here), the shared
      flag allowlist (`epic-session-attribution` grows it too).

## 1. Record and withdraw

- [x] 1.1 TDD (UNIT): `record-decision` append, numbering (design D5), every refusal in "appends a
      numbered decision", and the tracking-off refusal. Declare `--session` on it (epic-session-trail) and a
      set-only nullability marker for `epic.decisions` with its reason (epic-annotation). Register the verb, its flags in the shared
      allowlist, `verb-effects.mjs` (`mutates`), `USAGE`, and `commands/record-decision.md` with its
      parity-ledger claim in the same commit.
- [x] 1.2 TDD (UNIT): `--withdraw <n> --reason` (design D4), every scenario of the withdrawal requirement.

## 2. Cost and render

- [x] 2.1 TDD (UNIT + FILE): `decisions <epicId> [--json] [--no-ingest]` through `spend`'s pipeline with a
      window filter; the "not causal" sentence; no sum across decisions; tracking-off `not computed` and
      the observe-reads proof. Register the verb (`reads`), `commands/decisions.md` and its parity claim.
- [x] 2.2 TDD (UNIT): the Decisions section inside `spend-analysis --epic <id>`, text and JSON, absent
      when the epic has none.
- [x] 2.3 Changeset fragment `.changesets/decision-cost-log.md`; `skills/conductor/SKILL.md` one paragraph
      on when to record a decision (postmortem self-reflection, not every choice).

## R. Required task items (CLAUDE.md "The gate procedure", items 1–7)

- [x] R.1 **Call-site completeness sweep** (item 1). `rg -n "decisions" scripts/lib` lists every reader
      and writer of `epic.decisions`; enumerate its REMOVE path (`remove-epic`) and confirm no other
      holder of a decision number exists. Inverses: append ↔ withdraw (shipped); no edit verb (justify:
      a decision is a record of what was decided; a correction is a withdrawal plus a new entry).
      Save as `call-site-sweep-R.1.txt`.
- [x] R.2 **Verify against the commit** (item 2).
- [x] R.3 **Lifecycle marker** (item 3): C.2 and C.3. (C.2 and C.3 carry the marker)
- [x] R.4 **Attribute every commit** (item 4); never the archive move.
- [x] R.5 Cross-spec review (item 5): 0.2. (by 0.2)
- [x] R.6 Disposition (item 6): C.2. (by C.2)
- [ ] R.7 **Route what the work taught you** (item 7). Record at least one real decision from this
      release's own build with `record-decision` (dogfood) and name what it showed.
      NOTE (build agent, 2026-10-20): left for the orchestrator. The dogfood `record-decision` needs a real decision from the
      release's own build and a recorded read-back; this agent did not write one into the record.
      CARRIED (2026-10-20, closeout): left unticked on purpose. A dogfood decision needs spend tracking on and a real decision with a recorded
      read-back; none was recorded. Carried to `release-0-53-0-cut` with D.1.

## G. Gate 2

- [x] G.1 **Gate 2** over `BASE..HEAD` (or the converged `rc/0.53.0` review): no stored cost, no second (converged Gate 2 recorded at 8c4b1c78)
      transcript reader, off while tracking is off, withdraw keeps the record.

## D. Docs (after Gate 2 only)

- [ ] D.1 README (the two verbs, the window, the not-causal caveat) and Mintlify, per `mintlify-doc-sync`.

## C. Close

- [x] C.1 Re-record Gate 2 after docs. (no attributed commit after the recorded Gate 2 at 8c4b1c78)
- [x] C.2 <!-- pm:lifecycle --> **Disposition.** `update-epic decision-cost-log --status archived --outcome delivered --reason "<why>" --no-deferrals`, then `/pm:status`.
- [x] C.3 <!-- pm:lifecycle --> **Archive.** `/opsx:archive decision-cost-log`. Not attributed.
