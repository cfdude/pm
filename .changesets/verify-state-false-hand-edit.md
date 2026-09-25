* **`verify-state` no longer accuses the engine of a hand-edit, and still catches the ones that
  happen.** It compared only `state.json`'s mtime to the last render, so any verb that saves without
  re-rendering — a claim, `set-activity-log`, platform recording — made it exit 1 claiming an
  undetected hand-edit. Every engine save now records its own revision and mtime on the render stamp
  (`lastSave`), and the check compares against the engine's last recorded write: saves since the
  render exit 0 with a note that PROJECT.md may be stale; bytes changed at that revision, a revision
  that went backwards, or one past any the engine recorded exit 1. A stamp written by an older pm has
  no `lastSave`, so the first check after upgrading may report "cannot rule out a hand-edit" until
  the next save or `/pm:status`.
