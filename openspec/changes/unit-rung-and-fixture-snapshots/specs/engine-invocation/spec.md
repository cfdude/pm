# Spec Delta

## ADDED Requirements

### Requirement: The record store is supplied per call, and a verb's decision is separable from its persistence

The engine's persistence SHALL be reachable only through a store the CURRENT INVOCATION supplies,
in the same way and by the same rule as the working directory, the argument list, the environment,
the input and the streams. No module SHALL reach a record or a rendered artifact through a value
captured when the module was first loaded.

A caller SHALL be able to supply a store that keeps the record **in memory** — one that answers reads
from the state handed to it, returns writes to that same state, and produces no path on disk — and the
engine SHALL behave identically through it: the same verbs, the same refusals, the same statuses. This
is not a test-only mode bolted on: it is the assertion that the engine's DECISIONS and its
PERSISTENCE are separable, and a verb whose result changes when the store changes has a decision
hidden in its persistence.

Two invocations in one process that supply different stores SHALL be independent: neither SHALL
observe or be affected by the other's record, and neither SHALL write the other's paths.

#### Scenario: A verb produces the same result through an in-memory store as through the disk store

- **WHEN** the same accepted invocation is made twice in one process, once with the store the command
  line builds and once with a store that keeps the record in memory
- **THEN** the status is the same, the record the caller can read afterwards holds the same values,
  and the invocation that used the in-memory store created no file

#### Scenario: An in-memory store means an in-memory record, and nothing is flushed

- **WHEN** a verb that writes the record is invoked with an in-memory store
- **THEN** no file is created, opened, written or flushed for that record, and the caller reads the
  written values back from the object it supplied

#### Scenario: Two stores in one process do not observe each other

- **WHEN** two invocations in one process are given two different stores, the first having been seeded
  with a record and the second with none
- **THEN** the first acts on the record it was given and the second on its own, and neither's writes
  reach the other

#### Scenario: A refusal through the in-memory store is the same refusal

- **WHEN** an invocation the engine refuses is made through an in-memory store
- **THEN** it returns the same status the command line exits with, and the refusal names the same
  thing, because the refusal is decided by the record's content rather than by where the record lives

### Requirement: The store the command line builds writes the record the command line has always written

The store the engine builds for a command-line invocation SHALL write the same artifacts, at the same
paths, with the same bytes, as the engine wrote before this seam existed. A seam that changed what the
command line persists would leave every consumer of those artifacts — a hook, a command document, an
evaluator, a user reading `PROJECT.md` — observing a different record while every test that happened to
use the in-memory store stayed green. (The command line's own observable behaviour is owned by this
capability's existing *"The command-line binary's observable behaviour is unchanged"* requirement;
this requirement owns the ARTIFACTS and does not restate the CLI contract.)

The rendered artifact SHALL in particular be produced by the same code path and at the same moment as
before: it SHALL still be rendered when the verb that renders it runs, and it SHALL be byte-identical
for the same record **once the render timestamp is held constant**. The rendered text carries a
`> Last rendered: <timestamp>` line the engine stamps from the wall clock, so a raw byte comparison
of two renders of the same record is never equal; the comparison SHALL therefore strip that line —
using the engine's own stamp pattern — from BOTH sides before comparing, and the stamp line's
presence and format SHALL be asserted separately. (Injecting a clock is the alternative; the
stripped comparison is the choice this change makes.)

#### Scenario: The rendered artifact is byte-identical across the seam

- **WHEN** the same record, in the same repository state, is rendered before and after the seam exists
- **THEN** the two artifacts are byte-identical once their `> Last rendered:` stamp lines are stripped
  (the stamp being asserted present and well-formed separately), because the stamp is the only
  difference between two renders of the same record

#### Scenario: A store supplies the record but does not take over rendering

- **WHEN** a verb that writes the record and renders an artifact is invoked through the store the
  command line builds
- **THEN** the record and the rendered artifact are both written where they were written before, and
  the artifact's bytes depend on the record's content and not on which store produced it
