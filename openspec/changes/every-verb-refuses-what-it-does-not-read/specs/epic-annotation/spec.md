## MODIFIED Requirements

### Requirement: Every epic-writing surface rejects what it will not persist
A command that creates or mutates an epic SHALL either persist every input it accepts or exit
non-zero naming the input it does not support, writing nothing in that case. This binds EVERY such
surface, not only the one that already enforces it: single-epic creation, single-epic update, and
bulk creation from a batch document. Silently accepting `--notes`, reporting success and writing
nothing is prohibited — the failure is invisible and the text is unrecoverable, and it has already
destroyed the entire payload of epics registered specifically so a future session would remember
why they exist.

The rule binds three input shapes, because these surfaces do not all take flags and a flag a surface
does support is not always persisted:

- A `--flag` an epic-writing command does not declare at all is refused as the `verb-surface`
  capability requires of every dispatched verb — by name, with the flags the command does accept
  named alongside it. That capability owns the refusal of undeclared flags and surplus positionals on
  these surfaces as on every other; this requirement does not restate it.
- A KEY in a bulk-creation batch document that the command will not persist MUST be rejected by name.
  Bulk creation previously copied a fixed set of properties out of each entry and dropped every other
  key without a word — the same defect at a different shape, and the reason a bulk path cannot be
  treated as covered by a flag rule.
- A flag the command DOES declare, supplied on an invocation that will not persist it, MUST be refused
  by name, naming the transition that would record it. Update's disposition flags — `--outcome`,
  `--reason` and `--carried-to` — are recorded only when the invocation archives the epic; supplied
  without `--status archived` they were dropped while the command reported that every supplied value
  was already held, which is false. Their sibling deferral flags are already refused this way, and the
  rule binds the whole set rather than the half that happens to be guarded.

A rejection at any shape MUST leave state entirely unchanged; a bulk rejection MUST NOT create the
valid entries in a batch that also contains an invalid one.

#### Scenario: A supported annotation flag persists
- **WHEN** an epic is created with `--notes "<text>"` and the command exits zero
- **THEN** the note is present on the epic in state — an exit code of zero alone is not sufficient
  evidence, the field must read back

#### Scenario: An unsupported flag on the creation surface fails loudly
- **WHEN** single-epic creation is given a flag it does not support
- **THEN** it exits non-zero, names the offending flag and the flags it does support, no epic is
  created, and state is unchanged

#### Scenario: An unsupported flag on the update surface fails loudly
- **WHEN** an epic-mutating command is given a flag it does not support
- **THEN** it exits non-zero, names the offending flag and the flags it does support, and writes
  nothing

#### Scenario: An unknown key in a bulk batch is rejected atomically
- **WHEN** a batch document creating three epics sets, on one of them, a key the command does not
  persist
- **THEN** the command exits non-zero naming that key, and none of the three epics is created

#### Scenario: An outcome without an archive is refused by name
- **WHEN** `update-epic e1 --outcome killed --reason "no"` runs on an unarchived epic, without
  `--status archived`
- **THEN** it exits non-zero naming `--outcome` and `--reason` and stating that they are recorded only
  when the epic is archived, and `e1` carries no disposition and is not archived

#### Scenario: A handoff target without an archive is refused by name
- **WHEN** `update-epic e1 --carried-to other` runs on an unarchived epic, without `--status archived`
- **THEN** it exits non-zero naming `--carried-to`, and `state.json` is byte-identical to before

#### Scenario: The disposition flags still record at the archive
- **WHEN** `update-epic e1 --status archived --outcome killed --reason "no" --no-deferrals` runs on an
  epic with no outstanding work
- **THEN** it exits zero, `e1` is archived, and its disposition reads back outcome `killed` and
  reason `no`

### Requirement: One shared flag allowlist, grown by every capability that adds a flag
The flags an epic-mutating command accepts SHALL be declared in a single shared allowlist, and
every flag that ANY capability in this release introduces for such a command SHALL be registered in
that allowlist. The bulk-creation path's accepted keys SHALL be **derived from that same
allowlist** rather than maintained as a second literal, so mirroring is structural and cannot drift.
There SHALL NOT be a second, parallel allowlist for a subset of the flags.

**The enumeration used to check coverage SHALL be the command's own documented flag surface** — the
flags named in its usage line and its `commands/` document — read at check time, never a list
transcribed into a test. Driving the check from the allowlist itself would be circular: a flag a
capability forgot to register is simply absent from the allowlist, so the check would pass
vacuously on exactly the omission it exists to catch. The documented surface is external to the
allowlist, so an unregistered flag surfaces as a documented flag the command rejects. This also
means the enumeration cannot rot as capabilities are still adding flags: it is whatever the release
actually shipped and documented, not a snapshot of what it was expected to ship.

**Argv-level flags are the one carve-out from that coverage check, not from the allowlist.** A flag
the `verb-surface` capability declares argv-level (`--force`) is registered in this same allowlist,
because a separate list of them would be the parallel list this requirement prohibits. It carries no
value and writes no epic field, so the documented-surface check — which requires every flag to read a
value back from state — SHALL exclude argv-level flags, and so SHALL the check that every flag the
allowlist declares for an epic-mutating command appears in its command document. Their acceptance on
every command they are declared for is checked by `verb-surface` over the whole dispatch table instead.

This is not housekeeping. The allowlist is a literal list and an unregistered flag exits non-zero
naming itself, so whichever capability lands first rejects by name the flags the others introduce —
and the requirement above, that a command never accept a flag it discards, is precisely what turns
that omission into a hard failure. This release exists to fix the absent-edit defect class, a rule
applied at one call site while an identical sibling goes untouched; shipping that defect inside the
release that fixes it is prohibited.

#### Scenario: Every documented flag is accepted by the command that owns it
- **WHEN** an epic-mutating command is invoked once per flag with every flag its own usage line and
  command document name — whichever capability in this release introduced it, read from the
  documentation at check time rather than from a transcribed list
- **THEN** every invocation is accepted and the value it carries reads back from state, and none is
  rejected as an unknown flag

#### Scenario: A capability-introduced flag missing from the allowlist fails the check
- **WHEN** a flag appears on an epic-mutating command's documented flag surface but was never
  registered in the shared allowlist
- **THEN** the check fails naming that flag — it is not skipped for being absent from the allowlist
  the check is verifying

#### Scenario: The bulk path accepts what the single-epic path accepts
- **WHEN** a bulk batch document sets a field that single-epic creation accepts as a flag
- **THEN** the created epic carries that field, identically to an epic created one at a time

#### Scenario: A flag is registered in exactly one allowlist
- **WHEN** the flags an epic-mutating command accepts are enumerated
- **THEN** they come from one shared list, no flag is accepted by the command without appearing in
  it, and the bulk path's accepted keys are derived from that same list rather than restated

#### Scenario: An argv-level flag is not held to reading a field back
- **WHEN** the documented-surface coverage check enumerates `update-epic`'s flags and the allowlist
  declares `--force` argv-level on it
- **THEN** the check does not require `--force` to read a value back from state, and `--force`'s
  acceptance on `update-epic` is asserted by `verb-surface`'s dispatch-wide check
