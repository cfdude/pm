## Purpose

What pm's commit hook observes about the commits that landed since its previous observation, which
of those commits it may report, when it writes a row to the detour trail (`.conductor/detours.log`),
how an amended commit is treated, and how a row the engine logged automatically is retracted.

## ADDED Requirements

### Requirement: Every commit recorded since the last observation is reported, in the order it landed

Vocabulary used by every requirement in this capability:

- an **observation** is one run of the commit hook after a Bash tool call, on success or on failure;
- a commit **landed since the last observation** when HEAD's reflog gained an entry whose action
  begins with the word `commit` (including `commit (initial)`, `commit (amend)`, `commit (merge)` and
  `commit (cherry-pick)`) after the reflog position the previous observation recorded;
- a commit is **reported** when the hook's output names it;
- a commit is **live** when it is reachable from at least one branch (`refs/heads/*`).

The plugin's hook configuration SHALL run the commit hook after every Bash tool call, on success and
on failure, and the hook's output SHALL name the event it is answering exactly as the payload named
it. The hook SHALL report every live commit that landed since the last observation, oldest first,
whatever else happened to HEAD afterwards. A commit that landed but is not live SHALL be named as
rewritten or abandoned, and SHALL get no detour-trail row and no `--attribute-commit`. A commit SHALL
be reported at most once per checkout, however many observations read it, including observations
that run concurrently; an observation that cannot report without risking a second report of the same
commit SHALL report nothing and leave that commit for a later observation. Entries removed from the
front of the reflog (reflog expiry, `git gc`) SHALL NOT cause a commit that landed after the recorded
position to go unreported. Only where the recorded entry itself is no longer in the reflog is nothing
reported as landed from the reflog on that observation.

#### Scenario: A commit followed by a checkout in the same call is reported

- **WHEN** one Bash call makes a commit, then runs `git checkout -b tmp` and `git checkout main`
- **THEN** the hook reports that commit

#### Scenario: Two commits in one call are both reported in landing order

- **WHEN** one Bash call makes two commits
- **THEN** the hook reports both, the older first, and any attribution command it prints names both
  commits in that order

#### Scenario: Reflog expiry between observations loses no commit

- **WHEN** an observation runs, a commit lands, the oldest HEAD reflog entry is then removed (as
  reflog expiry or `git gc` removes entries from the front), and the next observation runs
- **THEN** that observation reports the commit

#### Scenario: A commit rewritten by a rebase in the same call is not attributed

- **WHEN** one Bash call runs `git commit` and then `git pull --rebase`, which rewrites that commit
- **THEN** the hook names the original commit as rewritten or abandoned, writes no detour-trail row
  for it, and prints no `--attribute-commit` naming it

#### Scenario: A commit reset away in the same call is not attributed

- **WHEN** one Bash call makes a commit and then runs `git reset --hard HEAD~1`
- **THEN** the hook names the commit as rewritten or abandoned, writes no row, and prints no
  `--attribute-commit` naming it

#### Scenario: A commit inside a failing call is reported on the failure event

- **WHEN** a Bash call makes a commit and exits non-zero, and the hook runs with that call's
  `PostToolUseFailure` payload
- **THEN** the hook reports the commit, and its output names `PostToolUseFailure` as the event

#### Scenario: The hook configuration covers both post-call events

- **WHEN** the plugin's hook configuration is read
- **THEN** the commit hook is wired for Bash on `PostToolUse` and on `PostToolUseFailure`, and on no
  pre-call event

#### Scenario: Overlapping observations never drop or repeat a commit

- **WHEN** two observations read the reflog concurrently, a commit lands, and both record their
  position in either order, and a third observation follows
- **THEN** the commit is reported by exactly one of the three, and the detour trail holds at most one
  commit-derived row for it

### Requirement: A reported commit is stated as landed since the last observation, not proven to be this call's

The hook cannot tell a commit made by the Bash call it answers from one made in another terminal or
by a parallel call in the same interval. Whenever it reports a commit, its output SHALL state that the
commit landed since the previous observation and may have been made outside this call. It SHALL NOT
state or imply that the call it answers made the commit. Where it writes an automatic detour-trail
row, its output SHALL name `retract-detour` as the correction for a row that is wrong.

#### Scenario: The report states the provenance limit

- **WHEN** a commit lands and the hook reports it
- **THEN** the output states the commit landed since the last observation and may come from another
  terminal or a parallel call

#### Scenario: A commit from another terminal carries the same statement

- **WHEN** a commit is made between two Bash calls, outside either, and the next call makes no commit
- **THEN** the next observation reports it with that statement, and an automatic row written for it
  is accompanied by the `retract-detour` correction

