# Design: converged-release-candidate-review

## Context

See proposal.md, "Why". The relevant shipped mechanics are:

- **`record-gate-review <id> --gate 2 --verdict pass --base-sha <a> --head-sha <b> [--reviewer …]`.**
  It records per epic. A pass without the range is refused.
- **The staleness rule** (`gate-integrity`, "A verdict that does not cover the shipped work is
  stale"). A Gate 2 is stale unless `headSha` reaches EVERY commit in the epic's attribution array.
  "Reaches" means equal to it or an ancestor.
- **Releases** (`scripts/lib/releases.mjs`). `release <id>` holds intent, target and deferrals.
  Members are DERIVED from epics that carry the release. `release show` is the read-back, and already
  prints the cross-spec verdict.
- **The effective review.** From `execution-profile-layered-settings`, `resolveProfile(state,
  {epicId}).review.value`. Until that change lands, `currentReviewMode(epicId)` returns the same value
  set, and the procedure names whichever the installed engine carries.

## Goals / Non-Goals

**Goals:**

- One review pass per release candidate, whose verdict is checkable per member through the records
  that already exist.
- No new write verb and no schema change.

**Non-Goals:**

- The engine creating branches, merging, dispatching or pushing. pm is an instruction layer.
- Reducing per-commit certify demand. That belongs to the hook-friction epics in 0.51.0.
- Replacing per-change Gate 1. Specs are still reviewed per change, and against each other by the
  cross-spec gate.
- A release-level stored verdict object. See D2.

## Decisions

### D1. The procedure lives in a shipped skill, and the rules block points to it

This repo measured 14/14 adoption for a rule carried by a required task or skill, against 3/15 for a
prose bullet. So the full procedure goes in `skills/release-candidate/SKILL.md`, and the rules block
gets a short section that:

- names the skill;
- states the two rules an agent must not get wrong without reading it: budget = the highest member
  review, and one round where only a Critical reopens;
- states the recording rule: the same range for every member, recorded after the last fix.

A member change's own tasks.md Gate 2 task says it is satisfied by the converged review when built
inside a candidate. Both changes in 0.51.0 already say so.

### D2. Record through the existing verb N times, rather than a new release-level verb

The converged verdict is recorded as N ordinary Gate 2 records sharing `baseSha` and `headSha`.

The alternatives were considered and rejected:

- **(a) `record-gate-review --release <id>`, storing the release id on the verdict.** That field
  references another record, so it opens the data-reference obligation: what happens on
  `release --unmember`, `--defer` and `remove-epic`. It only buys a label that the derived read-back
  in D3 provides without storing anything.
- **(b) `record-release-review <releaseId>`, fanning out to members.** A second write path to
  `gateReview.gate2` would duplicate the pass-requires-range refusal and the withdrawal semantics.
  It would also make a member's Gate 2 depend on membership at record time.

With N records, the existing refusal, staleness, withdrawal (`--withdraw-gate-review 2`) and archive
gate all apply unchanged. The cost is N commands, and the skill gives the loop.

### D3. Convergence is derived at read time in `release show`

`release show <id>` groups the members' `gateReview.gate2.headSha`:

- one distinct value, with every member holding a verdict, reads "converged at `<sha>`";
- otherwise it lists each distinct head with its members, and each member with no verdict.

This is derived output only, so nothing is stored and there is no reference to sweep. Staleness per
member is already rendered by PROJECT.md and the brief, and is not repeated here.

### D4. Budget is the maximum across members

The effective `review` can differ per member once the execution profile lands. The budget must not
under-review a member that asked for `thorough`. It also must not run a separate pass for each
member, because that would re-create the per-change rounds this change removes. So the budget is the
highest. `off` everywhere still records a self-review verdict, because an openspec `delivered`
archive requires a passing Gate 2.

### D5. Attribution order

Fix commits are attributed to the owning member AS THEY LAND. The verdict is recorded after the last
fix merges, at the candidate head after that merge. Merge commits into `rc/<releaseId>` are not
attributed, because they are integration bookkeeping. They are ancestors of the head anyway, so
leaving them unattributed hides nothing. The archive move stays excluded, as today.

## Risks / Trade-offs

- **[Risk] One Critical found late forces a fix while every other member waits.** → This is
  accepted. The alternative is N separate review rounds, which is the cost measured.
- **[Risk] A capped round misses a defect a second round would catch.** → Criticals still reopen,
  and CI plus the full suite at the candidate gate remain. The measured trade was 5.8M review tokens
  against 2.0M build.
- **[Risk] A reviewer at the max budget spends `thorough` effort on a trivial member.** → This is
  accepted. Batching by area keeps trivial and critical members apart when that matters, and a
  release can be split into two candidates.
- **[Trade-off] N identical records instead of one.** → Every existing gate mechanism applies as it
  is, and D3 makes the sameness visible.

## Migration Plan

None. There is no schema change. The rules block refreshes on `/pm:upgrade`.
