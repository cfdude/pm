# Tasks

## Commit mechanics

- **TDD.** RED then GREEN, saved as `red-<task>.txt` here, one commit naming it.
- **Rungs.** The switch, refusals, composition from in-memory entries, the snapshot diff, the warnings and
  both report forms: UNIT. `devlog.jsonl` bytes, the sentinel test, idempotent re-ingest, the clear and
  the observe-reads hook proof: FILE (temp `CLAUDE_CONFIG_DIR`).
- **Certify.** Ingest, a new module and dispatch are in both buckets' subjects: stage exactly,
  `node scripts/test/drift.mjs --phase pre-commit`, certify what it names.
- **Commits.** One conventional commit per task, explicit paths, never `--no-verify`; `git show --stat`
  (R.2) and `update-epic developer-session-log --attribute-commit <sha>` (R.4).
- **Order.** After `pm-overhead-baseline` (snapshot numbers) and `gh-cfdude-pm-251` (`work`).
- **Memory guard.** Ingest tests run over fixtures only; a scratch run over real transcripts uses a
  watchdog that exits past 4 GB peak RSS and is timed with `/usr/bin/time -l`.

## 0. Before any code

- [ ] 0.1 **Gate 1** (review `standard`) over the proposal, design, `specs/developer-session-log/spec.md`
      and this file; fix Critical and Important; `openspec validate developer-session-log --strict` (read
      the exit status); `record-gate-review developer-session-log --gate 1 --verdict pass --artifact <path>… --reviewer "<identity>"`.
- [ ] 0.2 **Cross-spec review of release 0.53.0** (item 5), release-scoped. Chokepoints: ingest and the
      spend directory (`spend-ledger`), `OPT_INS` (also grown by `feature-switches-audit`), the overhead
      computation (`pm-overhead-baseline`), `--session` vs `--session-id` (design D6), retention warnings
      here vs `spend-analysis`'s `long-context-agent` (session age and context vs agent spend).
- [ ] 0.3 **Rob's call, recorded before apply:** verbatim text capture stays out (design Non-Goals), and
      the three warning thresholds (design D5). `update-epic developer-session-log --notes "<decision>"`.

## 1. Switch and capture

- [ ] 1.1 Read one real transcript (with the memory guard) to confirm the entry shapes D2 relies on
      (`tool_use_id` to tool name, attachment and system-reminder blocks) and whether a compaction
      boundary entry exists (D5). Save the field names only, no content, as `shapes-1.1.txt`.
- [ ] 1.2 TDD (UNIT): `set-dev-log on|off`, the spend-tracking prerequisite, idempotence, the `OPT_INS`
      `devLog` row. Register the verb, `commands/set-dev-log.md` and its parity-ledger claim.
- [ ] 1.3 TDD (UNIT + FILE): the composition pass inside ingest, only while both switches are on;
      the sentinel test; idempotent re-ingest; no hook opens the file (observe-reads).
- [ ] 1.4 TDD (UNIT): the `features` snapshot from `overhead`'s per-feature `on` and bytes (never `isSet`),
      appended on change only. Add `devLog` to `pm-overhead`'s surface-to-feature map and to its
      `--all-features` hypothetical in the same commit.

## 2. Report and inverse

- [ ] 2.1 TDD (UNIT): `dev-log` per-session report joined to ledger rows, the three warnings with their
      named thresholds, the mid-session switch mark, `tokens: not in ledger`, the off message. Register
      the verb (`reads`, plus the ingest), `commands/dev-log.md` and its parity-ledger claim.
- [ ] 2.2 TDD (FILE): `dev-log --clear` plan-first and `--yes`; `set-dev-log off` keeps the file.
- [ ] 2.3 Changeset fragment `.changesets/developer-session-log.md`.

## R. Required task items (CLAUDE.md "The gate procedure", items 1–7)

- [ ] R.1 **Call-site completeness sweep** (item 1). `rg -n "spendEnabled|ingest\(" scripts/lib scripts/conductor.mjs`:
      every ingest entry point (`spend`, `spend-guard`, `override-spend-guard`, `spend-analysis`,
      `decisions`), each stated as capturing or not while the log is on. `rg -n "devlog" scripts/`: the
      single writer. Inverses: on ↔ off, append ↔ `--clear`; `spend --clear` does not remove the log
      (D3: the report degrades to `not in ledger`), justified. Save as `call-site-sweep-R.1.txt`.
- [ ] R.2 **Verify against the commit** (item 2).
- [ ] R.3 **Lifecycle marker** (item 3): C.2 and C.3.
- [ ] R.4 **Attribute every commit** (item 4); never the archive move.
- [ ] R.5 Cross-spec review (item 5): 0.2.
- [ ] R.6 Disposition (item 6): C.2.
- [ ] R.7 **Route what the work taught you** (item 7). Rob proposed a dependency; the outcome (none
      needed) is a data point for the engine's zero-dependency rule.

## G. Gate 2

- [ ] G.1 **Gate 2** over `BASE..HEAD` (or the converged `rc/0.53.0` review): off by default, no hook
      work, no text stored, one transcript reader, the clear touches only the log.

## D. Docs (after Gate 2 only)

- [ ] D.1 README (developer section: what the log records and does not) and Mintlify, per
      `mintlify-doc-sync`.

## C. Close

- [ ] C.1 Re-record Gate 2 after docs.
- [ ] C.2 <!-- pm:lifecycle --> **Disposition.** `update-epic developer-session-log --status archived --outcome delivered --reason "<why>" --declined-deferral "verbatim request/response capture:privacy and size; the ledger's never-text rule; needs Rob's explicit ask"`, then `/pm:status`.
- [ ] C.3 <!-- pm:lifecycle --> **Archive.** `/opsx:archive developer-session-log`. Not attributed.
