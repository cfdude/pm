---
name: release-candidate
description: The converged release-candidate procedure — batch a release's work by area, merge every worktree branch into ONE candidate branch, review that candidate ONCE with a capped round, route findings back to the sub-agent that owns the code, re-test only what failed, and push once. Use when building a release from several changes, when a release's per-change Gate 2 rounds are the cost, or when asked to "review the release candidate", "converge the release", or "push the release once". Triggers: "release candidate", "rc branch", "converged review", "one review for the release", "batch by area".
---

# Release candidate — one converged review, recorded per member

A release is built as N changes, and reviewing each one separately multiplies every cost: N Gate 2
rounds, N sets of worktree commits, N CI runs. This procedure reviews the **candidate** once. It is a
set of instructions to YOU, the interactive agent: pm never creates branches, merges, dispatches
reviewers or pushes.

## The six steps

1. **Batch by area.** Work items that touch the same component go to ONE sub-agent, so that code
   is written once and tested once. Split across agents only where the areas do not overlap.
2. **One integration branch.** Every worktree branch merges into `rc/<releaseId>`, cut from `dev`
   by default. When the release's target (`release show <releaseId>` prints it) names an existing
   branch, cut from that branch instead. **The cut point is the review's base.**
3. **One converged review** of `<base>..<candidate head>`, at the budget below, capped at ONE round.
4. **Route failures back.** A finding goes to the sub-agent that owns the code. The fix is made in
   that agent's worktree and re-merged into the candidate.
5. **Targeted re-test.** After a fix, re-run only the tests that failed. The full suite runs once at
   the candidate gate, and again in CI.
6. **Push once.** The orchestrator pushes the candidate once. No worktree branch is pushed on its
   own, so CI does not run its heavy suites for each worktree commit.

## The reviewer budget: the HIGHEST review among the candidate members

A release's members are the epics that carry the release. The **candidate members** are those that
are NOT archived and have at least one attributed commit in `<base>..<head>`. Archived epics and
epics with no built work in the range are not candidate members: they do not raise the budget and
they are not recorded below.

Read each candidate member's effective review with the engine, never from memory:

```bash
ENGINE="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/conductor.mjs}"
[ -f "$ENGINE" ] || ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1)
node "$ENGINE" profile --epic <memberId>
```

The budget is the HIGHEST `review` among them:

| Highest review | Reviewers |
|---|---|
| `thorough` | two independent fresh-context reviewers; you adjudicate any disagreement |
| `standard` | one fresh-context reviewer |
| `off` | your own self-review — still recorded as a Gate 2 (below), with `--reviewer "self"` |

One `thorough` member makes the whole candidate `thorough`. **When members resolve to different
levels, say so:** name each member with its level (`a: standard`, `b: thorough`) and recommend
splitting the candidate by level so a trivial member is not reviewed at `thorough`. That is a
recommendation only; unless you split the candidate, the maximum stays the budget.

## One round, and only a Critical reopens it

Classify every finding:

- **Critical** — routed back, fixed, re-merged. A fresh-context check **scoped to the fix's diff**
  verifies that finding alone. If it fails, route it back again. Do NOT run a second full review of
  `<base>..<head>`.
- **Important** — routed back, fixed, re-merged, then verified by a targeted re-test. Not re-reviewed.
- **Minor** — logged in `docs/reviews/<releaseId>-candidate-review.md`. Never re-reviewed, and it
  does not block the verdict. If the review returns only Minor findings, log them and record a
  passing verdict.

## Recording: the same range for every candidate member

The verdict is recorded once PER CANDIDATE MEMBER with the existing verb, at the SAME base and head,
**after the last fix has merged**. There is no release-level record and no release-level verb: a
converged verdict is an ordinary Gate 2 verdict recorded N times, so the existing range requirement,
staleness rule, withdrawal and archive gate apply to each member unchanged.

**First, attribute every fix commit** to the member whose code it fixes, as it lands — before any
verdict is recorded:

```bash
node "$ENGINE" update-epic <memberId> --attribute-commit <fixSha>
```

Do NOT attribute the candidate's merge commits: they are integration bookkeeping and are ancestors
of the head anyway. A verdict recorded before a fix does not reach the fix commit, and the engine
renders it **stale** (a `delivered` archive is then refused, naming the fix) until you re-record.

**Then record, for each candidate member**, the identical range:

```bash
node "$ENGINE" record-gate-review <memberId> --gate 2 --verdict pass \
  --base-sha <base> --head-sha <candidate head> --reviewer "<identity>"
```

Use `--verdict fail` for a verdict that failed. Re-recording replaces a verdict; it never needs a
withdrawal first.

**Read it back:**

```bash
node "$ENGINE" release show <releaseId>
```

prints a derived "candidate review" line: converged at one shared head, or each distinct head with
its members, and each member missing a Gate 2 verdict. It stores nothing.

### If a converged verdict has to be taken back

The inverse of recording is the existing withdrawal, applied to EVERY member the verdict was
recorded for — the record is N records, so undoing it is N withdrawals:

```bash
node "$ENGINE" update-epic <memberId> --withdraw-gate-review 2 --withdrawal-reason "<why>"
```

A withdrawn Gate 2 counts as no verdict, so `release show` names that member as missing one.

## Where this sits

- Gate 1 (spec review) is still per change, and the cross-spec review (`/pm:cross-spec-review`)
  still runs against the whole release's specs before `/opsx:apply`. This procedure replaces
  per-change GATE 2 rounds only.
- A member change's own tasks.md Gate 2 task is satisfied by the converged review when the change is
  built inside a candidate.
- Per-commit certify demand and hook friction are separate costs this procedure does not remove: it
  removes the per-worktree CI multiplier and the per-change review rounds.
