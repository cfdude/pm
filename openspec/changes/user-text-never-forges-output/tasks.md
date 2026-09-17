## 0. Before any code

- [x] 0.1 Gate 1 — two fresh-context lenses over these artifacts BY PATH (lens A: every WHEN/THEN
      testable and failing on today's engine where tasks mark it RED; lens B: absent edits — output
      sites, id-storing paths, DATA references and inverses the specs do not name); fix every Critical
      and Important, re-validate with `openspec validate user-text-never-forges-output --strict`, then
      record `record-gate-review user-text-never-forges-output --gate 1 --verdict pass --reviewer
      "<identity>" --artifact openspec/changes/user-text-never-forges-output/proposal.md --artifact
      openspec/changes/user-text-never-forges-output/design.md --artifact
      openspec/changes/user-text-never-forges-output/tasks.md --artifact
      openspec/changes/user-text-never-forges-output/specs/output-text-integrity/spec.md`
- [x] 0.2 **Cross-spec review** (required task item 5) — release 0.45.0 holds this change's spec and
      its two siblings' (`commit-nudge-reads-the-whole-move`, `emitted-commands-run-as-written`). Run
      the `cross-spec-review` skill after all three pass Gate 1 and again after any later amendment;
      record `record-cross-spec-review 0.45.0 --verdict pass|fail --reviewer "<identity>"`
- [x] 0.3 After changes 1 AND 2 have merged into `dev`, re-derive with `rg` every line anchor in
      design.md AND the site lists of tasks 3.5 and 5.4 and the callers of `printedId()` — including `archive-gate.mjs`,
      where change 2 moves `gateRemedy`, `dispositionInvocation`, `deliveredBlockedBy` and
      `BRIEF_REMEDIES`, and change 1's `commitNudge`/`retract-detour` output — and correct them in the
      first implementation commit

## 1. One id format, one table-cell escaper

The pre-commit hook runs the whole suite, so every RED test below lands in the SAME commit as the
GREEN task that turns it green; the pairs are named per section. Before that commit, the new test run
against the pre-GREEN engine is saved in this change directory as `red-<task>.txt`, and the GREEN
commit message names that file. New test file: `scripts/test/output-text-integrity.test.mjs`, fixture
repos via `helpers.mjs`/`hermetic-git.mjs` (own git identity, `commit.gpgsign=false`, fail loudly on
setup error).

Pairs: 1.2 lands with 1.3.

- [x] 1.1 REGRESSION GUARD: `EPIC_ID_FORMAT` is exported from `constants.mjs` by
      `emitted-commands-run-as-written` (its task 2.9, applied first); confirm the DEFINITION is
      single — `rg -n 'EPIC_ID_FORMAT\s*=' scripts/lib scripts/conductor.mjs --glob '!constants.mjs'`
      and `rg -n '/\^\[a-z0-9\]\[a-z0-9\._-\]\*\$/' scripts/lib scripts/conductor.mjs --glob
      '!constants.mjs'` (the regex LITERAL) both return nothing. The bare pattern is not the guard: it
      also matches `created-at.mjs`'s comment and the `add-epic`/`add-many` refusal messages D4 keeps.
      Measured before change 2: the literal rg returns exactly `add-epic.mjs:360`, `add-many.mjs:61`
      and `verify-specs.mjs:54`, the three sites its task 2.9 replaces; no commit unless it does not
      (design D4)
- [x] 1.2 RED: unit — `escapeTableCell` escapes every control character exactly as `escapeControls`
      does, then every backslash as two and every `|` as `\|` (so `a\|b` stays one GFM cell);
      `escapeControls` is idempotent over its own output
- [x] 1.3 GREEN: add `escapeTableCell` beside `escapeControls` (design D1)

## 2. PROJECT.md tables keep their cells

Pairs: 2.1–2.3a land with 2.4.

- [x] 2.1 RED: spec "A detour reason with a pipe and a newline stays in its cell" (repro A)
- [x] 2.2 RED: spec "A disposition reason with a newline stays in its row" (repro B)
- [x] 2.3 RED: spec "A minimal detour note with a pipe stays in its cell" (repro I)
- [x] 2.3a RED: spec "A backslash before a pipe does not open a delimiter" — cells counted under
      GitHub-flavored-Markdown splitting (design D1)
