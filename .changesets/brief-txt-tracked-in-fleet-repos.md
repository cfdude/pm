* **`.conductor/brief.txt` is git-ignored, and a repo that already committed it is told how to stop.**
  The brief the SessionStart and PreCompact hooks rewrite was never in the `.gitignore` entries
  `init` and `/pm:upgrade` write, so 14 of 24 pm-managed repos on one machine had committed it and
  every snapshot left a changed tracked file. It is ignored now, and so is
  `.conductor/write-conflicts.log.prev` — the conflict log's rotation, which no `*.log` rule
  matches. Because an ignore line does nothing for a file already in the index, `upgrade` (and
  `init`) now print an `⚠ UNTRACK PM'S SESSION FILES` block when any of pm's ignored session files
  is still tracked, with the exact `git rm -r --cached` line and a commit line. pm never runs the
  command; the files stay on disk. No `state.json` change and no migration: `upgrade` already
  re-runs the `.gitignore` back-fill on every run.
