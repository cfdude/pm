* **`sync --dry-run` previews a sync, and `sync --only <id>` imports selectively** (#167). `--dry-run`
  prints what a real run would register (changes, plans, archived changes), flip and heal, flags the
  one-time archive backfill when it would be one, and writes nothing: no `state.json`, no `PROJECT.md`,
  no backfill marker. `--only <id>` (repeatable) limits registration to the named change, plan or
  archived-change ids; an id that matches nothing is refused before anything is written, and a
  selective run leaves the backfill marker unstamped so the next plain `sync` still announces it. The
  two combine. A dry run is a read, so it has no inverse to undo.
* **A change archived without applying its specs can be waived out of the spec-deltas report.**
  `update-epic <id> --spec-deltas-waived "<why>"` records that the archived deltas were deliberately not
  applied; the reason is the value, so it cannot be recorded blank. `integrity`'s
  `delivered-epic-spec-deltas-absent` and the briefing's spec-sync block then stop naming the epic.
  Inverse: `update-epic <id> --clear spec-deltas-waived` (the epic is reported again). The finding's own
  text does not name the flag; it is documented in `commands/epic.md`.
* **`recover-created-at` dates an epic from its earliest introducing commit.** It used to take the
  first commit git's simplified log listed, which can be a LATER commit when a merge prunes the side
  branch that really introduced the id (knowledge-store: stamped 07-09, introduced 06-30). It now asks
  for full history and takes the earliest match by date. Dates already stamped are never overwritten;
  clear one with `update-epic <id> --clear created-at` and re-run the verb to correct it.
* **The emitted rules direct an agent to confirm an OpenSpec epic's planning is complete before treating
  it as ready to apply.** One paragraph in "Re-read the source before an epic becomes the work": proposal,
  design, specs and tasks all exist and agree. It states the obligation and names no OpenSpec command.
  The managed block changes, so run `/pm:upgrade` in each repo to refresh it.
* **Adding an engine verb is checked against every per-verb table in one run** (#206). A new assertion-half
  test reads the dispatch table and names every missing row (usage line, positionals, flag surface, effects
  row, both functional baselines) at once; `CONTRIBUTING.md` documents the tables and the baseline `seed`
  hook. No engine behaviour changes.
