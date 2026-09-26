* **`/pm:sync` registers only ids `add-epic` itself would accept.** Since 0.45.0 sync and the
  archive backfill skipped a name holding whitespace or a control character, but still registered
  a change directory `x|y` (whose pipe splits PROJECT.md's Epics table), `.hidden`, or an uppercase
  plan file under ids `add-epic` refuses. Every registration path now applies the same id rule
  (`^[a-z0-9][a-z0-9._-]*$`). A skipped entry is named on stderr every run, sync's final line counts
  the skips instead of a bare "synced", and an uppercase plan such as `MASTER-plan.md` is given a
  runnable `add-epic --id master-plan --lane superpowers --plan …` that registers and claims it.
  Epics already stored under a legacy id keep loading, rendering and updating.
* **An unrelated old archive directory no longer ends a live epic.** An active epic `add-auth`
  was archived by the drift heal, with outcome `unknown` and its active pointer cleared, because an
  unrelated `openspec/changes/archive/2025-01-01-add-auth` shared its name. An archive directory
  dated more than a day before a LIVE epic was registered (`createdAt`) no longer ends it, clears
  its active pointer or blocks `set-active`. A live epic with no registration date is never ended by
  a bare name match (`recover-created-at` dates it). An epic that is already archived still finds its
  archive by name — its task counts, spec-sync and cross-spec scope are unchanged, even where pm's
  own date recovery dated it after its archive. `sync` names each directory it set aside for a live
  epic, every run, and counts them in its final line.
