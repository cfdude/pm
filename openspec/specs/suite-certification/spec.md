# suite-certification Specification

## Purpose
How this repository's test suite is divided into a half that must run on every commit and a half that
runs only when the thing it certifies has changed, how the two halves are held together so neither
drifts from the other, and how a claim that the slower half passed is recorded and checked
mechanically rather than remembered.

## Requirements

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
because that value is persisted in the record. Both rungs are members of the assertion half by
TRIGGER: they run on every commit, and a commit runs both in ONE invocation of the test runner, with
one count floor over both. How many processes that runner starts is the RUNNER's business and not a
property of the half — the runner MAY execute the half's files in parallel, one process per file. A
rung is not a half — the functional trigger, the functional half's membership and the
change-triggered bucket are unchanged by this division, and no test in either rung may spawn a
process or reach git.

The two rungs SHALL be named on disk, so a test's rung is derived from its path and never declared in
a registry.

#### Scenario: A commit that touches nothing certified runs the assertion half only

- **WHEN** a commit's content changes no file in the certified set and no file either half is written
  in
- **THEN** the pre-commit gate runs both rungs of the assertion half in one runner invocation and
  does not run the functional half

#### Scenario: A commit that touches a certified module requires a fresh functional result

- **WHEN** a commit changes a file belonging to a module in the certified set
- **THEN** the pre-commit gate requires a fresh functional result for that module, refuses the commit
  when there is none, and names the run that would satisfy it — it does not start that run itself

#### Scenario: The unit rung is not a half and demands no functional counterpart

- **WHEN** a test is added under the unit rung and no test of any other kind carries its id
- **THEN** nothing is refused, because the unit rung is a rung of the assertion half rather than a
  third half, and the twin rule's one direction binds only the functional half

#### Scenario: The runner's isolation mode is not a flag the gate probes for

- **WHEN** the pre-commit gate runs the assertion half on any supported Node major
- **THEN** it invokes the runner with the runner's default isolation, carries no probe for an
  isolation flag and no cached answer to one, and the same command line is used on every supported
  major

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

### Requirement: Every functional test has an assertion twin sharing its id

Every test in the functional half SHALL have an assertion twin in the assertion half, and the two
SHALL be identified by the same id. The id SHALL be derived from the two files' place on disk rather
than declared in a registry, so a pair whose halves are renamed apart is not silently paired with
something else.

The coverage SHALL hold in ONE direction: a functional test with no assertion twin is a refusal. An
assertion-half file with no functional twin is NOT a refusal and SHALL NOT be treated as one — a test
whose subject is not git's behaviour belongs in the assertion half precisely because it needs no real
git, and demanding a functional counterpart for it would either invent an empty one or pull every
assertion file into the triggered half.

#### Scenario: A functional test with no twin is refused

- **WHEN** a test is added to the functional half and no test carrying its id exists in the assertion
  half
- **THEN** the pre-commit gate refuses the commit, naming the missing id

#### Scenario: A functional test changed without its twin is refused

- **WHEN** a commit changes a functional test's file and does not change its assertion twin
- **THEN** the pre-commit gate refuses the commit, naming the id and the twin's path

### Requirement: The doubles cannot drift from the git they stand in for

The assertion half's git double SHALL answer with output that is byte-identical to what the real git
on the machine produces for the same invocation. The functional half SHALL include a check that
proves this against the real binary, so a difference introduced by a git version, a configuration or
an edit to the double is a failure rather than a silently wrong assertion.

Where the real output legitimately changes — a new git version formats a field differently — the
failure SHALL name the field that differs, and refreshing the double SHALL be a deliberate edit that
the record in the next requirement then re-certifies.

#### Scenario: A double that disagrees with live git fails

- **WHEN** the double's canned output for an invocation differs by even one byte from the real git's
  output for the same invocation
- **THEN** the functional half fails and names the invocation and the differing field

#### Scenario: A double captured against a frozen fixture does not rot

- **WHEN** the machine's git produces output a test author did not anticipate
- **THEN** the check fails visibly and names the difference, rather than the assertion half passing
  against a stale capture

### Requirement: A functional result is recorded and checked, never remembered

A passing run of the functional half SHALL record, for each module it certifies, what was certified,
over what content, and when. The record SHALL be durable and machine-readable.

The gate SHALL decide freshness from the RECORDED CONTENT, not from the age of the record and not
from a commit identity: a module whose content is unchanged SHALL NOT require a new run however long
ago the record was written, and a module whose content has changed SHALL require one however recent
the record is.

An assertion SHALL never satisfy this requirement. A module whose content changed SHALL require a
functional run even where the assertion half covers the same behaviour.

#### Scenario: An unchanged module needs no new run

- **WHEN** a module in the certified set has been untouched for months and a commit changes something
  else
- **THEN** no functional run is required, and the gate does not ask for one

#### Scenario: A changed module needs a new run however recent the record

