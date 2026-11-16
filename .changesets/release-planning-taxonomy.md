* **`board --json` reads the planning taxonomy.** New top-level `initiatives` and `missionNonGoals`; each release entry gains
  `initiative`, `maintenance`, `splitReason`, `nonGoals`, `primaryServed`, `planningBaseline`, `addedSincePlanning`,
  `unknownJoinTime` and `split` (health, initiative work and unaligned over every member in any lane, the health share against the
  fixed 20% target, and drift below 10% or above 30%); each epic entry gains `initiative`, `initiativeJoinedAt`,
  `secondaryInitiatives`, `kind`, `effectiveKind`, `releaseJoinedAt`, both challenge reasons and `nonGoals`. Every key is additive, so
  `schemaVersion` stays 1, and a 0.55.0 state file reads them as `null` or `[]`. A hand-edited initiative id that fails the id format
  is omitted and listed in `rejected` (kind `initiative`).
* **New verb `initiative`, and a non-goal on four records.** `initiative <id> --title --capability` records a multi-release effort
  (`--source`, `--off-mission-reason`, initiative milestones with `--reach-milestone "mN:<evidence>"`, `--end --outcome
  delivered|abandoned|superseded --reason`, `--reopen`, `initiative show [<id>] [--history]`); it is never deleted. `integrity`
  gains `dangling-initiative-reference`. `--add-non-goal "<line>"` (repeatable) and `--remove-non-goal "nN:<why>"` (marks it, keeps
  it) work on `mission`, `initiative`, `release`, `add-epic` and `update-epic`, and `add-many` reads a `nonGoals` array; ids are
  per record (`n1`, `n2`, ...) and never reused. A milestone carries none.
* **Release purpose and the 80/20 report.** `release <id> --initiative <id>` names the release's primary initiative, `--maintenance`
  declares that it serves none (each replaces the other; `--clear-initiative` removes either), and `--split-reason "<line>"` records
  why it departs from 80/20 (`--clear-split-reason`); the goal is the existing `theme`. Every member in any lane is counted once as
  health, initiative work or unaligned, the health share is checked against the fixed 20% target with drift below 10% or above 30%,
  and `release show` prints the purpose, the split and a warning when no member serves the primary. `release --member` records
  `releaseJoinedAt` (kept on a repeat, replaced by a move, removed by `--unmember` and `--defer`) and `release show` reports the epics
  added since the first member started. The commit nudge names the per-release `maintenance-<releaseId>` epic when an untied commit
  lands while the active epic is a release member.
* **Epic planning fields and the challenge.** `add-epic`, `update-epic` and `add-many` take `--initiative` (stamping
  `initiativeJoinedAt`), `--secondary-initiative` (inverse `--remove-secondary-initiative`), `--kind initiative-work|health`,
  `--off-mission-reason` and `--off-initiative-reason`, each scalar cleared with `--clear <field>`. While an initiative is open, an
  epic leaving `untriaged` with no kind, no initiative and no recorded reason gets one stderr warning (never a refusal;
  `claude-code` epics are exempt), and `release --member` warns once for an epic not serving the release's primary.
* **Two new rules-block sections.** `## Initiatives` (at most 280 bytes, 254 measured, present while an initiative is open) and
  `## Mission non-goals` (at most 200 bytes, present while the mission has a non-goal). Both are `core` in `overhead`
  (`rules:initiatives`, `rules:mission-non-goals`); on 2026-11-12 this repo's core was 40280 bytes, so the first adds at most 0.6%
  and the second at most 0.5% while their data exists, and neither costs anything otherwise.
