# Release membership moves and re-deferrals leave a record — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Epic:** `release-member-moves-silently` (lane `superpowers`, moved from `claude-code` on 2026-09-25 because it needs the two design decisions below). Found by the 0.43.0 code review (A1, A2).

**Goal:** `release r2 --member e1` on an epic that belongs to `r1` must stop erasing `r1`'s record of it silently, and re-running `--defer` with a new reason must stop overwriting the old reason with no history.

**The defect at HEAD (reproduced 2026-09-25):**

```
release r1 --intent a --member e1
release r2 --intent b --member e1     # stderr: nothing
release show r1                       # members (0), deferred (0), no amendments
release r1 --defer e2:"depends on X landing"
release r1 --defer e2:"cut for scope" # "depends on X landing" is gone from state.json
```

The `--unmember` guard's own comment (`releases.mjs`, "without it `--unmember` on an epic that belongs to a DIFFERENT release deletes that release's pointer while reporting success against this one") names exactly this harm, and `--member` has always done it.

**Architecture:** No new store and no new field on `deferred[]`. The release's existing `amendments[]` trail (gh#178), which is append-only and which `release show` already renders, becomes the one history for every change to a release's recorded judgments. Two new entry shapes are written into it:

| Entry | Written by | Shape |
|---|---|---|
| move-out | `release <new> --member <e>` where `e.release` is another release | on the OLD release: `{op:"unmember", epic, via:"member", to:"<new>", at}` |
| re-defer | `release <r> --defer <e>:<new reason>` where `e` is already deferred from `r` with a DIFFERENT reason | on `r`: `{op:"redefer", epic, reason:"<new>", was:"<old>", wasRecordedAt:"<old recordedAt>", at}` |

**Tech stack:** Node 22+ built-ins only. The tests use the unit rung (`memoryEngine`), because every observable is a value: the record, or text the verb printed.

## Decision (a): a cross-release `--member` is RECORDED, not refused

**Chosen:** perform the move. Append a move-out entry to the old release, and say so on stderr, naming both releases.

**Rejected:** refusing a cross-release `--member` unless an explicit `--unmember` from the old release (or a new `--move` flag) comes first.

Why:
1. **The move is a documented contract.** `commands/status.md` says "Re-associating an epic MOVES it." Refusing would break scripts and agent habits that rely on it, and the documented behaviour was never the defect. The *silence* was.
2. **The precedent is on disk, in the same loop.** `--member` already performs an implicit undefer. It announces the undefer on stderr and appends `{op:"undefer", via:"member", was}` with no invented reason. A move-out is the same class (an implicit removal performed by `--member`), so it gets the same treatment. A refusal here and a recording there would be two rules for one class.
3. **Why no reason is demanded when `--unmember` demands one:** `--unmember` is a bare removal. Without its reason, nothing records what the removal was for. A move is itself the decision, and `to` records where the epic went. That is the explanation a reason would carry, and `release show r1` renders it as "moved to `r2`". `--member` accepts no reason, and a fabricated one is worse than an absent one, the same rule the implicit-undefer comment states.
4. `release show r1` is the reader that failed. After this change it shows the amendment, so the reader's question "where did e1 go?" has an answer in `state.json` alone.

**Edge cases the plan covers:**
- **Re-membering into the SAME release** writes nothing and takes `reportSave`'s unchanged path. The loop already compared nothing; this plan does not start writing a same-release amendment.
- **`epic.release` names a release that no longer exists** (a hand-edited or legacy record). `findRelease` returns null, and `amend(null, …)` would throw. So there is no amendment, only a stderr line saying the stale pointer was replaced.
- **One `--member` both undefers on the new release and moves off the old one.** That produces two amendments on two different releases, and both are tested.

## Decision (b): the reason history is the amendments trail, not a nested `history[]`

**Chosen:** a changed `--defer` reason appends `{op:"redefer", reason:<new>, was:<old>, wasRecordedAt}` to `amendments[]`. The `deferred[]` entry keeps its `{epic, reason, recordedAt}` shape and holds the CURRENT reason.

**An identical re-run** (same reason) is a no-op. The existing record, including its `recordedAt`, stays untouched and no amendment is written. At HEAD it rewrote `recordedAt`. Nothing depends on that: `rg -n recordedAt scripts/test | rg -i defer` finds only fixtures that write the field, never an assertion that it refreshes.

