* **An openspec-lane epic can no longer be made active with its change on disk and no passing Gate 1.** Gate 1 was
  recorded but nothing blocked implementation without it (the archive guard covers Gate 2 only, and deliberately
  exempts Gate 1). `set-active`, `update-epic --status active`, and `add-epic` / `add-many` creating at `active`
  now refuse an openspec-lane epic whose `openspec/changes/<id>/` exists and whose Gate 1 is absent, failed or
  withdrawn; the refusal names `record-gate-review <id> --gate 1 …` and the waiver. An epic with no change on disk
  (pre-propose), one already active, and a stale-but-passing Gate 1 are not refused; `push-detour` / `pop-detour`
  warn instead. New `update-epic <id> --status active --gate1-waived "<why>"` (reason required, openspec-lane
  only) waives it in one call; `--clear gate1-waived` is the inverse.
