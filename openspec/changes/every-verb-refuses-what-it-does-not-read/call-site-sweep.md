# Call-site sweep — every-verb-refuses-what-it-does-not-read

Required task items 1 and 2 (tasks 4.1, 4.2, 4.3). Every list below was derived with `rg` from the tree
at `f11e055` (the last section-3 commit), not from design.md. Line numbers are at that commit.

**This change adds no `state.json` field**, so there are no data references (a writer, a reader and a
remover of a stored id) to sweep. The DATA references that do exist are the command lines pm emits —
swept in §4.

## 1. The rule, and where it binds

The rule: a command line carrying a token the verb does not read — an undeclared flag, a surplus
positional, a help token (which is honoured instead), an inline value on a valueless flag — is decided
ONCE, before dispatch, in `checkCommandLine()` (`scripts/lib/argv-surface.mjs`), called from exactly one
place: `scripts/conductor.mjs:167`. Its population is `VERB_EFFECTS` (asserted set-equal to the
dispatch table by conductor-25) and `VERB_POSITIONALS` (asserted set-equal by verb-surface.test.mjs),
so there is no per-verb call site to miss: the only way for a verb to escape is not to be dispatched.

## 2. `process.argv` readers

`rg -n "process\.argv" scripts/conductor.mjs scripts/lib` (comments excluded):

| Site | Reads | Holds? |
|---|---|---|
| `conductor.mjs:143` | `argv[2]`, the verb | Yes — the input to the check. |
| `conductor.mjs:161` | `helpAt` | Unknown verbs only — today's behaviour kept (help first → global usage). |
| `conductor.mjs:167,185` | the check and the canonical rewrite | The rule itself. |
| `conductor.mjs:260` | activity snapshot `parseFlags(...)` → `--session` | Holds: runs after the check, so `--session` reaches it only on a verb that declares it (claim, unclaim). Elsewhere it is refused; `PM_SESSION` is the supported channel (D1). |
| `conductor.mjs:324,327` (`rules`), `337` (`write-rules`), `347-348` (`rules-target`) | `--epic`, `--platform` | Holds: all declared rows. |
| `platform.mjs:100` `resolveAndRecordPlatform()` | `--platform` on behalf of `init` and `write-rules` | Holds: `--platform` is declared on both; `init` validates it first (`requirePlatformFlag`, 1.2) so this read never meets an unvalidated value before a write. |
| `state.mjs:263` `saveState()` | `process.argv.includes("--force")` on behalf of every saving verb | Holds: `--force` is the `argvLevel` row, accepted on every `mutates` verb and refused on read-only ones; D10's rewrite keeps it in argv, so this read is unedited (state-file-refuses-to-guess owns it). |
| `render.mjs:289` `render()` | `--diff-summary` on behalf of any verb that renders | Holds: declared only on `render`; on any other verb it is refused before `render()` can see it (`set-active e2 --diff-summary` no longer prints `epic-relevant`). Threading it as a parameter was declined (Non-Goals). |
| `self-hosting.mjs:112` | `argv.slice(2)` to hand off | Runs BEFORE the check by design (the delegated child owns the whole invocation and runs its own check). |
| `subcommands.mjs:28` `checkedPositionals()` | the check's positional list, for `log-detour` and `honcho-memory` | Holds: the two JOINING verbs read classified positionals, never the argv tail (D10). |
| `active-pointer.mjs:69`, `reconciler-writeback.mjs:14`, `autonomy.mjs:40`, `gate-review-writeback.mjs:20`, `detour-stack.mjs:67,170`, `update-epic.mjs:173`, `remove-epic.mjs:30`, `releases.mjs:91,429`, `tracker-refresh-writeback.mjs:26` | `argv[0]` as the id when not `--`-leading, then `parseFlags(argv.slice(1))` | Holds: the canonical rewrite puts positionals first, and D2 step 3 guarantees no `--`-leading token reaches a non-free-text verb as a positional. |
| `gate-guard.mjs:17` (`set-gate-guard`), `activity-log.mjs:63` (`set-activity-log`), `lane-routing.mjs:101` (`suggest-lane`), `triage.mjs:154` | `argv[3]` | Holds, canonical order. **Behaviour change outside the spec's scenarios:** a positional written after flags is now read (`triage --limit 3 "ask"` answers where it printed usage). gh-186's guard still holds — `triage --limit 5` has no positional, so `argv[3]` is `--limit` and `isFlagToken` refuses. |
| `rank.mjs:61` (`reorder`) | every non-`--` token | Holds: no declared flag of its own consumes a value; `--force` is filtered. |
| `claims.mjs:131,215` | `positionalArgs(argv)` | Holds (see §3). |
| `changelog.mjs:12`, `tracker.mjs:20`, `verify-specs.mjs:307`, `review-mode.mjs:20`, `add-epic.mjs:134,256,342`, `claims.mjs:349`, `purge-logs.mjs:108`, `activity-report.mjs:279`, `add-many.mjs:23`, `lane-routing.mjs:33` | `parseFlags(argv)` | Holds: arity 0 verbs; every flag reaching them is declared. |

