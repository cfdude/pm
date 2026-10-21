# Feature-switch audit: what each surface costs a session, and where a switch earns its place

Epic: `feature-switches-audit`, task 1.1. Measured 2026-10-20 at `rc/0.53.0`, after `pm-overhead-baseline` and
`developer-session-log` landed, with `overhead --all-features` semantics (every opt-in on, in memory, nothing
written). Every cost is `bytes/4`, an ESTIMATE: the engine has no tokenizer. Method: the surface sizes are the
verb's own, taken from `collectSurfaces` over the all-features hypothetical plus one secondary tracker, so every
rules section the engine can emit is present. The brief is the one surface that depends on the repository: it is
reported as the range measured in two real repositories (1,356 B in a default-opt-in repo with 18 epics, 8,242 B
in this repo with 337), capped at 16,384 B.

## The rule being applied (a proposal, awaiting Rob's call, task 0.3)

A feature gets a switch only when its UNCONDITIONAL per-session cost is at or above 1,000 estimated tokens
(about 4,000 bytes) and its text is not a safety stop or a record-integrity rule (design D1 and D2), or when it is
a developer feature that costs tokens itself. Conditional surfaces (hooks that fire on a match) are costed per
firing and are not switched by this rule.

## Result

**One surface clears the threshold and is separable, and it clears it by 6 tokens.** `rules:intake` is 4,021 B,
1,006 tokens at bytes/4. That margin is inside the estimate's error (the calibration run has not been done, so
the error is unmeasured), so this audit does NOT claim the number decides it. It is recorded as a candidate and
no switch is built; whether 1,000 is the right line, and whether intake guidance is "separable", are Rob's calls.
Every other surface is either below the threshold, a safety or record-integrity rule, already behind an existing
switch, or conditional. No switch was added, and this is a valid outcome.

## One row per surface

| Surface id | Feature | Bytes | Est. tokens | Unconditional | Decision | Reason |
| --- | --- | ---: | ---: | --- | --- | --- |
| `rules:pm-conductor` | core | 5,939 | 1,485 | yes | no switch | the detour, reconcile and state-of-record rules (D2) |
| `rules:getting-help-with-pm` | core | 721 | 181 | yes | no switch | below the threshold |
| `rules:the-gate-procedure` | core | 12,023 | 3,006 | yes | no switch | the required gate task items: a record-integrity rule (D2), the largest surface by far (35% of the core rules) |
| `rules:intake` | core | 4,021 | 1,006 | yes | CANDIDATE, none built | at the threshold by 6 tokens; separable guidance (triage an ask before registering it); needs Rob's call on D1 and on "separable" |
| `rules:reporting` | core | 2,853 | 714 | yes | no switch | below the threshold; also the rules forbidding dropping a recorded fact (D2) |
| `rules:epic-level-autonomy` | core | 3,137 | 785 | yes | no switch | below the threshold; also the genuine safety stops (D2) |
| `rules:execution-profile` | core | 2,427 | 607 | yes | no switch | below the threshold; emitted whatever the profile holds, only reviewMode changes a value inside it |
| `rules:release-candidate` | core | 1,173 | 294 | yes | no switch | below the threshold |
| `rules:feedback` | core | 776 | 194 | yes | no switch | below the threshold |
| `rules:re-read-the-source-before-an-epic-becomes-the-work` | core | 1,644 | 411 | yes | no switch | below the threshold; the planning-completeness obligation |
| `brief` | core | 1,356 to 8,242 | 339 to 2,061 | yes | no switch | grows with the record; its size is the 0.54.0 rules-block budget's (G0, #248), not a switch's |
| `snapshot` | core | 2,876 (fixture) | 719 | no | no switch | written to `.conductor/brief.txt` on PreCompact, never injected |
| `hook:gate-guard` | core | 553 | 139 | no | no switch | fires only while a reconcile is owed; a mechanical safety block |
| `hook:commit-nudge` | core | not measured | - | no | no switch | text depends on the commits observed; no static size |
| `hook:lesson-advice` | core | 499 (pm's longest lesson) | 125 | no | no switch | fires only on a matching command |
| `rules:github-issue-sync` | tracker | 5,510 | 1,378 | yes (tracker on) | already switched: `set-tracker` | the `tracker` opt-in; 0 bytes with no tracker |
| `rules:secondary-tracker-sync` | tracker | 5,594 | 1,399 | yes (per secondary tracker) | already switched: `set-tracker` | the same opt-in |
| `rules:sync-after-completing-tracker-linked-work` | tracker | 464 | 116 | yes (tracker on) | already switched: `set-tracker` | the same opt-in |
| `rules:spend-tracking` | spendTracking | 880 | 220 | yes (tracking on) | already switched: `set-spend-tracking` | developer feature, off by default |
| `spend-marker` | spendTracking | 58 per dispatch | 15 per dispatch | per dispatch | already switched: `set-spend-tracking` | one marker line per sub-agent dispatch while tracking is on |
| `rules:spend-guard` | spendGuard | 806 | 202 | yes (a limit set) | already switched: `set-spend-guard` | developer feature, off until a limit is configured |
| `listing:*` (41 files) | listings | 7,692 | 1,923 | yes | no switch | the host reads the plugin's own command, skill and agent files; the engine cannot hide them |

Features that own no injected surface, listed so none is missing: `reviewMode` (a value inside
`rules:execution-profile`), `laneRouting` (affects `suggest-lane` and `triage` output, nothing injected),
`activityLog` (a file nothing injects), `devLog` (a developer file nothing injects). Each already has its switch:
`set-review-mode`, `set-lane-routing`, `set-activity-log`, `set-dev-log`.

## Per-feature totals (all features on, one secondary tracker)

| Feature | Bytes | Est. tokens |
| --- | ---: | ---: |
| core (without the brief) | 34,714 | 8,679 |
| core brief (fixture, empty record) | 2,875 | 719 |
| listings | 7,692 | 1,923 |
| tracker (primary and one secondary) | 11,568 | 2,892 |
| spendTracking | 880 | 220 |
| spendGuard | 806 | 202 |
| reviewMode, laneRouting, activityLog, devLog | 0 | 0 |

## What this hands to the 0.54.0 rules-block budget (G0, #248)

The unswitched weight is concentrated: `rules:the-gate-procedure` (3,006 tokens) and `rules:pm-conductor` (1,485)
are 4,491 of the 8,679 core-rules tokens and both are safety or integrity text, which this rule never switches.
Shrinking them is a rewrite, not a switch, and that is the budget's job. Of everything that could be switched,
the tracker procedures are the largest and already are: a repo with a GitHub tracker and one secondary tracker
pays 2,892 tokens for them.

## Not measured

- The error of bytes/4 against real tokens (the calibration in `2026-10-pm-overhead-baseline.md` has not run).
- `hook:commit-nudge`'s size.
- What an agent loses by missing a switched-off section; there is no measurement of downstream effect.
