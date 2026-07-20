## Context

`state.tracker` is a single object (`{ system, instance, projectKey, mechanism, statusIntent }`)
consumed by `currentTracker()` and rendered into CLAUDE.md's rules block by `rulesBlock()`
(`scripts/conductor.mjs`). Two behaviors exist today, keyed entirely off `tracker.system`:

- Any system except `github-issues`: full bidirectional mirror (outward issue creation on new
  epics, `statusIntent`-driven transitions on status change) — see the `"## External tracker
  sync"` block.
- `system === "github-issues"`: the outward block above is *suppressed entirely* and a
  pull-only `"## GitHub issue sync"` block runs instead (open issues → untriaged epics). This was
  a deliberate 0.16.0 fix: auto-filing a public GitHub issue for every local epic is a much
  bigger, more consequential default than mirroring toward an internal Jira/Linear instance.

There is exactly one tracker slot. Configuring a second tracker overwrites the first — a repo
cannot have Jira as its real dev tracker *and* watch a GitHub repo for inbound issues (e.g. from
outside contributors, or from another internal repo publishing cross-project notifications, as
surfaced by the Market Intelligence → finance-platform brainstorm this change originated from).

The engine itself never calls a tracker (`conductor.mjs` has zero network/exec dependencies) —
`rulesBlock()` only shapes markdown instructions that the interactive agent (Claude Code) then
acts on with its own tooling (MCP, `gh`, `jira-cli`, …). That boundary is unchanged by this
design.

## Goals / Non-Goals

