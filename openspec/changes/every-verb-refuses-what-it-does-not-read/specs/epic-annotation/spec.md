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
  created, and state is unchanged — the instance of `verb-surface`'s undeclared-flag refusal on this
  surface, retained so the epic surfaces' guarantee stays readable here

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
