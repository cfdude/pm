* **The attribution nudge no longer tells an agent to attribute bookkeeping, and no longer claims the
  active epic owns a commit it cannot tie to it.** A commit whose changed paths are only `.conductor/**`,
  `PROJECT.md` and/or a change moved under `openspec/changes/archive/` now gets "pm bookkeeping — needs no
  attribution" instead of an `--attribute-commit` command (an archive move is recognised by pairing
  `openspec/changes/<id>/<rest>` with `openspec/changes/archive/<date>-<id>/<rest>`, so an edit to a change
  is still real work). Bookkeeping is judged per commit, so one real commit among several is still named. And
  when neither a commit's subject nor its paths name the single candidate epic, the nudge now reads "the
  engine cannot tell whether this commit is `<id>`'s work … if it is, record it" rather than "record this
  commit against its epic".
* **`.conductor/honcho-memories.log` is git-ignored explicitly.** `init` and `/pm:upgrade` now write it into
  `.gitignore` instead of relying on a global `*.log` rule (the maintainer's covered it; nobody else's did, so
  it was a permanently untracked file). Like `brief.txt`, a repo that already TRACKS it gets the
  `⚠ UNTRACK PM'S SESSION FILES` block with the `git rm --cached` line; pm never runs it.
* **`delivered-release-epic-left-open` names the `--status active` workaround.** Archiving the last active
  member of a release that is still mid-flight makes the release read as delivered, and its queued members
  as leftovers. The finding now says so and tells you to mark the member you are about to work on
  `--status active`. The rule itself is unchanged: the record holds no field that separates "delivered" from
  "mid-flight" cleanly, and this is flagged as needing a decision.