**Goals:**
- Let a repo configure one primary tracker (today's full bidirectional behavior, unchanged) plus
  zero or more secondary trackers (inward pull + a new completion-status writeback, never
  outward creation).
- Zero behavior change for every repo that has only ever called `set-tracker` without `--role`
  (implicit `primary`) — including repos whose primary is `github-issues` today, which must keep
  its current pull-only behavior unless *explicitly* reconfigured.
- Make "inward pull, no outward creation" a role-based property (`secondary`), not a
  system-based special case hardcoded to `github-issues` — any system can now be a secondary
  tracker (a repo could have Jira primary + a *second* Jira project as a secondary inbox, for
  example), while `github-issues`-as-primary keeps its existing special-cased pull-only behavior
  for backward compatibility.
- Add status writeback for secondary trackers: when an epic whose `externalId` came from a
  secondary tracker reaches `archived`, instruct the agent to close/transition that issue too.

**Non-Goals:**
- No full `statusIntent` map for secondary trackers (active/paused/etc.) — secondary issues only
  ever need one terminal transition (closed on archive); the richer per-status intent mapping
  stays a primary-only concept.
- No promotion/demotion between primary and secondary roles for an already-configured tracker in
  this change — role changes are a delete-and-recreate operation for now (open question below).
- No engine-side verification that a secondary issue was actually closed — exactly like today's
  primary status-intent sync, the engine has no way to observe real tracker state; this remains
  entirely an agent-instruction concern, not a regression.
- No change to how OpenSpec/Superpowers on-disk sync (`/pm:sync`'s other half) works.

## Decisions

**1. `state.tracker` is untouched; role is structural, not a new field on it.**
Alternative considered: add `role: "primary"` to the existing `tracker` object for symmetry with
`secondaryTrackers[].role`. Rejected — it adds a field every existing `state.json` lacks for no
behavioral gain (primary is *defined* as "the thing in the `tracker` slot"), and keeps the diff
against today's schema at zero for the primary path.

**2. New `state.secondaryTrackers: [{ system, repo?, instance?, projectKey?, role:
"secondary" }]` array.**
Each entry carries its own `role: "secondary"` even though membership in the array already
implies it — this keeps entries self-describing if a future change ever needs to flatten
primary+secondary into one iterable list. Upsert key is **namespace-prefixed**:
`system + ":" + (repo ? "repo:" + repo : "project:" + projectKey)` — e.g.
`github-issues:repo:acme/market-intelligence` vs. `jira:project:ABC`. A bare `system + repo`
(or `system + projectKey`) concatenation was considered and rejected: it lets a `repo`-keyed
entry and a `projectKey`-keyed entry collide whenever their string values happen to match (e.g.
`{system:"jira", projectKey:"ABC"}` vs. `{system:"jira", repo:"ABC"}`). Re-running
`set-tracker --role secondary` with a matching key merges into the existing entry (mirrors
primary's existing "merges, only passed flags change" behavior) instead of appending a duplicate.
A tracker system keyed by neither `repo` nor `projectKey` is out of scope for this change — see
Open Questions.

**3. `set-tracker` gains `--role primary|secondary`, default `primary`.**
`--role primary` (or omitted) is byte-for-byte today's behavior: overwrite `state.tracker`.
`--role secondary` upserts into `secondaryTrackers` by the key in Decision 2 and never touches
`tracker`. Flags for identifying a secondary entry reuse the primary tracker's existing flag
names for symmetry: `--system`, `--repo`, `--project` (not a new `--project-key`, which would be
a second, inconsistent name for the same concept `--project` already covers). A `--remove`
boolean flag (paired with `--system` + `--repo`/`--project` to identify the entry) deletes a
secondary entry — trackers going stale (e.g. a decommissioned upstream repo) is a real,
cheap-to-support case, so this ships in the same change rather than being deferred. `--remove`
against a key with no matching entry exits non-zero with a clear "no matching secondary tracker"
message and leaves `state.secondaryTrackers` unchanged — it is a rejected input, not a silent
no-op.

**4. Secondary sync instructions are role-based and system-agnostic in `rulesBlock()`.**
Today's `github-issues`-specific inward-pull block (`"## GitHub issue sync"`) is generalized into
a loop over `secondaryTrackers`, emitting one such block per entry (parameterized by that entry's
`system`/`repo`), plus new instructions for the status-writeback step. The existing
`github-issues-as-primary` special case (full outward-block suppression) is left completely
alone — it is keyed off `tracker.system === "github-issues"`, orthogonal to the new
`secondaryTrackers` loop, so a repo already relying on that behavior sees no change unless it
explicitly adds a `--role secondary` entry. `rulesBlock(tracker, reviewMode)`'s signature grows a
third parameter, `secondaryTrackers` (defaulting to `[]`); both existing call sites
(`writeRules()` and the `rules` CLI dispatch) are updated to pass `currentSecondaryTrackers()`
alongside `currentTracker()`.

**5. Dedup and status writeback are resolved by `externalUrl`, keyed per-source — not by bare
`externalId`.**
`add-epic`'s existing duplicate check (`state.epics.find(e => e.externalId === externalId)`)
matches on the bare ID alone. That's fine for exactly one tracker, but breaks the moment two
secondary trackers of the same system exist: GitHub issue numbers restart at 1 per repo, so issue
`#42` in two different secondary-tracker repos would collide under the old check — the second
sync would be silently skipped as a false "already exists," permanently dropping that epic. Since
every documented tracker-sync workflow (primary and secondary alike) already passes
`--external-url` alongside `--external-id`, and a full issue URL is globally unique across
systems and repos, the duplicate check changes to match on `externalUrl` when both the incoming
and an existing epic's `externalUrl` are present, falling back to the old bare-`externalId` match
only when no URL is available on either side (a rare/legacy path). No new epic-level field is
needed to disambiguate *which* tracker an epic came from either: for status writeback, the
rules-block instruction for a given secondary tracker entry matches on epics whose `externalUrl`
contains that entry's `repo` (or, for non-GitHub systems, `instance`+`projectKey`) — the URL
already encodes enough to both identify the right issue and know which tooling to close it with.
The new rules-block section instructs the agent: "when an epic with an `externalUrl` matching
this secondary tracker's `repo` transitions to `archived`, close/transition the corresponding
issue there, using your own tooling — check its current state first so a re-run doesn't error on
an already-closed issue." No new state field tracks "was writeback already performed" — same
trust-the-agent model the existing primary status-intent sync already uses.

## Risks / Trade-offs

- **[Risk] A secondary tracker's issue is closed externally (by someone else) while the linked
  epic is still open — no reconciliation happens automatically.** → Mitigation: the existing
  inward-pull step already re-reads open issues on every `/pm:sync`; a closed issue simply stops
  appearing, which is acceptable drift, not corruption (mirrors how OpenSpec/Superpowers disk
  sync already tolerates external drift).
- **[Risk] Ambiguous upsert if two secondary entries could plausibly match the same key** (e.g.
  same `system` but the user intended two distinct GitHub repos, or a `repo`-keyed entry
  colliding with a `projectKey`-keyed one) → Mitigation: the namespace-prefixed key in Decision 2
  (`system:repo:<value>` vs. `system:project:<value>`) makes the two field types unambiguous, and
  two entries for two different `repo` values never collide.
- **[Risk] Cross-tracker `externalId` collision silently drops an epic** (e.g. issue `#42` exists
  in two different secondary-tracker repos) → Mitigation: Decision 5 — dedup and writeback match
  on `externalUrl` (globally unique), not bare `externalId`.
- **[Trade-off] No role-flip support** means a repo that wants to promote a secondary to primary
  must manually remove-and-re-add. Acceptable for v1 — promotion is a rare, deliberate act, not a
  routine operation worth automating yet (resist building it until a real second instance shows
  up).

## Migration Plan

No `MIGRATIONS` entry required: `secondaryTrackers` is a new optional field. A `state.json`
written by any prior version simply omits it, which is a valid "no secondary trackers configured"
state — no existing data needs transformation to remain valid. `state.tracker`'s shape and
semantics are completely unchanged. Deploy is: ship the engine change, bump `plugin.json`
version, done — no upgrade-time data rewrite needed (`upgrade` subcommand needs no new migration
step for this).

## Open Questions

- Should a future change support promoting a secondary tracker to primary (or vice versa)
  in-place, once a second real instance of that need shows up? Deferred per Non-Goals above.
- Should the SessionStart brief surface a count of un-synced secondary-tracker issues the way it
  already does for primary `TRACKER SYNC`? Left out of this change's scope to keep the blast
  radius focused on the schema + sync-instruction change; worth a fast-follow if it proves
  useful in practice.
- A future tracker system keyed by neither `repo` nor `projectKey` (e.g. some other identifier
  shape) would collapse Decision 2's namespace-prefixed key down to `system` alone, letting all
  entries for that system collide. Not addressed here — no such system exists among today's
  supported trackers (jira/linear/github-issues/gitlab/bitbucket); revisit if/when one is added.
- Decision 2's upsert key omits `instance` — two secondary trackers on the same `system` +
  `projectKey` but different `instance` (e.g. two separate Jira sites both using project key
  `ABC`) collide into a single entry (Gate 2 finding). Not fixed here — no dual-instance setup
  exists among today's documented users; revisit by folding `instance` into the key if/when one
  does.
