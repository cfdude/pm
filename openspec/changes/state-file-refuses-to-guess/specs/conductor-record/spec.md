## ADDED Requirements

### Requirement: An advisory claim's lifetime is bounded, and an unreadable expiry reads as expired

A claim's TTL SHALL be bounded by a fixed maximum number of minutes, and the bound SHALL be one
definition shared by the verbs that write a claim and the readers that judge one.

At input, `claim <epic-id>` and `claim --repo` SHALL refuse a `--ttl` that is not a finite number
greater than zero and no greater than the maximum: exit non-zero, name the maximum, and write
nothing — neither `state.json` nor `.conductor/session-claim.json`.

A claim already on disk SHALL be judged without throwing. A claim whose expiry cannot be computed —
its `claimedAt` does not parse, its `ttlMinutes` is not a finite positive number, its `ttlMinutes`
exceeds the maximum, or `claimedAt` plus the TTL is not a representable date — has NO expiry and
reads as EXPIRED, never as live. This holds for an epic claim and for the repository claim alike,
and for every reader: `owners`, `integrity`, and `claim`/`unclaim` judging another session's claim,
with or without `--steal`.

> Expired, not live, and the direction is chosen: an unreadable marker read as live would block every
> other session with no way to reason about when it stops. A claim written by an earlier engine with
> a TTL above the new maximum therefore reads as expired after upgrade; the holder re-claims. A
> reader that throws is worse than either reading: in the reproduction, one `claim --ttl 1e12` made
> `owners`, `integrity` and every other session's `claim`/`unclaim` crash on every later invocation.

#### Scenario: An oversized TTL is refused at input

- **WHEN** `claim <epic-id> --session s1 --ttl 1e12` is run
- **THEN** it exits non-zero, the message names the maximum, and `state.json` is byte-identical
  afterwards

#### Scenario: An oversized repository TTL is refused at input

- **WHEN** `claim --repo --session s1 --ttl 1e12` is run
- **THEN** it exits non-zero and `.conductor/session-claim.json` is not created or changed

#### Scenario: The maximum itself is accepted

- **WHEN** `claim <epic-id> --session s1 --ttl <the maximum>` is run
- **THEN** the claim is written and the report names its expiry

#### Scenario: A poisoned epic claim already on disk reads as expired

- **WHEN** an epic's stored claim carries `ttlMinutes: 1000000000000`, and `owners`, `integrity`, and
  `claim <epic-id> --session s2` are each run
- **THEN** none of them throws; `owners` reports the claim as not live; `integrity` reports it as
  expired at an unreadable time; and the claim by `s2` succeeds without `--steal`, reporting that the
  previous claim had expired

#### Scenario: A poisoned repository claim already on disk reads as expired

- **WHEN** `.conductor/session-claim.json` carries `ttlMinutes: 1000000000000` and `owners` is run
- **THEN** it exits 0 and reports the repository claim as not live

## MODIFIED Requirements

### Requirement: A detached HEAD suppresses session-bookkeeping writes

The engine MUST NOT write **session bookkeeping** into a working tree whose HEAD is detached.

Session bookkeeping is defined by a CRITERION, not by a list: a file the engine writes that is
**per-checkout, engine-owned, and a record of work in progress rather than of the project**. The
enumeration below is every `.conductor/` write site the engine has, each settled against that
criterion — so a site added later is measured against the definition rather than silently falling
outside a closed list.

| write site | file | suppressed? |
| --- | --- | --- |
| `commit-watch.mjs` | `commit-watch.json` | YES — a watermark for a session's own commits |
| `git.mjs` `appendDetourLog()` | `detours.log` | YES — a record of interrupting active work |
| `subcommands.mjs` | `brief.txt` | YES — a snapshot for the next session in this tree |
| `activity-log.mjs` | `activity/*.log` | YES — per-session event trail |
| `claims.mjs` | `session-claim.json` | YES — it says "THIS session is mid-operation in THIS working tree", which is the criterion stated aloud |
| `write-conflicts.mjs` | `write-conflicts.log`, `.latch` | NO — see below |
| `subcommands.mjs` | `honcho-memories.log` | NO — see below |
| `render.mjs` | `render-stamp.json` | NO — see below |
| `state.mjs` | `state.json.lock` | NO — see below |

**`write-conflicts.log` and its latch are NOT suppressed.** They record that two writers collided,
which is a fact about the repository rather than about a session, and the latch is consumed by
`brief` — a verb declared `read-only`, so the warning half of this change cannot reach it either.
Suppressing it would be the only case here where suppression loses evidence of a real problem.

**`honcho-memories.log` is NOT suppressed.** It is an append-only outbox of lines the operator is
meant to paste elsewhere, so a missing line is work lost rather than noise avoided. It is also not
gitignored, which makes its absence visible rather than silent.

