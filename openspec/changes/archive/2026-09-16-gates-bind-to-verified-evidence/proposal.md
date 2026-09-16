## Why

Two gates pm treats as mechanical — the reconcile gate after a detour, and the Gate 2 staleness
check at archive — bind to values nobody verifies. The reconcile obligation can be cleared by a
verdict against the wrong detour, erased by moving the active pointer, or overwritten by a later
push; and a commit "sha" is stored exactly as typed, so a string that is not a commit, or a
moving ref like `HEAD`, turns a refused archive into an accepted one. The 0.43.0 code review found
the reconcile bypasses independently four times (A1, A2, B1, C2, E1) and the sha defects twice
(A1, A2). Every defect below was reproduced on the 0.43.0 engine in a hermetic scratch repository;
transcripts and scripts are under
`/private/tmp/claude-501/-Users-robsherman-Documents-Repos-pm/6e8d4b47-4277-41f4-9b04-fc3cd23d9e92/scratchpad/propose/gates-bind-to-verified-evidence/`
(`repro-reconcile.{sh,txt}`, `repro-extra.{sh,txt}`, `repro-shas.{sh,txt}`, `repro-tagonly.{sh,txt}`,
`repro-integrity.{sh,txt}` — `integrity` reports nothing for a Gate 2 `headSha` of `HEAD`, and `remove-epic d`
leaves `p` owing a reconcile with no link at all).
`repro-extra.txt` adds the siblings a fix at one site would miss: `update-epic other --status active`
also erases the obligation; `--clear-links` and `remove-epic d` each strip the only link the verdict
could be recorded against; a same-target `--link` reason correction drops a recorded verdict; a
verdict recorded while the detour's frame is still on the stack is accepted; and with two armed
detours, one verdict clears both.

**Reconcile gate** (`repro-reconcile.txt`), each after `push-detour p --detour d --reconcile` and
`pop-detour p` left `p` owing a reconcile with `gate-guard` exiting 2:

- `record-reconcile p --detour p --verdict valid` exits 0, writes a new `may-invalidate` link from
  `p` to itself, clears `reconcileNeeded`, and `gate-guard` exits 0 — while the real link to `d`
  stays unreconciled. `--detour other` (an unrelated epic) behaves identically.
- `clear-active`, or `set-active other`, clears `reconcileNeeded` through the render heal
  (`reconcileArchived()`); `set-active p` afterwards does not restore it and `gate-guard` exits 0.
- A second `push-detour p --detour d2 --reason second --no-reconcile` sets `reconcileNeeded:false`;
  the later `pop-detour p` prints the Honcho line `resumed p, reconciled vs d2; no reconcile was
  required` — a false record of an obligation against `d` that was never answered.
- Re-pushing to the same detour after a recorded verdict leaves `reconcileNeeded:true` on an epic
  whose only `may-invalidate` link already carries a verdict — the state any predicate requiring an
  "unreconciled link" would wedge on.
- `--amendments none` is stored as `["none"]`; `"rename x; keep a;b semantics"` becomes three
  entries.

**Commit shas** (`repro-shas.txt`):

- (A) An archive refused for an uncovered commit is accepted after
  `update-epic e --attribute-commit not-a-commit`: the verdict reads `⚠ unverifiable`, which the
  archive gate does not refuse, and the epic archives `delivered`.
- (B) `record-gate-review e --gate 2 --verdict pass --base-sha main~1 --head-sha HEAD` stores the
  literal `HEAD`; after an unreviewed commit is attributed, PROJECT.md renders
  `pass (main~1..HEAD)` with no marking and the epic archives `delivered`.
- (C) A Gate 2 whose `headSha` is a commit on an unrelated branch archives `delivered`
  (`archive-gate.mjs` `covers !== true → fresh`), although the existing `gate-integrity` spec says
  such a verdict SHALL be stale.
- (D) `--attribute-commit <descendant> --attribute-commit <ancestor>` with a Gate 2 at the ancestor
  archives `delivered`: only the last entry is compared (the finding recorded on
  `gate-staleness-reads-only-last-attribution`).
- (E) `--withdraw-commit <full sha>` against a stored short sha of the same commit is refused as
  "never attributed"; `--base-sha root` is accepted and stored.

Measured on this repository's own record (read-only): 183 distinct recorded commit values, **all
183 resolve** locally; 152 attributed entries are short hex and 67 full, 0 are symbolic. Every
one of the 14 passing verdicts carrying a range classifies identically under today's rule, a
last-entry ancestry rule, and an every-entry ancestry rule — so the stricter rule changes **zero**
live verdicts here. Across the 24 pm-managed repositories on this machine, **0** epics currently owe
a reconcile and **2** `may-invalidate` links exist in total. The legacy populations the new rules
must tolerate are small, but none is zero-by-construction.

## What Changes

