# pm's archive gate does not notice when an archived change's spec deltas never reached openspec/specs/

**Kind:** bug

## What happened

0.48.0 was archived with `/opsx:archive`. The OpenSpec archive applied the change's delta specs to
`openspec/specs/engine-invocation/spec.md` and `openspec/specs/suite-certification/spec.md`, but the
commit that recorded the archive (17a1225) staged only `openspec/changes`. The spec edits stayed in
the working tree until a later `git reset --hard origin/main` discarded them. Result: the main specs
were missing 0.48.0's deltas for two days —

- `engine-invocation`: +2 ADDED requirements missing (the store seam, CLI-store parity);
- `suite-certification`: +2 ADDED requirements missing (fixture snapshots, rung membership by
  observable), and three MODIFIED blocks still held their pre-0.48.0 text.

They were found only because the 0.49.0 proposal tried to write deltas against them; restoring them
took a dedicated sync commit (3256cc2) before Gate 1 could start.

## What pm did not do

pm's archive gate (`update-epic <id> --status archived --outcome delivered`) accepted the epic as
delivered, and nothing in `status`/`brief`/`integrity`/`verify-specs` flagged that the archived
change's ADDED/MODIFIED requirement headers were absent from the corresponding
`openspec/specs/<capability>/spec.md` in HEAD. The record said "delivered"; the main specs said
otherwise.

## Suggestion

At archive time (or in `integrity`/`verify-specs`), for an openspec-lane epic, read the archived
change's `specs/**/spec.md` and check that every `### Requirement:` header under `## ADDED` and
`## MODIFIED` exists — and every `## REMOVED` header does not — in the committed
`openspec/specs/<capability>/spec.md` (git's `HEAD:` content, not the working tree). Refuse, or at
least warn, naming the missing headers. The engine only reads files, so this stays inside the
instruction-layer law.

Process side (already done in this repo): lesson `docs/lessons/an-archive-writes-outside-the-change-dir.md`
and a staging line in the release-checklist skill (0.49.0 task 7.8). That catches the human step; this
issue is about the record claiming delivery over specs it never checked.

Found while applying node-support-policy (0.49.0), task 6.9.
