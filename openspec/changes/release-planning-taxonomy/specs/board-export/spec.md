## MODIFIED Requirements

### Requirement: rejected entries have one shape and a closed reason list

Every `rejected` entry SHALL be `{kind, id, field, value, reason}`. `kind` is one of `epic`, `release`, `link`, `url`, `plan`, `milestone`, `initiative` or
`project`. `id` is the record concerned (escaped) or `null`; `value` is the offending value, escaped. `reason` is one of `id format`, `dangling depends-on`,
`url scheme`, `here names no release`, `milestone names no release` or `project format`. A field SHALL yield at most one entry, and no
other spec SHALL add a reason without adding it here.

#### Scenario: Id format wins

- **WHEN** `plan.here` holds a value that fails the id format and also names no release
- **THEN** `rejected` holds one entry for `plan.here`, with reason `id format`

#### Scenario: Every entry carries all five keys

- **WHEN** a fixture produces one rejection of each reason
- **THEN** `rejected` holds six entries, each with exactly the keys `kind`, `id`, `field`, `value` and `reason`

#### Scenario: An initiative can be rejected

- **WHEN** a hand-edited initiative id fails the board id format
- **THEN** `rejected` holds one entry of kind `initiative` with reason `id format`

### Requirement: Every emitted id passes the board id format

Every record id and id reference the snapshot emits SHALL match `/^[A-Za-z0-9._-]+$/`: epic, release and member ids, `dependsOn` targets, an
epic's `release`, `plan.here`, `milestone.release`, criterion ids, initiative ids, initiative milestone ids and the three
initiative references (`epic.initiative`, `epic.secondaryInitiatives[]`, `release.initiative`). A record with a failing id SHALL be omitted; a
failing reference SHALL become `null` or leave its list. Each failure SHALL appear in `rejected` with
reason `id format`, control characters escaped, and the verb SHALL still exit 0. A failing initiative milestone id is rejected under kind `initiative`, field `milestones.id`, never under kind `milestone`, which belongs to mission milestones.
Non-goal ids (`nonGoals[].id`, `missionNonGoals[].id`) are outside this rule: the engine mints them as `nN` and never reads one from input, so none is validated or rejected.

#### Scenario: A malformed epic id is excluded and named

- **WHEN** the state holds an epic whose id is `a"><img src=x>` alongside a valid epic
- **THEN** `epics` holds only the valid epic, `rejected` holds one entry of kind `epic` with reason `id format`, and the exit code is 0

#### Scenario: A malformed reference is nulled

- **WHEN** a valid epic's `release` is `r1"><b>` and `plan.here` holds the same value
- **THEN** that epic's `release` and `plan.here` are `null`, and `rejected` names both fields

#### Scenario: A malformed release member is excluded

- **WHEN** a release's derived members include an id that fails the format
- **THEN** that id is absent from the release's `members` and is listed in `rejected`

#### Scenario: A malformed initiative id is excluded and named

- **WHEN** an initiative's id is `Bad Id` and an epic's `initiative` holds the same value
- **THEN** `initiatives` omits it, that epic's `initiative` is `null`, and `rejected` names both with reason `id format`

#### Scenario: A malformed initiative milestone id is not a mission milestone rejection

- **WHEN** an initiative holds a milestone whose id is `bad id`
- **THEN** that milestone is omitted and `rejected` holds one entry of kind `initiative`, field `milestones.id`, reason `id format`, and none of kind `milestone`
