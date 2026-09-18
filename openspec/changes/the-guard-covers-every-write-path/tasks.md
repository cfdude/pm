## 0. Before any code

- [x] 0.1 Gate 1 — two fresh-context lenses over these artifacts BY PATH (lens A: correctness and
      testability of every WHEN/THEN against today's 0.45.0 engine, each RED scenario reproduced in a
      hermetic scratch repo; lens B: absent edits — every site asserting in prose that Bash is not
      matched, every call site of the guard's messages, the inverses the specs do not name); fix every
      Critical and Important, re-validate with
      `openspec validate the-guard-covers-every-write-path --strict`, then record
      `record-gate-review the-guard-covers-every-write-path --gate 1 --verdict pass --reviewer "<identity>"
      --artifact openspec/changes/the-guard-covers-every-write-path/proposal.md --artifact
      openspec/changes/the-guard-covers-every-write-path/design.md --artifact
      openspec/changes/the-guard-covers-every-write-path/tasks.md --artifact
      openspec/changes/the-guard-covers-every-write-path/specs/gate-integrity/spec.md --artifact
      openspec/changes/the-guard-covers-every-write-path/specs/state-write-guard/spec.md --artifact
      openspec/changes/the-guard-covers-every-write-path/specs/tracker-sync/spec.md --artifact
      openspec/changes/the-guard-covers-every-write-path/specs/managed-rules-block/spec.md`
- [x] 0.2 **Cross-spec review** (required task item 5) — release 0.46.0 holds this change's four spec
      files — `gate-integrity`, `state-write-guard`, `tracker-sync` and `managed-rules-block` — and the
      sibling `operations-ship-their-inverses`'s, which is more than two counted flat.
      Run the `cross-spec-review` skill after both changes pass Gate 1 and again after any later round
      of concurrent amendment; record
      `record-cross-spec-review 0.46.0 --verdict pass|fail --reviewer "<identity>"`

## 1. The write-shape scanner

The pre-commit hook runs the whole suite, so every RED test lands in the SAME commit as the GREEN
task that turns it green; pairs are named per section. Before that commit, the failing run against
the pre-GREEN engine is saved in this change directory as `red-<task>.txt`, and the GREEN commit
message names that file. New test file: `scripts/test/gate-guard-write-paths.test.mjs`. Fixture
repos are created under the OS temp dir by the existing test helpers, never inside the checkout.

Pairs: 1.1 and 1.1b land with 1.2.

- [x] 1.1 RED: a table-driven test of the exported write-shape function over the closed list and the
      exclusions in design D2 — blocks `cat > src/x.js <<EOF`, `printf x >> f`, `sed -i '' s/a/b/ f.js`,
      `tee -a notes.txt`, `cp a b`, `git apply p.patch`, `awk '{print}' f > out.txt`, the both-streams
      and no-clobber redirections `cmd &> out.txt`, `cmd &>> out.txt`, `cmd >| out.txt` and
      `node --test >& out.txt`, and
      the multi-digit fd redirections `cmd 10>out.txt`, `exec 10>lockfile` and `cmd 12>>out.txt`,
      the long in-place spellings `sed --in-place s/a/b/ f.js` and `sed --in-place=.bak s/a/b/ f.js`,
      and every spelling of the record `rm .conductor/state.json`, `rm -rf .conductor/*`,
      `rm '.conductor/state.json'`, an ABSOLUTE path to the same record, and the TRAILING GLOBS
      `rm -rf .conductor/state.json*` and `rm -rf .conductor*` (each names the record among its
      expansions — the written-argument discriminator in design D2; the first fix matched the
      quoted, absolute and `/*` forms while letting these through); allows `rg foo 2>/dev/null`, `cmd >&2`, `cmd >&-`,
      `cmd > /dev/null 2>&1`,
      `node --test 2>&1 | tail`, `git status --short`, `diff <(a) <(b)`,
      `for f in *; do echo $f; done`, `curl -s url | jq .`, the arrow cases `rg 'foo->bar' src/` and
      `git log --format='%h -> %s'`, the lock remedy `rm .conductor/state.json.lock` with and without quotes,
      `rm -rf .conductorish`, the lock-ONLY glob `rm .conductor/state.json.*` (it cannot expand to the
      record, so it stays the runnable glob spelling for lock cleanup),
      the multi-digit fd DUPLICATION `cmd 10>&1`, and each engine
      invocation the guard's messages name as the way through, in BOTH spellings pm emits
      (`node "${CLAUDE_PLUGIN_ROOT}/…/conductor.mjs" <verb>` and `node "$ENGINE" <verb>`). Assert the RETURN VALUE is a fixed
      label from the closed list, and that for a target path carrying an unusual character sequence
      it contains neither that sequence nor the target path (a "no substring of the input"
      assertion is unsatisfiable: a single character of the command is a substring). Fails today: the function does not exist
- [x] 1.1b RED + MUTATION (pairs with 1.2) — the engine-invocation exemption's ONLY falsifiable
      surface. Assert the EXPORTED predicate directly: true for `node "${CLAUDE_PLUGIN_ROOT}/…/
      conductor.mjs" <verb>` and `node "$ENGINE" <verb>`, false for a runtime given an inline
      script, a test flag, or no verb. Then run the mutation: with the predicate deleted the test
      fails. Record in the Gate 2 report that deleting the CALL SITE alone is NOT detectable and
      why — no command-word row is reachable from a `node`-led segment (the arm reads the leading
      word, always the runtime) — which is the structural fact and forward commitment the
      `gate-integrity` delta carries. Fails today: the predicate returns false for both spellings
      pm emits
- [x] 1.2 GREEN: add the scanner to `scripts/lib/gate-guard.mjs` as one exported function returning
      the matched shape's fixed label or null — the single site design D2's closed list lives at, and
      the label is the only thing a caller may print. The engine-invocation PREDICATE is exported
      beside it (the `gate-integrity` delta requires it, and 1.1b is why: it is the exemption's only
      falsifiable surface); those two are the module's whole new surface. The redirection arm runs per segment, and the
      engine-invocation exemption covers the command-word arm only. Node built-ins only; no new
      dependency, per the engine's hard constraints
- [x] 1.3 REGRESSION GUARD: a source scan asserting the shape list is defined once and not duplicated
      into a second site, so a future shape is added in one place

## 2. The guard reads its payload

Pairs: 2.1 lands with 2.2; 2.3 with 2.4; 2.5 with 2.6; 2.7 with 2.8.

- [x] 2.1 RED: with `p` owing a reconcile, the hook fed `{"tool_name":"Bash","tool_input":{"command":
      "cat > src/x.js <<EOF..."}}` exits 2 and names the matched shape. Fails today: it exits 2 with a
      message naming no shape, and — the defect — the matcher never delivers the call at all
- [x] 2.2 GREEN: parse the drained payload, take `tool_name`, and for `Bash` block the reconcile
      branch only on a matched shape (design D3)
- [x] 2.3 RED: same state, payload `{"tool_name":"Bash","tool_input":{"command":"rg foo 2>/dev/null"}}`
      exits 0 and prints nothing. Fails today: exits 2, because `tool_input` is discarded
- [x] 2.4 GREEN: the allow path for an affirmed Bash call matching no shape
- [x] 2.5 RED: the unreadable-state exemption — over a `state.json` carrying a conflict marker, the
      hook fed a Bash payload for EACH remedy command the unreadable-state message prints, including
      `git show <rev>:.conductor/state.json > .conductor/state.json`, exits 0 and writes nothing.
      Fails today: exits 2 (reproduced on 0.45.0; see proposal.md — Why)
- [x] 2.6 GREEN: take the Bash exemption BEFORE the state load, local to `gateGuardCheck` (design D4).
      `refusalFor()` and its unit test at `scripts/test/state-file-refuses-to-guess.test.mjs:273` are
      NOT touched
- [x] 2.7 RED: the tracker-refresh arm — with `set-gate-guard on` and a refresh owed, a Bash write
      shape exits 2 and a non-write exits 0; with the guard off both exit 0. Fails today: the first
      case exits 2 only because `tool_input` is ignored, and the matcher never delivers it
- [x] 2.8 GREEN: the same shape check on the tracker branch, still under the `gateGuard` flag
- [x] 2.8b REGRESSION GUARD (pairs with 2.2): the guard setting does not reach the reconcile arm — with
      `set-gate-guard off` and a reconcile owed, a Bash write shape still exits 2. Passes on 0.45.0
      (the flag already cannot reach that branch) and pins the property against the natural wrong
      implementation, in which 2.2 and 2.8 share one flag-gated check; this is the release's own
      theme, so the no-inverse claim is pinned rather than asserted in prose
- [x] 2.8c RED (pairs with 2.2): a payload naming `Bash` with no readable command blocks — `tool_input`
      absent, `tool_input` not an object, and `command` not a string each exit 2 while a reconcile is
      owed; and over a conflict-marked `state.json` the same payloads exit 2 with the unreadable-state
      message rather than inheriting the D4 exemption. Fails against the natural wrong implementation,
      in which `tool_name === "Bash"` alone selects the allow path
- [x] 2.9 REGRESSION GUARD: an unidentified tool blocks exactly as today — payloads `"{}"`, `""`,
      `not json`, and `{"tool_name":"Frobnicate"}` each exit 2 while a reconcile is owed; and
      `{"tool_name":"Edit","tool_input":{"command":"rg foo"}}` exits 2 regardless of command text
- [ ] 2.10 REGRESSION GUARD: nothing owed — a Bash write shape exits 0; and the existing
      `reconcile-obligation.test.mjs` Edit-payload assertions still pass unchanged

## 3. The matcher, and every site that says Bash is not matched

Pairs: 3.1 lands with 3.2.

- [ ] 3.1 RED: a test asserting the shipped `hooks/hooks.json` gate-guard entry's matcher covers
      `Bash`, `Edit`, `Write` and `NotebookEdit`. Fails today: the matcher is `Edit|Write|NotebookEdit`
- [ ] 3.1b RED: `scripts/test/hooks-schema.test.mjs:64-75` keys its README assertion on
      `` `${event}` — matcher `${matcher}` ``. Once both PreToolUse entries carry the same matcher one
      README section satisfies both iterations, so deleting the gate-guard section still passes —
      the assertion goes vacuous exactly when this change lands. Re-key it on the hook's COMMAND
      string (which differs per entry) and add a mutation check: with the gate-guard section removed
      from a copy of the README the assertion fails. Fails today against the current test
- [ ] 3.2 GREEN: widen that matcher (design D1). Verify `scripts/test/hooks-schema.test.mjs` and
      `scripts/test/conductor-28.test.mjs` still pass — the README heading assertion and the
      guard-vs-advisor entry assertion both read this file
- [ ] 3.3 GREEN: `hooks/README.md` — keep two PreToolUse sections, distinguishing them with a suffix
      after the closing backtick so the schema test's substring `includes` still matches; rewrite the
      gate-guard section's "Bash is not matched" paragraph to the new mechanism
- [ ] 3.4 GREEN: `scripts/lib/state.mjs:201` — the comment on `unreadableStateMessage` asserts "Bash
      is not matched by it"; correct it to the affirmed-Bash exemption. Re-derive the line number with
      `rg` at edit time
- [ ] 3.4b GREEN: `scripts/lib/refusal.mjs:18` — the `gate-guard` row's "Not a wedge: Bash is not
      matched by it" is false under the new matcher; restate it as the affirmed-Bash-with-a-command
      exemption. Re-derive the line with `rg` at edit time
- [ ] 3.4c GREEN: `skills/conductor/SKILL.md:206` ("`gate-guard` blocks Edit/Write/NotebookEdit
      (exit 2) and Bash is not matched, so the remedies run from the shell") and `README.md:1593`
      ("Bash is not matched by that hook, so run the remedy from the shell") — both state the reason
      the remedies stay runnable, and both reasons are now wrong. Restate each as the exemption.
      Re-derive both lines with `rg` at edit time
- [ ] 3.5 GREEN: the reconcile block's message (design D6) — print the matched shape's FIXED LABEL
      and no text taken from the command, drop "Completing the reconcile gate is the only way
      through" (this change does not make it true either), and state that a Bash write is forbidden
      while the reconcile is owed whether or not the check detects it. Check
      `scripts/test/output-text-integrity.test.mjs` and `output-interpolations.judged.mjs`, which
      govern this text — a label from a closed set needs neither escaping nor a length bound, and
      that is the point of choosing one
- [ ] 3.6 GREEN: `scripts/lib/rules.mjs` — add the Bash obligation to the EMITTED managed rules block
      beside the POP protocol's reconcile-gate line (~line 668), so an agent reads it before reaching
      for a heredoc. This is repo state and reaches a repo only on `/pm:upgrade` (design — Migration
      Plan). Re-run `scripts/test/managed-rules-block.test.mjs` and
      `scripts/test/emitted-invocations.test.mjs`

## 4. Required task items

- [ ] 4.1 **Call-site completeness sweep** (item 1) — derive mechanically with `rg` at sweep time, not
      from this list: every caller and reader of `gateGuardCheck`, `readStdin`, `unreadableStateMessage`,
      `refusalFor`, `escapeControls` on guard text, and every occurrence of the strings
      `Edit|Write|NotebookEdit`, `Edit/Write/NotebookEdit`, `Edit and Write`, `Edit/Write`,
      `Bash is not matched`, `Bash is not blocked`, `never reaches this hook`,
      `gate-guard` AND the hyphen-less `gate guard` across `scripts/`, `hooks/`,
      `commands/`, `skills/`, `README.md` and `openspec/specs/`. State where the new rule holds and
      where it does not, and justify each omission — in particular `lesson-advice`, which shares the
      wider matcher and is deliberately untouched. DATA references: the payload fields `tool_name` and
      `tool_input.command` are read here and in `scripts/lib/lessons.mjs`; enumerate both readers and
      say why they differ (the advisor matches line one only, by an explicit precision decision).
      INVERSES: for every operation this change adds, name its inverse and whether it ships — the
      tracker arm's inverse is the existing `set-gate-guard off`; the reconcile arm ships NONE, and
      design D5 is the justification carried into the report
- [ ] 4.1b **Emitted-remedy sweep** (item 1, the DATA half applied to text) — enumerate with `rg`
      every command line pm EMITS as a remedy, run each through the new shape scanner, and state per
      case whether it stays runnable or is accepted as blocked (design D7). This sweep is NOT
      mechanical from a remembered list and the same remedy appears at more than one site: the
      `sed -i.bak '<N>d'` marker fix lives in `rules.mjs` AND in `commands/review-mode.md:49` AND in
      `commands/upgrade.md:184`, so search the emitted TEXT, not the function. The cases already
      known, each of which must be re-derived rather than trusted: those three `sed` sites (accepted
      as blocked, and now stated normatively in the `managed-rules-block` delta); `state.mjs`'s
      `rm`/`rm -r` lock refusal (stays runnable ONLY because the record's match is keyed on the
      WRITTEN ARGUMENT and never reaches a longer LITERAL filename — test it, since a prefix match
      would wedge it, and note that the trailing glob `state.json*` IS blocked although it would
      reach the lock, which costs nothing because this remedy prints the literal path);
      an UNFILLED command template — `<id>`, `<sha>`, `<iso>`, `<why>` each carry a `>` the
      redirection arm matches, so a template pasted unfilled blocks while the filled command
      passes (accepted in D7, and PRE-EXISTING: `briefing.mjs:30`/`:45`/`:60`,
      `autonomy.mjs:44-46`, `gate-review-writeback.mjs:51-52` and `argv-surface.mjs:213` emit
      these today, and any template the SIBLING change adds falls in the same class);
      `refusal.mjs`'s unreadable-state suffix (stays true
      under D4, for a new reason); `/pm:feedback` step 2 (`commands/feedback.md:44-46`, "Write the
      report to a local file FIRST … every time, on every path"), which becomes unrunnable by Bash
      and by Edit alike while a reconcile is owed — accepted, and named in 5.6 so pm's own friction
      channel does not die silently; and every remaining remedy in `commands/*.md`. A remedy pm
      prints that the guard then refuses is a FINDING unless it is named here, and no diff shows it
      because none of those files changes
- [ ] 4.2 **Verify against the commit, not the working tree** (item 2) — for every task above, run
      `git show --stat <that task's sha>` and assert each file the task claims appears in THAT commit.
      A task whose claimed file is absent FAILS even with the suite green
- [ ] 4.3 **Attribute every commit** (item 4) — at the moment each commit is made, run
      `update-epic the-guard-covers-every-write-path --attribute-commit <sha>`. The archive commit in
      6.2 is EXCLUDED
- [ ] 4.4 **Route what the work taught you** (item 7) — name which of the three each learning is. A
      candidate already visible: a mechanical guard whose matcher is narrower than the behaviour it
      claims to cover is a practice-level lesson (`docs/lessons/`), and any friction in pm's own
      surfaces hit while doing this is `/pm:feedback`

## 5. Docs (after Gate 2)

- [ ] 5.1 `commands/gate-guard.md` — the matcher, the closed shape list and its exclusions, what the
      check cannot see, the unreadable-state Bash exemption replacing "This is not a wedge, because
      Bash never reaches this hook", the accepted false-positive class (including the spaced
      comparisons the arrow exclusion does NOT reach), the two fail-open modes — an unreadable record
      allows every Bash call carrying a command, an absent record leaves the guard dormant — the exact-path rule for the
      record and why it is not a prefix, the engine-invocation exemption and its bound, and the
      stated asymmetry that
      the reconcile arm has no inverse while the tracker arm keeps `set-gate-guard off`
- [ ] 5.2 `skills/conductor/SKILL.md` — the POP protocol's statement of what the gate blocks, and the
      unreadable-state paragraph at ~line 206 already corrected in 3.4c
- [ ] 5.3 `README.md` — the gate-guard description, and the unreadable-state paragraph at ~line 1593
      already corrected in 3.4c
- [ ] 5.4 `CHANGELOG.md` `[Unreleased]` entry
- [ ] 5.5 `commands/feedback.md` — one line at step 2 saying the local-file write is blocked while a
      reconcile is owed and that completing the gate is the way through, so a user who hits it reads
      why rather than concluding `/pm:feedback` is broken (design D7)
- [ ] 5.6 Confirm `docs/parity-ledger.json` still claims every touched path and adds none (no new
      file under `commands/`, `agents/`, `skills/`, `hooks/` or `.claude-plugin/` is expected)

## 6. Close

- [ ] 6.1 Gate 2 — two fresh-context lenses over the committed range (lens A: spec alignment and real
      tests; lens B: absent edits, error and edge handling, the honesty of every message). Fix Critical
      and Important, then record
      `record-gate-review the-guard-covers-every-write-path --gate 2 --verdict pass --reviewer "<identity>"
      --base-sha <parent of the first attributed commit> --head-sha <the last attributed commit>`
- [ ] 6.2 <!-- pm:lifecycle --> Archive — `/opsx:archive the-guard-covers-every-write-path`, then
      `update-epic the-guard-covers-every-write-path --status archived --outcome delivered --reason
      "the gate guard covers Bash write shapes and the unreadable-state block stays wedge-free"
      --no-deferrals`. The commit that moves `openspec/changes/<id>/` under `archive/` is NOT
      attributed
