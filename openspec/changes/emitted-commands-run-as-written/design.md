## Context

See proposal.md "Why" for the defects and `repro.txt` for their reproductions. Constraints:

- `scripts/conductor.mjs` and `scripts/lib/*.mjs` are zero-dependency and zero-network. pm never
  calls a tracker; every tracker fix here is a change to TEXT the agent follows.
- 0.44.0 shipped a pre-dispatch argv check (`checkCommandLine()`, `argv-surface.mjs:122`). Its
  one-off sweep (archived `every-verb-refuses-what-it-does-not-read/call-site-sweep.md` §5) is the
  only time emitted lines were checked, and it checked argv shape only. Every remedy defect in this
  change passes that check — the missing piece is EXECUTION, and then checking that the execution
  FIXED something: Gate 1 lens A showed a stale-Gate-2 remedy filled with `--base-sha C0 --head-sha
  C0` exits 0 while the archive stays refused, and the two alternatives of
  `delivered-release-epic-left-open` run together leave one epic both archived `delivered` and
  deferred.
- The same remedy is already typed at several sites with different arguments. `GH_PREFLIGHT`
  (`rules.mjs:517`) and `dispositionInvocation` (`archive-gate.mjs:226`) each exist as "the one
  declaration" precisely so two sites cannot state one thing differently — but the `gh issue list`
  step and the gate-verdict remedy were never so declared, and that is how `updatedAt` came to be at
  `rules.mjs:762` and not `:826`, and the range flags at `briefing.mjs:222,235` and
  `integrity.mjs:249,263` and not `archive-gate.mjs:426,430-431` (both split across `+`).
- Line anchors are at `dev` f49871a. Change 1 (`commit-nudge-reads-the-whole-move`) lands first and
  edits `subcommands.mjs`; task 0.3 re-derives anchors after it merges.

## Goals / Non-Goals

**Goals:** every remedy pm prints clears what printed it; every tracker recipe can be filled from
what its own procedure fetched and stays the command it was when filled with third-party text;
shipped docs teach forms the engine accepts; no shipped text asks for a hand-edit; and a permanent
test that makes each of these a suite failure instead of a review finding.

**Non-Goals:**
- No `state.json` schema change and no migration.
- A single writer of `state.json` in hierarchy runs — moved to `hierarchy-run-has-one-state-writer`
  (proposal.md). This change corrects only the child doc's gate-recording FORM.
- Primary `set-tracker --remove` (missing inverse) and `--intent badpair` (silent drop) are carried
  to `code-review-0-43-0-minors` — reproduced, but neither changes an emitted command.
- No escaping of user text in rendered output: that is `user-text-never-forges-output`. This change
  only refuses a repository value that could alter a SHELL command, and instructs the agent to
  shell-quote item text it fills into one — neither is output escaping.
- The archive gate itself does not change (gh-189 explicitly asks that it not). Only what is
  OFFERED changes.
- The sweep does not execute every doc line (Decision 1: Layer A is argv-shape for docs).

## Decisions

### 1. A permanent sweep test, in three layers

New `scripts/test/emitted-invocations.test.mjs`. Keeping the 0.44.0 sweep as a one-off is how its
limits went unnoticed; a permanent test re-runs against every future edit of a remedy or a doc.

**Layer A — every invocation passes the pre-dispatch check.** Sources, derived at test time: the
rules block from `rulesBlock()` for each platform in `KNOWN_PLATFORMS` × a tracker matrix (none;
primary github-issues/jira × inward/outward/both × scoped/scope-less; plus a github-issues and a
jira secondary); `init` stderr; the commit-nudge message; and the shipped files `commands/*.md`,
`skills/**/SKILL.md`, `agents/*.md`, `README.md` (via `fs.readdirSync`, never a typed list). The
brief, `integrity`, `unconsidered-outcomes` and archive-gate refusal outputs join Layer A in
section 2, when Layer B's fixtures that produce them exist.

Extraction rules:
- An invocation is a dispatch-table verb (read from `conductor.mjs` as
  `verb-surface.test.mjs:dispatchedVerbs()` does) that is the first token of an inline code span, of
  a line in a fence that is not labelled `text`, or follows `conductor.mjs"` / `$ENGINE"`. Prose that
  merely begins with a verb name is outside all three. A fence labelled `text` is engine output and
  is never extracted.
