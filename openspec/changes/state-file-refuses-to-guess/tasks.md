## 0. Before any code

- [ ] 0.1 Gate 1 — two fresh-context reviewers with different lenses (one: spec testability and
      today's-engine RED-ness of every scenario; two: failure modes of the fixes themselves — the lock's
      stale break, fail-closed gate-guard, refuse-not-heal on the rules block) over these artifacts BY
      PATH. Fix Critical and Important, re-run `openspec validate state-file-refuses-to-guess --strict`,
      then record:
      `record-gate-review state-file-refuses-to-guess --gate 1 --verdict pass --reviewer "<identity>"
      --artifact openspec/changes/state-file-refuses-to-guess/proposal.md --artifact
      openspec/changes/state-file-refuses-to-guess/design.md --artifact
      openspec/changes/state-file-refuses-to-guess/tasks.md --artifact
      openspec/changes/state-file-refuses-to-guess/specs/state-write-guard/spec.md --artifact
      openspec/changes/state-file-refuses-to-guess/specs/conductor-record/spec.md --artifact
      openspec/changes/state-file-refuses-to-guess/specs/managed-rules-block/spec.md`
- [ ] 0.2 **Cross-spec review** (required task item 5) — release 0.44.0 holds three changes and this
      change alone carries three spec files. Run the `cross-spec-review` skill over the WHOLE release's
      spec set once all three changes pass Gate 1, and again after any concurrent amendment. Ask in
      particular: does `every-verb-refuses-what-it-does-not-read` also amend `state-write-guard`'s
      `--force` requirement or claim `--ttl` validation (double ownership with D5 / the unreadable-state
      `--force` scenario)? does `gates-bind-to-verified-evidence` amend gate-guard behaviour this change
      pins? do the exit codes (1, 2, 9, 10) collide with anything the siblings introduce? Record:
      `record-cross-spec-review 0.44.0 --verdict pass|fail --reviewer "<identity>"`
- [ ] 0.3 Precondition — `every-verb-refuses-what-it-does-not-read` is merged. Re-derive every line
      anchor this task list and design.md name (`state.mjs`, `conductor.mjs`'s top-level catch,
      `claims.mjs` `ttlFrom`, `gate-guard.mjs`, `subcommands.mjs`) from the tree, and correct any task
      below whose anchor moved. Re-read this change's proposal and tasks before task 1.1 (the epic has
      no `externalId`, so this is the source re-read and nothing is recorded)

TDD convention for sections 1–6: the pre-commit hook runs the whole suite, so each RED test lands in
the SAME commit as its GREEN. Before writing the GREEN code, run the RED test alone and save its
failing output to `openspec/changes/state-file-refuses-to-guess/red-<task>.txt` (e.g. `red-1.1.txt`);
the GREEN commit stages that file and names it in its message.

## 1. An unreadable state file is refused, never replaced

- [ ] 1.1 RED (lands with 1.2): new `scripts/test/state-file-refuses-to-guess.test.mjs` — a
      three-epic repo with a conflict-marker line prepended; `add-epic --id new` must exit 10, leave
      `state.json` byte-identical (compare bytes, not parsed JSON), and name `.conductor/state.json`, a
      `git` remedy and the move-aside-and-`init` remedy in stderr. Plus: a 40-byte truncation run through `sync`, `upgrade`, `init` in turn, each exit 10
      with `state.json`, `PROJECT.md` and `CLAUDE.md` byte-identical; `owners` on unparseable exits 10
      with no report on stdout; `epics: {}` refused by `owners` naming `epics`. Today: exit 0 and the
      file holds `["new"]` — save as `red-1.1.txt`
- [ ] 1.2 GREEN: `readStateFile()` + `StateUnreadableError` in `state.mjs`; `loadState()`,
      `diskRevision()` and `saveState()`'s pre-image read use it (D1); `STATE_UNREADABLE_EXIT_CODE = 10`
      in `constants.mjs`; `conductor.mjs`'s catch maps it with the D2 message; `init()` loads before
      `ensureGitignore()` when the file exists. Verify: 1.1 passes, full suite green
