# pm overhead calibration, 2026-10-30

Epic `pm-overhead-calibration-and-feature-switches`. Plan: `docs/superpowers/plans/2026-10-30-pm-overhead-calibration.md`.
Sources: `docs/measurement/2026-10-overhead-pair.json`, `docs/measurement/2026-10-overhead-survey.json`.
Every figure below is read from those two files or the plan.

## Result

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

- The estimate and the measured delta agree within the 25% threshold (ratio 1.186). By that rule the estimate is
  not materially wrong, so the 3+3 request (500k cap) is not raised.
- The threshold as written in Q4 compares the survey's within-project delta (5 or more sessions per side) with the
  pair's. The survey cannot supply that side: it has 2 within-project pairs and none with 5+ per side, and its
  median delta is negative, which is noise at n=2 rather than a finding. So the survey cannot isolate pm's overhead
  and the Q4 test could not be run as written. The pair stands, with the model confound stated above.
- The `overhead` verb's label stays an estimate whatever the ratio (baseline protocol step 5).

## The `rules:intake` shrink

`rules:intake` was about 1,006 tokens, over the 1,000-token switch threshold. It was shortened to about 834 tokens
(held under 900 by a unit test) instead of building a feature switch for it. See the dated addendum in
`docs/measurement/2026-10-feature-switch-audit.md`; its original rows are left as measured.
