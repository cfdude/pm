## ADDED Requirements

### Requirement: Primary tracker configuration
`set-tracker` with `--role primary` (the default when `--role` is omitted) SHALL write/merge
`state.tracker`, exactly matching today's pre-existing behavior. This MUST remain the sole
tracker a repo had before this change existed, formalized under the `primary` role name.

#### Scenario: Setting a tracker without --role
- **WHEN** the agent runs `set-tracker --system jira --instance onvex --project JOB --mechanism
  mcp --intent active:in-progress`
- **THEN** `state.tracker` is written/merged with those fields, `state.secondaryTrackers` is
  untouched, and the rules block gains the full bidirectional "External tracker sync" section for
  `jira`

#### Scenario: Re-running set-tracker for the primary merges, not replaces
- **WHEN** the agent runs `set-tracker --intent paused:todo` after a primary tracker already
  exists
- **THEN** only the `statusIntent` map gains the new entry; every other existing field on
  `state.tracker` is preserved unchanged

#### Scenario: github-issues as primary keeps its existing inward-only special case
- **WHEN** `state.tracker.system === "github-issues"` (set via `--role primary` or omitted role)
- **THEN** the outward "External tracker sync" section is suppressed exactly as before this
  change, and only the pull-only "GitHub issue sync" instructions are emitted for the primary slot

### Requirement: Secondary tracker registration
`set-tracker --role secondary` SHALL upsert an entry into `state.secondaryTrackers`, keyed by a
namespace-prefixed key (`system + ":repo:" + repo`, or `system + ":project:" + projectKey` when
no `repo` is given), and MUST NOT write to `state.tracker`.

#### Scenario: Adding a secondary tracker
- **WHEN** the agent runs `set-tracker --system github-issues --repo acme/market-intelligence
  --role secondary`
- **THEN** a new entry `{ system: "github-issues", repo: "acme/market-intelligence", role:
  "secondary" }` is appended to `state.secondaryTrackers`, and `state.tracker` is unchanged

#### Scenario: Re-adding the same secondary tracker merges in place
- **WHEN** the agent runs `set-tracker --role secondary` a second time with the same `system` and
  `repo` as an existing secondary entry
- **THEN** the existing entry is updated in place (only the passed flags change) and no duplicate
  entry is created

#### Scenario: Multiple distinct secondary trackers coexist
- **WHEN** the agent registers two secondary trackers with different `repo` values (e.g.
  `acme/market-intelligence` and `acme/risk-engine`), both under `system: "github-issues"`
- **THEN** both entries persist independently in `state.secondaryTrackers`

#### Scenario: A repo-keyed and a projectKey-keyed entry with the same string value do not collide
- **WHEN** the agent registers a secondary entry `{ system: "jira", projectKey: "ABC" }` and
  separately a secondary entry `{ system: "jira", repo: "ABC" }`
- **THEN** both entries persist independently in `state.secondaryTrackers` (namespace-prefixed
  keys `jira:project:ABC` and `jira:repo:ABC` do not collide)

### Requirement: Secondary trackers never receive outward-created issues
No local epic creation or status change SHALL cause the agent to create or transition an issue in
a secondary tracker. Outward mirroring MUST remain exclusive to the primary tracker.

#### Scenario: New local epic does not touch a secondary tracker
- **WHEN** a new epic is added via `add-epic` in a repo that has a secondary tracker configured
- **THEN** the rules block's instructions for that secondary tracker contain no outward
  issue-creation step, regardless of the epic's lane or status

### Requirement: Secondary tracker inward pull
Open issues in a secondary tracker SHALL be pulled in as untriaged epics. Deduplication SHALL
match on `externalUrl` (globally unique across every system and repo) when both the incoming
issue and an existing epic have one; MUST NOT match on bare `externalId` alone whenever a URL is
available on both sides, since issue numbers are only unique within one tracker/repo, not
globally.

#### Scenario: Open secondary-tracker issue becomes an untriaged epic
- **WHEN** the agent runs the sync step for a secondary tracker and finds an open issue whose URL
  does not match any existing epic's `externalUrl`
- **THEN** the agent registers a new epic via `add-epic --status untriaged --external-id <n>
  --external-url <url> --lane claude-code --priority P2` (or the issue's priority label if
  present), titled from the issue title

#### Scenario: Re-running sync does not duplicate an already-mirrored issue
- **WHEN** the agent re-runs the secondary-tracker sync step and an epic with that issue's
  `externalUrl` already exists
- **THEN** no new epic is created for that issue

#### Scenario: Issue #42 in two different secondary-tracker repos does not collide
- **WHEN** two secondary trackers (`acme/market-intelligence` and `acme/risk-engine`, both
  `system: "github-issues"`) each have an open issue numbered `#42`
- **THEN** syncing both trackers registers two distinct epics — `externalId` alone is not used to
  detect a false duplicate, because `externalUrl` differs between them

### Requirement: Secondary tracker completion status writeback
When an epic whose `externalUrl` matches a secondary tracker's `repo` (or `instance`+
`projectKey` for non-GitHub systems) reaches a terminal status, the agent SHALL close/transition
the corresponding issue in that secondary tracker. No new epic-level field records tracker
origin — matching is done by inspecting the epic's existing `externalUrl` against each configured
secondary tracker's `repo`/`instance`+`projectKey` at instruction time.

#### Scenario: Archiving an epic linked to a secondary tracker's issue
- **WHEN** an epic with an `externalUrl` matching a configured secondary tracker's `repo`
  transitions to `status: "archived"`
- **THEN** the rules block instructs the agent to close/transition the linked issue in that
  secondary tracker, checking its current state first so a re-run does not error on an
  already-closed issue

#### Scenario: Archiving an epic linked to the primary tracker is unaffected
- **WHEN** an epic with an `externalId`/`externalUrl` sourced from the primary tracker transitions
  to `status: "archived"`
- **THEN** the existing primary `statusIntent`-driven transition instructions apply, unchanged by
  this capability

### Requirement: Removing a secondary tracker
A secondary tracker entry SHALL be removable, explicitly and individually, without affecting the
primary tracker or other secondary entries.

#### Scenario: Removing a stale secondary tracker
- **WHEN** the agent runs `set-tracker --role secondary --system github-issues --repo
  acme/decommissioned-repo --remove`
- **THEN** the matching entry is deleted from `state.secondaryTrackers`, and both `state.tracker`
  and any other secondary entries are unaffected

#### Scenario: Removing a secondary tracker that doesn't exist
- **WHEN** the agent runs `set-tracker --role secondary --system github-issues --repo
  acme/never-registered --remove`
- **THEN** the command exits non-zero with a clear "no matching secondary tracker" message, and
  `state.secondaryTrackers` is left unchanged

### Requirement: Backward compatibility with pre-existing state
A `state.json` written before this change (no `secondaryTrackers` field) SHALL remain fully valid
and MUST NOT require any data migration.

#### Scenario: Loading a state.json without secondaryTrackers
- **WHEN** the engine reads a `state.json` that has `tracker` but no `secondaryTrackers` field
- **THEN** it is treated as zero secondary trackers configured, and every existing primary-tracker
  behavior functions exactly as before this change
