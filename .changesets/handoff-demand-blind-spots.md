* **Archived tasks now count.** Once `/opsx:archive` moves a change under `openspec/changes/archive/`,
  its epic's progress is read from the archived `tasks.md` — for every epic, not only one the archive
  backfill registered. An archived epic renders its real counts instead of `0/0`, and archiving as
  `delivered` with tasks still open is refused on the documented path (archive, heal, then
  `update-epic --status archived --outcome delivered`) instead of being accepted. Where one change id
  was archived twice, the latest date's directory is the one read, and the same directory decides
  whether the change is archived at all. Expect some archived epics in your record to show open work
  they already had: they are reported, not changed.
* **Stories no longer hide tasks.** An epic's progress is its inline stories and its task source
  (plan file or `tasks.md`) counted together. Adding one story to an epic with a `tasks.md` used to
  make the tasks unread, so it could be archived `delivered` at `1/1` with tasks open. Where both
  hold open work, the archive refusal names each part's remedy and says both must be done (or
  `--carried-to` for the whole remainder), and `integrity` and `unconsidered-outcomes` print
  `--story <n> --done` first and the `--carried-to` archive for what remains. A missing `tasks.md`
  or plan now warns even when the epic has stories.
* **`integrity` and the briefing now report a delivered change whose spec deltas never reached
  `openspec/specs/`.** The new `delivered-epic-spec-deltas-absent` check compares each `delivered`
  epic's archived delta specs with the main specs held in git's index (headers only; a later archived
  change touching the same header discharges it) and names the epic, the change, the capability and
  each header. It never blocks an archive. Between `openspec archive` and `git add` a correct archive
  is reported too — stage `openspec/` and it clears. It is printed by `integrity`, the SessionStart
  briefing and `render`'s own output (so `/pm:status` shows it), and is never written into
  `PROJECT.md`. Its remedy: make the main spec hold what the archived delta requires, then
  `git -C <conductor root> add openspec/`.
