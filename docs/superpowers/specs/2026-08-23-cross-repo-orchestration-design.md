# Design: cross-repo and cross-session conductor orchestration

**Epic:** `gh-82-claude-project-dir-overrides-cwd` (P2, untriaged) · **Issue:** cfdude/pm#82
**Relates:** `cross-session-epic-assignment` (#84, planned) · `epic-session-attribution` (planned)
**Date:** 2026-08-23 · **Engine:** 0.26.0

## What is actually running

Claude Code's cross-session messaging made two orchestration topologies practical, and both are
in production use by the maintainer today. They are not variants of one thing — they stress
different parts of the engine, and only one of them is covered by any existing guard.

| | Topology 1 — fan-out in one repo | Topology 2 — fan-out across repos |
|---|---|---|
| Sessions | N, all with the same cwd | N, each in its own repo |
| Conductors | **one** `.conductor/state.json`, shared | N, one per repo |
| Orchestrator's role | creates epics locally, then messages siblings "you take 1–5, you take 6–10" | creates epics **inside other repos' conductors**, then messages those sessions to execute |
| Engine invocation | ordinary, cwd-resolved | pm run as a CLI **pointed outside its own folder** |
| Live where | general | maintainer's `onvex-ai-corp` setup |

Topology 1 is the case 0.26.0's write-conflict guard was designed for, one assumption too
optimistically (below). Topology 2 is running on a mechanism the tracker currently calls a bug.

## The defect: #82 is two issues wearing one title

`scripts/lib/constants.mjs:7`:

```js
export const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
```

The env var wins. `process.cwd()` is the fallback, not the primary. Everything the conductor
touches hangs off that line — `.conductor/`, `state.json`, `PROJECT.md`, `CLAUDE.md`,
`openspec/changes/`, `docs/superpowers/plans/` (`constants.mjs:8-27`). `scripts/lib/state.mjs:12`
and `scripts/lib/write-conflicts.mjs:15` duplicate the same expression in a per-call `getPaths()`
so tests can cache-bust; the precedence is identical in all three.

**Verified:** the override is exercised deliberately in-tree — `scripts/test/helpers.mjs:20` and
`evals/fixtures.py:56` both set `CLAUDE_PROJECT_DIR` to point the engine at a fixture directory.
The mechanism is not incidental; it is how the test and eval harnesses aim pm at a repo that
isn't the cwd. **Not verified:** whether Claude Code exports `CLAUDE_PROJECT_DIR` into Bash tool
invocations generally. Measured in a subagent Bash call in this repo on 2026-08-23 it was
**UNSET**, so the "typed a command in repo X, wrote repo Y" scenario requires something in the
environment to have set it — a wrapper, an exported shell var, or an orchestrator doing it on
purpose. That measurement narrows the footgun; it does not remove it, because an exported var
persists for every later command in that shell.

### (a) The accidental footgun

When it does fire, nothing tells you. Verified:

| Verb | What it prints on success | Names the repo? |
|---|---|---|
| `add-epic` | `conductor: added epic '<id>' (<lane>, <status>)` (`add-epic.mjs:225`) | **no** |
| `update-epic` | `conductor: updated '<id>'` (`update-epic.mjs:141`) | **no** |
| `write-rules` | `conductor: refreshed rules block in CLAUDE.md` (`rules.mjs:325`) — `path.basename(target)` | **no** |
| conflict refusal | `state.json changed under this process (read revision N, found M)` (`state.mjs:39`) | **no** |
| `render` | `conductor: rendered <absolute PROJECT.md path>` (`render.mjs:160`) | **yes** |

`render` is the only one, and it is the verb least likely to be the one you were watching.

Worse, the one line that could have hinted something was unusual is suppressed by the override's
own presence. `scripts/conductor.mjs:89-91`:

```js
const showEngineBanner = process.env.PM_VERBOSE_ENGINE_BANNER
  ? true
  : (process.env.PM_QUIET_ENGINE_BANNER || process.env.CLAUDE_PROJECT_DIR) ? false : true;
```

Setting `CLAUDE_PROJECT_DIR` turns the banner **off**. That was a correct fix for
`df-engine-banner-noise-every-invocation` — the banner names the *engine* path, not the target
repo, so it never answered this question anyway — but the net effect is that the single condition
that redirects every write is also the condition that makes the engine quietest.

### (b) The missing feature

The same line is load-bearing for Topology 2. An orchestrator with its own conductor reaches into
`~/Repos/other-thing` and runs `add-epic`, `add-many`, `update-epic`, `render` there, then messages
that repo's session to work its local backlog. There is **no other mechanism in the engine** for
addressing a conductor other than the cwd's — verified: no `--repo`, `--project-dir`, `--root`, or
equivalent path flag exists on any subcommand. (`--repo` *is* taken, by `set-tracker`, where it
means a tracker's `owner/name` — `tracker.mjs:34`, `commands/tracker.md:78`. A new path flag must
not reuse that name.)

So closing #82 as filed — hardening or removing the override — **breaks the production
orchestration pattern with no replacement.** The issue's title describes (a); the maintainer's
live usage depends on (b); one fix cannot serve both.

## Proposal: make it explicit, then close the silent path

The order matters and it is the whole argument.

1. **Add an explicit target flag** — `--project-dir <path>` reads best (it names exactly what it
   overrides) and avoids the `set-tracker --repo` collision. Accepted by every state-touching
   subcommand.
2. **Every write that used it says so.** A conductor command that wrote a repo other than the cwd
   prints the absolute path it wrote, unconditionally, on stderr. This is the actual fix for (a):
   the footgun is not that a remote write is *possible*, it is that it is *indistinguishable from
   a local one in the output*.
3. **Only then** demote or remove the bare `CLAUDE_PROJECT_DIR` precedence — either drop it for
   state-mutating verbs, or keep it and require the flag to confirm any target that differs from
   the cwd. Both leave the harnesses working (`helpers.mjs`, `fixtures.py` can pass the flag).

### One implementation constraint, verified

`constants.mjs:7` resolves `ROOT` at **module load**, and `PROJECT_MD`, `CLAUDE_MD`,
`CONDUCTOR_DIR`, `CHANGES_DIR`, `PLANS_DIR` are all `path.join(ROOT, …)` frozen at that moment.
`state.mjs` and `write-conflicts.mjs` recompute per call; nothing else does. A flag parsed in the
dispatcher therefore arrives **after** the constants that need it are already computed. Three
options, none free:

- Re-exec the process with the env var set once the flag is parsed (smallest diff, one extra
  process, keeps every existing import untouched).
- Convert the frozen constants to accessor functions (touches every import site of
  `constants.mjs`).
- Parse the flag from `process.argv` inside `constants.mjs` before computing `ROOT` — precedent
  exists: `state.mjs:97` reads `process.argv.includes("--force")` directly rather than threading
  it through 24 call sites, and `conductor.mjs`'s `platformFlag()` does the same shape.

The third is the smallest honest change and matches how the codebase already handles a
cross-cutting flag. This is a recommendation, not a verified-to-work claim.

## Concurrency under Topology 1: the guard's assumption no longer holds

0.26.0 shipped an optimistic revision guard (`2026-08-18-state-write-conflict-guard-design.md`).
Verified behavior, re-read for this note:

- `saveState()` re-reads the on-disk revision and compares (`state.mjs:91-104`).
- Interactive verbs throw `StateConflictError` → exit **9** (`state.mjs:103`,
  `constants.mjs:17`, dispatcher tail of `conductor.mjs`).
- Hook writes pass `onConflict: "skip"`; `render()` retries **once**, re-running the heal on a
  fresh load, then gives up (`render.mjs:30-36`).
- A skip appends a line to `.conductor/write-conflicts.log`; a successful write deletes it
  (`write-conflicts.mjs:33-61`).
- The briefing warns at the threshold (`briefing.mjs:63-66`), `CONFLICT_WARN_THRESHOLD = 3`.

That design says out loud that its writers are "common, not rare" — but the *rare* thing it
assumed was contention being **accidental**. An orchestrator fanning ten epics across two sessions
makes contention **routine and intended**. Four consequences, separated by how confident I am.

**1. Skip-on-conflict is still acceptable — for what it currently guards.** Verified: the only
hook writes are `reconcileArchived()` self-heals (`render.mjs:30`, and `commitNudge()`'s call in
`subcommands.mjs`). A dropped self-heal genuinely re-runs on the next hook. Nothing in the skip
path can lose an epic, a status, or a story. **But the acceptability is a property of what hook
writes currently do, not of the skip mechanism** — the moment any hook write carries information
that is not recomputable (a claim, an assignment, an attribution stamp — exactly what
`cross-session-epic-assignment` proposes), "skip" silently drops user-visible data. That
constraint should be written down where a future hook-write author will read it, because today it
is only true by accident of scope.

**2. The threshold of 3 is not the problem; the sampling is.** This is the finding I would act on
first. Verified: `briefing.mjs:63` tests `conflictCount() === CONFLICT_WARN_THRESHOLD` — strict
equality, deliberately (the comment explains: warn once, don't storm). Also verified: `buildBrief`
consumes the warning only from `brief()` and `snapshot()` (`subcommands.mjs`), and per
`hooks/hooks.json` those fire at **SessionStart** (`startup|resume|compact`) and **PreCompact**
only. **Inferred, and I am confident in the inference:** the counter is therefore sampled a
handful of times per session, and the test is for an exact value. Under accidental contention the
count creeps 1 → 2 → 3 and a sample lands on 3. Under deliberate fan-out it can go 0 → 7 between
two samples, and `7 === 3` is false — the warning never fires at all. The escalation is *least*
likely to work in exactly the regime that produces the most skips. Changing `===` to `>=` alone
reintroduces the storm the equality exists to prevent; the fix is a latch (warn on first crossing,
re-arm only after a success) rather than a wider comparison.

**3. There is no lock, so the check itself can be raced.** Verified by reading
`state.mjs:91-128`: `diskRevision()` reads, then `writeFileSync` + `renameSync` writes, with
nothing between them. Two processes that both read revision `N` can both pass the comparison and
both write; `rename(2)` keeps the file un-torn, so the loser's change vanishes exactly as it did
before the guard. The window is small and the design deliberately rejected a lockfile for good
reasons. **Inferred:** at accidental contention this is negligible; at scripted fan-out, where
several sessions are told to act at the same instant, it is a real if low-probability hole. Worth
measuring before worth fixing — and worth *not* claiming the guard is airtight in docs.

**4. Exit 9 has no consumer.** Verified: the code is emitted and documented as retryable, and
nothing in the engine or the command docs defines the retry. The agent is expected to re-read and
re-apply. That is fine when it happens twice a week and unexamined when it happens twenty times
in a fan-out. A documented retry protocol in the rules block (re-run the read, re-apply, at most
N times, then report) is cheap and is instruction-layer work, not engine work.

## What Topology 2 breaks that Topology 1 doesn't

| Artifact | Guarded against a concurrent writer? | Cross-repo consequence |
|---|---|---|
| `.conductor/state.json` | **yes** — revision compare on the file itself | works; the counter is per-repo and blind to *who* |
| `PROJECT.md` | **no** — plain `fs.writeFileSync` (`render.mjs:159`) | a foreign `render` overwrites it whole |
| rules block in `CLAUDE.md`/`AGENTS.md` | **no** — plain `fs.writeFileSync` (`rules.mjs:333`) | a foreign writer rewrites the local agent's instructions |
| `.conductor/write-conflicts.log` | n/a, append-only | fills with skips a local writer did not cause |
| `.conductor/detours.log` | n/a, append-only | fine |

**The state guard does cover the cross-process case, and that is worth stating plainly.** It is
file-based, not session-based: `diskRevision()` re-reads whatever is on disk, so an orchestrator
writing into repo Y's `state.json` is revision-checked against repo Y's counter exactly as a local
writer would be. Topology 2 does not open a new lost-update hole in `state.json`.

**What it opens is everything else.**

- **`PROJECT.md` re-render in a repo whose session did not ask for it.** Verified: `render()`
  reads state, formats, and writes `PROJECT_MD` with no revision check of any kind, and stamps
  `Last rendered: <now>`. An orchestrator's remote `add-epic` → `render` rewrites a file the local
  session may be mid-read on. `PROJECT.md` is generated, so nothing is *lost* — but the local
  session's picture of its own project changes underneath it with no event, and `verify-state`'s
  mtime-vs-render-stamp comparison (`worktree-hygiene.mjs:114`) is now being fed by two writers.
- **The rules block being refreshed by a foreign writer is the sharper one.** Verified:
  `writeRules()` (`rules.mjs:310-333`) resolves a target via the platform chain and writes it
  whole — refreshing an existing block in place, appending to a file that has content, or
  *creating the file* if it does not exist. It is called by `init`, `upgrade`, `set-tracker`,
  `set-review-mode`, and `migrations`. A remote `set-tracker` or `upgrade` therefore rewrites the
  managed instruction block in another repo's `CLAUDE.md` — the file that repo's live agent is
  being steered by — announcing it as `conductor: refreshed rules block in CLAUDE.md`, with no
  path. In a repo where the platform chain resolves to `AGENTS.md` or where the file does not
  exist yet, a foreign writer can **create** an instruction file. This is pm's instruction layer
  writing into a *different* agent's instructions, and it is the one place where the cross-repo
  write is not merely a bookkeeping race.
- **Misattributed contention warnings.** Verified text (`briefing.mjs:64`): `⚠ 3 state writes
  skipped on conflict — a writer may be wedged`. Inferred: under Topology 2 the "wedged writer"
  is a healthy remote orchestrator, and the local session is told to go hunting for a fault that
  does not exist in its repo. The message is right for the world it was written for and wrong
  for this one; it should name the possibility of an external writer once the flag exists to
  make external writers legitimate.

## Attribution: the field family both topologies need

Neither topology records who did anything. Verified from `.conductor/state.json`: an epic carries
`id`, `title`, `priority`, `status`, `role`, `lane`, `links`, `reconcileNeeded`, optional
`parent`, `autonomy`, `startedAt`/`completedAt`, `gateReview`, `externalId`/`externalUrl`. No
creator, no assignee, no session identity, anywhere.

Two epics already own this ground and this note does not duplicate them:

- **`epic-session-attribution`** (P3, planned) — "Record which session did the work on an epic
  (opaque agent-supplied identity, append-only trail)". Records **who did**.
- **`cross-session-epic-assignment`** (P3, planned, #84) — "Assignment + claim semantics so an
  orchestrating session can distribute epics across executor sessions", `depends-on
  state-lost-update-concurrent-sessions` with the reason "dispatch across concurrent sessions is
  unsafe while state.json has no read-modify-write guard". Records **who should**.

What this note adds is a third axis they do not cover: **which repo the writer was standing in.**
Attribution answers "which session", assignment answers "which session should" — Topology 2 also
needs "was this epic created by this repo's own session, or reached in from outside". That is one
more optional field on the same append-only trail `gh-79-epic-description-and-notes` is already
planning (`{at, actor, text}` — its `relates-to` link to `epic-session-attribution` says so
explicitly), not a fourth mechanism. Its dependency is the flag, since before an explicit target
flag exists there is no truthful value to record.

Also worth noting: the assignment epic's stated blocker is now **satisfied** — the guard it waits
on shipped in 0.26.0. Its dependency link should be reconciled rather than left implying it is
still blocked.

## The trust boundary — the highest-stakes item here

The maintainer operates a hard personal/employer repo separation (see this repo's user-scope
`CLAUDE.md`, § Trust boundary): a repo is classified by cwd + git remote + path, and anything
crossing personal ↔ Highway requires an explicit human approval before it happens. That rule is
written entirely in terms of **messages between sessions**. Cross-session messaging is the channel
it polices.

**A cross-repo conductor write is a second channel, and no existing check covers it.** Verified,
by absence: nothing in `scripts/` reads a git remote, a directory name, or any classification
signal before writing. Every `execSync` in the engine is accounted for and none of them is
`git remote` — `rev-parse --short HEAD` (`git.mjs:10`), `diff-tree` and `log -1`
(`subcommands.mjs:86,98`), `worktree list --porcelain` and `merge-base --is-ancestor`
(`worktree-hygiene.mjs:35,72`). `add-epic` validates the id against
`^[a-z0-9][a-z0-9._-]*$`, the lane against `KNOWN_LANES`, the status against `KNOWN_STATUSES` —
and writes wherever `ROOT` points, with no notion that a target repo could be a different trust
domain from the caller's.

Concretely: a personal-side orchestrator that has `CLAUDE_PROJECT_DIR` exported, or that is later
given a `--project-dir` flag, can write epics, notes, a tracker configuration, and **a managed
instruction block** into an employer repo — and the visible output is
`conductor: added epic 'x' (claude-code, queued)`. No message is sent, so the cross-session rule
never fires. No network call is made, so pm's architectural law is not violated. Nothing is
logged that names the target. It is a boundary crossing through a door nobody put a check on.

This does not argue against the feature; it argues that the feature's *first* increment is the
one that makes the crossing legible:

- **Naming the target on every remote write is the minimum**, and it is what turns this from an
  invisible crossing into one the operator can see and the user can audit.
- **A mechanical refusal is defensible here**, and precedent exists: pm already blocks locally in
  three places — the gate-guard `PreToolUse` hook (unconditional when `reconcileNeeded`), the
  Gate 2 archive check (`update-epic.mjs:106-115`), and 0.26.0's write guard. A fourth — refuse a
  `--project-dir` target whose git remote or path classifies differently from the caller's,
  unless a `--cross-boundary` flag is passed — is the same *shape* as those: local, mechanical,
  no network, an explicit override available. Reading `git remote get-url origin` via `execSync`
  is the same zero-dependency technique `worktree-hygiene.mjs` already uses.
- **But the classification rule itself is the maintainer's, not pm's**, and hard-coding
  `listreports`/`Highway-ai`/`~/Documents/Highway` into a published plugin would be wrong. The
  honest shape is a per-repo opt-in — a declared domain in `state.json`, compared between caller
  and target, with pm supplying the mechanism and the user supplying the labels. **This is a
  design question, not a settled answer, and it should be decided before the flag ships rather
  than bolted on after**, because a flag that ships without it teaches the pattern first and adds
  the check to an installed base second.

## The check that can fail

Every assertion below can fail against the current engine today.

1. **A remote write names its target.** `add-epic --project-dir <other>` prints the absolute path
   of the `state.json` it wrote. Fails today — the success line names the epic only
   (`add-epic.mjs:225`).
2. **A flagless invocation in repo X with `CLAUDE_PROJECT_DIR` pointing at Y is refused or
   announced**, not silently applied to Y. Fails today (`constants.mjs:7`).
3. **The flag exists at all.** `--project-dir` is accepted by the state-touching verbs and rejected
   with a usage line when the path is not an initialized conductor. Fails today — no such flag.
4. **`--project-dir` does not collide with `set-tracker --repo`.** A test that both flags coexist
   on one invocation without either being mis-parsed.
5. **The threshold warning survives an overshoot.** Push the skip counter from 0 to 5 between two
   briefings; the warning must still appear exactly once. Fails today — `briefing.mjs:63` tests
   `=== 3`, so 5 warns zero times. The companion assertion (no re-warn at N+1) must also still
   hold, or the fix has just reintroduced the storm.
6. **A foreign `render` does not silently replace `PROJECT.md`.** At minimum the write is
   announced with its absolute path in a way the local session can see; ideally the local session's
   next brief can tell that the file moved under it. Partially fails today — `render.mjs:160`
   prints the path, but nothing correlates it with a foreign writer.
7. **A foreign `writeRules` cannot create an instruction file in a repo that has none.** Creating
   `CLAUDE.md`/`AGENTS.md` in another repo must require an explicit confirmation flag. Fails today
   (`rules.mjs:329-331`).
8. **Two processes racing the same revision cannot both win.** Construct the TOCTOU window
   directly (read revision in both, write in both). May pass by timing today, which is precisely
   why the assertion has to be constructed rather than sampled.
9. **A cross-domain target is refused without an explicit override** — once the domain-labelling
   design is settled. Fails today; no classification exists in the engine.

## Scope

**In:** an explicit target flag with mandatory target-naming output; the constants-resolution
change that makes the flag reachable; the threshold-latch fix; a documented exit-9 retry protocol
in the instruction layer; the design decision on trust-domain labelling.

**Out, deliberately:**

- **Any engine-side network call, cross-session message, or session registry.** pm's law is
  unchanged: the orchestrator does the messaging, the engine only knows which conductor it was
  told to address. Local mechanical enforcement stays permitted, as it already is in three places.
- **A lockfile.** Rejected in the 0.26.0 design for reasons that have not changed; the TOCTOU
  finding argues for measuring the window, not for reversing that call.
- **`epic-session-attribution` and `cross-session-epic-assignment`.** Both already filed, both
  needed, neither is this. This note adds one field to their trail and one reconciliation to
  #84's now-satisfied dependency link.
- **Hard-coded trust-domain rules.** pm supplies the comparison; the user supplies the labels.
- **A general remote-execution mode.** The orchestrator drives pm as a CLI; nothing here proposes
  pm running work in another repo.

## Consequence

#82 stops being a bug that would break production if fixed and becomes two changes with an order:
say out loud which conductor you are addressing, then close the door that let you address it
silently. The unguarded artifacts — `PROJECT.md` and, far more importantly, another repo's
managed instruction block — get named as such rather than discovered later. And the one crossing
that has no check anywhere gets a design decision made about it while the installed base for
cross-repo writes is still one person.