- Code spans are read over the joined paragraph, so a span wrapped across a line break is one span.
  Fenced lines ending in `\` are joined to the next.
- In a fenced line, an unquoted `#` and everything after it is a shell comment and dropped.
- Placeholders are matched as `<…>` BEFORE tokenizing, so `<how they inform each other>` is one
  placeholder. `[…]` optional segments and a trailing `...` repetition are dropped. A bare `…` token
  (an elided run of flags) is dropped and the remainder checked.
- A parenthesised alternative group `(--a | --b)` expands to one invocation per alternative. A
  top-level ` | ` between whole forms after the verb (`set-lane-routing --add … | --remove … |
  --clear`) splits into one invocation per form, each prefixed with the verb.
- Placeholders are filled by NAME for Layer A (argv shape does not depend on meaning): `<id>` and
  `<epicId>` → a fixture epic id, `<sha>`/`<a>`/`<b>` → a real fixture commit, `<iso>` → a fixed
  timestamp, `<path>` → an existing file, any other placeholder → `x`; an `a|b` value takes `a`.

Refusal classes. `checkCommandLine()` gains a `class` on every refusal it returns:
`unknown-flag`, `extra-positional`, `id-as-flag`, `value-on-valueless-flag`,
`help-in-value-position`. The messages are unchanged; the class is what the test compares.

Markers, each placed IMMEDIATELY after the closing backtick of the one inline code span it applies
to (a marker anywhere else fails as unattached; a marker never reaches a second span):
- `<!-- pm:refused <class> -->` — a deliberate refused example; the engine must refuse it with that
  class.
- `<!-- pm:engine-message -->` — the span is engine output, not an invocation (README.md:1327).
- `<!-- pm:checkout-path -->` — a pm-developer note naming a checkout path, exempt from the
  installed-engine rule (skills/conductor/SKILL.md:70). It is NOT a refused-example marker.

Also in Layer A: every `/pm:<name>` must be a `commands/<name>.md` or `skills/<name>/`; the check
reads the name only, so `/pm:epic list` passes it and is caught by task 3.5 against the rules block
instead. Shipped `commands/*.md` and `agents/*.md` must not contain `node scripts/conductor.mjs`
without `pm:checkout-path`.

**Enumerated at f49871a** with a draft of these rules minus alternative expansion and `…` handling
(`/private/tmp/claude-501/-Users-robsherman-Documents-Repos-pm/6e8d4b47-4277-41f4-9b04-fc3cd23d9e92/scratchpad/propose45/emitted-commands-run-as-written/extract.mjs`, not committed): 736 invocations extracted from shipped docs, 33 refused. Gate 1
lens A's cruder extractor reported 21. Every one of the 33, and its disposition:

| Site | Invocation | Disposition |
|---|---|---|
| commands/activity.md:94 | `activity --bogus` | mark `unknown-flag` |
| commands/activity.md:99 | `set-activity-log on extra` | mark `extra-positional` |
| commands/claim.md:43 | `claim --repo --session s --Steal` | mark `unknown-flag` |
| commands/detour.md:21 | `log-detour fixed --no-verify usage` | mark `unknown-flag` |
| commands/epic.md:128 | `remove-epic --id e2` | mark `id-as-flag` (the wrapped `set-active --id e2` beside it too, once spans join) |
| commands/epic.md:164 | `add-many --from b.json --external-id X` | mark `unknown-flag` |
| commands/epic.md:462 | `update-epic e1 --title My Title` | mark `extra-positional` |
| commands/epic.md:661 | `remove-epic p --cascade true` | mark `extra-positional` |
| commands/epic.md:689, 690 | `set-active <id>     # …`, `clear-active        # …` | rule: shell comment dropped |
| commands/lane-routing.md:61 | `suggest-lane fix a typo` | mark `extra-positional` |
| commands/lane-routing.md:66 | `suggest-lane reads ONE text argument — quote it.` | rule: `text` fence skipped |
| commands/status.md:61 | `set-active e2 --diff-summary` | mark `unknown-flag` |
| commands/status.md:216 | `release 0.27.0 --member <epicId> [--member <epicId>]...` | rule: optional repetition dropped |
| commands/status.md:252, 253 | `release show …   # …` | rule: shell comment dropped |
| commands/tracker.md:65 | `set-tracker --role secondary --remove …` | rule: `…` dropped |
| commands/triage.md:89, 92, 99 | `add-epic --id <new> … --link "…"` | rule: `…` dropped, spaced placeholder |
| skills/conductor/SKILL.md:99 | `remove-epic <id> --cascade true` | mark `extra-positional` |
| skills/conductor/SKILL.md:143 | `push-detour … (--reconcile \| --no-reconcile)` | rule: group expanded |
| README.md:346, 1292 | `remove-epic <id> --cascade true` | mark `extra-positional` |
| README.md:433 | `push-detour … (--reconcile \| --no-reconcile)` | rule: group expanded |
| README.md:779 | `set-lane-routing --add … \| --remove … \| --clear` | rule: top-level forms split |
| README.md:1276 | `add-epic --id h1 --title --help` | mark `help-in-value-position` |
| README.md:1295 | `add-epic … --title My Title` | mark `extra-positional` |
| README.md:1326 | `suggest-lane fix a typo` | mark `extra-positional` |
| README.md:1327 | `suggest-lane reads ONE text argument — quote it.` | mark `engine-message` |
| README.md:1328 | `log-detour fixed --no-verify usage` | mark `unknown-flag` |
| README.md:1344 | `remove-epic --id e2` | mark `id-as-flag` |
| README.md:1353 | `integrity --force` | mark `unknown-flag` |