- [x] 2.4 GREEN: `tableRow(...cells)` in `render.mjs`; every data row of Detour stack, Epics,
      Dispositions, Gate reviews and Recent detours built through it; remove the Dispositions reason's
      own `|` replace; add the D3 source guard (no data-row `md.push` beginning `|` outside `tableRow`)

## 3. PROJECT.md, the brief and `release show` never gain a line

Pairs: 3.1–3.4c land with 3.5.

- [x] 3.1 RED: spec "A detour reason cannot forge a NOW line in the brief" — PROJECT.md and the decoded
      brief halves (the log half is 4.1)
- [x] 3.2 RED: spec "A backlog title cannot forge a heading" (repro C)
- [x] 3.3 RED: spec "An already-stored malformed release id renders without forging" — the fixture
      writes the release into `state.json` directly (design D3 legacy exception, say so in the test)
- [x] 3.4 RED: spec "Line separators other than LF are escaped too"
- [x] 3.4a RED: spec "A session name cannot forge a line in the owners report" (Gate 1 lens A repro)
- [x] 3.4b RED: spec "A plan heading cannot carry a line separator into PROJECT.md"
- [x] 3.4c RED: spec "An already-stored tracker value cannot forge a rules heading" — legacy tracker
      written into `state.json` directly (design D3 exception)
