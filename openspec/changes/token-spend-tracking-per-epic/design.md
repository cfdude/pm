# Design: token-spend-tracking-per-epic

## Context

The motivation is in proposal.md ("Why"). The requirements are in `specs/spend-ledger/spec.md`.

### What a Claude Code transcript actually holds

Observed on this machine on 2026-10-09, under `~/.claude/projects/-Users-robsherman-Documents-Repos-pm/`
(426 session files, 906 MB):

| Fact | Consequence |
|---|---|
| One API message appears as **2–3 `assistant` entries** sharing `message.id`, each carrying exactly one content block. In main sessions the entries share input and cache counts while `output_tokens` grows (21, then 195). Sub-agent files have more shapes (Gate 1 measured 3197 differing pairs): zero-usage thinking entries, cumulative advisor-iteration usage, and 13 later entries whose output is LOWER after `stop_reason`. 431 of 7740 message ids spread their `tool_use` blocks across entries. | A row-per-entry sum over-counts by 2–3×. The fold takes counts from the max-output entry, which is the complete one in every observed shape, and merges `tools` across all entries. |
| `usage.iterations[]` repeats the top-level counts. | The ledger never adds it. |
| `output_tokens_details.thinking_tokens` ≤ `output_tokens` (322 vs 170). | Thinking is a subset. It is stored for information and never added. |
| Sub-agents write to `<session>/subagents/agent-<agentId>.jsonl` (`isSidechain: true`, `agentId` set), next to `agent-<agentId>.meta.json` holding `{agentType, description, toolUseId, model}`. | Actor and `agentId` come from the file. `description` is prompt-derived text and is never stored. |
| A `worktree`-isolated agent also gets its own project directory, `-…-pm--claude-worktrees-agent-<agentId>/` (26 here). Gate 1 measured 689 assistant entries there, all `isSidechain:false` and `agentId:null`, with their own `cost-state`, and none sharing a message id with `subagents/agent-<id>.jsonl`. | Those entries LOOK like main-session entries but are sub-agent spend. The actor and `agentId` come from the directory name, never from the entry, and the marker comes from that agent's `subagents/` file (D6). A global fold by `message.id` makes any overlap harmless. |
| `cost-state` entries (main session only) carry `totalCostUSD` and per-model `costUSD`, including `claude-haiku-*` background calls. Those calls never appear as `assistant` entries. | The ledger does not reconcile with `cost-state` and does not apportion its cost. Background haiku calls are outside the ledger, and `commands/spend.md` says so. |
| The model ids seen are `claude-opus-5-5`, `claude-opus-4-7` and `claude-sonnet-5-5`. | The tier is the `KNOWN_MODELS` token found in the id, else `other`. |

### Engine constraints that shape this

- **Zero dependencies and no network.** These are hard rules in CLAUDE.md. Reading files under the
  user's config directory is a local read, the same as the engine reading `.git`.
- **The activity log is the precedent for opt-in observability.** It has a toggle, an `OPT_INS` row
  and a git-ignored directory under `.conductor/`, and every filesystem call on its path sits in a
  try/catch. It also has the dispatch snapshot/diff chokepoint at `conductor.mjs:370`, which derives
  events from a state diff instead of one emit per verb.
- **`gateReview` keeps only the latest verdict per gate.** State cannot say which review round a token
  belonged to, so the round has to arrive with the spend (the marker).
- **Concurrency.** A release candidate builds several epics at once in background sub-agents, and
  `state.active` is a single value. A time window is therefore only valid for the serial main thread.

## Goals / Non-Goals

**Goals**

- Give the three dependent epics a row model they can sum without re-reading transcripts:
  - **budget guard:** running totals per epic and per agent
  - **decision-cost-log:** timestamped rows plus `--since/--until` window sums
  - **analysis:** actor, role, phase, model tier, tool names and round
- Make the absence of measurement visible. Unattributed spend is always a printed number.

**Non-goals**

- Analysis, trends, outlier flags, budgets or recommendations (the sibling epics).
- A money cost.
- A platform-neutral `record-spend` verb. See D9.
- Freezing totals into `state.json` at archive. See Open Questions.
- Reading anything a non-Claude-Code platform writes.

## Decisions

### D1. The switch is a project-level opt-in, not a profile field

