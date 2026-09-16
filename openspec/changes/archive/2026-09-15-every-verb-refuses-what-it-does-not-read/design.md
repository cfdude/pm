## Context

See proposal.md "Why" for the defects and their repros. The state of the code at `dev` 85079e1:

- **Help** is a pre-dispatch short-circuit in `scripts/conductor.mjs` (`helpAt === 0 || helpAt === 1`).
  Any other help token reaches the verb as data. #187's 0.41.0 fix narrowed it from "anywhere" to
  those two positions; the narrowing is what let a trailing `--help` perform the write.
- **Flag knowledge** is declared once, in `scripts/lib/constants.mjs`: `EPIC_FLAGS` and `VERB_FLAGS`
  (per-verb rows), `FLAGLESS_VERBS`, and the projections `flagsFor`, `cliFlagsFor`,
  `valueBearingFlagsFor`. `conductor-31` asserts every dispatched verb is claimed by exactly one of
  {a flag row, `FLAGLESS_VERBS`}. The declarations are complete; ENFORCEMENT is not. Unknown flags are
  refused by eight hand-placed checks (bespoke loops in add-epic, update-epic, release,
  record-gate-review, record-cross-spec-review, triage, verify-specs; `requireKnownFlags()` in claim,
  unclaim, owners, activity, purge-logs). Every other verb accepts anything.
- **Positionals** are not declared anywhere. Each verb reads `argv[0]`, `argv[3]`, a slice, or a scan,
  and `parseFlags()` silently skips every token it does not consume. `POSITIONAL_USAGE` is prose for
  two verbs.
- **Three shared helpers read `process.argv` directly**, so they act on whichever verb called them:
  `render()` (`--diff-summary`), `saveState()` (`--force`) and `resolveAndRecordPlatform()`
  (`--platform`, reached from `init` and `write-rules`).
- `VERB_EFFECTS` (`scripts/lib/verb-effects.mjs`, no imports) declares `read-only`/`mutates` for every
  dispatched verb; `conductor-25` asserts it is set-equal to the dispatch object.
- The five hook verbs return immediately when `.conductor/state.json` is absent (dormancy), and
  `hooks/hooks.json` passes `--platform claude-code` to each.

## Goals / Non-Goals

**Goals:**
- One enforcement point whose population is the dispatch table, so the rule cannot stop where a
  hand-placed call stops — the shape `docs/lessons/bind-rules-to-functions-not-enumerations.md` argues for.
- Every refusal on command-line grounds precedes every write and every file creation.
- Help and enforcement read the same declarations, so neither can describe a surface the other refuses.

**Non-Goals:**
- Value VOCABULARY checks (`record-reconcile --verdict maybe`, `set-gate-guard maybe`) stay in each
  verb, and verbs that validate no vocabulary today are not given one here. Only `--platform` on the six verbs that newly declare it is added here, because declaring a
  flag without validating it would ship the #152 shape.
- `saveState()`'s treatment of `--force` (what it overrides, how the conflict message mentions it) —
  `state-file-refuses-to-guess` and the planned `code-review-0-43-0-minors` epic own that.
- Removing the argv reads inside `render()` and `saveState()`. Once a verb cannot be invoked with an
  undeclared flag, those reads can only see flags the invoking verb declared; threading them as
  parameters is a refactor this change does not need.
- Any state.json schema change. No migration.

## Decisions

### D1. One pre-dispatch check in conductor.mjs, replacing the help short-circuit

A new leaf module, `scripts/lib/argv-surface.mjs` (imports `constants.mjs` and `verb-effects.mjs`
only, so the pre-dispatch path pulls in no verb module), exports a pure
`checkCommandLine(verb, argv, { initialized }) → { kind: "ok", positionals, canonicalArgv } | { kind:
"help" } | { kind: "refuse", message }`. `initialized` (whether `.conductor/state.json` exists) is an input
so D6's dormancy stays pure and testable; `positionals` feeds D10's joining verbs.
`conductor.mjs` calls it after the self-hosting handoff and BEFORE the root-divergence warning, the
banner and the activity snapshot, and acts on the result (print help and exit 0; print the message and
exit 1; or fall through to dispatch). The existing `helpAt` block is deleted.

The verb population is `Object.keys(VERB_EFFECTS)`, already asserted set-equal to the dispatch object
by `conductor-25`. The flag list the check reads for a verb is `cliFlagsFor(verb)` — never `flagsFor()`,
which for `add-many` answers its batch-document keys.