## 3. Shared helpers

| Helper | Call sites (`rg -n "<name>\("`) | Holds? |
|---|---|---|
| `parseFlags(` | 28 sites (listed in §2) | Unchanged; the check decides what reaches it. It still decides by SHAPE (no verb), which is why `--cascade yes` could not be caught here and is caught by the check. |
| `requireFlagValues(` | 26 sites: every verb with a value-bearing flag, plus `requirePlatformFlag()` | Holds — the VALUE half of the flag rule stays per verb (Non-Goal); the check never enforces value presence, so conductor-31's `--<flag> requires` sweep keeps its wording. |
| `requireKnownFlags(` | **none** — deleted in 2.3 with every per-verb unknown-flag loop (add-epic, update-epic, release, record-cross-spec-review, record-gate-review, triage, verify-specs; claim, unclaim, owners, activity, purge-logs) | Replaced by the one check. `UPDATE_EPIC_FLAGS` survives as an export because conductor-13 reads it; `RELEASE_FLAGS`, `CROSS_SPEC_FLAGS`, `TRIAGE_FLAGS`, `VERIFY_SPECS_FLAGS` had no remaining reader and were deleted. |
| `positionalArgs(` | `claims.mjs:140,222` | Holds. It skips every `--`-leading token, which is exactly why D2 step 3 refuses `--Steal` on claim/unclaim instead of reading it as a positional. |
| `isFlagToken(` / `splitFlagToken(` | `argv-surface.mjs:66-80`, `add-epic.mjs:59,63`, `claims.mjs:277-278`, `platform.mjs:31,35`, `update-epic.mjs:103-104` (`echoedTokens`), `triage.mjs:165` | Holds — one shape predicate for every scanner. |
| `escapeControls(` (hoisted from archive-gate.mjs to constants.mjs) | `argv-surface.mjs:139,171,175,198,202` (inline-valueless, surplus + its quote hint, the `--id` rewrite, unknown flag), `constants.mjs:1021,1023` (`flagInValuePositionMessage`, so `valuelessFlagError()` too), `update-epic.mjs:124,132,227`, `archive-gate.mjs:144,390`, `integrity.mjs:186,317` | Holds at every refusal this change added or reworded: a caller token carrying a newline is shown escaped and cannot start a line of its own. Deliberately NOT applied to `usage:` and the accepted-flag list — both are projected from the registry, never caller text. |
| `assertKnownPlatform(` / `platformFlag(` | `conductor.mjs:327-328,348-349`, `platform.mjs:100-101`, `add-epic.mjs:136-137` (`requirePlatformFlag`) | Holds: every verb that declares `--platform` validates it before a write — `rules`, `rules-target`, `write-rules` (via `resolveAndRecordPlatform`), `init` and the five hook verbs (via `requirePlatformFlag`, after their dormancy return; in gate-guard, lesson-advice and commit-nudge after `readStdin()`). |

## 4. Declarations and projections

