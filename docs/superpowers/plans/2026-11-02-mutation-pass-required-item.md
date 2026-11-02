# mutation-pass-is-a-required-task-item — a numbered required item that proves every new guard can fail

Epic `mutation-pass-is-a-required-task-item` (lane `superpowers`, release 0.54.0). Also closes the build half of
`gh-cfdude-pm-211` (a RED note is written against the release baseline and goes stale as its own change lands).

Evidence: operations-ship-their-inverses (0.46.0) neutered every guard it added and saved the run; one of six
mutants survived and was a real defect no gate found (`docs/lessons/a-guard-can-check-the-wrong-half.md` states the
habit and has no mechanism). #211: task 2.7's "fails today" was true at baseline, stale after task 2.4.

## Facts re-verified on disk (2026-11-02)

- `GATE_PROCEDURE_ITEMS` in `scripts/lib/rules.mjs` holds 7 items; the last is "Route what the work taught you.".
  A new item is appended as item 8; no existing number moves.
- Mirrors that restate the numbered list: `skills/conductor/SKILL.md`, `commands/epic.md`, `commands/status.md`
  (the 15.4 title guard and the 15.5 `mustSay` guard in `scripts/test/assert/conductor-16.test.mjs` already iterate
  `GATE_PROCEDURE_ITEMS`, so a new item fails them until the mirrors carry it).
- `README.md:393` says "seven numbered, required task items" and lists them.
- Fresh-repo block (`init` in an empty git repo): 30,083 bytes before. Budget for the item: about 558 bytes.
- The repo's own `CLAUDE.md` block is regenerated with `write-rules`, never hand-edited.

## Tasks

1. RED: `scripts/test/unit/mutation-pass.test.mjs` (item present and last, body carries the claims, size cap) and
   `scripts/test/assert/mutation-pass.test.mjs` (skill exists and is claimed once by the ledger, mirrors carry the
   claims inside the item body, lesson `enforced_in` names the item and the skill). Save the failing run.
2. GREEN, one `rules.mjs` commit (certify is about 8 minutes, so batch): the item, the three mirrors, the new
   `skills/mutation-pass/SKILL.md`, its ledger entry, README sentence, lesson `enforced_in`, changeset fragment,
   `write-rules` regeneration of `CLAUDE.md`.
3. Mutation evidence for these tests' own guards (delete the item, reorder it, drop a mirror claim, unclaim the
   skill, revert the lesson), saved as `docs/superpowers/plans/2026-11-02-mutation-pass-required-item/mutation-evidence.txt`.
4. Measure bytes added to a fresh block; report.

Stops before any gate: no epic archive, no #211 archive, no gate record, no push, no Mintlify.
