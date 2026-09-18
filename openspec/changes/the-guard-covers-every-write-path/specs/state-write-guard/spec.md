## MODIFIED Requirements

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
