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

`git symbolic-ref --quiet HEAD` is the probe, and **the exit status must be discriminated, not
merely tested for non-zero**:

| situation | status | answer |
| --- | --- | --- |
| detached HEAD | **1**, no output | `detached` |
| on a branch | 0, prints the ref | `attached` |
| unborn HEAD (no commits yet) | 0, names the branch-to-be | `attached` |
| not a repository | **128** | `unknown` |
| git absent from PATH | throws | `unknown` |

Only status 1 means detached. A `catch → detached` would make a non-repository suppress writes,
directly contradicting this change's own spec scenario. The remedy already exists in this file:
`isAncestor()` does exactly this discrimination with `e && e.status === 1 ? false : null`. Follow
that line rather than restating the rule in prose. Preferred over `rev-parse --abbrev-ref HEAD`, which returns the literal string
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
deliberate reuse: **0.40.0**'s sibling fix stopped that warning crying wolf on the 17 read-only verbs,
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
warns about this, and the real reason is stronger than the one the issue gives. Measured: the two
trees are **separate clones, not a worktree pair** — `rev-parse --git-dir` and `--git-common-dir`
both return `.git` in each. The probe is not inverted there, it is **blind**: it returns "main tree"
for the deployment and the workspace alike, giving no signal at all.

## Risks

- **EVERY CI RUN IS A DETACHED TREE, and that is the largest population this touches.**
  `actions/checkout@v4` — used by this repository's own workflow — leaves HEAD detached at the sha.
  pm's own suite is unaffected because its helpers point `CLAUDE_PROJECT_DIR` at a temp directory,
  but any OTHER managed repository running a mutating verb in CI gets the warning on every
  invocation and loses its session bookkeeping silently. **Accepted, and stated rather than
  discovered later:** breadcrumbs in an ephemeral CI checkout are worthless by construction — the
  tree is destroyed at the end of the job — so suppression there is right rather than merely
  tolerable, and a warning in CI logs is cheap. This is the reason the change ships no opt-out flag:
  the population that would need one does not want the writes either.
- **A legitimate detached session loses its breadcrumbs.** Accepted, and named in the spec: during
  a bisect or a review of an old tag there is no epic work to record, and the detour log is about
  interrupting active work.
- **The warning becomes noise** if a user habitually works detached. Mitigated by scoping it to
  mutating verbs, which is where the loss actually happens, and by naming the tag so the message
  carries information rather than repeating a state the user already knows.
- **One more `git` invocation per write.** Negligible against the `execFileSync` calls these paths
  already make, and cached per process rather than probed per call site.

## The inverse of each operation added

Required task item 1 obliges this enumeration in the change rather than in a later task.

| operation added | inverse | shipped? |
| --- | --- | --- |
| suppress session bookkeeping when detached | a "write it anyway" override | **NO** |
| warn on a not-read-only verb when detached | a way to silence the warning | **NO** |

**Neither is shipped, and the justification is the same for both: the population that would use an
override does not want the behaviour it overrides.** The detached trees this touches are deploys
(the writes are discarded), CI checkouts (the tree is destroyed), bisects and old-tag reviews (there
is no epic work to record). None of those wants its session bookkeeping preserved, and none is
harmed by one line on standard error.

A gitignored per-checkout opt-out — the shape `session-claim.json` already uses, and which does NOT
inherit the tracked-file problem that sinks `deployment: true` — was considered for the warning and
declined for that reason, not overlooked. If a real case appears where someone works durably on a
detached HEAD and wants the trail, that is the moment to add it, with the case as its evidence.
