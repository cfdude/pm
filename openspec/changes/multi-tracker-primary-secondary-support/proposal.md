## Why

`state.tracker` is a single object today — a repo can mirror epics to exactly one external
system. That's too narrow for a real, already-encountered shape: a repo whose actual dev tracker
is Jira (bidirectional: new epics create Jira issues, status changes transition them) but which
also needs to watch GitHub issues opened by outsiders, or by other internal repos publishing
cross-project notifications (e.g. a Market Intelligence server filing a GitHub issue in a
downstream finance-platform repo to flag a platform-impacting change). Today, configuring a
second tracker silently *replaces* the first — there is no way to have both, and no way to close
the loop on the secondary tracker's issues once the corresponding epic is done (even the existing
`github-issues` special case is pull-only; it never writes status back).

## What Changes

- `state.tracker` keeps its exact current shape and meaning — it becomes, implicitly, the
  **primary** tracker. No change to its bidirectional behavior (outward issue creation on new
  epics, status-intent transitions on status change). Fully backward compatible: no migration
  needed, every existing repo's config keeps working unchanged.
- New optional `state.secondaryTrackers: [{ system, repo, role: "secondary", ... }]` array.
  Supports more than one secondary tracker without a future redesign.
- Secondary trackers get a distinct, narrower sync contract:
  - **Inward pull**: open issues become untriaged epics (`add-epic --external-id ... --external-url
    ...`), same dedup-by-`externalId` pattern `github-issues` already uses today.
  - **NEW — status writeback on completion**: when an epic linked to a secondary tracker's issue
    reaches a terminal status (e.g. `archived`), the agent closes/transitions the corresponding
    issue there too. This capability does not exist today even for the current inward-only
    `github-issues` special case.
  - **No outward creation**: a new local epic created interactively never spawns an issue in a
    secondary tracker. This is the defining difference from primary.
- `/pm:tracker`'s `set-tracker` subcommand gains a `--role primary|secondary` flag, defaulting to
  `primary` for full backward compatibility with every existing invocation. `--role secondary`
  appends to `secondaryTrackers` (matched/updated by `system`+`repo`) instead of overwriting
  `tracker`.
- The `github-issues`-shaped inward-sync + new status-writeback logic in `rulesBlock()` is
  generalized to apply to any tracker in the `secondary` role, not hardcoded to the
  `github-issues` system — `github-issues` becomes the first real example of a secondary tracker,
  not a special case bolted onto the primary slot.
- No engine code path calls a tracker directly, unchanged from today — the engine only shapes
  instructions for the interactive agent; the agent performs all actual tracker I/O with its own
  tooling (MCP, CLI, connector).

## Capabilities

### New Capabilities

- `tracker-sync`: external-tracker mirroring behavior for conductor epics — a primary tracker
  (full bidirectional mirror) plus zero or more secondary trackers (inward pull + completion
  status writeback, no outward creation). Covers `state.tracker`/`state.secondaryTrackers` shape,
  the `set-tracker --role` CLI contract, and the CLAUDE.md rules-block instructions generated for
  each role.

### Modified Capabilities

*(none — no existing `openspec/specs/` capabilities cover tracker behavior yet; this is the first
spec-driven change touching it)*

## Impact

- `scripts/conductor.mjs`: `currentTracker()`/`rulesBlock()` (generalize the github-issues inward
  block to any secondary tracker + add status-writeback instructions), `set-tracker` subcommand
  (new `--role` flag and secondary-array merge logic), `conductor.test.mjs` (new coverage).
- `commands/tracker.md`: document `--role`, the primary/secondary contract, and status writeback.
- `README.md`: update the tracker section per this repo's documentation-currency rule.
- Mintlify docs (`cfdude/pm-docs`, deployment `onvex-ai`): `commands/tracker.mdx`,
  `guides/external-trackers.mdx`, and any `concepts/` page describing tracker sync.
- No breaking changes: `state.tracker`'s shape and semantics are untouched; `secondaryTrackers` is
  a new optional field that defaults to absent/empty for every existing `state.json`.
