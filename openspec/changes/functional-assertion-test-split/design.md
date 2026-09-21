# Design

## Context

See `proposal.md` for the measurements and the motivation. What shapes the approach here:

- **The engine is a single-file entry point plus 50 library modules**, dispatched from one object
  literal at `scripts/conductor.mjs:286–369` and caught at one place (`:370–383`). That structure is
  already nearly the shape this change needs: one dispatch site, one catch, one exit-code mapping in
  `scripts/lib/refusal.mjs`.
- **The engine's refusals are `process.exit` calls, not values.** 194 occurrences of `process.exit(`
  across `scripts/lib` (189 `exit(1)`, 2 `exit(2)` in `gate-guard.mjs:389,397`, the rest in prose),
  against only five modules that define a local `die()` helper (`detour-stack.mjs:40`,
  `claims.mjs:111`, `add-many.mjs:44`, `releases.mjs:42`, `purge-logs.mjs:102`). `conductor.mjs` adds
  five executable exits (`:147` delegation, `:172` and `:180` help, `:191` refusal, `:368` usage) and
  one `process.exitCode` assignment at `:382`.
  **The brief characterized this as touching "only the die path". It does not.** The die helpers are
  5 of 194 sites; the other 189 are inline `process.stderr.write(...); process.exit(1);` pairs. The
  conversion is mechanical, but it is a 194-site sweep and the task list is sized for that.
- **The root is frozen at module load.** `scripts/lib/constants.mjs:12` captures
  `ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd()`, and ELEVEN more path constants derive from
  it in the same module-load pass — `:13` `CONDUCTOR_DIR`, `:14` `STATE_PATH`, `:15` `BRIEF_PATH`, `:16`
  `RENDER_STAMP_PATH`, `:17` `DETOURS_LOG`, `:18` `WRITE_CONFLICTS_LOG`, `:42` `PROJECT_MD`, `:43`
  `CLAUDE_MD`, `:44` `CHANGES_DIR`, `:45` `ARCHIVE_DIR`, `:46` `PLANS_DIR`, `:52` `SPECS_DIR`. **Twelve
  constants, enumerated mechanically rather than from this list**:
  `rg -n 'path\.join\((ROOT|CONDUCTOR_DIR|CHANGES_DIR)' scripts/lib/constants.mjs`. Five of them are
  WRITTEN by the engine — `PROJECT_MD` (`render.mjs:324`), `RENDER_STAMP_PATH` (`render.mjs:365`),
  `BRIEF_PATH` (`subcommands.mjs:155`), `DETOURS_LOG` (`git.mjs:114,175`), `WRITE_CONFLICTS_LOG`
  (`write-conflicts.mjs:33,46,63`) — so a sweep keyed on the token `ROOT` reaches neither them nor the
  constants that hold them, which is exactly how a frozen path survives a "convert every ROOT reader"
  pass. 17 library modules reference `ROOT` (98 references); 7 reference `STATE_PATH`/`CONDUCTOR_DIR`
  (48 references — matching lines, `rg -c '\b(STATE_PATH|CONDUCTOR_DIR)\b' scripts/lib`; the raw
  occurrence count is 54, and `created-at.mjs:35,98`'s `STATE_PATHSPEC` is a different constant and
  must not be dragged into this one).
  Per-call root has prior art in the engine already: `git.mjs`'s `headAttachment(root = ROOT)` and
  `isDetachedTree(root = ROOT)`, and six `root = ROOT` parameters in `commit-watch.mjs`. **The
  brief's second file reference is wrong ABOUT THE SHAPE**: `state.mjs` is already per-call —
  `getPaths()` at `state.mjs:15–19` re-derives `ROOT`, `CONDUCTOR_DIR` and `STATE_PATH` on every
  access, deliberately so tests can move it, and the sweep must not "fix" that into a captured value.
  What it is NOT free of is the global it re-derives FROM: `process.env.CLAUDE_PROJECT_DIR ||
  process.cwd()` (see the `process.cwd()` sites below), which under an injected env is the process's,
  so `state.mjs` is swept like every other module for that and exempted from nothing.
- **Other globals are read directly**: 46 `process.argv` reads in `scripts/lib`, 23 `process.env`
  reads (20 in `scripts/lib`, 3 in `conductor.mjs`; 7 distinct keys — `CLAUDE_PROJECT_DIR` ×10,
  `CLAUDE_PLUGIN_ROOT` ×2, and one each of `PM_VERBOSE_ENGINE_BANNER`, `PM_QUIET_ENGINE_BANNER`,
  `PM_SESSION`, `PM_OPENSPEC_VERSION`, `PM_CACHE_ROOT`), 288 `process.stdout.write` /
  `process.stderr.write` calls (278 in `scripts/lib` — 30 + 248 — plus TEN in `conductor.mjs` at
  `:171,179,187,246,344,354,364,367,377,381`, of which the unknown-verb usage and the refusal output
  are two the conformance set exercises), and **nine `process.cwd()` reads across seven modules**, each
  deriving a root as `process.env.CLAUDE_PROJECT_DIR || process.cwd()`: `constants.mjs:12`,
  `state.mjs:17`, `state.mjs:501`, `state.mjs:506`, `write-conflicts.mjs:15`, `claims.mjs:72`,
  `purge-logs.mjs:34`, `lessons.mjs:42`, `activity-log.mjs:41` — enumerated by `rg -n 'process\.cwd\(\)'
  scripts/lib`, never from this list. A tenth site, `constants.mjs:1568`'s
  `rootDivergence({ env = process.env, cwd = process.cwd() })`, is already injectable and is the shape
  the other nine take. Under an injected env these nine see the PROCESS's cwd, not the invocation's, so
  a sweep that names only `process.argv`/`process.env`/`process.stdout`/`process.stderr` — or that
  exempts `state.mjs` because `getPaths()` is already per-call — leaves Decision 3's two-roots
  guarantee unmet.
