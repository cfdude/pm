# state-write-guard Specification

## Purpose

The optimistic revision guard on `.conductor/state.json` — refusing a write built on a revision
another process has already superseded — together with the corrections its own 0.26.0 release
needs: a contention warning that latches once per episode instead of firing only when the counter
is sampled at exactly the threshold, delivered somewhere a session actually reads. 0.26.0 shipped
without an OpenSpec change, so this capability documents that shipped behavior as well as amending
it.

## Requirements

### Requirement: A write built on a superseded revision is refused

`state.json` carries a `revision`. A save SHALL compare the revision the caller read against the
revision currently on disk and MUST NOT write when they differ. The write itself was already
atomic (temp file plus rename); what was unguarded was the read-modify-write cycle, where two
processes that loaded the same revision each wrote back wholesale and the second silently
discarded the first one's change. A state file written before `revision` existed SHALL load
unchanged, be treated as revision 0, and take revision 1 on its first write — no migration.

#### Scenario: An interactive verb refuses a stale write

- **WHEN** a verb loads state, another process writes `state.json`, and the first verb then saves
- **THEN** the save is refused, nothing is written, and the process exits with an exit code
  distinct from the code every validation failure already uses, so a caller can tell a retryable
  conflict from a command it must fix

#### Scenario: A pre-guard state file loads and writes

- **WHEN** the engine reads a `state.json` that has no `revision` field
- **THEN** it loads unchanged, is treated as revision 0, and its first successful write stores
  revision 1

### Requirement: Hook writes retry once, then skip

A save on a hook-driven path SHALL retry exactly once on conflict, and MUST skip rather than throw
if the retry also conflicts. The retry MUST reload state and re-run the heal rather than re-attempt
the same write — the in-hand state is built on a revision someone else has superseded, so writing
it again would clobber exactly what the guard protects. Skipping is safe because these writes are
self-healing and re-run on the next hook; throwing would turn an invisible race into a visible
mid-session error for a write that did not matter. Every skip MUST be recorded to an append-only
sidecar, never to `state.json` — that is the file whose write just failed.

#### Scenario: A hook write conflicts once and succeeds on retry

- **WHEN** a hook-driven save conflicts, and reloading state and re-running the heal produces a
  write that does not conflict
- **THEN** the write lands, the hook reports no error, and no conflict is left outstanding

#### Scenario: A hook write conflicts twice and is skipped

- **WHEN** both the initial hook-driven save and its single retry conflict
- **THEN** nothing is written, the hook does not throw or exit non-zero, and one entry is appended
  to the conflict sidecar naming the verb and the expected and found revisions

### Requirement: A save that changes nothing writes nothing

A save whose resulting state is identical to what is on disk, ignoring `revision`, SHALL be a
no-op: no file write and no revision bump. Bumping the revision for a write that changes nothing
breaks byte-idempotence — running `upgrade` twice must leave `state.json` identical — and rewrites
a file for no reason.

A per-record last-touched stamp SHALL NOT defeat this. The identity comparison is over the whole
stored body with `revision` as its only exclusion, so a stamp applied to a record BEFORE the
comparison makes every save differ from disk unconditionally, the no-op path never fires, and
byte-idempotence is lost for every verb. Any such stamp SHALL therefore be applied AFTER the
identity comparison has already decided the save is not a no-op, and SHALL be derived by comparing
each record against the disk pre-image the comparison has already read, MATCHED BY THE RECORD'S
OWN IDENTIFIER RATHER THAN BY POSITION — a verb that removes a record shifts every record after it,
so an index-matched comparison would report all of them as changed and stamp them — not by a second notion of
"changed" maintained elsewhere, and not by the callers, of which the shipped engine has 31.

That per-record comparison SHALL EXCLUDE the timekeeping fields themselves — the registration date
and the last-touched date — exactly as the whole-body comparison excludes `revision`, and for the
same reason: a field this mechanism introduces must not be an input to the mechanism's own decision.
A record whose ONLY delta is a newly recovered registration date is a recovery, not a touch. Without
that exclusion any write populating registration dates makes every record it touches differ from its
pre-image, so the last-touched stamp fires on all of them — and that is not hypothetical: the release
migration applies every pending transformation to one in-memory state and saves ONCE, so a recovery
sweeping an entire archive would stamp every record as last touched on upgrade day. The exclusion
SHALL hold identically for a later standalone re-run of that recovery, which is the same write on a
different day.

