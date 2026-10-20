# Proposal: epic-session-attribution

## Why

Most of this epic shipped before it was proposed (epic note, GROOMING 0.41.0, re-verified at `c78c6828`):
the dispatch wrapper resolves the session once (`conductor.mjs:401`, `resolveSession()` in
`session-identity.mjs`) and the activity log stamps it on every event kind, queryable with
`activity --epic`. Two gaps remain:

1. `--session` is declared for `claim` and `unclaim` only (`constants.mjs:764`). On every other
   epic-writing verb `PM_SESSION` is the only channel, and passing `--session` is refused as an
   undeclared flag.
2. Nothing lands on the epic record. The activity trail exists only while the activity log is on and
   only in its own file; the epic itself cannot say which sessions worked on it.

## What Changes

- `--session <name>` is declared on every epic-writing verb through the one shared flag allowlist
  (`epic-annotation`), with `PM_SESSION` as the fallback exactly as `resolveSession()` already orders it.
- When an invocation's save changes an epic and a session identity resolves, the SAME write records it
  on that epic: `epic.sessions[]`, one entry per distinct identity `{session, firstAt, lastAt}`, in
  first-seen order. Entries are never reordered or removed.
- No identity, no field: a repo where nobody names a session sees no change. The identity is opaque:
  pm never derives one, and never checks it against anything.
- A write that changes nothing records nothing, so a no-op stays a no-op.

## Capabilities

### New Capabilities

- `epic-session-trail`: the per-epic record of which named sessions wrote it, and the `--session`
  flag on every epic-writing verb.

### Modified Capabilities

None. `epic-annotation`'s shared allowlist requirement already obliges any capability adding a flag to
register it there; this change is an instance of it.

## Impact

- Engine: `scripts/lib/constants.mjs` (the `session` row's `commands`), the save path that already
  knows which epics changed, `scripts/lib/session-identity.mjs` (validation of the identity).
- State: additive optional `epic.sessions`. No migration.
- Docs: `commands/epic.md` (the flag and the field), changeset. README one line.
- Lane note for the orchestrator: registered `claude-code`; this change makes it an OpenSpec change.
