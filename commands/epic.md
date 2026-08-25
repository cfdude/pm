---
description: Register a non-OpenSpec epic in the conductor (lane-tagged)
allowed-tools: Bash, Read
---

Register an epic in a non-OpenSpec lane (superpowers, claude-code, decision, external) —
for work that is correctly routed away from OpenSpec but still belongs in the system of record.

Usage: `/pm:epic add <id> "<title>" <lane> [priority] [--status <untriaged|queued|active|paused|planned|archived>] [--parent <id>] [--external-id <KEY>] [--external-url <url>] [--plan <path>] [--link type:epic:reason]`

Use `--status planned` for roadmap work you intend to do but haven't proposed/scaffolded yet
(default status is `queued`). Use `--parent <id>` to nest this epic under an existing parent
epic (e.g. a sprint over its child tickets); the parent must already exist and the link may not
form a cycle. Use `--external-id`/`--external-url` to link the epic to an issue in a configured
external tracker (see `/pm:tracker`). The matching engine flags are added to the `add-epic`
invocation.

`--link "<type>:<epic>[:<reason>]"` (repeatable) is validated, not just parsed: `<epic>` must be
an already-known epic id, and the string must split into at least `type` and `epic`. A malformed
value (wrong segment order, a typo'd epic id) is rejected with a clear error instead of being
silently stored as a garbage link object — this used to succeed silently, which is how a bad
link could end up in `state.json` with no CLI path to fix it.

1. Parse the user's request into: id (kebab-case), title, lane (one of
   openspec|superpowers|claude-code|decision|external), priority (P0–P3, default P?),
   optional parent, optional external id/url, optional plan path, optional links.

2. Run the engine:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" add-epic \
     --id "<id>" --title "<title>" --lane "<lane>" --priority "<P?>" \
     [--status "<status>"] [--parent "<parent-id>"] \
     [--external-id "<KEY>"] [--external-url "<url>"] \
     [--plan "<docs/superpowers/plans/...md>"] [--link "blocks:<id>:<reason>"]
   ```

   If `${CLAUDE_PLUGIN_ROOT}` is empty:
   `ENGINE="${CLAUDE_PROJECT_DIR:+$CLAUDE_PROJECT_DIR/scripts/conductor.mjs}"; [ -f "$ENGINE" ] || ENGINE="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/conductor.mjs}"; [ -f "$ENGINE" ] || ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1); node "$ENGINE" add-epic …`

3. Show the result with `/pm:status`.

---

## Bulk create — `add-many`

To register a parent epic and its children in one atomic operation (e.g. a sprint of audit
tickets), author a JSON batch and pass it with `--from <path>` (or `--from -` for stdin):

```json
{
  "parent":  { "id": "sprint-2026-06-25", "title": "Pre-staging sprint", "lane": "external", "priority": "P0", "status": "queued" },
  "epics": [
    { "id": "job-506", "title": "[JOB-506] HMAC-verify webhooks", "lane": "external", "priority": "P0", "externalId": "JOB-506", "externalUrl": "https://onvex.example/JOB-506" },
    { "id": "job-507", "title": "[JOB-507] …", "lane": "external", "priority": "P1", "externalId": "JOB-507" }
  ]
}
```

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" add-many --from /path/to/batch.json
```

- If `parent` is present it is created first and each `epics[]` entry defaults its `parent` to it.
- **Atomic:** every entry is validated up front (id format, uniqueness vs existing AND within the
  batch, lane, status, parent refs/cycles). On any failure nothing is written and the command
  exits non-zero naming the offender. A valid batch is persisted in a single write — no `&&`
  chaining, no write race.
- JSON only (the engine is zero-dependency). `parent` is optional; a bare `{ "epics": [...] }`
  batch works too.

## Write-back — `update-epic`

To change an epic that already exists (notably, to record a tracker key after creating the issue):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" update-epic <id> \
  [--title <title>] [--external-id <KEY>] [--external-url <url>] [--parent <id>] \
  [--status <status>] [--priority <P?>] [--link "<type>:<epic>[:<reason>]"] \
  [--clear-links] [--lane <lane>] [--plan <path>]