`state.spendTracking = {enabled, enabledAt}`, toggled by `set-spend-tracking on|off`, with an
`OPT_INS` row. The epic text said "set in the execution-profile layers". Rob's 2026-10-06 brief says
an `OPT_INS` opt-in.

- **Why project-only.** A per-epic or per-lane switch would let some epics go unmeasured, which biases
  the cross-epic trend the analysis exists to show.
- **Why not a profile field.** It would make this a MODIFIED delta on `execution-profile`, which owes
  an unset at every layer and adds a cross-spec chokepoint, for no user value.
- **Rejected:** a profile field (above), and an environment variable (invisible to `upgrade`, and not
  in the record).

### D2. Data source: the transcripts, read by an explicit verb only

`spend` is the only reader.

- **Rejected: a Stop or SubagentStop hook that records usage.** That puts a read on the hot path in
  every enabled repo, and the hook payload does not carry the folded usage anyway.
- **Rejected: asking the agent to report its own figures.** A sub-agent cannot see its own token
  count. Only the transcript holds it.

The budget guard sibling will call `spend --json --epic <id>` when it needs live totals. That is an
incremental read: one `stat` per known file, plus the new bytes.

### D3. Location: the main working tree's `.conductor/spend/`, git-ignored

| File | Contents |
|---|---|
| `rows.jsonl` | Append-only ledger rows, with no attribution fields (D6). |
| `cursor.json` | `{<source path>: {offset, size, dev, ino}}` |
| `markers.json` | `{<agentId>: {epic, role, phase, round}}`, the raw tokens as captured. |
| `timeline.jsonl` | Append-only entries: `{at, active}` and `{at, tracking: "on"\|"off", active?}`. |
| `ingest.lock` | `O_EXCL` lock, removed in a `finally`. A lock older than 10 minutes is broken, as in the state lock. |

The directory is added to `ENGINE_IGNORED`, which `init` and `upgrade` backfill (#106).

- **Why the main working tree.** `conductorDir` is per invocation root. A per-checkout ledger in a
  linked worktree would read the same transcripts into a second ledger with a nearly empty timeline,
  and the budget guard's totals would depend on where it ran. The directory resolves through the same
  git-common-dir rule as D4.
- **Whose state.** `state.json` is per checkout, and a linked worktree carries a stale committed copy.
  So `spend` reads the MAIN tree's `state.json` for the switch, `enabledAt` and the epic set.
  `set-spend-tracking` is refused outside the main tree; otherwise a worktree's `off` would write an
  off entry into the main timeline that main's state never matches. (This was a Gate 1 verification
  finding.)
- **Detached HEAD.** Every file here is classified in `conductor-record`'s detached-HEAD table (the
  MODIFIED delta) as suppressed. `spend` in a detached tree reports from what exists and says it did
  not ingest. `verb-effects` declares `detachedNoOp` to match.

- **Why not a single store.** Rows are derived and can be rebuilt, while the timeline is source data.
  Separate files let `--clear` drop one and keep the other (D8).
- **Size.** About 330 bytes per row; ~30k messages a week here is ~10 MB a week. No rotation in v1:
  the reader is the only consumer and reads the whole file. Rotation is an Open Question, not a
  blocker, because the file is git-ignored and `--clear` bounds it.

### D4. Transcript discovery is one isolated function

`transcriptDirs(repoRoot, env)` returns the ordered list of directories.

- The root comes from `env.CLAUDE_CONFIG_DIR ?? os.homedir()+"/.claude"`, plus `/projects`.
- The encoding is `repoRoot.replace(/[^A-Za-z0-9]/g, "-")`.
- `repoRoot` is the **main** working tree: the parent of `git rev-parse --git-common-dir`, resolved
  through the engine's existing gateway, so a linked worktree reads the same transcripts.
- Tests set `CLAUDE_CONFIG_DIR` to a fixture tree and never touch the real home directory.
- The encoding is Claude Code's, not pm's. If it changes, discovery finds no directory and `spend`
  says so (spec: "No transcript directory is not an error").

### D5. Fold by `message.id`, at ingest and again on read

Ingest writes the new rows it read. Because a streamed message can be split across two ingests, the
ledger may hold several rows for one `messageId`. Every reader folds before summing:

