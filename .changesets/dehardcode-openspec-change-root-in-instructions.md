* **Shipped instructions no longer pin an OpenSpec change to `openspec/changes/<id>/`.** OpenSpec resolves a
  change's location itself (`changeRoot` in `openspec status --change <id> --json`), and a relocated planning home
  puts it elsewhere, so an instruction that hardcodes the default points an agent at a directory that may not hold
  the change. Every directive in the rules block pm emits into a managed repo's `CLAUDE.md` (the commit that moves
  a change into its archive is never attributed), in `agents/reconciler.md`, `skills/conductor/SKILL.md`,
  `commands/{status,epic,sync,detour,cross-spec-review}.md` and the README now names the change's directory as
  OpenSpec reports it and an archived change as the directory `/opsx:archive` moved it to. The stock path is
  still stated, as a default (`by default openspec/changes/<id>/`). A new sweep over every shipped document
  (derived by walking the shipped roots, never listed) and over the rendered rules block and brief fails on any
  other `openspec/changes/` literal, so the count can only fall: it was 34 lines before this change and 13 after
  (all stated defaults or the bare directory name). The engine's own path handling and printed messages are
  unchanged on purpose: it really reads `openspec/changes/`. Repositories pick up the emitted line on their next
  `upgrade` or `write-rules`.
