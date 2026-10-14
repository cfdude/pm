---
lesson: a-spec-edit-stales-a-recorded-gate-1-until-the-record-is-committed
date: 2026-10-13
trigger: You are about to dispatch a worktree build agent, or to commit, right after editing a spec or artifact of a change whose Gate 1 is already recorded, and the re-recorded verdict is still only in your working tree.
cost: In the 0.52.0 candidate, 79d2ffa9 (17:20 -0700) edited `token-spend-tracking-per-epic`'s `spend-ledger` spec, which that epic's recorded Gate 1 hashes. The re-recorded Gate 1 was not committed until 6e754d8b (18:08), so for 48 minutes the committed tree carried a stale Gate 1 and a worktree agent started at e5101f4d (17:26) from it. Its staged work was uncommittable because the functional certify (live-record test 9.14) failed on a record only the orchestrator held, uncommitted. One agent was blocked for hours (duration as reported by the orchestrator).
rule: Editing any artifact a recorded Gate 1 hashes obliges you to re-record that Gate 1 and COMMIT .conductor/state.json in the same step. Before dispatching a worktree agent, commit conductor records. A worktree starts from committed state, never from your working tree.
enforced_in: skills/release-candidate/SKILL.md (commit conductor records before dispatching worktree agents); scripts/lib/integrity.mjs check `gate-1-verdict-stale` names the epic. The `detect:` matcher is omitted on purpose, since the situation (an edit to a hashed artifact) is not recognisable from a tool call.
tags: [gates, worktrees, records, subagents]
---

**Cause.** `.conductor/state.json` is tracked, so a worktree branched from HEAD sees the last COMMITTED
verdicts. A sibling change's spec edit moves the digests a recorded Gate 1 holds, `gate-1-verdict-stale`
reads it, and the live-record functional tests fail inside that worktree, where the re-record does not
exist. See [[git-rewinds-restore-tracked-conductor-state]] for the same tracked-file mechanism the other
way round.

**Order.** Edit the spec, validate it, re-record Gate 1, commit spec and state together, then dispatch.
