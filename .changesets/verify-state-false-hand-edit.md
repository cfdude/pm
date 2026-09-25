* **`verify-state` no longer accuses the engine of a hand-edit.** It compared only `state.json`'s
  mtime to the last render, so any verb that saves without re-rendering — a claim,
  `set-activity-log`, platform recording — made it exit 1 claiming an undetected hand-edit. It now
  reads the revision the render stamp already records: a revision ahead of the stamp is the
  engine's own save (exit 0, with a note that PROJECT.md may be stale), a revision that went
  backwards is refused as a rewound file, and changed bytes at the same revision are still reported
  as a hand-edit.
