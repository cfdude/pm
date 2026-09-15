## 0. Before any code

- [x] 0.1 **Gate 1** — two fresh-context reviewers with different lenses (spec testability and
      cross-capability consistency; implementation feasibility against `scripts/conductor.mjs`,
      `scripts/lib/constants.mjs` and the four harnesses named in design.md) over these artifacts BY
      PATH. Fix Critical and Important, re-run `openspec validate every-verb-refuses-what-it-does-not-read
      --strict`, then record each pass:
      `record-gate-review every-verb-refuses-what-it-does-not-read --gate 1 --verdict pass --reviewer "<identity>"
      --artifact openspec/changes/every-verb-refuses-what-it-does-not-read/proposal.md
      --artifact openspec/changes/every-verb-refuses-what-it-does-not-read/design.md
      --artifact openspec/changes/every-verb-refuses-what-it-does-not-read/tasks.md
      --artifact openspec/changes/every-verb-refuses-what-it-does-not-read/specs/verb-surface/spec.md
      --artifact openspec/changes/every-verb-refuses-what-it-does-not-read/specs/epic-annotation/spec.md`
- [x] 0.2 **Cross-spec review** (required task item 5) — release 0.44.0 holds this change's two spec
      files plus those of `state-file-refuses-to-guess` and `gates-bind-to-verified-evidence`. Run the
      `cross-spec-review` skill over the release's whole spec set after all three pass Gate 1, and again
      after any concurrent amendment; record with
      `record-cross-spec-review 0.44.0 --verdict pass|fail --reviewer "<identity>"`

**TDD convention for sections 1–3.** The pre-commit hook runs the whole suite, so every RED test lands
in the SAME commit as its GREEN. Before writing the GREEN code, run the new test against the unchanged
engine and save the failing output in this change directory as `red-<task>.txt` (e.g. `red-2.1.txt`);
the GREEN commit message names that file. A REGRESSION GUARD passes when written and says so in its
commit message. New tests go in `scripts/test/verb-surface.test.mjs` unless a task names a file.
Every refusal test asserts the refusal's CAUSE text (not only a non-zero exit) and that
`.conductor/state.json`, `.conductor/detours.log`, `PROJECT.md` and `CLAUDE.md` are byte-identical.

## 1. Declarations — inert until section 2 enforces them

- [x] 1.1 RED then GREEN: a test asserting `VERB_POSITIONALS` (constants.mjs) is set-equal to the
      dispatch table read from `conductor.mjs` (reader duplicated from `conductor-31`, as that file's
      comment prescribes) and that every entry has integer `min`, `max` ≥ `min` (or `Infinity`) and a
      non-empty `form`, with `release`'s two forms, and that `freeText: true` is carried by exactly
      `triage`, `suggest-lane`, `log-detour` and `honcho-memory` and `idFirst` is a boolean on every row. GREEN adds the table. Confirm each verb's arity
      against its own module (`rg -n "process\.argv|argv\[0\]|positionalArgs" scripts/lib/<module>`)
      rather than copying design.md D3, and correct D3's table in the same commit where they differ
- [x] 1.2 RED then GREEN: `--platform` on `init` and the five hook verbs. RED: add `VERB_BASELINE`
      entries in `conductor-31` for `init`, `brief`, `snapshot`, `commit-nudge`, `gate-guard`,
      `lesson-advice` (each `<verb> --platform claude-code`), which makes its valueless-flag sweep run
      `init --platform` and `brief --platform` and fail; plus the spec scenarios "init with an unknown
      platform creates nothing", "init with a valueless platform is refused before it creates anything"
      (both in a fresh git repo, asserting no `.conductor/`, `CLAUDE.md`, `PROJECT.md`, `.gitignore`),
      "A hook verb refuses an unknown platform", and "A hook verb's help names the flag its hook passes"
      (`verbHelp()` projects `cliFlagsFor()`, so it turns green with the row, not in 3.3). GREEN: grow the `--platform` row, remove the six
      from `FLAGLESS_VERBS`, call `requireFlagValues()` and `assertKnownPlatform()` as `init`'s first
      statements (before `saveState(defaultState())`) and in each hook verb immediately after its
      dormancy return — in `gateGuardCheck()` and `lessonAdvice()` after their `readStdin()`, so a
      refused hook line still drains the payload; add `hook: true` to the five hook verbs' `VERB_EFFECTS` entries with a test that
      the marked set equals the verbs `hooks/hooks.json` invokes. The SAME commit swaps `snapshot` out of
      `conductor-35`'s "help declares a flagless verb explicitly" fixture (it is no longer flagless) for a
      read-only flagless verb such as `verify-worktrees`