19 refused-example markers, 1 engine-message marker, 13 resolved by extraction rules, 0 doc lines
that are wrong and must be FIXED (the two fixes Layer A drives — `commands/upgrade.md:226` and
`commands/cross-spec-review.md:85` — are reference and path defects, not refusals). The GREEN commit
saves the test's own refusal list as `sweep-layer-a.txt` in this change directory; where it differs
from this table, the file is authoritative and the difference is stated in the commit.

**Layer B — every engine-printed remedy clears what printed it.** The population is read from three
exported registries:
- `CHECKS` in `integrity.mjs` (exists; 17 ids at f49871a).
- `DELIVERED_OBLIGATIONS` — NEW export in `archive-gate.mjs`: the variants `deliveredObligations()`
  can report, each with its remedy renderer: `gate2-missing`, `gate2-withdrawn`, `gate2-stale`,
  `gate2-attribution-withdrawn`, `handoff`. `deliveredObligations()` is rewritten to select from it,
  so a new variant cannot exist only as a branch inside the function.
- `BRIEF_REMEDIES` — NEW export in `briefing.mjs`: every brief warning that prints an engine
  invocation (today: tracker refresh owed, ungated archive, withdrawn Gate 2 archive, not yet in the
  outward tracker, never re-read), each an entry `{id, render}` that `buildBrief()` calls.
Plus the two non-registry printers: `unconsidered-outcomes` entries and update-epic's archived-record
regression refusal (`update-epic.mjs:124`).

For each entry the test holds a fixture builder keyed by id. The protocol, per builder:
1. Build a fresh hermetic fixture repo (`hermetic-git.mjs`: own identity, `commit.gpgsign=false`,
   fail loudly; real commits) that reproduces the condition; run the PRODUCER and assert the
   condition is reported.
2. Extract the remedy invocations from that output. A message offering alternatives ("…, or …")
   yields one alternative per builder run: the builder names which alternative it follows, and each
   alternative gets its OWN fresh fixture. Alternatives are never run in sequence in one repo.
3. Fill placeholders BY MEANING from the fixture, never by name alone: `--base-sha` is the parent of
   the epic's first attributed commit, `--head-sha` its last attributed commit; `--artifact` is an
   artifact file the fixture wrote; `<epicId>` in `--carried-to` is a fixture epic created for that
   purpose; `--reason "<why>"` a fixed string.
4. Run the invocations in the order printed; each must exit 0.
5. Re-run the PRODUCER and assert the condition is no longer reported for that epic (for a refusal,
   re-run the refused command and assert it now succeeds), AND assert the epic still exists — a remedy
   that clears a finding by removing its evidence fails.