- [ ] 1.3 RED (lands with 1.4): an absent `state.json` — all four hooks (`brief`, `snapshot`,
      `commit-nudge`, `gate-guard`) exit 0 with empty stdout and create no file (REGRESSION GUARD half,
      passes today); and `--force` over an unreadable disk file: load readable state in-process, replace
      the file with unparseable bytes, `saveState` with `--force` on argv → throws
      `StateUnreadableError` and the bytes are unchanged. Today the forced save overwrites — save as
      `red-1.3.txt`
- [ ] 1.4 GREEN: the strict disk read inside `saveState()` refuses before the `--force` branch is
      consulted. Verify: 1.3 passes
- [ ] 1.5 REGRESSION GUARD (rewrite, lands with 1.2): `scripts/test/conductor-33.test.mjs`
      `gh-111: an UNREADABLE state.json does not fail the verb either` — keep its intent (the activity
      observer never breaks the run), invert its assertion: `owners` exits 10, stderr carries the
      refusal message and no stack trace. Say in the commit message that the old assertion encoded the
      removed behaviour

## 2. Hooks never write over an unreadable state file

- [ ] 2.1 RED (lands with 2.2): in the new test file — (a) active epic with `reconcileNeeded`,
      conflict marker prepended, `gate-guard` with `{}` on stdin → exit 2, stderr names the file and a
      `git` command (today: exit 0); (b) `epics: {}` → exit 2, no `TypeError` in stderr (today: exit 1
      with a stack); (c) `brief` on unparseable → exit 0, JSON `additionalContext` names the file and
      remedy, contains none of the epic ids / `available` / next-up text, and `.conductor/` has no new
      or changed file incl. the conflict latch (today: a normal brief of the empty guess); (d) a commit
      lands, file corrupted, `commit-nudge` → exit 2, `state.json`/`PROJECT.md`/`detours.log`
      byte-identical (today: exit 0 and `PROJECT.md` re-rendered); (e) `snapshot` → exit code not 0 and
      not 2, `PROJECT.md` and `brief.txt` unchanged/absent (today: exit 0, renders); (f) the refusal
      raised from somewhere other than the hook's own load — unit-test the top-level verb→status
      mapping with `gate-guard` and `commit-nudge` and a `StateUnreadableError` thrown from a stub,
      expecting 2 (today: no mapping exists). Save `red-2.1.txt`
- [ ] 2.2 GREEN: the per-verb mapping at `conductor.mjs`'s top-level catch per design D3
      (`gate-guard`/`commit-nudge` → 2, `brief` → warning-only JSON + 0, all else incl. `snapshot` → 10),
      plus hook-local handling where it keeps `snapshot()` from reaching `render()` and `commitNudge()`
      from reaching heal/render/detour log. `lessonAdvice()` untouched. Verify: 2.1 passes. Touch only
      the load at the top of `gateGuardCheck()` — the reconcile/tracker branches belong to
      `gates-bind-to-verified-evidence`
