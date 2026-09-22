# Spec Delta

## MODIFIED Requirements

### Requirement: The suite has two halves with different triggers and different costs

The suite SHALL be divided into an **assertion** half and a **functional** half. The assertion half
SHALL be the half that runs on every commit; the functional half SHALL run only when the change under
test has touched something the functional half is the only thing able to verify.

The halves SHALL be distinguishable on disk, and the trigger that selects the functional half SHALL
be derived from the repository's own contents rather than from a list maintained by hand, so a
module added to the certified set later cannot silently fall outside it.

**The assertion half SHALL itself be divided into two RUNGS, and the division SHALL be by what a
test OBSERVES rather than by how fast it is.** The **unit rung** holds tests whose observable is a
**VALUE** the engine produced — a verb's result, a refusal, or any value the record holds — obtained
through the store the test supplies rather than by reading a path. A test asserting what the record
**SAYS** (the values in `state.json`) belongs to this rung and runs over an in-memory store; the rung
is the home of the record's values, not of its file. The **file rung** holds tests whose observable
is **BYTES on disk** — the rendered `PROJECT.md`, the record file itself, the write-conflict log, the
managed rules block — that is, a test that needs the bytes the engine WROTE to exist at a path. A
test whose observable is a value the store could hand it does not belong on the file rung merely
because that value is persisted in the record. Both rungs
are members of the assertion half by TRIGGER and by PROCESS: they run on every commit, and a commit
runs both in one invocation of one Node process. A rung is not a half — the functional trigger, the
functional half's membership and the change-triggered bucket are unchanged by this division, and
neither rung may spawn a process or reach git.

The two rungs SHALL be named on disk, so a test's rung is derived from its path and never declared in
a registry.

#### Scenario: A commit that touches nothing certified runs the assertion half only

- **WHEN** a commit's content changes no file in the certified set and no file either half is written
  in
- **THEN** the pre-commit gate runs both rungs of the assertion half in one process and does not run
  the functional half

#### Scenario: A commit that touches a certified module requires a fresh functional result

- **WHEN** a commit changes a file belonging to a module in the certified set
- **THEN** the pre-commit gate requires a fresh functional result for that module, refuses the commit
  when there is none, and names the run that would satisfy it — it does not start that run itself

#### Scenario: The unit rung is not a half and demands no functional counterpart

- **WHEN** a test is added under the unit rung and no test of any other kind carries its id
- **THEN** nothing is refused, because the unit rung is a rung of the assertion half rather than a
  third half, and the twin rule's one direction binds only the functional half

### Requirement: Every tracked test file has exactly one home, and the floor counts what the runner was given

The enumeration of the suite SHALL cover every tracked test file under the test directory, and each
one SHALL have exactly one home: the assertion half's unit rung, the assertion half's file rung, the
functional half, or a named change-triggered bucket whose run writes the record entry that covers it.
A tracked test file in none of them SHALL be a refusal that names the file — a file in no home is run
by nothing and counted by nothing, and that state SHALL NOT be reachable by silence. The
change-triggered bucket is not a half: its members run no git and start no engine, and the twin rule
does not reach them.

The pre-commit gate's test-count floor — the check that aborts a commit when the runner ran fewer
tests than the suite declares — SHALL enumerate the declared count from the tracked files of exactly
the set the runner was given in that invocation, and not from the runner's own glob nor from any
superset of it. Where one invocation is handed MORE THAN ONE rung, the declared count SHALL be
enumerated from the same list of rungs that invocation was handed, and from no rung it was not. What
the floor compares is what the runner RAN against what the runner was GIVEN, so the two counts agree
by construction on a healthy tree and can disagree only in the direction the floor exists to catch.

#### Scenario: A test file in neither half is refused

- **WHEN** a tracked test file exists under the test directory outside the four named homes
- **THEN** the pre-commit gate refuses the commit naming that file, rather than running and counting
  nothing

#### Scenario: A collapsed half still fires the floor

- **WHEN** the files the runner is handed for a rung are fewer than the tracked test files that rung
  holds — a glob that stopped matching a directory, or a file renamed out of it
- **THEN** the floor fires, because the declared count was enumerated from the tracked set and not
  from the same expansion the runner was handed

#### Scenario: A two-rung invocation's floor covers both rungs and neither more nor less

- **WHEN** the runner is handed the unit rung and the file rung in one invocation
- **THEN** the declared count is the tracked files of those two rungs together, and the floor does not
  abort on the functional half's or the change-triggered bucket's files, which that invocation was not
  given

