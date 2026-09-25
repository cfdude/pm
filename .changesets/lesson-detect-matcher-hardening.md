### Fixed

* **A lesson's `detect:` regex can no longer stall a tool call.** The `lesson-advice` hook runs
  before every Bash, Edit, Write and NotebookEdit call, and a catastrophic matcher such as
  `^(a+)+$` used to hold each call until Claude Code's 60 s hook timeout. Now every regex in one
  hook run shares a 100 ms budget, and each sees at most the first 4096 characters of the command's
  first line. A regex that runs out of time counts as not matched. A nested unbounded quantifier
  is rejected before it ever reaches the hook.
* **A typo'd `detect:` key no longer matches every tool call.** An unknown key such as
  `commandMatch` used to apply no predicate, so the lesson fired on `ls`. `detect:` now accepts
  only `tool`, `pathEndsWith`, `commandMatches` and `commandLacks`, and rejects any other key. It
  also rejects a matcher that could never fire or would always fire: a tool the hook is never
  sent, a `tool` array, no positive predicate, or a command predicate on a non-Bash tool.
* **Lessons saved with CRLF line endings now fire**, and a `pathEndsWith` matcher on
  `NotebookEdit` now reads the path that tool actually sends (`notebook_path`).