#### Scenario: Re-running an idempotent verb

- **WHEN** a verb saves state whose content, excluding `revision`, matches the file on disk
- **THEN** `state.json` is byte-identical afterwards, the revision is unchanged, and the save
  reports success

#### Scenario: A last-touched stamp does not break byte-idempotence

- **WHEN** a verb that stamps a last-touched date saves state whose content otherwise matches the
  file on disk
- **THEN** the save is still a no-op: no record is stamped, `state.json` is byte-identical, and the
  revision is unchanged

#### Scenario: A stamp is applied only to the records that changed

- **WHEN** a save that is not a no-op writes state in which some records changed and others did not
- **THEN** only the changed records carry an advanced last-touched date

#### Scenario: Recovering a registration date is not a touch

- **WHEN** a write populates a record's registration date and changes nothing else about it —
  whether during the release migration or during a later standalone re-run of the recovery
- **THEN** that record's last-touched date is unchanged

### Requirement: --force overwrites and always advances past what is on disk

`--force` SHALL let a caller deliberately overwrite a newer revision, and the revision it writes
MUST be strictly greater than both the revision it read and the revision found on disk. Writing
`read + 1` can land at or below what is on disk, which reopens the lost-update window one hop
removed: a third writer's read then matches the forced write's too-low revision, the guard passes,
and the forced change is the one silently discarded. Without an escape hatch, operators learn to
hand-edit `state.json` to get past the guard, which is strictly worse.

#### Scenario: Forcing over a newer revision

- **WHEN** a caller that read revision 4 saves with `--force` while disk holds revision 9
- **THEN** the write lands and `state.json` carries revision 10 — never 5

### Requirement: The contention warning latches for one run of contention

The warning that consecutive state writes are being skipped SHALL appear exactly once per run of
contention, regardless of how far past the threshold the count jumps between two briefings, and
MUST NOT repeat until a successful state write has reset it. Testing the count for equality with
the threshold is wrong because the count is only *sampled* when a briefing is composed: verified
empirically, a burst from 0 to 7 skips between two briefings warns **zero** times — so the warning
is least likely to fire in exactly the wedged-writer scenario it exists for, and its absence then
reads as evidence of health. Warning on every count at or above the threshold is equally wrong: it
floods, and a reader who filters the message cannot see a real signal.

#### Scenario: A burst past the threshold still warns once

- **WHEN** the skip count goes from 0 to 7 between two briefings and a briefing is then composed
- **THEN** the warning appears exactly once, naming the conflict log

#### Scenario: The warning does not repeat while contention continues

- **WHEN** further writes are skipped after a warning has been delivered, with no successful state
  write in between, and further briefings are composed
- **THEN** no further warning is emitted for that same run of contention

#### Scenario: A successful write re-arms the warning

- **WHEN** a state write succeeds after a warning was delivered, and a later run of contention
  again crosses the threshold
- **THEN** the warning appears once more, because the signal of interest is consecutive skips
  rather than skips ever

### Requirement: The warning is consumed only where it reaches a session

The warning SHALL be consumed only at a delivery point whose output actually reaches a session.
Consuming it into `.conductor/brief.txt` does not qualify: that file is written by the PreCompact
hook and read back by nothing, so a PreCompact landing between the threshold crossing and the next
SessionStart resets the count, rotates the evidence, and shows the message to no one — while
compaction is routine in exactly the long sessions where sustained contention is most likely.
Composing `PROJECT.md` likewise MUST NOT consume the warning.

#### Scenario: A briefing delivered into the session consumes the warning

- **WHEN** the SessionStart briefing is composed and carries the contention warning
- **THEN** the warning is consumed, so it does not re-fire every session for contention that
  resolved days ago, and the conflict log it names still exists for the reader to open