- [ ] 1.3 RED then GREEN: `--force` as one `argvLevel` row. RED: a test that `cliFlagsFor(v)` includes
      `force` for every `VERB_EFFECTS` verb whose effect is `mutates` and for no `read-only` verb, and that
      the `argvLevel` rows are exactly `force`; "A mutating verb's help names --force" (`add-epic --help`);
      and `claim e1 --session s --force` / `unclaim e1 --session s --force` not refused as carrying an
      undeclared flag (their `requireKnownFlags()` reads the registry union, so the row alone admits it). GREEN: the `VERB_FLAGS` row with `commands` derived from
      `VERB_EFFECTS` (design.md D5); replace constants.mjs's "NOT DECLARED, deliberately: `--force`…"
      comment. The SAME commit filters `argvLevel` rows out of every check written for per-verb parser
      flags, or the hook's suite run fails: `conductor-31`'s "every VERB_FLAGS command has a baseline",
      its "every VERB_FLAGS baseline actually succeeds" loop (otherwise `VERB_BASELINE["log-detour"]` is
      undefined and throws), the `withFlags` set of its "claimed … exactly once" check (a flagless mutating
      verb stays in `FLAGLESS_VERBS`), and its closed deepEqual of valueless rows ("VERB_FLAGS' valueless
      rows are a short closed list"); and `conductor-36`'s two registry-to-`commands/epic.md` checks.
      `conductor-13`'s harness reads the docs, not the registry, and needs no filter. It adds NO `--force` text to `commands/epic.md` (docs land in
      5.1, outside update-epic's exercised section). It swaps `set-active` out of
      `conductor-35`'s flagless-help fixture for `verify-state`, because `verbHelp()` now lists `--force`
      for it. `add-epic --force` is still refused by add-epic's own allowlist until 2.3

## 2. The pre-dispatch check

- [ ] 2.1 RED then GREEN: help tokens. Unit tests of `checkCommandLine()` in the new leaf module
      `scripts/lib/argv-surface.mjs` for D2's classifier (a help token is recognised before a token is
      classified as a flag; a value-bearing declared flag consumes a non-flag-shaped next token, so `-h`
      there is its value; `--help` directly after a value-bearing flag that took no value is a
      value-position help token; a valueless flag never consumes; a `--`-leading non-flag-shaped token is
      a positional), then the subprocess scenarios "A trailing help token does not remove an epic",
      "…does not append to the detour log", "…does not disarm the gate guard", "A short help token after a
      positional does not move the active pointer". GREEN: the module (imports `constants.mjs` and
      `verb-effects.mjs` only — assert that with a source read), wired into `conductor.mjs` after the
      self-hosting handoff and before the root-divergence warning, replacing the `helpAt` block. At this
      commit the check returns only `help`, a value-position refusal, or `ok`. REGRESSION GUARDS in the
      same commit: "A help token in a value position is still refused", "A help token first after the verb
      is still that verb's help", "A hook verb's help still works without pm" (`brief --help` and
      `gate-guard --help` in a repo with no `.conductor/`), and `positional-and-help-tokens.test.mjs` and
      `conductor-35`'s help sweep passing
- [ ] 2.2 RED then GREEN: undeclared flags on every dispatched verb, with hook dormancy. RED: a
      `DISPATCH_BASELINE` table with a working invocation for EVERY verb in `VERB_EFFECTS` (completeness
      asserted against the dispatch table; reuse `scratchpad/propose/every-verb-refuses-what-it-does-not-read/sweep.mjs`'s
      fixtures), first asserted to EXIT 0 on its own (a separate test, as `conductor-31` does for
      `VERB_BASELINE`, so a broken fixture cannot read as a refusal — `verify-state`, declared
      `expectsFailure`, is asserted by its own non-drift exit instead), then each run with
      `--zzz-undeclared` appended and asserted refused by the refusal's CAUSE text naming the flag — never
      by exit code alone — with nothing written; plus "A typo'd flag on the reconcile write-back records
      nothing", "A typo'd autonomy flag writes no autonomy block", "A read-only verb refuses an undeclared
      flag", "A read-only verb refuses --force" (`integrity --force`), "A batch key is not a command-line
      flag", "An id given as a flag is diagnosed as the positional" (`remove-epic --id e2`). GREEN: the
      undeclared-flag decision reading `cliFlagsFor(verb)` with D4's message; the `--id` diagnosis MOVED
      from `update-epic.mjs` into the check, consuming `--id`'s value when it precedes any positional (D4),
      so `flag-parsing.test.mjs`'s rewrite assertions and `conductor-14`'s "update-epic --id is diagnosed
      by name" keep passing; the hook-verb dormancy carve-out (D6) — refusals suppressed when `state.json`
      is absent, help still printed; and the stdin drain on a hook verb's refusal path. REGRESSION GUARDS
      in the same commit: "A hook verb stays dormant in a repository without pm" (`brief --bogus` and the
      other four), and `gate-guard --bogus` in an initialized repo with a PreToolUse payload of at least
      128 KB on stdin exits 1 naming `--bogus` with no EPIPE reported by the writer (no RED is claimed: a
      421-byte payload did not reproduce one in 20 runs). Amend every assertion on the old `unknown
      flag(s)` shape, found with `rg -n -F "unknown flag(s)" scripts/test`. Where an existing test passes a
      flag the registry does not declare and expects success, that is a registry gap: declare the row,
      never loosen the check — list each in the commit message