The activity snapshot's `resolveSession(parseFlags(argv))` (conductor.mjs, pre-dispatch) reads
`--session` off any verb's line. It now runs after the check, so `--session` on a verb that does not
declare it is refused — intended: `PM_SESSION` is the supported way to name the session for the log. An unknown verb keeps today's behaviour (help → global usage, exit 0; otherwise
`USAGE`, exit 1).

*Alternatives.* (a) Call `requireKnownFlags()` at the top of each of the 38 unguarded verbs — rejected:
it is the per-call-site enumeration that produced this defect, and it cannot reach the three shared
helpers' argv reads, which run inside other verbs. (b) Check inside `parseFlags()` — rejected:
`parseFlags` has no verb, and it is also called by `render()` on behalf of other verbs.

### D2. The scan — one token classifier, registry-aware

Walk `argv.slice(3)` left to right with the verb's declarations:

1. A token exactly `--help` or `-h` is a HELP token, tested BEFORE flag classification (`--help` is
   flag-shaped and would otherwise read as an undeclared flag). `--help` immediately following a
   value-bearing declared flag that has no `=` value is a help token in a VALUE position; any other help
   token not consumed as a value is in a NON-VALUE position.
2. Any other token with `isFlagToken()` true is a FLAG. Split with `splitFlagToken()`. If the verb
   declares it value-bearing and it has no `=` value and the next token exists and is not flag-shaped,
   the next token is its VALUE and is consumed — so `-h` there is a value, as today. A VALUELESS
   declared flag never consumes (this is what makes `--cascade yes` a positional — `parseFlags()`
   decides by shape alone and cannot, because it has no verb). An undeclared flag consumes nothing; it
   is refused below. A VALUELESS declared flag written `--name=value` is refused naming the flag: it
   would otherwise be accepted with its value ignored (`--force=1`), or accepted inline where the space
   form is refused (`--cascade=true`).