- [ ] 2.3 `hooks/README.md` gate-guard line: add that an unreadable `state.json` also blocks, and how
      to fix it (lands with 2.2 — the hook's documented behaviour changes in that commit)

## 3. Concurrent saves are serialised and flushed

- [ ] 3.1 RED (lands with 3.2): in the new test file — 16 concurrent `add-epic` child processes
      (spawned, not sequential `execFileSync`) with distinct ids; assert every exit-0 invocation's id is
      in `state.json`, every other exits 9, and no stderr contains `did not persist`. Run it 3 times in
      the test (the race is probabilistic; today 3/3 manual runs lost updates). Plus an in-process fs spy:
      wrap `fs.fsyncSync` and `fs.renameSync` on the default `node:fs` object, `saveState` a changed
      state, assert an fsync is recorded before the rename of the temp path. Save `red-3.1.txt`
- [ ] 3.2 GREEN: the lock in `state.mjs` per design D4 (acquire with `"wx"`, content + fsync, critical
      section, ownership check before rename, temp-file fsync, best-effort directory fsync, release that
      unlinks only our lock, `process.on("exit")` handler); constants `STATE_LOCK_WAIT_MS`,
      `STATE_LOCK_POLL_MS`, `STATE_LOCK_STALE_MS`; lock timeout → `StateConflictError` naming the holder
      (interactive) / `recordConflict({verb, expected, found})` with `found` the disk revision, never a non-revision (skip). Replace `saveState()`'s "A lockfile
      was rejected…" comment with the reversal reasoning. Verify: 3.1 passes
- [ ] 3.3 RED (lands with 3.4): write a live lock (this test process's own pid, this host, now), then
      run `update-epic <id> --status active` as a child → exits 9 within the wait budget + slack,
      `state.json` byte-identical, stderr names the pid; same with `--force` → does not write; a
      hook-driven save through `saveHookHeal()` with the held lock → `{ok:false}`, sidecar gains an
      entry naming the verb. Save `red-3.3.txt`
- [ ] 3.4 GREEN: completes with 3.2's wait/refuse path if 3.2 did not already make 3.3 pass; if it
      did, say so in the commit and land 3.3 as REGRESSION GUARD. Verify: 3.3 passes
- [ ] 3.5 RED (lands with 3.6): a verb path that saves then calls `process.exit(1)` (use the
      `update-epic` post-write read-back exit, or an in-process child script importing `saveState`) → the
      lock file existed during the save (observed via the fs spy: an exclusive create of
      `.conductor/state.json.lock` before the rename) AND no `.conductor/state.json.lock` afterwards.
      The positive half is what makes it fail today. Save `red-3.5.txt`
- [ ] 3.6 GREEN: the exit handler releases. Verify: 3.5 passes
- [ ] 3.7 `ensureGitignore()` gains `.conductor/state.json.lock`; extend the existing gitignore test.
      Verify: the test asserts the entry after `init` and after `upgrade` on a repo lacking it

## 4. A stale lock is broken, a live one is waited for then refused

- [ ] 4.1 RED (lands with 4.2): a lock recording a dead pid on this host (spawn a child, record its
      pid, wait for it to exit) → `add-epic` exits 0, epic present, and the pre-placed lock file is gone;
      a lock with unparseable content and `mtime` set past `STATE_LOCK_STALE_MS` via `fs.utimesSync` →
      save lands and the pre-placed lock file is gone; a lock recording a live pid on a DIFFERENT host
      string, fresh → refused as conflict (age is the only judge off-host). None of the three passes
      vacuously today: the engine never removes a pre-placed lock file, and never refuses on one. Save
      `red-4.1.txt`
- [ ] 4.2 GREEN: staleness judgement and the rename-verify-link break of design D4. Verify: 4.1 passes
- [ ] 4.3 REGRESSION GUARD: the break never removes a fresh lock — unit-test the break helper with an
      injected sequence where the lock is replaced between judgement and rename; assert the fresh lock
      is present afterwards (restored by `linkSync`) and the breaker went back to waiting

## 5. Advisory-claim lifetime is bounded; an unreadable expiry reads as expired

- [ ] 5.1 RED (lands with 5.2): `claim x --session s1 --ttl 1e12` → non-zero, stderr names the
      maximum, `state.json` byte-identical (today: writes, then `RangeError`); `claim --repo --session s1
      --ttl 1e12` → `session-claim.json` not created; `--ttl <CLAIM_MAX_TTL_MINUTES>` accepted and the
      report names an expiry. Save `red-5.1.txt`
- [ ] 5.2 GREEN: `CLAIM_MAX_TTL_MINUTES` in `constants.mjs`; `validTtlMinutes()` in `claim-shape.mjs`;
      `ttlFrom()` refuses with it. Verify: 5.1 passes
- [ ] 5.3 RED (lands with 5.4): write `ttlMinutes: 1000000000000` onto a stored epic claim directly in
      the fixture; `owners` exits 0 and shows the claim STALE with no literal `null`; `integrity` exits
      normally reporting it expired at an unreadable time; `claim x --session s2` succeeds without
      `--steal` reporting the prior claim expired; same poisoned value in `session-claim.json` → `owners`
      exits 0, repository STALE. Also a stored `ttlMinutes` of `CLAIM_MAX_TTL_MINUTES + 1` reads
      expired. Save `red-5.3.txt` (today: all crash with `RangeError`)
- [ ] 5.4 GREEN: `claimExpiry()` returns null for an out-of-bound TTL and for an unrepresentable date;
      `formatOwners()` renders null as `an unreadable time`. Verify: 5.3 passes

## 6. The managed rules block is located by whole-line markers and written literally

- [ ] 6.1 RED (lands with 6.2): new `scripts/test/managed-rules-block.test.mjs` — the reviewer's
      repro verbatim: a prose line with `` `<!-- BEGIN pm-conductor rules` `` in inline code, then
      `## My rules` with a sentinel line, then a real block; `write-rules` → exit 0, every byte before
      the BEGIN marker line identical, exactly one BEGIN marker line (today: sentinel gone, `refreshed`).
      Plus: orphan BEGIN with hand text after → exit non-zero, file byte-identical, stderr names the file
      and the line number; two well-formed pairs via `set-review-mode --mode thorough` → non-zero,
      byte-identical, all four line numbers, no `refreshed` in stderr; one pair between hand text →
      outside bytes identical, block content new; no markers → appended. Save `red-6.1.txt`
- [ ] 6.2 GREEN: line-based `writeRules()` and `RulesBlockAmbiguousError` per design D6, mapped to
      exit 1 in `conductor.mjs`'s catch with the refusal message. No `.replace(` on the splice path.
      Verify: 6.1 passes, and the existing rules-block tests (`conductor-01`, `platform.test.mjs`, the
      `rules-0.26.0-*` fixture comparisons) still pass unmodified
- [ ] 6.3 RED (lands with 6.4): a sentinel line above one block, then write a block containing
      `` $` ``, `$&` and `$'` (drive it through `set-tracker --system github-issues --repo` with such a
      value if 0.3 confirms the argv change still accepts it; otherwise call `writeRules` in-process
      with a stubbed tracker) → sentinel occurs once, each sequence present verbatim. Today: the prefix
      is spliced in (sentinel ×3). Save `red-6.3.txt`
- [ ] 6.4 GREEN: covered by 6.2's no-`replace` splice; if 6.3 already passes after 6.2, land it as
      REGRESSION GUARD in 6.2's commit and say so
- [ ] 6.5 RED (lands with 6.6): an all-CRLF `CLAUDE.md` with one block → after `write-rules` every
      line ends CRLF (today: 3 of 380). Save `red-6.5.txt`
- [ ] 6.6 GREEN: terminator detection per D6. Verify: 6.5 passes
- [ ] 6.7 RED/GREEN or justified omission: `evals/observe.py` locates the block by the substring
      `RULES_BEGIN` (line 22) — a second reader of the same markers. Either make it match whole lines
      the same way, or record in the sweep (7.1) why an eval-harness reader may differ

## 7. Required task items

- [ ] 7.1 **Call-site completeness sweep** — derived with `rg` from the tree at sweep time, never from
      design.md: every caller of `loadState`, `readJSON`, `diskRevision`, `saveState`, `isInitialized`,
      `conflictExitCode`, `StateUnreadableError`, `STATE_UNREADABLE_EXIT_CODE`, `saveHookHeal`,
      `recordConflict`; every hook entry (`gateGuardCheck`, `brief`, `snapshot`, `commitNudge`,
      `lessonAdvice`) and the activity-log chokepoint in `conductor.mjs`; `claimExpiry`, `isLiveClaim`,
      `ttlFrom`, `validTtlMinutes`, `CLAIM_MAX_TTL_MINUTES`, `readRepoClaim`, `ownerRows`,
      `formatOwners`; `writeRules` and every reader of `RULES_BEGIN_PREFIX`, `RULES_BEGIN`, `RULES_END`
      (incl. `evals/observe.py`). For each: where the new rule holds, where it does not, and why — in
      particular that `readJSON`'s other callers keep their fallback deliberately. DATA references:
      `claim.ttlMinutes` (written by `makeClaim`, read by `claimExpiry`, removed by `unclaim` and
      archive-clears-claim) and the lock file's `{pid, host, acquiredAt}` plus the path
      `.conductor/state.json.lock` — every writer (acquire), reader (staleness, ownership check) and
      remover (release, exit handler, break); confirm `purge-logs`, `isConductorOwnFiles`-style
      classifiers and `VERB_EFFECTS` `writes` strings need no entry, or add one. Parity ledger: this
      change adds no file under `commands/`, `agents/`, `skills/`, `hooks/` or `.claude-plugin/`, and the
      new OpenSpec capability `managed-rules-block` is not a parity-ledger capability; confirm
      `node --test scripts/test/parity.test.mjs` is green (14/14 when this list was written)
- [ ] 7.2 **Inverse of every operation added** — acquire ↔ release (shipped: normal path, exit handler,
      stale break); stale break ↔ restore of a wrongly moved fresh lock (shipped: `linkSync`);
      `ensureGitignore` add ↔ remove (not shipped — `ensureGitignore` never removes any entry it manages,
      and a stale ignore line is harmless); rules-block append/refresh ↔ removal (not shipped — no verb
      has ever removed the block; the marker says it is safe to delete by hand); a refused TTL / a
      refused state file / a refused block write have no inverse because they write nothing. Name and
      justify any further operation the sweep finds
- [ ] 7.3 **Verify against the commit** — for every task commit, `git show --stat <sha>` and assert each
      file the task claims (including its `red-<task>.txt`) is in THAT commit
- [ ] 7.4 **Attribute every commit** at the moment it lands:
      `update-epic state-file-refuses-to-guess --attribute-commit <sha>`. The commit that moves the change
      under `openspec/changes/archive/` is NOT attributed
- [ ] 7.5 **Dispositions** <!-- pm:lifecycle --> — the four superseded finding epics
      (`state-json-unparseable-loads-as-empty`, `state-write-race-loses-updates`,
      `claim-ttl-overflow-crashes-readers`, `rules-block-writer-destroys-hand-content`) already carry
      `disposition.outcome: superseded` (read from `state.json` when this list was written) and this
      epic's `supersedes` links to each — nothing more is owed for them. This change ends with 9.2's
      exact invocation; never `remove-epic`
- [ ] 7.6 **Route what the work taught** — name each as a PRACTICE (register an epic, with its
      evidence), TOOLING FRICTION (`/pm:feedback [bug|feature] "<summary>"`), or a PROCESS FAILURE (a
      lesson in `docs/lessons/` with `trigger`, `cost`, `enforced_in`). Candidates to consider, not
      presumptions: the 0.26.0 lock rejection that measurement overturned; a test (gh-111) that encoded
      the defect as the contract

## 8. Docs (after Gate 2 is clean)

- [ ] 8.1 `commands/gate-guard.md` — an unreadable `state.json` blocks Edit/Write/NotebookEdit; the git
      remedies; that Bash is not blocked
- [ ] 8.2 `commands/claim.md` — the `--ttl` maximum; an unreadable or over-bound stored claim reads as
      expired
- [ ] 8.3 `commands/init.md`, `commands/upgrade.md`, `commands/tracker.md`, `commands/review-mode.md` —
      the rules-block refusal (what arrangement triggers it, the line-number message, that other writes
      of the verb stand) and the unreadable-state refusal with exit 10
- [ ] 8.4 `README.md` — a troubleshooting entry for a conflicted/damaged `state.json` (exit 10, the git
      remedies, gate-guard blocks meanwhile) and for a refused rules-block write; the lock file in any
      list of `.conductor/` files
- [ ] 8.5 `skills/conductor/SKILL.md` — exit codes 9 vs 10, the lock and its stale rule in the
      state-write section, the rules-block refusal
- [ ] 8.6 `CHANGELOG.md` `[Unreleased]` — one entry per requirement, naming the reversal of the 0.26.0
      lock decision. The version bump, the Mintlify Changelog page and Real Numbers belong to the
      0.44.0 release cut
- [ ] 8.7 Full suite green (`node --test scripts/test/*.test.mjs`), output written to a file and read
      from the file

## 9. Gates and close

- [ ] 9.1 Gate 2 — two fresh-context lenses over the committed range (one: spec alignment and the
      call-site sweep's completeness; two: concurrency and failure-path correctness of the lock and the
      hooks), fix Critical and Important, then
      `record-gate-review state-file-refuses-to-guess --gate 2 --verdict pass --reviewer "<identity>"
      --base-sha <parent of first attributed> --head-sha <last attributed>`
- [ ] 9.2 Archive this change <!-- pm:lifecycle --> — `/opsx:archive state-file-refuses-to-guess`, then
      `update-epic state-file-refuses-to-guess --status archived --outcome delivered --no-deferrals`,
      swapping `--no-deferrals` for `--deferral "<epicId>:<section>"` per deferral registered while the
      work ran, or `--declined-deferral "<what>:<why not>"` per deliberate non-doing
