## MODIFIED Requirements

### Requirement: pm emits the converged release-candidate procedure as instructions

pm SHALL carry the procedure in a shipped skill, `release-candidate`, and SHALL point to it from the
managed rules block while at least one release has no delivered marker; with no such release the
block's always-on pointer names the skill instead. pm SHALL NOT create branches, merge, dispatch
reviewers or push. Every step is an instruction to the agent. The procedure SHALL state six steps, in
this order:

1. **Batch by area.** Work items that touch the same component go to ONE sub-agent.
2. **One integration branch.** Each worktree branch merges into one candidate branch, `rc/<releaseId>`,
   cut from `dev` by default. When the release's `--target` is set and names an existing branch, the
   candidate is cut from that branch instead. The cut point is the review's base.
3. **One converged review** of `<base>..<candidate head>`, at the budget the next requirement
   defines, capped at one round.
4. **Route failures back.** A finding goes back to the sub-agent that owns the code. The fix is made
   in that worktree and re-merged into the candidate.
5. **Targeted re-test.** After a fix, re-run only the tests that failed. The full suite runs at the
   candidate gate and in CI.
6. **Push once.** The orchestrator pushes the candidate once. No worktree branch is pushed on its own.

#### Scenario: The rules block points to the procedure

- **WHEN** the managed rules block is written while a release with no delivered marker exists
- **THEN** it carries a "Release candidate" section that names the `release-candidate` skill and
  states the budget rule and the one-round cap

#### Scenario: No undelivered release, no section

- **WHEN** the managed rules block is written for a repo with no release, or with every release marked delivered
- **THEN** it carries no "Release candidate" section
- **AND** its `## Procedures emitted on use` section names the `release-candidate` skill

#### Scenario: The first release adds the section

- **WHEN** no release exists and `release 1.0.0 --intent "x"` runs
- **THEN** the managed block on disk carries the "Release candidate" section

#### Scenario: Delivering the last open release retires it, undelivering restores it

- **WHEN** release R is the only release with no delivered marker and `release R --deliver` runs
- **THEN** the managed block on disk carries no "Release candidate" section
- **AND** after `release R --undeliver` it carries the section again

#### Scenario: The skill is claimed by the parity ledger

- **WHEN** `scripts/test/parity.test.mjs` runs
- **THEN** `skills/release-candidate/SKILL.md` is claimed by exactly one capability in
  `docs/parity-ledger.json`
