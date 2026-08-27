---
name: cross-spec-review
description: Review a release's specs AGAINST EACH OTHER before implementation — contradictions, double ownership, unmeetable requirements, gaps, vocabulary forks, and shared chokepoints. Gate 1 reviews one change at a time and structurally cannot find these. Use BEFORE /opsx:apply on any release holding 2+ spec files, after any concurrent amendment of several specs, and whenever a release bundles more than one capability. Triggers: "cross-spec review", "do the specs agree", "release-level gate", "review the specs together", "we have more than one spec".
---

**This practice is now part of the product.** It shipped as `pm`'s own `cross-spec-review` skill
(gh#126), backed by the `/pm:cross-spec-review` command and the `record-cross-spec-review` engine
verb that records the verdict with an engine-derived, hashed spec set.

**Read the canonical procedure at `skills/cross-spec-review/SKILL.md` in this repository** — one
copy, so this repo's practice and what users get cannot drift. This file remains only so that
`CLAUDE.md`'s reference to the `cross-spec-review` skill keeps resolving in a checkout where the
plugin's own skills are not loaded; it deliberately carries no procedure of its own.

Then record the verdict, from this checkout:

```bash
node scripts/conductor.mjs record-cross-spec-review <releaseId> \
  --verdict pass|fail --reviewer "<identity>"
```
