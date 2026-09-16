## Context

See proposal.md "Why" for the defects and `repro.txt` for their reproductions. Constraints:

- `scripts/conductor.mjs` and `scripts/lib/*.mjs` are zero-dependency and zero-network. pm never
  calls a tracker; every tracker fix here is a change to TEXT the agent follows.
- 0.44.0 shipped a pre-dispatch argv check (`checkCommandLine()`, `argv-surface.mjs:122`). Its
  one-off sweep (archived `every-verb-refuses-what-it-does-not-read/call-site-sweep.md` §5) is the
  only time emitted lines were checked, and it checked argv shape only. Every defect in this change
  passes that check — the missing piece is EXECUTION.
- The same remedy is already typed at several sites with different arguments. `GH_PREFLIGHT`
  (`rules.mjs:517`) and `dispositionInvocation` (`archive-gate.mjs:226`) each exist as "the one
  declaration" precisely so two sites cannot state one thing differently — but the `gh issue list`
  step and the Gate 2 remedy were never so declared, and that is how `updatedAt` came to be at
  `rules.mjs:762` and not `:826`, and the range flags at `briefing.mjs:222,235` and
  `integrity.mjs:249,263,752` and not `archive-gate.mjs:426,431`.
- Line anchors are at `dev` f49871a. Change 1 (`commit-nudge-reads-the-whole-move`) lands first and
  edits `subcommands.mjs`; task 0.3 re-derives anchors after it merges.

## Goals / Non-Goals

**Goals:** every remedy pm prints runs; every tracker recipe can be filled from what its own
procedure fetched; shipped docs teach forms the engine accepts; no shipped text asks for a hand-edit;
and a permanent test that makes each of these a suite failure instead of a review finding.

**Non-Goals:**
- No `state.json` schema change and no migration.
- Primary `set-tracker --remove` (missing inverse) and `--intent badpair` (silent drop) are carried
  to `code-review-0-43-0-minors` — reproduced, but neither changes an emitted command.
- No escaping of user text in rendered output: that is `user-text-never-forges-output`. This change
  only refuses a repository value that could alter a SHELL command, which is a different property.
- The archive gate itself does not change (gh-189 explicitly asks that it not). Only what is
  OFFERED changes.
- The sweep does not execute every doc line (Decision 1, Layer A is lexical for docs).

## Decisions

### 1. A permanent sweep test, in three layers

New `scripts/test/emitted-invocations.test.mjs`. Keeping the 0.44.0 sweep as a one-off is how its
limits went unnoticed; a permanent test re-runs against every future edit of a remedy or a doc.

**Layer A — every invocation passes the pre-dispatch check.** Sources, all derived at test time:
the rules block from `rulesBlock()` for each platform in `KNOWN_PLATFORMS` × a tracker matrix
(none; primary github-issues/jira × inward/outward/both × scoped/scope-less; plus a github-issues
secondary and a jira secondary); `brief`, `integrity`, `unconsidered-outcomes` and the archive-gate
refusal text from the Layer B fixtures; `init` stderr; the commit-nudge message; and the shipped
files `commands/*.md`, `skills/**/SKILL.md`, `agents/*.md`, `README.md` (via `fs.readdirSync`,
never a typed list).

Extraction: an invocation is a verb from the dispatch table (read from `conductor.mjs` the way
`verb-surface.test.mjs:dispatchedVerbs()` does) that appears (a) after `conductor.mjs"` / `$ENGINE"`,
or (b) as the first token of an inline code span or a fenced-code line. Prose that merely starts
with a verb name ("integrity check") is outside both, which removes the noise class the 0.44.0 sweep
reported. Shell continuations are joined. Placeholders are filled from one table keyed by
placeholder name (`<id>`/`<epicId>` → a fixture epic, `<sha>`/`<a>`/`<b>` → a real fixture commit,
`<iso>` → a fixed timestamp, `<path>` → an existing file); `a|b` alternatives take the first; `[…]`
optional segments are dropped; `…` truncations are skipped and counted, and the count is asserted
below a bound so extraction breakage cannot pass silently. The check runs `checkCommandLine(verb,
argv, {initialized: true})` in-process.

