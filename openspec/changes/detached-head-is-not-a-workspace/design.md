# Design

## The probe

One helper in `scripts/lib/git.mjs`, alongside the existing `rev-parse` callers there, returning a
**three-state** answer rather than a boolean:

- `detached` — HEAD is not on a branch
- `attached` — HEAD is on a branch
- `unknown` — git could not answer (no repository, git absent, command failed)

`unknown` is a real third state and not a synonym for `attached`, even though both lead to "write
normally". The distinction is what keeps the reason legible at the call site and stops a future
reader collapsing `catch → false` into an assertion that the tree is a workspace. This project has
the same three-state shape already in its ancestry checks, which report **cannot tell** rather than
guessing stale.

`git symbolic-ref --quiet HEAD` is the probe: it exits non-zero on a detached HEAD and prints the
ref otherwise. Preferred over `rev-parse --abbrev-ref HEAD`, which returns the literal string
`HEAD` when detached — a sentinel that is also a legal ref name, so the comparison would be
ambiguous by construction.

An **unborn HEAD** (a repository with no commits) is `attached`: `symbolic-ref` succeeds and names
the branch that does not exist yet. That is correct — a fresh repository is a workspace, and
`commit-watch.mjs` already has an `UNBORN` path that must keep working.

## Where the two behaviours attach, and why they are different

**Breadcrumbs suppress at their own write sites**, not behind one central gate. They have different
callers and different lifecycles — a hook, a verb, a snapshot — and a single choke point would have
to be reached by all three, which is more coupling than the rule needs. Each site asks the probe
and returns early.

**The warning attaches where the WRITING-A-DIFFERENT-REPOSITORY warning already does**, gated on
the same `verb-effects.mjs` declaration that already answers "is this verb read-only". That is
deliberate reuse: 0.41.0's sibling fix stopped that warning crying wolf on the 17 read-only verbs,
and a second warning built beside it must inherit the same gate or it reintroduces the defect one
release later. **No new list of verb names** — a staleness bug in a safety warning is worse than
the warning being noisy, and `conductor-25` already asserts set-equality between `VERB_EFFECTS` and
the dispatch object.

## What this deliberately does not do

**It does not change `isInitialized()`.** Tracking `state.json` is load-bearing: it is the backup
and `git restore` is the documented undo. The reporter says so explicitly, and they are right. The
gap was never the tracking.

**It does not add `deployment: true` to `state.json`.** An opt-out stored in a tracked file rides
along into every checkout, including the workspaces — it would inherit exactly the problem it was
added to solve. Offered in the issue, and rejected for that reason.

**It does not classify the tree as "a deployment".** Detachment is the whole condition. Matching a
tag exactly would be more precise about deployments and would miss every deploy that checks out a
sha; the cases detachment over-catches — a bisect, reviewing an old release — are cases where
suppressing breadcrumbs is right anyway. A cheap signal with harmless false positives beats a
precise one with silent false negatives, and this defect is already a story about a silent false
negative.

**It does not use `--git-common-dir` versus `--git-dir` to detect a linked worktree.** The issue
warns about this and the warning is worth keeping: in the measured case the DEPLOYED tree is the
main one and development happens in the linked worktree, so the sign is inverted from the obvious
assumption.

## Risks

- **A legitimate detached session loses its breadcrumbs.** Accepted, and named in the spec: during
  a bisect or a review of an old tag there is no epic work to record, and the detour log is about
  interrupting active work.
- **The warning becomes noise** if a user habitually works detached. Mitigated by scoping it to
  mutating verbs, which is where the loss actually happens, and by naming the tag so the message
  carries information rather than repeating a state the user already knows.
- **One more `git` invocation per write.** Negligible against the `execFileSync` calls these paths
  already make, and cached per process rather than probed per call site.