- **WHEN** a module in the certified set is edited immediately after a certified run over it
- **THEN** the recorded content no longer matches the module, and the gate refuses the commit until
  the functional half is run again

#### Scenario: A stale record is not a silent pass

- **WHEN** the gate cannot find a record covering a changed module's content — no record at all, a
  record for another module, or a record over different content
- **THEN** the refusal names the module and the run that would satisfy it, and the commit does not
  proceed

### Requirement: The pre-commit gate checks the record without running the functional half

The checks that enforce the requirements above — the enrolment, the twin pair, the diff coupling and
the record's freshness — SHALL be performed by a script that reads files and runs in the pre-commit
gate. It SHALL NOT run the functional half, SHALL NOT spawn a test runner or the engine, and SHALL
NOT start a git fixture or drive git against a repository; reading the index through the permitted
read-only subcommands (what is tracked, what is staged, the staged bytes, where the common directory
is) is the whole of its access to git, and the set SHALL be enforced where the call is made. The
property being protected is that enforcing the link cannot start the thing whose result it is
checking, and cannot make every commit as slow as the thing the link exists to keep out of the way.

The script SHALL be development-only: it SHALL NOT be part of what the plugin ships, and it SHALL
add no runtime or development dependency.

#### Scenario: The gate stays fast

- **WHEN** the pre-commit gate runs on a commit that touches a certified module
- **THEN** the refusal or the acceptance is produced by reading files, with no engine process and no
  git fixture started by the check itself

#### Scenario: The script is not shipped

- **WHEN** the plugin's shipped files are enumerated
- **THEN** the drift script is not among them, and the engine's dependency count is unchanged

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

Neither direction is made loud by the unit rung's guard: the guard scans `scripts/test/unit/` only, so
a test left on the file rung that asserts on the record's values goes undetected. What carries the
first direction is the per-file judgment of the migration (task 4.1), which sorts a file's tests by
observable as each file moves. The second direction is loud where the test actually reads: a
unit-rung test that asserts on a file has to read one, and reading one is what the unit rung's guard
refuses.

#### Scenario: A test moved between rungs keeps its assertions

- **WHEN** a test whose observable is a value is moved from the file rung to the unit rung
- **THEN** its assertions are unchanged — the same values are asserted — and only the mechanism it
  obtains them through moves

#### Scenario: A unit test cannot satisfy its assertion from a stub of the artifact it stopped reading

- **WHEN** a test that asserts on a written file is filed in the unit rung
- **THEN** it is refused by the unit rung's guard rather than passing against a substitute, because
  the guard refuses the read the assertion would have needed

### Requirement: No test in the assertion half spawns a process or runs git

No TEST in the assertion half SHALL start a child process: a test SHALL NOT start an engine
subprocess, and it SHALL NOT run a real `git` binary — git behaviour it depends on SHALL be supplied
by an injected double. The prohibition binds the half's TESTS and the fixtures they call; it does not
bind the test RUNNER, which MAY start one process per test file and is the only thing in the per-commit
path that runs work in parallel.

A test SHALL exist that fails when a file in the assertion half spawns a child process or invokes
git, so the property is enforced rather than merely intended. The guard SHALL observe the half at RUN
TIME as well as in its source: a git invocation reached by calling a library function directly — one
whose spawn is written three modules away, and never in the test file that caused it — is the same
violation and SHALL fail the run. Because the runner MAY give every file its own process, the run-time
observation SHALL be installed in EVERY process the runner starts for the half: every test file of
both rungs SHALL install it itself, rather than relying on another file having installed it in a
process they share, and a rung file that does not install it SHALL be refused by the source guard
with the file named.

**The UNIT RUNG carries a further prohibition, and it is what makes the rung worth having: a test file
in it SHALL perform no filesystem work at all.** It SHALL NOT import the filesystem module, SHALL NOT
read, write, create or remove a path, and SHALL NOT flush a file to disk. This is the property the
rung exists for — the assertion half's cost was measured as durability flushing, thousands of calls
per run, on tests that assert on a value — so a unit-rung file that has drifted into doing disk work
SHALL fail a guard rather than merely run slowly, and the guard's refusal SHALL name the file and the
call shape it found. The run-time git counter that every rung file installs (above) is not the TEST's
filesystem work: the harness installs it at import time and removes its directory at process exit,
both outside any test's window. The unit rung's run-time filesystem counter watches only while a test
runs, and its source scan reads the test file's own code, never the harness it imports — so the two
rules do not collide.

#### Scenario: A spawn added to the assertion half fails a guard

- **WHEN** a file in the unit rung or the file rung is edited to spawn a child process or to run git
- **THEN** the guard test names that file and the assertion half fails

#### Scenario: The runner parallelizes and the tests still spawn nothing

- **WHEN** the assertion half is run in the repository, under the runner's default process-per-file
  isolation
