## Context

Line anchors below are as of `dev` f49871a (engine 0.44.0); task 0.3 re-derives them.

- `escapeControls(s)` and `CONTROL_CHARACTER` live in `scripts/lib/constants.mjs` (0.44.0). The class is
  C0, DEL, C1, U+2028, U+2029; each is rendered as backslash, `u`, four lowercase hex digits. It is used
  by the pre-dispatch argv refusals (`argv-surface.mjs`), `update-epic.mjs`'s archived-epic regression
  refusal, parts of `archive-gate.mjs` and `integrity.mjs`, `git.mjs`'s unresolved-commit message and
  `state.mjs`'s lock/unreadable messages. Everything else interpolates raw.
- `render.mjs` builds `PROJECT.md` with `md.push` template literals. Five tables (Detour stack, Epics,
  Dispositions, Gate reviews, Recent detours) assemble rows by hand; only Dispositions escapes `|`, and
  only in the reason, and not newlines. PROJECT.md also embeds the brief inside a ``` fence.
- `briefing.mjs` builds the brief as lines; the `brief` hook wraps it in JSON, so a newline is
  `\n` in the bytes and a real line break in what the agent reads.
- Epic creation funnels through `pushEpic()` (`state.mjs`), called from `add-epic.mjs`, `add-many.mjs`,
  and `subcommands.mjs` three times (`backfillArchive`, and `sync` for active changes and plan files).
  `add-epic` and `add-many` validate `^[a-z0-9][a-z0-9._-]*$` themselves (the regex is spelled three
  times: `add-epic.mjs`, `add-many.mjs`, `verify-specs.mjs`); the three `sync` paths validate nothing.
- `release()` (`releases.mjs`) creates a release from `argv[0]` with no id check.
- `appendDetourLog()` (`git.mjs`) collapses `\s+` in a note to one space before writing, so the log
  cannot hold LF/CR/TAB/U+2028/U+2029 from a note — but it can hold `|`, NEL and other C0 controls
  (JS `\s` does not include U+0085 or ESC).
- `honchoMemoryLine()` (`subcommands.mjs`) formats one line from a caller reason; `push-detour`,
  `pop-detour` and `honcho-memory` print it and append `<iso>\t<line>` to `honcho-memories.log`.
- The strict state reader (`shapeProblem`, `state.mjs`) checks four structural rules and no field types.
- Registries the test can bind to already exist and are held complete by tests: `EPIC_FLAGS` /
  `VERB_FLAGS` with `valueBearingFlagsFor()`; `VERB_POSITIONALS` (with `freeText` and `idFirst`);
  `VERB_EFFECTS` (read-only verbs carry `exercise` argv).

## Goals / Non-Goals

**Goals:**
- One rule an implementer cannot forget: the rule is enforced by a test whose populations are the
  engine's own registries, not by a list of sites.
- Identifiers are refused at input on every path that stores one; free text is escaped at output.
- Nothing already stored becomes unreadable.

**Non-Goals:**
- Markdown inline syntax inside a value (a backtick closing a code span, `**`, a link). Those change
  emphasis within one line; they cannot create a line, a heading, a list item or a table cell. Once
  no value can begin a line, no value can open or close the ``` fence PROJECT.md embeds the brief in,
  because a fence opens and closes only at line start.
- JSON outputs (`triage`, `suggest-lane`, and any other verb whose whole stdout is one JSON document):
  `JSON.stringify` already escapes C0; their consumer parses rather than reads lines.
- Changing what `add-epic` or `add-many` accept (both already enforce the id format).
- Tightening the strict reader, or a migration that rewrites stored values.
- Commit-subject or other git text printed by `commit-nudge` — sibling change
  `commit-nudge-reads-the-whole-move` owns that verb's output; the test's surface sweep will cover it
  once both land (see Coordination).

## Decisions

### D1. Two helpers, both in `constants.mjs`
- `escapeControls(v)` — unchanged, the LINE escaper. Idempotent (its output contains no control
  character), so a shared helper that feeds both PROJECT.md and the brief (`releaseLine`,
  `outcomeOf`, `correctionNote`, `gateTableRows`, `withdrawnArchiveNote`) may apply it without risk of
  double escaping. Callers pass `String(v ?? "")` semantics; the helper already coerces.
- `escapeTableCell(s)` — NEW: `escapeControls(s)` then every `|` → `\|`. NOT idempotent (a second
  pass turns `\|` into `\\|`), so it is applied exactly once per cell, by one function:
  `tableRow(...cells)` in `render.mjs` returns `| c1 | c2 | … |`. Every data row of every PROJECT.md
  table is built by `tableRow`; header and separator rows stay literal. The Dispositions reason's
  existing `.replace(/\|/g, "\\|")` is removed so it is not escaped twice.
- Where a refusal already JSON-quotes a value (`escapeControls(JSON.stringify(v))`), it stays: that
  form is compliant and changing it is churn.

