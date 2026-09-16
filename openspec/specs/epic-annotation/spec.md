# epic-annotation Specification

## Purpose

Epics carry durable free-text rationale as a `description`, kept distinct from `notes` — an
append-only activity trail — so the reasoning behind a piece of work survives the session that
produced it, and so activity is never mistaken for intent. Both are settable and amendable from
the CLI on an existing epic, not only at creation. This capability also owns the flag surface every
epic-writing command shares, so a field one capability adds cannot be rejected by another's command.

## Requirements

### Requirement: Description and notes are distinct first-class fields
An epic SHALL carry two independent free-text fields. `description` is durable rationale — why this
epic exists, its constraints, what would make it worth revisiting — a single value that is replaced
when set again. `notes` is an append-only trail of entries, each recording when it was written, who
wrote it, and the text. Writing one SHALL NOT modify the other, and appending a note SHALL NOT
rewrite or drop an earlier entry. Neither field SHALL be substituted by stories: stories are
checklist items whose ticked state is the truth for epic progress, and using them as a free-text
carrier is why epics have been archived with "incomplete" stories that were in fact completion
notes.

The `{at, actor, text}` entry shape is the shape a queued session-attribution capability also
needs; `actor` is recorded here, not interpreted. Attribution semantics are out of scope for this
capability.

#### Scenario: A description is set at creation and reads back
- **WHEN** an epic is created with a description
- **THEN** the epic's `description` reads back exactly that text

#### Scenario: A description is set on an existing epic
- **WHEN** the agent sets a description on an epic that already exists
- **THEN** the epic's `description` reads back the new text and its notes are unchanged

#### Scenario: Notes append rather than replace
- **WHEN** a note is added to an epic that already has one note
- **THEN** the epic has two note entries in the order they were written, each carrying its
  timestamp, actor and text, and the first entry's text is unchanged

#### Scenario: Description and notes do not overwrite each other
- **WHEN** a note is appended to an epic that has a description
- **THEN** the description is unchanged; and when the description is replaced afterwards, every
  note entry is still present

#### Scenario: Rationale is not carried as stories
- **WHEN** an epic needs durable rationale recorded
- **THEN** it is recorded as a description, and the epic's stories continue to mean outstanding
  work whose ticked state drives progress

### Requirement: Every epic-writing surface rejects what it will not persist
A command that creates or mutates an epic SHALL either persist every input it accepts or exit
non-zero naming the input it does not support, writing nothing in that case. This binds EVERY such
surface, not only the one that already enforces it: single-epic creation, single-epic update, and
bulk creation from a batch document. Silently accepting `--notes`, reporting success and writing
nothing is prohibited — the failure is invisible and the text is unrecoverable, and it has already
destroyed the entire payload of epics registered specifically so a future session would remember
why they exist.

An argv-level flag that the `verb-surface` capability declares (`--force`) is not an input this rule
counts: it belongs to the invocation's state write rather than to the epic, so accepting it without
persisting anything on the epic is not a violation of this requirement.

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
value back from state — SHALL NOT require an argv-level flag to read one back, and the check that every
flag the allowlist declares for an epic-mutating command appears in its command document SHALL exclude
argv-level flags. Their acceptance on
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

### Requirement: An existing epic's lane and plan association are changeable
`update-epic` SHALL accept `--lane`, validated against the known lanes exactly as creation
validates it, and `--plan`, setting the epic's plan path. A lane is a judgment that legitimately
changes as an epic's nature becomes clearer; today the only way to correct it is to delete and
recreate the epic, which discards its start time, its gate verdict, the links pointing at it, and
its position in history. `--plan` exists at creation only, so an epic that was not created with a
plan can never be pointed at one.

#### Scenario: Changing an epic's lane preserves its history
- **WHEN** the agent changes an existing epic's lane
- **THEN** the epic's lane is updated and its start time, gate verdict, links, stories and position
  in the epic list are unchanged

#### Scenario: An invalid lane is rejected
- **WHEN** the agent sets a lane that is not one of the known lanes
- **THEN** the command exits non-zero, names the valid lanes, and the epic is unchanged

#### Scenario: A plan can be attached to an existing epic
- **WHEN** the agent sets a plan path on an epic created without one
- **THEN** the epic's plan path reads back that value

### Requirement: Clearing an epic's links is explicit and documented
Removing every link from an epic SHALL be expressible by a form that the command's own usage line
names, and that form SHALL be covered by a test. Exactly one of two shapes satisfies this: a flag
whose name states the intent, such as `--clear-links`; or the existing valueless `--link`, named in
the usage line as the clearing form. Whichever ships, an undocumented destructive path SHALL NOT
remain: today `--link` with its value omitted replaces the links array with an empty one, which is
byte-identical to the typo of dropping a value from a flag invoked to fix a malformed link, and it
is documented nowhere.

Clearing links SHALL leave every other field on the epic unchanged.