**Rejected:** `deferred[i].history[]`. Why:
1. It would be a second history mechanism beside `amendments[]`, which is already "the audit trail the two INVERSES write". Two trails for one release means two places a reader must look, and `release show` would need two renderers.
2. `links.mjs` already sweeps `amendments[]` by its `epic` field when an epic is removed. A nested array would be a new data reference that the sweep does not reach: exactly the dangling-reference class required item 1 names.
3. `deferred[]` entries are built by `releaseDeferral()` and read by `render.mjs`, `integrity.mjs` and `constants.mjs` (`releaseSummaries`). Leaving their shape unchanged touches none of those readers.

**`--unmember` / `--undefer` need no new shape.** Each already appends its own amendment carrying its reason, and neither can repeat without an intervening write that is itself recorded:
- `--unmember` of a non-member is refused (the guard `if (epic.release !== id)`).
- `--undefer` of a non-deferred epic is refused (the guard `if (!rel.deferred.some(…))`).

So a second `--unmember` of the same epic is only possible after a `--member`, and the trail reads unmember → (member) → unmember. `--member` into a release records nothing on THAT release, by the one-way membership rule. The membership is readable from `epic.release`, and the trail holds only the removals, each with its reason. The same holds for defer → undefer → defer → undefer.

## Backward compatibility and MIGRATIONS

**No `MIGRATIONS` entry.** A `state.json` written by 0.49.0 holds either no `amendments` or entries of the two existing shapes. Nothing already stored needs transforming. The history this change starts keeping was never written, so no transform could recover it.

Checked, not assumed: `rg -n '"undefer"|"unmember"|\.op\b|amendments' scripts/lib` finds no reader that restricts `op` values or amendment keys. The readers are the `release show` renderer, which prints `a.op` as-is, and `links.mjs`, which reads only `a.epic`. `integrity.mjs`, `state.mjs` and `migrations.mjs` do not read `amendments` at all. Task 3 adds a test that a 0.49.0-shaped record loads, renders and accepts the new writes.

## Global constraints

- Engine: zero runtime dependencies. `pm` is an instruction layer.
- The tests go in a NEW unit-rung file, `scripts/test/unit/release-membership-history.test.mjs`. It is not a twin of any functional id, so the drift script's twin-coupling check does not touch it. `verb-surface-answers-back.test.mjs` is a certified twin and is NOT edited.
- **Known blocker:** the drift script's `engine-source` bucket covers every `scripts/lib/*.mjs`. A staged edit to `releases.mjs` is refused until `node scripts/test/certify.mjs sweeps` records it, and this worktree's brief forbids running certify. Probe on 2026-09-25: one appended comment line was refused with `the certified change-triggered bucket 'engine-source' changed (scripts/lib/releases.mjs)`. The implementation is written and verified by running the assertion half directly. The commit is attempted, and if the drift script refuses it, the work stops there and the refusal is reported.

## Tasks

### Task 1: move-out amendment on the old release (decision a)

**Files:** modify `scripts/lib/releases.mjs` (the member loop and the `release show` renderer). Create `scripts/test/unit/release-membership-history.test.mjs`.

- [ ] RED: tests.
  - `release r2 --member e1` (e1 in r1) leaves `r1.amendments` = `[{op:"unmember", epic:"e1", via:"member", to:"r2"}]`.
  - stderr names both `r1` and `r2`.
  - `release show r1` renders `moved to \`r2\`` and not "no reason given".
  - Re-membering into the same release leaves the state bytes unchanged.
  - A stale pointer to a missing release is replaced with a stderr line and nothing throws.
  - Undefer on r2 plus move-out on r1 in one invocation produces two amendments on two releases.

  Save the failing run as `red-task1.txt`.
- [ ] GREEN: in the member loop, before `knownEpic(epicId).release = id`, read `prev = epic.release`. If `prev` is set and `prev !== id`: `old = findRelease(state, prev)`. If `old` exists, `amend(old, {op:"unmember", epic, via:"member", to:id})`. In both cases, write a stderr line. In `releaseShow`, render `a.to` as `moved to \`<to>\`` in the reason slot.
- [ ] Mutation proof: in a scratch copy, delete the `amend(old, …)` call. The amendment test must fail.
- [ ] Commit `fix(release): --member records the move on the release it leaves`.