- **Git is reached from seven modules**, 23 invocations in total: `git.mjs` 11 (`:10, :55, :121,
  :129, :203, :229, :254, :274, :320, :392, :436`), `created-at.mjs` 3 (`:60, :63, :97`),
  `subcommands.mjs` 4 (`:186, :189, :211, :222`), `commit-watch.mjs` 1 helper (`gitOut` at `:72`)
  reached from 3 call sites (`:82, :83, :289`), `worktree-hygiene.mjs` 2 (`:35, :75`),
  `tool-currency.mjs` 1 (`:148`; `:72` in that file runs `openspec`, not git), `constants.mjs` 1
  (`:1617`). **THREE of those sites are shell-string `execSync`, not argv `execFileSync`** —
  `subcommands.mjs:222`, `git.mjs:10` and `worktree-hygiene.mjs:35` — and the gateway sweep's regex
  (`rg -e 'execFileSync\(' -e 'execSync\('`) reaches all three; the gateway's operations therefore
  take a command, not an argv pair, for those.
- **The assertion half will share one process across all its files.** Three module-level caches
  already exist in `git.mjs` — `headAttachmentCache`, `resolvedCommitCache`, `unreachedCache`, all
  three named, all keyed by value or by root (`rg -n '^const .*Cache = new Map' scripts/lib`) — plus
  one module-scope mutable outside it: `subcommands.mjs:178`'s
  `let showPrefix = null`, which caches `git rev-parse --show-prefix` under an explicit invariant
  comment ("ROOT does not move under a running invocation"). `conductor-12` currently cache-busts
  module imports to re-evaluate frozen constants. One process makes those caches live for the whole
  half, makes cache-busting imports useless, and — for `showPrefix` — makes the invariant the comment
  states FALSE: invocation 2 reuses invocation 1's prefix against invocation 1's root and
  `changedFiles()` mis-strips, which corrupts every `CONDUCTOR_OWN_FILES` comparison downstream.
- **Three places run the suite command** and all three will be wrong after the split:
  `.githooks/pre-commit` (which also holds a test-count floor and a cross-worktree lock at
  `$(git rev-parse --git-common-dir)/pm-suite.lock`), `.github/workflows/ci.yml` (`node-version: 18`,
  `node --test scripts/test/*.test.mjs`), and the `release-checklist` repo skill's Real Numbers
  recipe, which derives a published test count from that same command.

## Goals / Non-Goals

**Goals:**

- An assertion half that runs the whole engine's behaviour on every commit without booting Node and
  without a git repository.
- A functional half that runs the REAL git, through the real gateway, exactly when its subject
  changed — and a mechanical reason to believe it ran, rather than a memory of it having run.
- No behavioural change to the shipped plugin, its CLI contract, its hook statuses or its
  dependencies.

**Non-Goals:**

- Replacing `node:test`. The bake-off rejected Vitest for reasons this design depends on; the runner
  stays.
- Making the functional half fast. It is slow by nature and that is why it is triggered rather than
  per-commit.
- Deleting or weakening any existing test. Existing tests are re-pointed, moved between halves, or
  split into a pair — see Decision 6 and the migration plan.
- Adding a runtime or development dependency. The drift script is plain Node, like the engine.

## Decisions

### D1 — `main(argv, io)` is the entry point, and the CLI is a three-line tail

`scripts/conductor.mjs` exports `async function main(argv, io)` returning a numeric status. Its
`io` carries `{ cwd, env, stdin, stdout, stderr }`. The module keeps working as `node
scripts/conductor.mjs …` by ending in a tail that calls `main(process.argv.slice(2), { cwd:
process.cwd(), env: process.env, stdin: process.stdin, stdout: process.stdout, stderr:
process.stderr })` and assigns the result to `process.exitCode`.

**FIVE things that run at module load move behind `main(argv, io)` with it**, because each of them is
per-invocation work that would otherwise happen once per PROCESS — against the real env and the real
streams — while `main()` was still being entered: the delegation handoff
(`conductor.mjs:146–147`, which SPAWNS a child and exits), the root-divergence warning (`:225`, real
stderr), **the detached-tree warning (`:234`, which probes the real git at load — `isDetachedTree()`
runs `git symbolic-ref` from `git.mjs:51–63` against the FROZEN `ROOT`, so it is both a stderr write
and a module-load git invocation that ignores the invocation's root — and then writes FOUR lines to
real stderr through `warnDetachedTree`, `scripts/lib/constants.mjs:1620–1627`)**, the engine banner
(`:244–249`, three real `process.env` keys), and the activity log's exit handler (`:273–281`, D11).
The first four are gated on `VERB_EFFECTS[cmd]?.effect !== "read-only"` (`:221`), so the warning path
is reached by a mutating or unknown verb and never by `--help` or a read-only verb — which is why the
verify below needs two commands and not one. Verified they fire before dispatch today: `env -u
CLAUDE_PROJECT_DIR node scripts/conductor.mjs not-a-verb` prints the banner and refusals with nothing
dispatched. Without the move, `io.stderr` is not where the banner goes and the spec's "nothing the
engine prints for that invocation SHALL reach the process's own stdout or stderr" is unmet on every
invocation.

