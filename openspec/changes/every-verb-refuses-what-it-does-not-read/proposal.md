## Why

A command line the engine does not read is still acted on. `set-gate-guard off --help` exits 0 and
sets `gateGuard: false` — a help token disarming the safety surface this project calls
unconditional — and `remove-epic e2 --help` exits 0 with `removed 1 epic(s): e2`. The 0.41.0 fix for
cfdude/pm#187 narrowed the help short-circuit to argv position 0/1, which turned "exit 0, writes
nothing" into "exit 0, writes anyway" for every help token after a positional. The same root — no
single place deciding what a verb accepts — lets 38 of the 50 dispatched verbs exit 0 with an
undeclared flag, and drops every stray positional (`add-epic --title My Title` stores `My`).

Reproduced at `dev` 85079e1 in hermetic scratch repos
(`scratchpad/propose/every-verb-refuses-what-it-does-not-read/repro.sh`, output in
`repro-output.txt`; the per-verb sweep is `sweep.mjs` / `sweep-output.txt`):

- **Help after a positional performs the write.** `remove-epic e2 --help` → exit 0, `e2` gone.
  `log-detour x --help` → exit 0, `x --help` appended to the append-only detours.log.
  `set-active e2 -h` → active is `e2`. `set-gate-guard off --help` → `gateGuard: false`.
  `set-activity-log on -h` → enabled. `push-detour p --detour d --reason r --reconcile --help` →
  frame pushed. The sweep appends `--help` after each verb's working invocation: 14 verbs wrote.
- **Undeclared flags are accepted.** Appending `--zzz-bogus` to a working invocation of each of the
  50 dispatched verbs: 38 exit 0, 15 of those having written state.json or detours.log. Only 12
  refuse by name (add-epic, update-epic, release, record-gate-review, record-cross-spec-review,
  triage, verify-specs, claim, unclaim, owners, activity, purge-logs). Consequential instances:
  `record-reconcile p --detour d --verdict invalidated --amendmnts "a;b"` records `invalidated` with
  `amendments: []`; `record-tracker-refresh … --sumary "…"` records a material change with no
  summary; `set-autonomy e1 --levle autonomous` writes `level: off`;
  `set-tracker --system github-issues --repo cfdude/pm --drection outward` stores `inward`;
  `add-many --from batch.json --zzz-bogus` creates the batch, although constants.mjs states add-many
  "refuses everything else". Bare `set-lane-routing` writes `laneRouting: {overrides: []}`.
- **A shared helper reads argv on behalf of whichever verb called it.** `render()` reads
  `--diff-summary` from `process.argv`, so `set-active e2 --diff-summary` prints
  `epic-relevant: yes`; `saveState()` reads `--force` the same way. No verb's surface declares either.
- **Stray positionals are dropped.** `add-epic … --title My Title` and `update-epic e1 --title My
  Title` both store `My`, exit 0. `suggest-lane fix a typo` evaluates `fix` alone and returns
  `{"lane":null}` where the quoted `"fix a typo"` matches `typo`. `remove-epic p --cascade yes`
  refuses with "re-run with --cascade" — the flag the caller just gave.
- **`init` writes before it validates.** `init --platform bogus` in an uninitialised directory prints
  `created .conductor/state.json`, then exits 1 — ending pm's dormancy in that repo. `init
  --platform` with no value exits 0 on the default. `init` is declared FLAGLESS while reading
  `--platform`.
- **update-epic's disposition flags are dropped with a false message.** `update-epic e1 --outcome
  killed --reason no` (no `--status archived`) exits 0 with "nothing changed … every value this
  invocation supplied is already the value the record holds"; `disposition` stays `null`. The sibling
  `--deferral` on the same invocation is refused by name.
- **Help contradicts the hook config.** `brief --help` prints "takes no flags" while
  `hooks/hooks.json` passes `--platform claude-code` to brief, snapshot, commit-nudge, gate-guard and
  lesson-advice.

## What Changes

- ONE pre-dispatch argv check in `scripts/conductor.mjs` binds every dispatched verb, derived from
  the dispatch table, so no verb can opt out by omission and a verb added later is covered.
- A help token (`--help`/`-h`) in any non-value position prints that verb's help, exits 0 and writes
  nothing. In the value position of a value-bearing flag it stays a refusal (the #187 case). **BREAKING**
  for callers relying on a trailing `--help` performing the write.
- Every verb refuses a flag its declared surface does not name, before any write, naming the flag
  and what the verb accepts. **BREAKING** for any caller passing an undeclared flag today.
- Every verb declares its positional arity; a token beyond it — including a value given to a
  valueless flag — is refused by name. A flag spelled like a verb's positional (`remove-epic --id
  e2`) is diagnosed as the positional, generalising update-epic's #71 diagnosis.
- Bare `set-lane-routing` is refused rather than writing an empty overrides block.
- `--platform` is declared on `init` and the five hook verbs and validated before any write; `init`
  validates it before creating `state.json`.
- `--force` is declared as an argv-level flag accepted by every verb declared `mutates` and refused
  on read-only verbs — making `state-write-guard`'s "--force overwrites" true on add-epic, update-epic
  and claim, which refuse it today.
- `update-epic` refuses `--outcome`/`--reason`/`--carried-to` without `--status archived` by name,
  as it already refuses `--deferral`.
- Help is projected from the same declarations the check enforces (flags, positionals, `--force`).

## Capabilities

### New Capabilities
- `verb-surface`: what every dispatched verb accepts on its command line — help tokens, declared
  flags, declared positionals, argv-level flags — and that any refusal on those grounds happens
  before any file is written or created.

### Modified Capabilities
- `epic-annotation`: "Every epic-writing surface rejects what it will not persist" defers its
  flag-shape half to `verb-surface` (removing the double ownership) and gains the case of a flag
  accepted by the verb but not persisted on this invocation — update-epic's disposition flags.

## Impact

- `scripts/conductor.mjs` (help short-circuit, the new pre-dispatch check), `scripts/lib/constants.mjs`
  (positional declarations, argv-level flag declaration, `--platform` rows, `FLAGLESS_VERBS`),
  `scripts/lib/help.mjs`, `scripts/lib/subcommands.mjs` (`init`), `scripts/lib/lane-routing.mjs`,
  `scripts/lib/update-epic.mjs`; the per-verb unknown-flag loops in add-epic, update-epic, releases,
  gate-review-writeback, triage, verify-specs and `requireKnownFlags` callers collapse into the one check.
- Tests: `conductor-31` (dispatch-derived claims, `VERB_BASELINE`), `conductor-35` (help), `conductor-13`
  / `conductor-36` (documented-flag harnesses), `flag-parsing`, `positional-and-help-tokens`, and the
  message-shape assertions in `conductor-05`, `conductor-23`, `conductor-33`, `cross-spec-review`, `triage`.
- Docs: `commands/*.md`, `README.md`, `skills/conductor/SKILL.md`, `hooks/README.md`, `CHANGELOG.md`.
- No state.json schema change, no migration. Engine stays zero-dependency.
- Relates to cfdude/pm#187 (its 0.41.0 fix regressed); supersedes epic `every-verb-validates-its-argv`.