**Alternative considered:** a tagged template (`text\`…${v}…\``) that escapes every interpolation by
default, with an explicit `trusted()` wrapper for engine-built multi-line blocks. Safer by default, but
it rewrites every output literal across roughly forty files, and a misplaced `trusted()` is exactly the
kind of forgotten edit it was meant to remove. The sweep test (D3) catches a missed site under either
mechanism, so the smaller diff wins.

### D2. Escape at output for free text; refuse at input for identifiers
| Field class | Where handled | Why |
|---|---|---|
| Epic id, release id | refused at input (D4, D5); still escaped at output | ids are pasted into emitted commands (`update-epic <id> …`); an escaped id in a command names a different epic, so the only safe id is one that never needed escaping. Output escaping remains for legacy values. |
| Titles, descriptions, notes, detour reasons, disposition/deferral/withdrawal/link reasons, release intent/target, story titles, reviewer identity, session names, external ids/urls, plan/spec paths, log-detour notes, honcho reasons | escaped at output | free text is legitimately arbitrary (tracker titles are third-party); refusing a newline in a title would make the inward sync recipe fail on a real issue. The stored value stays exactly what the caller wrote. |
| Unknown ids in a refusal (never stored) | escaped at output | nothing to store; the refusal is the only surface |

### D3. The enforcement test — `scripts/test/output-text-integrity.test.mjs`
The rule lives in a test whose populations come from registries, per
`docs/lessons/bind-rules-to-functions-not-enumerations.md`.

- **Poison.** `P = "x" + LF + "FORGED" + U+2028 + "FORGED" + U+0085 + "FORGED" + CR + "FORGED|FORGED"`.
- **Inputs.** A `POISON_RECIPES` table in the test, keyed `"<verb> --<flag>"` for every entry of
  `valueBearingFlagsFor(verb)` over every verb with a flag row, plus `"<verb> <positional>"` for every
  `VERB_POSITIONALS` entry with `freeText: true`. Each key maps to either an invocation that stores or
  echoes `P` through that input, or `{ exempt: "<the check that refuses the value>" }` (a vocabulary,
  the id format, commit resolution). A completeness assertion holds the key set equal to the registry
  projection, so a new value-bearing flag without a recipe fails the suite — the same shape as
  `conductor-31`/`conductor-25`.
- **Legacy stored values.** One fixture step writes `P`-bearing epic ids, a release id and a detour
  frame directly into `state.json` (shape-valid). This is the documented exception to
  `docs/lessons/fixtures-the-product-should-refuse.md`: the product now refuses these at input, and the
  test exists precisely to prove the READ side tolerates and neutralises what an older engine stored.
- **Surfaces.** `render` (PROJECT.md), `brief` (decoded `additionalContext`), every `VERB_EFFECTS`
  read-only verb run with its `exercise` argv (stdout skipped when it parses as one JSON document),
  `release show`, `release show <poisoned id>`, and for every `VERB_POSITIONALS` entry that takes an
  epic id (`EPIC_ID`, `idFirst`) or `<releaseId>`, an invocation with `P` as that id. Every recipe's
  own stdout/stderr is a surface too.
- **Assertions.** (a) prose: no occurrence of `FORGED` is at the start of a line or immediately after a
  raw LF, CR, U+2028, U+2029 or U+0085 (prose does not escape `|`, so `|FORGED` is legal there);
  (b) no prose surface contains a raw U+2028, U+2029, U+0085 or CR; (c) cells: every PROJECT.md table
  data row has the header's cell count, counting `\|` as content, and every `FORGED` inside a row is
  preceded by an escape sequence or `\|`; (d) `honcho-memories.log` has one line per entry;
  (e) emitted invocations: no printed `update-epic`/`record-*`/`release` invocation line contains an
  escape sequence in an id position (spec: a malformed stored id is never escaped into an emitted
  command).
- **Secondary source guard** (cheap, precise, not the rule): in `render.mjs`, no `md.push` argument
  that begins with `|` other than header and separator rows — every data row goes through `tableRow`.

### D4. Epic id format enforced at the sink, reaction chosen by the caller
- `EPIC_ID_FORMAT = /^[a-z0-9][a-z0-9._-]*$/` exported from `constants.mjs`; `add-epic.mjs`,
  `add-many.mjs` and `verify-specs.mjs` import it instead of spelling it.
- `pushEpic()` throws `InvalidEpicIdError` (carrying the raw id) when `epic.id` does not match. It is
  the one creation sink, so a future registration path cannot skip the check.
- `add-epic` / `add-many` keep their earlier refusals and wording (they fire first); `add-many`'s
  `bad id '${id}'` and story-title messages are escaped.
