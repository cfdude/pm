## Why

pm's dormancy guard is `fs.existsSync(STATE_PATH)` — `scripts/lib/state.mjs`, `isInitialized()`.
And `.conductor/state.json` is **git-tracked by design**: it is the backup, and `git restore
.conductor/state.json` is the documented undo. So in any repository that deploys by checking
*itself* out, the deployed copy carries `state.json` too, and pm reads that checkout as a
workspace it manages.

One file is answering two different questions — *"is this repository pm-managed?"* and *"is this
tree a place to work?"* — and in a self-deploying repository those answers diverge.

**Re-measured in that tree on 2026-09-11, and it is worse than the issue reported.**
`~/Servers/market-intelligence` deploys via `git checkout --detach --force <tag>` and sits detached
at exactly `v2.11.0`. Development happens in `~/Servers/market-intelligence-dev`, on branch `dev`
— a **separate clone, not a linked worktree**: `rev-parse --git-dir` and `--git-common-dir` both
return `.git` in each, so a worktree probe is blind there rather than inverted.

`git status` in the deployed tree is **not** clean. Four TRACKED files are modified:

```
 M .conductor/render-stamp.json     renderedAt 2026-09-11T05:37:07Z
 M .conductor/state.json            pmVersion 0.41.0, revision 156
 M CLAUDE.md                        the managed pm rules block
 M PROJECT.md
```

`.conductor/brief.txt` is **tracked** too, not gitignored — only `commit-watch.json`, `detours.log`
and `activity/` are. So the issue's *"every one of those paths is gitignored, so `git status` stayed
clean"* was true of the breadcrumbs it looked at and false of the tree as a whole.

**And failure mode 1 is no longer hypothetical: it happened while this proposal was being written.**
A fleet upgrade pass on 2026-09-11 ran `/pm:upgrade` across every managed repository, including this
deployed checkout. It stamped pm 0.41.0, rewrote the rules block and re-rendered — all into a tree
whose next `git checkout --force` discards the lot. The deployed copy reads revision 156 against the
dev clone's 188. Nothing refused, nothing warned, and the operator running the pass did not notice
until a reviewer measured the tree.

That is the strongest available argument for this change and it is first-hand rather than reported.
It also corrects the issue's framing: the harm is not only that breadcrumbs appear where nobody
works, it is that **pm's own upgrade path writes durable, tracked state into a tree that will throw
it away** — and because the files are tracked, a deploy that does *not* use `--force` fails on local
modifications instead.

The failure is silent in both directions:

- A deploy runs `git checkout --force`, so anything pm wrote there is discarded. The upgrade reports
  success and vanishes at the next release.
- A session meaning to work on the backlog writes to the deployed copy instead, and the two
  `state.json` files disagree with nothing reporting it.

The workaround is remembering to wrap every invocation as `(cd <dev clone> && node "$ENGINE" …)` —
exactly the shape this project's own feedback rule calls a filing rather than a footnote. Filed as
`cfdude/pm#175`.

## What Changes

- **A detached HEAD suppresses breadcrumb writes.** `commit-watch.json`, `detours.log`, `brief.txt`
  and the activity log are session bookkeeping about work in progress; a tree nobody is working in
  has none to record. Suppression is silent for these, because a breadcrumb that does not appear is
  not a claim about anything.
- **A detached HEAD makes a MUTATING verb say so.** `upgrade`, `add-epic`, `update-epic` and their
  siblings still run — pm reports, it does not decide — but they print that this tree is detached
  and that a deploy which runs `git checkout --force` will discard the write. Naming the tag when
  HEAD is exactly at one, because *"detached at `v2.11.0`"* identifies a deployment to a reader in
  a way *"detached"* alone does not.
- **Read-only verbs are untouched.** Reading a deployed checkout's record is a legitimate thing to
  want, and `verb-effects.mjs` already declares which verbs those are.

**Detachment is the whole signal — the tag is context, not a condition.** Matching a tag exactly
would be more precise about "deployment" and would miss every deploy that checks out a sha, while
the cases detachment over-catches (a bisect, reviewing an old release) are cases where suppressing
breadcrumbs is right anyway. A cheap signal with harmless false positives beats a precise one with
silent false negatives, and this defect is already a story about a silent false negative.

## Capabilities

### New Capabilities

None. This narrows when one existing capability writes, and adds a warning to a second.

### Modified Capabilities

- `state-write-guard`: a mutating verb announces that its write sits in a detached tree and may be
  discarded by the next checkout.
- `conductor-record`: breadcrumb writes — the commit watermark, the detour log, the brief snapshot
  and the activity log — do not happen in a detached tree.

## Impact

**Engine** — `scripts/lib/git.mjs` (the detachment probe), `scripts/lib/commit-watch.mjs`,
`scripts/lib/subcommands.mjs`, `scripts/lib/activity-log.mjs`, and the mutating-verb announcement
path that already prints the WRITING-A-DIFFERENT-REPOSITORY warning.

**Not changed** — `isInitialized()`. Tracking `state.json` is right and load-bearing, and this
change deliberately does not touch it. The gap was never that the file is tracked; it is that its
existence was doing double duty.

**Schema** — none. No new field, and deliberately not a `deployment: true` flag in `state.json`:
that would inherit the very tracking problem it is meant to solve, riding along into every
checkout including the ones that are workspaces.

**Tests** — a detached-HEAD fixture repository, asserting suppression per breadcrumb and the
warning per verb class, plus the read-only verbs staying silent.

**Docs** — `commands/upgrade.md` and the README, in the same PR cycle.
