## Purpose

pm's product is text an agent follows literally. This capability states what pm guarantees about
the engine invocations and remedies it emits and ships: the installed engine accepts them, a remedy
clears the condition that printed it, and a gate-recording form carries the evidence its gate
requires.

## ADDED Requirements

### Requirement: Every engine invocation pm ships is one the installed engine accepts
Every engine invocation pm emits or ships SHALL pass the engine's own pre-dispatch command-line
check once its documented placeholders are filled. The population SHALL be derived from the
sources at test time, never typed as a list: the rules block rendered for every supported platform
and every tracker role, system class and direction; the brief; `integrity`; the archive gate's
refusals; `unconsidered-outcomes`; `init`'s output; the commit nudge; and every shipped document an
agent reads (`commands/*.md`, `skills/**/SKILL.md`, `agents/*.md`, `README.md`). An invocation
written as alternatives (`(--a | --b)`, or whole forms separated by `|`) SHALL be checked once per
alternative.

A shipped document that deliberately shows an invocation the engine refuses SHALL mark that one
invocation in its own source, and the marker SHALL name the refusal class it demonstrates. The
engine's refusal SHALL carry a class the check can compare. A marked invocation that is accepted,
or refused for a different class, fails; a marker binds to exactly one invocation. Engine output
quoted in shipped text is not an invocation and SHALL be distinguishable from one.

Shipped command documents and agent documents SHALL invoke the INSTALLED engine, never a path that
exists only in a checkout of pm itself, and SHALL NOT instruct a user's agent to work on files that
exist only in pm's own repository (its `README.md` or `scripts/test`). A shipped statement that the
engine cannot do something SHALL be true of the engine. Every `/pm:<name>` reference in shipped text SHALL name a
command or skill pm ships; this check reads the name only, not the words after it.

#### Scenario: An unmarked refused invocation fails the sweep
- **WHEN** a shipped document contains an unmarked engine invocation carrying a flag its verb does
  not declare
- **THEN** the sweep fails naming the file, the line and the refusal class

#### Scenario: A marker must match the refusal it claims
- **WHEN** a shipped document marks an invocation as a refused example of one class, and the engine
  accepts it or refuses it for another class
- **THEN** the sweep fails naming the marker, the expected class and what the engine did

#### Scenario: A marker does not reach a neighbouring invocation
- **WHEN** a marked refused example is followed on the same or the next line by an unmarked
  invocation the engine refuses
- **THEN** the sweep fails on the unmarked one

#### Scenario: Both halves of an alternative group are checked
- **WHEN** a shipped form reads `push-detour <parent> --detour <id> --reason "<why>" (--reconcile |
  --no-reconcile)`
- **THEN** the sweep checks one invocation with `--reconcile` and one with `--no-reconcile`, and both
  pass

#### Scenario: A reference to a command pm does not ship fails
- **WHEN** a shipped document names `/pm:integrity`, which is neither a shipped command nor a
  shipped skill
- **THEN** the sweep fails naming the reference (today `commands/upgrade.md` does)

#### Scenario: The child agent doc gives no pm-repository-only instruction
- **WHEN** `agents/hierarchy-child-executor.md` is scanned
- **THEN** it does not instruct updating pm's `README.md` or running `scripts/test/*.test.mjs` (today
  its "check README.md" paragraph does)

#### Scenario: review-mode.md does not deny an unset the engine has
- **WHEN** `commands/review-mode.md` describes clearing a per-epic review-mode override
- **THEN** it names `update-epic <id> --clear review-mode` and does not say there is no unset (today
  it says there is no separate unset, while `--clear review-mode` clears the override)

#### Scenario: A shipped command document invokes the installed engine
- **WHEN** a command document instructs the agent to run an engine verb
- **THEN** the invocation goes through the installed engine, and `node scripts/conductor.mjs` in
  `commands/cross-spec-review.md` fails the sweep

