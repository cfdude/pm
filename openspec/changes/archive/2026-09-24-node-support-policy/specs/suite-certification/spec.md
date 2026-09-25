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

## REMOVED Requirements

### Requirement: The assertion half spawns no process and runs no git

**Reason**: Its first sentence — "The assertion half SHALL run in a single Node process" — and its
scenario *"The assertion half runs in one process"* describe a runner mode this change retires
(design D3: process-per-file measured 13.0–13.5 s against 24.2–27.4 s single-process on Node 22, 24
and 26). A MODIFIED block cannot drop a scenario the main spec still holds, so the requirement is
removed and restated under a name that says what it now binds: the half's TESTS, not its runner.

**Migration**: Replaced by the ADDED requirement *"No test in the assertion half spawns a process or
runs git"* below, which keeps every prohibition this one carried (no engine subprocess, no real
`git`, the run-time counter, the unit rung's no-filesystem rule and its discrimination scenario) and
adds that the run-time counter is installed in every process the runner starts. The pre-commit gate
and CI drop `--test-isolation=none` and the probe for it in the same change.

## ADDED Requirements

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
