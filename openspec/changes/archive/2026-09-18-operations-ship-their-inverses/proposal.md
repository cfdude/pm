## Why

The 0.43.0 independent review found a defect class both of this project's gates structurally
cannot see: **an operation shipped without its inverse**, and **a stored reference nobody
validates**. A call-site sweep enumerates the callers of a thing that is written; it never leads to
the question of whether that thing can be *un*-written, so a grant with no revoke and a pause with
no drop both pass Gate 1 and Gate 2 untouched. A diff-scoped review likewise never asks whether the
id a verb just stored names anything.

Three instances, all reproduced against the **0.45.0** engine on 2026-09-17 in a hermetic fixture
repo (`propose-46/operations-ship-their-inverses`, `node scripts/conductor.mjs init`):

**1. Autonomy grants accumulate and nothing takes one back.** `set-autonomy a1 --preauthorize
"rm -rf build/:it is regenerated"` then `--preauthorize "category:filesystem:scratch only"` then
`--level autonomous` stores two grants. `set-autonomy a1 --level off` exits 0 and the record still
reads `grants=2` — so turning autonomy back on silently restores every prior grant. This is the
measured safety-surface instance CLAUDE.md's required task item 1 already cites. Two corrections to
the finding text, which was written against 0.43.0: `--revoke` no longer "exits 0 saying already
reads" — 0.44.0's unknown-flag guard now exits **1** with `unknown flag --revoke for set-autonomy —
it accepts: --level, --preauthorize, --context, --notify, --force`. The *absence* is unchanged: the
help output lists four flags and none of them is an inverse. And `set-autonomy a1 --preauthorize
":no action"` still exits 0 and stores `{"action":"","grantedAt":…,"reason":"no action"}` — a grant
matching nothing, or everything, depending on how a reader implements the match.

**2. A disposition's references are stored unvalidated.** On an epic `s1` holding one open story,
`update-epic s1 --status archived --outcome delivered --carried-to s1 --reason "moved to itself"
--no-deferrals` exits **0**: the handoff obligation that exists to stop work vanishing is satisfied
by a pointer to the epic that just ended. `--deferral ":"` exits 0 and stores
`{"epic":"","section":""}` — an assertion asserting nothing, the exact silence the deferral gate
exists to remove — and `--deferral "ghost-epic:design.md section"` exits 0 storing a reference to an
epic that does not exist. `integrity` reported the ghost after the fact
(`dangling-epic-reference — 1 finding`) and was **silent on both the empty deferral and the
self-carry**. Every sibling that stores an epic id — `--link`, `--parent`, release `--member` /
`--defer`, `push-detour` — validates it.

**3. An epic archived while parked jams the whole detour stack.** `push-detour base --detour dbase`,
`push-detour a --detour dx`, then `update-epic a --status archived --outcome killed --reason
"abandoned while parked" --no-deferrals` exits **0** — no archive path consults the stack.
`pop-detour` then exits 1 (*"it ended while parked… End the frame by removing the epic's pause
deliberately rather than by popping it"* — no verb does that), `remove-epic a` exits 1 (the frame is
an unstrippable reference), and `pop-detour base` exits 1 on LIFO, so **every frame beneath is
stuck**. The only exit is `update-epic a --status paused` followed by `pop-detour`, which leaves an
epic at `status: active` carrying a `killed` disposition — a live epic the record says ended.

## What Changes

- **`set-autonomy` gains `--revoke`, the inverse of `--preauthorize`.** A revocation **records**
  rather than deletes: the grant stays readable carrying its revocation and its required reason,
  matching `--withdraw-gate-review` and `linkOnce`'s `superseded`. A revoked grant is never
  honoured and never restored.
- **`--level autonomous` names what it is re-arming.** `--level off` does **not** clear grants —
  deletion is not the inverse of granting — so the fix binds where the measured harm is: turning
  autonomy back on reports the live grants it restores, and reports nothing about revoked ones.
- **`--preauthorize` refuses an empty action** and an empty category, on the precedent of
  `--declined-deferral`'s both-halves-non-empty guard, which was written for this same failure and
  never reached its siblings.
- **`--carried-to` and `--deferral` validate the epic ids they store**: an unknown id, an empty id
  and a self-reference are refused, writing nothing. `--carried-to` may not name the archiving epic
  itself.
- **A new `drop-detour <pausedEpicId> --reason "<why>"` verb** — the inverse `push-detour` never
  shipped. It removes that epic's frame wherever it sits in the stack (not only the top), ends the
  reconcile obligation the push armed by recording that it was dropped rather than answered, and
  never activates the epic.
- **The archive gate refuses an epic holding a live detour frame**, naming `drop-detour` as the
  remedy. The refusal alone is not sufficient and is not shipped alone — see design.md.
- **The integrity surface grows to see three shapes already written**: a self-referential stored
  epic id, a stored id that is empty (which `dangling-epic-reference` skips today by construction,
  since `""` names no epic), and an autonomy grant naming nothing — the one shape no revoke can
  reach, because a revoke names a stored value and an empty one is not expressible as a flag value.
  The first two cover the SAME declared set of id-holding fields, and that declaration becomes
  value-agnostic so an empty id is enumerable at all.

## Capabilities

### New Capabilities
- `epic-autonomy`: what an epic's autonomy grants mean, how one is revoked, and what re-arming
  autonomy restores. No existing capability owns autonomy — `verb-surface` covers only the flag
  parser's refusal of a typo.

### Modified Capabilities
- `epic-disposition`: the requirements *A deferral is registered or explicitly declined before
  archive* and *Unfinished work at archive records where it went* gain the rule that a reference
  the disposition stores must name a real, other epic.
- `gate-integrity`: three ADDED requirements, **and one MODIFIED**. The MODIFIED one is *A reconcile
  obligation survives until a verdict answers it*: the frame-drop clears `reconcileNeeded`, which
  that requirement permits only `record-reconcile` and the drift heal to do, so the frame-drop is
  named there as a second, reason-bearing exception that disarms rather than removes the link. The
  three ADDED are — the interactive archive verb refuses an epic holding
  a live detour frame; the frame-drop operation and the rule that ending an obligation is not
  answering it; and the two integrity checks above. Each names the existing requirement it extends
  (the five-path enumeration, the read-only integrity surface) rather than restating it, so neither
  surface ends up owned twice.

## Impact

- Engine: `scripts/lib/autonomy.mjs`, `scripts/lib/update-epic.mjs`,
  `scripts/lib/detour-stack.mjs`, `scripts/lib/archive-gate.mjs`, `scripts/lib/links.mjs`,
  `scripts/lib/integrity.mjs`, `scripts/lib/constants.mjs` (`VERB_FLAGS`),
  `scripts/conductor.mjs` (dispatch + `USAGE`), `scripts/lib/verb-effects.mjs`.
- **Emitted instruction text, found by widening the sweep from `preAuthorized` to
  `pre-authoriz|preauthoriz`:** `scripts/lib/rules.mjs:216-217` emits into every managed `CLAUDE.md`
  the very claim this change falsifies ("grants accumulate with no revoke … turning it back on
  silently restores all of them"), and `:759` (`:753` at proposal time; the sibling `the-guard-covers-every-write-path` added six lines at 822686a) is the execution-time decision rule that must skip a
  revoked grant. `agents/hierarchy-child-executor.md:50` is the only actor that acts on
  `preAuthorized` and must skip one too. Emitted-text fixtures under `scripts/test/fixtures/` move
  with `rules.mjs`.
- Surfaces a new verb must reach: `commands/` document, `docs/parity-ledger.json`
  (`detour-lifecycle`), `README.md`, `skills/conductor/SKILL.md`, `CHANGELOG.md`.
- No migration: every field this change adds is additive and read-time-defaulted, and a state file
  written by 0.45.0 loads unchanged.
- Coordination with the sibling 0.46.0 change `the-guard-covers-every-write-path` — see design.md.