- `record-reconcile` accepts a verdict only against a detour the epic's obligation was ARMED for
  by `push-detour --reconcile`; it never creates a link; the self-epic, an unrelated epic, a
  `--no-reconcile` detour and a detour whose frame is still on the stack are refused.
  `reconcileNeeded` clears only when no armed detour remains unanswered. A re-recorded verdict
  supersedes the prior one instead of overwriting it. `--amendments none` records no amendments,
  and a repeatable `--amendment` records one verbatim amendment per occurrence.
- The render heal never clears `reconcileNeeded` on an unarchived epic, except — announced on
  stderr — one holding no `may-invalidate` link at all, which no verdict could ever answer. Moving the
  active pointer off an epic owing a reconcile warns instead of silently erasing the obligation.
- Every `may-invalidate` link carries an explicit arming record: only `push-detour --reconcile`
  writes true; `--no-reconcile` pushes and hand-supplied links write false; a 0.44.0 migration
  stamps links written by earlier releases.
- `push-detour` ORs the obligation instead of assigning it, re-arms a detour that was already
  answered, and never reports "no reconcile" while an earlier obligation survives; `pop-detour`
  emits no Honcho POP line while any obligation is owed.
- Writes that would destroy an owed obligation's record — `--clear-links`, a same-target `--link`
  replacement, `remove-epic` of an armed detour — refuse or preserve it.
- Every commit value written by `update-epic --attribute-commit`, `--withdraw-commit` and
  `record-gate-review --base-sha/--head-sha` is resolved with a local `git rev-parse --verify
  <x>^{commit}` at write time and stored as the full object name; a value that does not resolve is
  refused, naming it.
- Staleness: a verdict is fresh only when EVERY attributed commit is equal to or an ancestor of
  its `headSha`. A `headSha` on an unrelated branch, an ancestor attributed after an uncovered
  descendant, and a stored value that is not a hexadecimal commit name (a legacy `HEAD`,
  `not-a-commit`) all read **stale** on every surface and refuse a `delivered` archive. A hexadecimal
  value this clone does not hold reads `unverifiable`, as today.
- `--withdraw-commit` matches stored entries by commit identity, not string equality, and can
  still withdraw a legacy value that no longer resolves.
- `integrity`'s `recorded-sha-the-repository-cannot-resolve` check also reports a recorded value
  that is not a commit object name at all (legacy symbolic refs). No migration rewrites stored
  values.
- Absorbs `gate-staleness-reads-only-last-attribution`; supersedes `reconcile-gate-bypasses` and
  `commit-shas-stored-unresolved`.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `gate-integrity`: ADDS the reconcile-obligation requirements (the gate had no requirement in
  any main spec — `tracker-sync` only states the guard cannot be switched off for it), write-time
  commit resolution, identity-matched withdrawal, and reporting of non-commit recorded values;
  MODIFIES "A verdict that does not cover the shipped work is stale" (every-entry ancestry,
  unresolvable values) and "Commit attribution is written by a named flag the emitted instructions
  require" (appends the resolved object name, not the literal string).
- `epic-annotation`: MODIFIES "Supplying a link adds it, and the documented repair stays one write" —
  the clear-and-re-supply repair is refused on an epic owing a reconcile, and the emitted repair
  instruction names `record-reconcile` first there.

## Impact

- Engine: `scripts/lib/reconciler-writeback.mjs`, `detour-stack.mjs`, `epic-progress.mjs`
  (`reconcileArchived`), `active-pointer.mjs`, `update-epic.mjs`, `links.mjs` (`mergeLinks`,
  `epicReferences`), `remove-epic.mjs`, `gate-review-writeback.mjs`, `archive-gate.mjs`
  (`gateStaleness`), `git.mjs`, `integrity.mjs`, `constants.mjs` (flag registry). Still
  zero-dependency and zero-network: every new git call reads the local object database.
- State schema: additive link fields (`reconcileOnResume`, a nested `superseded` verdict) and one
  `0.44.0` MIGRATIONS entry that gives every `may-invalidate` link an explicit `reconcileOnResume`
  (true iff its epic owes a reconcile and the link has no verdict). A 0.43.0 state file loads; before
  `/pm:upgrade` its unstamped links are never armed and never cleared, and a verdict against one is
  refused naming `/pm:upgrade`. Stored sha values are never rewritten.
- Docs (Mintlify page sync belongs to the 0.44.0 release cut, not this change): `agents/reconciler.md`, `commands/resume.md`, `commands/detour.md`,
  `skills/conductor/SKILL.md`, `scripts/lib/rules.mjs` (the emitted `record-reconcile` form and the
  attribution endpoint wording), `README.md`, `CHANGELOG.md`.
- Performance: the every-entry rule is batched (one `git rev-list` per verdict — measured 14 calls
  / ~70 ms over this repository's record, against 139 calls / ~711 ms for a per-commit loop).
