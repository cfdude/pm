# Agent startup — what a dispatched build / test / review agent must obey in this repo

Repo-maintenance file. It is NOT part of what the plugin ships (it lives under `.claude/`, outside the
parity-ledger directories). It replaces "read CLAUDE.md and CONTRIBUTING.md in full": read THIS, then
only the exact files and sections your brief names. Detail lives where each pointer says; nothing here is a
copy of it.

## Before you act

- Read every file from DISK. Your injected context is a snapshot from the parent's session start; the
  parent, other agents and other sessions edit files while you work.
- Never `cd`. Use absolute paths and `git -C <path>`. In a worktree, work only inside it. `core.hooksPath`
  may be an ABSOLUTE path into the main checkout's `.githooks/`, so your commits can run that checkout's
  hooks, not the copy you edited: test hook behaviour through the hook fixtures, not by committing.
- Use `rg` and `fd`, never `grep` or `find`. Full clickable paths in anything you report.

## Never touch the record

- Never edit `.conductor/state.json` or `PROJECT.md`, and run no verb that writes state (`add-epic`,
  `update-epic`, `set-active`, `push-detour`, `pop-detour`, `record-*`, `release`, ...). The orchestrator
  owns all bookkeeping. If an epic needs registering or a commit needs attributing, list it in your report.
- The engine is ZERO-RUNTIME-DEPENDENCY: `scripts/conductor.mjs` and `scripts/lib/*.mjs` use Node built-ins
  only. Add no npm package to it. Do not adopt Vitest or any other runner. (Why:
  `CLAUDE.md` "The `pm` engine — hard constraints".)
- pm is an INSTRUCTION layer: the engine never opens a network connection or calls an external system.
- Never edit between the `<!-- BEGIN pm-conductor rules` and `<!-- END pm-conductor rules -->` markers in
  `CLAUDE.md`; pm regenerates that block.

## Tests — which rung, and what it costs

| a test observes | rung | home | run |
| --- | --- | --- | --- |
| a VALUE the engine produced (a verb's result, a refusal, anything `state.json` holds) | unit | `scripts/test/unit/` | `node --test <file>` |
| BYTES on disk | file | `scripts/test/assert/` | `node --test <file>` |
| real git through the real gateway, or the process boundary | functional | `scripts/test/functional/` | triggered; see certify |
| sweeps over engine source | sweeps | `scripts/test/sweeps/` | triggered; see certify |

- The assertion half (unit + assert) is what every commit runs, in ONE invocation:
  `node --test scripts/test/unit/*.test.mjs scripts/test/assert/*.test.mjs`. Its tests spawn nothing and
  run no git. A unit test is declared with `unitTest()` from `scripts/test/fixtures/unit-harness.mjs`, whose
  guard refuses any filesystem work: a test that needs a path belongs on the file rung. Rung choice and
  the guard: `CONTRIBUTING.md` "Which rung does my new test belong in?" and "What the unit rung's guard
  refuses" (read those two sections only).
- New or changed engine behaviour gets a test. A functional test needs an assertion twin of the SAME id (on
  either rung); the drift script refuses a functional id without one.
- Run only the files you touched while you work. Run the whole assertion half ONCE at the end, plus
  `certify` once for each bucket your staged paths demand. After a fix, re-run only the failed files.
- "Done" means everything passes, including tests you did not write. A pre-existing failure is yours too.

## Flaky tests

- A test listed in `scripts/test/known-flakes.json` is not to be diagnosed. A run that fails is re-run ONCE,
  on the failed files only; pass-on-retry is a pass and is printed as "known flake" (listed) or
  "UNLISTED flake" (not listed). Report every UNLISTED flake you see: it needs an owning epic.
- A test that fails twice is a real failure. Retries are logged to the gitignored `.test-flakes.log`.

## Committing

- Conventional commits, one per logical change: `type(scope): subject`, types `feat|fix|docs|test|chore|refactor`.
  End the message with the `Claude-Session:` footer your brief gives. Never `--no-verify`.
- Hooks live in `.githooks/`. `pre-commit` runs drift's pre-commit phase (enrolment, twin coverage, record
  freshness) then the assertion half. `commit-msg` runs drift's diff-coupling check: a staged functional file
  needs its twin staged in the same commit unless a git TRAILER declares
  `Twin-Unchanged: <id> — <reason>` (put it in the same last paragraph as the `Claude-Session:` line).
- A staged path inside a certify bucket's subject demands a recorded passing run over EXACTLY the staged index.
  Order: stage exactly, `node scripts/test/drift.mjs --phase pre-commit` (it names every demanded bucket
  in one run), then `node scripts/test/certify.mjs functional` and/or `sweeps` (the functional run took
  about 4.5 minutes on 2026-09-30), then commit plainly. Any later edit to a staged subject file makes the
  record stale. `certify` refuses to run while `scripts/test/{certify,certification,drift,js-lexer}.mjs` or
  `scripts/test/fixtures/observe-reads.mjs` differs between the working tree and the index: commit runner
  code before changing the next thing that needs certifying.
- Never edit `CLAUDE.md`, `PROJECT.md` or anything under `.conductor/` while `certify` or a commit hook is
  running: the isolation guard watches those root files and fails every test file running at that moment
  (one `CLAUDE.md` edit turned 14 files red on 2026-09-30). Wait for the run, or edit before it starts.
- Run commands that print a lot with output redirected to a file, then filter when you read it.

## Files that must stay in step

- Every file under `commands/`, `agents/`, `skills/`, `hooks/` and `.claude-plugin/` must be claimed by exactly
  one capability in `docs/parity-ledger.json`, in the same commit. `scripts/test/parity.test.mjs` enforces it.
- A new engine subcommand needs a command doc under `commands/` and tests under `scripts/test/`.
- A user-facing change (a flag, a verb, emitted text, behaviour) needs a changeset fragment
  `.changesets/<epic-id>.md` (format: `commands/changesets.md` and the existing fragments). Do not edit
  `CHANGELOG.md`; the orchestrator consolidates. README and the Mintlify site are the orchestrator's: name
  what changed in your report.
- A rule an agent must follow belongs in a skill or a required task item, not a prose bullet.

## Your report (at most 30 lines; the orchestrator relays the conclusion, not your transcript)

1. Outcome in one line, and the branch name.
2. Commits: `sha subject`, in order, grouped by epic.
3. Tests: counts for the final assertion-half run and each certify run, plus every failure and flake seen.
4. Needs the orchestrator: epics to register, commits to attribute per epic, rule decisions you could not make,
   user-facing docs (README, Mintlify) that need the change, anything you proposed but did not do.
5. Anything you did not do, and why. State what you touched, whether it is committed, and the state you left.

No emojis. Lead with the outcome; no narration of tool use.
