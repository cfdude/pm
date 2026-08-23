## Purpose

The optimistic revision guard on `.conductor/state.json` — refusing a write built on a revision
another process has already superseded — together with the corrections its own 0.26.0 release
needs: a contention warning that latches once per episode instead of firing only when the counter
is sampled at exactly the threshold, delivered somewhere a session actually reads. 0.26.0 shipped
without an OpenSpec change, so this capability documents that shipped behavior as well as amending
it.

## ADDED Requirements

### Requirement: A write built on a superseded revision is refused

`state.json` carries a `revision`. A save SHALL compare the revision the caller read against the
revision currently on disk and MUST NOT write when they differ. The write itself was already
atomic (temp file plus rename); what was unguarded was the read-modify-write cycle, where two
processes that loaded the same revision each wrote back wholesale and the second silently
discarded the first one's change. A state file written before `revision` existed SHALL load
unchanged, be treated as revision 0, and take revision 1 on its first write — no migration.

#### Scenario: An interactive verb refuses a stale write

- **WHEN** a verb loads state, another process writes `state.json`, and the first verb then saves
- **THEN** the save is refused, nothing is written, and the process exits with an exit code
  distinct from the code every validation failure already uses, so a caller can tell a retryable
  conflict from a command it must fix

#### Scenario: A pre-guard state file loads and writes

- **WHEN** the engine reads a `state.json` that has no `revision` field
- **THEN** it loads unchanged, is treated as revision 0, and its first successful write stores
  revision 1

### Requirement: Hook writes retry once, then skip

A save on a hook-driven path SHALL retry exactly once on conflict, and MUST skip rather than throw
if the retry also conflicts. The retry MUST reload state and re-run the heal rather than re-attempt
the same write — the in-hand state is built on a revision someone else has superseded, so writing
it again would clobber exactly what the guard protects. Skipping is safe because these writes are
self-healing and re-run on the next hook; throwing would turn an invisible race into a visible
mid-session error for a write that did not matter. Every skip MUST be recorded to an append-only
sidecar, never to `state.json` — that is the file whose write just failed.

#### Scenario: A hook write conflicts once and succeeds on retry

- **WHEN** a hook-driven save conflicts, and reloading state and re-running the heal produces a
  write that does not conflict
- **THEN** the write lands, the hook reports no error, and no conflict is left outstanding

#### Scenario: A hook write conflicts twice and is skipped

- **WHEN** both the initial hook-driven save and its single retry conflict
- **THEN** nothing is written, the hook does not throw or exit non-zero, and one entry is appended
  to the conflict sidecar naming the verb and the expected and found revisions

### Requirement: A save that changes nothing writes nothing

A save whose resulting state is identical to what is on disk, ignoring `revision`, SHALL be a
no-op: no file write and no revision bump. Bumping the revision for a write that changes nothing
breaks byte-idempotence — running `upgrade` twice must leave `state.json` identical — and rewrites
a file for no reason.

#### Scenario: Re-running an idempotent verb

- **WHEN** a verb saves state whose content, excluding `revision`, matches the file on disk
- **THEN** `state.json` is byte-identical afterwards, the revision is unchanged, and the save
  reports success

### Requirement: --force overwrites and always advances past what is on disk

`--force` SHALL let a caller deliberately overwrite a newer revision, and the revision it writes
MUST be strictly greater than both the revision it read and the revision found on disk. Writing
`read + 1` can land at or below what is on disk, which reopens the lost-update window one hop
removed: a third writer's read then matches the forced write's too-low revision, the guard passes,
and the forced change is the one silently discarded. Without an escape hatch, operators learn to
hand-edit `state.json` to get past the guard, which is strictly worse.

#### Scenario: Forcing over a newer revision

- **WHEN** a caller that read revision 4 saves with `--force` while disk holds revision 9
- **THEN** the write lands and `state.json` carries revision 10 — never 5

### Requirement: The contention warning latches for one run of contention

The warning that consecutive state writes are being skipped SHALL appear exactly once per run of
contention, regardless of how far past the threshold the count jumps between two briefings, and
MUST NOT repeat until a successful state write has reset it. Testing the count for equality with
the threshold is wrong because the count is only *sampled* when a briefing is composed: verified
empirically, a burst from 0 to 7 skips between two briefings warns **zero** times — so the warning
is least likely to fire in exactly the wedged-writer scenario it exists for, and its absence then
reads as evidence of health. Warning on every count at or above the threshold is equally wrong: it
floods, and a reader who filters the message cannot see a real signal.

#### Scenario: A burst past the threshold still warns once

- **WHEN** the skip count goes from 0 to 7 between two briefings and a briefing is then composed
- **THEN** the warning appears exactly once, naming the conflict log

#### Scenario: The warning does not repeat while contention continues

- **WHEN** further writes are skipped after a warning has been delivered, with no successful state
  write in between, and further briefings are composed
- **THEN** no further warning is emitted for that same run of contention

#### Scenario: A successful write re-arms the warning

- **WHEN** a state write succeeds after a warning was delivered, and a later run of contention
  again crosses the threshold
- **THEN** the warning appears once more, because the signal of interest is consecutive skips
  rather than skips ever

### Requirement: The warning is consumed only where it reaches a session

The warning SHALL be consumed only at a delivery point whose output actually reaches a session.
Consuming it into `.conductor/brief.txt` does not qualify: that file is written by the PreCompact
hook and read back by nothing, so a PreCompact landing between the threshold crossing and the next
SessionStart resets the count, rotates the evidence, and shows the message to no one — while
compaction is routine in exactly the long sessions where sustained contention is most likely.
Composing `PROJECT.md` likewise MUST NOT consume the warning.

#### Scenario: A briefing delivered into the session consumes the warning

- **WHEN** the SessionStart briefing is composed and carries the contention warning
- **THEN** the warning is consumed, so it does not re-fire every session for contention that
  resolved days ago, and the conflict log it names still exists for the reader to open

#### Scenario: A pre-compaction snapshot does not consume the warning

- **WHEN** the PreCompact snapshot is written while the threshold is crossed
- **THEN** the warning is not consumed, and the next briefing that actually reaches a session
  still carries it

#### Scenario: Rendering PROJECT.md does not consume the warning

- **WHEN** `PROJECT.md` is regenerated while the threshold is crossed
- **THEN** the warning is not consumed, because composing a generated document that the next
  render overwrites is not a session seeing the warning