#### Scenario: A pre-compaction snapshot does not consume the warning

- **WHEN** the PreCompact snapshot is written while the threshold is crossed
- **THEN** the warning is not consumed, and the next briefing that actually reaches a session
  still carries it

#### Scenario: Rendering PROJECT.md does not consume the warning

- **WHEN** `PROJECT.md` is regenerated while the threshold is crossed
- **THEN** the warning is not consumed, because composing a generated document that the next
  render overwrites is not a session seeing the warning

### Requirement: A mutating verb announces that it is writing into a detached tree

A verb **not declared `read-only`** MUST report, when the root working tree's HEAD is detached, that
the write it is about to make sits in a tree a deploy can discard. It MUST still perform the write.

The predicate is `not read-only`, NOT `is mutates`. The gate it reuses is
`VERB_EFFECTS[cmd]?.effect !== "read-only"`, so an UNRECOGNISED verb has no entry, reads as
not-read-only, and warns — deliberately, and asserted by the existing suite against a literal source
string. Specifying `mutates` would force either a second divergent gate or an implementation that
violates this text while satisfying the design, which is the staleness this reuse exists to avoid.

> A deploy that runs `git checkout --force` discards any uncommitted state the engine wrote, so a
> `/pm:upgrade` in a deployed checkout reports success and then vanishes at the next release. That
> is the silent-success shape this project has spent several releases closing, and the remedy is
> the same one used everywhere else: say what happened, rather than deciding for the operator.
>
> It WARNS rather than REFUSES because detachment is a cheap signal with deliberate false positives
> — a bisect, a review of an old release — and refusing would break legitimate work to protect
> against a case the operator can see once it is named.

#### Scenario: A mutating verb in a detached tree warns and still writes

- **WHEN** a verb declared `mutates` runs in a working tree whose HEAD is detached
- **THEN** it writes as it normally would, and reports ON A CHANNEL THAT REACHES THE INVOKING
  SESSION that the tree is detached and that a deploy which checks it out again will discard the
  write, NAMING the files it wrote

> Two constraints, and each has already been a defect in this capability. **Delivery**: a warning
> composed into `.conductor/brief.txt` or `PROJECT.md` is written by a hook and read back by
> nothing — this capability already carries a requirement that a warning is consumed only where it
> reaches a session, and a new warning filed beside it without that constraint reintroduces exactly
> what the sibling forbids. Standard error on the invocation satisfies it. **Naming what was
> written**: `upgrade` writes five things, four of them tracked in a typical repository, while some
> of them are suppressed by the sibling requirement — so a generic "the write" tells the operator
> that a write will be discarded while pointing at the one write that no longer happens.

#### Scenario: The warning names the tag when HEAD is exactly at one

- **WHEN** the detached HEAD is exactly at a tag
- **THEN** the report names that tag, resolved with `git describe --tags --exact-match HEAD`

> `--tags` is load-bearing: without it `describe` considers annotated tags only, and a deploy that
> checks out a LIGHTWEIGHT tag is entirely ordinary. Where several tags point at the same commit,
> `describe` reports one of them arbitrarily; that is accepted, because the tag is context for a
> human rather than an identifier anything keys on.

> `detached at v2.11.0` identifies a deployment to a reader; `detached` alone does not. The tag is
> CONTEXT in the message and never a CONDITION on the check: requiring a tag match would miss every
> deploy that checks out a sha, and a signal with silent false negatives is what this change exists
> to remove.

#### Scenario: A read-only verb is silent

- **WHEN** a verb declared `read-only` runs in a working tree whose HEAD is detached
- **THEN** it produces no detached-tree warning

> Reading a deployed checkout's record is a legitimate thing to want, and the warning is about a
> write. Crying wolf on the read-only verbs is the defect 0.41.0's sibling fix removed from the
> WRITING-A-DIFFERENT-REPOSITORY warning; this check must not reintroduce it one release later.

#### Scenario: A tree on a branch produces no warning

- **WHEN** a mutating verb runs in a working tree whose HEAD is on a branch
- **THEN** no detached-tree warning is produced