**The brief specified `main(argv, {cwd, stdout, stderr})`; stdin and env are added, and the reason is
measured rather than stylistic.** Four call sites read stdin — `gate-guard.mjs:330`,
`lessons.mjs:129`, `subcommands.mjs:298`, `add-many.mjs:28` (via `state.mjs:28`'s `fs.readFileSync(0)`)
— and 110 existing test call sites pass a payload through `run(..., { input })`. `conductor.mjs:190`
also drains stdin before exiting on a refused hook line, using `isatty(0)` rather than
`process.stdin.isTTY` for a stated reason. Env is injected because 23 reads touch 7 keys, two of
which (`CLAUDE_PROJECT_DIR`, `PM_CACHE_ROOT`) are how every existing fixture points the engine at a
temporary root; leaving env process-global would make the assertion half's roots a shared mutable,
which is exactly the hazard Decision 3 removes.

*Alternatives considered.* (a) Keep `process.exit` and let the assertion half spawn — this is today,
and it is the thing being fixed. (b) Intercept `process.exit` and the stream writers by replacing
them at the process level: it is monkey-patching, it is the failure mode the bake-off found in
Vitest's `isolate:false`, it would break the `process.on("exit")` instrumentation discussed in D11,
and it would make the assertion half a listener on globals that other test files also mutate.

### D2 — Every refusal throws `CommandExit`, caught at the one dispatch site

A single `die(message, code = 1)` writes to the injected stderr and throws `CommandExit { code }`.
The 194 `process.exit(` sites in `scripts/lib` and the five local `die` helpers are converted to it,
so the code path is uniform. `main()`'s dispatch block keeps its existing `catch` (`conductor.mjs:370`)
and maps `CommandExit` to its return value; `refusalFor()` in `scripts/lib/refusal.mjs` continues to
own the mapping from a thrown error to `{ exitCode, stdout, stderr }` for conflicts (9), unreadable
input (11), ambiguous rules blocks (11) and the hook-specific statuses (2 for `gate-guard` and
`commit-nudge`, 0 for `brief`).

Three exits do NOT become `CommandExit` and keep their meaning. `:147` returns the delegated child's
status (the `PM_ENGINE_DELEGATION` handoff owns the whole invocation — `main()` returns it). `:191`,
the pre-dispatch refusal, **returns its code** rather than throwing: it sits ABOVE dispatch's `try`, so
a `CommandExit` thrown there would escape the one `catch` that maps it, and the refusal would leave
`main()` as an exception instead of a status. And the CLI tail sets `process.exitCode` rather than
calling `process.exit`, preserving the reason recorded at `conductor.mjs:378–381` (a hook's refusal can
be a JSON payload on stdout and exiting immediately truncates it at a pipe buffer).

*Consequence worth naming:* the `gate-guard` hook's exit-2 block (`gate-guard.mjs:389,397`) becomes a
return value of 2. That is what makes the hook's boolean contract testable in-process, and it is also
why the conformance set (D10) has to prove `main()` returns the same 2 the binary exits with: a hook
that stops blocking is a safety regression, not a test failure.

### D3 — Globals are supplied per call, and one process per suite is why this is mandatory

Every frozen path constant in `constants.mjs` becomes a function of a current root
(`conductorDir(root)`, `statePath(root)`, `projectMd(root)`, …), defaulting to the invocation's root,
following `headAttachment(root = ROOT)`'s existing shape. **All TWELVE of them** — not the seven the
task list originally named: the enumeration is
`rg -n 'path\.join\((ROOT|CONDUCTOR_DIR|CHANGES_DIR)' scripts/lib/constants.mjs`, and the tokens
`ROOT|STATE_PATH|CONDUCTOR_DIR` cannot reach `BRIEF_PATH`, `RENDER_STAMP_PATH`, `DETOURS_LOG`,
`WRITE_CONFLICTS_LOG`, `ARCHIVE_DIR`, `PROJECT_MD`, `CLAUDE_MD`, `CHANGES_DIR`, `PLANS_DIR` or
`SPECS_DIR`, five of which the engine WRITES. Each constant's consumers are then swept from the
constant, not from `ROOT`. `main()` sets the invocation's root, argv, env and streams; the 46
`process.argv` reads, the 23 env reads, the nine
`process.env.CLAUDE_PROJECT_DIR || process.cwd()` root derivations and the 288 stream writes go through
them. **`state.mjs` is in this sweep, not exempt from it**: `getPaths()`'s per-call re-derivation is
the right *shape* and is preserved, but it re-derives from `process.env.CLAUDE_PROJECT_DIR ||
process.cwd()` — process globals — so it must take the invocation's env and cwd instead of the
process's, or the second of two in-process roots reads the first's directory.
**`subcommands.mjs:178`'s `showPrefix` moves to the same per-call scope as the root it caches
against** — a cached `--show-prefix` is only sound while the root cannot move, and Decision 3 is
precisely the decision that it can.

**This is not tidiness — under `--test-isolation=none` it is correctness.** All assertion files share
one module graph, so a module-scope `ROOT` would be captured once, by whichever file loaded the
engine first, and every later file's writes would land in the first file's directory. The engine has
already shipped this bug once: `git.mjs`'s comment on `headAttachment` records gh#175 — guarding one
tree while writing to another, which broke this repository's own suite under a detached `ROOT`
because `actions/checkout` leaves HEAD detached. The same failure, one level up, is what a shared
process would produce for every test at once.

*Alternatives considered.* (a) One root per assertion process, created once, with tests sequenced
inside it: rejected — tests would collide on `state.json` and would have to be written for the
serialization, and a test that forgot would fail as a flake rather than as a statement. (b)
Cache-busting dynamic imports per test (`import("../lib/constants.mjs?v=7")`), which `conductor-12`
already does: rejected — it re-imports the whole module graph per test, which is the cost this change
exists to remove.

### D4 — One injected git gateway; callers receive it

The gateway exposes one operation per git invocation the engine makes, and no module imports it. A
caller is handed the gateway, so the functional half passes the real one and the assertion half
passes a fake by plain injection. The gateway is defined over the 23 measured sites across 7 modules,
and the call-site sweep is re-derived mechanically at apply time (`rg` for git argv), never from the
list in this document — the brief's count (19) and this document's count (23) already disagree, which
is the point of the rule.

*Alternatives considered.* (a) `vi.mock`/`import` interception: unavailable — no runner, no
dependency. (b) Monkey-patching `child_process` in the assertion half: the same global-mutation
failure mode as D1(b), and it would fake git for the whole process, including tests that want the
real thing.

### D5 — The split is by SUBJECT, not by speed

- `scripts/test/assert/` — the per-commit half. One Node process
  (`node --test --test-isolation=none scripts/test/assert/*.test.mjs`). No child process, no git.
- `scripts/test/functional/` — the triggered half. Real git, real spawns, driving the real gateway
  against live repositories created in temp directories.
- `scripts/test/fixtures/` — shared fixture modules and frozen records, outside both halves, so a
  helper edit is neither half's edit and does not trip the twin rule (D6).

The rule for placing an existing test: **if the test's subject is git's behaviour — what a commit
looks like, what a reflog holds, what `is-ancestor` answers, what a worktree lists — it belongs in the
functional half. If git is only the scenery its subject happens to sit in, it belongs in the assertion
half with the fake.** The engine's hook verbs keep one real end-to-end spawn each in the functional
half (`hooks/hooks.json` registers six commands over five verbs: `brief`, `snapshot`, `commit-nudge`
twice, `gate-guard`, `lesson-advice`).

A guard test in the assertion half enforces the property mechanically: it walks `scripts/test/assert/`
and fails, naming the file, when a file spawns a child process or invokes git.

**Every tracked test file has exactly ONE home, and the enumeration covers all of them.** The
enumeration is `git ls-files 'scripts/test/*.test.mjs' 'scripts/test/**/*.test.mjs'` — BOTH arms,
because git's `**` does not match zero directories and the first arm is therefore the only one that
reaches a file sitting directly in `scripts/test/` (verified in a scratch repository: the `**` arm
matched the six nested files and missed the seventh at the top level). Each file enumerated lands in
one of four homes:

| home | what it is | who runs it |
|---|---|---|
| `scripts/test/assert/<id>.test.mjs` | the per-commit half: one process, no spawn, no git | the hook, every commit |
| `scripts/test/functional/<id>.test.mjs` | the triggered half: real git through the real gateway, and the engine's real-spawn end-to-end invocations (the conformance set, the five hook verbs' six registrations in `hooks/hooks.json`) | the functional runner, `node scripts/test/certify.mjs functional`, on the trigger |
| `scripts/test/sweeps/<id>.test.mjs` | **change-triggered, outside both halves**: runs no git and starts no engine, and is too slow to run per commit — today exactly one member, `output-interpolations` | the sweep runner, `node scripts/test/certify.mjs sweeps` (D9/D7), on the `engine-source` trigger |
| explicitly excluded | the drift script's named list, EMPTY today: each entry must say why the file is in neither half, who runs it, and where its result is recorded | whoever the entry names |

