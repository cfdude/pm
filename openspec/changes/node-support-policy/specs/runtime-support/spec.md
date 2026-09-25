# Spec Delta

## Purpose

Which Node.js majors pm supports, where that support floor is declared, how CI proves pm on every
supported line, and how a session is told when the Node running pm is below the floor.

## ADDED Requirements

### Requirement: pm supports the oldest Node major that is not end-of-life, declared once in the engine

pm SHALL support every Node major from the oldest one that has not reached its end-of-life date, as
published in the Node.js release schedule, upward. That oldest supported major is the **floor**.

The floor SHALL be declared as ONE constant in the engine, and every engine behaviour that depends on
the floor SHALL read that constant. The constant SHALL be updated as part of cutting a release, by a
step in the release procedure that compares it against the published schedule. The engine SHALL NOT
fetch, download or otherwise contact the schedule, or anything else, to learn or check the floor. The
engine opens no network connection, and this requirement does not create an exception to that.

The floor SHALL agree with the list of supported majors CI falls back to (next requirement): the
lowest major in that list SHALL equal the engine's floor, and a per-commit check SHALL fail when they
differ, naming both values.

#### Scenario: The floor is the oldest non-end-of-life major

- **WHEN** the engine's floor is read on a release cut dated before 2027-04-30, the end-of-life date
  the schedule gives for 22
- **THEN** it is 22 — the oldest major whose end-of-life date has not passed — and 18 and 20, whose
  end-of-life dates have passed, are not supported

#### Scenario: The floor and CI's fallback list cannot drift apart silently

- **WHEN** the engine's floor constant and the lowest major in CI's committed fallback list differ
- **THEN** the per-commit check fails and names both values

#### Scenario: The engine learns the floor without the network

- **WHEN** any engine verb runs
- **THEN** the floor it uses is the declared constant, and no network connection is opened to obtain
  or verify it

### Requirement: CI tests every supported long-term-support line, computed from the schedule

CI SHALL run the test job once per Node major that is supported at the time CI runs. The set SHALL be
COMPUTED when CI runs, from the Node.js release schedule, and SHALL NOT be a hand-typed list of
versions. The set SHALL be every major whose schedule entry has a start date on or before today and
an end-of-life date after today — "today" being the UTC date — AND which carries a long-term-support
date. An entry that carries a long-term-support date is included even when that date is still in the
future, and an odd-numbered major with no long-term-support date is not included.

CI MAY use the network to read the schedule; that permission is CI's and does not extend to the
engine. When the schedule cannot be fetched, CI SHALL use a list of majors committed to the repository
and SHALL say so visibly, as a warning on the run. Whenever the schedule CAN be fetched, the computed
set SHALL equal the committed list, and a difference SHALL fail CI and name both sets. A computed set
that is empty SHALL fail CI. A set silently computed from nothing is the failure this requirement
exists to prevent.

The status check that branch protection requires SHALL remain a single check, and it SHALL pass only
when the set was computed or fell back as above AND every per-major run of the test job passed. A
per-major run that fails SHALL NOT stop the other majors from running, so a failure names every major
it occurs on. A per-major run that did not run at all SHALL count as a failure of the required check,
never as a pass.

The security scans are not part of this requirement and SHALL stay single-version.

#### Scenario: Today's set is 22, 24 and 26

- **WHEN** CI computes the set on 2026-09-24 from a schedule in which 22 ends 2027-04-30, 24 ends
  2028-04-30, 26 started 2026-05-05 with a long-term-support date of 2026-10-28, and 25 has no
  long-term-support date
- **THEN** the test job runs on 22, 24 and 26, and not on 18, 20 or 25

#### Scenario: A failed fetch falls back visibly

- **WHEN** CI cannot fetch the schedule
- **THEN** the test job runs on the committed list, and the run carries a warning saying the list is
  the committed fallback rather than a computed set

#### Scenario: A stale committed list fails CI

- **WHEN** the schedule is fetched and the computed set differs from the committed list
- **THEN** CI fails, naming the computed set and the committed list

#### Scenario: The required check cannot pass on a leg that did not run

- **WHEN** the job that computes the set fails, so no per-major run starts
- **THEN** the required status check fails, rather than passing because the runs it depends on were
  skipped

#### Scenario: One failing major does not hide another

- **WHEN** the test job fails on one major
- **THEN** the runs on the other majors still complete and report, and the required check fails

### Requirement: The session briefing warns when the running Node is below the floor

When pm's SessionStart briefing is produced by a Node whose major version is below the engine's
floor, the briefing SHALL carry exactly ONE line saying so. The line SHALL name the running version
and the floor, and it SHALL say that pm still runs. The line is a WARNING, not a refusal: the verb's
exit status and every other part of its output SHALL be what they would be on a supported Node.

The version the warning is decided from SHALL be the one the invocation supplies (engine-invocation's
per-call runtime version), so both sides of the comparison can be exercised without an unsupported
Node installed. A running version that cannot be parsed SHALL produce no warning — "cannot tell" is
not "below the floor". Where the running version appears in the line, it SHALL be escaped the way any
other externally supplied value in engine output is escaped.

The warning SHALL appear ONLY in the SessionStart briefing, which is the surface that reaches a
session. It SHALL NOT appear in the rendered project document, which is a tracked file shared by
everyone who works in the repository and would otherwise carry one machine's runtime into it. It SHALL
NOT appear in the pre-compaction snapshot either. A repository in which pm has not been initialized
SHALL stay silent, as the briefing already does.

#### Scenario: A Node below the floor gets one warning line

- **WHEN** the SessionStart briefing is produced in an initialized repository by an invocation whose
  runtime version is 20.20.2 and the floor is 22
- **THEN** the briefing carries exactly one line naming 20.20.2 and 22, and the verb exits with the
  same status it exits with on a supported Node

#### Scenario: A Node at or above the floor gets no warning

- **WHEN** the SessionStart briefing is produced by an invocation whose runtime version's major is 22
  or higher and the floor is 22
- **THEN** the briefing carries no runtime-support line

#### Scenario: An unparseable version gets no warning

- **WHEN** the invocation's runtime version cannot be parsed as a Node version
- **THEN** the briefing carries no runtime-support line

#### Scenario: The rendered project document never carries the warning

- **WHEN** the project document is rendered, or the pre-compaction snapshot is written, by an
  invocation whose runtime version is below the floor
- **THEN** neither artifact contains the runtime-support line

#### Scenario: An uninitialized repository stays silent

- **WHEN** the SessionStart briefing runs below the floor in a repository where pm has not been
  initialized
- **THEN** it prints nothing, exactly as it does on a supported Node
