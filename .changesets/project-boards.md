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
* **`set-boards on|off`: the boards are on by default, and one switch removes them.** `set-boards off` records
  `state.boards = {enabled: false}` and removes the `## Boards` section of the managed rules block (at most 280 bytes: it names the
  `project-boards` skill and `/pm:boards` and says when to refresh) and the brief's boards line (at most 160 bytes). `set-boards on`
  removes the setting again, so each undoes the other and a repeat writes no state. An absent setting reads as on and `init` writes
  nothing. `board --json` keeps working whichever way it is set. `overhead` reports `rules:boards` and `brief:boards` under the
  `boards` feature (0 bytes while off), measures `brief` without that line, and the README cost table has a row for each. `upgrade`
  prints `boards: on (default)`, and once, on the upgrade that crosses 0.55.0, a line telling the agent to tell the user the boards are on.
* **The inward tracker recipe carries `--summary=<one-line summary>`.** The registration line the rules block emits for a tracker now
  ends `--summary=<one-line summary>`, with the instruction to write it from the item's body: one line, at most 200 characters, in the
  agent's own words, single-quoted like the other placeholders, and to leave the flag off when the body gives nothing to summarise.
* **`project-boards`: a skill, two page templates and `/pm:boards` draw the backlog and the release plan.** The skill
  `skills/project-boards/SKILL.md` is the one home of the procedure: it publishes `templates/backlog.html` and
  `templates/release-plan.html` with the Artifact tool, seeds them from `board --json` (the only state source, in writes of at
  most 50), refreshes them after `/pm:sync`, a status change, a `release` or `mission` write and a gate record, and registers
  each page in `docs/artifacts/artifacts.md`. The pages declare database rules: everything is `admin`-writable except
  `answers` and `backlogMeta`, which are `interact`. The backlog bands open epics by merit priority and a drag writes a whole-band
  proposal to `proposals/rank`; the agent applies it with `reorder`, then deletes it, and one bad id refuses the whole proposal.
  Every value the templates draw is escaped, priority is allowlisted to `P0`..`P3` or `P?`, ids must match `/^[A-Za-z0-9._-]+$/`,
  only http and https URLs become links, each render step has its own error boundary, and a host with no Artifact tool gets a
  read-only standalone file whose inlined JSON escapes `<` as `\u003c`. `/pm:boards` loads the skill and stops while boards are off.
* **`set-project`: the project's name and key, and a number on every epic.** `set-project --name "<name>" --key <KEY>` records the project name
  (at most 60 characters, no `<`, no control character) and a two- or three-letter key; either alone, and `--unset name|key` removes one. The
  engine never invents either. Every epic now carries an integer `number`, assigned when it is registered (`add-epic`, `add-many` and `sync`):
  a tracker issue number when the epic's `externalId` is a plain positive integer no other epic holds, otherwise the next number from a counter
  that only moves forward. A number is never reassigned or freed by a plain registration. The key a board shows is `<KEY>-<number>` (`PM-256`),
  computed on read, so changing the key renames them all. `upgrade` (a `MIGRATIONS` entry keyed to 0.55.0, also run on every `upgrade`) numbers the
  epics that have none: tracker-linked ones by their issue number first, then the rest in registration order. A backfilled number is not a touch.
* **`board --json` carries the project, each epic's key and each release's progress.** A top-level `project: {name, key}` (`null` while unset),
  each epic's `number` and `key` (`null` while the project key is unset), and each release's `progress: {done, total}` (members delivered over members
  not declined, over every member, not only the ended window). An invalid stored name or key is nulled and named in `rejected[]` as `project format`.
  `schemaVersion` stays 1.
* **`release --clear target`, and `release --help` names every plan verb.** `--clear` now accepts `target` (the inverse of `--target`), and the
  `release` help text and its missing-id usage name `release here`, the plan fields and the clearable fields.
