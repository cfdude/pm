- **Added a mechanical test that catches SKILL.md "Commands" drift from the real dispatch
  table.** `conductor.test.mjs` now extracts every subcommand key from `conductor.mjs`'s
  dispatch table and asserts each one is mentioned somewhere in `skills/conductor/SKILL.md`,
  failing CI the next time a new subcommand ships without a doc mention (the same bug class
  fixed once by hand in 0.12.0, now enforced instead of relying on someone remembering). Running
  it against the current docs caught two real gaps — `snapshot` (the PreCompact-hook-only
  re-render) and `write-rules` (the `/pm:init`/`/pm:upgrade`-only CLAUDE.md rules-block
  refresher) were both real, invoked subcommands with no mention anywhere in SKILL.md — fixed by
  adding a line for each to the Commands section.
