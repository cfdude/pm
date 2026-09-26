## MODIFIED Requirements

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
exception for a stored epic or release id holding one, which no verb can rename and so has no runnable
remedy, is specified in `output-text-integrity`.

**An epic id in a printed command is always one shell word.** Wherever a remedy or instruction prints
a stored epic id inside a command, an id that does not match the epic id format
(`^[a-z0-9][a-z0-9._-]*$`) — a legacy id holding a space, for example — SHALL be printed shell-quoted,
so the command still passes that id as one argument. An id that matches the format is printed as it
is today. That decision is made at one site only, `printedId()`; the case of an id holding a control
character is specified in `output-text-integrity`.

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
  gate refuses with exit 1); and for a member whose checkbox source has a task still open, the
  archive alternative carries `--carried-to <epicId>` (no verb ticks a checkbox), so filled it exits
  zero (before Gate 2 E-I5 it offered a bare archive refused "task(s) outstanding"). The alternative
  keys on each part of the `conductor-record` union separately: a member that ALSO has an open inline
  story is offered `--story <n> --done` for the story first, so a shipped story is not recorded as
  carried, as well as `--carried-to` for the task, and followed in the order printed each line exits
  zero and the finding clears

#### Scenario: The regression refusal's remedy runs
- **WHEN** an edit to an archived `delivered` openspec-lane epic is refused because it would break
  that record's Gate 2, and the refusal's remedies are followed in the order printed
- **THEN** each exits zero and the edit is then accepted, with `delivered` kept

#### Scenario: The regression refusal's invocation carries a checkbox source's open tasks
- **WHEN** an edit to an archived `delivered` epic whose task source is a checkbox file — re-pointing its
  plan at one with a task still open — is refused because it breaks the handoff, and the refusal's
  invocation is filled with `delivered`, a reason, a correction reason and a receiving epic
- **THEN** the invocation carries `--carried-to <epicId>` beside a single `--reason`, it exits zero, and
  the edit is made with `delivered` kept (before Gate 2 R-I1 it offered `delivered` with no handoff flag
  and was refused "task(s) outstanding")

#### Scenario: The drift-heal disposition step meets what delivered requires
- **WHEN** `integrity` reports an epic the heal archived with a passing Gate 2 and no disposition, and
  that epic has an open task in a checkbox source, an open inline story, or both
- **THEN** the step offering `--outcome delivered` carries `--carried-to <epicId>` whenever the
  checkbox source has an open task, and names `--story <n> --done` first whenever an inline story is
  open — BOTH when both parts contribute, `--story <n> --done` first so a shipped story is recorded as
  delivered rather than as carried, and `--carried-to` for what remains — and followed it exits zero
  and clears the finding
  (before Gate 2 R-I1 it offered a bare archive refused "task(s) outstanding")

#### Scenario: The regression refusal's remedy runs when the edit withdraws the last attributed commit
- **WHEN** a `--withdraw-commit` of the only commit attributed to an archived `delivered` openspec-lane
  epic with a passing Gate 2 headed at that commit — the commit an amend replaced — is refused, and
  the refusal's remedies are followed in the order printed with the replacing commit and its parent
  filled in
- **THEN** the refusal names the Gate 2 re-record over the replacing commit and then its
  `--attribute-commit` before the invocation, each exits zero, and the withdrawal is then accepted
  with `delivered` kept (today the refusal names only a disposition invocation, which the archive
  gate refuses with exit 1); the refusal says both lines must run before the withdrawal is retried,
  because running only the re-record lets the withdrawal through with `delivered` attributing no
  commits

#### Scenario: Every site naming the attribution-withdrawn obligation prints the same remedy
- **WHEN** the archive gate refuses `delivered` because the record attributes no commits having
  withdrawn one (reached through the regression refusal's invocation with `--outcome delivered`), or
  `integrity`'s `delivered-epic-attributed-no-commits` reports that withdrawn shape
- **THEN** each prints the regression refusal's remedy in its order — the Gate 2 re-record over the
  replacing commit, then its `--attribute-commit` — and followed in that order each exits zero and the
  refusal or finding clears (today the archive gate prints attribute-first, whose `--attribute-commit`
  exits 1 on an archived record, and `integrity` prints `--attribute-commit` alone)

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

