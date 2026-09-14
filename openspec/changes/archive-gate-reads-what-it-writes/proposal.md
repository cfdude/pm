## Why

`update-epic` runs the archive gate against the epic **before** the invocation's own field writes,
so the gate decides on a record the invocation is about to replace.

`archiveGate()` is called at `scripts/lib/update-epic.mjs:460`. Every field write the same call makes
comes after it: `--withdraw-commit`, `--lane`, `--plan`/`--spec`, `--attribute-commit`,
`--add-story`, `--story <n> --done|--wont-do`, links, priority, and the `--clear-*` unsets. Gate 1 on
`gate-verdict-withdrawal` found this through one flag. Round 2 showed it is the whole verb.
Reproduced on 0.42.0:

- **A bypass in one call.** A `claude-code` epic with no Gate 2, run through
  `update-epic a1 --lane openspec --status archived --outcome delivered --no-deferrals`, exits 0 and
  is left an archived `delivered` openspec-lane epic with no Gate 2. Split into two calls, the same
  flags are refused. Round 2 reproduced the same shape with `--attribute-commit` (a sha the verdict
  does not cover), `--add-story`, and `--withdraw-commit`.
- **A false refusal in one call.** An epic whose only story is outstanding, run through
  `update-epic a2 --story 1 --done --status archived --outcome delivered --no-deferrals`, is refused
  for the outstanding story that same call marks done.
- **A regression after archive, with no gate at all.** On an archived `delivered` `claude-code` epic,
  `update-epic a3 --lane openspec` exits 0. That leaves a `delivered` openspec-lane epic with no Gate 2,
  a record the gate would refuse, and `integrity` names it nowhere. A mutation on an archived epic
  never passes through `--status archived`, so the gate never sees it.

Both halves share one cause: the gate reads a record the invocation does not leave.

## What Changes

- **The gate runs last.** `archiveGate()` moves to after every field write and unset of the
  invocation, just before the completion stamp, the claim clear and `saveState()`. The gate then
  decides on the record the call actually writes.
- **A refused call announces nothing.** Three stderr lines currently print before the gate: the
  sync-ignore tombstone clear, the rank clear, and the `--clear` notes. They are buffered and printed
  only once the write is going to happen.
- **An update to an archived `delivered` epic may not break an obligation its archive met.** The check
  runs when the stored status is `archived`, the call does not archive, and the record will still be
  archived afterwards. "Still archived" means no `--status` at all, or a change directory archived on
  disk: the heal the call's own render runs re-archives it, which is how `--status queued` slipped past
  a first draft. The engine compares the Gate 2 demand and the handoff demand **one at a time**, before
  and after the call, and refuses where an obligation that was met now fails. An obligation that
  already failed is not a ground for refusal, so a legacy record is reported, not locked. The refusal
  writes its own message and prints one runnable invocation that records a disposition. That
  invocation carries `--correct-disposition` only for an agent-recorded disposition, and a deferral
  placeholder only where none is recorded.
- **One source for the obligations.** The Gate 2 and handoff blocks of `archiveGate()` are extracted
  into an exported `deliveredObligations(epic, {carriedTo})`, which returns every failing obligation
  (empty when met). The gate and the regression check both call it.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `gate-integrity`: adds two requirements. The interactive archive verb gates the record the
  invocation writes, and an update to an archived epic does not break an obligation its archive met.

## Impact

- `scripts/lib/update-epic.mjs`: gate position, buffered announcements, the regression check.
- `scripts/lib/archive-gate.mjs`: `deliveredObligations()` extracted; `archiveGate()` calls it.
- `scripts/test/`: a new test file for both requirements, plus any existing test that pinned the old
  ordering (none found by `rg` at proposal time; re-derived at apply).
- `commands/epic.md`, `README.md`, `skills/conductor/SKILL.md`: the archive and update behavior.
- `CHANGELOG.md` `[Unreleased]`.
- No state migration. No schema change.
- **`gate-verdict-withdrawal` depends on this change.** It is paused behind it on the detour stack,
  and its withdrawal flag inherits both requirements rather than restating them.
