# Call-site completeness sweep — archive-gate-reads-what-it-writes

Required task item 4.1, derived mechanically at sweep time (after 70f4196 / b9a3826), never typed
from memory. Line numbers are as of b9a3826.

## Derivation

```sh
# callers
rg -n "\b(archiveGate|deliveredObligations|dispositionInvocation)\(" scripts/lib/
# writers of every input the obligations or the check's trigger read
rg -n "\.(status|lane|planPath|specPath|stories|attributedCommits|withdrawnCommits|gateReview|disposition|carriedTo)\s*=[^=]|\.(gate2)\s*=[^=]|delete [a-zA-Z.]*\.(status|lane|planPath|specPath|stories|attributedCommits|withdrawnCommits|gateReview|gate2|disposition|carriedTo)\b|\.(stories|attributedCommits|withdrawnCommits)\.(push|splice)\(|delete [a-zA-Z]+\[row\.key\]" scripts/lib/
rg -n -e 'gateReview\[' -e '\.done\s*=[^=]' -e 'Object\.assign\((e|epic)\b' -e '(epic|e)\[[a-zA-Z.]+\]\s*=[^=]' -e '\.disposition\s*=' -e 'withdrawnCommits' scripts/lib/
rg -n "activate\(" scripts/lib/
```

## Callers