```

The id is positional. Parent/status/lane/link changes are validated like `add-epic` (no
self-parent, no cycle, known status, known lane, `--link`'s epic must be a known epic id). On an
unknown id, or any invalid flag value, it exits non-zero and writes nothing — including an
unrecognized flag name, which used to silently no-op and print a false "updated" success.

**`--lane` re-routes an epic in place, and `--plan` attaches a plan to one created without
one.** Both were settable only at creation, so the sole correction for a mis-routed epic was to
remove it and register it again — discarding its start time, its gate verdicts, its links and
its stories along the way. Both are in-place field writes: the epic keeps its position in
`state.epics[]` and every other field it carries.

**`--link` REPLACES the epic's links wholesale**, unlike the other flags which patch a single
field — this is the intended CLI path to fix a malformed link (recorded with a bad `add-epic
--link` before this validation existed, or hand-edited) without touching `state.json` directly.
Pass every link you want the epic to have; omitting `--link` entirely leaves existing links
untouched.

**To EMPTY an epic's links, say so: `--clear-links`.** `--link` with no value used to do it by
accident — it is a repeatable flag, so a bare `--link` parsed as one non-string element, was
filtered away, and replaced the array with an empty one while printing "updated". That spelling
now exits non-zero and points here. `--clear-links` takes no value and may not be combined with
`--link`.

## Remove an epic — `remove-epic`

The only prior recovery from a mis-registered epic was a raw `git checkout` on `state.json`.
`remove-epic` hard-deletes an epic (recoverable only via git history — there is no in-app undo,
by design: this replaces the git-checkout workaround, it doesn't add a softer one):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" remove-epic <id> [--cascade]
```

- **Every dangling reference is cleaned up automatically** — not just `links[]`. Any other
  epic's `links[]` and `parent`, a disposition's `carriedTo` handoff, a deferral assertion's
  `deferrals[]`, a release's `deferred[]` and the active pointer are all swept, and the command
  reports where each reference was held — a dangling reference is worse than a silently smaller
  graph. (A `deferred[]` entry left behind used to render in `PROJECT.md` as a deferral pointing
  at nothing.) `integrity`'s `dangling-epic-reference` check reads the same declaration, so it
  reports any that a hand-edit leaves behind.
- **Blocked while a detour-stack frame names the epic.** A frame is control state rather than a
  record: dropping it would discard a paused epic's resume path, and keeping it would leave
  `/pm:resume` popping a frame that names nothing. Resume or pop the detour first.
- **Blocked by default if the epic has any descendants** (`parent: <id>`, walked recursively —
  children, grandchildren, etc.). The command prints a short `(id, title, lane/priority/status)`
  table of the parent plus every descendant at any depth and exits non-zero — reassign or remove
  the descendants first, or pass `--cascade` to remove the epic and *all* of its descendants
  together in one atomic write. The preview table and `--cascade`'s actual blast radius always
  agree — a human confirming from the table is confirming the real deletion set, not just the
  direct children.
- **`--cascade` is a real "delete N epics" action** — before you run it, show the human the table
  the blocked attempt printed and get explicit confirmation. The engine has no interactive
  prompt of its own; that confirmation step is the agent's job, not the CLI's.
- If the removed epic was `.active`, the pointer is cleared automatically.

## Set the active epic — `set-active` / `clear-active`

