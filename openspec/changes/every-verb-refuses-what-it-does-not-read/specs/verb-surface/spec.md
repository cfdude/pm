## Purpose

What every dispatched engine verb accepts on its command line — help tokens, declared flags,
declared positionals and argv-level flags — and the guarantee that a command line refused on any of
those grounds leaves every file exactly as it was, so a token the engine does not read can never be
acted on.

## ADDED Requirements

### Requirement: A refused command line writes and creates nothing
An engine invocation refused on a ground this capability defines — an undeclared flag, a surplus
positional, a help token in a value position, or a valueless or unknown `--platform` on a verb this
capability declares it for — SHALL exit non-zero and SHALL NOT create, modify or append to any file the engine writes:
`.conductor/state.json`, `.conductor/detours.log`, `.conductor/honcho-memories.log`, the activity
log, `PROJECT.md`, the render stamp, the platform rules file and `.gitignore`. In a repository with no
`.conductor/` directory the refusal SHALL NOT create one, because the existence of `state.json` is
what ends pm's dormancy and activates every hook in that repository.

The refusal SHALL precede every write, including the first creation of `state.json` by `init`. A
check that runs after a file has been created is a refusal that has already written. Value checks a
verb already performs on its own flags (a verdict vocabulary, an on/off argument) are not governed by
this requirement and keep their current behaviour.

#### Scenario: init with an unknown platform creates nothing
- **WHEN** `init --platform bogus` runs in a git repository that has no `.conductor/` directory
- **THEN** it exits non-zero naming `--platform` and the known platforms, and none of `.conductor/`,
  `CLAUDE.md`, `PROJECT.md` or `.gitignore` exists afterwards

#### Scenario: init with a valueless platform is refused before it creates anything
- **WHEN** `init --platform` runs with no value in a git repository that has no `.conductor/` directory
- **THEN** it exits non-zero naming `--platform`, and no `.conductor/` directory exists afterwards

### Requirement: A help token never lets a verb act
A help token is an argv element exactly equal to `--help` or `-h`. Where a help token occupies a
non-value position anywhere after the verb — any position other than the value of a value-bearing
flag the verb declares — the engine SHALL print that verb's help, exit zero, and write nothing,
whatever else the command line carries. With no verb, it SHALL print the global usage and exit zero.

A help token in the value position of a value-bearing flag SHALL NOT be treated as a help request.
`--help` there is flag-shaped, so it is never a value: the invocation SHALL be refused, naming the flag
left without a value and the token, and SHALL write nothing. `-h` there is not flag-shaped and is
that flag's value, exactly as any other non-flag-shaped token is.

#### Scenario: A trailing help token does not remove an epic
- **WHEN** `remove-epic e2 --help` runs against a record holding epic `e2`
- **THEN** it prints `remove-epic`'s help, exits zero, and `e2` is still in `state.json`

#### Scenario: A trailing help token does not append to the detour log
- **WHEN** `log-detour x --help` runs
- **THEN** it prints `log-detour`'s help, exits zero, and `.conductor/detours.log` is byte-identical
  to before

#### Scenario: A help token does not disarm the gate guard
- **WHEN** `set-gate-guard off --help` runs against a record whose gate guard is on
- **THEN** it prints `set-gate-guard`'s help, exits zero, and the gate guard is still on

#### Scenario: A short help token after a positional does not move the active pointer
- **WHEN** `set-active e2 -h` runs against a record whose active pointer is unset
- **THEN** it prints `set-active`'s help, exits zero, and the active pointer is still unset

#### Scenario: A help token in a value position is still refused
- **WHEN** `add-epic --id h1 --title --help --lane claude-code` runs
- **THEN** it exits non-zero, its message names `--title` and `--help`, and no epic is created

#### Scenario: A help token first after the verb is still that verb's help
- **WHEN** `update-epic --help` runs
- **THEN** it prints `update-epic`'s help and exits zero

### Requirement: Every dispatched verb refuses a flag it does not declare
Every verb the engine dispatches SHALL refuse a flag its declared command-line surface does not name:
exit non-zero, name the verb and the flag, name the flags the verb does accept (or state that it
accepts none), and write nothing. A flag is a flag-shaped token (`--name` or `--name=value`) in a
non-value position.