| Declaration | Readers | Holds? |
|---|---|---|
| `VERB_POSITIONALS` | `argv-surface.mjs` (classify, arityFor, messages), `help.mjs:39` | Set-equal to the dispatch table (test). `idFirst` is false on `release`, `record-cross-spec-review` (release ids) and `honcho-memory` (action first): the `--id` diagnosis says "epic id" and would be wrong there. |
| `FLAGLESS_VERBS` | `help.mjs:45` | Keeps meaning "its parser reads no flags". conductor-31's claimed-once check filters `argvLevel` rows so a flagless mutating verb stays here. |
| `POSITIONAL_USAGE` | `help.mjs:46,87` | Kept as the longer prose for `set-gate-guard` and `release`. |
| `VERB_EFFECTS` + `hook: true` | `argv-surface.mjs:123,130` (dormancy), `conductor.mjs:177` (stdin drain on refusal), `conductor.mjs:212,222` (warnings), `constants.mjs:827` (`--force` row) | Marked set asserted equal to the verbs `hooks/hooks.json` invokes. state-file-refuses-to-guess's hook exit-code mapping should select hook verbs by this marker, not by names. |
| `argvLevel` | `argv-surface.mjs:32,70,153` (canonical order), `constants.mjs:1170` (`flagSpecsFor`), `help.mjs:41-42` | Tests written for per-verb PARSER flags filter it: conductor-31 ×4, conductor-36 ×2. |
| `cliFlagsFor()` | `argv-surface.mjs:25,199`, `constants.mjs:1163` | THE projection the check and help read — never `flagsFor()`, which for add-many answers batch keys. |
| `flagsFor()` | `constants.mjs:1144` only (inside `cliFlagsFor`) | Its allowlist consumers (`requireKnownFlags`) are gone. |
| `epicFlagsFor()` | `update-epic.mjs:29` only | The per-verb allowlists that used it are gone. |
| `valueBearingFlagsFor()` | `add-epic.mjs:98` (`valuelessFlagError`) | For add-many it still includes batch-key rows; harmless, because the check refuses those keys on the command line before this runs. |

## 5. Emitted command lines (the data references)

Every engine invocation pm emits was extracted and run through `checkCommandLine()`: `commands/*.md`,
`skills/**/SKILL.md`, `README.md`, `hooks/hooks.json`, the rules block rendered on all three platforms
(`rules --platform claude-code|hermes|codex`), and the invocation strings printed from `scripts/lib`
(remedies in `integrity.mjs`, `archive-gate.mjs`, `briefing.mjs`, `update-epic.mjs`, `rules.mjs`, …).
487 lines; placeholders filled, shell continuations joined. `hooks/hooks.json` is the only hook
configuration in the repository (`rg -l -e "--platform"`); `evals/fixtures.py` and `evals/observe.py`
invoke the engine too (`init`, `add-epic` with declared flags, `rules-target`, `write-rules --platform`)
and all pass.

Result after 2.4: **no emitted line needed correcting.** Every refusal the extractor reported is one of:
- a deliberate WRONG-invocation example in prose (`activity --bogus`, `set-activity-log --on`,
  `add-many --from b.json --zzz`, `update-epic --id my-epic …`, `claim --repo --session s --Steal`);
- extractor noise: prose that begins with a verb name ("integrity check", "release the dedup key"),
  `…` and markdown `\|` placeholders, `(--reconcile | --no-reconcile)` alternatives, JS string
  concatenation around a template literal.

Limits stated rather than hidden: the extractor is lexical. It checks one invocation per match, and a
line whose flags only appear on a later, non-continued line is checked without them.

Existing TESTS that passed an unread token (not emitted lines, but the same class) were corrected in
the commit that made them refuse: `reorder e1 --before e2` (conductor-33), `log-detour --minimal …`
×4 (conductor-27, detached-suppression), `--reason=--x` on a regression-refused call
(archive-gate-order 3.10). None was a registry gap — each flag was never read by its verb.

## 6. Where the rule deliberately does not hold

1. **Minimum positionals** stay each verb's own refusal (D3): update-epic's no-id diagnosis, `claim`'s
   two forms, `push-detour`'s `--reason "<why>"` usage carry better messages than a generic count.
2. **Value vocabulary** (`--verdict maybe`, `set-gate-guard maybe`) stays in each verb (Non-Goal).
3. **`--force` is accepted and inert** on the mutating verbs whose writes never reach `saveState()`:
   confirmed for `honcho-memory` (appends `.conductor/honcho-memories.log` only) and `purge-logs`
   (removes log files; `rg -c "saveState|render\("` = 0). Accepted because deriving "reaches the save"
   would mean parsing call graphs (D5).
