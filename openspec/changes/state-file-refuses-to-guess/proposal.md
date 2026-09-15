## Why

Four places in the engine meet input they cannot read and **guess** instead of refusing, and each guess
destroys or hides the record it was handed. All four were reproduced against the 0.43.0 engine in
hermetic scratch repositories (`scratchpad/propose/state-file-refuses-to-guess/r1*`–`r4*`, each
`git init` + `conductor.mjs init`):

- **An unparseable `state.json` loads as an empty record.** Three epics, a git conflict-marker line
  prepended: `add-epic --id new` exits 0 and the file afterwards holds only `["new"]` at revision 1.
  A truncated file (first 40 bytes) is wiped the same way by `sync`, `upgrade` and `init`, each
  exiting 0. `gate-guard` with an epic owing a reconcile exits 2 on the clean file and **0** on the
  same file with a conflict marker — the unconditional reconcile block fails open; with `epics: {}`
  it crashes with `TypeError: state.epics.find is not a function` (exit 1, which Claude Code treats
  as allow). `brief` briefs the empty guess into the session as if it were the record.
- **Concurrent saves lose updates and report success.** The revision check and the rename are not one
  critical section. 16 parallel `add-epic` in a fresh repo, three runs: 9, 9 and 8 invocations
  printed `added epic` and exited 0, while 7, 6 and 6 epics were on disk. Run 3 also crashed one
  writer with `StatePersistError … at revision 9 (disk revision 9)` — two writers published the same
  revision. This breaks `state-write-guard`'s own "a write built on a superseded revision is refused".
- **`claim --ttl 1e12` persists a claim no reader can read.** The claim is written, then the verb
  crashes with `RangeError: Invalid time value` (exit 1). From then on `owners`, `integrity`,
  `claim` by another session (with or without `--steal`) and `unclaim --steal` all crash the same
  way. `claim --repo --ttl 1e12` poisons `.conductor/session-claim.json` identically. Only the
  holder's own `unclaim` escapes, because its session check short-circuits before the expiry is read.
- **`write-rules` deletes hand-written `CLAUDE.md` content and prints `refreshed`.** Markers are
  matched as substrings: a prose line mentioning `<!-- BEGIN pm-conductor rules` above a hand-written
  section above the real block → exit 0, `refreshed`, the hand-written section gone. A deleted END
  line appends a second block and the next refresh swallows the text between them. Two blocks → only
  the first is ever refreshed. ``set-tracker --system github-issues --repo 'o/n$`'`` splices the
  file's own prefix into the block (a sentinel line present once is present three times afterwards),
  because the replacement is a string and `` $` `` is a substitution pattern. A CRLF file gets an LF
  block (3 CRLF lines of 380 afterwards).

A conflicted `state.json` after a merge is ordinary in a repository that tracks it, and 0.44.0 is the
release that closes the seven Criticals the 0.43.0 review found. These are four of them.

## What Changes

- **An unreadable state file is refused, never replaced.** An ABSENT `state.json` stays legal
  (dormancy before `/pm:init`, and `init` itself). A PRESENT file that cannot be read, does not parse,
  or has the wrong shape makes every verb that reads state refuse: name the file and the reason, write
  nothing, exit with a dedicated non-zero code. `--force` does not override it.
- **Hooks never write over an unreadable state file**, and each reports it on the channel its event
  can act on: `gate-guard` (PreToolUse) blocks with exit 2 and names a Bash-reachable remedy; `brief`
  (SessionStart) exits 0 and delivers the warning as the session context in place of a guessed brief;
  `snapshot` (PreCompact) writes nothing and never exits 2, because exit 2 there blocks compaction;
  `commit-nudge` (PostToolUse) writes nothing.
- **State saves are serialised by an exclusive lock file** held from the revision check through the
  rename and read-back, with the temp file flushed before the rename. A lock whose holder is gone is
  broken (holder pid not alive on this host, or lock older than a fixed age); a live one is waited for
  briefly and then the save is refused with the existing conflict exit code — never a lost update.
  **This reverses a documented 0.26.0 decision** ("a lockfile was rejected because a session killed
  mid-write leaves the lock held forever"); the stale-break rule is the answer to that objection.
- **An advisory claim's TTL is bounded at input** (`claim`, `claim --repo`), and a claim already on
  disk whose expiry is unrepresentable or above the bound reads as EXPIRED — never live, never a crash.
- **The managed rules block is located by whole-line markers and written literally.** Exactly one
  BEGIN/END line pair → replaced in place, every byte outside it unchanged; no markers → appended;
  any other arrangement → refused naming the file and every marker's line number, rules file
  untouched, verb exits non-zero. Line endings follow the file's.

## Capabilities

### New Capabilities
- `managed-rules-block`: how the engine locates, replaces and refuses to replace its managed block
  inside a human-owned rules file (`CLAUDE.md`, `AGENTS.md`, `HERMES.md`). No existing capability
  owns the WRITER — every existing "rules block" requirement is about what the block SAYS.

### Modified Capabilities
- `state-write-guard`: the superseded-revision requirement gains serialisation and durability
  (MODIFIED); ADDED requirements for the lock's break rule, refusing an unreadable state file, and
  hook behaviour on one.
- `conductor-record`: ADDED requirement bounding advisory-claim lifetime and pinning that an
  unreadable expiry reads as expired; MODIFIED detached-HEAD requirement, whose table claims to
  enumerate every `.conductor/` write site and must settle the new lock file against its criterion.

## Impact

- Code: `scripts/lib/state.mjs` (strict load, lock, fsync), `scripts/lib/gate-guard.mjs`,
  `scripts/lib/subcommands.mjs` (`brief`, `snapshot`, `commit-nudge`, `init`, `ensureGitignore`),
  `scripts/lib/claim-shape.mjs`, `scripts/lib/claims.mjs`, `scripts/lib/rules.mjs` (`writeRules`),
  `scripts/lib/constants.mjs` (exit code, TTL bound, lock timings), `scripts/conductor.mjs` (error →
  exit-code mapping). Zero dependencies preserved.
- Tests: new RED/GREEN pairs per requirement; `scripts/test/conductor-33.test.mjs`'s gh-111 test
  asserting `owners` still answers on an unparseable file asserts the behaviour this change removes
  and is rewritten.
- State schema: unchanged; no MIGRATIONS entry. `.gitignore` gains `.conductor/state.json.lock` via
  `ensureGitignore()`, which `upgrade` already re-runs.
- Behaviour visible to users: a repository with a damaged `state.json` stops working until it is
  fixed (by design); Edit/Write/NotebookEdit are blocked there until then. Coordinated with
  `every-verb-refuses-what-it-does-not-read` (owns `--force`'s flag registration) and
  `gates-bind-to-verified-evidence` (also edits `gate-guard.mjs`).