#### Scenario: An unrecognised verb in a detached tree warns

- **WHEN** a verb the effects table does not declare runs in a working tree whose HEAD is detached
- **THEN** the warning is produced

> This mirrors the divergence warning it sits beside: a verb nobody declared is not evidence that
> it is safe, and reading an absent declaration as read-only would make every new verb silently
> exempt until someone remembered to add a row.

### Requirement: An unreadable state file is refused, never replaced

The engine SHALL distinguish an ABSENT `.conductor/state.json` from a PRESENT one it cannot read.

ABSENT is legal and its behaviour is unchanged: every hook stays dormant, and `init` creates the file.

PRESENT-BUT-UNREADABLE is any of: the file exists but cannot be read (any error other than "does
not exist"); its content, including empty content, does not parse as JSON; or it parses to the
wrong shape. The wrong shape is exactly: a top-level value that is not a JSON object; an `epics`
member that is present and not an array; an element of `epics` that is not a JSON object; a
`detourStack` member that is present and not an array. Nothing else about content is a shape
refusal in this requirement.

On a present-but-unreadable file, every verb whose behaviour depends on the content of `state.json`
— reading verbs and writing verbs alike, `init` included — SHALL refuse. Two verbs do not depend on
that content and SHALL NOT refuse: `verify-state`, which reads only the file's modification time,
and `activity`, which reads only the current revision and SHALL treat it as unknown. A refusal MUST:

- write nothing: `state.json`, `PROJECT.md`, the render stamp, the rules file and `.gitignore` are
  byte-identical afterwards;
- name the file's path and why it was refused (the parse error, the read error, or which member has
  the wrong shape);
- name remedies that do not require an Edit, Write or NotebookEdit tool call, including at least one
  that applies when the file is TRACKED (restoring the committed file, or taking one side of a merge
  conflict, with git) and at least one that applies when it is NOT (moving the damaged file aside and
  re-initialising) — a repository corrupted before its first commit has nothing for git to restore,
  and `init` itself refuses while the damaged file is in place;
- exit with a code that is not 0, not 1 (the code every validation failure uses), and not the
  conflict exit code, because the condition is neither a malformed command nor retryable.

A save that finds the file on disk unreadable at the moment it writes SHALL refuse the same way and
MUST NOT overwrite it — including when `--force` is given. `--force` overrides a NEWER READABLE
revision, whose content the caller can be shown; an unreadable file's content is unknown, and
overwriting it discards whatever the other side of a merge held.

> Replacing an unreadable record with a default one is the guess this requirement removes. The
> revision guard cannot catch it: the guessed record reads revision 0 and the unreadable disk file
> also reads as revision 0, so the comparison passes and the write lands. A conflicted `state.json`
> after a merge is an ordinary event in a repository that tracks the file.

#### Scenario: A conflict marker does not wipe the record

- **WHEN** `state.json` holds three epics and a git conflict-marker line is prepended to it, and
  `add-epic --id new --lane claude-code` is run
- **THEN** the command exits with the unreadable-state code, `state.json` is byte-identical to the
  file before the command, and the error names `.conductor/state.json`, a git remedy, and a remedy
  that needs no git history

#### Scenario: A truncated file is not replaced by sync, upgrade or init

- **WHEN** `state.json` is truncated to a prefix that does not parse, and each of `sync`, `upgrade`
  and `init` is run against it in turn
- **THEN** each exits with the unreadable-state code and `state.json`, `PROJECT.md` and the rules
  file are byte-identical after each

#### Scenario: A reading verb refuses rather than reporting an empty record

- **WHEN** `state.json` does not parse and `owners` is run
- **THEN** it exits with the unreadable-state code and prints no ownership report

#### Scenario: A wrong-shape file is refused

- **WHEN** `state.json` parses to an object whose `epics` member is an object rather than an array
- **THEN** every verb that reads state refuses with the unreadable-state code, and the error names
  `epics` as the member with the wrong shape

#### Scenario: An absent file is still dormancy

- **WHEN** a repository has no `.conductor/state.json` and the SessionStart, PreCompact, PostToolUse
  and PreToolUse hooks run
