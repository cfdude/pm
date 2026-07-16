- **Changesets-style fragment files replace direct `CHANGELOG.md` edits for hierarchy children.**
  Every parallel hierarchy-child batch was hitting a 100% collision rate on `CHANGELOG.md`'s
  shared `## [Unreleased]` header — every dispatched child edited the same section, guaranteeing
  a merge conflict on every multi-child batch. Children now write their changelog entry to
  `.changesets/<epic-id>.md` instead (same bullet format `CHANGELOG.md` already uses: a bold
  one-line summary, then wrapped prose). The orchestrator remains the sole writer of
  `CHANGELOG.md` — consistent with it already being the sole writer of `.conductor/state.json` —
  and consolidates all pending fragments into the real `[Unreleased]`/new-version section once,
  at release time, then deletes the consumed fragment files. A new zero-dependency `changesets`
  engine subcommand (`node conductor.mjs changesets`) lists `.changesets/*.md` fragments as
  `{ changesets: [{ id, path, body }] }`, sorted by epic id, to make that consolidation step
  mechanical rather than a manual `cat` + guesswork.