### Task 2: re-defer history (decision b)

**Files:** modify `scripts/lib/releases.mjs` (the `--defer` write). Add tests to the same unit file.

- [ ] RED: tests.
  - `--defer e2:"depends on X landing"` then `--defer e2:"cut for scope"` gives `deferred[0].reason === "cut for scope"`, and the amendment `{op:"redefer", epic:"e2", reason:"cut for scope", was:"depends on X landing", wasRecordedAt:<first recordedAt>}`.
  - `release show` renders both reasons.
  - Stderr names the replaced reason.
  - Re-running with the IDENTICAL reason leaves the state bytes unchanged.

  Save the failing run as `red-task2.txt`.
- [ ] GREEN: in the `--defer` write, when an existing entry is found: if its reason equals the new one, leave the record alone. Otherwise, amend with `redefer`, write the stderr line, and replace the entry.
- [ ] Mutation proofs:
  - Drop the `amend` call. The history test must fail.
  - Drop the identical-reason short-circuit. The no-op test must fail.
- [ ] Commit `fix(release): re-deferring keeps the reason it replaces`.

### Task 3: backward-compatibility test, docs and changeset

**Files:**
- `scripts/test/unit/release-membership-history.test.mjs`: a 0.49.0-shaped record (a release with no `amendments`, and one with an old-shape `unmember` entry) loads, `release show` renders it, and a move-out and a redefer append to it.
- `commands/status.md`: the "Re-associating an epic MOVES it." line and the "Re-deferring the same epic updates its reason." line.
- `README.md`: the release section's `--defer` paragraph and the inverses paragraph.
- `.changesets/release-member-moves-silently.md`: user-facing prose.

- [ ] Commit `docs(release): a move and a re-defer are recorded`.

## Required item 1: the call-site completeness sweep

Derived with `rg -n "\.release\s*=[^=]|delete [a-zA-Z_.()]*\.release\b" scripts/lib scripts/conductor.mjs`.

**Writers of `epic.release`** are exactly three, all in `scripts/lib/releases.mjs`:

| Site | What it does | Recorded before | Recorded after |
|---|---|---|---|
| member loop | sets the pointer | undefer only | undefer, plus move-out on the old release (Task 1) |
| `--defer` | deletes the pointer only if it is THIS release's | the deferral record | unchanged, see below |
| `--unmember` | deletes the pointer | the unmember amendment | unchanged |

`remove-epic` removes the whole epic, and `links.mjs` sweeps its amendments.

**Omission, justified.** `--defer` clearing this release's own membership gets no extra amendment. The deferral record it writes names the same epic on the same release, with a required reason, so `release show` of that release still accounts for the epic.

**Writers of `deferred[i].reason`** are one: the `--defer` write, which Task 2 covers. `--member` and `--undefer` remove entries and already record `was`.

**Data references added:**
- `to` holds a release id. It is written by the member loop and read by `release show`. No verb removes or renames a release (`rg -n "remove-release|removeRelease" scripts/lib` finds nothing), so it cannot dangle through the verb surface.
- `epic`, on the new entries, is swept by `links.mjs` on `remove-epic`, the same way every amendment is.

**Inverses:**
- A move is undone by another move, which is itself recorded.
- A redefer is undone by `--undefer`, which records `was`, or by another `--defer`, which records a redefer.

The amendments trail is append-only by design and has no inverse, deliberately. Removing entries from it would be the silent erasure this epic exists to end.

## Required item 7: what to route

- **Tooling friction:** the `engine-source` certification bucket covers every `scripts/lib/*.mjs`, and parallel worktrees share one entry per trigger. It is already filed as cfdude/pm#226, so nothing new was filed. The workaround was the coordinator's lock around certify plus commit. Waiting for that lock took about 40 minutes across three attempts while agents passed it around.
- **Sweep catch:** the output-interpolation sweep flagged an unescaped `a.to` in `release show`. The unit rung could not have seen this, because the value reaches output through a const outside the sink. It was fixed by escaping where the value is built, and is recorded here so the next `release show` field follows the same rule. It is not a new lesson: the sweep worked as designed.
- **Practice or process:** none new.
