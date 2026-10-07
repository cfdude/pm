* **`brief` and `snapshot` drain the hook payload, so a large one can no longer EPIPE the hook.** The SessionStart
  and PreCompact payloads were never read: a payload bigger than the pipe buffer (about 64 KiB) left the hook
  writer holding a pipe nobody read, and it failed with EPIPE. Both verbs now drain stdin first, in a repository
  without pm too, and `commit-nudge` does the same where it returns before reading (a repository without pm, a
  detached tree). A terminal is never read.