A condition about a stored identifier no verb can rename (change 3's control-character identifiers)
prints no remedy by design; its builder asserts the message names the record and says no verb can
rename it, and that no command is extracted from it.
A builder may declare `prints: none` (the test asserts the output carries no invocation) or
`unconstructable: "<why>"`. The test asserts the number of `unconstructable` declarations equals a
constant that is **0**; adding one means raising that constant in the same commit. All 17 checks are
buildable, including `recorded-sha-the-repository-cannot-resolve`: record a real commit made on an
orphan branch, delete the branch, `git reflog expire --expire=now --all`, `git gc --prune=now` — AND
attribute one commit that stays reachable. The check probes whether git can answer at all: when no
recorded sha resolves it skips the absent arm (`integrity.mjs:772`, `if (arm === "absent" &&
resolvable === 0) continue`), so a fixture holding only the destroyed sha reports nothing and the
builder would assert against silence.

**Layer C — tracker recipes execute for every role and system.** `conductor-14`'s github-issues
primary execution (`conductor-14.test.mjs:641`) is generalised: for every inward section in the
Layer A matrix, fill the registration line from a synthetic item of that system's key shape (`42`
for github-issues; `ABC-123` and `ABC-124` for jira), following the section's own quoting
instruction, and run it through `sh -c`. `<issue-updated-at>` is filled only if that section's
listing step requests an updated field. One item title in the set is
``it's "done" $(touch pwned) `id` ``; the stored title must read back byte-identical and no `pwned`
file may exist.

*Alternatives considered.* Executing every doc line (rejected: most doc invocations need
preconditions specific to their paragraph; the fixture set would be a second engine). A typed
allowlist of refused examples in the test (rejected: CLAUDE.md required item 1 — a typed list goes
stale; the marker lives beside the example). Classifying refusals by matching message text
(rejected: the messages are prose and are being edited by change 3; a class field is stable).
Grepping engine SOURCE for remedy strings (rejected: template literals split invocations across
`+`; rendering the output is exact).

### 2. One renderer per remedy, and the disposition invocation reads the epic

- `gateRemedy(id, gate)` in `archive-gate.mjs`: Gate 2 → `record-gate-review <id> --gate 2 --verdict
  pass --base-sha <sha> --head-sha <sha>`; Gate 1 → `record-gate-review <id> --gate 1 --verdict pass
  --artifact <path>`. Callers: `archive-gate.mjs:426` and `:430-431` (Gate 2; both split across `+`),
  `briefing.mjs:222,235` (Gate 2), `integrity.mjs:249,263` (Gate 2), and `integrity.mjs:750-752`,
  which today prints `--gate <n> --verdict <v> --base-sha <sha> --head-sha <sha>` for a malformed
  value on EITHER gate: it groups the malformed records by `where` (`gate1.*` / `gate2.*` /
  `attributedCommits`, from `recordedShas()` at `integrity.mjs:109`) and prints `gateRemedy(epic, 1)`
  for a Gate 1 value, `gateRemedy(epic, 2)` for a Gate 2 value, and the withdrawal for an attribution.
  The call-site sweep (task 9.1) is multi-line — `rg -n -U -e "--gate 2[^;]*?--verdict" -e "--gate <n>"
  -e "--gate \\$\\{" scripts/lib` — and also greps for `'record-gate-review` at a string start, so a
  form split across `+` cannot be missed.
- `dispositionInvocation(epic, opts)` takes the epic. Unless `opts.keepDelivered`, it calls
  `deliveredObligations(epic)`; if any obligation fails, the `--outcome` choices omit `delivered`.
  `blockedDelivered(epic)` returns `[{kind, detail, remedy}]` from `DELIVERED_OBLIGATIONS`. Callers:
  `archive-gate.mjs:257` (`unconsideredOutcomes`), `integrity.mjs:531` — both apply the rule — and
  `update-epic.mjs:136` (regression refusal), which passes `keepDelivered: true`.
- Regression refusal (`update-epic.mjs:124-155`): the epic's `delivered` was already considered, so
  its invocation keeps `delivered`; for each broken obligation it prints that obligation's remedy
  line BEFORE the invocation (`gate2-*` → `gateRemedy(id, 2)`; `handoff` → tick the tasks or record
  `--carried-to`). The existing "the invocation is the only line beginning `  update-epic `" rule is
  kept: remedy lines are introduced by prose and never begin with `update-epic`.
