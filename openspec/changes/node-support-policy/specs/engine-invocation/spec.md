# Spec Delta

## ADDED Requirements

### Requirement: The runtime version the engine consults is supplied per call

Where the engine's behaviour depends on the version of the Node runtime executing it, the engine SHALL
take that version from the CURRENT INVOCATION, in the same way and by the same rule as the working
directory, the argument list, the environment, the input, the streams and the record store — never by
reading the running process's own version at the point of use, and never from a value captured when a
module was first loaded.

A caller SHALL be able to supply the version for one invocation. When the caller supplies none, the
invocation SHALL carry the version of the process that is running it, so the command line's behaviour
is exactly what it would be without this seam. Two invocations in one process that supply different
versions SHALL be independent: each SHALL see its own, and neither SHALL observe the other's.

This requirement owns only the SEAM — that the version is a per-call value. What the engine does with
the version is owned by the capability whose behaviour depends on it.

#### Scenario: A supplied version is the version the invocation consults

- **WHEN** the entry point is called in-process with a runtime version that differs from the running
  process's own
- **THEN** every decision the engine makes from the runtime version in that invocation is made from
  the supplied one

#### Scenario: No supplied version means the running process's version

- **WHEN** the engine is invoked from the command line, or in-process without a supplied version
- **THEN** the invocation consults the version of the Node process executing it

#### Scenario: Two invocations with different versions do not observe each other

- **WHEN** two invocations in one process supply two different runtime versions
- **THEN** each invocation's output reflects its own supplied version and not the other's