#### Scenario: Clearing links is possible from the documented usage
- **WHEN** the agent reads the command's usage line and follows it to remove an epic's links
- **THEN** the epic's links are emptied, its title, status, priority, stories and gate verdict are
  unchanged, and the form used appears in that usage line

#### Scenario: Link clearing is not an undocumented side effect
- **WHEN** a link flag is supplied with no value
- **THEN** the outcome is the one the usage line documents — either the named clearing behavior or
  a non-zero exit naming the flag — and never an undocumented silent destruction of the links array

### Requirement: A misplaced id flag is diagnosed, not answered with a usage dump
`update-epic` takes its epic id positionally while every sibling command takes `--id`. When the
first token is `--id <value>`, the command SHALL either accept it as an alias for the positional id
and perform the update, or exit non-zero with a message that names `--id` as the problem and shows
the positional form. Printing the bare usage line with no diagnosis is prohibited — it reads as
"your flags were malformed" when the flags were fine, and it has cost live diagnostic time.

#### Scenario: `--id` as the first token is diagnosed or accepted
- **WHEN** the agent runs `update-epic --id my-epic --priority P1`
- **THEN** either the epic `my-epic` has its priority updated, or the command exits non-zero with a
  message naming `--id` and showing `update-epic <id> ...`; in neither case is a bare usage line
  printed without explanation

#### Scenario: A genuinely missing id is still an error
- **WHEN** the agent runs `update-epic --priority P1` with no id in any form
- **THEN** the command exits non-zero with a message stating that the epic id is required
  positionally

### Requirement: An epic's rationale is retrievable from the rendered record
The conductor's rendered project record SHALL make an epic's description retrievable for epics that
have not started — the backlog statuses registered precisely so a future session remembers the
reasoning. Today that record shows an epic's id and not even its title, so an epic registered as
backlog is a bare stub whose context lives entirely outside the conductor.

#### Scenario: A backlog epic's rationale survives the session that registered it
- **WHEN** an epic is registered as backlog with a description and the project record is
  re-rendered
- **THEN** a session reading that record can recover the epic's description without opening
  `.conductor/state.json`

### Requirement: Nullability is declared, and every declared-nullable field can be unset
Each field an epic-writing surface can set SHALL declare in the flag registry whether it is
NULLABLE — whether absence is a legal, meaningful state rather than a broken record — and every
field so declared SHALL be reachable by a clearing form.

The declaration is what makes the rule enforceable, and without it neither candidate shape works. A
per-field clearing flag can be forgotten when a further nullable field is added; so can a single
clearing flag's accepted set, if that set is typed by hand. Only a registry marker lets the
clearing surface and its test both derive from one place, so a nullable field added without a
clearing path fails the suite instead of shipping silently. A field deliberately left set-only
SHALL carry its reason in the registry beside the marker, not in prose a test cannot read.

The clearing form SHALL be uniform across the declared-nullable fields rather than invented per
field. Measured here, one field of the set carried a clearing flag while the others did not; a fix
adding a second flag for a second field and leaving the rest would reproduce, inside the fix, the
defect it was written to repair.

The clearing form SHALL name fields by the spelling a user reads in the command's own help — the
flag name, not the internal state key — because those are two namespaces that the engine already
warns must not be confused.

`links` is the one field that keeps a dedicated clearing flag. It is GRANDFATHERED, not an exception
to the uniformity rule: `--clear-links` is already documented, already tested, and is required in one
invocation alongside `--link` for the atomic repair this specification also requires — a shape the
generic form cannot express. It SHALL therefore be declared set-only for the generic form, carrying
that reason, so that the generic form refuses `links` by name and points at `--clear-links` rather
than appearing to offer a second way to do the same thing.

`notes` is an append-only trail and SHALL be declared set-only with that reason: its entries are a
record of what was said and when, so removing one would edit history rather than clear a value. That
is a decision recorded here, not an omission — the requirement above demands every settable field
carry one marker or the other.

Unsetting a field SHALL leave every other field on the epic unchanged, and SHALL be refused with a
non-zero exit naming the field where that field is not declared nullable.

#### Scenario: Every declared-nullable field has a clearing form
- **WHEN** the clearing surface is checked against the registry's nullable declarations
- **THEN** every declared-nullable field is reachable by the clearing form

#### Scenario: A new nullable field with no clearing path fails the suite
- **WHEN** a field is declared nullable in the registry and no clearing path reaches it
- **THEN** the suite fails, rather than the field shipping without one

#### Scenario: Clearing one field leaves the others intact
- **WHEN** a declared-nullable field is cleared on an epic
- **THEN** that field is absent and every other field on the epic is unchanged

#### Scenario: Clearing a field that is not nullable is refused
- **WHEN** the clearing form is applied to a field with no declared nullable state
- **THEN** the invocation exits non-zero naming the field, and no field is changed