- `unconsidered-outcomes` JSON gains `deliveredBlockedBy: [...]` per entry (always present, `[]` when
  nothing blocks). A `gate2-missing` detail says the record shows no Gate 2 review of that work and
  that `delivered` requires one — the process finding gh-189 asked to have stated.
- `integrity`'s `delivered-release-epic-left-open` (`integrity.mjs:662-667`): when
  `deliveredObligations(e)` fails, the archive alternative names each obligation and its remedy
  FIRST, then the archive invocation; the `release --defer` alternative is unchanged. The message
  keeps the two alternatives explicitly separate ("either … or …") so Layer B runs each alone.
- `rules.mjs` `closedItemStep()` prints `--outcome ${AGENT_OUTCOMES.join("|")}` with a placeholder id
  — it cannot know the epic. It gains one sentence: for an openspec-lane epic `delivered` also needs a
  passing Gate 2, and `unconsidered-outcomes` or the refusal names it.

*Why omit `delivered` rather than annotate it:* an annotated choice list is still a command that
fails when copied, which is the defect. *Tradeoff:* an agent that has just recorded Gate 2 must
re-run `unconsidered-outcomes` to see `delivered` offered again. Accepted — the output is recomputed
from the record, never cached.

### 3. One declaration of the inward procedure's list and watermark steps

`inwardListStep(tracker)` and `watermarkStep(n)` in `rules.mjs`, called by BOTH the primary inward
section and every secondary section:

