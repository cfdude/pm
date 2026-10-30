# pm overhead calibration, 2026-10-30

Epic `pm-overhead-calibration-and-feature-switches`. Plan: `docs/superpowers/plans/2026-10-30-pm-overhead-calibration.md`.
Sources: `docs/measurement/2026-10-overhead-pair.json`, `docs/measurement/2026-10-overhead-pair-unpinned.json`,
`docs/measurement/2026-10-overhead-survey.json`.
Every figure below is read from those files or the plan.

## 1. Transcript survey of first-message size

Method: for each session transcript, the first main-chain assistant message's `input + cacheCreation + cacheRead`,
its model id, and one boolean (pm's SessionStart brief hook present before that message). Nothing else is read.
Headline population: SessionStart source `startup`, entrypoint `cli` or `sdk-cli`, project not excluded. Percentiles
are nearest-rank. Code: `scripts/measure/overhead-survey-core.mjs`, `scripts/measure/overhead-survey.mjs`.
Claude Code 2.1.314 and pm 0.53.0 (versions as recorded in the pair files, run 2026-10-30).

| Measure | Value |
| --- | --- |
| Transcript files read | 3,449 sessions in 93 projects |
| Headline sessions | 102 |
| Excluded | 3,324 `sdk-py`, 19 `clear`, 2 other entrypoint, 2 no SessionStart, 18 Highway projects, 2 employer repos, 48 with no assistant message |
| Median total, brief present | 98,500 (opus-5-5, n=48); 92,832.5 (sonnet-5-5, n=28); 84,836 (sonnet-5, n=1) |
| Median total, brief absent | 96,970 (opus-5-5, n=5); 99,521 (sonnet-5-5, n=5); 85,201.5 (opus-5, n=8) |
| Within-project pairs | 2 projects, 0 with 5+ sessions per side; median delta -4,663.5 total |
| Wall-clock / peak memory | 2.2 s / 117 MB max RSS (re-measured 2026-10-30 with `/usr/bin/time -l`, 94 projects read, 3,584 files; the original B3 run read 93 projects) |

B1 brief detection (`overhead-survey-core.mjs:18-20`), validated 2026-10-29 over this repo's 99 transcripts: every
`startup` session from `cli` / `sdk-cli` showed the hook, every `clear` session did not (pm's matcher is
`startup|resume|compact`), and all 86 `sdk-py` sessions have no SessionStart attachment at all.

The survey cannot isolate pm's overhead: the groups differ by model and by what else the user had loaded, and the
within-project side has too few sessions.

## 2. Reduced pair

Two pairs ran on 2026-10-30. The first (`2026-10-overhead-pair-unpinned.json`) had its arms on different models
(opus off, sonnet on) and is confounded. The second (`2026-10-overhead-pair.json`) pinned both arms to
`claude-sonnet-5-5` and is the evidence. Both on Claude Code 2.1.314, pm 0.53.0, estimate 10,908 tokens.

| Measure | Same-model pair (evidence) | Unpinned pair (confounded) |
| --- | --- | --- |
| pm-off model / total prompt | `claude-sonnet-5-5` / 30,616 | `claude-opus-5-5` / 30,719 |
| pm-on model / total prompt | `claude-sonnet-5-5` / 43,658 | `claude-sonnet-5-5` / 43,658 |
| Measured delta, total prompt (`promptDelta`) | 13,042 | 12,939 |
| Delta on the archived method (`input + cacheCreation`) | 11,962 | 12,940 |
| `overhead` verb estimate (`pmEstimate`) | 10,908 | 10,908 |
| Measured / estimate (`ratio`) | 1.196 | 1.186 |
| `sameModel` | true | false |
| Spend against the 150,000 cap (per-run cap 100,000) | 74,274 | 74,377 |
| `void` | null | null |

Other measures:

| Measure | Value | Source |
| --- | --- | --- |
| Q4 threshold (fixed before the run) | 25% | plan Q4 |
| Survey within-project pairs | 2 projects, 0 with 5+ sessions per side | survey.json |
| Survey within-project median delta (sonnet-5-5) | -4,663.5 total; -3,280 `input + cacheCreation` | survey.json |
| `rules:intake` after the shrink | about 834 tokens, was about 1,006; no switch built | README overhead table; plan A3 |

Confound history: the first pair ran opus against sonnet, so its 12,939 mixed pm's overhead with model differences;
`runPair` now voids a model mismatch and `--model <id>` pins both arms, which is how the second pair ran.

## Comparison against the Q4 threshold

- On the same-model pair the measured delta is 13,042 tokens against an estimate of 10,908: ratio 1.196, so the
  measured figure is 19.6% above the estimate, equivalently the estimate is about 16% low (10,908 / 13,042 = 0.836).
  The confounded pair gave 1.186. Both sit inside the 25% threshold, and the same-model pair is the one that counts.
- Result: not material. The 3+3 request (500k cap) is not raised. B5 and B6 are met.
- Limit: this is one pair, n=1 per arm, so no run-to-run variance is known. The result says the estimate is within
  about 20% on this fixture and run, not that 20% is its error bar.
- The warm-cache split moved the archived-method figure: 11,962 on `input + cacheCreation` against 13,042 on the
  total, because the pm-on arm read 1,080 more cached tokens than pm-off (12,471 vs 11,391).
- The threshold as written in Q4 compares the survey's within-project delta (5 or more sessions per side) with the
  pair's. The survey cannot supply that side: it has 2 within-project pairs and none with 5+ per side, and its
  median delta is negative, which is noise at n=2 rather than a finding. The Q4 test could not be run as written;
  the same-model pair stands on its own.
- The `overhead` verb's label stays an estimate whatever the ratio (baseline protocol step 5).

## The `rules:intake` shrink

`rules:intake` was about 1,006 tokens, over the 1,000-token switch threshold. It was shortened to about 834 tokens
(held under 900 by a unit test) instead of building a feature switch for it. See the dated addendum in
`docs/measurement/2026-10-feature-switch-audit.md`; its original rows are left as measured.