- **THEN** each exits 0, prints nothing, and creates no file, exactly as before this requirement

#### Scenario: --force does not overwrite an unreadable file

- **WHEN** a verb has loaded a readable state, `state.json` is then replaced on disk by content that
  does not parse, and the verb saves with `--force`
- **THEN** the save refuses with the unreadable-state code and the unparseable file is byte-identical
  afterwards

### Requirement: Hooks never write over an unreadable state file and report it where it can be acted on

Each hook SHALL treat a present-but-unreadable `state.json` as defined above by writing nothing and
reporting the condition on the channel its hook event actually delivers, and SHALL NOT crash with an
uncaught exception. The exit status of each is fixed by what that event does with it:

- **`gate-guard` (PreToolUse on Bash/Edit/Write/NotebookEdit)** SHALL exit 2 and block, EXCEPT for a
  call whose payload affirmatively names the tool `Bash` AND carries readable command text, which it
  SHALL allow — whatever that command is, including one matching a recognized write shape. While the
  record cannot be read the guard cannot know whether a reconcile is owed, and exiting 0 for an
  editing tool silently disables the one block this plugin makes unconditional. Its message MUST name
  the file and a remedy reachable through Bash. Every such remedy is a shell command and one of them
  is itself a redirection into a file, so wedge-freedom rests on the Bash exemption above and no
  longer on the hook not matching Bash. The exemption SHALL be decided from the payload alone, so a
  payload that is absent, does not parse, names no tool, or names `Bash` while carrying no readable
  command takes the blocking path. The readable-command condition costs the exemption nothing —
  every remedy this message names is a command, and a payload with none is a payload nothing can be
  decided from — and it keeps this carve-out consistent with the `gate-integrity` capability's rule
  that an undecidable Bash call blocks.
- **`brief` (SessionStart)** SHALL exit 0 and deliver, as the session's additional context, a warning
  that names the file, states that the conductor is tracking nothing until it is fixed, and names the
  remedy — IN PLACE of any briefing content. SessionStart does not show a non-zero hook's stderr to
  the agent, so a non-zero exit would reach only the human.
- **`snapshot` (PreCompact)** SHALL NOT exit 2, because exit 2 on PreCompact blocks compaction. It
  SHALL exit with the unreadable-state code, render nothing and write no snapshot file.
- **`commit-nudge` after a Bash call (PostToolUse and PostToolUseFailure on Bash)** SHALL write
  nothing — no state, no detour log entry, no `PROJECT.md` — whenever it would read state and cannot,
  and SHALL report the condition to the agent by exiting 2, which on neither event can block
  anything. This includes its commit-observation record (`.conductor/commit-observe.json`: the reflog anchor
  and the set of reported commits), which is NOT advanced by a run that exits on unreadable state, so
  a commit that landed while the file was unreadable is reported by the first run after it is
  repaired.
- **`lesson-advice` (PreToolUse)** does not read `state.json` beyond its existence and is unaffected.

These exit statuses SHALL hold however the unreadable-state refusal is raised during the hook's
invocation — from its own load, or from anything it calls — and not only where the hook handles it
explicitly. An exit other than 2 from a PreToolUse hook lets the tool call proceed, so a refusal that
escapes to a generic handler with a generic code would silently restore the fail-open this
requirement closes. The Bash exemption above is the single stated carve-out. It SHALL be DECIDED
from the payload before the record is loaded and APPLIED when the load raises the refusal, so that
it is reached whichever code path raises it — and so that it is not an unconditional allow for
Bash, which is what deciding and applying it in one step at the top of the hook would make it.

#### Scenario: gate-guard blocks on a conflicted state file

- **WHEN** the active epic owes a reconcile, a conflict-marker line is prepended to `state.json`, and
  the PreToolUse gate-guard hook runs
- **THEN** it exits 2, and its stderr names `.conductor/state.json` and a git command that restores
  or resolves the file

#### Scenario: The remedy stays runnable while the record is unreadable

- **WHEN** a conflict-marker line is prepended to `state.json` and the gate-guard hook runs with a
  payload naming tool `Bash` and one of the remedy commands its own message names, including the one
  that redirects into `.conductor/state.json`