- github-issues (repo passes Decision 4's shape): `` `gh issue list --repo <repo> --state open
  --limit 1000 --json number,title,url,updatedAt,labels` `` followed by `GH_PREFLIGHT` and a bound
  sentence: if it returns 1000 items the list may be truncated — raise `--limit` and list again; do
  not run the closed-item step on a list that reached its bound.
- other systems: "List ALL open items in <sys> (<scope>) with your own tooling — every page —
  reading each item's key, title, url and updated timestamp."
- `watermarkStep` is today's primary step 5 text, moved; the secondary section gains it before the
  closed-item step (steps renumber; `closedItemStep(platform, sys, n)` already takes `n`).

1000 is a bound, not a claim about any repo's size; `gh` pages internally up to it (verified:
`gh issue list --repo cfdude/pm --state all --limit 1000` returned all 109 items, `repro.txt`). A
truncation STOP rather than a larger number, because no fixed number is safe and a silent cap is the
defect. *Tradeoff:* a repo with more than 1000 open items hits the stop on every sync until the agent
raises `--limit`; that is visible and correctable, where today's cap of 30 is neither.

**Id derivation for non-numeric keys.** github-issues keeps `<issue-number>` (digits are valid id
characters). Every other system's registration line becomes `add-epic --id <prefix>-<issue-key-slug>
… --external-id <issue-key>`, and the recipe defines the placeholder inline: the key lowercased with
every run of characters outside `a-z0-9` replaced by `-` (`ABC-123` → `abc-123`), giving
`jira-abc-abc-123`. *Alternative rejected:* the numeric suffix only (`jira-abc-123`) — a JQL or
project move can surface `XYZ-123` in the same scope, and two distinct keys would derive one id.
*Tradeoff:* the id repeats the project key. *Compatibility:* no inward jira epic could have been
registered by the old recipe verbatim (it was refused); an agent that improvised `jira-abc-123` is
still deduplicated by step 2's `externalUrl` match, which runs before registration.

**Item-sourced values are shell-quoted by instruction.** `<issue-title>` and `<issue-url>` are
third-party text. The recipe stops wrapping them in double quotes and places each where the engine reads it as a
VALUE whatever its shape — quoting changes what the shell passes, never the token the engine
classifies, and `FLAG_TOKEN` (`^--[a-z][a-z0-9-]*(?:=|$)`) reads `--limit=5 ignored` as a flag even
inside quotes. So the registration line emits `--title=<issue-title>` (inline form: the whole
`--title=…` token is ONE word, and a value after `=` is never reclassified; measured:
`--title='--limit=5 ignored'` is accepted and stored exactly) and `--external-url=<issue-url>`, and
lane routing emits `suggest-lane --ask=<issue-title>`. `--ask` is a NEW value-bearing registry row
on `suggest-lane` (`constants.mjs`), so the argv check and `--help` project it like any other flag;
the positional form keeps working unchanged. Supplying both `--ask` and a positional text is refused
as a surplus positional — one verb, one text. The inline `--flag=value` form is what carries a
flag-shaped or help-shaped value through the pre-dispatch check: measured, `add-epic
'--title=a=b --limit=5 x'`, `--title=--help` and `--title=-h` each exit 0 and read back exactly.
*Alternative rejected:* a lone `--` ending flags on free-text verbs — it contradicts three existing
`verb-surface` requirements (undeclared flag-shaped tokens are refused; argv-level flags never join
the text, so `log-detour -- fixed --force` would log `fixed --force`; a help token anywhere prints
help), and no requirement there is modified by this change. The quoting rule applies to the whole
token, `--title=…` and `--ask=…` alike. It states once,
above the registration line: "Fill every placeholder
taken from the item — `<issue-title>`, `<issue-url>` — as ONE shell-quoted word: wrap the value in
single quotes and write each `'` inside it as `'\''`. Never use double quotes: `$(…)`, backticks and
`"` inside them change the command. Keep `--title=` and `--ask=` attached to their values: that is what lets
a title that starts with `-` reach the engine as a title." A newline inside single quotes is literal,
so a multi-line title stays one word. The engine-derived placeholders (`<issue-number>`,
`<issue-key-slug>`, `<lane>`) and the timestamp need no quoting — their shapes are fixed.
*Alternative rejected:* a Non-Goal. The recipe is pm's text and the defect is a command an agent runs
as written; single quotes with the `'\''` rule are POSIX and work in every shell pm documents.
`<issue-key>` for non-github systems is item-sourced too and is covered by the same sentence.

**`/pm:epic list`** is removed from both dedup steps: "check `.conductor/state.json` for an epic whose
`externalUrl` matches" (reading is not a hand-edit).

**Completion-sync reminder** (`rules.mjs:858-871`): its "(the writeback steps above)" clause is
emitted only when the block holds a writeback or transition step — `outwardApplies(tracker)` or at
least one emitted secondary section. Otherwise the reminder reads "After you finish an epic linked to
an item here, immediately re-sync…". The existing requirement already demands this; the change is
the text plus a test that resolves the reference instead of checking the heading.

**Outward section:** the "record its key" line gains `--external-updated-at <iso>` (the created
issue's own timestamp), so an outward-created link starts with a watermark and never enters the
never-re-read count.

### 4. Repository shape and vendor switch (`tracker.mjs`)

- `isGithubRepo(value)` in `constants.mjs`: `^[A-Za-z0-9](?:[A-Za-z0-9-]*)\/[A-Za-z0-9._-]+$`.
  `set-tracker` refuses a github-issues `--repo` failing it, for both roles, before anything is
  written, quoting the refused value through `escapeControls` (`constants.mjs`) so the refusal
  cannot itself carry a control character — EXCEPT with `--remove`, which matches the recorded value exactly
  (`secondaryTrackerKey`) and writes nothing new, so a legacy malformed secondary stays removable
  (verified today: removal of `a/b; touch pwned` exits 0; kept as a regression guard).
  `usesGhIssueList()` requires the shape, so a legacy malformed value falls through to the
  vendor-neutral listing step and is never placed in a shell line. `trackerScope()` is unchanged.
- Primary vendor switch — when `--system` is given, a system is recorded, and they differ:
  - scope: delete `repo`, `projectKey`, `instance` unless the same call supplies them; print
    `conductor: dropped <field>=<value> recorded for <old system>` per field (value JSON-quoted).
  - direction: if the call names `--direction`, record it. Otherwise, if a direction is recorded,
    keep it. Otherwise record `directionOf(<the tracker before the switch>)` — the direction the repo
    was actually getting — and print `conductor: direction <d> recorded — kept from the previous
    <old system> tracker, which resolved to it; set-tracker --direction <…> to change it`.
    *Alternative rejected:* applying the new-tracker `inward` default. It is safe for a legacy
    github-issues primary but would silently turn OFF outward creation for a legacy jira primary
    switched to linear; keeping the prior resolved direction changes nothing the user was getting in
    either case, and the message says what was recorded.
  - `statusIntent` and `mechanism` are kept — they describe how the user works, not where.
  *Tradeoff:* a user switching vendor while intending to keep an `instance` must re-pass it; the
  message names what was dropped so nothing is lost silently.

### 5. Brief tracker lines (`briefing.mjs:271-310`)

Both lines become `BRIEF_REMEDIES` entries (Decision 1).
- Mirror line: with no secondary tracker, today's text (an external id can only be the primary's).
  With one or more secondaries, `✓ every active epic carries an external link (this record cannot
  tell which tracker holds it)`. *Rejected:* attributing by URL prefix — only a github-issues
  secondary has a predictable URL shape, and a partial attribution is a second rule to drift.
- Never-re-read line: `⚠ N tracker-linked epic(s) never re-read since mirroring — re-read each and
  record it with record-tracker-refresh <id> --verdict unchanged|material-change --external-updated-at
  <iso> (/pm:sync does this for the items it lists)`. Verified: `record-tracker-refresh` removes the
  line for a queued epic linked through an outward-only primary (`repro.txt` §B8).

### 6. Gate forms in docs

- Every passing `record-gate-review` form in shipped docs is replaced by `commands/epic.md:731-741`'s
  two-gate form. Sites: `skills/conductor/SKILL.md:117-119,322,1216`, `commands/review-mode.md:72`,
  `agents/hierarchy-child-executor.md:33`; re-derived with `rg -n "record-gate-review" commands skills
  agents README.md` at sweep time. The child doc keeps WHO records (a separate epic); only the form
  changes.
- The child doc's pm-repo-only paragraph (`:62-72`, README + `scripts/test`) is replaced by "if the
  change is user-facing, update the project's own docs in the same commit". `SKILL.md:994` likewise.
- `commands/review-mode.md:99`: an override is cleared with `update-epic <id> --clear review-mode`.
- `commands/upgrade.md:226`: `/pm:integrity` → `node "$ENGINE" integrity`.
- `commands/cross-spec-review.md:85`: installed-engine form with the `$ENGINE` resolution line.
- `commands/tracker.md:124-134`: "ongoing responsibilities" split by direction; `:152` gains
  `--limit`, `updatedAt` and the quoting sentence from the emitted step.

### 7. Hand-edit instructions

- `init` stderr (`subcommands.mjs:110-113`): `conductor: initialized. Triage with update-epic <id>
  --priority <P0-P3> --status <status> and set-active <id>, then /pm:status.`
- Commit nudge (`subcommands.mjs:495-496`, inside `runNudge`): `Otherwise record an epic's status or
  story change with update-epic (--status, --story <n> --done).`
- `SKILL.md:734`: "the PostToolUse hook reminds you — record status with `update-epic`"; `:738`:
  "PUSH/POP/priority: `push-detour`/`pop-detour`/`update-epic --priority`, then render."
- `commands/init.md:60-63`: step 2 names `set-active`, `update-epic --priority`, `update-epic --status`.

**The scanner, defined exactly.** Over each shipped markdown file, outside fenced blocks:
1. A UNIT is a paragraph (consecutive non-blank lines, joined with spaces) or a list item (a line
   starting with `-`, `*` or `N.` plus its non-item continuation lines, joined).
2. A unit's SENTENCES are split after `.`, `!` or `?` followed by whitespace.
3. A WRITE VERB in IMPERATIVE POSITION is one of `edit`, `hand-edit`, `update`, `set`, `modify`,
   `change`, `write`, `flip` followed by a space, at the start of the sentence, or directly after `:`,
   `;`, `—`, or the word `then`.
4. A NEGATION is any of `never`, `not`, `don't`, `do not`, `instead of`, `used to`, `without`,
   `no longer`, `rather than` in the same sentence.
5. HIT (a): a sentence with a write verb in imperative position, the literal text `state.json`, and no
   negation.
6. HIT (b): a list item nested (greater indent) under a unit that names the literal `state.json` and
   ends with `:`, whose first sentence has a write verb in imperative position and no negation. This is
   the only way a bare field name (`active`, `priority`) counts — never on its own, anywhere.
7. A sentence carrying `<!-- pm:explains-hand-edit -->` is exempt.
Measured at f49871a with a draft of exactly these rules (`/private/tmp/claude-501/-Users-robsherman-Documents-Repos-pm/6e8d4b47-4277-41f4-9b04-fc3cd23d9e92/scratchpad/propose45/emitted-commands-run-as-written/handedit3.mjs`, not committed): **3**
hits, all true — `commands/init.md:61` (rule b), `skills/conductor/SKILL.md:734` and `:738` (rule a).
Without joining wrapped lines the same rules report 6 (three negations sit on the previous line);
the broader of the two readings Gate 1 compared (a bare field name counting anywhere a write verb
appears) matched 55, and that reading is what rule 6 excludes. `init` stderr and the nudge message are asserted directly from output.

## Risks / Trade-offs

- [Layer A extraction misses an invocation shape] → each source class must yield at least one
  invocation, and the enumerated table above is re-derived by the test and saved at GREEN.
- [Layer B fixtures are expensive: 17 checks + 5 obligation variants + 5 brief warnings + two
  printers, alternatives doubling some, each spawning node] → measured in task 8.1 before Gate 2.
- [Markers become a way to silence a real defect] → a marker names the class it expects and the
  engine must refuse with exactly that class; a marker binds to one span.
- [HTML comment markers in `commands/*.md` are read by the agent as prompt text] → they are short and
  declarative; the Mintlify copy is edited separately at release and never receives them.
- [Omitting `delivered` hides a legitimate outcome after Gate 2 is recorded] → the output is
  recomputed per call; the `deliveredBlockedBy` remedy is the path to it.
- [An agent ignores the quoting instruction] → the instruction is one sentence directly above the line
  it governs, and Layer C executes the recipe with a hostile title; pm cannot quote a value it never
  sees, which is the instruction-layer boundary.
- [Changed rules text for every tracker-configured repo] → re-rendered by `/pm:upgrade`; no state
  change, so rollback is re-rendering with the prior plugin.
- [A legacy github-issues `repo` that fails the shape loses its literal `gh` line] → it receives the
  vendor-neutral step, and `set-tracker --repo owner/name` restores it.

## Migration Plan

None for `state.json`. Release notes name the rules-text changes (secondary watermark step, `--limit`,
quoting instruction, jira id placeholder), the vendor-switch messages, and the new
`deliveredBlockedBy` field.

## Coordination

- **`commit-nudge-reads-the-whole-move` (change 1)** owns `runNudge` in `subcommands.mjs`. This change
  edits only the final sentence of its non-detour message (`:495-496` today) and `init()`'s stderr
  (`:110-113`), after change 1 merges; task 0.3 re-derives both anchors.
- **`user-text-never-forges-output` (change 3) — identifiers no verb can rename.** Change 3 refuses a
  control character in an identifier at input and, for one stored before that rule, prints a message
  naming the record and saying no verb can rename it, with no runnable remedy and no hand-edit
  instruction. This change's R2 and `conductor-record` requirement carry that as an explicit
  exception, and Layer B asserts the message rather than executing a remedy. This change's `--repo`
  shape check also refuses any control character in a github-issues repo at input, and
  `usesGhIssueList()` requires the shape, so a control-character repo never reaches the emitted
  `gh issue list --repo` line — the shell-line half of change 3's D4a for that field is already closed
  here; change 3's prose escaping of the scope still applies.
- **`user-text-never-forges-output` (change 3)** edits `briefing.mjs`, `integrity.mjs` and
  `archive-gate.mjs` to escape user-supplied values. Disjoint concerns: this change edits the remedy
  COMMANDS (`gateRemedy`, `dispositionInvocation`, the delivered-release and malformed-value findings),
  moves the brief's remedy warnings into `BRIEF_REMEDIES`, and rewrites the two tracker lines; change 3
  escapes the user VALUES interpolated beside them. Where both touch one template literal, change 3
  applies its escaping to this change's rewritten literal, and its escaping must survive the move into
  `BRIEF_REMEDIES` entries. Neither the `--repo` shape rule nor the quoting instruction is output
  escaping.
- `hierarchy-run-has-one-state-writer` (moved out) will edit `agents/hierarchy-child-executor.md`
  after this change; this change touches only that doc's gate FORM line and pm-repo-only paragraph.
- Layer A reads change 3's rendered refusals once section 2's fixtures exist; if change 3 alters a
  refusal's remedy text, the sweep covers it.