The top-level `.active` pointer (what the briefing's "NOW" line reads) has its own verbs — never
hand-edit `state.json` for this:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" set-active <id>     # make <id> the active epic
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" clear-active        # no active epic
```

`set-active <id>` (positional id) sets `.active = <id>` **and** the epic's `status: "active"`
together, demoting any previously-active epic to `queued` — so the pointer and status can never
disagree. It rejects an unknown or archived id. `update-epic <id> --status active` keeps them in
sync too (it sets `.active`), and moving the active epic off `active` clears the pointer.

## Grant epic-level autonomy — `set-autonomy`

Before an epic can run unattended through phase transitions and destructive actions, it needs a
preflight scan (see the `conductor` skill's "Epic-level autonomy — the preflight scan" section)
and the user's recorded answers.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" set-autonomy <id> \
  --preauthorize "drop-scratch-table:reviewed, safe to drop" \
  --context "staging DB only, no prod access" \
  --level autonomous
```

`--preauthorize`/`--context`/`--notify` are repeatable and additive — re-running `set-autonomy`
APPENDS, it never clobbers prior entries. `--level` replaces (default `"off"` — today's
behavior, unchanged). `PROJECT.md` and the session brief mark an autonomous epic with 🤖.

## Record a gate verdict — `record-gate-review`

An OpenSpec gate review is recorded against the epic with the evidence a later reader can
check, as FIELDS rather than as prose in a note:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" record-gate-review <id> \
  --gate 1|2 --verdict pass|fail \
  --base-sha "<a>" --head-sha "<b>" --reviewer "<identity>"
```

`--base-sha`/`--head-sha` record the commit range the review actually covered, and `--reviewer`
records who (or what) performed it. A review of `a..b` on an epic that later shipped `b..c` used
to be byte-identical in `state.json` to one that covered everything; recorded as fields, the two
are distinguishable without reading prose, and the range is what later tells a covering verdict
from a stale one.

Verdicts recorded before these fields existed carry a free-text `note` instead. They load
unchanged and are reported as carrying no checkable evidence — never deleted, never rewritten,
never mined for a range by parsing that note.

## The gate procedure — required task items

Carried into every change's own task list as NUMBERED REQUIRED TASK ITEMS, never as review
guidance. The form was measured, not guessed: across one audited repository a rule carried by a
mandatory task section reached 14/14 subsequent changes, while the same rule written as a prose
bullet reached 3/15.

1. **Call-site completeness sweep.** For every rule, guard or invariant the change introduces or
   modifies, enumerate ALL call sites of the thing being guarded — derived mechanically (`rg` for
   the callers), never a list typed from memory — then state where the rule holds and where it
   does not, and justify each omission. A guard added at one call site while an identical sibling
   site is left untouched is a FINDING, not a detail: both gates are diff-scoped and structurally
   cannot see an edit absent from a file the diff never touched.
   A DATA reference is a call site too: for every field the change adds that holds another
   record's id, enumerate the places that write it, read it and REMOVE it. A deletion path that
   strips one holder and not its siblings leaves a dangling reference — the record rendering a
   pointer to something that no longer exists — and it is invisible to both gates for the same
   diff-scoped reason.
2. **Verify against the commit, not the working tree.** The commit is the unit of verification.
   Reading a file in the working tree is NOT verification. For every task, run
   `git show --stat <that task's sha>` and assert that every file the task claims to change
   appears in THAT commit. A task whose claimed file is absent
   from its commit FAILS, even though the working tree holds the intended edit, the suite passes
   and both gates are green.
3. **Declare lifecycle bookkeeping.** A task that is bookkeeping about the change's own lifecycle
   rather than its work — above all the task that archives the change itself, which always
   qualifies — carries the literal marker `<!-- pm:lifecycle -->` on the task line. The engine
   infers this from nothing else: not the wording, not the commands the text names, not the
   position in the file. Mark it when the task source is authored OR AMENDED — a source written
   before this capability existed gets the marker the first time you touch it, or its archive task
   counts as outstanding work forever.
4. **Attribute every commit to its epic.** At the moment each commit is made, record it:
   `update-epic <id> --attribute-commit <sha>`. The engine infers attribution from nothing — not
   the files a commit touches, not an epic id in a message — so an unrecorded commit is a commit
   the epic's Gate 2 cannot be checked against. The per-task conventional commit of an OpenSpec
   apply loop always qualifies, and work already in flight is covered: attribute the commits
   already made, in the order they landed, since the last entry is the endpoint a recorded Gate 2
   `headSha` is compared against. **One exclusion:** the commit that moves
   `openspec/changes/<id>/` under `archive/`, and any commit that only relocates or deletes a
   change's artifacts rather than implementing its work, is lifecycle bookkeeping and
   MUST NOT be attributed — that move lands after the reviewed range by construction, so attributing it makes
   the epic's own Gate 2 stale at the instant the archive gate reads it.
5. **End work by recording a disposition.** An epic, a story, a deferral or a release exclusion
   ENDS by recording a terminal disposition carrying its required reason —
   `update-epic <id> --status archived --outcome delivered|killed|superseded|abandoned
   --reason "<why>"` (every outcome except `delivered` requires the reason) — and
   never by removing the record. Deletion removes the record of projected work, which is
   precisely what a disposition exists to preserve. `remove-epic` stays available and ungated for
   what it is for: an epic registered in error, a duplicate, a mistake made a minute ago — where
   there is no disposition to record because there was no work.