- It takes the token counts from the row with the max `output`, and on a tie the later one.
- It merges `tools` across all rows, in order.

- **Why fold on read.** The fold is in one module (`foldRows`), so ingest never has to rewrite earlier
  rows, and append-only stays true.
- **Rejected: rewriting `rows.jsonl` on every ingest.** It costs a full read and write each time, and
  a crash mid-rewrite loses data.

### D6. Attribution: computed at read time; tracking-off, then marker, then window, then unattributed

**Read time, not ingest time.** Rows store no `epic`, `attribution` or `reason`. `attribute(rows,
markers, timeline, state)` is a pure function that every report runs. Ingest-time attribution would
freeze two wrong answers:

- an epic registered after its marked dispatch would stay `unknown-epic` forever
- an epic removed later would keep its credit

Read-time attribution costs one pass over the folded rows, which the report makes anyway.

**The marker.** The first `user` entry of a sub-agent transcript is the dispatch prompt. Ingest scans
its text, in memory, for the first line matching
`^pm-spend: epic=(\S+) role=(\S+) phase=(\S+)(?: round=(\S+))?$`, and stores the raw tokens in
`markers.json`, keyed by `agentId`. Validation happens at read time, against the current constants
and state. Storing the marker once is what keeps it alive when a later incremental ingest starts
past the first entry. The prompt itself is never stored.

**Worktree sessions.** Rows from a `--claude-worktrees-agent-<id>` directory are `actor=subagent`
with `agentId=<id>`, taken from the directory name, and they use the marker captured for `<id>`
from `subagents/agent-<id>.jsonl`. They are never window-attributed: Gate 1 found that, unlabelled,
they would have been credited to whichever epic the main checkout had active.

- The rules block section (D10) is what makes agents write the marker, so attribution costs the agent
  one line per dispatch and no tool call.
- **Rejected: a `spend-bind <agentId> --epic` verb.** The orchestrator does not know the `agentId`
  until after dispatch, and every bind would be an extra state write.
- **Rejected: parsing the meta `description`.** It is free text, and storing a derivative of it
  breaks the privacy rule.

**The window.** Orchestrator rows (`actor=orchestrator`) take the `active` value of the last timeline
entry at or before the row's `at`. Before the first entry the reason is `before-timeline`. An entry
with null `active` gives `no-active-epic`.

- **Why sub-agent rows are never window-attributed.** Background sub-agents build several epics at
  once, so a window would assign them to whichever epic the orchestrator last activated, which is
  confidently wrong. An honest `unmarked-subagent` total is the signal that the marker discipline
  slipped.

**Rejected: attribution through attributed commits.** A worktree agent's branch
`worktree-agent-<agentId>` does link to its merge commit, and from there to an epic's
`attributedCommits`. But one worktree agent often builds several epics in a batch (rc/0.52.0 does),
so the link is ambiguous. It is noted for the analysis epic as a derived cross-check, not a
precedence rule.

### D7. The timeline is written at the dispatch chokepoint

The snapshot/diff `finally` around dispatch (`conductor.mjs:370` onwards) compares `state` before and
after for the activity log. Today it snapshots only when `activityEnabled`, and the `finally` loads
state again for the after-image.

- The snapshot gate widens to `activityEnabled || spendTracking.enabled`. With tracking on, that adds
  one `state.json` read per engine invocation, hooks included. The spec states this cost and no more.
- The append fires when `after.spendTracking?.enabled`, `before.active !== after.active`, and the
  root is the main working tree (D3).
- `set-spend-tracking on` and `off` append their own `tracking` entries explicitly, because a toggle
  does not change `active`.
- **The off entry closes the gap.** Without it, re-enabling after an off period would credit the
  whole period's orchestrator spend to the epic active when tracking went off. With it, rows inside
  an off interval read as `tracking-off`.

- **Why there.** A list of verbs that change `active`, typed from memory, goes stale. The diff cannot
  miss one.
- `set-spend-tracking on` seeds the timeline explicitly, because enabling does not change `active`.

### D8. Inverses

