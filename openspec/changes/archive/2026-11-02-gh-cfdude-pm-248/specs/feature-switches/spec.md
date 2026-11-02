## MODIFIED Requirements

### Requirement: Every surface in the overhead map has a costed row and a switch decision

The README SHALL carry a "What each feature costs" table with one row per surface id in `pm-overhead`'s
map, except that every `listing:` surface is one `listings` row: its feature id, its estimated per-session
cost from `overhead --all-features` labelled an estimate, and the verb that switches its feature or
`no switch` with a reason. A surface that `overhead --all-features` never produces, because it is emitted
only while a feature is UNUSED (the rules block's `rules:procedures-emitted-on-use`), SHALL instead take
its cost from `overhead` in a freshly initialised repo, and its row SHALL say so. A test SHALL fail when
the table and the map disagree.

#### Scenario: A surface missing from the table fails

- **WHEN** the map holds a surface id the README table has no row for
- **THEN** the assertion test fails, naming the id

#### Scenario: A table row for an unknown surface fails

- **WHEN** the README table names a surface id the map does not hold
- **THEN** the assertion test fails, naming the id

#### Scenario: The listings are reported as not switchable

- **WHEN** the table's `listings` row is read
- **THEN** it says `no switch` because the plugin's files are read by the host, not emitted by the engine

#### Scenario: The pointer row names where its cost came from

- **WHEN** the table's `rules:procedures-emitted-on-use` row is read
- **THEN** it carries a token estimate and says the figure is from a fresh repo, not from `--all-features`
