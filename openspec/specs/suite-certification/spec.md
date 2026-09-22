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

#### Scenario: A commit that touches nothing certified runs the assertion half only

- **WHEN** a commit's content changes no file in the certified set and no file either half is written
  in
- **THEN** the pre-commit gate runs the assertion half and does not run the functional half

#### Scenario: A commit that touches a certified module requires a fresh functional result

- **WHEN** a commit changes a file belonging to a module in the certified set
- **THEN** the pre-commit gate requires a fresh functional result for that module, refuses the commit
  when there is none, and names the run that would satisfy it — it does not start that run itself

### Requirement: Every tracked test file has exactly one home, and the floor counts what the runner was given

The enumeration of the suite SHALL cover every tracked test file under the test directory, and each
one SHALL have exactly one home: the assertion half, the functional half, or a named
change-triggered bucket whose run writes the record entry that covers it. A tracked test file in none
of them SHALL be a refusal that names the file — a file in neither half is run by nothing and counted
by nothing, and that state SHALL NOT be reachable by silence. The change-triggered bucket is not a
third half: its members run no git and start no engine, and the twin rule does not reach them.

The pre-commit gate's test-count floor — the check that aborts a commit when the runner ran fewer
tests than the suite declares — SHALL enumerate the declared count from the tracked files of exactly
the set the runner was given in that invocation, and not from the runner's own glob nor from any
superset of it. What the floor compares is what the runner RAN against what the runner was GIVEN, so
the two counts agree by construction on a healthy tree and can disagree only in the direction the
floor exists to catch.

#### Scenario: A test file in neither half is refused

- **WHEN** a tracked test file exists under the test directory outside both halves and outside the
  named change-triggered bucket
- **THEN** the pre-commit gate refuses the commit naming that file, rather than running and counting
  nothing

#### Scenario: A collapsed half still fires the floor

- **WHEN** the files the runner is handed for a half are fewer than the tracked test files that half
  holds — a glob that stopped matching a directory, or a file renamed out of it
- **THEN** the floor fires, because the declared count was enumerated from the tracked set and not
  from the same expansion the runner was handed

#### Scenario: The change-triggered bucket is demanded only when its subject moves

- **WHEN** a commit changes engine source, in neither half
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

#### Scenario: A spawn added to the assertion half fails a guard

- **WHEN** a file in the assertion half is edited to spawn a child process or to run git
- **THEN** the guard test names that file and the assertion half fails

#### Scenario: The assertion half runs in one process

- **WHEN** the assertion half is run in the repository
- **THEN** the whole half is executed by one Node process — the run reports every file's tests from a
  single process, with no per-file isolation — and the invocation starts no engine subprocess for any
  test in it

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
