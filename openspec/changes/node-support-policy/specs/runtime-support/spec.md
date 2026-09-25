# Spec Delta

## Purpose

Which Node.js majors pm supports, where the lowest of them (the support floor) is declared, how CI
proves pm on every supported major, and how a session is told when the Node running pm is below the
support floor.

## ADDED Requirements

### Requirement: pm supports exactly the long-term-support lines that are not end-of-life, and the support floor is declared once in the engine

A Node major is **supported** by pm exactly when its entry in the Node.js release schedule carries a
long-term-support date (the date may still be in the future), its start date is on or before today,
and its end-of-life date is after today — "today" being the UTC date. That set is the same set CI
tests (next requirement), so "supported" and "tested" name one set and never two.

Every other major is **unsupported**, including a major at or above the support floor that carries no
long-term-support date (for example 23, 25 and 27) and a major whose end-of-life date has passed (for
example 18 and 20). pm makes no claim for an unsupported major and CI does not test one.

The **support floor** is the lowest supported major. It is distinct from the test-count floor the
suite's gates compare, and it is always called the support floor. The support floor SHALL be declared
as ONE constant in the engine, and every engine behaviour that depends on it SHALL read that
constant. The constant SHALL be updated as part of cutting a release, by a step in the release
procedure that compares it against the published schedule. The engine SHALL NOT fetch, download or
otherwise contact the schedule, or anything else, to learn or check the support floor; the engine
opens no network connection, and this requirement does not create an exception to that. Because the
engine holds only the constant and never the schedule, it can tell a Node below the support floor
from one at or above it, and cannot tell a supported major from an unsupported one above the support
floor; it SHALL NOT claim to.

The support floor SHALL agree with the list of majors CI falls back to (next requirement): the lowest
major in that list SHALL equal the engine's support floor, and a per-commit check SHALL fail when they
differ, naming both values. Every place in the repository's own documentation that states the support
floor as a number SHALL agree with the constant, and a per-commit check SHALL fail naming the file and
both values when one does not.

#### Scenario: The supported set and the support floor on 2026-09-24

- **WHEN** the schedule gives 22 an end-of-life date of 2027-04-30 with a long-term-support date, 24
  an end-of-life date of 2028-04-30 with a long-term-support date, 26 a start date of 2026-05-05 with
  a long-term-support date of 2026-10-28, and 25 no long-term-support date, and today is 2026-09-24
- **THEN** the supported majors are 22, 24 and 26, the support floor is 22, and 18, 20 and 25 are
  unsupported

#### Scenario: The support floor and CI's fallback list cannot drift apart silently

- **WHEN** the engine's support-floor constant and the lowest major in CI's committed fallback list
  differ
- **THEN** the per-commit check fails and names both values

#### Scenario: A documented support floor that disagrees with the constant fails

- **WHEN** the repository's user-facing requirements line states a Node major that differs from the
  engine's support-floor constant
- **THEN** the per-commit check fails, naming the file and both values

#### Scenario: The engine learns the support floor without the network

- **WHEN** any engine verb runs
- **THEN** the support floor it uses is the declared constant, and no network connection is opened to
  obtain or verify it

### Requirement: CI tests every supported major, computed from the schedule

CI SHALL run the test job once per supported major (previous requirement) at the time CI runs. The set
SHALL be COMPUTED when CI runs, from the Node.js release schedule, and SHALL NOT be a hand-typed list
of versions. Each of the three conditions — a start date on or before today, an end-of-life date after
today, and a long-term-support date present — SHALL be applied, and each SHALL be exercised by a
per-commit check against a canned schedule in which that condition alone decides an entry.

CI MAY use the network to read the schedule; that permission is CI's and does not extend to the
engine. When the schedule cannot be fetched, CI SHALL use a list of majors committed to the repository
and SHALL say so visibly, as a warning on the run. A fetch that SUCCEEDS but returns a body that is not
a schedule CI can read SHALL fail CI rather than fall back: the fallback is for an unreachable
schedule, not an unreadable one. Whenever the schedule is fetched and read, the computed set SHALL
equal the committed list, and a difference SHALL fail CI and name both sets. A computed set that is
empty SHALL fail CI. A set silently computed from nothing is the failure this requirement exists to
prevent.

