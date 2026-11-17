# Call-site completeness and inverse sweep — gh-cfdude-pm-262 (required gate item 1, plan task 11)

Run 2026-11-16 against `dev` after the work commits `b36a37cc`, `c30e59e4`, `77d3869b`. Every list below was derived with `rg`,
not typed; the command is under each heading. Outcome: one real gap (11.3, the brief read the wrong rules file on a non-claude-code
platform), fixed in its own commit with its test; everything else holds or is justified.

## 11.1 The rule "pm never writes a generated OpenSpec file"

`rg -n "writeFileSync|appendFileSync|copyFileSync|renameSync|rmSync|unlinkSync|mkdirSync" scripts/lib scripts/conductor.mjs --glob '!scripts/test/**'`
(plus the same over `hooks` and `scripts/*.mjs`: no hit outside `scripts/lib` and `scripts/conductor.mjs`).

| Writer (file) | Target | Generated OpenSpec path? |
| --- | --- | --- |
| `scripts/lib/store.mjs` (state, tmp, lock, artifacts) | `.conductor/*` | no |
| `scripts/lib/spend-ledger.mjs`, `dev-log-capture.mjs` | `.conductor/spend/*` | no |
| `scripts/lib/commit-watch.mjs`, `activity-log.mjs` | `.conductor/*` observe/activity files | no |
| `scripts/lib/subcommands.mjs:118` | `.gitignore` | no |
| `scripts/lib/rules.mjs:1382` | the platform's rules file (CLAUDE.md, AGENTS.md, HERMES.md) | no |
| `scripts/lib/rules.mjs:1419-1420` | a SIBLING rules file when the platform moves (orphaned block removed) | no: the chain names only those three files |

`rg -n "\.claude/(skills/openspec|commands/opsx)" scripts/lib scripts/conductor.mjs commands skills hooks` returns only: the
`OPENSPEC_GENERATED_PATHS` constant and doc comments (`tool-currency.mjs:54,184-186,228,239`), the READ-ONLY `git ls-files` in
`tool-currency.mjs:252`, the registry/section text/reader in `openspec-addenda.mjs`, one prose sentence each in `skills/dogfooding/SKILL.md:41`
and `commands/upgrade.md:98`. No writer. Where the rule holds: every engine writer. Where it is not enforced mechanically: nothing scans for a
future writer aimed at those paths; the module-level guard is the source scan (`12.10`, `assert/openspec-addenda.test.mjs`) that the new module
spawns nothing, and `assert/tool-currency.test.mjs:57` that the engine passes the `openspec` binary only its two read-only argvs. Justified: a
generic "no write reaches a path matching X" guard would need the path at every one of the roughly 40 call sites; the writers are enumerated
above and a new one is a review item, the same way the routing for `.conductor/` is.

## 11.2 The new `rulesBlock` input (11th parameter, `openspecSection`)

`rg -n "rulesBlock\(" scripts --glob '!scripts/test/**'` returns exactly three call sites and `rg -n "rulesBlock\b" scripts hooks commands skills`
finds no alias or re-export:

- `scripts/lib/rules.mjs:1343` (`writeRules`, which `init`, `write-rules`, `upgrade` and every tracker/profile/spend/boards verb go through)
- `scripts/conductor.mjs:532` (the `rules` verb)
- `scripts/lib/overhead.mjs:186` (`overhead`)

All three pass `currentOpenspecAddendaSection()`; the definition is `openspec-addenda.mjs:131`. Held. The default `""` keeps every other
caller (the unit fixtures) byte-identical (`2.7`).

## 11.3 The emitter `openspecAddendaLines`

`rg -n "openspecCurrencyLines|openspecAddendaLines" scripts --glob '!scripts/test/**'`: both are called at `briefing.mjs:181` and
`migrations.mjs:289` and nowhere else. `status` / `/pm:status`, `render` (PROJECT.md), `overhead` and the SessionStart hook all reach the brief
through `buildBriefParts`, so they need no third call (`rg -n "buildBrief\b|buildBriefParts\b"`: `subcommands.mjs`, `render.mjs`, `overhead.mjs`,
`session-cost-report.mjs`, all consumers of the one function).

**GAP FOUND AND FIXED.** `migrations.mjs:289` passed `resolvePlatform({}, state)`; `briefing.mjs:181` called `openspecAddendaLines()` with the
default `"claude-code"`. On a codex repo the brief therefore read `CLAUDE.md` for the block: an unrelated CLAUDE.md without the pm block gave a
FALSE `MISSING`, and a codex `AGENTS.md` that really lacked the section was never reported. That is exactly the brief-says-one-thing,
upgrade-says-another split the plan's design section calls worse than no finding. Fix: `briefing.mjs` passes `resolvePlatform({}, state)`
(one import, one argument). RED test `11.3` in `scripts/test/assert/openspec-addenda.test.mjs` failed before the edit and passes after.

## 11.4 Places that restate the HOLD or the step-4 order

`rg -n "HOLD until|Do not run .openspec update|copy .* aside|openspec update" commands README.md skills scripts/lib docs/*.md --glob '!docs/superpowers/**' --glob '!CHANGELOG.md'`

