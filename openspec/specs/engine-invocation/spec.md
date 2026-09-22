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
