# Proposal: converged-release-candidate-review

## Why

pm's review gates take ONE change as their unit, and a release is built as N changes, each carrying
its own Gate 2 rounds, its own worktree commits and its own CI runs. 0.51.0's predecessor showed
what that costs. `certification-record-redesign` took 5 Gate 1 fix rounds and 3 Gate 2 rounds:
~5.8M tokens reviewing against ~2.0M building. Its functional trigger demands a certify on ~70 of
126 commits, and every worktree push runs CI's heavy suites again.

Rob, 2026-09-29: batch the work by area, merge it into one release candidate, review that candidate
ONCE with a capped round, route failures back to the agents that wrote the code, re-test only what
failed, and push once.

## What Changes

- **A converged release-candidate procedure,** emitted by pm as instructions and carried in a new
  shipped skill, `skills/release-candidate/SKILL.md`. It has six steps:
  1. **Batch by area.** Work items that touch the same component go to ONE sub-agent, so that code
     is written once and tested once.
  2. **One integration branch.** Every worktree branch merges into `rc/<releaseId>`, cut from the
     release's target branch.
  3. **One converged review, capped at one round.**
     - The reviewer budget is the effective `review` from `execution-profile-layered-settings`: 1
       reviewer at `standard`, 2 at `thorough`.
     - Only a **Critical** reopens anything. **Important** findings are fixed and re-tested, not
       re-reviewed. **Minor** findings are logged and never re-reviewed.
  4. **Failures go back to sub-agents.** The owning sub-agent fixes the finding in its worktree, and
     the fix is re-merged into the candidate.
  5. **Targeted re-test.** After a fix, re-run only the failed tests. The full suite runs once at the
     candidate gate, and again in CI.
  6. **One push.** The orchestrator commits and pushes the candidate once, so CI does not run heavy
     suites for each worktree commit.
- **One verdict, recorded per member.** The converged review's verdict is recorded as Gate 2 for
  EACH member epic at the SAME `--base-sha` and `--head-sha`, with the existing `record-gate-review`
  verb. It is recorded after the last fix has merged, and each fix commit is attributed to the member
  whose code it fixes. No new write verb is needed: every member's attributed commits are ancestors
  of the candidate head, so the existing staleness rule already checks the recorded verdict.
- **The reviewer budget across members** is the HIGHEST effective `review` among the candidate's
  members, so a `thorough` member is never under-reviewed by the others' `standard`. When every
  member resolves to `off`, the orchestrator's self-review is still recorded as each member's
  Gate 2. It uses `--reviewer "self"`, because an openspec `delivered` archive still requires a
  passing Gate 2.
- **Read-back.** `release show <id>` gains a derived "candidate review" line. It reports whether
  every member's Gate 2 shares one `headSha`, and names each member that is missing a verdict or
  holds a different head. This adds no stored field, so it holds no reference to another record.
- **The rules block** gains a short "Release candidate" section that points to the skill and states
  the budget and cap rules.

## Capabilities

### New Capabilities

- `release-candidate-review`: the converged release-candidate procedure pm emits, how its reviewer
  budget is derived, how one review is recorded as every member's Gate 2, and how the record is read
  back.

### Modified Capabilities

None. The Gate 2 evidence and staleness requirements in `gate-integrity` are used as they stand. A
converged verdict is an ordinary Gate 2 verdict recorded N times.

## Impact

- **Engine.** `scripts/lib/rules.mjs` gets the emitted section. The `release show` read path gets
  the derived line. Neither adds a write verb, and neither changes the state schema.
- **Skill and docs.** A new `skills/release-candidate/SKILL.md`, entered in
  `docs/parity-ledger.json`. Also `commands/review-mode.md`, where the budget applies per candidate,
  and README and Mintlify after Gate 2.
- **Depends on** `execution-profile-layered-settings` for the resolved `review`. Until that ships,
  the budget reads `currentReviewMode(epicId)`, which gives the same value set.
- **Out of scope.** The certify demand of ~70/126 commits and hook friction are separate 0.51.0
  epics. This change removes their per-worktree CI multiplier, not their per-commit cost.
