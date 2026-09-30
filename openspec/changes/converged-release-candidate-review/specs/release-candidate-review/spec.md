## Purpose

Defines the converged release-candidate procedure pm emits. It covers batching a release's work by
area, merging it into one candidate branch, reviewing that candidate once with a capped round,
routing fixes back, re-testing only what failed, and pushing once. It also covers how that single
review is recorded as each member epic's Gate 2 and read back.

## ADDED Requirements

### Requirement: pm emits the converged release-candidate procedure as instructions

pm SHALL carry the procedure in a shipped skill, `release-candidate`, and SHALL point to it from the
managed rules block. pm SHALL NOT create branches, merge, dispatch reviewers or push. Every step is
an instruction to the agent. The procedure SHALL state six steps, in this order:

1. **Batch by area.** Work items that touch the same component go to ONE sub-agent.
2. **One integration branch.** Each worktree branch merges into one candidate branch, `rc/<releaseId>`,
   cut from the release's target branch. The cut point is the review's base.
3. **One converged review** of `<base>..<candidate head>`, at the budget the next requirement
   defines, capped at one round.
4. **Route failures back.** A finding goes back to the sub-agent that owns the code. The fix is made
   in that worktree and re-merged into the candidate.
5. **Targeted re-test.** After a fix, re-run only the tests that failed. The full suite runs at the
   candidate gate and in CI.
6. **Push once.** The orchestrator pushes the candidate once. No worktree branch is pushed on its own.

#### Scenario: The rules block points to the procedure

- **WHEN** the managed rules block is written
- **THEN** it carries a "Release candidate" section that names the `release-candidate` skill and
  states the budget rule and the one-round cap

#### Scenario: The skill is claimed by the parity ledger

- **WHEN** `scripts/test/parity.test.mjs` runs
- **THEN** `skills/release-candidate/SKILL.md` is claimed by exactly one capability in
  `docs/parity-ledger.json`

### Requirement: The reviewer budget is the highest effective review among the members

The converged review's reviewer count SHALL be derived from the effective `review` of each member
epic, as resolved by the execution profile, and SHALL be the HIGHEST of them:

- `thorough` means two independent fresh-context reviewers, with any disagreement adjudicated by the
  orchestrator;
- `standard` means one fresh-context reviewer;
- `off` means the orchestrator's self-review.

A candidate holding one `thorough` member SHALL be reviewed at `thorough`.

#### Scenario: One thorough member raises the whole candidate

- **WHEN** a candidate's members resolve to `standard`, `standard` and `thorough`
- **THEN** the procedure directs two independent reviewers over the candidate

#### Scenario: Every member resolves to off

- **WHEN** every member resolves `review: off`
- **THEN** the procedure directs a self-review, and still directs that its verdict be recorded as
  each member's Gate 2 with `--reviewer "self"`

### Requirement: The review is capped at one round, and only a Critical reopens it

The procedure SHALL classify each finding as Critical, Important or Minor, and SHALL direct:

- **Critical:** routed back, fixed and re-merged. A fresh-context check scoped to the fix's diff
  verifies that finding alone. A failed check routes it back again. No new full review round is run.
- **Important:** routed back, fixed and re-merged, then verified by a targeted re-test. It is not
  re-reviewed.
- **Minor:** logged in the candidate's review file, `docs/reviews/<releaseId>-candidate-review.md`.
  It is never re-reviewed, and it does not block the verdict.

#### Scenario: A Minor finding does not reopen the review

- **WHEN** the converged review returns only Minor findings
- **THEN** the procedure directs logging them in the review file and recording a passing verdict,
  with no further review

#### Scenario: A Critical is re-checked against its fix only

- **WHEN** the review returns a Critical and its fix merges into the candidate
- **THEN** the procedure directs a check scoped to that fix's diff, and not a second full review of
  `<base>..<head>`

### Requirement: One converged verdict is recorded as every member's Gate 2 at the same range

After the last fix has merged into the candidate, the procedure SHALL direct the agent to record the
converged verdict once PER MEMBER epic with the existing verb, using the SAME range for every member:

`record-gate-review <memberId> --gate 2 --verdict pass|fail --base-sha <base> --head-sha <candidate head> --reviewer "<identity>"`

The procedure SHALL also direct that each fix commit is attributed, with
`update-epic <memberId> --attribute-commit <sha>`, to the member whose code it fixes, before the
verdict is recorded. A verdict recorded before a fix lands does not reach the fix commit, and the
existing staleness rule SHALL render it stale. The candidate's merge commits are integration
bookkeeping, and SHALL NOT be attributed to any member.

No new write verb SHALL be added for this. The existing Gate 2 evidence and staleness requirements
apply to each per-member record unchanged.

#### Scenario: Every member records the same head

- **WHEN** a candidate with members `a` and `b` passes review at head `H` over base `B`, and the
  agent follows the procedure
- **THEN** `a` and `b` each carry a passing Gate 2 with `baseSha: B` and `headSha: H`, and each
  renders as a pass because `H` reaches all of its attributed commits

#### Scenario: A verdict recorded before a fix is stale

- **WHEN** member `a`'s verdict is recorded at head `H`, and then a fix commit `F` descending from `H`
  is attributed to `a`
- **THEN** `a`'s Gate 2 renders as stale and a `delivered` archive of `a` is refused naming `F`,
  until the verdict is re-recorded at a head that reaches `F`

### Requirement: The release read-back reports whether its members' Gate 2 converged

`release show <id>` SHALL print a derived "candidate review" line, computed from the members' existing
Gate 2 records with nothing new stored.

- When every member carries a Gate 2 verdict at one shared `headSha`, it reports that the candidate
  review converged at that sha.
- Otherwise it names each member with no Gate 2 verdict, and, where the recorded heads are not all
  equal, lists every distinct `headSha` with the members that hold it.
- A release with no members reports no candidate line.

`release show` SHALL remain read-only.

#### Scenario: Converged members

- **WHEN** release `R`'s members `a` and `b` both carry Gate 2 at `headSha: H`, and the agent runs
  `release show R`
- **THEN** the output reports the candidate review converged at `H`

#### Scenario: A member with a divergent head is named

- **WHEN** `a` carries Gate 2 at `H` and `b` carries Gate 2 at `H2`
- **THEN** the output reports the candidate review as not converged and lists `H` with `a` and `H2`
  with `b`

#### Scenario: A member with no verdict is named

- **WHEN** `a` carries Gate 2 at `H` and `b` carries none
- **THEN** the output names `b` as missing a Gate 2 verdict, and nothing is written