### Requirement: A remedy the engine prints clears the condition that printed it
Wherever the engine prints a command as the way to resolve what it just reported or refused — an
`integrity` finding, an archive-gate refusal, update-epic's archived-record regression refusal, an
`unconsidered-outcomes` entry, a brief warning — that command, with its placeholders filled by what
they MEAN in that state, SHALL succeed, and re-running what produced the message SHALL no longer
report the condition it was printed for. Where the command cannot succeed until something else is
done, the message SHALL name that precondition first, with the command that meets it. A remedy the
engine will refuse MUST NOT be printed as the way out. Where a message offers alternatives ("…, or
…"), each alternative SHALL clear the condition on its own.

A remedy that clears a finding by removing the record it was about does not count as clearing it.

A **control character** is any of U+0000 to U+001F, U+007F, U+0080 to U+009F, U+2028 and U+2029. The
exception for a stored identifier holding one, which no verb can rename and so has no runnable remedy,
is specified in `output-text-integrity`.

**An epic id in a printed command is always one shell word.** Wherever a remedy or instruction prints
a stored epic id inside a command, an id that does not match the epic id format
(`^[a-z0-9][a-z0-9._-]*$`) — a legacy id holding a space, for example — SHALL be printed shell-quoted,
so the command still passes that id as one argument. An id that matches the format is printed as it
is today.

A given remedy SHALL read the same at every site that prints it, and SHALL carry the evidence its
gate requires: a commit range for Gate 2, artifact paths for Gate 1. A site that cannot know which
gate it is naming SHALL print the form for each.

The suite SHALL exercise every such remedy against a fixture that reproduces its condition. The
population SHALL be read from registries the engine exports — the `integrity` checks, the delivered
obligations the archive gate enforces, and the brief's remedy-bearing warnings — so an entry added
to any of them without a fixture fails. A condition that cannot be constructed in a fixture SHALL be
declared beside its entry with a reason, and the number of such declarations SHALL be asserted, so
adding one is a visible change to the test.

#### Scenario: A stale Gate 2 remedy clears the staleness, not just the command
- **WHEN** archiving an openspec-lane epic as `delivered` is refused because its passing Gate 2 does
  not reach its attributed commits, and the printed remedy is run with `--base-sha` set to the parent
  of the first attributed commit and `--head-sha` to the last attributed commit
- **THEN** the remedy exits zero and the same archive then succeeds (today the printed form carries
  no range and exits 1; filled with an arbitrary range it exits 0 and the archive is still refused)

#### Scenario: Each alternative of the delivered-release finding clears it on its own
- **WHEN** `integrity` reports a release member still open after the release delivered, and each
  alternative the finding offers is followed in its own fresh fixture
- **THEN** in each fixture every command offered exits zero and a re-run of `integrity` no longer
  reports that member; for an openspec-lane member with no passing Gate 2, the archive alternative
  names the Gate 2 precondition before offering `--outcome delivered` (today it offers an archive the
  gate refuses with exit 1)

#### Scenario: The regression refusal's remedy runs
- **WHEN** an edit to an archived `delivered` openspec-lane epic is refused because it would break
  that record's Gate 2, and the refusal's remedies are followed in the order printed
- **THEN** each exits zero and the edit is then accepted, with `delivered` kept

#### Scenario: A gate-agnostic remedy names each gate's evidence
- **WHEN** `integrity` reports a recorded range value that is not a commit object name on a Gate 1
  verdict
- **THEN** the remedy it prints for re-recording that verdict carries `--artifact`, not a range

#### Scenario: A legacy id holding a space stays one argument
- **WHEN** a stored epic's id is `My Plan` (registered before ids were validated) and `integrity`
  reports it archived by the drift heal with a passing Gate 2 and no recorded disposition
- **THEN** the printed remedy quotes the id, and running it exits zero and clears the finding (today
  it prints `update-epic My Plan …`, which passes `My` as the id)

#### Scenario: Deleting the evidence is not a fix
- **WHEN** a remedy's commands are followed and the condition is no longer reported
- **THEN** the suite also asserts the epic the condition concerned still exists, so a remedy that
  removed the epic fails

#### Scenario: A registry entry without a fixture fails
- **WHEN** an `integrity` check, a delivered obligation kind or a brief remedy-bearing warning is
  exported with neither a fixture nor a declared reason
- **THEN** the suite fails naming it, and the declared-unconstructable count asserted today is zero

### Requirement: Shipped instructions record each gate with the evidence that gate accepts
Every shipped instruction that tells an agent how to record a passing gate verdict SHALL carry the
evidence the engine requires for THAT gate: artifact paths for Gate 1 and a commit range for Gate
2. An instruction written for both gates at once SHALL show each gate's form, not one form for both.
No shipped instruction SHALL describe a Gate 1 pass as requiring a commit range.

#### Scenario: The hierarchy child's gate form is accepted
- **WHEN** the gate-recording forms in `agents/hierarchy-child-executor.md` are run for a Gate 1 pass
  and for a Gate 2 pass with placeholders filled
- **THEN** both exit zero (today its single `--gate 1|2` form exits 1 for both)

#### Scenario: No shipped text asks for a range on Gate 1
- **WHEN** the shipped documents are scanned for passing `record-gate-review` forms
- **THEN** every Gate 1 form carries `--artifact` and every Gate 2 form carries both range flags