- [ ] 2.3 RED then GREEN: `--force` reaches the verbs that still carry their own allowlists. RED (written
      against the tree after 2.2, where those allowlists still refuse it): "--force is not refused on a
      mutating verb that validates its own flags" for `add-epic`, and the same assertion — not refused as
      carrying an undeclared flag; nothing about the forced write itself, which `state-write-guard` owns —
      for `update-epic e1 --title x --force`, `release r1 --intent x --force`,
      `record-gate-review e1 --gate 2 --verdict fail --force` and `record-cross-spec-review <rel> …
      --force` (claim and unclaim already pass at 1.3). GREEN: delete the per-verb
      unknown-flag checks — the loops in `add-epic.mjs`, `update-epic.mjs` (with its `--id` block),
      `releases.mjs` (`release`, `record-cross-spec-review`), `gate-review-writeback.mjs`, `triage.mjs`,
      `verify-specs.mjs`, and the `requireKnownFlags()` calls in `claims.mjs`, `activity-report.mjs`,
      `purge-logs.mjs`, enumerated with `rg -n "unknown flag|requireKnownFlags\(" scripts/lib` at the time.
      Delete `requireKnownFlags` and the `*_FLAGS` allowlist constants only where `rg` finds no remaining
      reader. Correct the constants.mjs comment claiming add-many "refuses everything else" and
      `requireKnownFlags`' "only the three verbs…" comment
- [ ] 2.4 RED then GREEN: surplus positionals and canonical argv. (Gate 1 round 3: this commit also updates
      `scripts/test/flag-parsing.test.mjs` `owners --json=x`, whose cause-text regex the inline-value
      refusal no longer matches, and amends 2.1's unit test, which classified a non-flag-shaped `--` token as
      a positional on every verb.) RED: every `DISPATCH_BASELINE`
      invocation of a verb with a finite `max` gets `zzzstray` appended and is asserted refused by cause
      text naming it (not by exit code alone) with nothing written; plus "An unquoted multi-word title is
      refused, not truncated", "The same truncation is refused on update", "A verb that reads one text
      positional refuses a second", "A value given to a valueless flag is refused by name", "An inline
      value on a valueless flag is refused" (plus `add-epic --id f1 --lane claude-code --force=1`), "A
      dash-leading token that is not a flag is refused where no free text is read" (`claim --repo
      --session s --Steal`, and `unclaim e1 --session s --Steal`), "A verb that takes no positionals
      refuses one", "--force does not leak into a joined text" (`log-detour fixed it
      --force`, and `honcho-memory push e1 why --force` printing `why`), "--force before a positional does
      not displace it" (`set-active --force e2`, `set-gate-guard --force off`); `release show --force` is
      not a case here — `releaseShow()` keeps its own "READ form takes no flags" refusal (design.md D10).
      GREEN: D2's maximum check, step 3's `freeText` rule, the inline-value refusal, and D4's surplus
      message; D10's canonical
      rewrite of `process.argv`, and `logDetour()`/`honchoMemory()` joining the check's exported positional
      list. REGRESSION GUARDS: "A verb that joins its positionals still accepts many", "A dash-leading text
      positional is still a positional", and `flag-parsing.test.mjs`'s `claim e1 --session "--weird session
      name"` round trip
