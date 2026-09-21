# Spec Delta

## Purpose

How this repository's test suite is divided into a half that must run on every commit and a half that
runs only when the thing it certifies has changed, how the two halves are held together so neither
drifts from the other, and how a claim that the slower half passed is recorded and checked
mechanically rather than remembered.

## ADDED Requirements

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

#### Scenario: A commit that touches a certified module runs the functional half

- **WHEN** a commit changes a file belonging to a module in the certified set
- **THEN** the pre-commit gate requires a fresh functional result for that module and refuses the
  commit when there is none

### Requirement: The assertion half spawns no process and runs no git

The assertion half SHALL run in a single Node process. It SHALL NOT start an engine subprocess, and
it SHALL NOT run a real `git` binary — git behaviour it depends on SHALL be supplied by an injected
double.

A test SHALL exist that fails when a file in the assertion half spawns a child process or invokes
git, so the property is enforced rather than merely intended.

#### Scenario: A spawn added to the assertion half fails a guard

- **WHEN** a file in the assertion half is edited to spawn a child process or to run git
- **THEN** the guard test names that file and the assertion half fails

#### Scenario: The assertion half runs in one process

- **WHEN** the assertion half is run in the repository
- **THEN** the whole half is executed by one Node process, and its duration is not dominated by
  process startup

### Requirement: Every functional test has an assertion twin sharing its id

Every test in the functional half SHALL have an assertion twin in the assertion half, and the two
SHALL be identified by the same id. The id SHALL be derived from the two files' place on disk rather
than declared in a registry, so a pair whose halves are renamed apart is not silently paired with
something else.

The two halves' id sets SHALL be equal at every commit: a functional test with no assertion twin, and
an assertion twin with no functional test, are both refusals.

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

The check that enforces the three requirements above SHALL be performed by a script that reads files
and runs in the pre-commit gate. It SHALL NOT run the functional half, drive git against a
repository, or spawn the engine, so that enforcing the link cannot make every commit as slow as the
thing the link exists to keep out of the way.

The script SHALL be development-only: it SHALL NOT be part of what the plugin ships, and it SHALL
add no runtime or development dependency.

#### Scenario: The gate stays fast

- **WHEN** the pre-commit gate runs on a commit that touches a certified module
- **THEN** the refusal or the acceptance is produced by reading files, with no engine process and no
  git fixture started by the check itself

#### Scenario: The script is not shipped

- **WHEN** the plugin's shipped files are enumerated
- **THEN** the drift script is not among them, and the engine's dependency count is unchanged
