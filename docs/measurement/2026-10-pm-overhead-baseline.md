# pm's per-session overhead: baseline, calibration protocol, and the downstream question

Epic: `pm-overhead-baseline`. Measured 2026-10-20 with the `overhead` verb (commit `c5257d07` on
`rc/0.53.0`, engine reporting 0.52.0). Every token figure below is `bytes/4`, an ESTIMATE: the engine has
no tokenizer. Section 3 is how that estimate gets checked; it has NOT been run (it needs Rob's go).

## 1. Baseline (task 2.1)

Method: `node scripts/conductor.mjs overhead --json` and `overhead --all-features --json`, run once each in
two repositories. n=1 per cell: the numbers are a deterministic function of the record and the plugin files,
not a sample. `--all-features` is a named in-memory hypothetical (a github-issues tracker, reviewMode
thorough, one lane-routing override, the activity log, spend tracking on, a project spend-guard of 2 failed
rounds); the fleet repo's `git status --porcelain` was identical before and after.

| Repository | State | Opt-ins on |
| --- | --- | --- |
| `~/Documents/Repos/pm` (worktree `rc-0-53-0`) | 337 epics, `.conductor/state.json` at the commit above | reviewMode (standard), tracker (github-issues), spendTracking, spendGuard |
| `~/Documents/Repos/cfdude-plugins` (default opt-ins, 18 epics) | git `440e7f8` | none |

### Unconditional bytes per session, by feature

| Feature | pm: real | pm: all features | cfdude-plugins: real | cfdude-plugins: all features (would add) |
| --- | --- | --- | --- | --- |
| core | 42,956 | 42,956 | 36,070 | 36,177 (+107) |
| listings | 7,445 | 7,445 | 7,445 | 7,445 |
| tracker | 5,902 | 5,902 | 0 | 5,914 (+5,914) |
| spendTracking | 880 | 880 | 0 | 880 (+880) |
| spendGuard | 806 | 806 | 0 | 806 (+806) |
| reviewMode, laneRouting, activityLog | 0 | 0 | 0 | 0 |
| **Session total** | **57,989 B, ~14,498 tokens** | **57,989 B, ~14,498 tokens** | **43,515 B, ~10,879 tokens** | **51,222 B, ~12,806 tokens** |

Reading it:

- `core` includes the SessionStart brief (8,242 B in pm, 1,356 B in cfdude-plugins). The brief is the part
  that grows with a repository's history; the capped maximum is 16,384 B.
- Turning on everything adds ~7,700 B (~1,930 tokens, bytes/4) to a default repository, 77% of it the
  tracker procedure (the GitHub issue-sync section plus "Sync after completing tracker-linked work").
- Spend tracking's own cost, the question that started this epic: its rules section is 880 B (~220 tokens,
  bytes/4) every session, plus one 58 B marker line (~15 tokens, bytes/4) per dispatched sub-agent. The spend
  guard section is 806 B (~202 tokens, bytes/4) while a limit is configured.
- Not in the totals, by design: the PreCompact snapshot (82,444 B in pm) is written to
  `.conductor/brief.txt` and nothing reads it back, so it is not injected; `hook:gate-guard` (553 B) fires
  only while a reconcile is owed; `hook:lesson-advice` (499 B for pm's longest lesson) only on a matching
  command; `hook:commit-nudge` reports no static size (its text depends on the commits observed).
- The listings figure covers the 39 descriptions pm ships. The host adds list formatting of its own.
- Cache-read is 96.2% of attributed tokens across the ledger (assessment section 6), so the totals above
  are re-read on every message, not paid once. Multiplying by message count belongs to a measured session,
  not to this verb.

### Known limitations of the verb (found while measuring)

- `hook:commit-nudge` has no static size. A representative one would need its builder extracted from
  `runNudge`; left as a gap rather than a typed constant that would drift.
- A feature that changes a value inside a section (reviewMode inside `rules:execution-profile`) or a count
  inside the brief shows as 0 bytes on its own row; the difference lands in `core` (see the +107 above).

## 2. Calibration protocol (task 3.1) - NOT RUN

Question: how far is bytes/4 from the real token count of what pm adds to a first message?

Spends real model tokens, so it needs Rob's go (task 0.3) before any run.

1. Fixture: an empty directory outside any repository, isolated from user memory (`claudeMdExcludes` for
   the user and parent CLAUDE.md files and `autoMemoryEnabled: false` in the fixture's own settings; NOT
   `--bare` and NOT `--setting-sources`, per the project note on headless evals).
2. Two arms, n=3 each, run alternately: (a) pm enabled and `/pm:init` already run in the fixture, with the
   rules block in its CLAUDE.md; (b) pm disabled, otherwise identical.
3. Each run: one headless prompt that makes no tool call (`claude -p "Reply with the single word ok."`).
4. Measure from the run's transcript: the first assistant message's `input + cache_creation` tokens.
5. Report: per-arm mean and range, the pm delta (a minus b), and the ratio of that delta to
   `overhead --json`'s `total.estimatedTokens` for the same fixture. Record the machine state, the model id
   and the plugin version. Do not edit the verb's label whatever the ratio is: it stays an estimate.
6. Cost guard: 6 one-message sessions. The expected size of each first message is of the order of the
   `overhead` total plus Claude Code's own system prompt (an order-of-magnitude expectation, uncalibrated;
   the run is what replaces it).

## 3. The downstream question (task 3.3)

Does the tracking and record-keeping pm does make downstream work cheaper? Nothing measured here says so.

What the ledger CAN show (`spend`, and `spend-analysis` once shipped):

- spend per epic, per phase and per role, from Claude Code's own transcripts;
- review rounds per epic and the gate rounds that did not converge;
- which epics are outliers against the repository's own history.

What it CANNOT show:

- The counterfactual: the same work done without pm. No such run exists, so the ledger cannot say that a
  token went unspent because of the conductor, only where tokens went with it.
- Whether a spend-guard stop, a reconcile gate or a recorded disposition prevented a more expensive
  mistake. A prevented cost leaves no row.

Proposed A/B (not run, needs Rob's approval): take 3 small, already-specified tasks from this repository's
history with a known diff. For each, run the same headless build twice from the same base commit, once with pm
enabled and once with it disabled, n=3 per cell (18 builds). Measure total tokens per build from the
transcripts, plus whether the result passes the task's own tests. Report per-task cost with ranges and say
plainly when the ranges overlap. Expected token cost: unknown until the calibration in section 2 gives a
first-message figure; 18 full builds are materially larger than the 6 one-message calibration sessions, which
is why this is a separate approval. Nothing here claims a saving, and the `overhead` verb prints none.
