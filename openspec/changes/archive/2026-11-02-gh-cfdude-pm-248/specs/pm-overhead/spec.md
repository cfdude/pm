## MODIFIED Requirements

### Requirement: --all-features computes the every-feature-on case without writing

`overhead --all-features` SHALL compute the same report over a named in-memory hypothetical state in
which every opt-in is on, and SHALL name that hypothetical in its output. It SHALL write nothing. The
hypothetical's rules block SHALL be rendered with every usage answer true, so `## Epic-level autonomy`
and `## Release candidate` are counted (feature `core`) without adding any epic or release to the
hypothetical state. The pointer `## Procedures emitted on use` is therefore absent from it.

#### Scenario: Nothing is written

- **WHEN** `overhead --all-features` runs in a repo with every opt-in off
- **THEN** `state.json`, `CLAUDE.md` and every file under `.conductor/` are byte-identical to before
- **AND** every feature reports `on: true` under the hypothetical, with the hypothetical named

#### Scenario: The delta per feature is shown

- **WHEN** `overhead --all-features` runs in a repo with only `reviewMode` set
- **THEN** each feature off in the real state is reported with the bytes it would add

#### Scenario: Usage-conditioned sections are counted under the hypothetical

- **WHEN** `overhead --all-features --json` runs in a fresh repo
- **THEN** `surfaces` lists `rules:epic-level-autonomy` and `rules:release-candidate`, each with feature `core`, and does not list `rules:procedures-emitted-on-use`
- **AND** the brief surface's bytes equal those of the same hypothetical before this change

#### Scenario: The real report reads the repo's usage

- **WHEN** `overhead --json` runs in a fresh repo
- **THEN** `surfaces` lists neither `rules:epic-level-autonomy` nor `rules:release-candidate`
- **AND** it lists `rules:procedures-emitted-on-use` with feature `core`
