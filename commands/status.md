---
description: Show the current conductor briefing — active epic, detour stack, next up
allowed-tools: Bash, Read
---

Show where the project stands.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" render
```
(If `${CLAUDE_PLUGIN_ROOT}` is empty:
`ENGINE="${CLAUDE_PROJECT_DIR:+$CLAUDE_PROJECT_DIR/scripts/conductor.mjs}"; [ -f "$ENGINE" ] || ENGINE="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/conductor.mjs}"; [ -f "$ENGINE" ] || ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1); node "$ENGINE" render`)

Then read `PROJECT.md` and summarize for the user:
- the **active** epic and its live story progress,
- the **detour stack** (what's paused and why), flagging any ⚠ reconcile-on-resume,
- the **next-up** queue by priority — reading the **effective** priority where the Priority
  column shows `P2 → P1` (P2 on merit, sorting as P1 because a P1 depends on it),
- **DEPENDENCY WARNINGS**, if any — an epic that cannot be started, what it waits on, and that
  dependency's status. Report these BEFORE the queue: an epic named on the left of one of them
  is not workable however high its priority, and the decision it forces (pull the dependency
  forward, or descope the epic waiting on it) is the point. A `blocked` epic with no
  `depends-on` link is listed here too — `blocked` otherwise records nothing about what it
  waits on.
- **UNGATED ARCHIVES**, if any — epics archived with no Gate 2 review from anyone. This is a
  standing condition rather than an episode: it is recomputed from `state.json` at every
  composition and never consumed, so every session sees it until a real passing verdict
  supersedes it. A notice that was consumed on delivery would report the condition to one session
  and hide it from every session after.
- **HANDOFFS**, from both ends — the epic that carried work out and the epic that inherited it.
  A relationship visible from one side only is how a remainder disappears.
- each **release**'s `N epics, M deferred`.

Story counts are derived live from each proposal's `openspec/changes/<id>/tasks.md` — if
they look stale, the tasks.md checkboxes are the source of truth, not the index.

**Progress excludes lifecycle bookkeeping.** A task carrying the literal marker
`<!-- pm:lifecycle -->` on its own line is bookkeeping about the change's own lifecycle rather
than its work, and is excluded from the count — it renders as `· N lifecycle` beside the ratio,
or `0/0 · N lifecycle` where every task is excluded. The archive task always qualifies: it
cannot be ticked before the thing that ticks it, so it used to render as outstanding work
forever and would now demand a handoff at archive time.

## Auditing the record itself

`integrity` is a READ-ONLY audit of the conductor's own record — shapes that cannot be true: an
archived epic with nothing ticked, one change registered under two lanes, a gate verdict that
does not reach the commits it cites, a gate recorded as bookkeeping rather than review, a
`delivered` epic that attributed no commits, an archived openspec-lane epic with a passing Gate 2
and no Gate 1, an epic archived with an `ungated` Gate 2, an epic the archive-drift heal flipped
that reads `outcome: unknown` while carrying a passing Gate 2, a dangling epic reference, an
archive directory no epic corresponds to, and a recorded commit sha this repository can no longer
resolve. It reports every check with its count, including the ones that found nothing, so a check
that measured nothing is visibly a check that ran.

`recorded-sha-the-repository-cannot-resolve` is the one with a deadline. A squash-merge orphans
every commit on the merged branch — they are reachable from no ref and the next `git gc` deletes
them (default `gc.pruneExpire`: two weeks) — which silently turns every `attributedCommits` entry
and every gate verdict's `baseSha`/`headSha` into a sentence about commits nobody can look at.
The check separates **orphaned** (still in the object store, recoverable now with `git tag`) from
**already gone**, and stays silent in a clone that resolves none of the record at all, because a
fresh, shallow or single-ref clone legitimately lacks that history and is not a disaster.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" integrity
```

It writes no state, blocks no command, and repairs nothing. Each finding names the epic and the
remediation is a command you run — recording a real Gate 2 verdict, recording the disposition an
epic actually ended with, or removing a duplicate registration.