This binds EVERY dispatched verb — read-only verbs and hook verbs included, save only a dormant hook
verb as the `--platform` requirement below provides — and the set of verbs it
binds SHALL be derived from what the engine dispatches rather than from a list, so a verb added later
is bound without anyone extending one. A verb whose surface is declared nowhere SHALL fail the suite,
naming the verb.

A verb's command-line surface is what a caller can type. For a verb that also reads a batch document,
the keys that document may carry are not command-line flags and SHALL be refused on the command line.

#### Scenario: A typo'd flag on the reconcile write-back records nothing
- **WHEN** `record-reconcile p --detour d --verdict invalidated --amendmnts "a;b"` runs against an
  epic whose reconcile gate is armed
- **THEN** it exits non-zero naming `--amendmnts` and `record-reconcile`, and no reconcile verdict is
  recorded on the link

#### Scenario: A typo'd autonomy flag writes no autonomy block
- **WHEN** `set-autonomy e1 --levle autonomous` runs
- **THEN** it exits non-zero naming `--levle`, and `e1` carries no autonomy block

#### Scenario: A read-only verb refuses an undeclared flag
- **WHEN** `unconsidered-outcomes --bogus` runs
- **THEN** it exits non-zero naming `--bogus`, and prints no report

#### Scenario: A batch key is not a command-line flag
- **WHEN** `add-many --from <batch> --external-id X` runs with a valid batch document
- **THEN** it exits non-zero naming `--external-id`, and no epic from the batch is created

#### Scenario: Every dispatched verb refuses an undeclared flag and writes nothing
- **WHEN** an undeclared flag is appended to a working invocation of each verb the engine dispatches,
  in an initialized repository
- **THEN** every invocation exits non-zero naming that flag, and no file listed in the first
  requirement changes

#### Scenario: A verb with no declared surface fails the suite
- **WHEN** the engine dispatches a verb for which no flag surface or positional arity is declared
- **THEN** the suite fails naming that verb

### Requirement: Every dispatched verb refuses a positional it does not read
Every dispatched verb SHALL declare how many positional arguments it reads — a minimum and a maximum,
where the maximum may be unbounded for a verb that joins its positionals into one text. A positional
is any token not consumed as a declared flag's value. A token following a VALUELESS flag is never that
flag's value, so it is a positional. A token beginning with `--` that is not flag-shaped (for example
one containing a space) is a positional, as `triage` already treats it.

An invocation carrying more positionals than the verb's maximum SHALL be refused, naming the first
surplus token, and SHALL write nothing. A missing required positional stays the verb's own refusal.

Where a verb's first positional is an epic id and the caller supplies it as `--id <value>` instead,
the refusal SHALL name `--id` and show the verb's positional form, as `update-epic` already does —
on every such verb, not only that one.

#### Scenario: An unquoted multi-word title is refused, not truncated
- **WHEN** `add-epic --id t1 --lane claude-code --title My Title` runs
- **THEN** it exits non-zero naming `Title`, and no epic `t1` exists

#### Scenario: The same truncation is refused on update
- **WHEN** `update-epic e1 --title My Title` runs
- **THEN** it exits non-zero naming `Title`, and `e1`'s title is unchanged

#### Scenario: A verb that reads one text positional refuses a second
- **WHEN** `suggest-lane fix a typo` runs
- **THEN** it exits non-zero naming `a`, rather than returning a routing for `fix` alone

#### Scenario: A value given to a valueless flag is refused by name
- **WHEN** `remove-epic p --cascade yes` runs against a record where `p` has a child epic
- **THEN** it exits non-zero naming `yes`, and `p` and its child are still in `state.json`

#### Scenario: A verb that takes no positionals refuses one
- **WHEN** `set-review-mode --mode thorough extra` runs
- **THEN** it exits non-zero naming `extra`, and the review mode is unchanged

#### Scenario: An id given as a flag is diagnosed as the positional
- **WHEN** `remove-epic --id e2` runs
- **THEN** it exits non-zero with a message naming `--id` and showing `remove-epic <id>`, and `e2`
  is still in `state.json`

#### Scenario: A verb that joins its positionals still accepts many
- **WHEN** `log-detour fixed the render stamp` runs
- **THEN** it exits zero and `.conductor/detours.log` gains one entry reading `fixed the render stamp`

#### Scenario: A dash-leading text positional is still a positional
- **WHEN** `triage "--story <n> is 1-indexed"` runs
- **THEN** it exits zero and reports that text as the ask