The middle two are the ones a two-way vocabulary would lose. **The conformance set and the hook
verbs' end-to-end invocations are functional-half files that run no git**: the functional half is the
half that runs on a trigger and may spawn, so a real-spawn test belongs there whether or not git is
its subject, and each carries its assertion twin like any other functional id. **The sweep is the
reverse case** — no spawn, no git, too slow for the per-commit half — and it is why "outside both
halves" is a home rather than a hole. It is not a third half: it runs on its own trigger, writes its
own record entry, and the twin rule does not reach it (D6's direction is stated over functional ids).

**A tracked test file in none of these is a refusal, not a silence.** There is no orphan today —
the two halves do not exist yet, and every one of the 80 files currently in `scripts/test/` is
classified by 5.3 — but the failure mode is not hypothetical: a test file left in (or added to)
`scripts/test/` is run by neither half's glob and counted by neither half's floor, so the suite would
pass on a subset with nothing to say so. Measured in a scratch repository with six half files and one
leftover at the top level: the two halves ran 15 tests, the floor compared 15 against 15, the hook
exited 0, and the leftover's two tests never ran (D8, check 1).
The assignment of the files that exist today is 5.3's by subject, with three named exceptions whose
home is not a subject judgement: the sweep and its two helper modules (D9, assigned by 6.3), the
conformance set and the hook end-to-end invocations (functional, assigned by 1.1's own move and by
5.5), and the non-test modules in `scripts/test/` — `helpers.mjs`, `hermetic-git.mjs`,
`parity-helpers.mjs`, `inject-state-conflict.cjs`, `fixtures/` — which are outside the enumeration
entirely (it matches `*.test.mjs`) and move to `scripts/test/fixtures/` in 5.1 where they are shared.

### D6 — The twin id is the file's own name, and the diff must carry both halves

A functional test's id is its file's path under `scripts/test/functional/`, without the extension; its
assertion twin is the file of the same name under `scripts/test/assert/`. The id set is derived from
disk, never from a registry, so the pair cannot go stale — the same reasoning the cross-spec-review
gate uses when it enumerates a release's spec set off disk and hashes it.

Two checks, both in the drift script (D8):
1. **Twin coverage, ONE direction** — every functional id has an assertion file of the same id. A
   functional test with no twin is a refusal. **The converse is deliberately NOT a refusal**: an
   assertion-half file with no functional twin is the normal shape for a test whose subject is not
   git's behaviour (D5 places it there precisely because it needs no real git), and requiring a
   functional twin for it would either invent an empty one or force every assertion file into the
   triggered half. The direction that carries the risk is the one that is checked: the functional half
   is the half that can go months unrun, so the fast half is the one that must learn its behaviour.
2. **Diff coupling** — if the staged diff touches one half's file, it must touch the other's.
   `git diff --cached --name-only` supplies the set; a rename carries both paths and passes. This key
   exists only where check 1 does, i.e. on the functional half's ids.

The two checks constrain the MIGRATION too, and the migration's dispositions are stated to agree with
them: a file that lands in the functional half is `paired` (its assertion twin is written in the same
task); a file that stays in the assertion half is `kept whole` (no twin required); a file whose tests
divide between the halves is `split into a pair` and keeps one id on both sides. **A file cannot be
"moved" into the functional half without a twin** — that disposition does not exist, because check 1
would refuse the very commit that created it.

*Why coupling is a refusal rather than a warning.* The functional half does not run on every commit,
so a change that loosens it would be unverified until the trigger fires — which may be months. The
assertion half is what gates each commit, and the coupling is what keeps the fast half aligned with
the slow one. The friction is real and its escape is designed rather than improvised: shared
machinery lives under `scripts/test/fixtures/`, so a helper-only change touches neither half and
trips neither check.

### D7 — Certification is a content hash per module, recorded in the git directory

One dev-only runner — `scripts/test/certify.mjs`, plain Node, no dependency, living in the test tree
and therefore not shipped (D8, D12) — runs a triggered bucket and writes its record entry after a
pass: `node scripts/test/certify.mjs functional` runs `scripts/test/functional/`, and
`node scripts/test/certify.mjs sweeps` runs `scripts/test/sweeps/` and writes the `engine-source`
entry (D9). It is the only record writer there is, so "who produces this entry" has one answer rather
than one per bucket. It writes, after a pass, a machine-readable record keyed by module:

```
{ "<module-id>": { "files": [...], "contentHash": "<hash of those files' bytes>",
                   "covers": ["<functional-id>", ...], "result": "pass",
                   "ranAt": "<iso>", "engineSha": "<informational provenance>", "counts": {…} } }
```

**The freshness test is the CONTENT HASH, not the commit sha.** The brief specified "the functional
suite passed at sha X for module M". A hash is the same idea with one less failure mode: a sha record
has to be checked for ancestry (this engine already carries that machinery, with a three-valued
`isAncestor` whose `null` means "cannot answer"), and it goes stale on a rebase or a cherry-pick that
changed nothing about the module's content. The repository's own prior art is a hash: the
cross-spec-review verdict hashes each spec file it read on disk and goes stale when a reviewed spec is
amended. The sha stays in the record as provenance — it says how the certification was produced, and
nothing gates on it.

The record lives under the git COMMON directory (shared across worktrees), alongside the
`pm-suite.lock` the pre-commit hook already keeps at `$(git rev-parse --git-common-dir)`. Reasons:
it is machine state, not repository content, so committing it would churn a file on every functional
run; worktrees share it exactly as they already share the suite lock; and a fresh clone having no
record is correct behaviour — the first commit touching a certified module demands a run.

Modules in the certified set are the gateway, the modules that invoke it, and the entry point whose
return-status mapping the conformance set pins: `git.mjs`, `created-at.mjs`, `subcommands.mjs`,
`commit-watch.mjs`, `worktree-hygiene.mjs`, `tool-currency.mjs`, `constants.mjs` — **and
`conductor.mjs`**. The task that performs the gateway sweep re-derives the git-side members
mechanically; `conductor.mjs` is not derivable from that sweep and is named here for the opposite
reason: the in-process/CLI status equivalence lives in its dispatch and its tail (`:147`, `:191`,
`:366–383`), so a change there can break the conformance set's subject with nothing in the gateway set
moving. **Which functional ids certify which member is recorded, not implied**: the gateway members are
covered by the gateway operations' functional tests (D4/D5), and `conductor.mjs` is covered by the
CONFORMANCE SET (D10, section 1 of the task list) — its `covers` entry is those ids, so the record for
`conductor.mjs` is satisfied by a conformance run and not by an assertion as a substitute. The
`engine-source` trigger (D9) is a second, disjoint entry covering `conductor.mjs` plus
`scripts/lib/**/*.mjs` for the output sweep; the two entries do not cover each other.

### D8 — The drift script

One dev-only script, plain Node, no dependency, lives with the repository's tooling (not under
`scripts/lib`, so it is not part of the engine and not shipped). It reads files and spawns nothing. It
performs exactly the four checks the capability names:

1. every tracked test file under `scripts/test/` has exactly one home (D5) — in `assert/`, in
   `functional/`, in `sweeps/`, or in the script's named exclusion list, which is empty today. A file
   in none of them is refused by name;
2. every functional id has an assertion twin (D6, one direction only);
3. a staged change to one half carries the other (D6);
4. for every certified module whose files appear in the staged diff, a record exists whose
   `contentHash` equals the hash of those files as staged (D7).

It is not the runner: the runner is `scripts/test/certify.mjs` (D7), which spawns by design and is
what a refusal names.

**It runs in `.githooks/pre-commit` and the HOOK DOES NOT RUN THE FUNCTIONAL HALF.** The script is a
check, not a runner: it reads the record and refuses when the record does not cover the staged
content, naming the module and the command the developer runs to produce one. The ordering follows
from that and is the reason for it: the check runs BEFORE the assertion half, and it cannot be
satisfied by a run that happens later in the same hook, so a hook that also ran the functional half
would either refuse before its own run could write the record or make every commit pay the cost the
trigger exists to avoid. CI is the other half of the answer and is where the functional half actually
runs on the same trigger, with no record present and none substitutable (see D7's risk note).

The hook's existing test-count floor (`grep -Hc '^test('` over the glob, which aborts when the runner
ran fewer tests than are declared) is the defect this check must not reproduce, because after the split
the runner's glob and the floor's glob would be the SAME expression over a set that can silently
shrink. Measured on 0.46.0's hook: with eight test files, four of them moved under
`scripts/test/assert/`, the hook's two lines report `4/4 passing`, `declared=4`, and exit 0 while four
files never ran.

**The floor's invariant, stated once: it compares what the runner RAN against what the runner was
GIVEN, and never against a superset of it.** `declared` is therefore enumerated from the tracked files
OF THE SAME HALF (or halves) the runner is handed in that invocation — the hook passes only
`scripts/test/assert/*.test.mjs` to the runner, so its `declared` is
`git ls-files 'scripts/test/assert/*.test.mjs' | xargs grep -Hc '^test('`, and CI, which runs all
three buckets, enumerates each bucket's own tracked files against that bucket's own run. The two
counts then agree BY CONSTRUCTION on a healthy tree, and disagree only in the direction the floor
exists to catch.

The enumeration is independent of the runner's own glob in the way that matters — it names the
tracked files in the half's DIRECTORY, and does not take the shell's expansion of the pattern the
runner was given — so a glob that stopped matching a directory reports fewer tests than the half
declares and fires. **Enumerating over BOTH halves at once is the shape that must not be written**: it
is a superset of what the hook's runner was given, so it aborts on every commit that has a functional
half at all (reproduced in a scratch repository with three files per half — the assertion runner
reported `total=6` against `declared=15`, and the hook aborted). And the counts are not the whole
guard: a file in NEITHER half is invisible to both sides of this comparison and is check 1's job, not
the floor's — reproduced with six half files and one leftover at the top level, the two halves ran 15
tests, the floor compared 15 against 15, and the hook exited 0 while the leftover's two tests never
ran.

**The re-point and the migration cannot be separated by a commit.** `.githooks/pre-commit:69,81` and
`.github/workflows/ci.yml:32,35` name `scripts/test/*.test.mjs`, which matches nothing under either new
half; the moment the first file leaves that glob the hook's suite is a subset and, with the floor's
`declared` computed from the same glob, the gap is invisible. So the hook's two globs, ci.yml's syntax
loop and suite step, and the first migration of a file out of `scripts/test/*.test.mjs` land in ONE
commit — the re-point cannot be deferred to the drift-script section, and the task list is ordered so
no commit exists between them. The CI workflow gains the same two invocations in that same commit, and
`node --test --test-isolation=none` is verified on the pinned version there (D5's CI risk).

### D9 — A trigger table, not a special case for the output sweep

`scripts/test/output-interpolations.test.mjs` is measured today at 25 scenarios (re-run here:
`node --test scripts/test/output-interpolations.test.mjs` reports `ℹ tests 25`; 19 are top-level
declarations and one of them is a table-driven loop emitting the rest), each re-sweeping 58 source
files — `sweptFiles()` returns 58 — over one sweep: 1,497 interpolations, 479 escaped, 266 literal,
191 sunk, 22 not-output, 539 judged, 0 findings, 6.7 s wall / 1.5 s CPU on a loaded machine.
It certifies a property of the engine's SOURCE and needs no git and no engine call, so it is neither
an assertion test (it is too slow to run every commit) nor a functional test (it runs no git).

**It is the `sweeps` bucket (D5): it moves to `scripts/test/sweeps/output-interpolations.test.mjs`
with its two helper modules (`output-interpolations.mjs`, `output-interpolations.judged.mjs`, which
are not test files and therefore not enumerated), and 6.3 is the task that moves it, names its
runner and writes its record.** Its runner is the same dev-only one every triggered bucket uses —
`node scripts/test/certify.mjs sweeps` (D7), which runs `node --test
scripts/test/sweeps/*.test.mjs` and, on a pass, writes the record entry below. Nothing else about the
record changes: it lives under `$(git rev-parse --git-common-dir)` with the rest of it, and the
refusal that names the missing entry names that command.

Rather than special-case it, the record carries a second kind of entry: a trigger id of
`engine-source`, hashing `scripts/conductor.mjs` plus `scripts/lib/**/*.mjs`. The drift script's
fourth check therefore covers it in exactly the same way, and the script learns no second rule.

*Note on the brief's duration.* The brief cites ~18 s; the suite's own reported `duration_ms` for that
file measured **312 s** here, on a machine at 11% CPU with other work running. The file is 25
whole-source re-sweeps, so its cost scales with load, and both numbers are consistent with the same
code. No decision depends on which figure an idle box produces — the trigger is what matters.

### D10 — The conformance set is written FIRST

A small set of real spawns, each running the engine as a process and pairing it with the same
invocation in-process, asserting the two statuses are equal. Classes, from the engine's own code
paths: success (0), a help token (0), a command-line refusal (1), an unknown verb (1), a write
conflict (9), an unreadable state file (11), an unreadable state file under `gate-guard`/`commit-nudge`
(2), under `brief` (0), a `gate-guard` reconcile block (2), an ambiguous rules block (11), and the
delegated handoff returning the child's status. Roughly 30 spawns covers two or three variants of
each.

This is the risk the brief names: in-process tests stop exercising the real argv string and the real
`process.exit`/stream behaviour, and 0.44.0's Criticals lived in argv parsing. It is written before
the conversion, so the conversion is developed against a red set that tells it what it has broken.

### D11 — The activity log moves from an exit handler into `main()`

`conductor.mjs:268–284` instruments the activity log through `process.on("exit")`, deliberately: the
comment at `:257–260` records that `process.exit()` skips `finally` and runs exit handlers, and one
mutating verb writes state and then exits non-zero, so a `finally` would drop the invocation most
worth recording. Once refusals throw and are caught, that reasoning no longer applies — the throw is
caught at dispatch — so the snapshot moves into `main()`'s own control flow and runs exactly once per
invocation, before `main()` returns. Leaving it as an exit handler would be a defect specific to this
change: in a shared assertion process every call would register another listener, `main()` would
return before the diff ran, and the log would be written once at process end for an unknown number of
invocations.

### D12 — The shipped surface does not move

No verb, flag, status, message or dependency changes. `hooks/hooks.json` and `evals/` keep spawning
the binary as they do now. The engine stays zero-runtime-dependency, and the drift script adds no
development dependency either — `package.json` does not exist in this repository, and the drift
script must not be the reason one appears.

## Risks / Trade-offs

- **A missed `process.exit` site kills the shared assertion process**, and under
  `--test-isolation=none` it takes every remaining test file with it — one forgotten inline exit
  reads as a catastrophic failure rather than as the one refusal it is. → A guard test in the
  assertion half fails when an executable `process.exit(` appears in `scripts/lib` or
  `scripts/conductor.mjs` (the CLI tail uses `process.exitCode`), and the guard is mutation-verified:
  re-introduce one inline exit by hand and confirm the guard, not the suite, is what goes red.
- **The conformance set only proves the classes it enumerates.** A refusal class nobody thought of is
  a class whose in-process status can silently diverge. → The class list is derived from
  `refusal.mjs` plus the executable `process.exit` sites rather than typed from memory, and the task
  states the derivation so the next reader can re-run it.
- **Per-call root touches write paths.** gh#175 is the standing evidence that guarding one tree while
  writing to another fails silently in-process and is invisible to a single-root CLI run. → The
  conversion is task-per-module with the whole suite green between tasks, and the assertion half will
  contain at least one two-roots-in-one-process test from the start.
- **`--test-isolation=none` on CI's Node 18 is unverified.** The flag is present on this machine's
  Node v26.9.0 (probed: `node --test --test-isolation=none <file>` runs one process and reports
  normally). No Node 18 binary exists here and the registry fetch of one failed, so this is stated as
  unverified rather than assumed. → The task that re-points CI verifies it on the CI version and
  either bumps `node-version` or falls back to per-file isolation for CI only. The fallback keeps CI
  correct at the cost of CI time, and the per-commit developer gate — where the saving matters — is
  unaffected.
- **The twin rule's coupling check refuses one-sided edits.** A legitimate change to only the
  functional half — a git-version-driven expectation - is refused until its twin moves too. → This is
  deliberate (D6): the twin is where the fast half learns the same behaviour. Shared machinery under
  `scripts/test/fixtures/` is outside both halves and is not coupled.
- **A certification record is a claim about a run, and a claim can be written by hand.** The record is
  local machine state, so a developer can satisfy the gate by editing it. → Stated rather than
  papered over: the record has the same trust level as the pre-commit hook that reads it, the gate
  keys on content so a stale claim is at least visibly stale, and the backstop is CI running the
  functional half on the same trigger, where the record is absent and cannot be substituted for a run.
- **Source-scanning guards will break under the refactor and must be repaired, not deleted.**
  `conductor-25` reads the dispatch object out of `conductor.mjs` and asserts set-equality with
  `VERB_EFFECTS` using the `}[cmd]` anchor (`:349–380`); `conductor-15`, `conductor-16`,
  `conductor-18`, `conductor-28`, `conductor-31`, `save-report-surface`, `emitted-invocations` and
  `output-interpolations` all read engine source; `conductor-12` cache-busts imports to re-evaluate
  frozen constants, which stops being the mechanism once the root is per-call. Each is re-pointed to
  the new shape in the task that changes what it reads.
- **A meta-guard collides with the split.** `hermetic-git.test.mjs` asserts that every test file
  containing the string `"git"` imports the hermetic module. Assertion-half files will contain that
  string (the fake's canned output is git's output) while never running git. → The guard's predicate
  is narrowed to the halves that can run git, and the narrowing is justified in the test rather than
  applied silently.
- **Test-count floors are load-bearing and easy to leave pointing at a glob that no longer exists.**
  The pre-commit hook treats "the runner ran fewer tests than are declared" as an abort precisely
  because a glob collapse passes silently. Splitting the glob doubles the ways that can happen. →
  The floor is re-derived per half, and a task verifies the guard still fires.
- **The functional half can go months without running** — that is the design's goal, and it is also
  how a suite becomes decorative. → The certification record is what makes the gap visible: a
  certified module whose content changed cannot commit without a run, so the gap is bounded by the
  certified set rather than by attention.

## Migration Plan

Ordered so that every step is independently reversible and the suite is green at each boundary:

1. **Conformance set first** (D10), written against the CURRENT engine and run through the CLI only,
   plus the `process.exit` guard test. Both are red-free additions.
2. **Exit conversion** (D2): `die()`/`CommandExit`, the 194-site sweep, `main()`'s dispatch and
   return, the `process.exitCode` tail. The conformance set goes red the moment a class diverges and
   is the net for this step.
3. **Globals per call** (D3), module by module, with the whole suite green between modules, and the
   activity-log move (D11) in the same step.
4. **The gateway sweep and injection** (D4), then the fake, then the fake-vs-live check.
5. **The split** (D5/D6): create the two directories, migrate tests by subject, add the twin ids, add
   the assertion-half spawn guard. **`.githooks/pre-commit` and `ci.yml` are re-pointed in the same
   commit as the first file that leaves `scripts/test/*.test.mjs`** (D8) — everything before that
   commit still runs correctly against the old glob, and everything after it would not.
6. **The drift script, the record and the sweep bucket** (D7/D8/D9): the runner that writes the
   record, the four checks, the `engine-source` entry, and the move of the sweep into
   `scripts/test/sweeps/` with the runner and the record that make its trigger satisfiable — then the
   remaining place that names the suite command (the `release-checklist` skill, whose Real Numbers
   recipe derives the published test count from it) and the docs that quote it (`CONTRIBUTING.md`,
   this repo's `CLAUDE.md`, the `pr-workflow` skill).
7. **Docs**: README/SKILL if any contributor-facing instruction changes, CHANGELOG, and the
   release-checklist's Real Numbers recipe.

**Rollback.** Steps 1–5 leave the CLI contract untouched, so the engine changes can be reverted
without touching anything a user sees. Steps 6–7 are three files that each name a command; reverting
them restores today's single-glob invocation. The one genuinely forward-only artifact is the
certification record, which is machine state and can be deleted.

## Open Questions

- **The bake-off report is not on disk.** `proposal.md`'s citation of `scratchpad/bakeoff/REPORT.md`
  (and its Vitest rejection) comes from the work order, not from a file this session could read —
  `fd` over `/Users/robsherman` and `/private/tmp` found no such report. Nothing in this design
  depends on it: the design keeps `node:test` either way, and D9's trigger reasoning is measured
  locally. If the report is recoverable it should be committed or dropped from the proposal's
  wording; if it is gone, the proposal's paragraph should say the rejection is reported rather than
  measured here.
- **Whether the assertion half can drop below the measured spawn cost by more than the fake alone
  buys** is untestable until step 5 exists. Not a design input: the split is decided by subject, and
  the speed is the consequence.