- **THEN** every file's tests run, the run reports one summary for both rungs, and no test in either
  rung starts an engine subprocess or runs a real `git`

#### Scenario: A real git call in any file's process fails the run

- **WHEN** a test in a file that does not share a process with any other test file reaches the real
  `git` binary through a library call
- **THEN** that file's process reports the invocation and the run fails, exactly as it would if the
  file had shared a process with the rest of the half

#### Scenario: A rung file that does not install the run-time counter is refused

- **WHEN** a test file is added to either rung without installing the run-time git counter itself
- **THEN** the source guard names that file and the run fails, rather than the file running with the
  real `git` reachable and nothing counting

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

### Requirement: Every run the suite is counted from reads one summary format, and a count it cannot read refuses

Every place that runs a bucket of the suite in order to COUNT it — the pre-commit gate, each of CI's
bucket steps, the runner that writes the certification record, and the release procedure's published
test count — SHALL force the same test reporter and SHALL disable colour in that reporter's output, so
the summary line is the same bytes on every supported Node major and under any colour setting the
environment carries. Each of those places SHALL parse exactly that one format.

A run whose summary cannot be parsed, or whose summary reports zero tests, SHALL be a refusal at every
one of those places, and SHALL NOT be reported as a pass. The count floor is only as good as the count
it reads: a floor skipped because the count was unreadable is a floor that did not run.

Where a place also holds a declared count, the count floor SHALL be compared FIRST: a run that reports
fewer tests than are declared — zero included — is refused as a shortfall naming both counts. Only when
the declared count is itself zero is the refusal that the bucket holds no test file, so a run that
collapsed while the index still holds tests is never reported as an empty bucket.

A pattern handed to the runner that matches no file SHALL NOT fail the run on its own: the files the
other patterns matched still run and are counted, and the count floor, not the unmatched pattern,
decides whether anything is missing.

#### Scenario: A colour setting in the environment does not change the count

- **WHEN** the assertion half is run by the pre-commit gate in an environment that forces colour
  output
- **THEN** the gate reads the same test count it reads without that setting, and the floor compares
  it

#### Scenario: An unreadable summary refuses the commit

- **WHEN** the runner exits zero but its output carries no summary line in the format the gate parses
- **THEN** the gate refuses the commit and says the count could not be read, rather than reporting the
  tests as passing and skipping the floor

#### Scenario: A run of zero tests refuses the commit

- **WHEN** neither rung of the assertion half holds a tracked test file, so the declared count is zero
  and the runner reports zero tests
- **THEN** the gate refuses the commit naming the two rungs it found empty, and at no point is the
  runner invoked without a path — which would fall back to the runner's default discovery and reach
  the triggered halves

#### Scenario: A collapsed run is a shortfall, not an empty rung

- **WHEN** the rungs' tracked files declare tests but the runner reports zero
- **THEN** the gate refuses the commit as a shortfall naming both counts, and does not say the rungs
  hold no test file

#### Scenario: A CI bucket that ran nothing fails

- **WHEN** a CI bucket step's runner reports zero tests, whatever its declared count
- **THEN** the step fails, rather than passing because zero is not less than zero

#### Scenario: One rung that matches nothing does not stop the other

- **WHEN** one rung's directory holds no test file while the other rung's does
- **THEN** the other rung's tests run and are counted, the run is not refused for the unmatched
  pattern, and the count floor compares what ran against what the index declares

#### Scenario: The same summary on every supported major

- **WHEN** the same test files are run under the forced reporter on each supported Node major
- **THEN** the summary lines are byte-identical apart from the reported duration

### Requirement: A test that waits asynchronously on a child process bounds the wait

A test that starts a child process ASYNCHRONOUSLY and waits for the child's close or exit event SHALL
bound that wait. When the bound expires the test SHALL kill the child and SHALL fail, naming the
invocation that did not finish and the bound it exceeded. A hung child SHALL therefore cost one failed
test, never a run that does not end.

A source check SHALL exist that refuses a test-suite helper which waits on a child's close or exit
event — through an event listener, a one-shot listener, or the events module's promise form — without
a bound, so a sibling of a fixed helper cannot reintroduce the hang unnoticed.

A SYNCHRONOUS spawn is outside this requirement: it blocks one test file's process rather than leaving
an awaited promise unresolved, most of the suite's synchronous spawns carry no per-call bound today,
and in CI every one of them is bounded by the job's time limit. This requirement does not claim more
than that.

#### Scenario: A hung child fails its test instead of hanging the run

- **WHEN** a child a test is waiting on never exits
- **THEN** the child is killed when the bound expires, the test fails with a message naming the
  invocation and the bound, and the rest of the run proceeds

#### Scenario: An unbounded wait is refused at the source

- **WHEN** a helper in the suite is written to wait for a child's close or exit event with no bound,
  in any of the three forms
- **THEN** the source check names the file and the run fails
