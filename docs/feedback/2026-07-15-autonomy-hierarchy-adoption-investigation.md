# Investigation: near-zero adoption of epic-level autonomy and epic-hierarchy orchestration in this repo

**Date:** 2026-07-15
**Epic:** `autonomy-hierarchy-adoption-investigation` (lane: decision)
**Scope:** this repo (`pm`) only — the one dogfooding repo directly inspectable from this
worktree. No access to other dogfooding repos' `.conductor/state.json` histories was available,
so all evidence below is from `pm`'s own git history and current state.

## What the git history actually shows

`set-autonomy` shipped in pm 0.8.0 (`e362b7e`..`905338e`, 2026-07-14). `plan-hierarchy` and the
`hierarchy-child-executor` agent shipped in pm 0.10.0 (`388edd3`..`64160d1`, same day).

Checking every historical commit that touched `.conductor/state.json`, from the feature's ship
date up through the most recent commits before today's dispatch:

- **Epic-hierarchy orchestration (`plan-hierarchy`):** zero epics carried a `parentId`/child
  relationship in any commit before today. The feature shipped, was archived as done
  (`85f3e4e`), and then sat completely unused in this repo's own history for a full day-boundary
  of subsequent commits — until the batch that produced *this* dispatch.
- **Epic-level autonomy (`set-autonomy`):** exactly **one** epic (`remove-epic-verb`) had
  `autonomy.level: "autonomous"` before today (commit `1d87dcc`, 2026-07-14). Every other epic
  touched across ~14 prior commits had `autonomy: null` or was never given a block at all.
- **Detours log:** `.conductor/detours.log` has exactly one entry, a `MINIMAL` detour unrelated
  to autonomy or hierarchy.

Then, in a single commit today (`5655c7a`, "preflight all remaining children, log 3 dogfood
findings mid-run"), 17 of 30 epics were flipped to `autonomy.level: "autonomous"` in one batch —
this is the epic-hierarchy orchestration run that is *currently dispatching this very
investigation task*. In other words: the only real usage of either feature in this repo's
history is the orchestration run this report is a child of. Before today, both features were
shipped-but-dormant for roughly a full day of subsequent development activity.

## Ceremony weight vs. discoverability vs. genuinely-not-needed

**Discoverability is the primary, demonstrable cause.** Concrete evidence:

- `commands/` has a dedicated doc for `hierarchy.md`, `review-mode.md`, `gate-guard.md` — but
  **no `autonomy.md`**. `set-autonomy` is a fully-implemented CLI verb (schema constants,
  `getAutonomy()` default helper, CLAUDE.md rules-block injection, tracker-linked addendum) with
  no corresponding first-class command doc a user would find by browsing `commands/`.
- The SessionStart brief (`brief()` in `scripts/conductor.mjs`) and the hooks directory contain
  **no proactive nudge** toward either feature. `rg -n "autonomy|hierarchy" hooks/` returns
  nothing — nothing in the SessionStart/PreCompact machinery surfaces "this epic could use
  autonomy" or "these siblings could be planned as a hierarchy batch." A user has to already
  know the feature exists and remember to invoke it; nothing in the day-to-day loop (`/pm:next`,
  the brief, gate transitions) ever mentions it.
- `plan-hierarchy` only appears in `scripts/conductor.mjs` itself (implementation + usage
  string) and its own command doc — it is invoked only when a user explicitly decides "this
  looks like a hierarchy problem," which per the git evidence didn't happen once in ~14
  intervening commits of real dogfooding work across several genuine epics (fixes, docs syncs,
  minor features).

**Ceremony weight is a secondary contributor, not the primary one.** The autonomy preflight
(read full source → produce destructive-risk-points/genuine-unknowns batch → get answers →
record `--preauthorize`/`--context` → `--level autonomous`) is real overhead for a feature
whose main payoff (skipping mid-epic check-ins) only pays off on multi-step epics. For the
single `remove-epic-verb` case that *did* use it before today, the epic was non-trivial enough
(destructive delete semantics, cascade flag) to justify the ceremony — consistent with the
theory that ceremony weight matters at the margin but doesn't explain the near-total absence:
most of the 14 intervening commits were exactly the kind of small, single-session, low-epic-count
changes (a CLI verb, a doc sync, a fix) where a user wouldn't reach for autonomy even if it were
zero-ceremony, because there's nothing to autonomously batch through.

**"Genuinely not needed" explains part of the hierarchy gap but not the whole autonomy gap.**
Epic-hierarchy orchestration specifically pays off when a parent epic has multiple independent
children that can be dispatched/batched — and in the 14 pre-today commits, epics were being
worked one at a time, sequentially, with no parent/children structure being registered at all
(confirmed: zero `parentId` usage). That is consistent with "this repo's real epics, so far,
haven't naturally decomposed into parent+children" rather than pure discoverability failure.
Epic-level autonomy is different: many of those 14 commits *did* involve multi-step epics (e.g.
`gate-guard-default-on-reconcile`, `reconciler-structured-writeback` — both non-trivial, both
later got `autonomous` in today's retroactive batch) where autonomy would have plausibly reduced
check-in overhead had the user thought to invoke it. That gap is better explained by
discoverability than by "not needed."

## Verdict

Both features are functioning as designed once invoked — today's batch shows `set-autonomy` and
`plan-hierarchy` correctly reading epic context, recording preflight decisions, and driving a
17-epic hierarchy dispatch (including this very report). The near-zero adoption before today is
**primarily a discoverability failure** (no command doc for `set-autonomy`, no SessionStart/brief
nudge for either feature), with **ceremony weight as a real but secondary drag** on
single-session/small epics, and **"genuinely not needed"** applying narrowly to
epic-hierarchy orchestration specifically (this repo's epic stream hadn't produced
parent/children structures organically) but not to epic-level autonomy, where several qualifying
multi-step epics went by unflagged.

## Recommendation

1. **Add `commands/autonomy.md`** documenting `set-autonomy` on par with `hierarchy.md` /
   `review-mode.md` / `gate-guard.md` — closes the most concrete, cheaply-fixed gap identified
   above.
2. **Add a discoverability nudge to the SessionStart brief or `/pm:next` output**: when the
   epic about to become active looks multi-step (e.g. an OpenSpec epic with >N tasks, or a
   Superpowers epic with a multi-phase plan) and has no `autonomy` block yet, surface a one-line
   hint ("this epic has N tasks — consider `/pm:autonomy <id>` to skip mid-epic check-ins") and,
   separately, when a `queued`/`planned` epic already has ≥2 children of a common parent with no
   completed `plan-hierarchy` run yet, surface a one-line hint pointing at `/pm:hierarchy`.
3. **Do not treat low `plan-hierarchy` adoption alone as a problem to fix** — it's plausible
   (and defensible) that most real epics in a given repo are single-threaded and don't need
   batching; the fix should target discoverability for the epics that *do* qualify, not force
   adoption everywhere.

These are recommendations for follow-up epics (a documentation task for item 1, a small
claude-code-lane feature for item 2), not implemented as part of this investigation — this
epic's scope was read-only analysis.
