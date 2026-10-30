# pm overhead calibration, 2026-10-30

Epic `pm-overhead-calibration-and-feature-switches`. Plan: `docs/superpowers/plans/2026-10-30-pm-overhead-calibration.md`.
Sources: `docs/measurement/2026-10-overhead-pair.json`, `docs/measurement/2026-10-overhead-survey.json`.
Every figure below is read from those two files or the plan.

## 1. Transcript survey of first-message size

Method: for each session transcript, the first main-chain assistant message's `input + cacheCreation + cacheRead`,
its model id, and one boolean (pm's SessionStart brief hook present before that message). Nothing else is read.
Headline population: SessionStart source `startup`, entrypoint `cli` or `sdk-cli`, project not excluded. Percentiles
are nearest-rank. Code: `scripts/measure/overhead-survey-core.mjs`, `scripts/measure/overhead-survey.mjs`.
Claude Code 2.1.314 and pm 0.53.0 (versions as recorded in the pair file, run 2026-10-30).

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

| Measure | Value | Source |
| --- | --- | --- |
| pm-off run (opus, `claude-opus-5-5`), total prompt | 30,719 tokens | pair.json |
| pm-on run (sonnet, `claude-sonnet-5-5`), total prompt | 43,658 tokens | pair.json |
| Measured delta, total prompt | 12,939 tokens | pair.json `promptDelta` |
| Delta on the archived method (`input + cacheCreation`) | 12,940 tokens | pair.json `archivedMethodDelta` |
| `overhead` verb estimate for the pm-on fixture | 10,908 tokens | pair.json `pmEstimate` |
| Measured / estimate | 1.186 (measured 18.6% above) | pair.json `ratio` |
| Q4 threshold (fixed before the run) | 25% | plan Q4 |
| Pair spend against cap | 74,377 of 150,000 (per-run cap 100,000) | pair.json |
| Survey within-project pairs | 2 projects, 0 with 5+ sessions per side | survey.json |
| Survey within-project median delta (sonnet-5-5) | -4,663.5 total; -3,280 `input + cacheCreation` | survey.json |
| `rules:intake` after the shrink | about 834 tokens, was about 1,006; no switch built | README overhead table; plan A3 |

## Confound: the arms ran on different models

`sameModel` is `false`. The pm-off arm ran on opus and the pm-on arm on sonnet. The delta therefore mixes pm's
overhead with whatever differs between the two models' system prompts and tool sets. The pair does not isolate
pm, and 12,939 is not a clean measurement of it. It is one data point that happens to land near the estimate.

## Comparison against the Q4 threshold

- The ratio is 1.186, inside the 25% threshold, but the arms ran on different models, so this is INDICATIVE ONLY.
  It is NOT evidence that the estimate is right, and nothing here supports closing the question or declining the
  3+3 request. The pair is VOID as a calibration under the same-model rule now enforced in
  `scripts/measure/overhead-pair-core.mjs` (`runPair` voids on a model mismatch; `--model <id>` pins both arms).
- **Open item:** a same-model rerun (about 75k tokens, under the 150k ceiling) needs Rob's confirmation before it
  is spent. Until it runs, B5 and B6 in the plan are not met.
- The threshold as written in Q4 compares the survey's within-project delta (5 or more sessions per side) with the
  pair's. The survey cannot supply that side: it has 2 within-project pairs and none with 5+ per side, and its
  median delta is negative, which is noise at n=2 rather than a finding. So the survey cannot isolate pm's overhead
  and the Q4 test could not be run as written. The pair stands, with the model confound stated above.
- The `overhead` verb's label stays an estimate whatever the ratio (baseline protocol step 5).

## The `rules:intake` shrink

`rules:intake` was about 1,006 tokens, over the 1,000-token switch threshold. It was shortened to about 834 tokens
(held under 900 by a unit test) instead of building a feature switch for it. See the dated addendum in
`docs/measurement/2026-10-feature-switch-audit.md`; its original rows are left as measured.