### Requirement: An amended commit is replaced, not added

For every `commit (amend)` entry that landed since the last observation, live or not, the commit it
replaced (the reflog entry's previous value) SHALL be treated as superseded only if that replaced
commit is not live when the observation reads the reflog. A replaced commit that is live again (the
amend was undone, e.g. `git reset --hard HEAD@{1}`) is not superseded: no row of it is retracted and no
withdrawal is printed for it. Any commit-derived detour-trail row for the replaced commit
SHALL be retracted by the engine, as the retraction requirement below defines, with a reason naming
the replacing commit, before the replacing commit is classified. The hook SHALL NOT print an
`--attribute-commit` naming the replaced commit. Where the replaced commit is in any epic's
attribution array, the hook SHALL print, before any attribution command, a runnable
`update-epic <that epic> --withdraw-commit <replaced> --withdrawal-reason "<…>"`; the engine SHALL NOT
withdraw it itself. Only where `update-epic` would refuse that withdrawal — the epic is archived with outcome
`delivered` and withdrawing the replaced commit would break an obligation its archived record meets —
the hook SHALL NOT print that command; it SHALL instead state that the replaced commit is attributed to
a delivered epic whose record the withdrawal would break, and that changing it means recording the
disposition the change implies, as that refusal directs. Everywhere else, including a delivered epic
whose record the withdrawal would not break, the command SHALL be printed.

#### Scenario: Amending a logged commit leaves one visible row

- **WHEN** a commit is auto-logged to the detour trail and a later call amends it
- **THEN** `PROJECT.md`'s detour table shows a row for the amending commit and none for the replaced
  one, and the log still holds the replaced commit's original row followed by its retraction

#### Scenario: An undone amend supersedes nothing

- **WHEN** commit C1 is auto-logged and attributed to epic E, and one later call runs `git commit
  --amend` and then `git reset --hard HEAD@{1}`
- **THEN** C1's row is not retracted and no `--withdraw-commit` is printed for C1

#### Scenario: An amend of a delivered epic's commit prints no bare withdrawal

- **WHEN** a commit attributed to openspec-lane epic E, archived with outcome `delivered` and a Gate 2
  verdict that withdrawing the commit would break, is amended and the replaced commit is not live
- **THEN** the hook prints no `update-epic E --withdraw-commit` line, and its output names E as a
  delivered epic holding the replaced commit and says the change requires recording a disposition

#### Scenario: A delivered epic whose record the withdrawal does not break still gets the command

- **WHEN** a commit attributed to claude-code-lane epic F, archived with outcome `delivered`, is amended
  and the replaced commit is not live
- **THEN** the hook prints `update-epic F --withdraw-commit <replaced>` with a withdrawal reason, and
  does not say a disposition is required

#### Scenario: A chain of amends retracts and withdraws the original

- **WHEN** commit C1 is auto-logged and attributed to epic E, and one later call amends it to C2 and
  amends again to C3
- **THEN** C1's row is retracted, the hook prints `--withdraw-commit` for C1 and no
  `--attribute-commit` for C1 or C2, and `PROJECT.md` shows no row for C1 or C2

#### Scenario: Amending an attributed commit names the withdrawal

- **WHEN** a commit attributed to epic E is amended
- **THEN** the hook prints `update-epic E --withdraw-commit <replaced>` with a withdrawal reason before
  any attribution command, and E's attribution array is unchanged by the hook

### Requirement: The detour trail does not auto-log an epic's own work or pm's own bookkeeping

An epic's **own artifacts** are the paths under `openspec/changes/<epic id>/` and each source-artifact
path the epic records (its plan path and its spec path). Paths are compared relative to the
conductor root: a changed path outside the conductor root never matches an own artifact or one of
pm's own generated files.

- The AUTO-DETOUR row (no detour live) SHALL NOT be written for a commit that touches any of the
  active epic's own artifacts.
- The DETOUR-COMMIT row (a detour live) SHALL NOT be written for a commit whose changed paths all lie
  within the own artifacts of epics paused on the detour stack.
- Neither row SHALL be written for a commit whose changed paths are all pm's own generated files,
  in a conductor at the git root or in a subdirectory of it.
- Where a commit's changed paths cannot be read, both rows keep today's behaviour.

This SHALL NOT be decided from a commit's subject prefix or scope.

#### Scenario: A TDD commit that touches the active epic's change directory is not a detour

- **WHEN** no detour is live, epic A is active, and a `fix(…):` commit touches
  `openspec/changes/A/red-1.txt` and two source files
- **THEN** no AUTO-DETOUR row is written

#### Scenario: A task-tick commit for the active epic is not a detour

- **WHEN** no detour is live, epic A is active, and a `chore(openspec):` commit touches only
  `openspec/changes/A/tasks.md`
- **THEN** no AUTO-DETOUR row is written

#### Scenario: A commit touching the active epic's plan file is not a detour

- **WHEN** no detour is live, epic A is active with a plan path, and a `chore(…):` commit touches that
  plan file
- **THEN** no AUTO-DETOUR row is written

#### Scenario: A commit confined to a paused epic's artifacts is not detour work

- **WHEN** epic P is paused behind detour D and a commit touches only `openspec/changes/P/tasks.md`
- **THEN** no DETOUR-COMMIT row is written for D

#### Scenario: A nested conductor's bookkeeping commit is not a detour

- **WHEN** the conductor lives at `projects/sub/` of its git repository, an epic is active, and a
  `chore(conductor):` commit touches only `projects/sub/.conductor/state.json` and
  `projects/sub/PROJECT.md`
- **THEN** no AUTO-DETOUR row is written

#### Scenario: A nested conductor's mixed commit is still logged

- **WHEN** in that nested conductor a small `chore(…):` commit touches `projects/sub/PROJECT.md` and
  `src/thing.mjs` outside the conductor root
- **THEN** the AUTO-DETOUR row is written exactly as it would be for a flat conductor

### Requirement: An auto-logged detour row is retracted by a verb, and the rendered record follows

A row **matches** a commit when the commit's full object name begins with the sha the row holds,
whatever that row's abbreviation length. Retraction, amend retraction and the trail's duplicate
check SHALL all use this match.

`retract-detour <sha> --reason "<why>"` SHALL be the inverse of the hook's automatic logging. It SHALL
be accepted only where a commit-derived row (`AUTO-DETOUR` or `DETOUR-COMMIT`) matching `<sha>` is not
already retracted and a non-empty reason is given. `<sha>` matches a row when it resolves to a commit
whose full name begins with the row's sha. Where `<sha>` resolves to no commit (a rewritten commit since
pruned), it SHALL be at least 7 hexadecimal characters and SHALL match only rows whose own sha also
resolves to no commit and where either of `<sha>` and the row's sha begins with the other; exactly one
such row (or the rows of exactly one sha) SHALL match, and otherwise the invocation is refused with a
message naming the ambiguity or the too-short value. Every other
invocation exits non-zero with a message naming which of those failed, and writes nothing. An accepted
retraction SHALL append a retraction row naming the commit and the reason, SHALL NOT remove or
rewrite any existing row, and SHALL re-render `PROJECT.md` in the same invocation so no retracted row
appears there. A retracted commit SHALL still count as logged, so a later observation does not log it
again. `MINIMAL` rows are not retractable by this verb. The hook's message after an automatic row
SHALL name this verb and SHALL NOT instruct editing or removing a line of the log.