The status check that branch protection requires SHALL remain a single check, and it SHALL pass only
when the set was computed or fell back as above AND every per-major run of the test job passed. A
per-major run that fails SHALL NOT stop the other majors from running, so a failure names every major
it occurs on. A per-major run that did not run at all SHALL count as a failure of the required check,
never as a pass.

The security scans are not part of this requirement and SHALL stay single-version.

#### Scenario: Today's set is 22, 24 and 26

- **WHEN** CI computes the set on 2026-09-24 from the schedule of the previous requirement's scenario
- **THEN** the test job runs on 22, 24 and 26, and not on 18, 20 or 25

#### Scenario: Each condition of the filter decides on its own

- **WHEN** the computation is given a canned schedule holding an entry that has a long-term-support
  date but starts after today, an entry that is live today but has no long-term-support date, and an
  entry that is live today with a long-term-support date still in the future
- **THEN** only the third entry is in the set

#### Scenario: A failed fetch falls back visibly

- **WHEN** CI cannot fetch the schedule
- **THEN** the test job runs on the committed list, and the run carries a warning saying the list is
  the committed fallback rather than a computed set

#### Scenario: An unreadable schedule fails instead of falling back

- **WHEN** the fetch succeeds but the body is not a readable schedule
- **THEN** CI fails, naming the schedule as unreadable, and no per-major run starts on the fallback

#### Scenario: A stale committed list fails CI

- **WHEN** the schedule is fetched and read, and the computed set differs from the committed list
- **THEN** CI fails, naming the computed set and the committed list

#### Scenario: The required check cannot pass on a leg that did not run

- **WHEN** the job that computes the set fails, so no per-major run starts
- **THEN** the required status check fails, rather than passing because the runs it depends on were
  skipped

#### Scenario: One failing major does not hide another

- **WHEN** the test job fails on one major
- **THEN** the runs on the other majors still complete and report, and the required check fails

### Requirement: The session briefing warns when the running Node is below the support floor

When pm's SessionStart briefing is produced by a Node whose major version is below the engine's support
floor, the briefing SHALL carry exactly ONE line saying so. The line SHALL name the running version and
the support floor, and it SHALL say that pm still runs. The line is a WARNING, not a refusal: the
verb's exit status and every other part of its output SHALL be what they would be on a supported Node.
This line is the one change this capability makes to what a verb prints, and it appears only below the
support floor.

A Node at or above the support floor SHALL get no line, whether or not its major is supported: the
engine holds no schedule (first requirement), so it cannot tell an unsupported major above the support
floor, such as 25, from a supported one, and it SHALL NOT guess.

The version the warning is decided from SHALL be the one the invocation supplies (engine-invocation's
per-call runtime version), so both sides of the comparison can be exercised without an unsupported
Node installed. A running version that cannot be parsed SHALL produce no warning — "cannot tell" is
not "below the support floor". Where the running version appears in the line, it SHALL be escaped the
way any other externally supplied value in engine output is escaped.

The warning SHALL appear ONLY in the SessionStart briefing, which is the surface that reaches a
session. It SHALL NOT appear in the rendered project document, which is a tracked file shared by
everyone who works in the repository and would otherwise carry one machine's runtime into it. It SHALL
NOT appear in the pre-compaction snapshot either. A repository in which pm has not been initialized
SHALL stay silent, as the briefing already does.

#### Scenario: A Node below the support floor gets one warning line

- **WHEN** the SessionStart briefing is produced in an initialized repository by an invocation whose
  runtime version is 20.20.2 and the support floor is 22
- **THEN** the briefing carries exactly one line naming 20.20.2 and 22, and the verb exits with the
  same status it exits with on a supported Node

#### Scenario: A Node at or above the support floor gets no warning

- **WHEN** the SessionStart briefing is produced by an invocation whose runtime version's major is 22
  or higher and the support floor is 22 — including an unsupported major above it, such as 25
- **THEN** the briefing carries no runtime-support line

#### Scenario: An unparseable version gets no warning

- **WHEN** the invocation's runtime version cannot be parsed as a Node version
- **THEN** the briefing carries no runtime-support line

#### Scenario: The rendered project document never carries the warning

- **WHEN** the project document is rendered, or the pre-compaction snapshot is written, by an
  invocation whose runtime version is below the support floor
- **THEN** neither artifact contains the runtime-support line

#### Scenario: An uninitialized repository stays silent

- **WHEN** the SessionStart briefing runs below the support floor in a repository where pm has not
  been initialized
- **THEN** it prints nothing, exactly as it does on a supported Node
