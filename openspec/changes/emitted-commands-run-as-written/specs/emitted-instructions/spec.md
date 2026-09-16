## Purpose

pm's product is text an agent follows literally. This capability states what pm guarantees about
the engine invocations and remedies it emits and ships: the installed engine accepts them, a remedy
runs against the state that produced it, a gate-recording form matches the gate it records, and a
hierarchy run has exactly one writer of the state of record.

## ADDED Requirements

### Requirement: Every engine invocation pm ships is one the installed engine accepts
Every engine invocation pm emits or ships SHALL pass the engine's own pre-dispatch command-line
check once its documented placeholders are filled. The population SHALL be derived from the
sources at test time, never typed as a list: the rules block rendered for every supported platform
and every tracker role, system class and direction; the brief; `integrity`; the archive gate's
refusals; `unconsidered-outcomes`; `init`'s output; the commit nudge; and every shipped document an
agent reads (`commands/*.md`, `skills/**/SKILL.md`, `agents/*.md`, `README.md`).

A shipped document that deliberately shows an invocation the engine refuses SHALL mark that
invocation in its own source. A marked invocation the engine ACCEPTS is a failure too, so a marker
cannot outlive the example it excuses.

Shipped command documents and agent documents SHALL invoke the INSTALLED engine, never a path that
exists only in a checkout of pm itself. Every `/pm:<name>` reference in shipped text SHALL name a
command or skill pm ships.

#### Scenario: An unmarked refused invocation fails the sweep
- **WHEN** a shipped document contains an unmarked engine invocation carrying a flag its verb does
  not declare
- **THEN** the sweep fails naming the file, the line and the refusal

#### Scenario: A marker on an accepted invocation fails the sweep
- **WHEN** a shipped document marks as deliberately refused an invocation the engine accepts
- **THEN** the sweep fails naming the stale marker

#### Scenario: A reference to a command pm does not ship fails
- **WHEN** a shipped document names `/pm:integrity`, which is neither a shipped command nor a
  shipped skill
- **THEN** the sweep fails naming the reference (today `commands/upgrade.md` does)

#### Scenario: A shipped command document invokes the installed engine
- **WHEN** a command document instructs the agent to run an engine verb
- **THEN** the invocation goes through the installed engine, and `node scripts/conductor.mjs` in
  `commands/cross-spec-review.md` fails the sweep

### Requirement: A remedy the engine prints runs as written against the state that produced it
Wherever the engine prints a command as the way to resolve what it just reported or refused — an
`integrity` finding, an archive-gate refusal, an `unconsidered-outcomes` entry, a brief warning —
that command, with its documented placeholders filled, SHALL succeed against the state that
produced the message, or the message SHALL name first the precondition that must be met and the
command that meets it. A remedy the engine will refuse MUST NOT be printed as the way out.

A given remedy SHALL read the same at every site that prints it: printing the same resolution with
different required arguments at different sites is a defect in itself, because at most one of the
spellings is the one the verb accepts.

The suite SHALL execute every engine-printed remedy, placeholders filled, against a fixture that
reproduces the condition that printed it, and assert it succeeds. Where a condition cannot be
constructed in a fixture, the suite SHALL carry a declared reason for that one condition beside its
entry; an absent entry, with neither a fixture nor a reason, fails.

#### Scenario: The missing-Gate-2 refusal's remedy runs
- **WHEN** archiving an openspec-lane epic as `delivered` is refused for a missing or withdrawn
  Gate 2, and the remedy it prints is run with its placeholders filled from a real commit range
- **THEN** that remedy exits zero and records the verdict (today the printed form carries no range
  and exits 1)

#### Scenario: The delivered-release remedy for an openspec member without Gate 2
- **WHEN** `integrity` reports an openspec-lane release member still open after the release
  delivered, and that member has no passing Gate 2
- **THEN** the finding does not offer `--outcome delivered` as a command to run as-is; it names the
  Gate 2 precondition and the invocation that records it, and every command it offers exits zero
  when followed in the order given (today it prints an archive the gate refuses with exit 1)

#### Scenario: Every printed remedy is executed by the suite
- **WHEN** the suite runs
- **THEN** each engine-printed remedy is run against a fixture reproducing its finding and exits
  zero, and an `integrity` check or archive-gate obligation added later with neither such a fixture
  nor a declared reason fails the suite, because the population is read from the engine's own
  registries rather than listed

### Requirement: Shipped instructions record each gate with the evidence that gate accepts
Every shipped instruction that tells an agent how to record a passing gate verdict SHALL carry the
evidence the engine requires for THAT gate: artifact paths for Gate 1 and a commit range for Gate
2. An instruction written for both gates at once SHALL show each gate's form, not one form for both.
No shipped instruction SHALL describe a Gate 1 pass as requiring a commit range.

#### Scenario: The hierarchy child's gate form is accepted
- **WHEN** the gate-recording form in `agents/hierarchy-child-executor.md` is run for a Gate 1 pass
  and for a Gate 2 pass with placeholders filled
- **THEN** both exit zero (today both exit 1)

#### Scenario: No shipped text asks for a range on Gate 1
- **WHEN** the shipped documents are scanned for passing `record-gate-review` forms
- **THEN** every Gate 1 form carries `--artifact` and every Gate 2 form carries both range flags

### Requirement: A hierarchy run has one writer of the state of record
The instructions for a hierarchy child SHALL NOT direct it to run any engine verb that writes the
state of record. The child reports its gate verdicts, their evidence and its completion in its
fixed report; the orchestrating agent is the sole writer and records them after the batch. The
orchestrator's instructions and the child's SHALL agree on this.

#### Scenario: The child document names no state-writing verb
- **WHEN** `agents/hierarchy-child-executor.md` is scanned for engine invocations
- **THEN** none of them is a verb that writes the state of record (today it instructs
  `record-gate-review` and an archive)

#### Scenario: The orchestrator records what the child reported
- **WHEN** the conductor skill describes processing a finished batch
- **THEN** it instructs the orchestrator to record each child's gate verdicts with their evidence
  and its disposition, from the child's report
