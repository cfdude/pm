# Design: spend-guard-rules-section-follows-live-limits

## Context

`rules.mjs` emits `spendGuardLines()` when `guardConfigured(loadState())` is true (`rules.mjs:118`,
`:890`). `writeRules()` is called by `set-spend-guard`, `set-spend-tracking`, `set-review-mode`,
`set-profile`, the tracker verbs, `init`/`upgrade` and the rules verb, but not by `update-epic`,
`remove-epic`, `add-many` or `sync`'s archive heal, all of which can change an epic's archived status or
existence. The dispatch wrapper in `conductor.mjs` already loads a pre-invocation snapshot for the
activity log and the spend timeline.

## Goals / Non-Goals

**Goals:** the section is present exactly while a limit is configured, after any verb.

**Non-Goals:** changing the section's text; refreshing on writes that cannot change liveness;
refreshing from a hook (the PreToolUse hook does no guard work — `spend-guard` spec).

## Decisions

- **D1 — Compare liveness before and after, in the dispatch wrapper, not at each writer.**
  Alternative: add `writeRules()` to `update-epic`, `remove-epic`, `add-many`, `sync`. Rejected: it
  repeats the defect class this epic is (a writer added later is missed), and the call-site sweep would
  have to be re-run by every future change. The wrapper already holds a snapshot; the after-image is one
  `loadState()` and `guardConfigured()` is a pure function of it.
- **D1a — Non-hook verbs only.** Hooks share `main()`, and `render()`'s and `commitNudge()`'s
  `reconcileArchived()` self-heal saves state on a hook path (`scripts/lib/state.mjs` `saveState`, the
  `onConflict: "skip"` hook policy). Comparing there would add an after-image read to every PreToolUse
  and could rewrite `CLAUDE.md` from a hook, against the `spend-guard` hot-path requirement ("The guard
  adds no work to a hook path"). So the comparison runs only for a verb not named in `hooks/hooks.json`
  that reached a state write. A liveness change made by a hook's self-heal is picked up by the next
  non-hook write; the comparison there is made against the liveness the on-disk block reflects (the
  section's presence in `rulesBlock()` output), not only against this invocation's before-image.
- **D2 — Refresh only on a change.** `writeRules()` touches `CLAUDE.md`; an unconditional refresh would
  rewrite it on every verb. A changed liveness bit is the only trigger.
- **D3 — A verb that already refreshed is not refreshed twice.** `set-spend-guard` keeps its own refresh;
  the wrapper skips when the verb's own `writeRules()` ran in this invocation (a module-level flag set by
  `writeRules`).
- **D4 — Failure does not fail the verb.** A refresh failure after a successful state write prints a
  warning naming `rules` as the remedy and exits with the verb's own status, matching the spend timeline
  append (`spend-ledger`, "A failing append does not fail the verb").
- **D5 — A refused invocation refreshes nothing.** No state write means no liveness change.

## Risks / Trade-offs

- The wrapper grows a third snapshot consumer. It reuses the one snapshot; the added cost is the
  after-image read only when a snapshot was taken.
- A verb that writes state outside the wrapper (none known) would be missed. R.1's sweep checks.