#### Scenario: The change-triggered bucket is demanded only when its subject moves

- **WHEN** a commit changes engine source, in no rung of the assertion half
- **THEN** the gate demands a fresh run of the change-triggered bucket and names it, and the
  per-commit assertion half is unaffected

### Requirement: The assertion half spawns no process and runs no git

The assertion half SHALL run in a single Node process. It SHALL NOT start an engine subprocess, and
it SHALL NOT run a real `git` binary — git behaviour it depends on SHALL be supplied by an injected
double.

A test SHALL exist that fails when a file in the assertion half spawns a child process or invokes
git, so the property is enforced rather than merely intended. The guard SHALL observe the half at RUN
TIME as well as in its source: a git invocation reached by calling a library function directly — one
whose spawn is written three modules away, and never in the test file that caused it — is the same
violation and SHALL fail the half rather than the file only.

**The UNIT RUNG carries a further prohibition, and it is what makes the rung worth having: a test file
in it SHALL perform no filesystem work at all.** It SHALL NOT import the filesystem module, SHALL NOT
read, write, create or remove a path, and SHALL NOT flush a file to disk. This is the property the
rung exists for — the assertion half's cost was measured as durability flushing, thousands of calls
per run, on tests that assert on a value — so a unit-rung file that has drifted into doing disk work
SHALL fail a guard rather than merely run slowly, and the guard's refusal SHALL name the file and the
call shape it found.

#### Scenario: A spawn added to the assertion half fails a guard

- **WHEN** a file in the unit rung or the file rung is edited to spawn a child process or to run git
- **THEN** the guard test names that file and the assertion half fails

#### Scenario: The assertion half runs in one process

- **WHEN** the assertion half is run in the repository
- **THEN** the whole half — both rungs — is executed by one Node process, the run reports every file's
  tests from a single process with no per-file isolation, and the invocation starts no engine
  subprocess for any test in it

#### Scenario: A unit test that writes to disk fails a guard

- **WHEN** a file under the unit rung's directory is edited to read or write a file, or to import the
  filesystem module
- **THEN** the guard test names that file and the run fails, rather than the rung silently costing
  what the file rung costs

#### Scenario: The unit-rung guard is seen to discriminate

- **WHEN** the guard's check is exercised directly against a source that imports the filesystem module,
  against one that calls a write, and against one that only mentions either inside a comment
- **THEN** the first two are refused with the file named and the third is not refused, so the guard is
  a check that has been observed to fail rather than one assumed capable of it

## ADDED Requirements

### Requirement: A fixture is built once per file and restored per test

Where a file's tests share a starting repository, that repository SHALL be built ONCE for the file and
each test SHALL start from a RESTORATION of it rather than from a fresh build. The restoration SHALL
NOT re-run the engine and SHALL NOT perform a durability flush per file.

The restoration SHALL be faithful: a test that mutates the state, writes a record or moves the active
pointer SHALL NOT be able to affect the next test in the file, and a test that reads a file the
fixture built SHALL read the bytes the fixture wrote.

#### Scenario: A test that mutates the restored fixture does not affect the next test

- **WHEN** two tests in one file share a fixture and the first changes the state the second reads
- **THEN** the second sees the state the fixture was built with, not the first test's mutation

#### Scenario: Restoration does not re-run the engine

- **WHEN** a test restores a fixture that a previous test has already built
- **THEN** no engine subprocess is started and no engine verb is called to produce the restored tree

### Requirement: A rung's membership is decided by what a test observes, and a rung that stops observing it moves

A test SHALL be placed in the rung matching its observable at the moment it is written, and a test
whose observable changes SHALL move rungs in the same commit rather than staying where it was filed.
The two failure directions are both real and both silent: a test that observes a value but lives in
the file rung pays for filesystem work it does not read, and a test that observes a file but lives in
the unit rung either fails or, worse, passes while observing a stub instead of the artifact.

The guard on the unit rung is what makes the first direction loud. The second is loud by construction:
a unit-rung test that asserts on a file has to read one, and reading one is what the unit rung's guard
refuses.

#### Scenario: A test moved between rungs keeps its assertions

- **WHEN** a test whose observable is a value is moved from the file rung to the unit rung
- **THEN** its assertions are unchanged — the same values are asserted — and only the mechanism it
  obtains them through moves

#### Scenario: A unit test cannot satisfy its assertion from a stub of the artifact it stopped reading

- **WHEN** a test that asserts on a written file is filed in the unit rung
- **THEN** it is refused by the unit rung's guard rather than passing against a substitute, because
  the guard refuses the read the assertion would have needed