**On the first run after upgrading to 0.27.0, expect a burst of
`heal-archived-epic-passed-gate-2`.** Every repo that followed the documented `/opsx:archive` →
heal flow lands on `outcome: unknown` rather than `delivered`: the migration only stamps epics
already `archived` in state, and the heal flips the rest afterwards, so they miss it by one step.
That is expected, not a bug. Each finding carries the exact remedy —
`update-epic <id> --status archived --outcome delivered --no-deferrals` — and the archive gate
lets an agent replace an engine-written stamp, so nothing is frozen at `unknown`. Run it when the record looks
wrong, before a release, or when you want to know what the numbers in `PROJECT.md` are hiding.

## Release planning — `release`

A release is a named grouping of epics the agent declares: an id, intent prose, an optional
target, and the epics deliberately cut from it. It exists because a release's scoping judgments
otherwise survive only in the session that made them — "what is in 0.27.0" has to be answerable
from `.conductor/state.json` alone, months later, without a conversation transcript.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" release 0.27.0 --intent "<what this release is for>" [--target <t>]
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" release 0.27.0 --member <epicId> [--member <epicId>]...
```

- **Intent prose is required to create one** and the same refusal covers naming a release that
  does not exist — an id with no statement of what it is for is unreadable later, which is the
  failure this records against.
- **Membership is one-way**: it lives on the epic as `epic.release`, at most one, and the release
  object carries no member list to fall out of step with it. Re-associating an epic MOVES it.
- **The engine proposes nothing.** No epic is auto-assigned, and adding, re-prioritizing or
  archiving epics changes membership for none of them. Grouping is a scope judgment, and the
  scope judgment is the thing being preserved.
- Re-running `release <id> --intent …` amends that release in place rather than registering a
  second one.

**Recording what you cut — `--defer`:**

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" release 0.27.0 --defer <epicId> --reason "<why it was cut>"
```

- **The reason is required.** It is the same reason-bearing disposition record every other
  ending uses, at a fourth scope, and it is what distinguishes an epic deliberately excluded
  from an epic nobody considered — leaving one queued is not an exclusion.
- **An exclusion is not an ending.** The epic keeps its status and gets no disposition of its
  own; it stays in the backlog because it is still work someone may do. What it does lose is
  membership of that release — an epic cannot be in a release it was cut from.
- Re-deferring the same epic updates its reason. Re-adding a deferred epic with `--member`
  removes the exclusion and says on stderr what the removed record read, so a recorded judgment
  never disappears silently.

## The gate procedure — required task items

Carried into every change's own task list as NUMBERED REQUIRED TASK ITEMS, never as review
guidance. The form was measured, not guessed: across one audited repository a rule carried by a
mandatory task section reached 14/14 subsequent changes, while the same rule written as a prose
bullet reached 3/15.

1. **Call-site completeness sweep.** For every rule, guard or invariant the change introduces or
   modifies, enumerate ALL call sites of the thing being guarded — derived mechanically (`rg` for
   the callers), never a list typed from memory — then state where the rule holds and where it
   does not, and justify each omission. A guard added at one call site while an identical sibling
   site is left untouched is a FINDING, not a detail: both gates are diff-scoped and structurally
   cannot see an edit absent from a file the diff never touched.
   A DATA reference is a call site too: for every field the change adds that holds another
   record's id, enumerate the places that write it, read it and REMOVE it. A deletion path that
   strips one holder and not its siblings leaves a dangling reference — the record rendering a
   pointer to something that no longer exists — and it is invisible to both gates for the same
   diff-scoped reason.
2. **Verify against the commit, not the working tree.** The commit is the unit of verification.
   Reading a file in the working tree is NOT verification. For every task, run
   `git show --stat <that task's sha>` and assert that every file the task claims to change
   appears in THAT commit. A task whose claimed file is absent
   from its commit FAILS, even though the working tree holds the intended edit, the suite passes
   and both gates are green.
