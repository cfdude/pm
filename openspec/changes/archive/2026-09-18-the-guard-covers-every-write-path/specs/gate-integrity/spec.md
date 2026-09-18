## ADDED Requirements

### Requirement: The reconcile block covers a Bash write, and declares what it cannot see

The mechanical pre-tool guard SHALL be registered for `Bash` as well as for the editing tools, and
SHALL block a Bash call whose command text matches a recognized write shape while the active epic
owes a reconcile. The gate exists to stop source being written before a reconcile verdict is
recorded, and a guard that watches only the editing tools stops nothing: the same file is written
with a heredoc redirection, an in-place editor or `tee` in one hop, and the block's own message
claims the gate is the only way through.

**The set of recognized write shapes SHALL be a closed, documented list**, and the guard SHALL
block a Bash call only on a member of it. At minimum the list SHALL recognize redirection of
output to a file path — including the forms that redirect both standard streams, whether the `&`
precedes the operator or follows it, and the form that overrides the no-clobber setting — an
in-place stream editor, `tee`, and a copier — the last three AS A SEGMENT'S LEADING COMMAND
WORD, which is the only position this list reads them in. An in-place editor reached through
another command's arguments (`find … -exec sed -i …`, `xargs … sed -i`) is not in a position the
list decides, and falls under the undecidable forms below rather than being a member it misses.

