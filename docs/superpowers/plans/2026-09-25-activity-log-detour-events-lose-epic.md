# activity-log-detour-events-lose-epic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The activity log names the epic on every detour event, tells a detour DROP from a POP, counts
interruptions correctly, and gives the four verbs that today log only as a bare `state-write`
(record-reconcile, set-autonomy, a priority change, set-review-mode) named, epic-scoped events.

**Architecture:** Everything stays derived by `diffEvents(before, after, meta)` in
`scripts/lib/activity-log.mjs` — the one chokepoint. Detour events are derived by SET DIFFERENCE of
frames (identity = `pausedEpic` + `pausedAt`), not by stack depth. The reader
(`scripts/lib/activity-report.mjs`) grows a drop count, a push-only `byEpic`, reconcile verdicts in the
GATES sequence, and a SETTINGS section.

**Tech Stack:** Node 22+ built-ins only (engine is zero-runtime-dependency); `node:test`.

**Spec:** the epic record (`jq '.epics[]|select(.id=="activity-log-detour-events-lose-epic")' .conductor/state.json`)
— description (code review 0.43.0, C2) and the 2026-09-18 note (the drop-as-pop third instance).

**Lane:** recorded `claude-code`; executed as `superpowers` because the fix spans three files and three
defect instances (orchestrator's instruction). The lane note is the orchestrator's to write.

## Global Constraints

- The engine uses Node built-ins only; no npm package.
- The log records a transition only when a named question needs it; each new kind below names its question
  and its reader consumer (activity-log.mjs header contract).
- A unit-rung test observes VALUES through `memoryEngine`; a test that reads a directory with
  `readEvents({ dir })` is file-rung (`scripts/test/assert/`).
- Do not touch `scripts/test/fixtures/helpers.mjs` (owned by another agent).
- One conventional commit per task; RED saved as `red-<task>.txt` in
  `/private/tmp/claude-501/-Users-robsherman-Documents-Repos-pm/6e8d4b47-4277-41f4-9b04-fc3cd23d9e92/scratchpad/wt-50/activity-log-detour-events-lose-epic/`.

## The defects, verified at HEAD 12fa65f (2026-09-25)

1. `frameEpic` reads `f.epic || f.epicId || f.id`. `push-detour` writes
   `{ pausedEpic, pausedAt, reason, spawnedDetour, reconcileOnResume }` and has since the initial commit
   (`git log -S pausedEpic` → dbd7581); no migration ever wrote another shape. So every detour event
   carries `epic: null`, `DETOURS byEpic` is always empty, and `activity --epic <id>` drops detours. The
   unit test passes only because it hand-builds a frame `{ epic: "e1" }` that no verb writes.
2. `byEpic` increments on push AND pop. Invisible while `epic` was null; the moment the key is fixed an
   epic interrupted once reports `— 2`. Fixed in the same task as (1) so no commit ships the double count.
3. `drop-detour` shrinks the stack, so the depth comparison logs it as `detour-pop`, and takes the epic
   from `topOf(before)` — the wrong frame for a buried drop.
4. record-reconcile, set-autonomy, a priority change and set-review-mode produce no named event: each logs
   as a bare `state-write` with no `epic`, so `activity --epic` cannot show them.

## Decision: how a pop is told from a drop

Structurally they are NOT always distinguishable. `set-active` does not refuse an epic that is on the
stack (`active-pointer.mjs` setActive refuses only unknown/archived), so after `set-active e1` on a
paused `e1`, a `pop-detour e1` and a `drop-detour e1` (pushed `--no-reconcile`) produce byte-identical
stack, pointer and status transitions. The discriminator is therefore the verb, which `diffEvents`
already receives in `meta.verb`: `drop-detour` → `detour-drop`, `pop-detour` → `detour-pop`. A frame
removed by ANY other verb gets `detour-removed` rather than being guessed into either — the header's
"a verb added later cannot be forgotten" still holds, because the removal is still recorded by the diff,
just under an honest name. Today `rg "detourStack\s*=|detourStack\.(push|pop|splice)" scripts/lib`
finds only push-detour, pop-detour and drop-detour as stack writers.

## Review Focus

1. A BURIED drop (e1 under e2) — the event must name e1, not the top frame e2.
2. An epic paused twice (push, pop, push again) — `byEpic` must read 2, not 4.
3. A frame with no `pausedEpic` (a hand-edited or malformed stack) — event carries `epic: null`, no throw.
4. `activity --epic <detourId>` — the detour epic is on the event as `detour`, so the filter matches it too.
5. A re-recorded reconcile verdict (a correction) — logged as a second `reconcile-recorded` with
   `correction: true`, not silently merged.

---

### Task 1: Detour frames by identity, epic from `pausedEpic`, byEpic counts pushes only

**Files:**
- Modify: `scripts/lib/activity-log.mjs` (`frameEpic`, `topOf`, the depth block in `diffEvents`)
- Modify: `scripts/lib/activity-report.mjs` (`readEvents` epic filter; `buildReport` detours block)
- Test: `scripts/test/unit/conductor-33.test.mjs` (replace the fake-frame test at the "the diff, as a
  pure function" section); `scripts/test/assert/conductor-33.test.mjs` (the `--epic` filter, file rung)

**Interfaces — Produces:** event `{kind: "detour-push"|"detour-pop", epic: <pausedEpic|null>,
detour: <spawnedDetour|null>, depth: <after depth>}`; `buildReport(...).detours = {push, pop, drop, removed, byEpic}`
where `byEpic[id]` = number of pushes pausing `id`.

- [ ] Step 1: in the unit file, replace `"gh-111: diffEvents reports detour push/pop and a gate verdict"`
  with a test driven by REAL verbs through `loggingRepo()`: add `d1`, `update-epic e1 --status active`,
  `push-detour e1 --detour d1 --reason r --no-reconcile`, `pop-detour e1`, `push-detour e1 --detour d1
  --reason again --no-reconcile`. Assert the push/pop events carry `epic: "e1"`, `detour: "d1"`, and
  `buildReport(allEvents(engine)).detours.byEpic` deep-equals `{ e1: 2 }` (exact — a double count reads 4).
  Keep the gate-verdict and quiet-write halves of the old test as their own test, unchanged. Add a pure
  `diffEvents` case: a frame with no `pausedEpic` yields `epic: null` without throwing.
- [ ] Step 2: file rung: write two segments' worth of events to a temp dir, including a `detour-push`
  with `epic: "e1", detour: "d1"`; `readEvents({ dir, epic: "d1" })` returns it.
- [ ] Step 3: run both files; save RED to `red-task1.txt`.
- [ ] Step 4: implement. Frame key `JSON.stringify([f.pausedEpic, f.pausedAt])`; `framesOf(state)`
  returns the array; added = after frames whose key is not in before; removed = the reverse. One event per
  added (`detour-push`) and per removed frame (kind from Task 2; in this task, `detour-pop`). `frameEpic`
  reads `pausedEpic` only. `readEvents`: `if (epic && e.epic !== epic && e.detour !== epic) continue;`.
  `buildReport`: `byEpic` increments on push only.
- [ ] Step 5: suite green; mutation proofs (restore `f.epic||f.epicId||f.id` → epic assertion fails;
  count pops into byEpic → `{e1: 2}` assertion fails; drop the `e.detour` clause → file-rung test fails).
- [ ] Step 6: commit `fix(activity): detour events name the paused epic and count interruptions once`.

### Task 2: `detour-drop` — a drop is not a pop

**Files:** `scripts/lib/activity-log.mjs` (kind by verb; header vocabulary); `scripts/lib/activity-report.mjs`
(drop/removed counters, DETOURS line, header table); `commands/activity.md` (DETOURS row);
`scripts/test/unit/conductor-33.test.mjs`.

- [ ] Step 1: unit test with three epics: activate e1, push e1→e2, push e2→e3, `drop-detour e1 --reason gone`.
  The drop's events: exactly one detour event, `kind: "detour-drop"`, `epic: "e1"`, `detour: "e2"`; no
  `detour-pop`. `buildReport(...).detours` has `drop: 1, pop: 0`, `byEpic` unchanged by the drop.
  `formatReport` prints `1 drop(s)`. Pure case: a frame removed under `verb: "something-else"` is
  `detour-removed`.
- [ ] Step 2: RED → `red-task2.txt`.
- [ ] Step 3: implement `removedKind(verb)`; reader counts `detour-drop` → `drop`, `detour-removed` →
  `removed`; format `N push(es), N pop(s), N drop(s)` plus `N removed by another verb` only when non-zero.
  Header vocabulary rows in both files; commands/activity.md DETOURS row says pushes, and pops vs drops.
- [ ] Step 4: green; mutation proof: map every removal to `detour-pop` → the drop test fails.
- [ ] Step 5: commit `fix(activity): a detour drop is logged as detour-drop, not detour-pop`.

### Task 3: Named events for record-reconcile, set-autonomy, priority, set-review-mode

Each is DERIVED from the diff, like every other kind. Writers read from disk:
`reconciler-writeback.mjs` sets `link.reconciled = {verdict, amendments, reconciledAt}` on a
`may-invalidate` link (a correction moves the old one to `link.superseded`); `autonomy.mjs` assigns
`epic.autonomy = {level, preAuthorized[], context[], notifications[]}`; `update-epic.mjs` sets
`epic.priority` and `epic.reviewMode`; `review-mode.mjs` sets `state.reviewMode`.

| kind | fields | question it answers | reader |
|---|---|---|---|
| `reconcile-recorded` | epic, detour, verdict, correction | when was a reconcile verdict recorded, relative to gates | GATES sequence |
| `epic-priority` | epic, from, to | what was re-prioritised, when | SETTINGS |
| `epic-autonomy` | epic, from, to (level), granted, revoked, notified (counts) | what trust was granted or taken back, and what was decided in the user's absence | SETTINGS |
| `review-mode` | epic (null for repo-wide), from, to | when did review intensity change | SETTINGS |

- [ ] Step 1: unit test via real verbs on `loggingRepo()` (+ a detour pushed `--reconcile` then popped
  for record-reconcile): each verb's newest event has the kind and fields above; `buildReport` lists the
  reconcile in `gates` and the other three in `settings`; `formatReport` prints a SETTINGS section. A
  re-recorded reconcile yields `correction: true`.
- [ ] Step 2: RED → `red-task3.txt`.
- [ ] Step 3: implement in `diffEvents` (per-epic loop; state-level reviewMode after it) and the reader.
- [ ] Step 4: green; mutation proof per kind (delete its emit → its assertion fails).
- [ ] Step 5: commit `feat(activity): name reconcile, autonomy, priority and review-mode transitions`.

### Task 4: changeset fragment and this plan's closing notes

- [ ] `.changesets/activity-log-detour-events-lose-epic.md`, user-facing bullets in CHANGELOG format.
- [ ] Fill in "Required item 1" and "Required item 7" below with what execution found.
- [ ] Commit `docs(activity): changeset and closing notes for activity-log-detour-events-lose-epic`.

## Required item 1 — call-site and data-reference sweep

(Completed after execution — see below.)

## Required item 7 — what the work taught

(Completed after execution — see below.)
