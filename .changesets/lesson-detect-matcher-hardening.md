### Fixed

* **A lesson's `detect:` regex can no longer stall a tool call.** The `lesson-advice` hook runs
  before every Bash, Edit, Write and NotebookEdit call, and a catastrophic matcher such as
  `^(a+)+$` used to hold each call until Claude Code's 60 s hook timeout. Now each regex gets its
  own 50 ms budget, and one hook run spends at most 1 s on regexes in total. Each regex sees at most
  the first 4096 characters of the command's first line. A regex that runs out of time counts as
  not matched, so a runaway lesson loses only its own advice; the lessons after it still fire. The
  unambiguous catastrophic shape, a repeated group whose whole body is one repeated atom such as
  `(a+)+`, is rejected before it reaches the hook. Delimited repetitions such as `(\S+\s+)*` are
  accepted.
* **A typo'd `detect:` key no longer matches every tool call.** An unknown key such as
  `commandMatch` used to apply no predicate, so the lesson fired on `ls`. `detect:` now accepts
  only `tool`, `pathEndsWith`, `commandMatches` and `commandLacks`, and rejects any other key. It
  also rejects a matcher that could never fire or would always fire: a tool the hook is never
  sent, a `tool` array, no positive predicate, a command predicate on a non-Bash tool, or a
  `pathEndsWith` paired with a command predicate.
* **Lessons saved with CRLF line endings now fire**, and a `pathEndsWith` matcher on
  `NotebookEdit` now reads the path that tool actually sends (`notebook_path`).