3. **Declare lifecycle bookkeeping.** A task that is bookkeeping about the change's own lifecycle
   rather than its work — above all the task that archives the change itself, which always
   qualifies — carries the literal marker `<!-- pm:lifecycle -->` on the task line. The engine
   infers this from nothing else: not the wording, not the commands the text names, not the
   position in the file. Mark it when the task source is authored OR AMENDED — a source written
   before this capability existed gets the marker the first time you touch it, or its archive task
   counts as outstanding work forever.
4. **Attribute every commit to its epic.** At the moment each commit is made, record it:
   `update-epic <id> --attribute-commit <sha>`. The engine infers attribution from nothing — not
   the files a commit touches, not an epic id in a message — so an unrecorded commit is a commit
   the epic's Gate 2 cannot be checked against. The per-task conventional commit of an OpenSpec
   apply loop always qualifies. Work already in flight is covered too, but **only before the first
   attribution**: catch up in the order the commits landed, then keep attributing forward. The
   array is append-only — the engine neither reorders nor de-duplicates it — so catching up AFTER
   attributing forward leaves an ancestor as the last entry, and the last entry is the endpoint a
   recorded Gate 2 `headSha` is compared against. If forward attribution has already begun,
   attribute forward only and say so; a wrong endpoint reads as a stale verdict and refuses the
   archive. **One exclusion:** the commit that moves
   `openspec/changes/<id>/` under `archive/`, and any commit that only relocates or deletes a
   change's artifacts rather than implementing its work, is lifecycle bookkeeping and
   MUST NOT be attributed — that move lands after the reviewed range by construction, so attributing it makes
   the epic's own Gate 2 stale at the instant the archive gate reads it.
5. **Review a release's specs against each other.** Gate 1 and Gate 2 each take ONE CHANGE as
   their unit, so nothing above them asks whether a release's specs AGREE. Before `/opsx:apply`
   on any release holding **two or more spec files** — counted FLAT across its member changes, so
   one change carrying six specs qualifies — and again after any round of concurrent amendment,
   dispatch FRESH-CONTEXT reviewers at the release's whole spec set (one under `standard`, two
   with different lenses under `thorough`) and ask the six questions: contradiction, double
   ownership, unmeetable requirements, gaps against the proposal's Resolves list, vocabulary
   forks, and shared chokepoints. Split every finding into BLOCKS and POLISH, fix the BLOCKS,
   decline most POLISH and say why — a review of a large document always returns something, so
   "no findings" is not a stopping condition. A contradiction is never POLISH. Then record the
   verdict: `record-cross-spec-review <releaseId> --verdict pass|fail --reviewer "<identity>"`.
   The engine enumerates the spec set from disk and hashes it, so a spec ADDED to the release
   afterwards — or a reviewed spec amended — marks the verdict stale on every surface; a set you
   assert instead would go stale in exactly the way this gate exists to catch. Measured here:
   this pass returned 5 Critical and 10 Important against six specs that had each passed
   `openspec validate --strict` and would each have passed Gate 1 alone, including a flagship
   scenario that was unreachable.
6. **End work by recording a disposition.** An epic, a story, a deferral or a release exclusion
   ENDS by recording a terminal disposition carrying its required reason, and
   never by removing the record. The archive verb takes TWO halves in ONE invocation — the
   disposition AND a deferral assertion — because the gate refuses either half alone:
   `update-epic <id> --status archived --outcome delivered|killed|superseded|abandoned|declined --reason "<why>" --no-deferrals`
   (every outcome except `delivered` requires the reason). `--no-deferrals` is the explicit
   "there are none" and is a claim, not a default — swap it for `--deferral
   "<epicId>:<artifact section>"` where work is now held by a registered epic, or
   `--declined-deferral "<what>:<why not>"` where you are deliberately not doing it; both
   repeat, and the engine will not read your artifacts to guess.
   Deletion removes the record of projected work, which is
   precisely what a disposition exists to preserve. `remove-epic` stays available and ungated for
   what it is for: an epic registered in error, a duplicate, a mistake made a minute ago — where
   there is no disposition to record because there was no work.
