* **The activity log now names the epic on every detour event, and tells a resumed pause from an
  ended one.** Detour events used to record `epic: null`, because the log read field names the
  detour stack never writes. As a result the report's per-epic DETOURS list was always empty and
  `activity --epic <id>` left out every detour. Each detour event now carries the paused `epic` and
  its `detour`, and `--epic` finds the event under either one. The per-epic figure counts
  interruptions: one per `push-detour`, where the pop used to be counted as a second.
  `drop-detour` is logged as `detour-drop` rather than as a pop, and it names the frame that was
  actually dropped even when that frame was buried under another. The DETOURS line reads
  `N push(es), N pop(s), N drop(s)`.
* **Reconcile verdicts, autonomy changes, priority changes and review-mode changes are named
  events.** Before, each was logged as a bare `state-write` with no epic. `record-reconcile` now
  logs `reconcile-recorded`, which appears in the GATES sequence as `reconcile vs <detour>=<verdict>`
  and is marked `(correction)` when it replaces an earlier verdict. `set-autonomy` logs
  `epic-autonomy`, carrying the level change and counts of grants added, grants revoked and
  notifications. A priority change logs `epic-priority`. `set-review-mode` and
  `update-epic --review-mode` log `review-mode`. The report lists the last three in a new SETTINGS
  section, and `activity --epic` shows the epic-scoped ones.
