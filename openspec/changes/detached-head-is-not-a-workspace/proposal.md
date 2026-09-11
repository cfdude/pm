## Why

pm's dormancy guard is `fs.existsSync(STATE_PATH)` — `scripts/lib/state.mjs`, `isInitialized()`.
And `.conductor/state.json` is **git-tracked by design**: it is the backup, and `git restore
.conductor/state.json` is the documented undo. So in any repository that deploys by checking
*itself* out, the deployed copy carries `state.json` too, and pm reads that checkout as a
workspace it manages.

One file is answering two different questions — *"is this repository pm-managed?"* and *"is this
tree a place to work?"* — and in a self-deploying repository those answers diverge.

**Measured on this machine 2026-09-11, in a production tree:** `~/Servers/market-intelligence`
deploys via `git checkout --detach --force <tag>` and sits detached at exactly `v2.11.0`, with
development in a sibling worktree on branch `dev`. Its `.conductor/` holds `commit-watch.json`,
`brief.txt` and an `activity/` directory — breadcrumbs pm wrote into the deployed tree because two
sessions opened with their cwd there. Every one of those paths is gitignored, so `git status`
stayed clean and nothing surfaced it; the owner noticed independently and asked why the production
checkout had conductor files at all. Filed as `cfdude/pm#175`.

The failure is silent in **both** directions, which is why it is worth the engine's attention
rather than operator discipline:

- A deploy runs `git checkout --force`, so any uncommitted state pm wrote there is **discarded**.
  A `/pm:upgrade` in that tree reports success and then vanishes at the next release.
- A session that meant to work on the backlog writes to the deployed copy instead, and the two
  `state.json` files disagree with nothing reporting it. Measured here: revision 105 (deployed, pm
  0.36.0) against 108 (dev, 0.39.0) — harmless only because the deployed one happened to be
  byte-identical to its committed version.

The workaround is remembering to wrap every invocation as `(cd <dev worktree> && node "$ENGINE" …)`
— which is exactly the shape this project's own feedback rule calls a filing rather than a
footnote.

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

None. This narrows when two existing capabilities write, and adds a warning to a third.

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