#### Scenario: Retracting an auto-logged row removes it from PROJECT.md

- **WHEN** the agent runs `retract-detour <sha> --reason "the active epic's own work"` for a commit
  with an AUTO-DETOUR row
- **THEN** it exits 0, the log keeps the original row and gains one retraction row, and `PROJECT.md`
  re-rendered by that invocation shows no row for the commit

#### Scenario: Rows of different abbreviation lengths match the same commit

- **WHEN** the log holds a 7-character row and an 8-character row for two commits, and
  `retract-detour` is given each commit's full name in turn
- **THEN** each invocation retracts the row for its commit, and neither retracts the other's

#### Scenario: A row whose commit no longer exists can be retracted

- **WHEN** the log holds an AUTO-DETOUR row for a commit that was rewritten and pruned, and
  `retract-detour` is given that row's sha
- **THEN** it exits 0 and appends a retraction for that row

#### Scenario: An unresolvable sha that is short or ambiguous is refused

- **WHEN** `retract-detour 1 --reason x` runs, or `retract-detour` is given a 7-character prefix
  shared by the rows of two different pruned commits
- **THEN** each exits non-zero naming the too-short value or the ambiguity, and `detours.log` and
  `PROJECT.md` are byte-identical

#### Scenario: Each refusal names its reason

- **WHEN** `retract-detour` names a sha that matches no row, a commit with no commit-derived row, a commit whose row is already retracted, a commit with only a `MINIMAL` row, or gives no reason
- **THEN** each exits non-zero with a message naming that specific reason, and `detours.log` and
  `PROJECT.md` are byte-identical

#### Scenario: The hook points at the verb, not at a hand-edit

- **WHEN** the hook writes an AUTO-DETOUR row
- **THEN** its message names `retract-detour` and does not tell the agent to edit or remove a line