4. **A dormant hook verb** (no `state.json`) refuses nothing — help is still printed (D6).
5. **An unknown verb** keeps today's path (help first → usage, exit 0; otherwise USAGE, exit 1).
6. **`release show --force`** is accepted by the check on the verb and refused by `releaseShow()`'s own
   "READ form takes no flags" (D10).
7. **A refused hook line in an initialized repo exits 1**, which Claude Code treats as a non-blocking
   hook error, so that tool call is unguarded (design.md Risks). Task 2.5's guard asserts pm's own
   `hooks/hooks.json` passes the check; under `PM_ENGINE_DELEGATION` a version-skewed pair can still
   mismatch — named for gates-bind-to-verified-evidence.

## 7. Inverse of every operation (task 4.2)

| Operation shipped | Inverse | Shipped? Why |
|---|---|---|
| Declare a flag on a verb (a registry row) | Remove the row | No verb needed: removal is an edit, and its effect is that callers are refused by name — loud, not silent. |
| The `--force` argvLevel row (D5) | Its removal by state-file-refuses-to-guess if it threads/renames/removes the escape hatch | Not here: that change owns `saveState()`. It must edit or remove that ONE row in the same commit (design.md Coordination), or the row claims a surface that no longer exists. |
| A hook verb declaring `--platform` | `hooks/hooks.json` no longer passing it | Both directions asserted by 2.5: every flag a hook line passes is declared, and every `hook: true` verb's line passes `--platform`. |
| Bare `set-lane-routing` refused | A read form | Declined (D8): new behaviour with its own output contract; the defect was only the write. Recorded as 6.2's declined deferral. |
| Help printed after a positional | — | None: a read writes nothing, so there is nothing to undo. |
| update-epic's disposition flags refused without `--status archived` | Accepting them (a non-archiving disposition write) | Not shipped: that is the silent drop being removed. The correction path for a recorded disposition is `--correct-disposition` at the archive, unchanged. |
| The canonical argv rewrite (D10) | — | None needed: it reorders only across the positional/flag boundary and keeps flag order, so no flag is re-paired with a value. |

## 8. Verify against the commit (task 4.3 — sections 1–4 so far)

Each task commit's `git show --stat` was checked at the moment it landed; every file the task claims is
present and no source file shows `Bin`.

| Commit | Task | Files in the commit |
|---|---|---|
| `0ff3b7f` | 1.1 | constants.mjs, verb-surface.test.mjs, red-1.1.txt, tasks.md |
| `82c2a74` | 1.2 | constants.mjs, verb-effects.mjs, add-epic.mjs, subcommands.mjs, gate-guard.mjs, lessons.mjs, conductor-31, conductor-35, verb-surface.test.mjs, red-1.2.txt, tasks.md |
| `7c622e4` | 1.3 | constants.mjs, conductor-31, conductor-35, conductor-36, verb-surface.test.mjs, red-1.3.txt, tasks.md |
| `2d77a5b` | 2.1 | argv-surface.mjs (new), conductor.mjs, constants.mjs, add-epic.mjs, verb-surface.test.mjs, red-2.1.txt, tasks.md |
| `d07c895` | 2.2 | argv-surface.mjs, conductor.mjs, verb-surface.test.mjs, cross-spec-review.test, conductor-33, conductor-27, detached-suppression.test, red-2.2.txt, tasks.md |
| `47cafb7` | 2.3 | add-epic, update-epic, releases, gate-review-writeback, triage, verify-specs, claims, activity-report, purge-logs, constants, verb-surface.test.mjs, red-2.3.txt, tasks.md |
| `5a382dd` | 2.4 | argv-surface.mjs, conductor.mjs, subcommands.mjs, flag-parsing.test, verb-surface.test.mjs, red-2.4.txt, tasks.md |
| `6b42bb4` | 2.5 | verb-surface.test.mjs, tasks.md |
| `3b57b03` | 3.1 | lane-routing.mjs, verb-surface.test.mjs, red-3.1.txt, tasks.md |
| `6b4be32` | 3.2 | update-epic.mjs, archive-gate-order.test, verb-surface.test.mjs, red-3.2.txt, tasks.md |
| `f11e055` | 3.3 | help.mjs, constants.mjs, verb-surface.test.mjs, red-3.3.txt, tasks.md |

No file under `commands/`, `agents/`, `skills/`, `hooks/` or `.claude-plugin/` was added, so
`docs/parity-ledger.json` needed no edit.