| Call site | What it calls | Holds? |
|---|---|---|
| `update-epic.mjs:700` | `archiveGate(epic, …)` | Yes. The gate now runs after every field write and unset (Half 1), so it decides on the record the call leaves. |
| `archive-gate.mjs:346` | `deliveredObligations(epic, {carriedTo: request.carriedTo})` | Yes. Called only for a requested `delivered`; renders the pre-existing messages byte-for-byte (2.2). |
| `update-epic.mjs:733-734` | `deliveredObligations(snapshot/epic, {carriedTo: stored})` | Yes. The regression check (Half 2). |
| `update-epic.mjs:114` | `dispositionInvocation(id, {echoed, correction, deferrals})` | Yes. The regression refusal's printed invocation. |
| `archive-gate.mjs:211` (`unconsideredOutcomes`) | `dispositionInvocation(id)` | Unchanged output by construction (options default to today's text; checked equal). Still prints a bare `--no-deferrals`; held by `disposition-invocation-prints-bare-no-deferrals`. |
| `integrity.mjs:460` | `dispositionInvocation(id)` | Same as above. |

`subcommands.mjs:614` and `epic-progress.mjs:270` are comment mentions, not calls. No other path
calls `archiveGate()`: the heal, the backfill and the two archived-at-creation paths stamp and are
not gated, by an existing requirement.

## Writers of the obligation and trigger inputs

| Writer | Field | Can it run on an archived epic? | Bound here / justified |
|---|---|---|---|
| `update-epic.mjs:590-591` `--withdraw-commit` | `attributedCommits`, `withdrawnCommits` | Yes | **Bound**: before the gate (Half 1) and the regression check (Half 2). |
| `update-epic.mjs:600` `--status` | `status` | Yes | **Bound**: the trigger reads `snapshot.status` and `isArchived(id)`, so a non-archived `--status` the heal undoes cannot escape; a genuine unarchive is not refused (3.14, 3.15). |
| `update-epic.mjs:604-606` `--lane`/`--plan`/`--spec` | `lane`, `planPath`, `specPath` | Yes | **Bound** (1.1, 1.6, 3.1, 3.7). |
| `update-epic.mjs:642-643` `--attribute-commit` | `attributedCommits` | Yes | **Bound** (1.2, 3.2, 3.3, 3.5a). |
| `update-epic.mjs:654-655`, `:661-662` `--add-story`, `--story --done/--wont-do` | `stories` | Yes | **Bound** (1.3, 1.5, 3.4). A `--done`/`--wont-do` can only meet the handoff, never break it. |
| `update-epic.mjs:679` `--clear <field>` | `planPath`, `specPath` (the nullable rows the obligations read) | Yes | **Bound** (1.6a). |
| `update-epic.mjs:707` | `disposition` | Only with `--status archived` | **Bound**: written after the gate passes. |
| `gate-review-writeback.mjs:135,160` `record-gate-review` | `gateReview.gate2` | Yes (no archived refusal, no lane refusal since #163) | **Justified**: design.md "What this deliberately does not do" — a verdict is evidence; refusing a true `fail` would falsify the record. Held by `archived-delivered-gate2-regression-report`. |
| `epic-progress.mjs:111,120,128-129` `reconcileArchived` (the heal) | `status`, `disposition` (only where absent), `gateReview.gate2` (`ungated`, only where absent) | It is what archives an epic | **Justified**: same section — the heal reflects disk and receives no disposition. Where `update-epic` itself triggers the heal, Half 2's `isArchived(id)` trigger binds that call's writes (3.3, 3.4a, 3.5a). An `ungated` gate2 is written only over an absent one, which already failed the Gate 2 demand, so it cannot regress it. |
| `links.mjs:246,254` `remove-epic` → `epicReferences` drop | `disposition.carriedTo`, `disposition.superseded.carriedTo` | Yes | **Justified**: same section — the pointer would dangle, and refusing would block deleting an unrelated epic. Held by `archived-delivered-gate2-regression-report`. 3.6 pins that the resulting failing handoff does not mask a later Gate 2 regression. |
| `migrations.mjs:154` (0.27.0 `stampArchivedOutcomes`) | `disposition` | Yes, once, on archived epics with no disposition | **Justified**: the record had no `delivered` outcome before the stamp, so there is no met obligation to regress; the stamp is an engine write replaying history, not an update. Out of the check's scope like the other stamping paths. |
| `migrations.mjs:30` (0.3.0) | `lane` (only where absent → `openspec`) | Yes | **Justified**: a lane-less epic is already openspec-lane through `isOpenspecLane`, so no obligation changes. |
| `add-epic.mjs:471-487`, `add-many.mjs:152-161`, `state.mjs:93` | `disposition`, `planPath`, `specPath`, `stories`, `attributedCommits` | Creation only | **Justified**: archived-at-creation is stamped, not gated, by an existing requirement (design.md "Also out of scope"). |
| `active-pointer.mjs:36,39,93` (`activate`, `clear-active`) | `status` | No: `set-active` refuses an archived epic (`:75`); `activate` demotes only `active` epics; `clear-active` only an `active` epic | Not reachable on an archived epic. |
| `detour-stack.mjs:114` `push-detour`, `:199` `pop-detour` (`activate`) | `status` | No: both refuse an archived paused epic, and push refuses an archived detour | Not reachable. |
| `subcommands.mjs:531` `sync` | `status` (`planned` → `untriaged`) | No: `planned` only | Not reachable. |
| Disk-side task edits (a plan file or `tasks.md` unticked) | progress source | Yes | **Justified**: not a verb (design.md, fourth path). |

**Conclusion:** the rule holds at every verb-level writer that can run on an archived epic through
`update-epic`. The writers it does not bind are the four paths design.md "What this deliberately does
not do" names (record-gate-review, the heal, remove-epic's carriedTo strip, disk-side edits), plus
creation/migration stamping and three status writers that refuse or cannot reach an archived epic.

DATA references: none added. The change adds no field holding another record's id (`snapshot` is an
in-memory clone discarded when the call exits).

## Inverse of every operation added (4.2)

- Moving the gate adds no operation, so it has no inverse to ship.
- The regression refusal's exits: (1) the printed invocation, which records a disposition and runs the
  full archive gate on the record it leaves (3.10, 3.10a); (2) a genuine unarchive (`--status <x>` with
  nothing archived on disk), whose re-archive through the verb meets the full gate (3.14), and through
  the heal is the path held by `archived-delivered-gate2-regression-report`.
- Deliberately not shipped: adding a story to an archived `delivered` epic has no in-place route (new
  work is a new epic), and the check is a ratchet with no history (3.10a); both per design.md "The
  inverse of each operation added".