| Write | Inverse | Note |
|---|---|---|
| `set-spend-tracking on` | `set-spend-tracking off` | Off deletes nothing. |
| ingest appends rows and markers, and advances the cursor | `spend --clear --yes` | Rows, markers and the cursor. |
| (rows lost or corrupt) | `spend --rebuild --yes` | Re-derives only from transcripts still on disk. Claude Code prunes transcripts (`cleanupPeriodDays`, which is unset here, so its default applies), so a row whose `source` is gone is KEPT, not dropped. Once its transcript is gone the ledger is the only copy, and the cross-release trend depends on it. The plan counts the kept rows. The rebuild is refused while tracking is off, which forbids transcript reads. |
| timeline append | `spend --clear --timeline --yes` | The timeline cannot be rebuilt, so it is never removed implicitly. |
| `ENGINE_IGNORED` line | none shipped | Same justification as the activity log: `ensureGitignore` never removes a line, and a stray ignore line is harmless. |
| rules block section | `set-spend-tracking off` | The block is re-rendered without it. |

`--yes` follows `purge-logs`: no stdin prompt, because agents and hooks drive this engine.

### D9. `record-spend` (platform-neutral fallback) is deferred

The epic names a `record-spend` verb as the fallback where no transcript adapter exists.

- **Why deferred.** No ported platform needs it today. Shipping it now would need a rule that stops a
  manual figure double-counting adapter rows for the same agent, and that rule is only testable
  against a real second platform.
- It is recorded as a `--declined-deferral` at archive unless Rob registers an epic for it.

### D10. The rules-block section is conditional

The rules block is a function of state, and `rules.mjs` builds it. When
`state.spendTracking?.enabled`, it appends `## Spend tracking` after `## Execution profile`. The
section holds the marker line format, the role list (rendered from `KNOWN_JOB_ROLES`), the phase list
(from `KNOWN_SPEND_PHASES`), and one sentence: "a dispatch without the marker is counted as
unattributed".

- When off, it emits nothing, so a user who never opts in pays zero rules-block bytes. That matters
  under `session-cost`'s 16384-byte brief cap and its rules-block measurement.
- This is the managed-rules surface, so it needs the functional certify. It is also the same insertion
  point `execution-profile-planning-and-light-roles` will edit. Whichever lands second rebases.

### D11. No cost figure

pm ships no price table: a hardcoded per-token price is an invented number that goes stale silently.
`cost-state` is per main session, includes calls the ledger cannot see, and cannot be split per epic
without such a table.

The report therefore prints `cost: not computed — tokens are the measure. Claude Code's own cost
figures are notional under subscription auth.` The JSON carries
`cost: {computed: false, note: "…"}`.

## Risks / Trade-offs

- **[Risk] Claude Code changes the transcript format** (a field rename or a new file layout).
  → The reader fails closed per entry: an entry missing `message.id` or `usage` yields no row. The
  report prints entries skipped by reason, and a file-rung fixture pins today's shape.
- **[Risk] Agents forget the marker, and most sub-agent spend lands as unattributed.**
  → The section sits in the rules block, the unattributed total is always printed, and the coverage
  line makes the gap obvious. The analysis epic can flag low coverage.
- **[Risk] The first ingest in a long-lived repo is slow.**
  → `enabledAt` bounds it: files with an older mtime are skipped without opening.
- **[Trade-off] The ledger is machine-local.** The cross-release trend needs a durable per-epic
  rollup. See Open Questions.
- **[Risk] The orchestrator's own spend during a release candidate is window-attributed** to whichever
  epic is active, though it serves the whole release.
  → This is accepted for v1 and documented in `commands/spend.md`. A release-level bucket is for the
  analysis epic.

## Migration Plan

- No state transform. `state.spendTracking` is additive and optional, so a 0.51.0 state file loads
  unchanged.
- `upgrade` lists the new opt-in, and backfills the ignore line through `ensureGitignore`.
- In this repo, task 6.2 runs `set-spend-tracking on` after the build lands.
- Rollback is `set-spend-tracking off`, plus `spend --clear --timeline --yes` to remove the data.

## Open Questions

- **Should archiving an epic freeze its totals into `state.json`?** That would give a durable,
  cross-machine trend. It does not change this change's specs. It belongs to
  `token-spend-analysis-and-recommendations`, which consumes the totals.
- **Should `rows.jsonl` rotate?** Revisit once the file passes ~100 MB. The reader's contract (fold,
  then sum) does not change.