- [ ] 2.5 REGRESSION GUARD: "A hook verb accepts its hook configuration's command line" — read every
      `command` from `hooks/hooks.json` at test time, substitute `${CLAUDE_PLUGIN_ROOT}`, run each in an
      initialized repo with a payload on stdin, assert none is refused; and assert both directions of 4.2's
      inverse (every flag a hook line passes is declared for that verb; every `hook: true` verb's hook line
      passes `--platform`)

## 3. Verb-specific refusals and help

- [ ] 3.1 RED then GREEN: "A bare set-lane-routing leaves the record unchanged" — GREEN refuses in
      `setLaneRouting()` before `loadState()`, naming `--add`, `--remove`, `--clear` (D8). REGRESSION
      GUARD: `conductor-08`'s "--clear empties the overrides list" still passes
- [ ] 3.2 RED then GREEN: "An outcome without an archive is refused by name" and "A handoff target
      without an archive is refused by name" — GREEN adds `outcome`, `reason`, `carried-to` to the
      not-archiving refusal in `update-epic.mjs` (D7). REGRESSION GUARD: "The disposition flags still
      record at the archive", plus `conductor-13`'s `--outcome`/`--reason`/`--carried-to` exercise entries
      and `conductor-36`'s "a deferral flag without archiving is REFUSED" unchanged
- [ ] 3.3 RED then GREEN: `remove-epic --help`'s first line naming `<id>`, and `set-active --help`
      stating it has no flags of its own before listing `--force`. GREEN: `verbHelp()` prints
      `VERB_POSITIONALS[verb].form`, says "takes no flags" only when `cliFlagsFor(verb)` is empty, and
      for a `FLAGLESS_VERBS` verb that accepts `--force` says it has no flags of its own before listing
      the argv-level flag (D9).
      REGRESSION GUARDS (green since 1.2/1.3): "A hook verb's help names the flag its hook passes", "A
      mutating verb's help names --force", "A read-only verb's help does not offer --force", and `conductor-35`'s "no
      verb's help advertises a flag that verb's parser refuses" and "help declares a flagless verb
      explicitly" passing

## 4. Required task items

- [ ] 4.1 **Call-site completeness sweep** (item 1) — derive with `rg` from the tree at sweep time, never
      from design.md, and record the result in `call-site-sweep.md` in this change directory. Sweep:
      every `process.argv` reader in `scripts/conductor.mjs` and `scripts/lib/` (including `render()`'s
      `--diff-summary`, `saveState()`'s `--force`, `platformFlag()`/`resolveAndRecordPlatform()`, the
      activity snapshot's `parseFlags`, and each verb's `argv[0]`/`argv[3]`/slice read); `parseFlags(`,
      `requireFlagValues(`, `requireKnownFlags(`, `positionalArgs(`, `isFlagToken(`, `splitFlagToken(`,
      `assertKnownPlatform(`; the declarations `FLAGLESS_VERBS`, `POSITIONAL_USAGE`, `VERB_POSITIONALS`,
      `VERB_EFFECTS` and its `hook` marker, `argvLevel`; the projections `flagsFor`, `cliFlagsFor`,
      `epicFlagsFor`, `valueBearingFlagsFor`. For each: where the rule holds, where it does not, and why.
      DATA references — the command lines pm EMITS are call sites of the check: extract every engine
      invocation from `scripts/lib/rules.mjs`'s rules block (all platforms), `commands/*.md`,
      `skills/**/SKILL.md`, `README.md` and `hooks/hooks.json` (plus any other platform's hook config
      `rg -n -- "--platform"` finds), fill placeholders, run each through `checkCommandLine()`, and fix
      every refused line in the commit that fixes it. Include the invocation strings the engine prints from
      `scripts/lib` — remedies and instructions in `integrity.mjs`, `archive-gate.mjs`, `briefing.mjs`,
      `update-epic.mjs` and any other module `rg -n "update-epic |add-epic |record-[a-z-]+ |set-[a-z-]+ "
      scripts/lib` finds. This change adds no state.json field, and `call-site-sweep.md` says so
- [ ] 4.2 **Inverse of every operation** (item 1) — enumerate and justify each unshipped inverse:
      declaring a flag on a verb ⇄ removing its row (removal refuses callers; no verb needed); the
      `--force` row ⇄ its removal by `state-file-refuses-to-guess` (design.md Coordination); a hook verb
      declaring `--platform` ⇄ `hooks/hooks.json` no longer passing it (2.5 asserts both directions); bare `set-lane-routing` refused ⇄ a read form (declined, D8); help printed
      after a positional ⇄ no inverse (a read)
