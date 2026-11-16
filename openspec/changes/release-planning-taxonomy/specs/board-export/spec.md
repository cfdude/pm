## MODIFIED Requirements

### Requirement: rejected entries have one shape and a closed reason list

Every `rejected` entry SHALL be `{kind, id, field, value, reason}`. `kind` is one of `epic`, `release`, `link`, `url`, `plan`, `milestone`, `initiative`, `mission` or `project`; `id` is the escaped record id or `null`; `value` is the escaped offending value. `reason` is one of `id format`, `dangling depends-on`, `url scheme`, `here names no release`, `milestone names no release` or `project format`. A field SHALL yield at most one entry; no other spec SHALL add a reason.

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

Every id and id reference the snapshot emits SHALL match `/^[A-Za-z0-9._-]+$/`: epic, release, member, criterion, initiative, initiative milestone and non-goal ids (`nonGoals[].id`, `missionNonGoals[].id`), `dependsOn` targets, `epic.release`, `plan.here`, `milestone.release` and the initiative references. A failing record SHALL be omitted and a failing reference SHALL become `null` or leave its list; each SHALL appear in `rejected` with reason `id format`, and the verb SHALL exit 0.

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

#### Scenario: A malformed initiative non-goal id is excluded and named

- **WHEN** an initiative holds a non-goal whose id is `n 1` and another whose id is `n2`
- **THEN** that initiative's `nonGoals` holds only `n2`, and `rejected` holds one entry of kind `initiative`, field `nonGoals.id`, reason `id format`

#### Scenario: A malformed release non-goal id is excluded and named

- **WHEN** a release holds a non-goal whose id is `n 1`
- **THEN** that release's `nonGoals` omits it, and `rejected` holds one entry of kind `release`, field `nonGoals.id`, reason `id format`

#### Scenario: A malformed epic non-goal id is excluded and named

- **WHEN** an epic holds a non-goal whose id is `n 1`
- **THEN** that epic's `nonGoals` omits it, and `rejected` holds one entry of kind `epic`, field `nonGoals.id`, reason `id format`

#### Scenario: A malformed mission non-goal id is excluded and named

- **WHEN** the mission holds a non-goal whose id is `n 1`
- **THEN** `missionNonGoals` omits it, and `rejected` holds one entry of kind `mission`, field `missionNonGoals.id`, id `null`, reason `id format`
