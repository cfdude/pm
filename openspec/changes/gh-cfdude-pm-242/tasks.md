# Tasks

## Commit mechanics

- **TDD.** Every behaviour task is RED then GREEN. The pre-commit hook runs the whole assertion half, so
  save the failing run as `red-<task>.txt` in this directory and land RED and GREEN in ONE commit whose
  message names that file.
- **Rungs** (`.claude/agent-startup.md`, the rung table): the invalid-marker grouping and both report
  forms are values over in-memory rows, so UNIT (`scripts/test/unit/`).
- **Certify.** `spend-attribution.mjs` and `spend-report.mjs` are under `scripts/lib`, so stage exactly,
  run `node scripts/test/drift.mjs --phase pre-commit`, certify every bucket it names, then commit.
- **Commits.** One conventional commit per task, explicit `git add` paths, never `--no-verify`. After
  each: `git show --stat <sha>` (R.2) and `update-epic gh-cfdude-pm-242 --attribute-commit <sha>` (R.4).

## 0. Before any code

- [ ] 0.1 **Gate 1** (review `standard`, one fresh-context reviewer) over `proposal.md`, `design.md`,
      `specs/spend-ledger/spec.md` and this file. Fix Critical and Important findings, re-run
      `openspec validate gh-cfdude-pm-242 --strict` (read its exit status; never pipe it through
      `tail`), then `record-gate-review gh-cfdude-pm-242 --gate 1 --verdict pass --artifact <path>… --reviewer "<identity>"`.
- [ ] 0.2 **Cross-spec review of release 0.53.0** (required item 5) is release-scoped and covers this
      change's spec. Do not apply before `release show 0.53.0` shows a current passing verdict.

## 1. The invalid-marker report

- [x] 1.1 TDD (UNIT): make `resolveMarker()`'s validity check return the first failing field (`role`, `phase`, `round`)
      and the rejected value, reading the accepted sets from `KNOWN_JOB_ROLES` and `KNOWN_SPEND_PHASES`
      (design D2). Every existing attribution test stays green; the `reason` stays `invalid-marker`.
- [x] 1.2 TDD (UNIT): group invalid markers by `(field, value)` into `unattributed.invalidMarkers`
      (`field`, `value`, `accepted`, `agents`, `totals`); empty array on a clean ledger. Cover every
      scenario in the spec, including "No alias is accepted".
- [x] 1.3 TDD (UNIT): the text line `invalid pm-spend marker: <field> "<value>" is not one of <set> — <n> agents, <t> tokens`,
      values through `escapeControls`, truncated at 64 characters with the truncation marked (design
      Risks). No line on a clean ledger.
- [x] 1.4 `commands/spend.md`: document the line and the JSON key; changeset fragment
      `.changesets/gh-cfdude-pm-242.md`. Verify `node scripts/conductor.mjs changesets` lists it.

## R. Required task items (CLAUDE.md "The gate procedure", items 1–7)

- [x] R.1 **Call-site completeness sweep** (item 1). `rg -n "invalid-marker" scripts/ commands/ skills/`
      and `rg -n "KNOWN_SPEND_PHASES|KNOWN_JOB_ROLES" scripts/lib`: list every place the reason is
      produced, counted or printed (`spend`, `spend-guard`'s ledger-side rounds, `integrity` if it reads
      it) and state for each whether it now names the value, with the justification where it does not.
      Inverse: this change adds a report section, not a write; state that no inverse is owed.
- [x] R.2 **Verify against the commit** (item 2). For every task, `git show --stat <sha>` and assert every
      claimed file is in THAT commit.
- [ ] R.3 **Lifecycle marker** (item 3). `rg -n "pm:lifecycle" <this file>` lists C.2 and C.3.
- [x] R.4 **Attribute every commit** (item 4), in landing order. Never the archive move (C.3).
- [ ] R.5 Cross-spec review (item 5). Satisfied by 0.2.
- [ ] R.6 Disposition (item 6). Satisfied by C.2.
- [ ] R.7 **Route what the work taught you** (item 7): practice, tooling friction or process failure,
      each named with its evidence. "None" says what was looked at.

## G. Gate 2

- [ ] G.1 **Gate 2** over the full `BASE..HEAD` diff (or the converged `rc/0.53.0` review): spec
      alignment, tests passing, the accepted set read from the constants, strictness unchanged. Record
      with `--base-sha`/`--head-sha` where the head reaches every attributed commit.

## D. Docs (after Gate 2 only)

- [ ] D.1 README and Mintlify only if they describe the `spend` unattributed section; otherwise state
      "internal to `commands/spend.md`" in the closeout.

## C. Close

- [ ] C.1 Re-record Gate 2 after docs if a docs commit was attributed. Re-record, never withdraw.
- [ ] C.2 <!-- pm:lifecycle --> **Disposition.** `update-epic gh-cfdude-pm-242 --status archived --outcome delivered --reason "<why>" --no-deferrals`, then `/pm:status`.
- [ ] C.3 <!-- pm:lifecycle --> **Archive.** `/opsx:archive gh-cfdude-pm-242`. The archive-move commit is NOT attributed.