- [ ] 4.3 **Verify against the commit** (item 2) — for every task commit run `git show --stat <sha>` and
      assert each file the task claims to change appears in it; a claimed file absent from its commit
      fails the task even when the working tree and suite are right
- [ ] 4.4 **Attribute every commit** (item 4) at the moment it lands:
      `update-epic every-verb-refuses-what-it-does-not-read --attribute-commit <sha>`, in landing order.
      The commit moving `openspec/changes/every-verb-refuses-what-it-does-not-read/` under `archive/`
      is NOT attributed
- [ ] 4.5 **Declare lifecycle bookkeeping** (item 3) — confirm the marker sits on
      the task lines of 4.6 and 6.2 and on no delivery task
- [ ] 4.6 **Dispositions** (item 6) <!-- pm:lifecycle --> — the archive invocation is 6.2's; add a
      `--deferral "<epicId>:<section>"` for any follow-up registered while the work ran, and never replace
      the declines with `--no-deferrals`
- [ ] 4.7 **Route what the work taught** (item 7) — name each as practice, friction or process failure.
      Candidates to evaluate, not presumptions: a PROCESS lesson in `docs/lessons/` — narrowing a guard's
      trigger (#187's 0.41.0 fix) must re-test the population the guard protected, evidence: 14 verbs
      performed their write on a trailing `--help` (proposal.md); a PRACTICE — enforcement bound to the
      dispatch table rather than placed per verb; FRICTION — any emitted command 4.1 finds refused, filed
      with `/pm:feedback bug "<summary>"`

## 5. Docs — after Gate 2 is clean

- [ ] 5.1 `commands/*.md`: every command doc that shows an invocation — the help-token rule, quoting
      multi-word values, `--force` on mutating verbs (in `commands/epic.md`, as a note on every mutating
      verb OUTSIDE update-epic's own section, which `conductor-13` exercises); `commands/epic.md` update-epic section names the
      disposition flags' not-archiving refusal; `commands/lane-routing.md` the bare refusal; each hook
      verb's `--platform` where a doc covers it. Plus `hooks/README.md`
- [ ] 5.2 `README.md`: the command reference and a BREAKING note for undeclared flags and surplus
      positionals
- [ ] 5.3 `skills/conductor/SKILL.md`: wherever it teaches an engine invocation or `--help`
- [ ] 5.4 `CHANGELOG.md` `[Unreleased]`: the BREAKING entries, cfdude/pm#187's 0.41.0 regression fixed
      (closing the issue belongs to the release cut), `init`'s ordering fix, `--force` now reachable on
      add-epic/update-epic/claim, and the BREAKING cases design.md Risks names (`--cascade true`); note that
      `/pm:upgrade` rewrites the rules block, so each repo picks up corrected emitted lines only when it
      runs. Mintlify sync belongs to the release cut, not this change
- [ ] 5.5 Re-record Gate 2 over the docs commits — 4.4 attributes them, which moves the last attributed
      commit past 6.1's recorded `--head-sha` and would make the verdict stale at the archive gate. Have a
      fresh-context reviewer read the docs-only delta (`git diff <6.1 head>..<last attributed>`), then
      re-run 6.1's `record-gate-review … --gate 2` with the SAME `--base-sha` and `--head-sha <last
      attributed>`. Never withdraw an attribution to make the range fit

## 6. Gate 2 and archive

- [ ] 6.1 **Gate 2** — two fresh-context reviewers with different lenses (spec alignment and real tests;
      the call-site sweep and error/edge handling) over `git diff <base>..<head>`, where `<base>` is the
      parent of the first attributed commit and `<head>` the last attributed. Fix Critical and Important,
      re-attribute fix commits, then record each pass:
      `record-gate-review every-verb-refuses-what-it-does-not-read --gate 2 --verdict pass --reviewer "<identity>"
      --base-sha <parent of first attributed> --head-sha <last attributed>`
- [ ] 6.2 Archive the change <!-- pm:lifecycle --> — `/opsx:archive every-verb-refuses-what-it-does-not-read`,
      then `update-epic every-verb-refuses-what-it-does-not-read --status archived --outcome delivered
      --declined-deferral "a read form for bare set-lane-routing::new behaviour with its own output contract; the defect was only the write"
      --declined-deferral "refusing --force on mutating verbs that never save state.json::no declaration names that set, and deriving it from call graphs is unverifiable"
      --declined-deferral "threading render and saveState argv reads as parameters::once the check refuses undeclared flags they can only see flags the invoking verb declared"`
      (plus any `--deferral` from 4.6)