- `sync` and `backfillArchive` test the derived id BEFORE calling `pushEpic` and skip the entry with
  one stderr line: `conductor: sync skipped <kind> '<escaped name>' — its name is not a valid epic id
  (^[a-z0-9][a-z0-9._-]*$); rename it to register it`. Printed on EVERY run while the entry exists,
  `quiet` included (the commit-nudge path) — unlike the existing duplicate-id skip lines. A skipped
  active change or plan file has no other reported condition (only an archive directory has
  `integrity`'s check), so silencing it under `quiet` would make an unregistered change look like a
  clean sync.
- `integrity`'s `archive-directory-has-no-epic` detail keeps "`/pm:sync` registers it" only for a
  directory whose stripped id matches; a non-matching one says it must be renamed.

**Why skip, not refuse, in a sweep:** `sync` registers every change on disk; aborting it over one
directory name would block registration of every legitimate change in the same run, and it runs from
hooks where nobody sees an exit status. The asymmetry with `add-epic` is deliberate: a verb naming one
epic has one thing to refuse.

**Behaviour change stated:** an uppercase or otherwise non-matching change directory or plan filename
was registered before and is skipped after. `openspec new change` already enforces kebab-case, and
this repository's state holds no non-matching id (measured), so the expected population is nil.

### D4a. Emitted invocations take placeholders, not escapes
`gate-integrity` (`openspec/specs/gate-integrity/spec.md`, "The printed invocation" in the archived-epic
regression requirement) already rules that a control-character token is not echoed into a printed
invocation; its position carries a placeholder. Checked and NOT modified. This change extends the same
treatment to every other emitted invocation that interpolates a stored id — e.g. `integrity`'s
`update-epic ${e.id} --attribute-commit <sha>` remedies and the brief's `record-gate-review ${e.id} …`
lines: a non-matching id is replaced by `<epicId>` there, while the prose around it names the escaped
id. After D4/D5 only legacy ids can reach this branch. Sibling change 2 rewrites several of these
remedies; the placeholder rule applies to its wording.

### D5. Release id format at creation only
`release()` checks `EPIC_ID_FORMAT` only on the create branch (no release with that exact id exists),
before any write, and refuses with the escaped id. The update branch is untouched so a legacy
release id stays addressable. `record-cross-spec-review <releaseId>` and `release show <id>` are read
lookups and only escape.

### D6. One new capability, single owner
`output-text-integrity` owns both halves. Considered: deltas to `verb-surface` (refusal output),
`gate-integrity` (archive and integrity text), `epic-disposition` (release render),
`conductor-record` (sync/backfill registration). Rejected: the guarantee is one rule; spread over four
capabilities it becomes four phrasings of it — the double-ownership and vocabulary-fork pattern the
release-level cross-spec review exists to catch. `conductor-record` would have been the natural home
for the id-at-registration rule; it stays here because the reason for the rule is the output guarantee.

### D7. `honcho-memories.log` and the printed memory line
`honchoMemoryLine()` escapes the reason (and the epic id) with `escapeControls`, so the printed line
and the logged line are one line each. The ready-to-paste Honcho text then carries an escape where the
caller typed a newline; acceptable, because a memory is a one-line note by definition.

## Risks / Trade-offs

- **Readability of legitimately multi-line text.** A description written with newlines renders as
  one line with visible escapes on every surface. Measured: 0 string values in this repository's
  `state.json` contain a control character, so the cost here is nil; a user who wants structure in a
  description loses it in PROJECT.md. Accepted: the alternative (render a newline as a newline inside
  an indented block) re-opens the forgery for any surface that is not indented.
- **The recipe table is itself a list.** It is held complete against the flag and positional
  registries, so it cannot silently omit an input; it CAN hold a recipe that no longer stores the
  value (a verb starts refusing it). Mitigation: each recipe asserts its invocation exited 0 or is
  marked `exempt` — a recipe whose invocation starts failing fails the test rather than going quiet.
- **Surfaces not reached by an invocation.** A refusal branch the sweep never triggers (deep in a
  verb) is not covered by D3 — the call-site sweep (task 8.1) is the net for those.
- **Pipe escaping changes visible text** in cells holding `|` (8 titles/descriptions here, but titles
  and descriptions are not in tables today). Markdown renders `\|` as `|`, so rendered output is
  unchanged; raw text gains a backslash.

## Coordination

- `emitted-commands-run-as-written` (change 2) rewrites remedy text in `integrity.mjs` and
  `archive-gate.mjs`, the same template literals this change wraps (`delivered-epic-attributed-no-commits`,
  the handoff refusal, `archive-directory-has-no-epic`). Apply order is 1 → 2 → 3: rebase onto 2's
  wording and escape the values inside it; do not revert its text.
- `commit-nudge-reads-the-whole-move` (change 1) edits `subcommands.mjs` `commitNudge` and
  `commit-watch.mjs`; this change edits `sync`, `backfillArchive` and `honchoMemoryLine` in the same
  file. Its output is inside D3's surface sweep once both land; any raw value it prints is fixed here.
