---
description: List pending .changesets/*.md fragment files for CHANGELOG.md consolidation
allowed-tools: Bash, Read
---

List every `.changesets/<epic-id>.md` fragment a hierarchy child has written, so the
orchestrator can consolidate them into `CHANGELOG.md` at release time without a shared-header
merge conflict. See the `conductor` skill's "Epic-hierarchy orchestration" section for why this
convention exists (a parallel batch editing `CHANGELOG.md`'s `## [Unreleased]` section directly
hit a 100% collision rate) and `agents/hierarchy-child-executor.md` for the writer side.

## List fragments

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" changesets
```

If `${CLAUDE_PLUGIN_ROOT}` is empty:
`ENGINE="${CLAUDE_PROJECT_DIR:+$CLAUDE_PROJECT_DIR/scripts/conductor.mjs}"; [ -f "$ENGINE" ] || ENGINE="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/conductor.mjs}"; [ -f "$ENGINE" ] || ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1); node "$ENGINE" changesets`

Prints `{ changesets: [{ id, path, body }] }`, sorted by epic id. `[]` if `.changesets/` doesn't
exist or is empty — never errors on a missing directory.

## Consolidating at release time

This is a pure read — `changesets` never writes, deletes, or concatenates on its own. To release:

1. Run `changesets` to see every pending fragment.
2. Fold each `body` into `CHANGELOG.md`'s `[Unreleased]` section (or a new version section, for a
   version release) — you (the orchestrator, or whoever cuts the release) are the sole writer of
   `CHANGELOG.md`, so there is nothing to merge-conflict here even though the fragments were
   written by parallel hierarchy-child dispatches.
3. Delete the consumed fragment files under `.changesets/` once their content is in
   `CHANGELOG.md`.

`.changesets/` is a normal tracked directory, not gitignored — fragments are consumed and
deleted at release time, so there's nothing sensitive or generated to hide from version control
in the meantime.
