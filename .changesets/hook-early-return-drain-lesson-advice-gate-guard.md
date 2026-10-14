* **`gate-guard` and `lesson-advice` drain the hook payload in a repository without pm.** Both returned before reading
  stdin when no conductor record existed, so a PreToolUse payload past the pipe buffer (about 64 KiB) left the hook
  writer holding an unread pipe and failing with EPIPE. The same drain `brief`, `snapshot` and `commit-nudge` already
  do now runs first. Allow and deny decisions are unchanged.
