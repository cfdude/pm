* **`board --json`: one read-only snapshot for anything that draws the backlog.** The new verb prints a versioned
  object (`schemaVersion` 1) with the counts, the mission and its milestone, the releases in plan order with a
  derived `status` and `criticalPath`, the open epics in the order `PROJECT.md` renders them (effective priority,
  merit priority, rank, lane, id), a window of recently ended epics (`--archived <n>|all`, 50 by default), and a
  three-state `delivered` (`true`, `false`, `null` for "ended, outcome unknown"; an engine stamp is never `true`
  unless it records `delivered`). `dependsOn` is resolved. An id that fails `/^[A-Za-z0-9._-]+$/` or an
  `externalUrl` that is not http or https is left out and named in `rejected[]`, and the verb still exits 0.
  It writes nothing, runs no git and makes no network call. Plain `board` prints a three-line summary.
* **`--summary` and `--why-now`: one line per epic, for the boards.** `add-epic`, `update-epic` and `add-many` (keys
  `summary`, `whyNow`) take a one-line `summary` (at most 200 characters) and `whyNow` (at most 300). An empty,
  multi-line or over-long value is refused and nothing is written. `update-epic <id> --clear summary` and
  `--clear why-now` unset them, and `description` and `notes` are never touched. When an epic leaves `untriaged`
  (or is registered) into a live status without them, the command prints one stderr warning naming the epic, each
  missing field and the flag that sets it. It is a warning only: the write happens and the exit code is 0.
* **Release plan fields and a "we are here" marker.** `release <id>` takes `--theme`, `--rationale`, `--exit` (one line,
  at most 400 characters), `--order <n>` (a non-negative integer) and `--size major|minor|patch`, each cleared with
  `--clear <field>`. A release's status (`planned`, `in-progress`, `shipped`) is derived from `--deliver` and its
  members and never stored, so `--status` is not a flag. `release here <id> [--text] [--next]` records where the project
  is and `release here --clear-here` removes it; `here` is now a reserved release id like `show`. `release show` prints
  the plan fields and marks `(here)`, and the `render` verb (`/pm:status`) prints `here:` and, once a mission milestone
  exists, the `(critical path)` marks. `PROJECT.md` and the brief carry neither.
* **`mission`: the project's mission, its mission milestone and exit criteria.** `mission --statement "<line>" --reason "<why>"`
  records the mission (a replaced statement moves into an append-only history, stamped with when and why), `--end --reason`
  ends it and keeps the record, `--milestone <releaseId>` / `--clear-milestone` name the release that meets it, and
  `--add-criterion` / `--remove-criterion` keep numbered exit criteria whose ids are never reused. `mission show [--history]`
  reads it back. The mission shows in `/pm:status`, as one brief line (at most 200 bytes) and as a `## Mission` section of the
  managed rules block (at most 280 bytes, absent while no mission is recorded). Releases at or before the mission milestone,
  by `--order`, are marked critical path. The engine never writes a statement it was not given.