### Requirement: set-lane-routing with no operation writes nothing
`set-lane-routing` invoked with none of its operations SHALL exit non-zero naming the operations it
accepts, and SHALL write nothing. Today it writes an empty overrides block where none existed and
reports success.

#### Scenario: A bare set-lane-routing leaves the record unchanged
- **WHEN** `set-lane-routing` runs with no arguments against a record with no lane routing
- **THEN** it exits non-zero naming its operations, and `state.json` is byte-identical to before

### Requirement: --platform is declared on every verb it is passed to
`init` and the verbs pm's own hook configuration invokes — `brief`, `snapshot`, `commit-nudge`,
`gate-guard` and `lesson-advice` — SHALL declare `--platform`. Each SHALL refuse a valueless
`--platform` or a value that is not a known platform, by name and before any write, and SHALL accept
the invocation exactly as `hooks/hooks.json` spells it.

In a repository pm has not initialized, those five hook verbs SHALL NOT refuse their command line:
where the line carries no help token in a non-value position they exit zero, print nothing and write
nothing, because pm's hooks run in every project on the machine and a hook line the engine would refuse
must not print an error into a project that never adopted pm. Dormancy suppresses refusals only. A help
token in a non-value position SHALL still print that verb's help, as the help requirement provides,
and SHALL still create nothing.

#### Scenario: A hook verb accepts its hook configuration's command line
- **WHEN** each hook verb runs with `--platform claude-code`, as `hooks/hooks.json` invokes it
- **THEN** none is refused for its flags

#### Scenario: A hook verb refuses an unknown platform
- **WHEN** `brief --platform nope` runs in an initialized repository
- **THEN** it exits non-zero naming `--platform` and the known platforms, and prints no briefing

#### Scenario: A hook verb stays dormant in a repository without pm
- **WHEN** `brief --bogus` runs in a git repository that has no `.conductor/` directory
- **THEN** it exits zero, prints nothing, and no `.conductor/` directory exists afterwards

#### Scenario: A hook verb's help still works without pm
- **WHEN** `brief --help` runs in a git repository that has no `.conductor/` directory
- **THEN** it prints `brief`'s help, exits zero, and no `.conductor/` directory exists afterwards

### Requirement: --force is accepted where a write can be forced, and nowhere else
`--force` is an argv-level flag: it belongs to the guarded state write, not to any one verb's parser.
Every verb declared as mutating the working tree SHALL accept it, and no other verb SHALL — one
discriminator, because only a mutating verb has a write the flag could force. A mutating verb whose
writes never reach the guarded state write accepts it and it has no effect there; that cost is
accepted rather than maintaining a second, undeclared list of which mutating verbs save state. What
`--force` does where it is accepted is `state-write-guard`'s to define and is not specified here.

Wherever an argv-level flag appears on the command line, it SHALL NOT be read as a positional, as part
of a text a verb joins from its positionals, or as the value of a neighbouring flag.

#### Scenario: --force is not refused on a mutating verb that validates its own flags
- **WHEN** `add-epic --id f1 --lane claude-code --force` runs
- **THEN** it is not refused as carrying an undeclared flag, and `f1` is in `state.json`

#### Scenario: --force does not leak into a joined text
- **WHEN** `log-detour fixed it --force` runs
- **THEN** it exits zero and the new `.conductor/detours.log` entry reads `fixed it`

#### Scenario: --force before a positional does not displace it
- **WHEN** `set-active --force e2` runs against a record holding epic `e2`
- **THEN** it exits zero and the active pointer is `e2`

#### Scenario: A read-only verb refuses --force
- **WHEN** `integrity --force` runs
- **THEN** it exits non-zero naming `--force`, and prints no audit

### Requirement: Help describes exactly the surface the check enforces
A verb's help SHALL be projected from the same declarations the command-line check enforces. It SHALL
name every flag the verb accepts, argv-level flags included; SHALL state the verb's positional form
where it reads positionals; SHALL name no flag the verb refuses; and SHALL say that a verb takes no
flags only when it accepts none.

#### Scenario: A hook verb's help names the flag its hook passes
- **WHEN** `brief --help` runs
- **THEN** the help names `--platform`, and does not say the verb takes no flags

#### Scenario: A mutating verb's help names --force
- **WHEN** `add-epic --help` runs
- **THEN** the help names `--force`

#### Scenario: A read-only verb's help does not offer --force
- **WHEN** `integrity --help` runs
- **THEN** the help does not name `--force`
