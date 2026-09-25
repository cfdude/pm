# The pre-commit gate tests the index; the Real Numbers recipe keeps its evidence — Implementation Plan

> **For agentic workers:** executed natively in one worktree (brief `wt-brief-050`); no subagents.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Epics:** `commit-gate-tests-working-tree-not-index` (superpowers) and `gh-cfdude-pm-219`
(issue #219, superpowers). One plan, one changeset fragment per epic.

**Goal:** (1) `.githooks/pre-commit` verifies the bytes being COMMITTED — the index — instead of the
working tree. (2) The release checklist's Real Numbers recipe saves the whole run to a dated file,
publishes nothing unless the run is clean, and names the file.

**Architecture:** the hook exports the commit's index into a temporary directory with
`git checkout-index -a --prefix=<snap>/` and runs the assertion half THERE; the working tree and the
index are never written. The index it exports is the one git hands the hook (`GIT_INDEX_FILE`,
captured before the hook's env scrub), so `commit -a` and `commit <path>` are verified too.

**Tech stack:** POSIX `sh`, git ≥ 2.31 (`--path-format=absolute`), `node --test`.

**Spec:** the epic descriptions (`jq '.epics[]|select(.id=="…")' .conductor/state.json`) and issue
#219 (read 2026-09-25, `updatedAt` 2026-09-22T12:11:09Z, no comments).

## Global Constraints

- Engine stays zero-runtime-dependency; nothing here touches `scripts/conductor.mjs` or `scripts/lib/`.
- The hook still runs the assertion half ONLY — the runner line stays byte-identical
  (`RUNNER_LINE` in `scripts/test/assert/conductor-09.test.mjs`).
- A functional test changes only with its assertion twin in the same commit (drift check 3).
- `scripts/test/fixtures/helpers.mjs` is off limits (another agent owns it); fixtures use
  `runHookAgainstFixture`'s existing `setup` / `env` / `pathPrepend` options.
- No `certify.mjs` run; no conductor write verbs.

## What 0.47–0.49 already fixed, and what is left (epic description, clause by clause)

| Clause | State |
|---|---|
| "The declared count uses the same glob as the runner" | Fixed in 0.47.0 (`407e4a9`): `declared=$(git ls-files …)` |
| "conductor-09's test for the guard asserts status 0; mutants flipping the comparison survive" | Fixed in 0.47.0: `G-I1` fires the floor through a dotfile the index declares and the glob cannot reach |
| "count declared tests … by content" / zero refusal | Fixed in 0.47–0.49 (checks 2 and 3 in the hook) |
| "ci.yml has no count guard and tests Node 18 only" | Fixed in 0.47.0 and 0.49.0 (`e71c63a`): a floor per bucket, 22/24/26 matrix |
| "runs node --test against the checkout … HEAD holds the failing test" | **OPEN — this plan, Task 1** |
| "a fixture that must abort" | **This plan, Task 1 (fixture a)** |

**CI needs no change.** `actions/checkout` materialises the commit under test; there is no index
distinct from the tree on a runner, so the working-tree/index gap does not exist there.

## A second hole the probe found (in scope, same rule)

The hook scrubs `GIT_INDEX_FILE` before doing anything (to stop the suite's child gits writing the
outer repo's locked index). But git hands a hook a DIFFERENT index for two commit forms — measured
with git 2.55.0 in a scratch repo:

| Commit form | `GIT_INDEX_FILE` in the hook | what `.git/index` holds after the scrub |
|---|---|---|
| `git commit` | `.git/index` (relative) | the commit's content |
| `git commit -a` | `<abs>/.git/index.lock` | the STALE pre-`-a` index |
| `git commit <path>` (`--only`) | `<abs>/.git/next-index-<pid>.lock` | the STALE index |
| linked worktree | `<common>/worktrees/<name>/index` (absolute) | the commit's content |

So today, under `commit -a` / `commit <path>`, the drift script and the floor's `declared` both read
the wrong index. The fix captures the variable before the scrub, absolutises it against the
pre-`cd` `$PWD`, and passes it to exactly three readers — `checkout-index`, `ls-files` (declared) and
`drift.mjs` — and NEVER to the runner (the original leak). Verified in the probe: `checkout-index`
under each of those indexes exported the commit's bytes (v1, v2, v3, v4-not-v5) and every commit
still landed — it reads the index and does not lock it.

## Options compared

| | A. `git stash push --keep-index -u` → run → restore | B. `git checkout-index -a --prefix=$SNAP/` → run in `$SNAP` (**chosen**) | C. pre-commit-framework style: diff unstaged to a patch, `checkout` the index version, run, `git apply` the patch | D. `git worktree add` of the index |
|---|---|---|---|---|
| Works with no HEAD (first commit; EVERY `runHookAgainstFixture` fixture) | **No** — `You do not have the initial commit yet`, exit 1 (measured) | Yes | Yes | No (needs a commit to check out) |
| Writes the working tree | Twice (stash, restore) — mtimes churn, `--watch` loops and editors reload | **Never** | Twice | No, but registers a worktree |
| Unstaged work on SIGKILL mid-hook | Sits in the stash; tree is missing it until someone applies it | **Untouched** (worst case: an orphan dir under `$TMPDIR`) | Sits in a patch file; tree is at index state | Orphaned worktree registration — per this estate's CLAUDE.md an orphaned worktree crashes every Claude Code instance |
| Shared state | The stash stack is shared by EVERY worktree of the repo; parallel agents in this repo push/pop it concurrently | None (private temp dir) | Patch file | Worktree list (shared) |
| Partially staged file | Restored correctly in the measurement (`stash push --keep-index -u` → `reset --hard` → `apply --index <sha>` → drop left `MM README.md` / `?? untracked` every run) — but only through a restore path the hook must itself get right, on a stack it shares | By construction: the snapshot holds the index version | Restored correctly in the measurement (patch → `checkout -- .` → `apply`) — same caveat: correct only if the restore runs | — |
| Untracked files | Must add `-u` or an untracked failing test blocks / an untracked passing one counts | Not exported — never run, never counted | Left in place — an untracked test file RUNS | — |
| `commit -a` / `commit <path>` | Stashes against whichever index is in the env — needs the same capture as B, plus a restore into it | Capture + pass `GIT_INDEX_FILE` | Same capture needed | — |
| Added latency, overhead only (the suite is identical) — 7 interleaved runs, started at load1 15.5, read 17.5–17.9 during (`overhead-4.txt`) | 0.170–0.264 s | **0.165–0.233 s** (`$TMPDIR`); 0.156–0.245 s (git dir) | 0.037–0.045 s | not measured — rejected on the orphan and no-HEAD rows before latency mattered |

Against a ~26 s hook every option's overhead is noise: latency does not choose between them.
(A first pass at load 124–256 read A 1.8–2.6 s, B 2.6–3.8 s with one 39.8 s cold outlier; those
numbers are superseded by the table and kept only because the brief asked for them to be reported
with their load.) C is the fastest and still loses: it writes the working tree twice, leaves an
untracked test file in place to run, and leaves the tree at the index state if the hook is killed
between checkout and apply.

**Why B.** It is the only option that never writes the working tree or the index, so "never lose
unstaged work — untracked files included, and on a failed or interrupted hook" is true by
construction rather than by a restore path that must itself be correct. It also makes the suite run
the COMMIT's engine and docs, not a mix. A full assertion-half run inside an export of the index
passed 1305/1305 (2026-09-25), so no assertion test depends on an untracked file or on `.git`.

### The certification record and the suite lock (git common dir)

- The drift script keeps running in the real checkout (`--root "$ROOT"`), so it still finds the
  certification record at `$(git rev-parse --git-common-dir)` — the snapshot has no `.git` and never
  needs one. The export run above proves no assertion test reads the record.
- `LOCKDIR` becomes ABSOLUTE (`git rev-parse --path-format=absolute --git-common-dir`). In a main
  checkout `--git-common-dir` prints the relative `.git`; once the hook `cd`s into the snapshot, the
  trap's `rm -rf "$LOCKDIR"` would miss and leave the lock for the next commit to clear as stale.
- The snapshot lives in `$TMPDIR` (`mktemp -d`), NOT the common dir: an orphan from a SIGKILL is
  then the OS's to reap, rather than a permanent untracked directory inside every clone.

### Interrupt safety

One trap after the lock is taken removes `$tmpfile`, `$SNAP` and `$LOCKDIR`; `INT`, `TERM` and `HUP`
are trapped to `exit 130/143/129` so the `EXIT` trap runs on a signal under every `/bin/sh`. Nothing
the trap removes is user data.

## Verified outside the fixtures (after Task 3)

- **Real commit forms through the real hook** (`real-commits-and-dash-4.txt`): a plain commit with a
  failing index aborts; `git commit -a` and `git commit -- <path>` each ABORT when what they commit
  fails while `.git/index` passes, and each LAND when what they commit passes while `.git/index`
  holds a failing copy. IX-d simulates the env; this runs git's own temporary indexes, drift included.
- **Under dash** (Ubuntu CI's `/bin/sh`): the whole functional `conductor-09` file passes 40/40 with
  the hook spawned by dash, and the `no-term-trap` mutant is killed behaviourally by IX-f there (under
  macOS bash only the shape test kills it — bash runs the EXIT trap on an untrapped TERM).

## Review Focus

1. **`git commit -a` with a failing test only in the tree** — the hook must test what `-a` stages
   (fixture d, alternate `GIT_INDEX_FILE`).
2. **An untracked failing test file sitting in a rung** — must neither run nor be deleted (fixture c).
3. **Ctrl-C during the suite** — tree, index and lock all come back clean (fixture f).
4. **A partially staged test file** — the index half is what runs AND what `declared` counts
   (fixture a exercises both: the working tree adds nothing the index lacks, and the floor reads the
   snapshot).
5. **Repeated commits** — no temp dirs accumulate (fixture e, a fixture-private `TMPDIR`).

---

### Task 0: this plan

- [x] Commit this file: `docs(plan): pre-commit tests the index; Real Numbers keeps its evidence`.

### Task 1: the hook tests the index (`commit-gate-tests-working-tree-not-index`)

**Files:**
- Modify: `.githooks/pre-commit`
- Modify: `scripts/test/functional/conductor-09.test.mjs` (fixtures a–f)
- Modify: `scripts/test/assert/conductor-09.test.mjs` (twin: snapshot shape, index capture, re-pointed `declared` regex)
- Modify: `CONTRIBUTING.md` (what the hook tests)
- Create: `.changesets/commit-gate-tests-working-tree-not-index.md`
- Create: `docs/superpowers/plans/2026-09-25-commit-gate-evidence/red-1.txt`

- [x] **Step 1: write fixtures IX-a…IX-g in the functional file** (IX-g — a partially staged file is counted by its staged half — was added after the first mutation run showed the `declared-reads-worktree` mutant was killed by the shape test alone), each through `runHookAgainstFixture`
  with `setup(cwd)` doing the git work (hermetic env: `GIT_CONFIG_GLOBAL=/dev/null`,
  `GIT_CONFIG_NOSYSTEM=1`):
  - **IX-a** staged FAILING, working tree PASSING → status ≠ 0, output names the failing test, the
    working-tree bytes and `git show :<file>` are unchanged afterwards.
  - **IX-b** the converse (staged passing, tree failing) → `1/1 passing`, tree still failing.
  - **IX-c** an untracked failing `scripts/test/assert/untracked.test.mjs` → never runs (its title
    absent), still on disk afterwards.
  - **IX-d** `env: { GIT_INDEX_FILE: <alt> }` where the alt index holds the failing version and
    `.git/index` the passing one → aborts (the `commit -a` / `--only` shape).
  - **IX-e** `env: { TMPDIR: <private dir> }` → that dir is empty after a pass AND after a failure;
    `.git/pm-suite.lock` absent after both.
  - **IX-f** stub `node` first on PATH: `--test` → `kill -TERM $PPID; exit 0`, anything else → `exec`
    the real node (drift must still run) → status ≠ 0, tree and index bytes unchanged, lock gone,
    private `TMPDIR` empty.
- [x] **Step 2: RED.** Run the functional file against the OLD hook:
  `node --test --test-name-pattern='^IX-' scripts/test/functional/conductor-09.test.mjs`
  → save to `red-1.txt`. Expected: a and d FAIL (old hook passes a commit whose index fails); e/f
  may fail on the lock path. b and c are precision guards and may pass on the old hook — say so.
- [x] **Step 3: GREEN — the hook.** Capture `GIT_INDEX_FILE` before the scrub and absolutise it;
  default to `git rev-parse --path-format=absolute --git-path index`; `ROOT=$PWD` after the `cd`;
  absolute `LOCKDIR`; one trap for tmpfile/SNAP/LOCKDIR plus INT/TERM/HUP; drift under
  `GIT_INDEX_FILE="$INDEX_FILE"`; `SNAP=$(mktemp -d …)`; `GIT_INDEX_FILE="$INDEX_FILE" git
  checkout-index -a --prefix="$SNAP/"`; `cd "$SNAP"` before the unchanged runner line; `declared`
  from `GIT_INDEX_FILE="$INDEX_FILE" git -C "$ROOT" ls-files …` counting lines in `"$SNAP/$f"`.
- [x] **Step 4: twin.** Re-point the `declared=` regex; assert the capture happens BEFORE the
  `unset`, the export uses `checkout-index` with the captured index, the runner line sits after
  `cd "$SNAP"`, the runner line never carries `GIT_INDEX_FILE`, and the hook never names
  `git stash`.
- [x] **Step 5:** run the functional file (all pass) and the assertion half; mutation proofs (below).
- [x] **Step 6:** CONTRIBUTING + fragment; commit with explicit paths; `git show --stat`.

**Mutation proofs** (each in a COPY of the hook, fixture pointed at the copy by swapping the file
in a scratch clone): drop `cd "$SNAP"` → a fails; drop the capture (use `.git/index`) → d fails;
remove `"$SNAP"` from the trap → e fails; relative `LOCKDIR` → e fails.

### Task 2: the Real Numbers recipe keeps its evidence (`gh-cfdude-pm-219`)

**Files:**
- Modify: `.claude/skills/release-checklist/SKILL.md` (step 4 recipe)
- Create: `scripts/test/assert/release-checklist-recipe.test.mjs`
- Create: `.changesets/gh-cfdude-pm-219.md`
- Create: `docs/superpowers/plans/2026-09-25-commit-gate-evidence/red-2.txt`

- [x] **Step 1: the guard (assert rung, reads one file, spawns nothing):** the recipe's run is
  redirected to a file under `$(git rev-parse --path-format=absolute --git-common-dir)/pm-real-numbers/`
  named with a UTC timestamp; no `| grep -m1 '^ℹ tests '` pipe survives; the decision refuses unless
  runner exit is 0, `ℹ fail 0`, `ℹ cancelled 0`, and `tests == pass > 0`; it prints the saved path;
  a failed run is reported before any re-run.
- [x] **Step 2: RED** against the current SKILL.md → `red-2.txt`.
- [x] **Step 3: GREEN** — rewrite the recipe.
- [x] **Step 4:** execute the recipe's decision block against three synthetic logs (clean; `fail 1`;
  exit 1 with `fail 0` and `cancelled 1`) and keep the transcript in the evidence dir; mutation: drop
  the `fail` clause in a copy of SKILL.md → the guard fails.
- [x] **Step 5:** fragment; commit.

**Not claimed:** #219's flaky test is still unidentified. This change makes the NEXT occurrence
diagnosable and unpublishable; it does not find the flake. The combined single invocation stays the
recipe (one total, one saved log); splitting the buckets is not needed to capture evidence.

### Task 3: measure, sweep, route

- [x] Whole-hook latency, old vs new, interleaved, median of 3, load recorded — in a scratch clone.
- [x] Fill in the Required items section below; commit.

**Measured (2026-09-25, 16 CPUs, Node v26.10.0, git 2.55.0; `latency-3.txt` in the evidence dir).**
Started only once the 1-minute load was below 16 (15.36). A suite run itself drives the load to
~20 (up to 15 test processes), so "load1" beside each number includes the run's own contribution.

| Round | Old hook (working tree) | New hook (index snapshot) | load1 at start |
|---|---|---|---|
| 1 | 26.31 s | 27.63 s | 21.8 / 23.2 |
| 2 | 27.65 s | 39.44 s | 22.8 / 20.4 |
| 3 | 58.66 s | 48.61 s | 23.2 / 48.7 — other agents resumed |
| median | 27.65 s | 39.44 s | — noise-dominated; do not read as a 12 s cost |

The only work the new hook ADDS is the export and its removal: **0.165–0.233 s** at load ~17.5
(`overhead-4.txt`; 0.52–0.74 s at load 68). Whole-hook rounds cannot be taken below load 16 at all:
a suite run itself drives load1 to ~20. Round 1, the only pair taken before outside load returned, differs by 1.3 s. So the
honest statement is: the snapshot costs well under a second of export on a ~26 s hook; the medians
above are dominated by concurrent agents and are not a measurement of the change. The stash
alternative measured 1.8–2.6 s of overhead under the same heavy load as B's 2.6–3.8 s, so latency
does not separate A and B; correctness does (see the comparison table).

## Required items

### Item 1 — call-site sweep

**Rule introduced:** a per-commit gate verifies the INDEX the commit is made from. Callers derived
with `rg -l 'node --test[^\n]*scripts/test/(unit|assert)'` (every place that runs the assertion
half) and `rg -n GIT_INDEX_FILE` (every index reader), excluding archived changes:

| Site | Holds? | Why |
|---|---|---|
| `.githooks/pre-commit` — runner | **Yes (this change)** | runs in the `checkout-index` snapshot |
| `.githooks/pre-commit` — `declared` | **Yes (this change)** | list from the captured index, counts from `$SNAP/$f` |
| `.githooks/pre-commit` → `scripts/test/drift.mjs` | **Yes (this change)** | handed `GIT_INDEX_FILE="$INDEX_FILE"`; drift's own reads are already index-only (`ls-files`, `diff --cached`, `show :path`) |
| `.github/workflows/ci.yml` (three bucket steps + floors) | Yes, unchanged | a runner checks out the commit; no index distinct from the tree exists there |
| `scripts/test/certify.mjs` | Holds through drift | certify runs over the working tree, but its record is checked by drift against the STAGED bytes' hash (`stagedHash`), so a certification of unstaged bytes is refused at commit time |
| `.claude/skills/pr-workflow/SKILL.md` step 2, `CONTRIBUTING.md`, `CLAUDE.md` | Not a gate | a developer's manual run over their working tree, deliberately; the hook is the gate. CONTRIBUTING now says which the hook tests |
| `.claude/skills/release-checklist/SKILL.md` Real Numbers | Not a commit gate | a release-time measurement of the merged tree; Task 2 governs it |
| `scripts/lib/store.mjs:621` | Not a caller | a comment naming a test file |
| `scripts/test/assert/ci-workflow.test.mjs`, `conductor-09` twins | Not callers | tests that READ the hook/CI text |

**Data references:** `INDEX_FILE` — written once (capture, absolutised, defaulted), read by the three
index readers, never by the runner (pinned by the IX shape test). `SNAP` — created by `mktemp -d`,
read by the export, the `cd` and `declared`, removed by `cleanup` on every exit path (IX-e, IX-f).
`LOCKDIR` — now absolute; released by `cleanup` only once held (`LOCK_HELD`). The Real Numbers
`$log` — written by the recipe, read by the human and by the decision block.

**Inverses:** snapshot create ↔ remove (shipped, `cleanup`); lock acquire ↔ release (shipped; the
relative-path release that would have missed from inside the snapshot is fixed and guarded); env
scrub ↔ the capture that re-supplies the index to its readers (shipped). The Real Numbers logs are
written and **not** removed automatically — deliberately: their purpose is to outlive the run so a
failure can be diagnosed later, and a recipe that deleted its evidence would recreate #219. The
inverse ships as a named one-liner in the recipe (`rm -rf "$(git rev-parse --git-common-dir)/pm-real-numbers"`)
to run once nothing in them is owed a diagnosis.

**Not shipped and why:** `--ignore-skip-worktree-bits` on the export — this repo uses no sparse
checkout; a sparse clone would export only its sparse set and the floor would then report a
shortfall naming both counts, which fails closed rather than open.

### Item 7 — route what was learned

- **Process failure → lesson:** `docs/lessons/a-commit-gate-must-read-the-index-git-hands-it.md`
  (+ README index and enforced-in rows). Its sharpest evidence: the commit form the existing lesson
  `git-commit-takes-the-whole-index` recommends (`git commit -- <paths>`) was exactly the form whose
  index this hook's drift check and floor were NOT reading.
- **Tooling friction in pm:** none met — no conductor verb was needed or missing in this work.
- **Practice for the product:** none. pm ships no pre-commit hook to its users; the practice lives in
  this repo's hook, so the lesson (not an epic) is its destination.
- **Not claimed:** #219's flaky test is still unidentified; the recipe now makes its next
  occurrence diagnosable and unpublishable.
