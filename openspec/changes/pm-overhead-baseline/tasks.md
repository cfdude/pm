# Tasks

## Commit mechanics

- **TDD.** RED then GREEN, saved as `red-<task>.txt` here, one commit naming it.
- **Rungs.** Surface sizes, the feature map, subtotals, the hypothetical state and both output forms are
  values computed in memory: UNIT. Byte-identity of `state.json`/`CLAUDE.md`/`.conductor/` after
  `--all-features`, the listing sizes read from plugin files, and the observe-reads proof: FILE.
- **Certify.** New `scripts/lib` module and dispatch: stage exactly, `node scripts/test/drift.mjs --phase pre-commit`,
  certify what it names.
- **Commits.** One conventional commit per task, explicit paths, never `--no-verify`; `git show --stat`
  (R.2) and `update-epic pm-overhead-baseline --attribute-commit <sha>` (R.4).
- **Order.** Before `feature-switches-audit` and `developer-session-log`, which read the map.
- **Measurement hygiene** (sections 3 and 4): time every run and record peak memory with
  `/usr/bin/time -l`; guard scratch scripts with a watchdog that exits past 4 GB peak RSS; never relaunch
  a process someone killed. Every number in a measurement doc carries its method, n and machine state.

## 0. Before any code

- [ ] 0.1 **Gate 1** (review `standard`) over the proposal, design, `specs/pm-overhead/spec.md` and this
      file; fix Critical and Important; `openspec validate pm-overhead-baseline --strict` (read the exit
      status); `record-gate-review pm-overhead-baseline --gate 1 --verdict pass --artifact <path>… --reviewer "<identity>"`.
- [ ] 0.2 **Cross-spec review of release 0.53.0** (item 5), release-scoped. Chokepoints: the
      surface-to-feature map (read by `feature-switches-audit` and `developer-session-log`), `OPT_INS`
      (grown by `developer-session-log` and possibly `feature-switches-audit`), `rules --sections`.
- [ ] 0.3 **Rob's go, recorded before 3.2:** the calibration runs headless Claude Code sessions (real
      token use, n=3 with pm enabled and n=3 disabled). `update-epic pm-overhead-baseline --notes "<decision>"`.

## 1. The verb

- [x] 1.1 TDD (UNIT): the surface enumerator from builders and files (design D1): rules sections equal
      `rules --sections`, the brief, the snapshot, each hook verb's output for the current state, listings.
- [x] 1.2 TDD (UNIT): the surface-to-feature map beside `OPT_INS` (design D2) and the test failing on an
      unassigned or doubly assigned surface; per-feature subtotals and `on`.
- [x] 1.3 TDD (UNIT): conditional surfaces (design D3) and the unconditional session total.
- [x] 1.4 TDD (UNIT + FILE): `--all-features` over the named hypothetical (design D4), byte-identical
      files afterwards.
- [x] 1.5 TDD (UNIT): labels (design D6) and the downstream line naming `spend-analysis` and no `docs/` path;
      spend tracking's marker line as a per-dispatch cost (design D5).
- [x] 1.6 TDD (FILE): observe-reads proves no spend or transcript path is opened, tracking on and off.
      Register the verb (`reads`), `USAGE`, `commands/overhead.md` and its parity-ledger claim.
- [x] 1.7 Changeset fragment `.changesets/pm-overhead-baseline.md`.

## 2. Baseline

- [x] 2.1 Run `overhead` and `overhead --all-features` in this repository and in one fleet repo with
      default opt-ins; record both under `docs/measurement/2026-10-pm-overhead-baseline.md` with the
      commit, state and date.

## 3. Calibration and the downstream question

- [x] 3.1 Write the calibration protocol in the same doc: a fixture directory isolated from user memory
      (`claudeMdExcludes` and `autoMemoryEnabled` set in the fixture, per the project memory note on
      headless evals), pm enabled vs disabled, n=3 each, measuring the first assistant message's
      `input + cacheCreation` from its transcript.
- [ ] 3.2 After 0.3, run it; record the measured pm delta and the measured-to-estimate ratio against
      2.1's bytes/4 figure. If 0.3 is declined, record that and leave the verb's label as an estimate.
- [x] 3.3 The downstream section: state what the ledger can show (spend per epic by phase, review rounds,
      `spend-analysis` flags) and that no counterfactual (the same work without pm) has been measured;
      propose an A/B protocol with its expected token cost for Rob to approve. Every figure is
      conditional and sourced; no saving is claimed.

## 4. Re-baseline story — gates `store-owns-claude-md-managed-block`

- [x] 4.1 (MACHINE NOT QUIET: load 6-16, other sessions open; recorded in the doc, rerun owed) On a quiet machine (no agents running; load recorded), run the assertion half
      (`node --test scripts/test/unit/*.test.mjs scripts/test/assert/*.test.mjs`) n=3 plus an
      empty-preload control, as in the 2026-09-25 profile (epic note on `store-owns-claude-md-managed-block`).
      Record wall time per rung and the summed time of file-rung tests that reach init's `CLAUDE.md` or
      `.gitignore` write, method stated (how a test is classified as reaching the write).
- [x] 4.2 Record the outcome in `docs/measurement/2026-10-commit-gate-rebaseline.md` against the 10 s gate,
      labelled a proposal: build if the disk-write tests carry 10 s or more of the file rung, else
      recommend decline or defer with the numbers. Report it so the orchestrator records it on
      `store-owns-claude-md-managed-block` (this change writes no state); it is decided at 0.54.0 grooming.

## R. Required task items (CLAUDE.md "The gate procedure", items 1–7)

- [x] R.1 **Call-site completeness sweep** (item 1). `rg -n "OPT_INS" scripts/lib`: every reader of the
      registry, and confirm the surface map is read by every consumer that needs a feature id.
      `rg -n "\"command\":" hooks/hooks.json` and the `## ` headings of `rulesBlock()`'s output: every
      surface source is enumerated by 1.1. Inverse: a read-only verb; none owed. Save as
      `call-site-sweep-R.1.txt`.
- [x] R.2 **Verify against the commit** (item 2).
- [ ] R.3 **Lifecycle marker** (item 3): C.2 and C.3.
- [x] R.4 **Attribute every commit** (item 4), including the measurement-doc commits; never the archive move.
- [ ] R.5 Cross-spec review (item 5): 0.2.
- [ ] R.6 Disposition (item 6): C.2.
- [ ] R.7 **Route what the work taught you** (item 7). The assertion half went from 15.4 s to ~28 s
      between two measurements under different load; whether that is load or growth is itself a finding.

## G. Gate 2

- [ ] G.1 **Gate 2** over `BASE..HEAD` (or the converged `rc/0.53.0` review): enumerated not listed, one
      feature per surface, labels on every figure, no write from `--all-features`, no saving claimed.

## D. Docs (after Gate 2 only)

- [ ] D.1 README "What pm costs a session" with the 2.1 numbers and the method; Mintlify, per
      `mintlify-doc-sync`.

## C. Close

- [ ] C.1 Re-record Gate 2 after docs.
- [ ] C.2 <!-- pm:lifecycle --> **Disposition.** `update-epic pm-overhead-baseline --status archived --outcome delivered --reason "<why>"` with `--no-deferrals`, or, if 3.2's calibration or 3.3's A/B run is not done, `--declined-deferral "<what>:<why>"` or `--deferral "<epicId>:<section>"` for a registered epic; then `/pm:status`.
- [ ] C.3 <!-- pm:lifecycle --> **Archive.** `/opsx:archive pm-overhead-baseline`. Not attributed.