| Hit | Disposition |
| --- | --- |
| `commands/upgrade.md:78-100` | changed in `b36a37cc` (order flipped, HOLD bullet replaced, `--dry-run` instead of copy aside) |
| `README.md:1922-1945` | changed in `77d3869b` |
| `scripts/lib/tool-currency.mjs:301-321` | HOLD line now reads "review before running"; asserted by `assert/upgrade-order-doc.test.mjs` 7.1 and the tool-currency twins |
| `tool-currency.mjs:230` (doc comment "copy the files aside first") | historical rationale comment above `generatedArtifactsTracked`; the emitted text at `:316` now says `--dry-run`. Stale prose in a comment, not output; left, noted as Minor |
| `scripts/lib/openspec-validate.mjs:16`, `git.mjs:334`, `briefing.mjs:174`, `openspec-addenda.mjs` | prose about what the engine never runs; true as written |
| `skills/dogfooding/SKILL.md:41` | the new sentence |
| `CHANGELOG.md` | historical, stays; the new entry lands at the release cut |

## 11.5 Places that list the block's headings

`rg -n "Boards|CONDITIONAL_SECTIONS" scripts/lib scripts/test --glob '!scripts/test/fixtures/**' -l`. The section is VERB-REFRESHED and outside
`CONDITIONAL_SECTIONS` (its gate is the filesystem, not a `state.json` input), like Boards:
- `rules --sections` and `overhead` enumerate the block's own `## ` split (`overhead.mjs:14`), so they list it with no edit; `assert 4.1e/4.1f` prove both.
- `rules-conditional-coverage.test.mjs` varies only the four state inputs and passes unmodified (default `""`).
- `rules-usage.mjs`, `opt-ins.mjs`, `verb-effects.mjs`, `set-boards.mjs` mention Boards for switch behaviour that the addenda section does not have (no switch,
  no verb): no edit needed. `verb-effects.mjs:175` `write-rules` already says it writes "the platform's rules file".
- Not a conditional-section row on purpose: a row would need a `shown(state)` and the section is not a function of state.

## 11.6 Data references

None. This epic adds no field that holds another record's id and no `state.json` field, so there is nothing to enumerate for write, read or
removal, and no MIGRATIONS entry.

## 11.7 Inverses

| Operation added or changed | Inverse | Shipped / test |
| --- | --- | --- |
| Emit the section when `openspec/` exists | stop emitting when it is gone | yes: regenerated wholesale; `assert 4.1c` |
| Guardrail bullet per generated skill present | drop when the skill directory is gone | yes: `unit 6.1` (each bullet iff its flag) |
| Registry entry `PM_OPENSPEC_ADDENDA` | remove the entry | not shipped, justified: it must stay while any repo may still carry the legacy edit; retirement criterion is in the module header |
| RESIDUAL / MISSING report | none | read-only, writes nothing |
| Delete the clause from the two `.claude/` files | re-add | deliberately none; re-adding is the practice this epic ends (`assert 5.1` pins it) |
| `upgrade.md` step-4 order, HOLD wording | none | doc/text only; the old text is replaced, not left beside the new (`assert upgrade-order-doc 7.1`) |
| `rulesBlock` 11th parameter | pass `""` | yes: the default (`unit 2.7`) |
| `briefing.mjs` passes the resolved platform (this sweep's fix) | pass nothing (default `claude-code`) | the default stays for a claude-code repo; `assert 11.3` pins the codex case |

## Plan tasks 1.4 and 1.5 (read-only findings, 2026-11-16, `openspec` 1.17.0)

**1.4 Other pm-authored passages in the 24 tracked generated files.** `git ls-files .claude | rg "openspec|opsx"` lists 24 files. A throwaway copy
of `openspec/` and `.claude/` outside the repo (scratchpad, never this tree) was run through `openspec update`, then `diff -r` against the repo's
files. The update changed 12 `SKILL.md` files by exactly one line each (the `generatedBy` stamp, line 10, 1.15.0 to 1.17.0) and rewrote nothing
else, with ONE exception: the two archive files (`.claude/skills/openspec-archive-change/SKILL.md:164`, `.claude/commands/opsx/archive.md:160`) differ
from pristine 1.17 by a single trailing period after "left empty" (the upstream line ends `empty.`; the repo's line, after task 5 removed the clause,
ends `empty`). So the registry needs no second entry: no other pm-authored passage exists in those 24 files. Consequence: the next
`openspec update` in this repo restores that period on its own, no pm action owed. Not edited here (the brief and the epic say stop touching those files).

**1.5 The CLAUDE.md suspicion.** `git log --all -G"workflows that fight" -- CLAUDE.md` returns two commits, both ADDING the heading: `418f5751`
(2026-10-29, on dev) and `f02578c7` (2026-11-12, the 0.55.0 squash). `git log --all -S'Never run `/opsx:onboard`' -- CLAUDE.md` adds
`b36a37cc` (this epic's intended shrink to a pointer). Between 2026-10-28 and 2026-11-03 the only commit touching CLAUDE.md is `418f5751`. No
committed history shows `openspec update` removing pm content from CLAUDE.md; an uncommitted removal would leave no trace in git, so the claim
stays UNVERIFIED, not refuted.