3. A `--`-leading token that is not flag-shaped (`--Steal`, `--dry_run`, `--story <n> is 1-indexed`) is
   a POSITIONAL only when the verb's `VERB_POSITIONALS` row carries `freeText: true` — `triage`,
   `suggest-lane`, `log-detour`, `honcho-memory` (gh-186's rule). On every other verb it is an
   UNDECLARED FLAG: `parseFlags()`, `positionalArgs()` and the `argv[0]` id guards all skip any
   `--`-leading token as a flag, so reading it as a positional would pass the check while the verb acted
   without it (`claim --repo --session s --Steal` would write the repo claim).
4. Every other unconsumed token is a POSITIONAL.

Decisions in order, first match wins: any help token in a non-value position → `help` (for a hook
verb in a repository without `state.json` too — D6); a hook verb in a repository without `state.json`
→ `ok`, and the verb's own dormancy returns silently; a help token in
a value position → refuse naming the flag and the token (the #187 case, whose wording today comes from
`valuelessFlagError()` and is kept); the first undeclared flag → refuse (D4); positional count above
the verb's maximum → refuse naming the first surplus token; otherwise `ok`.

`-h` directly after a value-bearing flag is that flag's value (step 2), exactly as today.

**Help wins over every other finding on the line.** A caller who typed a help token asked for help;
refusing `remove-epic e2 --bogus --help` for `--bogus` answers a question they did not ask.

*Alternative considered:* refuse a help token after a positional instead of printing help. Rejected:
the command line carries an explicit request, the output is the help text rather than a success line,
and nothing is written, so the #187 silent-success shape (exit 0 that looks like the write happened)
does not arise. The value-position case stays a refusal because there the token was data, not a request.

### D3. Positional arity is declared for every dispatched verb

`constants.mjs` gains `VERB_POSITIONALS`, one entry per dispatched verb: `{ min, max, form, idFirst,
freeText }`. `idFirst: true` marks a verb whose first positional is an epic id (D4 reads the boolean,
never the prose of `form`); `freeText: true` marks the four verbs of D2 step 3. `max` may be `Infinity`
and `form` is the help text (`"<id>"`, `"[<epicId>]"`, `"\"<what you fixed>\""`).
`release` carries two forms keyed by its first positional (`show` → 0..1 further; otherwise exactly 1),
the one verb whose surface branches on a positional. `POSITIONAL_USAGE` stays as the longer prose for
the two verbs that have it.

Provisional table, confirmed against each module in task 1.1:

| arity | verbs |
|---|---|
| 0 | init, render, brief, snapshot, commit-nudge, sync, add-epic, add-many, clear-active, set-tracker, set-lane-routing, set-review-mode, gate-guard, lesson-advice, plan-hierarchy, owners, activity, purge-logs, verify-worktrees, verify-state, verify-specs, integrity, changesets, recover-created-at, unconsidered-outcomes, upgrade, changelog, rules, write-rules, rules-target |
| exactly 1 | update-epic, remove-epic, set-active, suggest-lane, triage, set-autonomy, record-reconcile, record-gate-review, record-cross-spec-review, record-tracker-refresh, push-detour, set-activity-log |
| 0..1 | pop-detour, set-gate-guard, claim, unclaim |
| 1..∞ | log-detour, reorder |
| 3..∞ | honcho-memory |
| branches | release (`show [<id>]` or `<id>`) |

Only the MAXIMUM is enforced centrally. The minimum stays each verb's own refusal, because several
verbs carry a purpose-built message for it (update-epic's #71 diagnosis, `claim --repo`'s alternative
form) that a generic "needs 1 positional" would replace with a worse one. `min` is still declared, so
help can render the form and a later change can enforce it without re-deriving the table.

`VERB_POSITIONALS` is set-equal to the dispatch table (a `conductor-31`-style assertion), so a verb
added later without an entry fails the suite — the spec's "a verb with no declared surface fails".

### D4. The refusal message, and the `--id` diagnosis moves into the check

Unknown flag: `conductor: unknown flag --<name> for <verb> — it accepts: --a, --b, … ` (or `— it
accepts no flags`), then `usage: conductor.mjs <verb> <form> [flags]` when the verb reads
positionals. Chosen because five existing assertions already match `unknown flag --bogus for <verb>`
(conductor-33, flag-parsing) and four more only need the flag and the accepted list (conductor-13 ×2,
conductor-23, triage); one assertion on `unknown flag(s) --reviewr` (cross-spec-review.test.mjs) is
amended in the same commit.

Where `--id` (or `--id=`) is undeclared on the verb, the verb's row carries `idFirst: true`,
and `--id` appears BEFORE any positional, the check consumes `--id`'s value exactly as `update-epic.mjs`
does today (the next token when it is not flag-shaped) — otherwise, under D2 step 2, an undeclared
`--id` consumes nothing and `update-epic --id e1 --priority P1` would read `e1` as the positional and
never diagnose. The message is update-epic's existing #71 text generalised to `<verb>`, including
its rewrite of the line the caller meant (`update-epic e1 --priority P1`; `<id>` when `--id` carried no
value). The rewrite logic moves from `update-epic.mjs` into `argv-surface.mjs` verbatim, so
`flag-parsing.test.mjs`'s two rewrite assertions and `conductor-14`'s "update-epic --id is diagnosed
by name" keep passing; update-epic's copy is deleted in 2.3.

Surplus positional: `conductor: <verb> takes <form> — '<token>' is an extra argument it does not read.
Nothing was written.` plus, when the surplus follows a valueless flag, `--<flag> takes no value`, and
when the verb reads one text positional, a hint to quote it.

### D5. `--force` is one registry row, marked argv-level, whose commands are derived

`VERB_FLAGS` gains `{ flag: "force", valueless: true, argvLevel: true, commands: <every VERB_EFFECTS
key whose effect is "mutates"> }`, computed at module load (`verb-effects.mjs` has no imports, so no
cycle). It is a row, not a second list, because `epic-annotation` requires one shared allowlist with no
parallel list for a subset of flags; a separate "argv-level flags" table would be exactly that list for
add-epic and update-epic. `argvLevel: true` means: the flag belongs to the save layer, not to the verb's
parser. The checks written for per-verb parser flags filter `argvLevel` rows out: `conductor-31`'s
"every VERB_FLAGS command has a baseline", the `withFlags` set of its "claimed exactly once" check, and
its closed list of valueless rows (with a separate assertion that the argvLevel rows are exactly
`force`), and its "every VERB_FLAGS baseline actually succeeds" loop; and `conductor-36`'s two
registry-to-`epic.md` checks. `conductor-13`'s harness reads the docs, not the registry, so it needs no
filter while 5.1 keeps `--force` out of update-epic's exercised section. That carve-out is stated in the `epic-annotation` delta.

**Scope: every `mutates` verb, not "every verb that reaches `saveState()`".** The latter is not
declared anywhere: `render()` heals through `saveHookHeal()`, so nearly every mutating verb reaches the
save, and deriving the exact set would mean parsing call graphs. Measured consequence: on a mutating
verb that never saves state.json — `honcho-memory` and `purge-logs`, to be confirmed in task 4.1 —
`--force` is accepted and does nothing. That is the one place this change accepts a flag a verb does
not read, stated rather than hidden; the alternative (refusing `--force` on a verb that CAN hit a
conflict) would break the documented escape hatch, which `state-write-guard` requires to work.

Read-only verbs refuse `--force`: there is no write to force, and accepting it would tell the caller
something happened.

*Alternative:* declare `--force` nowhere and let the check refuse it everywhere — rejected, it makes
`state-write-guard`'s "--force overwrites" requirement false on every verb.

### D6. `--platform` on init and the five hook verbs; hooks stay dormant

`VERB_FLAGS`' existing `--platform` row grows to `init`, `brief`, `snapshot`, `commit-nudge`,
`gate-guard`, `lesson-advice`; those six leave `FLAGLESS_VERBS`. Each validates it with
`requireFlagValues()` and `assertKnownPlatform()` before anything else — `init` before
`saveState(defaultState())`, which is the ordering defect.

Hook verbs keep dormancy for refusals: when `state.json` is absent, the check returns `ok` instead of
any refusal for the five hook verbs — identified by a `hook: true` marker on their `VERB_EFFECTS`
entries, asserted set-equal to the verbs `hooks/hooks.json` invokes — and the verb returns silently as
today. A help token in a non-value position is decided FIRST, so `brief --help` and `gate-guard --help`
still print help in an uninitialized repository, as they do today. The carve-out lands in the same
commit as the undeclared-flag refusal (task 2.2), because that commit alone would otherwise make
`brief --bogus` print an error in every project on the machine. The plugin's hooks run in every project on the machine, and a
mismatched hook line must not print an error into projects that never ran `/pm:init`.

*Alternative:* stop passing `--platform` to hook verbs. Rejected: the platform-aware design
(`docs/superpowers/specs/2026-07-29-platform-aware-rules-block-design.md`) makes each platform's hook
config declare it, and an installed plugin's `hooks.json` reaches a checkout engine under
`PM_ENGINE_DELEGATION`, so removing it would break that pairing in one direction or the other.

### D7. update-epic's disposition flags join the existing not-archiving refusal

The block at `update-epic.mjs` that refuses `--deferral`/`--declined-deferral`/`--no-deferrals` without
`--status archived` grows to `--outcome`, `--reason`, `--carried-to`. Same message, same position
(before `loadState()`). `--correct-disposition` already has its own refusal and is not moved.

### D8. Bare set-lane-routing refuses

When none of `--add`, `--remove`, `--clear` is given, `setLaneRouting()` exits 1 naming the three,
before `loadState()`. A read form (the `set-gate-guard` #159 precedent) was considered and deferred —
it is new behaviour with its own output contract, and the defect is only the write.

### D9. Help reads the same declarations

`verbHelp()` prints `VERB_POSITIONALS[verb].form` on its first line, lists `cliFlagsFor(verb)` (which
now includes `--force` on mutating verbs and `--platform` on the six), and says "takes no flags" only
when that list is empty. A verb in `FLAGLESS_VERBS` that accepts `--force` — `set-active`, `log-detour`
and the other mutating flagless verbs — renders "no flags of its own" and then the argv-level flag, so
`FLAGLESS_VERBS` keeps meaning "its parser reads no flags" and help never claims a verb refuses a flag
it accepts. `conductor-35`'s "no verb's help advertises a flag that verb refuses" then
covers the new rows with no new test code.

### D10. Verbs never see an argv-level flag as a positional

`log-detour` joins `argv.slice(3)`, `honcho-memory` joins its tail, and most verbs read their id as
`argv[0]` only when it does not start with `--`. So `log-detour fixed it --force` would log
`fixed it --force`, and `set-active --force e2` would print usage. On `ok`, `conductor.mjs` rewrites
`process.argv` into canonical order from the check's classification: the verb, then the positionals in
their original order, then every flag with its value, argv-level flags last. Every `argv[0]`/`argv[3]`
reader then sees its positional first, and `saveState()`'s `process.argv.includes("--force")` still
sees `--force` — `saveState()` is not edited. The two verbs that JOIN positionals read the positional
list the check exported instead of the argv tail, so a trailing flag never enters the text.

Reordering cannot re-pair a flag with a value: a positional is by definition a token no declared flag
consumed, and a flag moves together with its value. Flags keep their relative order — `--attribute-commit`
order decides which sha is last attributed and so the Gate 2 endpoint — and only argv-level flags move
behind the rest. D2 step 3 is what makes "every `argv[0]` reader sees its positional first" true: no
`--`-leading token reaches a non-free-text verb as a positional.

`release show` keeps its own refusal: `releaseShow()` refuses any `--` token in its tail ("the READ form
takes no flags"), so `release show --force` stays refused. D5 is not contradicted — the check accepts
`--force` on the verb `release`, and the verb's read form declines it, as a verb may refuse a declared
flag on a form that cannot use it.

*Alternative:* strip `--force` from `process.argv` and pass it to `saveState()` another way — rejected:
that edits `saveState()`, which `state-file-refuses-to-guess` owns.

## Risks / Trade-offs

- **[BREAKING for scripts]** A caller passing an undeclared flag or an unquoted multi-word value now
  fails, and so does `remove-epic <id> --cascade true`, which today's `cascade === "true"` accepts and
  which is now a surplus positional after a valueless flag. `/pm:upgrade` rewrites the rules block, so
  repos pick up any emitted line 4.1 corrects. → That caller was already getting a wrong record; the refusal names the token and, for text,
  says to quote it. CHANGELOG states it under BREAKING.
- **[gate-guard fails open on a refused command line]** In an initialized repo, a `gate-guard` hook
  line the engine refuses exits 1, which Claude Code treats as a non-blocking hook error: that tool call
  is not guarded. Exit 2 would block every tool call in every session until the plugin is fixed.
  → Within one plugin version it needs pm's own `hooks/hooks.json` to disagree with its own engine, and
  task 2.5 asserts every hook command line in that file passes the check. Under `PM_ENGINE_DELEGATION`
  an installed plugin's `hooks.json` reaches a checkout engine of a different version, so a mismatch
  there is possible and shows as a visible hook error on each tool call rather than a silent pass. Named for
  `gates-bind-to-verified-evidence` below.
- **[stdin not drained on refusal]** `gate-guard` and `lesson-advice` drain stdin first so the hook
  writer is not left holding a pipe; a pre-dispatch refusal exits before that. → For a verb marked
  `hook: true` the refusal path drains stdin before writing its message. Task 2.2 guards it with a
  payload above the pipe buffer (at least 128 KB); a small payload (421 bytes, 0 of 20 runs) does not
  reproduce an EPIPE, so no RED is claimed for it.
- **[inert --force on two verbs]** See D5.
- **[help wins]** `remove-epic e2 --help` exits 0. A script checking only the exit code sees success
  with nothing removed. → The output is help text, not the success line; D2 records why a refusal was
  not chosen.
- **[emitted command lines]** pm emits invocations in the rules block, command docs and SKILL.md. Any
  that passes an undeclared flag or an unquoted multi-word value becomes a refusal. → Task 4.1 sweeps
  every emitted invocation mechanically; a broken one is fixed in the same commit as the check.

## Migration Plan

No state migration. Release note under BREAKING. Rollback is reverting the change's commits; the
declarations added in section 1 are inert without the check.

## Coordination

- **Applied first.** `state-file-refuses-to-guess` and `gates-bind-to-verified-evidence` apply after
  this lands and re-derive line anchors in `conductor.mjs`, `constants.mjs`, `update-epic.mjs` and
  `subcommands.mjs` (`init`).
- **state-file-refuses-to-guess** owns `saveState()`. D10 REORDERS `process.argv` and keeps `--force` in
  it — it does not strip argv-level flags — so `saveState()`'s argv read keeps working unedited. This change decides only the registry side of
  `--force` (D5): one `argvLevel` row on every `mutates` verb. If that change threads `force` as a
  parameter, renames the flag or removes the escape hatch, it edits or removes that ONE row in the same
  commit — removal is the inverse of D5 and must not leave the row claiming a surface. It also rewrites
  `init`'s first write and the rules-block writer; `init`'s platform validation (D6) must stay ahead of
  both. The pre-dispatch check runs before `loadState()`, so an unparseable state.json never affects a
  command-line refusal.
- **state-file-refuses-to-guess, hooks.** Its hook exit-code mapping should select hook verbs by this
  change's `hook: true` marker on `VERB_EFFECTS`, not by a list of verb names. It also edits the top of
  `gateGuardCheck()`, where task 1.2 places the `--platform` check after `readStdin()`; whichever
  applies second keeps both.
- **gates-bind-to-verified-evidence** touches record-reconcile, record-gate-review and
  `--attribute-commit`. Any flag it adds must be a registry row, or the check refuses it; any positional
  it adds must update `VERB_POSITIONALS`. If it changes gate-guard's failure posture, D6's
  refused-command-line exit (1, non-blocking) is the case to reconcile with.
- **code-review-0-43-0-minors** (planned epic): its "--force described as working on every verb but
  refused by allowlists" item is resolved on the registry side here; "unmentioned in the conflict
  message" stays there. Its "help omits positional id" item is resolved by D9.
