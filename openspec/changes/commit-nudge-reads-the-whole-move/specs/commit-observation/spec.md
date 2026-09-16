## Purpose

What pm's commit hook observes about the commits a single agent tool call made, which of those
commits it may report, when it writes a row to the detour trail (`.conductor/detours.log`), how an
amended commit is treated, and how a row the engine logged automatically is retracted.

## ADDED Requirements

### Requirement: Every commit a tool call creates is reported, in the order it landed

Vocabulary used by every requirement in this capability:

- a **tool call** is one Bash tool invocation, bounded by the hook run before it executes and the
  hook run after it returns — whether it returned successfully or failed;
- a commit **lands in** a tool call when the HEAD reflog records its creation (a `commit`,
  `commit (initial)` or `commit (amend)` entry) after the position recorded before that call and no
  later than the position read after it;
- a commit is **reported** when the hook's output names it.

After a tool call, the hook SHALL report every commit that landed in it, oldest first, whatever
else the call did afterwards to HEAD (checkout, switch, reset, pull, rebase). The plugin's hook
configuration SHALL run the hook before each Bash tool call and after it both on success and on
failure. A commit SHALL be reported at most once per checkout, however many hook runs observe it.
Only the commit-creating reflog actions above are reported; `revert`, `cherry-pick`, `merge` and
`rebase` entries are not, exactly as today.

#### Scenario: A commit followed by a checkout in the same call is reported

- **WHEN** one tool call makes a commit, then runs `git checkout -b tmp` and `git checkout main`
- **THEN** the hook after that call reports that commit, and the detour-trail rules below are
  applied to it

#### Scenario: Two commits in one call are both reported in landing order

- **WHEN** one tool call makes two commits
- **THEN** the hook reports both, the older first, and any attribution command it prints names both
  commits in that order

#### Scenario: A commit inside a failing call is reported

- **WHEN** a Bash call makes a commit and then exits non-zero, and the commit hook runs with that
  call's post-call failure payload
- **THEN** the hook reports the commit exactly as it would after a successful call

#### Scenario: The hook configuration covers every event of a Bash call

- **WHEN** the plugin's hook configuration is read
- **THEN** the commit hook is wired for Bash on the pre-call event, the post-call success event and
  the post-call failure event

#### Scenario: A commit is not reported twice

- **WHEN** two overlapping tool calls both observe the same commit landing, or the post-call hook
  runs a second time for the same call
- **THEN** the commit is reported by exactly one hook run and the detour trail holds at most one
  commit-derived row for it

### Requirement: A commit that did not land in the call is never logged or attributed against it

A commit that landed outside every observed tool call — made in another terminal, by another
session between calls, or by a call whose post-call hook never ran — SHALL NOT be written to the
detour trail by a later call's hook and SHALL NOT appear in an attribution command that hook
prints. The hook MAY name such commits as landed outside the call. Where no pre-call position was
recorded for the call, no commit the hook observes can be shown to have landed in it, and the same
rule applies to all of them.

#### Scenario: A commit from another terminal is not claimed by the next call

- **WHEN** a commit lands between two tool calls, outside either, and the next tool call makes no
  commit
- **THEN** that call's hook writes no detour-trail row and prints no `--attribute-commit` naming the
  commit

#### Scenario: A call with no recorded pre-call position claims nothing

- **WHEN** the post-call hook runs for a call whose pre-call hook recorded no position, and HEAD's
  reflog shows a commit since the last observation
- **THEN** no detour-trail row is written for that commit and no `--attribute-commit` names it

### Requirement: An amended commit is replaced, not added

When a commit that landed is an amend, the commit it replaced SHALL be treated as superseded by
it. Any commit-derived detour-trail row for the replaced commit SHALL be retracted by the engine,
as the retraction requirement below defines, with a reason naming the replacing commit, before the
replacing commit is classified. The hook SHALL NOT print an `--attribute-commit` naming the
replaced commit. Where the replaced commit is in any epic's attribution array, the hook SHALL print,
before any attribution command for the replacing commit, a runnable `update-epic <that epic>
--withdraw-commit <replaced> --withdrawal-reason "<…>"` command; the engine SHALL NOT withdraw it
itself.

#### Scenario: Amending a logged commit leaves one visible row

- **WHEN** a commit is auto-logged to the detour trail and the next call amends it
- **THEN** `PROJECT.md`'s detour table shows a row for the amending commit and none for the
  replaced one, and the log still holds the replaced commit's original row followed by its
  retraction

#### Scenario: Amending an attributed commit names the withdrawal

- **WHEN** a commit attributed to epic E is amended
- **THEN** the hook prints `update-epic E --withdraw-commit <replaced>` with a withdrawal reason
  before any attribution command, and E's attribution array is unchanged by the hook

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
- Where a commit's changed paths cannot be read, both rows keep today's behaviour: a false row is
  retractable, a false suppression is invisible.

This SHALL NOT be decided from a commit's subject prefix or scope.

#### Scenario: A TDD commit that touches the active epic's change directory is not a detour

- **WHEN** no detour is live, epic A is active, and a `fix(…):` commit touches
  `openspec/changes/A/red-1.txt` and two source files
- **THEN** no AUTO-DETOUR row is written

#### Scenario: A task-tick commit for the active epic is not a detour

- **WHEN** no detour is live, epic A is active, and a `chore(openspec):` commit touches only
  `openspec/changes/A/tasks.md`
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

`retract-detour <sha> --reason "<why>"` SHALL be the inverse of the hook's automatic logging. It
SHALL be accepted only where `<sha>` resolves to a commit that has a commit-derived row
(`AUTO-DETOUR` or `DETOUR-COMMIT`) in the detour trail not already retracted, and a non-empty
reason is given; every other invocation exits non-zero, names why, and writes nothing. An accepted
retraction SHALL append a retraction row naming the commit and the reason, SHALL NOT remove or
rewrite any existing row, and SHALL re-render `PROJECT.md` in the same invocation so the retracted
row no longer appears there. A retracted commit SHALL still count as logged, so a later hook run
does not log it again. `MINIMAL` rows are not retractable by this verb. The hook's own message after
an automatic row SHALL name this verb and SHALL NOT instruct editing or removing a line of the log.

#### Scenario: Retracting an auto-logged row removes it from PROJECT.md

- **WHEN** the agent runs `retract-detour <sha> --reason "the active epic's own work"` for a commit
  with an AUTO-DETOUR row
- **THEN** it exits 0, the log keeps the original row and gains one retraction row, and `PROJECT.md`
  re-rendered by that invocation shows no row for the commit

#### Scenario: A retraction with nothing to retract is refused

- **WHEN** `retract-detour` names a commit with no commit-derived row, a commit already retracted,
  or gives no reason
- **THEN** it exits non-zero naming which, and `detours.log` and `PROJECT.md` are byte-identical

#### Scenario: The hook points at the verb, not at a hand-edit

- **WHEN** the hook writes an AUTO-DETOUR row
- **THEN** its message names `retract-detour` and does not tell the agent to edit or remove a line
