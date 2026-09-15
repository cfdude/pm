## ADDED Requirements

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

- **`gate-guard` (PreToolUse on Edit/Write/NotebookEdit)** SHALL exit 2 and block. While the record
  cannot be read the guard cannot know whether a reconcile is owed, and exiting 0 silently disables
  the one block this plugin makes unconditional. Its message MUST name the file and a remedy
  reachable through Bash, which this hook does not match — so the block is never a wedge.
- **`brief` (SessionStart)** SHALL exit 0 and deliver, as the session's additional context, a warning
  that names the file, states that the conductor is tracking nothing until it is fixed, and names the
  remedy — IN PLACE of any briefing content. SessionStart does not show a non-zero hook's stderr to
  the agent, so a non-zero exit would reach only the human.
- **`snapshot` (PreCompact)** SHALL NOT exit 2, because exit 2 on PreCompact blocks compaction. It
  SHALL exit with the unreadable-state code, render nothing and write no snapshot file.
- **`commit-nudge` (PostToolUse on Bash)** SHALL write nothing — no state, no detour log entry, no
  `PROJECT.md` — whenever it would read state and cannot, and SHALL report the condition to the agent
  by exiting 2, which on PostToolUse cannot block anything. ONE EXEMPTION: its HEAD watermark
  (`commit-watch.json`) is observed and written before state is read, and still is. The watermark
  records where HEAD is, not anything derived from state, so the commit reminder for a commit that
  landed while the file was unreadable is not shown again once the file is repaired.
- **`lesson-advice` (PreToolUse)** does not read `state.json` beyond its existence and is unaffected.

These exit statuses SHALL hold however the unreadable-state refusal is raised during the hook's
invocation — from its own load, or from anything it calls — and not only where the hook handles it
explicitly. An exit other than 2 from a PreToolUse hook lets the tool call proceed, so a refusal that
escapes to a generic handler with a generic code would silently restore the fail-open this
requirement closes.

#### Scenario: gate-guard blocks on a conflicted state file

- **WHEN** the active epic owes a reconcile, a conflict-marker line is prepended to `state.json`, and
  the PreToolUse gate-guard hook runs
- **THEN** it exits 2, and its stderr names `.conductor/state.json` and a git command that restores
  or resolves the file

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
- **THEN** it exits 2 naming `.conductor/state.json`, and `state.json`, `PROJECT.md` and the detour
  log are byte-identical afterwards (the HEAD watermark may advance)

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
