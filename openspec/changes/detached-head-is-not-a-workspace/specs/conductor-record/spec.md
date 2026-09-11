## ADDED Requirements

### Requirement: A detached HEAD suppresses breadcrumb writes

The engine MUST NOT write session breadcrumbs — the commit watermark, the detour log, the brief
snapshot, or the activity log — into a working tree whose HEAD is detached.

> The dormancy guard asks whether `.conductor/state.json` exists, and that file is git-tracked so
> the documented `git restore` undo works. In a repository that deploys by checking ITSELF out, the
> deployed copy therefore carries `state.json` and reads as a workspace. One file is answering two
> questions — *is this repository pm-managed* and *is this tree a place to work* — which diverge
> exactly there.
>
> Breadcrumbs are the writes where suppression costs nothing: each records work in progress, and a
> tree nobody is working in has none. Suppression is SILENT for them, because a breadcrumb that
> does not appear asserts nothing, where a warning about one would be noise on every hook.

#### Scenario: The commit watermark is not written in a detached tree

- **WHEN** the commit-nudge hook runs in a working tree whose HEAD is detached
- **THEN** no commit watermark file is created or updated in that tree

#### Scenario: The detour log is not written in a detached tree

- **WHEN** a detour would be logged in a working tree whose HEAD is detached
- **THEN** no detour log entry is written in that tree

#### Scenario: The brief snapshot and the activity log are not written in a detached tree

- **WHEN** a snapshot or an activity event would be written in a working tree whose HEAD is detached
- **THEN** neither is written in that tree

#### Scenario: A tree on a branch is unaffected

- **WHEN** any of those writes happens in a working tree whose HEAD is on a branch
- **THEN** it happens exactly as it did before, with no suppression and no additional output

#### Scenario: A repository git cannot answer about is treated as a workspace

- **WHEN** the detachment probe cannot answer — no git, git absent from PATH, or the command fails
- **THEN** the engine treats the tree as a workspace and writes breadcrumbs normally

> The safe direction is to keep recording. A false breadcrumb is visible and removable; a false
> SUPPRESSION silently disables the trail, which is the same asymmetry the bookkeeping guard in
> `isConductorOwnFiles` already states.
