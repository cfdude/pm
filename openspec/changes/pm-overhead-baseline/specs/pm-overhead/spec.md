## Purpose

Measure what pm itself injects into every session, surface by surface and feature by feature, with
every number labelled by its method, so feature switches and budgets are decided on numbers.

## ADDED Requirements

### Requirement: overhead reports every injected surface with its bytes and a labelled estimate

`overhead [--json] [--all-features]` SHALL report each surface pm injects: each managed rules section,
the SessionStart brief, the PreCompact snapshot, each hook's output, and the command, skill and agent
descriptions the plugin ships. Each SHALL carry its bytes and `~N tokens (bytes/4, estimate)`. Surfaces
SHALL be enumerated from their builders and files, never from a typed list.

#### Scenario: The rules block matches rules --sections

- **WHEN** `overhead` and `rules --sections` run on the same state
- **THEN** every rules-section surface's bytes equal the bytes `rules --sections` reports for it

#### Scenario: A new section appears without a code change to the verb

- **WHEN** a fixture rules block gains a section
- **THEN** `overhead` lists it as a surface

#### Scenario: Every figure is labelled

- **WHEN** `overhead` prints its text report
- **THEN** every token figure is followed by `(bytes/4, estimate)`
- **AND** `--json` carries `bytes`, `estimatedTokens` and `method: "bytes/4"` per surface

#### Scenario: Conditional surfaces are marked and kept out of the session total

- **WHEN** `overhead` reports the `lesson-advice` hook
- **THEN** it is marked conditional with its size when it fires
- **AND** the per-session total counts only unconditional surfaces and says so

### Requirement: Each surface is attributed to exactly one feature

Every surface SHALL carry exactly one feature id: `core`, `listings` (every command, skill and agent
description the plugin ships, which the host reads whatever is on), or an `OPT_INS` id. The map SHALL be
declared beside `OPT_INS`; `overhead` SHALL report per-feature subtotals and `on`. A feature that is off
SHALL report 0 bytes.

#### Scenario: A surface with no feature fails

- **WHEN** a surface is produced that the map does not assign
- **THEN** the assertion test over the map fails, naming the surface

#### Scenario: Listings belong to their own feature

- **WHEN** `overhead --json` runs with spend tracking off
- **THEN** the descriptions of `commands/spend.md` and every other shipped command, skill and agent are counted under `features.listings`
- **AND** `features.spendTracking` reports 0 bytes and no per-dispatch marker cost

#### Scenario: Per-feature subtotals

- **WHEN** `overhead --json` runs
- **THEN** `features.<id>` holds `on`, `bytes`, `estimatedTokens` and the list of its surfaces

#### Scenario: Spend tracking's own cost is visible

- **WHEN** tracking is on and a limit is configured
- **THEN** `features.spendTracking` and `features.spendGuard` hold their rules sections
- **AND** `features.spendTracking` reports the per-dispatch marker line's bytes as a per-dispatch cost

### Requirement: --all-features computes the every-feature-on case without writing

`overhead --all-features` SHALL compute the same report over a named in-memory hypothetical state in
which every opt-in is on, and SHALL name that hypothetical in its output. It SHALL write nothing.

#### Scenario: Nothing is written

- **WHEN** `overhead --all-features` runs in a repo with every opt-in off
- **THEN** `state.json`, `CLAUDE.md` and every file under `.conductor/` are byte-identical to before
- **AND** every feature reports `on: true` under the hypothetical, with the hypothetical named

#### Scenario: The delta per feature is shown

- **WHEN** `overhead --all-features` runs in a repo with only `reviewMode` set
- **THEN** each feature off in the real state is reported with the bytes it would add

### Requirement: overhead reads no transcript, ledger or network and works with tracking off

`overhead` SHALL open no path under the spend directory or the transcript directory, open no network
connection, and write nothing. It SHALL run with spend tracking on or off.

#### Scenario: Tracking off

- **WHEN** tracking is off and `overhead` runs
- **THEN** it exits 0 with the full report
- **AND** no path under the spend directory or the transcript directory is opened

### Requirement: overhead never claims a downstream saving

`overhead` SHALL print that downstream efficiency is not measured by this verb and point to
`spend-analysis` for measured spend. It SHALL print no figure for a saving, and SHALL name no file that
exists only in pm's own repository.

#### Scenario: The downstream line

- **WHEN** `overhead` prints its text report
- **THEN** it contains `downstream efficiency: not measured by this verb`
- **AND** it names `spend-analysis`, and no path under `docs/`
