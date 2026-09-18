## MODIFIED Requirements

### Requirement: Mechanical enforcement of the refresh gate is opt-out
The mechanical pre-tool block for an outstanding tracker refresh SHALL respect the repo's
gate-guard setting, so an agent that is offline, unauthenticated, or facing a deleted upstream
item can proceed honestly rather than recording a blind "unchanged". Turning the guard off MUST
NOT weaken the unconditional reconcile block.

The refresh block SHALL cover a Bash call on the same terms as the reconcile block: a command
matching a recognized write shape is blocked, anything else passes, and a payload that does not
identify its tool — or that names `Bash` while carrying no readable command text — takes the
blocking path. This arm keeps the inverse the requirement already
names — `set-gate-guard off` silences it, Bash included — and that asymmetry with the reconcile
block is deliberate: the reconcile block ships no inverse because a switch that silenced Bash
writes there would bypass the whole gate, while here the escape hatch is the point.

#### Scenario: The refresh block honors the guard setting
- **WHEN** the active epic owes a tracker refresh and the repo's gate guard is on
- **THEN** the guard blocks; with the guard off, it does not block

#### Scenario: Turning the guard off does not bypass reconcile
- **WHEN** the active epic needs reconciliation
- **THEN** the guard blocks whether the gate-guard setting is on or off

#### Scenario: A Bash write is blocked by the refresh gate only while the guard is on
- **WHEN** the active epic owes a tracker refresh, the guard is on, and the hook is invoked with a
  payload naming tool `Bash` and a command matching a recognized write shape
- **THEN** it exits 2; and with the guard off the same invocation exits 0

#### Scenario: A read-only Bash command is never blocked by the refresh gate
- **WHEN** the active epic owes a tracker refresh, the guard is on, and the hook is invoked with a
  payload naming tool `Bash` and a command matching no recognized write shape
- **THEN** it exits 0 and prints nothing