- [x] 3.5 GREEN: `escapeControls` at every interpolation of a governed value in `render.mjs`,
      `briefing.mjs`, `constants.mjs` (`releaseLine`), `releases.mjs` (`releaseShow`), `claims.mjs` (`owners`, claim
      messages), `rules.mjs` (tracker system/project/repo/instance in the managed block's prose),
      `tracker.mjs` (set/remove messages), `lessons.mjs` (`adviceText`) and the `changesets` reader
      (`worktree-hygiene.mjs`), and
      in the shared helpers both render and brief call (`outcomeOf`, `correctionNote`,
      `correctionMarking`, `crossSpecLine`, `gateTableRows`, `withdrawnArchiveNote`,
      starvation/dependency notes) — derived with `rg -n '\$\{'` over those files and each
      interpolation classified engine-composed or escaped in the commit message. Sites the 7.2 sweep
      finds later are fixed in the 7.2 commit, which says so

## 4. The Honcho memory line is one line

Pairs: 4.1 lands with 4.2.

- [x] 4.1 RED: spec "A detour reason cannot forge a NOW line in the brief" — the
      `honcho-memories.log` half, plus `honcho-memory push e1 "<P>"` stdout (repro A)
- [x] 4.2 GREEN: `honchoMemoryLine()` escapes the reason and the epic id (design D7)

## 5. Refusals quote values on one line

Pairs: 5.1–5.3c land with 5.4.

- [x] 5.1 RED: spec "An unknown id is quoted back on one line" — the fixture pushes one detour frame
      first (without it `pop-detour` never reaches the id); all six verbs, `state.json` byte-identical
      (repro F)
- [x] 5.2 RED: spec "A story title cannot forge an invocation in the archive refusal" (repro D)
- [x] 5.3 RED: spec "A withdrawal reason cannot forge an integrity line" (repro E) — real commits via
      the helpers fixture, never a placeholder sha
- [x] 5.3a RED: specs "A stored id holding a control character is never put into an emitted command",
      "A record no verb can rename prints no remedy" and "A change no verb can make is named, not
      delegated to a hand-edit" (legacy id written into `state.json` directly — design D3 exception)
- [x] 5.3b RED (against the engine after change 1): spec "The commit nudge never prints a command naming
      a control-character id" — legacy control-character ids on the active detour epic, the paused epic
      and an attributed epic; record the anchor, make a real commit, amend the attributed commit,
      observe; assert no printed command names any of the three ids and no line is forged
- [x] 5.3c RED: spec "A release id in an integrity remedy is routed through the id printer" (legacy
      release ids written into `state.json` directly — design D3 exception). Fails on 0.44.0, measured:
      `integrity.mjs`'s `delivered-release-epic-left-open` prints `release ${rel.id} --defer …` raw, so
      the output holds a line beginning `FORGED --defer` and the unquoted `release Legacy Release --defer`
- [x] 5.4 GREEN: an emitted invocation whose identifier (epic id or release id) holds a CONTROL
      CHARACTER is not printed; the prose line of design D4a replaces it (a tracker system/project/repo
      is NOT in that class — it is replaced, not renamed, under change 2's
      `tracker-repo-not-a-github-repository` wording, which this task does not touch; an epic or release id merely failing `EPIC_ID_FORMAT` is printed as
      emitted-commands-run-as-written prints it, shell-quoted via `printedId()`; a tracker value without
      a control character keeps change 2's shape rules) — add the no-remedy builder and hook it into
      `printedId()` as the single site (design D4a); route printed release-id commands through
      `printedId()` too, including `integrity.mjs`'s `release ${rel.id} --defer` remedy; because this
      changes `printedId()`'s return (a string or the no-remedy signal), enumerate EVERY caller at sweep
      time with `rg -n "printedId\(" scripts/lib scripts/conductor.mjs` — never a fixed list — AND, because
      that sweep finds the BUILDERS that call `printedId()` (`dispositionInvocation`,
      `deliveredArchiveInvocation`, `gateRemedy`, `obligationRemedy`) but not THEIR callers, which receive
      the signal second-hand, sweep the callers of those builders too with `rg -n
      "dispositionInvocation\(|deliveredArchiveInvocation\(|gateRemedy\(|obligationRemedy\(|blockedDelivered\(|deliveredBlockedBy" scripts/lib`
      (among them `integrity.mjs`'s delivered-release and drift-heal steps, `briefing.mjs`'s `BRIEF_REMEDIES`,
      `update-epic.mjs`'s disposition refusals, and `blockedDelivered()`'s remedy
      list as `unconsidered-outcomes` reads it; re-derived at 5accfbe in design.md Context) — and a
      non-id governed value in an emitted command (`integrity.mjs`'s `--session`, `verify-specs.mjs`'s
      `--spec`, `sync`'s near-match `--plan`) takes a placeholder when it holds a control character — and state for each that it handles the no-remedy signal (the message names the record and says no verb can rename it; no hand-edit
      instruction; the rules block's `gh issue list --repo` excluded — change 2's `usesGhIssueList()`
      shape requirement stops a control-character repo before that line, which holds for the rules
      block only, not for `integrity`);
      and escape every governed value in a refusal or
      report line: the handoff refusal's story titles (`archive-gate.mjs`),
      `delivered-epic-attributed-no-commits`'s sha and reason and `archive-directory-has-no-epic`'s
      directory (`integrity.mjs`), `add-many.mjs`'s `bad id` and story messages, `claims.mjs` and
      `tracker.mjs` refusals, and every `not found` / top-of-stack / does-not-exist refusal derived with
      `rg -n "not found|does not exist|top of the detour stack|no matching" scripts/lib scripts/conductor.mjs`.
      Sites the 7.2 sweep finds later are fixed in the 7.2 commit, which says so

## 6. Ids are refused at input

Pairs: 6.1–6.5b (6.4c included) land with 6.6, 6.7 and 6.8 (one commit; they share the fixture).

- [x] 6.1 RED: spec "sync skips a change directory whose name holds a newline" (repro H)
- [x] 6.2 RED: spec "sync skips a plan file whose name holds a newline" (repro H)
- [x] 6.3 RED: spec "The archive backfill skips a malformed archive directory" — including the
      `integrity` wording half
- [x] 6.4 RED: spec "A release id with a newline is refused" (repro G)
- [x] 6.4a RED: spec "A malformed release id with no intent is refused on its shape first"
- [x] 6.4b RED: specs "A tracker system with a newline is refused before the rules file is written"
      (Gate 1 lens A repro) and "A secondary tracker repository with a newline is refused"
- [x] 6.5 REGRESSION GUARD: specs "A well-formed release id is still created", "An already-stored
      malformed release is still updatable" and "An uppercase plan filename still registers, and a held
      one is not reported"; plus `add-epic --id "e1<LF>x"` and an `add-many` batch with such an id still
      refuse with nothing written
- [x] 6.4c RED: spec "A primary tracker system with a newline is refused even with --remove" — fails
      on 0.44.0, measured: exits 0 and `## FORGED` lands in `CLAUDE.md` and `state.json`
- [x] 6.5b REGRESSION GUARD: a legacy secondary tracker whose `repo` holds a control character (written
      into `state.json` directly) is removed by `set-tracker --role secondary --remove` with that value
- [x] 6.6 GREEN: `STORABLE_EPIC_ID` and `pushEpic()`'s `InvalidEpicIdError`; `sync` (active changes, plan
      files) and `backfillArchive` test it at the final registration step, after the claimed, known,
      tombstone and near-match rungs, and skip with the escaped stderr line on every run including
      `quiet`; the `archive-directory-has-no-epic` detail distinguishes a failing directory (design D4)
- [x] 6.7 GREEN: `release()` create branch refuses a non-matching id FIRST — before the
      missing-intent refusal and any write — printing no runnable invocation with it (design D5)
- [x] 6.8 GREEN: `set-tracker` refuses a control character in `--system`/`--project`/`--repo` for both
      roles before `loadState`, except on `--role secondary --remove` (a primary `--remove` is refused, as
      change 2 scoped its own exemption), and BEFORE change 2's owner/name shape check
      (design D8); change 2's tests 4.1 and 4.5 must stay green

## 7. The rule is held by registries, not by this task list

Pairs: 7.1 lands with 7.2.

- [x] 7.1 RED: `POISON_RECIPES` completeness — its key set equals every `valueBearingFlagsFor(verb)`
      entry plus every `freeText` positional, counted fresh on the post-change-1-and-2 tree (the 120 + 4
      measured at f49871a is stale); saved red run shows the missing keys, including
      `retract-detour --reason` and `suggest-lane --ask`
- [x] 7.2 GREEN: the sweep of design D3 over ONE accumulated fixture — argv recipes for every key and
      the `SOURCE_RECIPES` (add-many `--from` fields, plan heading, change-directory and plan-file names,
      `.changesets` fragment, workspace lesson frontmatter, `PM_SESSION`) — including
      `retract-detour --reason` (a real auto-logged row built through the commit-nudge hook;
      `rendered: true` via its stdout, or `notRendered` because `render` drops RETRACTED rows) and
      `suggest-lane --ask` (`notRendered`: JSON output); `integrity`'s
      `tracker-repo-not-a-github-repository` as a printer over legacy primary and secondary github-issues
      trackers whose `repo` holds a control character (it builds its secondary removal with
      `shellQuote()`, not `printedId()`, and names `--remove` in prose without the value); the commit-nudge anchor → commit → amend →
      observe sequence and `retract-detour` with a poisoned sha positional as surfaces; each recipe declared
      `rendered: true` (its tag must appear escaped on some surface), `notRendered: "<why>"`, or
      `exempt: "<refusing check>"` (an exempt recipe still runs, must exit non-zero, and its refusal
      output is swept); legacy stored values; every surface incl. `write-rules` and the
      decoded strings of every hook verb; assertions (a)–(f); each recipe asserts its own exit status.
      Any governed-value site the sweep exposes is fixed in this commit and listed in its message.
      Size: re-derived at 7.1 (it was 120 flag entries plus 4 free-text positionals at f49871a, before
      changes 1 and 2); many share one recipe body
- [x] 7.3 REGRESSION GUARD (mutation check): temporarily remove one escape from `briefing.mjs` (its line
      sink, which carries the detour reason — design D1 implementation note) and one `tableRow` use from `render.mjs`; confirm the sweep fails on each, save
      both runs as `red-7.3-mutant.txt`, restore; nothing of the mutation is committed

## 8. Required task items

- [x] 8.1 **Call-site completeness sweep** — derived with `rg` at sweep time, never from this list:
      - every interpolation into an output string: `rg -n "process\.(stdout|stderr)\.write|die\(|fail\(|md\.push|L\.push|out\.push" scripts/lib scripts/conductor.mjs`,
        each interpolated value classified engine-composed or escaped; an unescaped non-engine value is
        a FINDING;
      - every caller of `escapeControls` and `escapeTableCell` (`rg -n "escapeControls|escapeTableCell"`),
        each stated as line or cell context, and no `escapeTableCell` result passed through it twice;
      - every creator of an epic (`rg -n "pushEpic\(|epics\.push\(" scripts/lib`) and of a release
        (`rg -n "releases\.push\(|state\.releases\s*=" scripts/lib`), each stated as validating or
        routed through the sink;
      - DATA references holding an epic or release id that a caller can write: `parent`,
        `links[].epic`, `disposition.carriedTo`, deferral epic ids, `release` membership,
        `detourStack[].pausedEpic/spawnedDetour`, `active` — for each, the write site (does it require
        the target to exist, and so inherit the format?), the read sites (escaped?), and the REMOVE
        site. `add-many` links' epic half is unvalidated (design, add-many.mjs comment) — state whether
        it can now store a non-matching id and justify or fix;
      - every append-only log line writer (`rg -n "appendFileSync" scripts/lib`), each stated as
        one-line-guaranteed or not;
      - every reader of a governed non-argv input (`rg -n "readFileSync|readdirSync|process\.env" scripts/lib`),
        each stated as engine-written (plugin-shipped file) or covered by a `SOURCE_RECIPES` entry;
      - every writer of a tracker's `system`/`projectKey`/`repo` (`rg -n "\.system\s*=|projectKey\s*=|\.repo\s*=" scripts/lib`),
        each stated as passing D8's refusal or legacy-tolerant;
      - every printer of a tracker scope inside an emitted command, including `integrity`'s
        `tracker-repo-not-a-github-repository` (built with `shellQuote()`, not `printedId()`, so the
        `printedId()` caller list does not reach it), each stated as carrying no control-character
        value.
      A site where the rule does not hold is a FINDING unless justified in the commit.
      - **Re-run at Gate 2 (T-S2), per interpolation.** The first run filtered rg hits to lines holding no
        escaper, which hid every line escaping one value beside a raw neighbour. Method and result:
        `sweep-interpolations.mjs` (a lexer classifying EVERY `${…}` and non-literal `+` operand in
        `scripts/conductor.mjs` and `scripts/lib/*.mjs`), its declared judgments
        `sweep-interpolations.judged.mjs` (each with its reason; a judgment matching nothing is STALE), and
        `sweep-interpolations.txt` (every interpolation with its class; exits 0 only with none
        UNCLASSIFIED). Result: 1447 interpolations — escaped 451, literal 265, sink 191, not-output 17,
        judged 523, unclassified 0. Findings fixed, each driven RED first by a 7.2 legacy recipe or 5.3e
        (`red-g2-T-S2.txt`): rank's band name (a stored priority is free text); update-epic's un-ignore,
        rank-clear and cleared-field announcements; release's `--unmember`/`--undefer` re-entry hints;
        remove-epic's held-by citation; pop-detour's still-not-archived status; set-autonomy's stored level;
        plan-hierarchy's cycle path; the archive gate's `recorded <recordedAt>`; upgrade's `since
        <pmVersion>` and the OpenSpec currency lines it writes straight to stderr.
      - **Moved into the suite (Gate 2 U2-I1).** The change-directory script guarded nothing past its
        commit, resolved its repository from the change directory (broken by the archive move), and 103
        of its 152 judgments covered a whole function — a raw `held.session` in `claim()` and a raw title
        in `supersedeAmended()` both passed it (`red-g2-U2-I1.txt`). It now lives at
        `scripts/test/output-interpolations.mjs` (method; `--all` prints every row, exit code set without
        cutting a pipe short), `scripts/test/output-interpolations.judged.mjs` (judgments naming EXACT
        expressions with their occurrence counts; only `sink-flow` and `json` may cover a whole
        declaration) and `scripts/test/output-interpolations.test.mjs` (no UNCLASSIFIED, STALE, EXCESS or
        WIDE finding, and both reviewer mutants proven caught in-suite). The two change-directory scripts
        are removed; `sweep-interpolations.txt` stays as the record of the T-S2 run. 7.2 gained the legacy
        recipe `claim --steal` over a live claim whose stored session holds a control character.
      - **Gate 2 U2-I2.** The three T-S2 escapes with no failing test now have one, each driven RED by
        undoing that escape alone (`red-g2-U2-I2.txt`): 7.2's rank-clear recipe poisons the STORED priority, a
        new 7.2 legacy recipe runs `update-epic <legacy id> --clear parent`, and a tool-currency test runs
        `upgrade` over a change directory whose name holds a control character.
      - **Gate 2 U2-M1.** JSON stdout: `JSON.stringify` leaves DEL, C1 and U+2028/U+2029 raw, so a legacy status
        put a line start into `triage`'s stdout (`red-g2-U2-M1.txt`). Fixed, not declined: all 14 stdout
        JSON documents go through `jsonText()` (`constants.mjs`; same parsed value); test 5.3g guards the
        bypass; design.md's Non-Goal corrected.
      - **Gate 2 V-round.** V-I1: `jsonText` takes JSON.stringify's `(value, replacer, space)` — its two-argument
        form read `unconsidered-outcomes`' `null, 2` as null spacing and printed compact JSON; the 14 callers
        re-derived with rg, `activity --json` and `owners --json` moved to `(…, null, 2)`; test 5.3i compares 13
        stdout documents byte for byte against `JSON.stringify(parsed, null, <documented space>)` with only the
        escaped code points differing (`red-g2-V-I1.txt`). V-I2: the sweep counted asCode/orNoRemedy as escapers
        whatever they wrapped, split `a || b && "y"` at the `&&`, and accepted any left operand of `.length` /
        `+ 1`; now wrappers count only around a built remedy, splitTop stops at a looser operator, the count
        patterns are anchored, and escapers are trusted only as their real binding (no `esc` by name, no
        shadowing local) — six reviewer mutants plus two binding mutants in-suite (`red-g2-V-I2.txt`). V-M3:
        judgments match through `normaliseExpr()` on both sides, and findings name the judgments file
        (`red-g2-V-M3.txt`). V-M1: 5.3g refuses JSON.stringify anywhere in a declaration that writes stdout
        (aliased and variable mutants; `red-g2-V-M1.txt`). V-M2: 5.3h refuses a row's epic read by bracket,
        optional chain or destructuring (three mutants; `red-g2-V-M2.txt`).
      - **Gate 2 W-round.** W-I1: a project directory is a governed value (a workspace name and
        CLAUDE_PROJECT_DIR), and `render` printed `rendered <PROJECT_MD>` raw, so a directory named with a
        line terminator forged a line from `init` and `render`. Every stdout/stderr interpolation of a path
        or env-derived value re-derived with rg (PROJECT_MD, ROOT, CONDUCTOR_DIR, STATE_PATH, rulesTarget,
        process.env, cwd, activityDir, `.message` of an fs error): also escaped `set-activity-log on`'s
        `writing to <activityDir()>`, `honcho-memory`'s fs failure message (EISDIR names the absolute
        path) and the verbose engine banner's install directory; `rules-target` stays raw (justified: a
        machine-read filename); lock and rules-file paths are printed RELATIVE to the same root they are
        built from, so no root segment reaches them. Test 5.3j runs init/render/brief/set-activity-log and
        a failing honcho-memory in a directory named with LF and U+2028 (`red-g2-W-I1.txt`, one site
        fixed at a time). W-I2: an ALL_CAPS name (and its `.join()`) is literal only when every declaration
        of it, followed through imports, is a literal shape and it is never reassigned or rebound;
        `AGENT_OUTCOMES` (a filter of literal `KNOWN_OUTCOMES`) is the one `LITERAL_ALLOWLIST` entry. Names
        that lost trust: `PROJECT_MD` (render — escaped in W-I1), `STATE_PATH` (state.mjs lockPaths ×2,
        saveState's temp name) and `LOCK` (commit-watch observeLockPaths), judged not-output; the local
        `L.join("\n")` of purgeLogs and rulesBlockAmbiguousMessage, judged passthrough. The same round found
        render()'s function-wide sink-flow judgment covering its raw `rendered ${PROJECT_MD}` stderr line: a
        sink-flow judgment no longer covers a value written straight to a stream. `red-g2-W-I2.txt`. W-I3: the V-I2 asCode/orNoRemedy mutants ran in claims.mjs, which imports neither wrapper, so they were UNCLASSIFIED on import trust alone and reverting the wrapper fix failed no V-I2 test; they now run in subcommands.mjs (asserted to import both), and with the wrappers put back in ESCAPER_REALS both fail (`red-g2-W-I3.txt`).
- [x] 8.2 **Inverse of every operation added or modified** — the id refusal at `pushEpic` (inverse:
      `remove-epic`, unchanged; a skipped directory's inverse is renaming it, no verb); the release
      create refusal (inverse: none needed — nothing was stored). DECIDED, not deferred: no
      release-rename verb is shipped and none is filed — nothing is stranded today (the Gate 1 review
      verified a legacy release id is still updated and removed), and this change stores nothing new
      that would need renaming; no rename verb for a stored epic id or release id holding a
      control character (DECLINED: D4a's message says no verb can rename it; population measured at zero
      in this repository's `state.json`, and D4/D5 stop new ones); a tracker scope needs no rename verb —
      it is replaced (change 2's `tracker-repo-not-a-github-repository` names the re-record); the
      tracker-scope refusal (inverse: `set-tracker --role secondary --remove`, deliberately NOT refused
      so a legacy entry stays removable; a primary `--remove` IS refused, and a primary is replaced by the
      next well-formed `set-tracker`); escaping (inverse: none — output only, the stored value is unchanged).
      Each unshipped inverse named and justified in the commit message
      - Gate 2 T-M5: ONE store is escaped at write, not at output — `.conductor/detours.log`'s epic and
        note fields — because a raw LF/TAB would split an engine-parsed row; recorded as design D7's
        exception, with the check that no reader matches the logged epic against a stored id.
        That check is a source guard since Gate 2 U2-M2 (test 5.3h; `red-g2-U2-M2-mutant.txt`).
- [x] 8.3 **Verify against the commit** — `git show --stat <sha>` for every task commit; every file the
      task claims is present in THAT commit, including the test file and each `red-<task>.txt`
- [x] 8.4 **Attribute every commit** as it lands: `update-epic user-text-never-forges-output
      --attribute-commit <sha>`. The archive commit, and any commit that only relocates this change's
      artifacts, is excluded
- [ ] 8.5 **Dispositions** <!-- pm:lifecycle --> — `update-epic user-text-never-forges-output --status
      archived --outcome delivered --no-deferrals` (swap `--no-deferrals` for `--deferral
      "<epicId>:<section>"` or `--declined-deferral "<what>:<why not>"` for anything Gate 2 defers).
      The superseded epics `user-text-unescaped-in-render-brief-integrity` and
      `handoff-refusal-prints-story-titles-raw` are already archived as superseded — confirm, do not
      re-end them
- [ ] 8.6 **Route what the work taught** — name each as a practice (register an epic, with its
      evidence), tooling friction (`/pm:feedback [bug|feature] "<summary>"`), or a process failure (a
      lesson in `docs/lessons/` with `trigger`, `cost`, `enforced_in`). At minimum decide: whether a
      partial escape that passed review (the Dispositions `|`-only escape) is a lesson, and whether
      the registry-bound poison sweep is a practice other pm users should have

## 9. Docs (after Gate 2)

- [ ] 9.1 `commands/sync.md` — a change directory, plan file or archive directory whose name holds a
      control character or whitespace is skipped and named on every run, and must be renamed to register
- [ ] 9.1a `commands/tracker.md` — `--system`/`--project`/`--repo` refuse control characters;
      `--role secondary --remove` does not
- [ ] 9.2 `commands/epic.md` and the release command doc (`rg -l "release <id>" commands`) — the id
      format for releases at creation; free text is stored as written and escaped on display
- [ ] 9.3 `skills/conductor/SKILL.md` and `README.md` where the id format or PROJECT.md rendering is
      described (`rg -n "a-z0-9\]\[|PROJECT.md" skills/conductor/SKILL.md README.md`)
- [ ] 9.4 `CHANGELOG.md` `[Unreleased]` — Fixed (forged lines in PROJECT.md, brief, integrity,
      refusals, the rules file and hook output; forged table cells; ids with control characters stored by
      sync, backfill and release; tracker scopes with control characters stored by set-tracker) and
      Changed (sync skips names holding a control character or whitespace; release ids validated at
      creation, before the missing-intent refusal)
- [ ] 9.5 Full suite green, written to a file and read from the file

## 10. Gate 2 and close

- [ ] 10.1 Gate 2 — two fresh-context lenses over the committed range (A: spec alignment and real
      tests; B: absent edits against 8.1's sweep); fix Critical and Important; record
      `record-gate-review user-text-never-forges-output --gate 2 --verdict pass --reviewer
      "<identity>" --base-sha <parent of first attributed> --head-sha <last attributed>`
- [ ] 10.2 Archive this change <!-- pm:lifecycle --> — `/opsx:archive user-text-never-forges-output`,
      then the disposition in 8.5