- **THEN** it exits 0 and writes nothing

#### Scenario: A Bash payload with no command does not inherit the exemption

- **WHEN** a conflict-marker line is prepended to `state.json` and the gate-guard hook runs with a
  payload naming tool `Bash` and no readable command text
- **THEN** it exits 2 with the unreadable-state message

#### Scenario: gate-guard does not crash on a wrong-shape file

- **WHEN** `state.json` holds `active` naming an epic id and `epics: {}`, and the gate-guard hook runs
- **THEN** it exits 2 with the unreadable-state message, not 1 with a stack trace

#### Scenario: A refusal raised outside a hook's own load still takes the hook's exit status

- **WHEN** the gate-guard or commit-nudge hook is invoked and the unreadable-state refusal is raised
  by code the hook calls rather than by the hook's own state load
- **THEN** the process exits 2, not the unreadable-state code

#### Scenario: The session brief carries the warning instead of a guessed record

- **WHEN** `state.json` does not parse and the SessionStart brief runs
- **THEN** it exits 0, its additional context names `.conductor/state.json` and the remedy, it
  contains no epic, version-currency or next-up content, and no file under `.conductor/` is written

#### Scenario: commit-nudge writes nothing after a commit lands over an unreadable file

- **WHEN** a commit lands, `state.json` does not parse, and the PostToolUse commit-nudge hook runs
- **THEN** it exits 2 naming `.conductor/state.json`, and `state.json`, `PROJECT.md`, the detour log and
  the commit observation record are byte-identical afterwards; and once `state.json` is repaired, the
  next run reports that commit

#### Scenario: commit-nudge after a failed call writes nothing over an unreadable file

- **WHEN** a commit lands in a Bash call that fails, `state.json` does not parse, and `commit-nudge`
  runs with the PostToolUseFailure payload
- **THEN** it exits 2 naming `.conductor/state.json`, and `state.json`, `PROJECT.md` and the detour
  log are byte-identical afterwards, and so are the commit observation record
  `.conductor/commit-observe.json` and 0.44.0's watermark `.conductor/commit-watch.json`

#### Scenario: A pre-compaction snapshot writes nothing and does not block compaction

- **WHEN** `state.json` does not parse and the PreCompact snapshot runs
- **THEN** it exits with a non-zero code other than 2, and neither `PROJECT.md` nor the snapshot file
  is created or changed

### Requirement: Concurrent saves are serialised and flushed

Every save SHALL hold an exclusive lock on the state file from before it reads the on-disk revision
until after it has read back what it wrote, so that the revision comparison, the no-op comparison, the
write, the rename and the read-back are one critical section. Two processes that loaded the same
revision MUST NOT both write: whichever acquires the lock second sees the first one's revision and is
refused as a superseded write, under the existing conflict semantics — interactive verbs exit with
the conflict exit code, hook writes retry once and then skip. A `--force` save SHALL also take the
lock; `--force` bypasses only the revision comparison.

The temp file SHALL be fsynced before it is renamed over `state.json`.

The save SHALL release the lock on every path by which it returns or throws — a write, a no-op, a
refused conflict, an unreadable disk file, a failed read-back. A process killed by a signal while
holding the lock cannot release it; the stale-lock requirement below is what recovers from that.

The lock file, and any auxiliary file the locking protocol creates beside it, SHALL be covered by the
`.gitignore` entries the engine maintains.

> The 0.26.0 design rejected a lock file because a killed session could leave it held forever, and
> relied on the revision comparison alone. The comparison is necessary but not sufficient: it and
> the rename are separate system calls, so two writers can both pass it. The requirement below on
> breaking a stale lock answers the 0.26.0 objection.

#### Scenario: Parallel writers never lose an update

- **WHEN** 16 `add-epic --lane claude-code` invocations with distinct ids are started concurrently against one
  repository
- **THEN** every invocation that exits 0 has its epic present in `state.json` afterwards, every other
  invocation exits with the conflict exit code, and no invocation reports that its write did not
  persist