Markers: a line carrying `<!-- pm:refused-example -->` (on the invocation's line or the line before)
must be REFUSED; any unmarked refusal fails. The deliberate examples 0.44.0 listed (`activity
--bogus`, `set-activity-log --on`, `add-many --from b.json --zzz`, `update-epic --id my-epic`,
`claim --repo --session s --Steal`) get the marker in the implementation commit.

Also in Layer A: every `/pm:<name>` must be a `commands/<name>.md` or `skills/<name>/`; shipped
`commands/*.md` and `agents/*.md` must not contain `node scripts/conductor.mjs` unmarked.
`skills/conductor/SKILL.md:70` (a pm-developer note) keeps its text and gains the marker.

**Layer B — every engine-printed remedy executes.** Population read from the engine: each id in
`integrity.mjs`'s exported `CHECKS`, each obligation `kind` `deliveredObligations()` can return
(`gate2` missing / withdrawn / stale, `handoff`), the `unconsidered-outcomes` entries, and the brief's
remedy-bearing warnings. The test holds a fixture builder keyed by those ids; an id with no builder
fails ("add a fixture"), and a builder may declare `prints: none`, in which case the test asserts
the output carries no invocation, or `unconstructable: "<why>"`, a recorded justification for that
one id. Surveyed at f49871a, all 17 `CHECKS` ids look constructable: most from a written state file
that passes the strict reader; `archive-directory-has-no-epic`, `change-registered-under-two-lanes`
and `heal-archived-epic-passed-gate-2` from `openspec/changes/archive/` directories;
`recorded-sha-the-repository-cannot-resolve` from a real commit recorded and then made unreachable
(`git reset --hard` plus reflog expiry). The escape hatch exists so that a later check whose
condition needs git state a fixture cannot build is a stated exception, not an amendment of the
spec mid-apply. Each fixture reproduces the condition, the output is captured,
its invocations are extracted with Layer A's extractor, filled from the fixture, and RUN in order in
that fixture repo; each must exit 0. Fixture repos use `hermetic-git.mjs` (own identity,
`commit.gpgsign=false`, fail loudly) and real commits (0.44.0 refuses placeholder shas).

**Layer C — tracker recipes execute for every role and system.** `conductor-14`'s existing
github-issues primary execution (`conductor-14.test.mjs:641`) is generalised: for every emitted
inward section in the Layer A matrix, fill the registration line from a synthetic item of that
system's key shape (`42` for github-issues; `ABC-123` and `ABC-124` for jira) — including
`<issue-updated-at>` ONLY if the section's listing step names an updated field — and run it.

*Alternatives considered.* Executing every doc line (rejected: most doc invocations need
preconditions specific to their paragraph; the fixture set would be a second engine). A typed
allowlist of refused examples in the test (rejected: CLAUDE.md required item 1 — a typed list goes
stale; the marker lives beside the example and a stale marker fails). Grepping engine SOURCE for
remedy strings (rejected: template literals split invocations across concatenations; rendering the
output is exact).

### 2. One renderer per remedy, and the disposition invocation reads the epic

- `gate2Remedy(id)` in `archive-gate.mjs` returns `record-gate-review <id> --gate 2 --verdict pass
  --base-sha <sha> --head-sha <sha>`. Callers: `archive-gate.mjs:426,431`, `briefing.mjs:222,235`,
  `integrity.mjs:249,263,752`. Call-site list re-derived by task 11.1 with `rg -n "gate 2 --verdict
  pass" scripts/lib`.
- `dispositionInvocation(epic, opts)` takes the epic. It calls `deliveredObligations(epic)`; if any
  obligation fails, the `--outcome` choice list omits `delivered`. A new
  `blockedDelivered(epic)` returns `[{kind, detail, remedy}]` — `gate2` → `gate2Remedy`, `handoff` →
  "tick the outstanding tasks, or record where the work went with `--carried-to <epicId>`". Callers:
  `archive-gate.mjs:257` (`unconsideredOutcomes`), `integrity.mjs:531`, `update-epic.mjs:136`.
- `unconsidered-outcomes` JSON gains `deliveredBlockedBy: [...]` per entry (always present, `[]`
  when nothing blocks) — gh-189's third suggestion, so a caller branches without parsing text.
  Where the `gate2` detail is "missing" on an epic, the entry's detail says the record shows no
  Gate 2 review of that work and that `delivered` requires one — the process finding gh-189 asked to
  have stated.
- `integrity`'s `delivered-release-epic-left-open` (`integrity.mjs:662-667`): when
  `deliveredObligations(e)` fails, the finding names each obligation and its remedy FIRST, then the
  archive invocation; otherwise today's text.
- `rules.mjs` `closedItemStep()` prints `--outcome ${AGENT_OUTCOMES.join("|")}` with a placeholder id
  — it cannot know the epic. It gains one sentence: for an openspec-lane epic `delivered` also needs
  a passing Gate 2, and `unconsidered-outcomes`/the refusal name it. Recorded here because a
  placeholder-id invocation is the one form Layer B cannot pre-check.

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
raises `--limit`; that is visible and correctable, where today's cap of 30 is neither. 1000 over a
smaller round number: it is well above any open-item count this project has measured (109 across all
states in pm itself) while keeping one sync to a bounded number of API pages.

**Id derivation for non-numeric keys.** github-issues keeps `<issue-number>` (digits are valid id
characters). Every other system's registration line becomes `add-epic --id <prefix>-<issue-key-slug>
… --external-id <issue-key>`, and the recipe defines the placeholder inline: the key lowercased with
every run of characters outside `a-z0-9` replaced by `-` (`ABC-123` → `abc-123`), giving
`jira-abc-abc-123`. *Alternative rejected:* the numeric suffix only (`jira-abc-123`) — a JQL or
project move can surface `XYZ-123` in the same scope, and two distinct keys would derive one id.
*Tradeoff:* the id repeats the project key. *Compatibility:* no inward jira epic could have been
registered by the old recipe verbatim (it was refused); an agent that improvised `jira-abc-123` is
still deduplicated by step 2's `externalUrl` match, which runs before registration.

**`/pm:epic list`** is removed from both dedup steps: "check `.conductor/state.json` for an epic whose
`externalUrl` matches" (reading is not a hand-edit).

**Completion-sync reminder** (`rules.mjs:858-871`): its "(the writeback steps above)" clause is
emitted only when the block holds a writeback or transition step — `outwardApplies(tracker)` or at
least one emitted secondary section. Otherwise the reminder reads "After you finish an epic linked to
an item here, immediately re-sync…". The existing requirement already demands this; the change is
the text plus a test that resolves the reference instead of checking the heading.

**Outward section:** the "record its key" line gains `--external-updated-at <iso>` (the created
issue's own timestamp), so an outward-created link starts with a watermark and never enters the
never-re-read count in the first place.

### 4. Repository shape and vendor switch (`tracker.mjs`)

- `isGithubRepo(value)` in `constants.mjs`: `^[A-Za-z0-9](?:[A-Za-z0-9-]*)\/[A-Za-z0-9._-]+$`.
  `set-tracker` refuses a github-issues `--repo` failing it, for both roles, before `loadState`
  writes anything. `usesGhIssueList()` requires it, so a legacy malformed value falls through to the
  vendor-neutral listing step and is never placed in a shell line. `trackerScope()` is unchanged (a
  legacy value still names the scope in prose and slugs safely into the id).
- Primary vendor switch: when `--system` is given, a system is recorded, and they differ, delete
  `repo`, `projectKey`, `instance` unless the same call supplies them; print `conductor: dropped
  <field>=<value> recorded for <old system>` per field (value JSON-quoted). `statusIntent`,
  `mechanism` and `direction` are kept — they describe how the user works, not where.
  *Tradeoff:* a user switching vendor while intending to keep an `instance` must re-pass it; the
  message names what was dropped so nothing is lost silently.

### 5. Brief tracker lines (`briefing.mjs:271-310`)

- Mirror line: with no secondary tracker, today's text (an external id can only be the primary's).
  With one or more secondaries, `✓ every active epic carries an external link (this record cannot
  tell which tracker holds it)`. *Rejected:* attributing by URL prefix — only a github-issues
  secondary has a predictable URL shape, and a partial attribution is a second rule to drift.
- Never-re-read line: `⚠ N tracker-linked epic(s) never re-read since mirroring — re-read each and
  record it with record-tracker-refresh <id> --verdict unchanged|material-change --external-updated-at
  <iso> (/pm:sync does this for the items it lists)`. `record-tracker-refresh` clears the count for a
  queued epic (verified: the line disappears).

### 6. Gate forms and the single writer in docs

- Every passing `record-gate-review` form in shipped docs is replaced by `commands/epic.md:731-741`'s
  two-gate form. Sites: `skills/conductor/SKILL.md:117-119,322,1216`, `commands/review-mode.md:72`,
  `agents/hierarchy-child-executor.md:33`; re-derived with `rg -n "record-gate-review" commands skills
  agents README.md` at sweep time.
- Hierarchy: the orchestrator is the sole writer (keeps `SKILL.md:1080`'s rule; the child doc
  changes). Reason: a child runs in a worktree but `ROOT = CLAUDE_PROJECT_DIR || cwd`, so its
  writes land in the main checkout while its branch is unmerged — an archive there records
  `delivered` for code not on the branch the record describes. The child's report keeps its wire
  format (`STATUS/DONE/DECISIONS/CONCERNS`, order unchanged); inside `DONE` it states each gate's
  verdict, reviewer and evidence (artifact paths / `base..head`). The orchestrator's batch-processing
  step records them with `record-gate-review` and the disposition with `update-epic … --status
  archived …` after the merge, attributing the merged commits first.
  **This is not a wire-format change.** The orchestrator branches on `STATUS` exactly as today; the
  evidence inside `DONE` is prose it READS, never parses into a branch. A child that phrases its
  evidence differently, or omits it, degrades to the orchestrator asking for it (or recording no
  verdict, which the archive gate then refuses) — never to a silently recorded verdict. No field is
  added, renamed or reordered, so `agents/hierarchy-child-executor.md`'s report contract and the
  Reporting rules' item 2 are unchanged.
- The child doc's pm-repo-only paragraph (`:62-72`, README + `scripts/test`) is removed; the
  equivalent user-facing instruction is "if the change is user-facing, update the project's own
  docs in the same commit". `SKILL.md:994` likewise.
- `commands/review-mode.md:99`: an override is cleared with `update-epic <id> --clear review-mode`.
- `commands/upgrade.md:226`: `/pm:integrity` → `node "$ENGINE" integrity`.
- `commands/cross-spec-review.md:85`: installed-engine form with the `$ENGINE` resolution line.
- `commands/tracker.md:124-134`: "ongoing responsibilities" split by direction (outward / inward /
  both), and `:152` gains `--limit` and `updatedAt` from the emitted step.

### 7. Hand-edit instructions

- `init` stderr (`subcommands.mjs:110-113`): `conductor: initialized. Triage with update-epic <id>
  --priority <P0-P3> --status <status> and set-active <id>, then /pm:status.`
- Commit nudge (`subcommands.mjs:495-496`, inside `runNudge`): `Otherwise record an epic's status or
  story change with update-epic (--status, --story <n> --done).`
- `SKILL.md:734`: "the PostToolUse hook reminds you — record status with `update-epic`"; `:738`:
  "PUSH/POP/priority: `push-detour`/`pop-detour`/`update-epic --priority`, then render."
- `commands/init.md:60-63`: step 2 names `set-active`, `update-epic --priority`, `update-epic
  --status`.
- Test: shipped docs are scanned line by line for `(edit|update|set|modify|change)` within the same
  sentence as `state.json` or a `.active`/`status`/`priority` field reference, excluding sentences
  carrying a negation (`never`, `not`, `don't`, `do not`, `instead of`, `used to`, `without`, `no
  longer`, `rather than`) or the marker `<!-- pm:explains-hand-edit -->`. `init` stderr and the nudge
  message are asserted directly from output.
  *Tradeoff:* a heuristic scan. Its false positives are resolved by a marker next to the text, never
  by a list in the test; its false negatives are bounded by the direct output assertions for the two
  engine-printed sites.

## Risks / Trade-offs

- [Layer A extraction misses an invocation shape] → the skipped-`…` count is asserted under a bound,
  and a doc with zero extracted invocations where the verb appears in a code span fails.
- [Layer B fixtures are expensive: ~17 integrity checks + 4 obligation kinds + tracker matrix, each
  spawning node] → fixtures are built once per id and share repos where the conditions compose;
  measured in task 1.5 and reported (turns, wall-clock) before GREEN.
- [Markers become a way to silence a real defect] → a marked line must still be REFUSED; a marker on
  an accepted line fails, so a marker cannot hide a line that later becomes runnable.
- [Omitting `delivered` hides a legitimate outcome after Gate 2 is recorded] → the output is
  recomputed per call; the `deliveredBlockedBy` remedy is the path to it.
- [Changed rules text for every tracker-configured repo] → re-rendered by `/pm:upgrade`; no state
  change, so rollback is re-rendering with the prior plugin.
- [A legacy github-issues `repo` that fails the shape loses its literal `gh` line] → it receives the
  vendor-neutral step, and `set-tracker --repo owner/name` restores it.

## Migration Plan

None for `state.json`. Release notes name the rules-text changes (secondary watermark step, `--limit`,
jira id placeholder) and the new `deliveredBlockedBy` field.

## Coordination

- **`commit-nudge-reads-the-whole-move` (change 1)** owns `runNudge` in `subcommands.mjs`. This change
  edits only the final sentence of its non-detour message (`:495-496` today) and `init()`'s stderr
  (`:110-113`), after change 1 merges; task 0.3 re-derives both anchors.
- **`user-text-never-forges-output` (change 3)** edits `briefing.mjs`, `integrity.mjs` and
  `archive-gate.mjs` to escape user-supplied values. Disjoint hunks: this change edits the remedy
  COMMANDS (`gate2Remedy`, `dispositionInvocation`, the delivered-release finding) and the two
  tracker lines at `briefing.mjs:271-310`; change 3 escapes the user VALUES interpolated beside them.
  Where both touch one template literal (the delivered-release finding interpolates `rel.id` and
  `e.status`), change 3 applies its escaping to this change's rewritten literal. The `--repo` shape
  rule here is not escaping: it refuses a value that could alter a shell command, and nothing in
  change 3 quotes emitted shell lines.
- The Layer A sweep will read change 3's rendered refusals; if change 3 alters a refusal's remedy
  text, the sweep covers it automatically.
