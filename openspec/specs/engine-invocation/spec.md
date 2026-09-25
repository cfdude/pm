# engine-invocation Specification

## Purpose
The contract under which the `pm` engine can be invoked from inside a running Node process — what the
caller supplies, what the engine returns, and the guarantee that the status it returns is the status
the command-line binary exits with — so the engine's behaviour can be exercised without paying for a
process boundary per assertion.

## Requirements

### Requirement: The engine can be invoked without ending the process

The engine SHALL expose an in-process entry point that accepts the invocation's arguments and a
context carrying the caller's working directory, input stream, output streams and environment, and
that RETURNS a numeric exit status. An invocation through this entry point SHALL NOT terminate the
calling process, whatever it is refused for and whatever exit status it would have produced.

The entry point SHALL NOT require the caller to intercept or replace any global that the Node
runtime owns. A caller that supplies its own streams SHALL receive the engine's output on those
streams; nothing the engine prints for that invocation SHALL reach the process's own stdout or
stderr.

#### Scenario: A refused invocation returns its status and the process survives

- **WHEN** the entry point is called in-process with an argument list the engine refuses, such as an
  undeclared flag on a dispatched verb
- **THEN** it returns the status the binary would have exited with, no exception escapes it, the
  calling process is still running, and the caller's stderr holds the refusal message

#### Scenario: An accepted invocation returns zero

- **WHEN** the entry point is called in-process with an argument list the engine accepts, such as a
  read-only verb against an initialized record
- **THEN** it returns 0 and the caller's stdout holds the verb's output

#### Scenario: An invocation that is refused by a hook verb does not exit the caller

- **WHEN** the entry point is called in-process for a hook verb whose payload the engine refuses
- **THEN** it returns that verb's status, and the calling process is still running

### Requirement: Every global the engine reads is supplied per call

The engine SHALL take the working directory it acts on, the argument list it reads, the environment
it consults, the input it drains and the streams it writes from the current invocation, never from a
value captured when a module was first loaded.

Two invocations through the entry point in ONE process SHALL be independent: each SHALL read its own
arguments, act on its own working directory, write to its own streams and see its own environment.
Neither SHALL be able to observe or be affected by the other's values.

#### Scenario: Two roots in one process do not observe each other

- **WHEN** the entry point is called twice in one process against two different working directories,
  the first having initialized a conductor record and the second not
- **THEN** the first call acts on the first directory and the second on the second — each read and
  each write lands under the directory that call was given

#### Scenario: The argument list is the one the caller passed

- **WHEN** the entry point is called in-process with an argument list that differs from the running
  process's own
- **THEN** the engine acts on the caller's argument list, and the calling process's own arguments are
  neither read nor modified

#### Scenario: Output does not leak to the process's streams

- **WHEN** the entry point is called in-process with caller-supplied output streams and a verb that
  writes both a result and a warning
- **THEN** the caller's streams hold both, and the calling process's stdout and stderr hold neither

### Requirement: A returned status equals the status the binary exits with

For every class of invocation the engine has — success, a help request, a command-line refusal, an
unknown verb, a write conflict, an unreadable input, a hook refusal that blocks, and a hook refusal
that warns — the status the in-process entry point RETURNS SHALL equal the status the command-line
binary exits with for the same arguments in the same repository state.

This requirement names classes and does not define them; the refusal classes themselves, and the
guarantee that a refused command line writes nothing, belong to the `verb-surface` capability and are
unchanged by this change.

#### Scenario: Each class's returned status is pinned against a real invocation

- **WHEN** the engine is run as a command-line binary and through the entry point in-process, for the
  same arguments and the same repository state, once for every class this requirement names
- **THEN** for every class the two statuses are equal, and a class whose two statuses disagree fails

#### Scenario: A refusal that warns still returns zero

- **WHEN** an invocation is refused in the class whose status is zero — a session-start refusal that
  reports a warning rather than a failure
- **THEN** the entry point returns 0, matching the binary, which exits 0 having written the warning
  to its standard output

### Requirement: The command-line binary's observable behaviour is unchanged

The engine's entry points from outside the process SHALL behave as they did before this change: the
same verbs, the same accepted and refused command lines, the same exit statuses, and the same bytes
on stdout and stderr. The engine SHALL continue to be a single file a hook or a command doc runs
directly, with no build step and no runtime dependency.

#### Scenario: A hook invocation is still a direct process invocation

- **WHEN** each engine invocation registered in the plugin's hook configuration is run as the
  process it registers
- **THEN** each exits with the status that invocation is documented to produce — including the
  blocking status a hook relies on — and nothing in the invocation requires a caller other than the
  process itself

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

**The in-memory store covers the RECORD and the artifacts the store owns — not every byte a verb may
write.** The store owns the record directory and the rendered artifact, and that boundary is stated
where it is drawn rather than inferred from this requirement: a verb that also refreshes a
repository file the store does not own — the `CLAUDE.md` managed rules block, `.gitignore` — still
writes that file, through the same code path as before, whichever store it was handed. So a
verb's disk footprint under an in-memory store is its STORE-OWNED footprint only: no record, no
rendered artifact, no stamp, no log a forwarding site appends to. A verb's non-store writes are
outside this requirement's subject and are neither forbidden here nor excused by it.

#### Scenario: A verb produces the same result through an in-memory store as through the disk store

- **WHEN** the same accepted invocation is made twice in one process, once with the store the command
  line builds and once with a store that keeps the record in memory
- **THEN** the status is the same, the record the caller can read afterwards holds the same values,
  and the invocation that used the in-memory store wrote none of the artifacts the store owns — no
  record, no rendered artifact, no stamp, no log

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