#### Scenario: A forced save does not write through a held lock

- **WHEN** another process holds a live, fresh lock that is not released within the wait, and
  `update-epic` saves with `--force`
- **THEN** the command exits with the conflict exit code and `state.json` is byte-identical afterwards

#### Scenario: The temp file is fsynced before it replaces the state file

- **WHEN** a save writes a changed state
- **THEN** an fsync of the temp file's descriptor is observed before the rename of that temp file over
  `state.json`

#### Scenario: Every way out of a save releases the lock

- **WHEN** a save returns after writing, returns as a no-op, throws a conflict, throws on an unreadable
  disk file, and throws on a failed read-back — each in turn
- **THEN** the lock was held during each save, and no lock file remains after any of them

### Requirement: A stale lock is broken, and a live one is waited for then refused

A save that finds the lock held SHALL wait for a bounded time for it to be released. It SHALL break
the lock only when the lock is STALE:

- the lock records a holder process that the checking process can confirm shares its host AND its
  process-id namespace, and that process is not alive; or
- the lock is older than a fixed maximum age, whatever it records, including when its content cannot
  be read.

Age is the backstop and process liveness only an accelerator. A holder on another host, in a process-id
namespace the checker cannot confirm it shares (a container reusing the host name sees a live holder's
pid as absent), under a recycled process id, or whose lock content was never written, can only be
judged by age.

Breaking SHALL be serialised: at most one process breaks locks at a time, and a breaker SHALL
re-judge the lock currently at the lock path while it holds that exclusivity and remove only the very
lock it judged stale — never a lock created after its judgement, even one with identical recorded
content. The breaker's own exclusivity SHALL itself be recoverable by age if its holder dies.

A holder SHALL confirm it still owns the lock immediately before renaming the temp file over
`state.json`, and SHALL refuse as a conflict, writing nothing, if it does not.

A save that is still waiting when the bounded time elapses, on a lock that is not stale, SHALL NOT
write. It is refused exactly as a superseded write is: an interactive verb exits with the conflict
exit code and names the lock's recorded holder; a hook write skips and records the skip to the
conflict sidecar.

#### Scenario: A lock left by a dead process does not wedge the repository

- **WHEN** the lock file records a process id that is not running, on this host and in this
  process-id namespace, and `add-epic --lane claude-code` runs
- **THEN** the epic is written, the command exits 0, and no lock file remains afterwards

#### Scenario: A lock older than the maximum age is broken

- **WHEN** the lock file's content cannot be parsed and its age exceeds the maximum, and a verb saves
- **THEN** the save lands, the verb exits 0, and the pre-existing lock file is gone afterwards

#### Scenario: A holder in an unconfirmed namespace is judged by age only

- **WHEN** a fresh lock records this host's name, a process id that is not running here, and a
  process-id namespace different from the checker's, and `update-epic` saves
- **THEN** the lock is not broken within the wait, the command exits with the conflict exit code, and
  `state.json` is byte-identical afterwards

#### Scenario: Several breakers on one stale lock lose no update

- **WHEN** a stale lock is in place and several processes, each saving a distinct change, start
  concurrently
- **THEN** every process that exits 0 has its change present in `state.json` afterwards, and every
  other process exits with the conflict exit code

#### Scenario: A holder that no longer owns the lock does not rename

- **WHEN** a save has acquired the lock and, before its rename, the lock at the lock path is replaced
  by a different lock
- **THEN** the save exits with the conflict exit code and `state.json` is byte-identical afterwards

#### Scenario: A live, fresh lock is refused as a conflict, not overwritten

- **WHEN** the lock file records a running process on this host, is younger than the maximum age,
  and is not released within the wait, and `update-epic` saves
- **THEN** the command exits with the conflict exit code, `state.json` is byte-identical afterwards,
  and the message names the recorded holder

#### Scenario: A hook write on a held lock skips

- **WHEN** a hook-driven save meets a live, fresh lock through both its attempt and its single retry
- **THEN** nothing is written, the hook exits 0, and the conflict sidecar gains an entry naming the
  verb and the expected and found revisions, as any other skipped hook write does
