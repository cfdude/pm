# A Gate 1 verdict recorded with --artifact stores no content hash, so amending the reviewed artifacts never reads stale

## What happens
`record-gate-review <id> --gate 1 --verdict pass --artifact <path>…` stores the artifact PATHS only
(`scripts/lib/gate-review-writeback.mjs:143`: `entry.artifacts = artifacts`). Nothing records what those
files contained. Amend proposal/design/tasks/spec after the verdict and every surface still renders
the Gate 1 pass as current.

`record-cross-spec-review` already solves this one level up: it SHA-256s each spec it reads
(`scripts/lib/cross-spec-review.mjs:109`) and marks the verdict `⚠ stale` when a reviewed spec is
amended. Gate 2 has the equivalent through `headSha` vs the last attributed commit. Gate 1 is the one
gate whose evidence cannot go stale.

## How it bit (pm 0.43.0, dogfooding)
Both 0.43.0 changes passed Gate 1 at b282a2f. The cross-spec review then drove four rounds of spec,
design and task amendments (f7ae09d, 8f0057d, d5fde94, d046e02, 2b971c9) — material changes to the
refusal contract and the printed invocation. The recorded Gate 1 verdicts kept reading as a pass on
the new artifacts. Only a manual check caught that they described artifacts four revisions old; the
verdicts were re-recorded by hand.

## Repro
1. Register an openspec epic; `record-gate-review <id> --gate 1 --verdict pass --reviewer r --artifact openspec/changes/<id>/proposal.md`.
2. Edit that proposal.md and commit.
3. `/pm:status`, `integrity`, `release show` — no staleness marking anywhere.

## Suggested shape
Store `{path, sha256}` per artifact at record time (as cross-spec does), and render `⚠ stale` on Gate 1
when any hash differs, change-relative so the `/opsx:archive` move is not staleness. Absent hashes on
legacy records = unverifiable, never stale.