### Requirement: Supplying a link adds it, and the documented repair stays one write
Supplying a link to an existing epic SHALL add that link to the epic's recorded links rather than
replacing them, because replacement makes the operation destructive in a way its name does not
state and makes recording a second relationship silently discard the first. A link's IDENTITY is its type
and its target; its reason is the part a reader acts on and is NOT part of its identity. Supplying a
link whose identity matches one already recorded SHALL NOT produce a second entry — two
relationships of the same type between the same pair of epics are one relationship, and a record
listing it twice disagrees with itself — and SHALL update that entry's reason in place rather than
discarding it. Discarding would be worse than a duplicate: today replacement makes correcting a
reason work, and a dedup that merely dropped the repeat would remove the only path to it while
reporting that nothing changed. Where identity AND reason both match, nothing changes and the
invocation says so.

Every surface that DOCUMENTS the replacing behaviour SHALL change with it, including the messages
the engine emits at runtime. Two of those messages instruct a reader to repair a malformed link by
re-supplying it with a corrected type; under append the corrected type is a different pair, so the
malformed link survives and the very finding the message remedies persists forever. An emitted
command that no longer runs as written is a defect this engine already forbids elsewhere.

Because replacement is the documented repair for a malformed link, clearing and supplying SHALL be
combinable in ONE invocation, so that repair remains a single atomic write. They are currently
mutually exclusive, which would leave the repair as two writes with a zero-link window between
them, and a rejection on the second write would leave the epic with no links at all.

**One exception: an epic that owes a reconcile.** While an epic owes a reconcile AND holds an armed or
unmigrated `may-invalidate` link (the condition `gate-integrity` "A write never destroys the record of
an owed reconcile" refuses on), a clear of its links is refused whatever else the invocation supplies, because it would
remove the link the owed verdict must be recorded against — `gate-integrity` "A write never destroys
the record of an owed reconcile". The repair is not lost, only ordered: every engine message that
instructs a reader to repair a link by clearing and re-supplying SHALL, when the epic it names owes a
reconcile, name `record-reconcile` as the step before the repair.

#### Scenario: A second link is added, not substituted
- **WHEN** a link is supplied to an epic that already records one
- **THEN** the epic records both

#### Scenario: Re-supplying a link with a corrected reason updates it in place
- **WHEN** a link whose type and target match one already recorded is supplied with a different
  reason
- **THEN** the epic records one link with that type and target, carrying the new reason

#### Scenario: Re-supplying a wholly identical link is not a duplicate
- **WHEN** a link matching one already recorded in type, target AND reason is supplied
- **THEN** the epic's recorded links are unchanged

#### Scenario: Repairing a malformed link is one atomic write
- **WHEN** an agent clears the links of an epic that owes no reconcile and supplies the corrected set
  in one invocation
- **THEN** the invocation is accepted, and the epic's links are replaced in a single write

#### Scenario: An emitted repair instruction matches the behaviour
- **WHEN** the engine emits a message instructing a reader how to repair a malformed link
- **THEN** following that message as written removes the malformed link

#### Scenario: The repair on an owing epic names the verdict first
- **WHEN** an epic that owes a reconcile holds a malformed link, and the engine emits the repair
  instruction for it
- **THEN** the instruction names `record-reconcile` before the clear-and-re-supply invocation, and the
  clear-and-re-supply invocation run before any verdict is refused with `state.json` byte-identical

### Requirement: A write that changes nothing says so
An epic-writing invocation whose effect on the record is empty SHALL say so, rather than reporting
the generic success line for a write that did not happen. The rule binds the WRITE SURFACE, not an
enumerated list of paths: whenever the save reports that it changed nothing, the invocation reports
that it changed nothing.

Scoping this to the paths a single change happens to introduce would be the very defect required
task item 1 exists to catch, so it is stated once over the surface. The save layer already returns
whether it was a no-op; the reporting layer currently discards that and prints success
unconditionally, which is why a same-valued title, status or priority ALREADY reports a write that
did not happen. Two paths this specification introduces reach the same state — supplying a link
already recorded, and clearing a field already absent — and they are instances of the rule rather
than its scope. In all of them the record is correct and no error occurred, so refusing would be
wrong; but reporting "updated" tells a reader something happened when nothing did.

#### Scenario: Any invocation whose save changed nothing reports no change
- **WHEN** an epic-writing invocation results in a save that reports it changed nothing — including
  setting a field to the value it already holds
- **THEN** the invocation exits zero and reports that nothing changed, rather than reporting the
  record was updated

#### Scenario: A no-op link supply reports no change
- **WHEN** a link already recorded is supplied
- **THEN** the invocation exits zero and reports that nothing changed, rather than reporting the
  record was updated

#### Scenario: A no-op clear reports no change
- **WHEN** a declared-nullable field that is already absent is cleared
- **THEN** the invocation exits zero and reports that nothing changed