**`render-stamp.json` is NOT suppressed, and this is the consequential one.** It is written by
`render()` on essentially every mutating verb, and it is TRACKED — measured dirty in the deployed
tree this change was proposed against. It is not session bookkeeping: it records when the project's
own rendered output was produced. Leaving it writing means a mutating verb in a detached tree still
dirties a tracked file, which is precisely what the warning in `state-write-guard` exists to
announce. Suppressing it here would make the warning's subject disappear and would leave
`PROJECT.md` and the stamp disagreeing about when they were produced.

**`state.json.lock` is NOT suppressed.** It is per-checkout and engine-owned, but it is not a record of
anything: it exists only for the duration of a `state.json` save, and that save is not suppressed in a
detached tree. Suppressing the lock would leave the save unserialised in exactly the tree whose writes
already go unnoticed, which is the lost-update window `state-write-guard` closes.

> The dormancy guard asks whether `.conductor/state.json` exists, and that file is git-tracked so
> the documented `git restore` undo works. In a repository that deploys by checking ITSELF out, the
> deployed copy therefore carries `state.json` and reads as a workspace. One file is answering two
> questions — *is this repository pm-managed* and *is this tree a place to work* — which diverge
> exactly there.
>
> Suppression is SILENT for these, because a file that does not appear asserts nothing, where a
> warning about one would fire on every hook invocation.

#### Scenario: The commit watermark is not written in a detached tree

- **WHEN** the commit-nudge hook runs in a working tree whose HEAD is detached
- **THEN** the hook exits 0 and produces its normal output, AND no commit watermark file is created
  or updated in that tree

#### Scenario: The detour log is not written in a detached tree

- **WHEN** a detour would be logged in a working tree whose HEAD is detached
- **THEN** the verb completes and reports as it normally would, AND no detour log entry is written

#### Scenario: The brief snapshot, the activity log and the session claim are not written in a detached tree

- **WHEN** a snapshot, an activity event, or a session claim would be written in a working tree
  whose HEAD is detached
- **THEN** the invoking verb completes and reports as it normally would, AND none of the three is
  written

> Every suppression scenario asserts the POSITIVE half as well as the absence. An absence passes
> just as happily when the hook never fired, when the repository is not initialized, when the
> directory is unwritable, or when the feature does not exist at all — which is the vacuous-pass
> shape this repository has a standing rule against.

#### Scenario: commit-nudge in a detached tree does not fall back to the text heuristic

- **WHEN** the commit-nudge hook runs repeatedly in a working tree whose HEAD is detached
- **THEN** it does not nudge on the basis of command text alone

> Suppressing the watermark alone would leave `readWatch()` returning null forever, so every
> invocation reads `unverifiable / no-baseline` and falls through to the PRE-OBSERVATION text
> heuristic — `gh#104`'s behaviour, where any command merely mentioning `git commit` fires the
> nudge, reinstated permanently in exactly the tree where noise is least wanted, and reaching a
> `state.json` write on the way. Suppressing the WATERMARK requires suppressing the hook's
> REACTION; a gap in the watermark is otherwise safe (no false `landed` is constructible from a
> stale baseline, because the classifier also requires a matching reflog entry) but the fallback
> is not.

#### Scenario: A state save in a detached tree is still serialised

- **WHEN** a live, fresh state lock is held by another process in a working tree whose HEAD is
  detached, and a mutating verb saves state there
- **THEN** the save does not write while that lock is held, exactly as it would on a branch

#### Scenario: A tree on a branch is unaffected

- **WHEN** any of those writes happens in a working tree whose HEAD is on a branch
- **THEN** it happens exactly as it did before, with no suppression and no additional output

#### Scenario: A repository git cannot answer about is treated as a workspace

- **WHEN** the detachment probe cannot answer — not a repository, git absent from PATH, or the
  command fails for any reason other than reporting a detached HEAD
- **THEN** the engine treats the tree as a workspace and writes normally

> The safe direction is to keep recording. A false record is visible and removable; a false
> SUPPRESSION silently disables the trail, which is the same asymmetry `isConductorOwnFiles`
> already states. This is why the probe must distinguish "git says detached" from "git could not
> say" — see the design's exit-status rule.

#### Scenario: The probe answers about the tree being written to

- **WHEN** the engine's root and the process working directory are different trees
- **THEN** the detachment answer is the one for the root being written to, not the working directory

> `ROOT` is `CLAUDE_PROJECT_DIR || process.cwd()`, and the warning this change adds prints beside
> an existing one that exists PRECISELY for the case where those differ. A probe on the wrong tree
> would put two sentences about two different trees in one message, and nothing would detect it.
