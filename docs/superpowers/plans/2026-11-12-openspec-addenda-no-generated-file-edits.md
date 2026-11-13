# openspec-addenda-no-generated-file-edits — pm stops editing OpenSpec's generated files and carries its clause where `openspec update` cannot erase it

Epic `gh-cfdude-pm-262` (GitHub #262; lane `superpowers`, kept; review mode `standard`; estimate 6-8 h). Also carries the
cheapest slice of #266 (task 8, conditional) and the relocation of the #261 guardrails (task 6, droppable). Batch into the
next minor release; no patch (cadence memory "slower, meatier"). Stops before any gate record: the orchestrator owns the
bookkeeping task (13).

Source: investigation note `/private/tmp/claude-501/-Users-robsherman-Documents-Repos-pm/9adc0bf5-0482-43ea-87b9-2f805067af02/scratchpad/issue-262-plan.md`
(not committed; its conclusions are restated and re-verified here).

## Owner decisions (fixed; this plan builds them and does not reopen them)

1. pm STOPS editing OpenSpec-generated files. Its clause lives in a new "OpenSpec addenda" section of the managed rules block,
   emitted only when `openspec/` exists, about 80 tokens for the clause plus practice line (measure with
   `node scripts/conductor.mjs overhead` and `rules --sections`).
2. Delete the hand edit from this repo's two generated files.
3. A read-only check reports the clause missing or residual. No new `openspec` argv; the engine never runs openspec.
4. `commands/upgrade.md` step 4 flips to: `openspec update` FIRST, then `/pm:upgrade`, as the interim. The HOLD wording in
   `scripts/lib/tool-currency.mjs` that contradicts it is softened in the same commit as the doc.
5. The suspicion that `openspec update` overwrote pm's CLAUDE.md content is UNVERIFIED and stays listed as such (section below).
6. Engine stays zero-dependency and an instruction layer. No new verb, no `state.json` change, so no MIGRATIONS entry.

## Facts re-verified on disk 2026-11-12 (HEAD f7338ab8, branch dev, tree clean, `openspec --version` 1.17.0)

Held:
- `.claude/skills/openspec-archive-change/SKILL.md:164` and `.claude/commands/opsx/archive.md:160` carry the clause
  "a spec the sync deliberately kept and reported is also a match". `rg -n "deliberately kept" .claude commands skills scripts/lib CLAUDE.md`
  finds it nowhere else (the one other hit, `scripts/lib/tracker.mjs:158`, is unrelated prose). The clause is not shipped.
- Everything else in `.claude/skills/openspec-archive-change/SKILL.md` is stamped `generatedBy: "1.15.0"` (line 10).
- Engine file writers: `scripts/lib/rules.mjs:1373` (rules target) and `:1411`; none targets a generated OpenSpec file.
  `scripts/lib/tool-currency.mjs` only reads. Its header pins argvs `--version` and `validate <id> --strict`, enforced by the
  spawn-count source scan at `scripts/test/assert/tool-currency.test.mjs:57` (exactly two spawn sites).
- `OPENSPEC_GENERATED_PATHS` at `tool-currency.mjs:54`; sole callers of `openspecCurrencyLines()`: `scripts/lib/briefing.mjs:178`,
  `scripts/lib/migrations.mjs:288`.
- Markers `RULES_BEGIN` / `RULES_END` at `scripts/lib/constants.mjs:1630-1631`; OpenSpec's own `<!-- OPENSPEC:START -->` markers
  appear nowhere in pm's CLAUDE.md, scripts, commands or skills (from the note; the dist/ source reading is not repeated here).
- Rules block 40,109 bytes, about 10,028 tokens (bytes/4), `rules --sections` total (re-run today, unchanged).
- Lesson-advice hook matcher is `Bash|Edit|Write|NotebookEdit` (`hooks/hooks.json:35`), and `detect:` supports `tool` plus
  `pathEndsWith` for Edit/Write (`skills/lessons/SKILL.md` "detect"). **The note's claim that the hook fires only on Bash is wrong.**

No longer holds, or moved:
- Line drift: `generatedByOf` is `tool-currency.mjs:190`, `projectOpenspecVersion` `:211` (note: 180-205), `openspecCurrencyLines`
  `:293` (note: 296), the HOLD line is `:320` (note: 321), `generatedArtifactsTracked` `:246` and `openspecCurrency` `:266` hold.
  The repo-local guardrail section in `CLAUDE.md` starts at line 636 (note: ~633). `commands/upgrade.md` step 4 is lines 77-103 and the HOLD
  bullet is line 89 (held). README OpenSpec-update paragraph begins `README.md:1868` (held).
- Note risk 7 ("uncommitted work in the pm tree") is gone: `git status` is clean. The HOLD still applies, because
  `openspec/changes/project-boards` is still an active change.
- Note headline 3 ("ab1e1552 RE-APPLIED the clause after the update erased it") is NOT supported by history: `git log -S"deliberately kept and reported" -- .claude`
  returns only `543a38fb`. `ab1e1552` is a 1.13.2 -> 1.15.0 update commit whose message says it kept the allowance; no commit in history removed
  and re-added the clause. Treat "erased once on 2026-10-30" as UNVERIFIED (the loss may have been in a working tree and recovered before commit).
  The plan does not depend on it; the evidence line in task 12 says so.
- Note section 3's "tracker 6,209 B" section is now "GitHub issue sync (cfdude/pm)" 5,805 B in the live block. Irrelevant to the budget.
- Non-test callers of `rulesBlock(` are three, not one: `scripts/lib/rules.mjs:1334` (writeRules), `scripts/conductor.mjs:529`, `scripts/lib/overhead.mjs:181`.
  Any new rulesBlock input must be passed at all three or `overhead` and the verb at conductor.mjs:529 disagree with `write-rules`.

UNVERIFIED, carried forward (no task builds on any of them):
- That `openspec update` overwrote pm's `CLAUDE.md` content. The note's reading of dist/core/legacy-cleanup.js says it strips only
  `<!-- OPENSPEC:START -->` blocks; task 1 adds one cheap on-disk check (`git log -S` over the guardrail section) and the question to Rob stays open.
- Whether 1.15.0/1.16.0 content-compare hand-edited skills (1.17 does, per update.js:559 in the note).
- The `openspec update --dry-run --json` output shape (nobody ran it). It is used only as an INSTRUCTION in docs, never parsed.
- That the two archive files are the only pm-authored passages inside the 24 tracked generated files (task 1 checks).

## Design

**Registry and check (`scripts/lib/openspec-addenda.mjs`, new, node built-ins only).**
- `PM_OPENSPEC_ADDENDA`: one entry, `{ id: "archive-sync-kept-allowance", needle: "a spec the sync deliberately kept and reported is also a match" }`.
- Pure core `openspecAddendaFindings({ hasOpenspec, generatedFiles: [{path, text}], blockText })` returns
  `{ residual: [{id, path}], missing: [{id}] }`. Unit rung, no filesystem.
  - RESIDUAL: a registry needle is present in any generated file (`.claude/skills/openspec-*/SKILL.md`, `.claude/commands/opsx/*.md`). Meaning: pm text is
    inside a file `openspec update` rewrites. Fires in this repo until task 5 lands.
  - MISSING: `hasOpenspec` is true and the managed block in the rules target lacks the "OpenSpec addenda" heading. Meaning: the clause has no surviving home;
    run `/pm:upgrade` (or `write-rules`) to refresh the block. This is the #262 failure reported against the HOME, not against the generated file: a generated file
    that lacks the clause is the DESIRED state and must stay silent (open question 1 records this reading of "missing").
  - Silent when `openspec/` is absent, when both lists are empty, or when no rules target exists.
- Thin wrapper `openspecAddendaLines()`: reads the files with `fs`, joins nothing it read into the output except the registry id and the repo-relative path,
  and passes every line through `escapeControls`. Emits instruction text only; the last line of any finding tells the agent to run `openspec update --dry-run` to see
  what else the update would rewrite (instruction, never executed by the engine).
- Surfaces: one shared emitter called from `briefing.mjs` beside line 178 and `migrations.mjs` beside line 288, same rule as `openspecCurrencyLines` (a finding that reads
  one way in the brief and another at `/pm:upgrade` is worse than none).

**Rules block section.** `openspecAddendaSectionText({ hasOpenspec, present: { onboard, verify, bulkArchive } })` returns "" when `!hasOpenspec`, else:
heading `## OpenSpec addenda`; the archive clause as an instruction that overrides step 6's check in the generated archive skill; the practice sentence
("`openspec update` rewrites `.claude/skills/openspec-*` and `.claude/commands/opsx/*`; carry any pm clause here, never there"). Task 6 adds up to three guardrail
bullets, each only when its generated skill directory exists. `rulesBlock` gains an 11th parameter `openspecSection = ""` (default empty, so every existing
byte-pinned fixture is unchanged), placed after the Boards section and before "Re-read the source" like Boards. It is VERB-REFRESHED (written at `init`,
`write-rules`, `upgrade`), outside `CONDITIONAL_SECTIONS`, because its gate is the filesystem (`openspec/` present), not a `state.json` input; the coverage guard
at `scripts/test/unit/rules-conditional-coverage.test.mjs` varies only the four state inputs and must stay green, which is why the default is empty.
The section reader is `currentOpenspecAddendaSection()` in `openspec-addenda.mjs`, passed at all three `rulesBlock(` call sites.

**Budget.** Clause + heading + practice sentence capped at `OPENSPEC_ADDENDA_MAX_BYTES = 400` (about 100 tokens by bytes/4; target 330 B / 80 tokens). With all
three guardrail bullets, total cap 1,200 B (about 300 tokens). Both only in repos with `openspec/`; a repo without it pays 0 bytes.

**Docs.** `commands/upgrade.md` step 4 reordered and reworded; `scripts/lib/tool-currency.mjs` HOLD wording softened in the same commit; README paragraph;
`skills/dogfooding/SKILL.md` one sentence; changeset fragment. Mintlify is a separate later pass (`mintlify-doc-sync`), not in this plan.

## Inverses of every operation this plan adds or modifies (required gate item 1)

| Operation | Inverse | Shipped? |
|---|---|---|
| Emit the "OpenSpec addenda" section when `openspec/` exists | Stop emitting when `openspec/` is gone | Yes, automatically: the block is regenerated wholesale, so the next write drops it. Task 4 tests both directions on a rendered block. |
| Guardrail bullets per generated skill present | Drop a bullet when its skill directory is gone | Yes, same mechanism, tested in task 6. |
| Registry entry in `PM_OPENSPEC_ADDENDA` | Remove the entry | Not shipped, justified: the entry must stay while any repo may still carry the legacy hand edit. Retirement criterion recorded in the module header (remove after the fleet shows zero residual findings for two releases). |
| RESIDUAL / MISSING report | None: read-only, writes nothing | n/a, justified. |
| Delete the clause from the two `.claude/` files | Re-add it | Deliberately none: re-adding is the practice this epic ends. A file is restored to pristine by `openspec update`, which is outside pm. |
| Step 4 order flip in `commands/upgrade.md` | None | Doc-only; the HOLD bullet is replaced, not left beside it. |
| HOLD wording softening | None | Doc/text only. |
| `rulesBlock` 11th parameter | Passing "" | Yes: the default is the inverse and every legacy caller keeps it. |

## File map

| File | Change |
|---|---|
| `scripts/lib/openspec-addenda.mjs` | NEW: registry, pure findings, section text, fs wrapper, `openspecAddendaLines()`, `currentOpenspecAddendaSection()` |
| `scripts/lib/rules.mjs` | `rulesBlock` 11th param + emission; `writeRules` passes the reader (line 1334) |
| `scripts/conductor.mjs` | line 529 `rulesBlock(` call passes the reader |
| `scripts/lib/overhead.mjs` | line 181 `rulesBlock(` call passes the reader |
| `scripts/lib/briefing.mjs`, `scripts/lib/migrations.mjs` | call `openspecAddendaLines()` beside the currency lines (178, 288) |
| `scripts/lib/tool-currency.mjs` | HOLD wording (line 320) and the "never accept it blind" line; task 8 filter (conditional) |
| `commands/upgrade.md` | step 4 |
| `README.md` | OpenSpec-update paragraph (about 1868-1890) |
| `skills/dogfooding/SKILL.md` | one sentence (already claimed by the parity ledger, `docs/parity-ledger.json:129`) |
| `.claude/skills/openspec-archive-change/SKILL.md`, `.claude/commands/opsx/archive.md` | delete the clause (task 5) |
| `CLAUDE.md` (outside the managed block only) | task 6: shrink the repo-local guardrail section to a pointer; the block itself is regenerated with `write-rules`, never hand-edited |
| `.changesets/gh-cfdude-pm-262.md` | NEW fragment |
| `docs/lessons/<new>.md` | NEW lesson (task 12) |
| tests | `scripts/test/unit/openspec-addenda.test.mjs`, `scripts/test/unit/openspec-addenda-rules.test.mjs`, `scripts/test/assert/openspec-addenda.test.mjs`, `scripts/test/assert/upgrade-order-doc.test.mjs`; the existing `scripts/test/functional/tool-currency.test.mjs` and its twin `scripts/test/assert/tool-currency.test.mjs` change for the HOLD text |
| `docs/parity-ledger.json` | no new claim expected (no new file under commands/agents/skills/hooks/.claude-plugin); task 9 proves it |
| `docs/superpowers/plans/2026-11-12-openspec-addenda-no-generated-file-edits/mutation-evidence.txt` | NEW (task 10) |

Rungs: every new test is unit (values over injected readers) or assert (bytes of a tmp repo). No new functional test. Staged paths in a certify bucket's
subject (`rules.mjs`, `tool-currency.mjs` almost certainly) still demand `certify functional`; see task 9.

## Tasks

Branch `epic/gh-cfdude-pm-262` from `dev`. Every commit: conventional message, `Claude-Session:` footer, no `--no-verify`. One logical change per task;
each task below is independently committable and revertible. Agents do not run state-writing verbs (task 13 is the orchestrator's).

- [ ] **1. Baseline and mechanical enumeration (no commit).**
  - [ ] 1.1 Record BASE: `git rev-parse HEAD` (expected `f7338ab8` unless dev moved). Save to `scratchpad/base.txt`.
  - [ ] 1.2 Baseline size: `node scripts/conductor.mjs rules --sections > "$SCRATCH/sections-before.txt"` and `node scripts/conductor.mjs overhead > "$SCRATCH/overhead-before.txt"`. Expect total 40109 bytes unless dev moved.
  - [ ] 1.3 Writers to generated paths (expect zero engine hits):
    `rg -n "\.claude/skills/openspec|\.claude/commands/opsx|OPENSPEC_GENERATED_PATHS" scripts/lib scripts/conductor.mjs commands skills hooks --glob '!scripts/test/**'`
  - [ ] 1.4 Other pm-authored passages in the 24 tracked generated files: `git ls-files .claude | rg "openspec|opsx"`, then in a THROWAWAY COPY outside the repo
    (`cp -R` to the scratchpad; never run `openspec update` inside `~/Documents/Repos/pm`, which has `project-boards` in flight) run `openspec update`, then
    `diff -r` the copy's `.claude/skills/openspec-* .claude/commands/opsx` against the repo's. Expected: the only non-stamp differences besides the 1.15 -> 1.17 changes are the two clause lines.
    Record any other pm-authored passage found; it becomes an additional registry entry in task 3.
  - [ ] 1.5 Cheap check of the CLAUDE.md suspicion: `git log --oneline -S"OpenSpec 1.15 workflows that fight" -- CLAUDE.md` (history shows the section was added in 418f5751 and no commit removed it).
    Report the result against the UNVERIFIED claim; do not conclude beyond it.
  - [ ] 1.6 Name the three `rulesBlock(` non-test call sites: `rg -n "rulesBlock\(" scripts --glob '!scripts/test/**'` (expect `rules.mjs:1334`, `conductor.mjs:529`, `overhead.mjs:181`).
  - [ ] 1.7 Find tests that pin block size or section counts so task 4 knows what to update: `rg -n "MAX_BYTES|budget|40[0-9]{3}|Object.keys\(.*sections" scripts/test/unit/managed-rules-block.test.mjs scripts/test/assert/managed-rules-block.test.mjs scripts/test/unit/overhead*.test.mjs scripts/test/assert/overhead*.test.mjs`.

- [ ] **2. RED: the pure check and the section text.** Files `scripts/test/unit/openspec-addenda.test.mjs` (uses `unitTest()`; injected readers, no fs) and `scripts/test/unit/openspec-addenda-rules.test.mjs`. Cases:
  - [ ] 2.1 `openspecAddendaFindings`: needle present in a generated file -> one `residual` naming `id` and the path; present in two files -> two entries, order stable (sorted by path).
  - [ ] 2.2 needle absent from every file but block lacks the heading and `hasOpenspec` -> `missing` with the id; block carries the heading -> empty.
  - [ ] 2.3 `hasOpenspec: false` -> empty regardless of files and block. No generated files and block with heading -> empty.
  - [ ] 2.4 `openspecAddendaLines()` rendering over the findings: control characters in a PATH (`"a\u001b[31mb"`) are escaped, and file CONTENT never appears in any line (assert the line set contains no substring of the file text beyond the registry id).
  - [ ] 2.5 Clean state renders `[]` (the clause is never "reported" when everything is fine).
  - [ ] 2.6 `openspecAddendaSectionText({ hasOpenspec: true })` begins `## OpenSpec addenda`, contains the needle sentence, contains the practice sentence with both generated paths, is at most `OPENSPEC_ADDENDA_MAX_BYTES` (400) bytes, and ends with no trailing blank line; `hasOpenspec: false` returns "".
  - [ ] 2.7 `rulesBlock(..., openspecSection)`: default (omitted) block is byte-identical to the block before the change (compare with a stored render of the 10-argument call); a non-empty section appears exactly once, between "## Boards" and "## Re-read the source before an epic becomes the work"; two renders are byte-identical (idempotent).
  - [ ] 2.8 Run `node --test scripts/test/unit/openspec-addenda.test.mjs scripts/test/unit/openspec-addenda-rules.test.mjs`; save the failing output to `docs/superpowers/plans/2026-11-12-openspec-addenda-no-generated-file-edits/red-run.txt`. Write each RED note task-relative ("fails after 3.1"), never "fails today"; re-run it when its own task starts.
  - [ ] 2.9 Commit: `test(openspec-addenda): RED for the check, the section and the rulesBlock input`. If the commit hook refuses a red suite, commit the tests together with task 3 and say so in the commit body (the hook runs the whole assertion half; the repo has no skip).

- [ ] **3. GREEN: `scripts/lib/openspec-addenda.mjs` and its two surfaces.**
  - [ ] 3.1 Create the module: registry, `openspecAddendaFindings`, `openspecAddendaSectionText` (clause + practice sentence only), the fs wrapper, `openspecAddendaLines`, `currentOpenspecAddendaSection`, `OPENSPEC_ADDENDA_MAX_BYTES`. Imports: `node:fs`, `node:path`, `engineRoot` (same source as `tool-currency.mjs:48`), `escapeControls`. NO import of `node:child_process`, NO `spawn`/`exec`. Header comment restates the instruction-layer law and the registry retirement criterion.
  - [ ] 3.2 Wire `openspecAddendaLines()` into `scripts/lib/briefing.mjs` (beside :178) and `scripts/lib/migrations.mjs` (beside :288), appended after the currency lines, through the same line sink with `escapeControls` already applied.
  - [ ] 3.3 Do NOT touch `scripts/test/assert/tool-currency.test.mjs:57`; it must pass unmodified (exactly two spawn sites, no new argv). Run it: `node --test scripts/test/assert/tool-currency.test.mjs`.
  - [ ] 3.4 Run only the task-2 unit files plus the three touched modules' existing tests: `rg -l "briefing|migrations" scripts/test/unit scripts/test/assert | xargs node --test`. Task 2.7's block cases stay red until task 4; note which ones.
  - [ ] 3.5 Commit: `feat(openspec-addenda): read-only check for pm text inside, or missing from, the OpenSpec surfaces`. Staged exactly the module, briefing.mjs, migrations.mjs and the task-2 unit files if not yet committed.

- [ ] **4. The rules block section (RED already written in 2.6-2.7; add the assert half here).**
  - [ ] 4.1 RED: `scripts/test/assert/openspec-addenda.test.mjs` (tmp repo from `../fixtures/assert-harness.mjs`): (a) repo with `openspec/`: after `init` then `write-rules` the CLAUDE.md block contains `## OpenSpec addenda` exactly once and the needle sentence; (b) repo without `openspec/`: absent; (c) `rm -r openspec` then `write-rules`: the heading is gone (the inverse); (d) `write-rules` twice: second run leaves the file byte-identical; (e) `rules --sections` lists the heading with a byte size at most 400; (f) `overhead` output for the same repo includes the section (proves overhead.mjs:181 passes it).
  - [ ] 4.2 GREEN: `rulesBlock` 11th parameter `openspecSection = ""`, emitted after the Boards section (`rules.mjs` near the `boardsSection` push) via the same `{{pm:...}}` replace path; `writeRules` (rules.mjs:1334), `scripts/conductor.mjs:529`, `scripts/lib/overhead.mjs:181` pass `currentOpenspecAddendaSection()`.
  - [ ] 4.3 Update only the pinned tests found in 1.7 whose numbers the new default-empty parameter does not already preserve (expect none, since the default is empty); report any you change.
  - [ ] 4.4 Run the rules unit files (`rg -l "rulesBlock" scripts/test/unit | xargs node --test`) and the new assert file. `rules-conditional-coverage.test.mjs` must pass unmodified.
  - [ ] 4.5 Regenerate this repo's block: `node scripts/conductor.mjs write-rules` (this repo has `openspec/`, so the block gains the section). Review `git diff CLAUDE.md`: the ONLY change is the new section inside the markers. Do not edit CLAUDE.md while certify or a hook is running.
  - [ ] 4.6 Stage exactly, `node scripts/test/drift.mjs --phase pre-commit` (it names every demanded certify bucket), certify per task 9, then commit: `feat(rules): carry pm's OpenSpec clause in the managed block, emitted only when openspec/ exists`.

- [ ] **5. Dogfood cleanup: stop editing generated files in this repo (separate commit, repo maintenance).**
  - [ ] 5.1 RED: add to the assert file (task 4.1) a case over THIS repo's real files: neither `.claude/skills/openspec-archive-change/SKILL.md` nor `.claude/commands/opsx/archive.md` contains the needle; fails after 4 and before 5.2 (these two files still carry it).
  - [ ] 5.2 Delete the clause fragment `; a spec the sync deliberately kept and reported is also a match` from line 164 of the SKILL.md and line 160 of archive.md with `Edit` (exact fragment, nothing else). Do NOT run `openspec update` in this repo: `openspec/changes/project-boards` is in flight, and the update would also move all 24 files from 1.15.0 to 1.17.0, which is its own diff and its own review.
  - [ ] 5.3 Verify mechanically: `rg -n "deliberately kept" .claude` returns nothing; `openspecAddendaLines()` for this repo prints nothing (run `node scripts/conductor.mjs status` and read the brief).
  - [ ] 5.4 Commit: `chore(openspec): remove pm's hand edit from the generated archive skill and command`. This is a different class of commit from task 4 on purpose.

- [ ] **6. Relocate the #261 guardrails (droppable: decision for Rob, open question 2).**
  - [ ] 6.1 RED (unit): `openspecAddendaSectionText({ hasOpenspec: true, present: {onboard, verify, bulkArchive} })` over the 8 combinations: each bullet appears iff its flag is true; each bullet at most 260 bytes; total at most 1,200 bytes; with no flag true the text equals the task-2 text byte for byte. Bullet content (tightened from `CLAUDE.md:636-655`): never run `/opsx:onboard` (it archives with no gate or disposition); `/opsx:verify` flags `<!-- pm:lifecycle -->` tasks as CRITICAL, a false positive (#261), never tick or unmark to silence it; `/opsx:bulk-archive` records no dispositions, run one `update-epic ... --status archived --outcome ... --no-deferrals` per member afterwards.
  - [ ] 6.2 GREEN: the `present` flags come from `fs.existsSync` of `.claude/skills/openspec-onboard`, `openspec-verify-change`, `openspec-bulk-archive-change` inside the reader (wrapper only; the pure function takes the flags).
  - [ ] 6.3 Shrink the repo-local section at `CLAUDE.md:636-655` (outside the managed block) to a two-line pointer to the managed block, since the block now carries the same rules; regenerate with `write-rules`; keep the heading text so the section is still findable.
  - [ ] 6.4 Certify per task 9; commit: `feat(rules): ship the #261 guardrails in the managed block, gated on the generated skills`.
  - Inverse: a bullet disappears when its skill directory is deleted (6.1 pins it).

- [ ] **7. Upgrade doc and HOLD wording (one commit; the doc and the brief must not contradict).**
  - [ ] 7.1 RED (assert): `scripts/test/assert/upgrade-order-doc.test.mjs` reads `commands/upgrade.md` step 4 and asserts: it says to run `openspec update` BEFORE `/pm:upgrade`; it mentions `openspec update --dry-run` as the read-only preview (replacing "copy aside first"); it states the engine never runs `openspec update`; it no longer contains the text "Do not run `openspec update` yet"; it names the residual and missing lines from task 3. Also assert `OPENSPEC_GENERATED_PATHS` renders in the brief's HOLD line without the word "Do not". Fails after 6 and before 7.2.
  - [ ] 7.2 Edit `commands/upgrade.md` step 4: order flipped ("run `openspec update` first, on a branch or after `--dry-run`, read the diff, then `/pm:upgrade`; the order stops mattering once pm text lives in the block because nothing pm wrote is in the generated files"); keep "pm's ENGINE never runs it"; replace the three bullets with: in-flight change -> update on a branch and review the diff, hold only if it cannot be reviewed; tracked -> `git diff` is the review; untracked -> `--dry-run` first (drop "copy aside"); add the residual/missing lines to the list of what to act on.
  - [ ] 7.3 Edit `scripts/lib/tool-currency.mjs` HOLD text (line 320) to "review before running" instead of an imperative to wait, and the line at 308 ("never accept it blind" stays). Update `scripts/test/functional/tool-currency.test.mjs` and its twin `scripts/test/assert/tool-currency.test.mjs` for the new wording, RED first. `rg -n "HOLD" scripts/test commands README.md skills` lists every place that asserts or repeats the word; change each in this commit.
  - [ ] 7.4 Certify functional per task 9 (these two files are certain triggers); commit with `Twin-Unchanged` ONLY if the twin genuinely did not change (it will, so no trailer): `docs(upgrade): run openspec update first; soften the HOLD that contradicted it`.

- [ ] **8. CONDITIONAL, only if Rob confirms (open question 3): the cheapest #266 slice.** `activeChangeIds()` (imported at `tool-currency.mjs:40`, defined in `scripts/lib/epic-progress.mjs`) is the HOLD's list. Restrict the HOLD to changes with at least one ticked task or that belong to the active epic. RED first in the functional file's assert twin (a fixture with one ticked and two untouched changes names only the ticked one); GREEN; certify; commit `fix(tool-currency): HOLD names only changes with started work (#266)`. Skip entirely otherwise; the softened wording in task 7 stands alone.

- [ ] **9. Docs, parity, changeset, certify order.**
  - [ ] 9.1 README: rewrite the OpenSpec-update paragraph (`README.md:1868-1890`) to match task 7 and add the one-line addenda behaviour; `skills/dogfooding/SKILL.md`: one sentence "A pm clause that must reach an OpenSpec workflow goes in the managed block's OpenSpec addenda section; never edit `.claude/skills/openspec-*` or `.claude/commands/opsx/*`, `openspec update` overwrites them."
  - [ ] 9.2 `.changesets/gh-cfdude-pm-262.md` in the existing format (`* **<headline>.** <body>`): what users see (a managed-block section only in repos with `openspec/`, the residual/missing lines, step 4 order, softened HOLD, the guardrails if task 6 ships) and what does not change (engine never runs openspec). Do not edit `CHANGELOG.md` or `plugin.json`.
  - [ ] 9.3 Parity: `node --test scripts/test/parity.test.mjs`. Expected pass with no ledger edit, because no file under commands/agents/skills/hooks/.claude-plugin is added (only edited). If a file was added, claim it in `docs/parity-ledger.json` in this commit.
  - [ ] 9.4 CERTIFY ORDER (applies to tasks 4, 6, 7, 8 and any later staged subject file): stage exactly; `node scripts/test/drift.mjs --phase pre-commit`; `node scripts/test/certify.mjs functional > "$SCRATCH/certify.txt" 2>&1` (about 4.5 minutes, 8 with rules.mjs); read the TAIL and require the phrase `functional half passed` before committing (`tail -20 "$SCRATCH/certify.txt"`); run `sweeps` only if drift names it; then commit plainly. Any later edit to a staged subject file makes the record stale. Do not edit `CLAUDE.md`, `PROJECT.md` or `.conductor/` while certify runs. Certify runs over the index, so tasks cannot share one run unless committed together; accept one certify per demanding commit (4, 6, 7, 8).
  - [ ] 9.5 Docs commit: `docs(openspec-addenda): README, dogfooding skill and changeset for #262`.
  - [ ] 9.6 Mintlify (`pm-plugin.dev`) is a SEPARATE later pass via the `mintlify-doc-sync` skill; list in the report which pages change (upgrade command page, OpenSpec drift page, changelog).

- [ ] **10. Emitted rules-block size and cost check.**
  - [ ] 10.1 After task 4 and again after task 6: `node scripts/conductor.mjs rules --sections > "$SCRATCH/sections-after.txt"`, `node scripts/conductor.mjs overhead > "$SCRATCH/overhead-after.txt"`; compute the delta against 1.2 (bytes and bytes/4 tokens).
  - [ ] 10.2 Pass criteria: section (clause + practice) at most 400 B, target about 330 B (about 80 tokens); with guardrails at most 1,200 B (about 300 tokens); every other section's byte count identical to the before file; a fresh repo WITHOUT `openspec/` (`init` in an empty git repo) shows 0 bytes added. Report the numbers, noting they are bytes/4 estimates, not model tokens.
  - [ ] 10.3 If the clause alone exceeds 330 B, tighten the wording; if the owner's 80-token figure cannot hold with the practice sentence, report it instead of silently raising the cap (open question 4).

- [ ] **11. REQUIRED GATE ITEM 1: call-site completeness and inverse sweep (derive mechanically, never type the list).** Run and attach the output; state where each rule holds and justify each omission.
  - [ ] 11.1 Every writer to the generated surfaces (rule: pm never writes them): `rg -n "writeFileSync|appendFileSync|copyFileSync|renameSync|rmSync|unlinkSync|mkdirSync" scripts/lib scripts/conductor.mjs --glob '!scripts/test/**'`; each hit's target is a pm-owned path (`rules.mjs:1373/1411` rules target, `store.mjs` conductor files, `subcommands.mjs:118` .gitignore, etc.). Zero hits may resolve to `.claude/skills/openspec-*` or `.claude/commands/opsx/`. Also `rg -n "\.claude/(skills/openspec|commands/opsx)" scripts/lib commands skills` returns only the registry, `OPENSPEC_GENERATED_PATHS` and prose.
  - [ ] 11.2 Every caller of the new rulesBlock input: `rg -n "rulesBlock\(" scripts --glob '!scripts/test/**'` shows exactly the three sites, all passing `currentOpenspecAddendaSection()`; `rg -n "currentOpenspecAddendaSection" scripts | rg -v test` lists all three plus the definition.
  - [ ] 11.3 Every caller of the emitter: `rg -n "openspecCurrencyLines|openspecAddendaLines" scripts --glob '!scripts/test/**'`: both called at the brief and at `upgrade`; justify that `status`/`/pm:status` renders the brief and needs no third call.
  - [ ] 11.4 Every place that restates the HOLD or the step-4 order: `rg -n "HOLD until|Do not run .openspec update|copy .* aside|openspec update" commands README.md skills scripts/lib docs/*.md --glob '!docs/superpowers/**' --glob '!CHANGELOG.md'`; each hit is either changed in tasks 7/9 or justified (historical changelog prose stays).
  - [ ] 11.5 Every place that lists the block's headings and could need the new one: `rg -n "Boards|CONDITIONAL_SECTIONS" scripts/lib scripts/test --glob '!scripts/test/fixtures/**' -l`; `rules --sections`, `overhead` and the coverage guard each checked.
  - [ ] 11.6 Data references: this plan adds no field holding another record's id and no `state.json` field; say so.
  - [ ] 11.7 Inverses: the table above, each row with its test id or its justification.

- [ ] **12. REQUIRED GATE ITEM 8: prove every guard can fail (mutation evidence).** Method: `skills/mutation-pass/SKILL.md`. For each mutant, edit, run the named files, require at least one failure, then revert with `git checkout -- <file>` (verify with `git diff --stat` empty). Save as
  `docs/superpowers/plans/2026-11-12-openspec-addenda-no-generated-file-edits/mutation-evidence.txt` in the format of `docs/superpowers/plans/2026-11-02-mutation-pass-required-item/mutation-evidence.txt` (header, baseline exit 0, one block per mutant with run and KILLED count). Mutants:
  - [ ] 12.1 invert the needle match in `openspecAddendaFindings` (residual when ABSENT);
  - [ ] 12.2 drop the `hasOpenspec` guard in `openspecAddendaSectionText` (emit always);
  - [ ] 12.3 drop `escapeControls` from `openspecAddendaLines`;
  - [ ] 12.4 report on a clean state (return a constant line when findings are empty);
  - [ ] 12.5 drop the block-heading check so `missing` never fires;
  - [ ] 12.6 raise the section above `OPENSPEC_ADDENDA_MAX_BYTES` (append padding to the practice sentence);
  - [ ] 12.7 omit `currentOpenspecAddendaSection()` at `overhead.mjs:181` (overhead stops counting the section);
  - [ ] 12.8 task 6: emit a guardrail bullet regardless of its flag;
  - [ ] 12.9 restore "Do not run `openspec update` yet" in `commands/upgrade.md`;
  - [ ] 12.10 add `"update"` to the argvs in the new module's wrapper (a spawn) and confirm `assert/tool-currency.test.mjs:57` or the source scan fails. If no scan covers the new file, that is a SURVIVING mutant: fix the scan to include `openspec-addenda.mjs`, do not delete the mutant.
  Any survivor is a finding to fix; note it in the report.

- [ ] **13. ORCHESTRATOR: verify against the commit, attribute, gate 2, route, close (agents list, orchestrator runs).**
  - [ ] 13.1 REQUIRED ITEM 2: for every task commit `<sha>`: `git show --stat <sha>` and assert each file that task claims is IN that commit (watch an explicit-path `git add` aborting on a path that is unchanged). Expected per task: 3 -> `scripts/lib/openspec-addenda.mjs`, `briefing.mjs`, `migrations.mjs`, unit tests; 4 -> `rules.mjs`, `conductor.mjs`, `overhead.mjs`, `CLAUDE.md`, assert test; 5 -> the two `.claude` files plus the assert case; 6 -> `openspec-addenda.mjs`, `CLAUDE.md`; 7 -> `commands/upgrade.md`, `tool-currency.mjs`, both tool-currency tests, `upgrade-order-doc.test.mjs`; 9 -> README, dogfooding skill, `.changesets/gh-cfdude-pm-262.md`; 10/12 -> `mutation-evidence.txt`. A claimed file absent from its commit FAILS the task even if the tree and the suite are green.
  - [ ] 13.2 REQUIRED ITEM 4: at each commit, in landing order: `node scripts/conductor.mjs update-epic gh-cfdude-pm-262 --attribute-commit <sha>`. Catch up in order for any commit already landed. Do NOT attribute a commit that only relocates or deletes change artifacts, or lifecycle commits made after Gate 2 is recorded (commit those before Gate 2, or use `--withdraw-commit`).
  - [ ] 13.3 Gate 1 (this plan, file path not a SHA range) and Gate 2 (`BASE..HEAD`, BASE from task 1.1): one fresh-context reviewer (review mode `standard`), given the work product only: spec alignment with the owner decisions, the sweep output (task 11), the mutation file, the size numbers (task 10). Critical -> now; Important -> before proceeding; Minor -> note. Record with `record-gate-review`; any commit after the verdict re-records it (the gate checks that the head reaches every attributed commit).
  - [ ] 13.4 REQUIRED ITEM 7, route what the work taught, each named out loud:
    - PRACTICE adopted: "generated OpenSpec files are never edited; a pm clause lives in the managed block." It is carried by the block's practice sentence and the dogfooding skill. Evidence goes with it: one hand edit in 0.27.0 (`543a38fb`), kept across a 1.13.2 -> 1.15.0 update commit (`ab1e1552`), erasure on 2026-10-30 UNVERIFIED by git history (see Facts), zero engine writers to those paths. Register as an epic only if Rob wants it enforced beyond the residual line.
    - TOOLING FRICTION routed around: (a) pm's drift detector compares only stamps, so for an edited-but-current repo under 1.17 (which content-compares skills) pm says nothing while `openspec update` would still rewrite; (b) the HOLD names every unarchived change (#266). File (a) with `/pm:feedback feature "..."` against `cfdude/pm`; (b) is already #266, link it.
    - PROCESS FAILURE: hand-editing a generated file whose own text says it is overwritten. File `docs/lessons/<kebab-name>.md` with `trigger` written as the situation BEFORE the mistake ("About to add or change a pm clause by editing a file under `.claude/skills/openspec-*` or `.claude/commands/opsx/`"), concrete `cost`, `enforced_in` naming the block sentence, the dogfooding skill and the residual line (the real binding point), and a `detect:` only if it matches with near certainty: the hook DOES fire on Edit/Write (`hooks/hooks.json:35`) and `detect` supports `{"tool":"Edit","pathEndsWith":"openspec-archive-change/SKILL.md"}` (one tool, one suffix), so a narrow matcher on the one file where it happened is possible; fire it once by hand before trusting it and run `lessons-index.test.mjs`. Otherwise retrieval-only, and say so.
  - [ ] 13.4a Commit the lesson and mutation evidence BEFORE Gate 2 is recorded.
  - [ ] 13.5 Archive: `update-epic gh-cfdude-pm-262 --status archived --outcome delivered --reason "<why>" --no-deferrals` (swap `--no-deferrals` for `--deferral "gh-cfdude-pm-266:<section>"` if task 8 is left to #266). Superpowers lane: no `pm:lifecycle` marker applies (no OpenSpec tasks file). Re-render with `/pm:status`. Honcho: no detour push/pop here, so no memory line owed.

## Verification at the end (the closeout the executor reports)

- Whole assertion half, once: `node --test scripts/test/unit/*.test.mjs scripts/test/assert/*.test.mjs` (time it; default tier stays under a minute).
- `certify functional` result tail with "functional half passed" for each demanded run; `sweeps` if drift demanded it.
- Sizes (task 10), mutation file (task 12), sweep output (task 11), `git show --stat` per commit (task 13.1).
- Report ends with: needs-the-orchestrator list (commits to attribute, `/pm:feedback` filing, Mintlify pages, the reply to #262 correcting the "shipped to every repo" premise), and what was NOT done (no `openspec update` in this repo, no Mintlify, no release, no push).

## Open questions for Rob

1. "Missing or residual": the plan reads MISSING as "the managed block lacks the addenda section while `openspec/` exists" and RESIDUAL as "pm text inside a generated file". A generated file without the clause is the desired state and stays silent. Recommendation: this reading. Confirm, because the brief's wording could also mean "report absence from generated files".
2. Ship the #261 guardrails in the block (task 6, +about 220 tokens, only in repos with `openspec/` and the matching skills)? Recommendation: yes; it is droppable without touching the rest.
3. Fold the #266 slice (task 8, about 1 h) into this epic, or leave it to #266? Recommendation: leave it unless you want the filter now; task 7's softened wording already removes the contradiction.
4. The 80-token figure covers the clause plus the practice sentence at about 330 bytes. If the practice sentence pushes it past 400 B, drop the sentence from the block and keep it in the dogfooding skill only? Recommendation: keep both if under 400 B, otherwise drop the sentence.
5. Which pm files did Rob see overwritten (the CLAUDE.md suspicion)? Task 1.5 checks one on-disk signal; the question stays open and nothing here depends on the answer.
6. The `openspec update` 1.15.0 -> 1.17.0 move for this repo's 24 generated files is out of scope here (project-boards is in flight). Schedule it as its own change after project-boards archives?