It SHALL NOT treat as a write: a redirection whose target is a device path; a redirection that
duplicates a file descriptor rather than naming a file, which is `&` followed by digits or `-` and
NOT `&` followed by a path; and a `>` whose immediately preceding
character is `-`, which is the arrow that appears inside ordinary search patterns and format
strings rather than a redirection. Those are the idioms that appear in ordinary read-only
commands, and a guard that blocks them is a guard that gets routed around. The arrow exclusion is
named because this repository mandates `rg`, whose patterns carry it routinely; it does not make
the exclusion list complete, and a bare `>` inside a quoted argument is still matched (see the
accepted false-positive class in this change's design).

**Destroying the conductor record SHALL be a recognized write shape.** A command that removes,
renames or truncates `.conductor/state.json`, or the `.conductor` directory holding it — under
any spelling that NAMES either among the files it acts on, the trailing-glob forms below
included — SHALL be on the list. Deleting the record is not a lesser evasion than writing over a source file: the
guard is dormant while no record exists, so a deletion turns the whole block off rather than
slipping one write past it, and renaming and truncating the record are already recognized by
their own commands.

**The removal SHALL be recognized under every command that spells it**, not under `rm` alone: the
removers `unlink` and `shred` name the same file, and `git rm` — the verb a repository under version
control actually uses — removes it too. `git mv` renames it. A row keyed on the word `rm` leaves
`git rm -f .conductor/state.json` allowed, and once the record is gone the guard is dormant, so the
NEXT call takes no path through this requirement at all: the bypass is the whole gate, not one write.
Correspondingly, a git verb SHALL be read as the invocation's SUBCOMMAND, after git's global options
are skipped — `-C`, `-c`, `--git-dir`, `--work-tree`, `--namespace`, `--exec-path` in their
separate-value spelling, one word otherwise — because `git -C <path> <verb>` is how a session that
must not change directory spells every git call, and a row reading the first argument is evaded by
it. Only the SUBCOMMAND'S OWN arguments SHALL be tested against the record's path: a path that is a
global option's value is not a file the subcommand acts on, and `git -C .conductor status` is a read.
A record named RELATIVE to a directory the command itself moves into — `git -C <dir> rm state.json`,
or the older `cd .conductor && rm state.json` — is NOT decided here: record-ness would depend on a
working directory the command string changes, which is the incomplete-by-construction requirement
below rather than a member of the list this one misses. It is pre-existing and this requirement does
not narrow or widen it.
Git verbs other than `apply`, `rm` and `mv` remain absent — `checkout`, `restore`, `stash` and
`reset` each leave the record readable where they touch it at all, and `git restore` is a remedy the
unreadable-state branch must never block.

The match SHALL be on the record's own path — `.conductor/state.json`, the
`.conductor` directory itself, a glob of that directory's contents, or a trailing `*` on either
name (the next paragraph, which completes this enumeration rather than qualifying it) — written
at any directory prefix, so that an absolute path to the same record is recognized as the same
record. One
surrounding quote character at each end SHALL be stripped before the comparison; partial or
embedded quoting is out of scope under this change's no-quoting-model non-goal, so a `*` written
OUTSIDE a surrounding quote (`'.conductor/state.json'*`) is not decided here.

**A trailing `*` appended to either name SHALL match, and the discriminator is the WRITTEN
ARGUMENT, not the file it happens to reach.** `.conductor/state.json*` and `.conductor*` each name
the record among their expansions, so each destroys it and SHALL be on the list; a match keyed on
the literal path alone lets `rm -rf .conductor/state.json*` turn the guard off, which is the whole
bypass this requirement closes. Correspondingly the match SHALL NOT extend to a LONGER LITERAL
FILENAME beneath that path, nor to a glob that CANNOT expand to the record:
`.conductor/state.json.lock` is a different file, not a longer spelling of the record, and
`.conductor/state.json.*` reaches only such files. The engine's own lock refusal prints
`rm .conductor/state.json.lock` — a match that reached it would block a remedy pm itself emits —
and that remedy is always the LITERAL path, never a glob, so blocking `state.json*` although it
would also reach the lock costs pm nothing while `state.json.*` stays the runnable glob spelling
for lock cleanup. A trailing `*` and only `*`: `?`, `[…]` and every other glob metacharacter are
out of scope, under the incomplete-by-construction requirement below rather than as a claim that
they are safe.

**The check is incomplete by construction and the guard SHALL say so rather than claim
coverage.** A command string cannot be resolved to the writes it performs: a path built from a
variable, an `eval`, a script invoked by name, an interpreter given inline source, or any program
that writes files of its own accord all pass. The guard is a backstop under an instruction that
remains primary, and its user-facing text SHALL state that a Bash write is forbidden while a
reconcile is owed whether or not this check can see it.

The guard has two further fail-open modes that this requirement does not close and SHALL NOT be
described as closed: a record that cannot be read allows every Bash call CARRYING A COMMAND
(governed by the `state-write-guard` capability, whose exemption a Bash payload with no readable
command does not get either), and a record that is absent leaves the guard dormant altogether,
which is this plugin's standing contract for an uninitialized repository. The second is why
destroying the record is on the shape list above; neither is a claim that the shape list is
exhaustive.

**A tool the payload does not identify SHALL block, as before this change.** Where the hook
payload is absent, does not parse, or names no tool, the guard SHALL take the blocking path it
takes today for an editing tool. Treating an unidentifiable call as a Bash call would convert a
malformed payload into a silent hole in the one block this plugin makes unconditional.

**A payload naming `Bash` but carrying no readable command SHALL take the blocking path** — where
`tool_input` is absent, is not an object, or its `command` is not a string, there is no command
text for the shape list to decide, and the same principle that governs an unidentifiable tool
applies: an undecidable call takes the block, never the allow.

**The repo's gate-guard setting SHALL NOT reach this arm.** The reconcile block is unconditional
today, and extending it to Bash MUST NOT make any part of it conditional: an implementation that
put the shared shape check behind that flag would hand back the bypass this requirement closes.

**An unreadable record is out of scope here** and is governed by the `state-write-guard`
capability's requirement for hooks over an unreadable state file. Where no obligation can be read,
there is no owed reconcile for this requirement to act on.

**The block message SHALL name the write shape it matched**, so that a block is legible as a
decision about this command rather than a blanket refusal of Bash. The name SHALL be a fixed label
drawn from the closed list itself — the label of the shape, not the command — and the message
SHALL NOT carry any text taken from the command. Text the engine did not write must never reach
its output, and a label from a closed set is text the engine wrote: it needs no escaping and no
length bound, where an interpolated path or matched fragment would need both.

**An invocation of pm's own engine SHALL NOT itself be a write shape.** Where a command segment
runs the conductor engine, no engine verb SHALL be recognized as a command-word write shape,
whatever it is named. The commands this gate names as the way through it are engine invocations,
and a gate that blocks its own completing command has no exit.

**What counts as an engine invocation SHALL be decided by an exported predicate, and that
predicate SHALL recognize the spellings pm itself emits.** A segment is an engine invocation when
its leading command word is the `node` runtime and its first argument — with one surrounding quote
character stripped from each end — is either a path ending `conductor.mjs` or an UNEXPANDED
VARIABLE REFERENCE, followed by a further word that is the verb. The variable form is included
because it is the spelling pm's own command documents emit (`node "$ENGINE" <verb>`) and the guard
cannot expand it; the quoted plugin-root form (`node "${CLAUDE_PLUGIN_ROOT}/…/conductor.mjs"
<verb>`) is the other. A predicate that recognized neither would be an exemption for a spelling pm
never emits.

**The predicate is where this rule is falsifiable, and the reason SHALL be stated rather than
discovered.** Under the list as it stands, no command-word row is reachable from such a segment at
all: the arm reads the segment's LEADING word, which for an engine invocation is always the
runtime and never the verb. So the exemption cannot change any command's outcome today, and a
case-based check of the guard's exit codes cannot fail when it is removed. The exported predicate
SHALL therefore be asserted directly over both spellings above, so that deleting it is detectable.
**Any future row keyed on something other than the segment's leading command word SHALL
re-establish that an engine invocation reaches this exemption before it ships** — that is the
condition under which the rule becomes behaviourally load-bearing, and the sibling change's
frame-drop verb relies on it holding then, not only now.

The exemption covers the command-word arm ONLY. A redirection into a file SHALL still be
recognized in an engine segment as anywhere else — otherwise prefixing a command with an engine
invocation would be a one-line bypass of the whole gate.

**This coverage ships with no inverse, deliberately.** There is no flag, no environment variable
and no argument that disables the Bash arm of the reconcile block while leaving the rest standing.
A switch that silenced Bash writes would be a bypass for the entire reconcile gate, which is the
defect this requirement closes. A false positive is answered by running the reconcile gate — the
same answer the editing tools already get — and not by a setting. The consequence SHALL be stated
in the guard's documentation rather than left to be discovered.

#### Scenario: A heredoc redirection is blocked while a reconcile is owed

- **WHEN** the active epic owes a reconcile and the guard is invoked with a payload naming tool
  `Bash` and a command that redirects a heredoc into a source file
- **THEN** it exits 2, and its stderr names the epic and the write shape it matched

#### Scenario: An in-place stream editor is blocked

- **WHEN** the active epic owes a reconcile and the guard is invoked with a payload naming tool
  `Bash` and a command invoking a stream editor in place
- **THEN** it exits 2

#### Scenario: A read-only command that discards output is not blocked

- **WHEN** the active epic owes a reconcile and the guard is invoked with a payload naming tool
  `Bash` and a command whose only redirections send a file descriptor to a device path or to
  another file descriptor
- **THEN** it exits 0 and prints nothing

#### Scenario: The guard setting does not reach the Bash arm of the reconcile block

- **WHEN** the active epic owes a reconcile, the repo's gate-guard setting is off, and the guard
  is invoked with a payload naming tool `Bash` and a command matching a recognized write shape
- **THEN** it exits 2

#### Scenario: An unidentified tool blocks exactly as an edit does

- **WHEN** the active epic owes a reconcile and the guard is invoked with a payload that does not
  parse, or that names no tool
- **THEN** it exits 2 with the reconcile-owed message

#### Scenario: An editing tool is unaffected by the payload's command text

- **WHEN** the active epic owes a reconcile and the guard is invoked with a payload naming tool
  `Edit`
- **THEN** it exits 2 regardless of any command text in the payload

#### Scenario: No Bash call is blocked when nothing is owed

- **WHEN** the active epic owes neither a reconcile nor a tracker refresh, and the guard is
  invoked with a payload naming tool `Bash` and a command matching a recognized write shape
- **THEN** it exits 0 and prints nothing

#### Scenario: The guard is registered for Bash

- **WHEN** the shipped hook configuration is read
- **THEN** the entry driving the gate guard has a matcher that covers `Bash`, `Edit`, `Write` and
  `NotebookEdit`

#### Scenario: The block message states the obligation the check cannot enforce

- **WHEN** the guard blocks on an owed reconcile
- **THEN** its stderr states that a Bash write is forbidden while the reconcile is owed

#### Scenario: The block message carries a label, not the command

- **WHEN** the guard blocks a Bash call whose command redirects into a path holding an unusual
  character sequence
- **THEN** its stderr holds the matched shape's fixed label, and does not contain that character
  sequence or the target path

#### Scenario: Deleting the conductor record is blocked

- **WHEN** the active epic owes a reconcile and the guard is invoked with a payload naming tool
  `Bash` and a command that removes `.conductor/state.json`
- **THEN** it exits 2

#### Scenario: A trailing glob on the record's path is blocked

- **WHEN** the active epic owes a reconcile and the guard is invoked with a payload naming tool
  `Bash` and a command that removes `.conductor/state.json*`, or `.conductor*`
- **THEN** it exits 2

#### Scenario: Destroying the record through git is blocked

- **WHEN** the active epic owes a reconcile and the guard is invoked with a payload naming tool
  `Bash` and a command that removes `.conductor/state.json` through `git rm`, including through
  the `git -C <path> rm` spelling, or removes it as `unlink` or `shred`
- **THEN** it exits 2

#### Scenario: A git global option's value is not a file the subcommand acts on

- **WHEN** the active epic owes a reconcile and the guard is invoked with a payload naming tool
  `Bash` and `git -C .conductor status`
- **THEN** it exits 0 and prints nothing

#### Scenario: A git subcommand is read after git's global options

- **WHEN** the guard resolves the write shape of `git -C <path> apply p.patch`
- **THEN** it is the same shape as `git apply p.patch`

#### Scenario: Removing the state lock stays runnable

- **WHEN** the active epic owes a reconcile and the guard is invoked with a payload naming tool
  `Bash` and the `rm .conductor/state.json.lock` remedy the engine's lock refusal prints, or the
  glob `rm .conductor/state.json.*`, which cannot expand to the record
- **THEN** it exits 0 and prints nothing

#### Scenario: A Bash payload carrying no command blocks

- **WHEN** the active epic owes a reconcile and the guard is invoked with a payload naming tool
  `Bash` whose `tool_input` is absent, or whose `command` is not a string
- **THEN** it exits 2 with the reconcile-owed message

#### Scenario: An arrow in a search pattern is not a redirection

- **WHEN** the active epic owes a reconcile and the guard is invoked with a payload naming tool
  `Bash` and a command whose only `>` is immediately preceded by `-`
- **THEN** it exits 0 and prints nothing

#### Scenario: Every engine invocation the gate names as its own exit stays runnable

- **WHEN** the active epic owes a reconcile and the guard is invoked, one at a time, with a payload
  naming tool `Bash` and each engine invocation the guard's own messages and the conductor skill's
  POP protocol name as the way through — `record-reconcile`, `pop-detour`, `update-epic` with a
  quoted `--notes`, and `record-gate-review`
- **THEN** each exits 0 and prints nothing

#### Scenario: The engine-invocation predicate recognizes the spellings pm emits

- **WHEN** the exported engine-invocation predicate is asked about each spelling pm's own emitted
  commands and command documents use — a quoted plugin-root path ending `conductor.mjs` followed
  by a verb, and a quoted variable reference followed by a verb
- **THEN** it identifies each as an engine invocation, and does not identify a runtime invoked
  with an inline script, with a test flag, or with no verb following

#### Scenario: Redirecting an engine invocation's output into a file is still blocked

- **WHEN** the active epic owes a reconcile and the guard is invoked with a payload naming tool
  `Bash` and an invocation of the conductor engine whose output is redirected into a file path
- **THEN** it exits 2
