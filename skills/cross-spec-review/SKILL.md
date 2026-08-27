---
name: cross-spec-review
description: Review a release's specs AGAINST EACH OTHER before implementation — contradictions, double ownership, unmeetable requirements, gaps, vocabulary forks, and shared chokepoints. Gate 1 reviews one change at a time and structurally cannot find these. Use BEFORE /opsx:apply on any release holding 2+ spec files, after any concurrent amendment of several specs, and whenever a release bundles more than one capability. Triggers: "cross-spec review", "do the specs agree", "release-level gate", "review the specs together", "we have more than one spec".
---

# Cross-spec review — the release-scope gate

Gate 1 and Gate 2 both take **one change** as their unit and ask whether it is internally sound.
A release is many changes. Every finding below involves **two documents at once**, so no amount of
per-spec rigor surfaces them.

Run it with `/pm:cross-spec-review <releaseId>`, and record the verdict with the engine so a later
reader can check what it covered.

## When this fires

**Any release holding two or more spec files, before `/opsx:apply`.** The count is FLAT across the
release's member changes: one change carrying six specs qualifies exactly as six changes carrying
one spec each do. Also after any round of **concurrent amendment** — several agents editing
interdependent specs in parallel is a distinct failure generator, and it is the case this gate was
built from.

Not needed below that threshold. Gate 1 covers a single spec completely, and
`record-cross-spec-review` refuses a verdict there rather than storing a record that reads as
coverage.

## Procedure

1. **Let the engine name the set.** `/pm:status` renders each release's spec count and cross-spec
   state. Never type the list: a spec list written by the party being reviewed goes stale the
   moment a capability is added, and that staleness is precisely what this gate exists to catch.

2. **Dispatch fresh-context reviewers** — one under `standard`, **two with different lenses**
   under `thorough` (coherence/contradiction, and falsifiability/dependency-order). Fresh context
   is mandatory: a reviewer that watched the specs being written inherits the authors'
   assumptions, which are exactly what is being tested.

3. **Give each reviewer the whole set** — every spec file, the proposal, the existing main specs
   any delta amends, and the engine. Not summaries.

4. **Adjudicate the findings — do not treat them as a mandate.** Ask each reviewer to split every
   finding into **BLOCKS** (implementing this as written ships a defect, produces unsatisfiable
   behavior, or leaves a check that cannot fail) and **POLISH** (correct and implementable; the
   finding would improve the document). **Fix BLOCKS. Decline most POLISH, and say why.**

   This matters more than it sounds. A cross-spec review will *always* return findings, so "no
   findings" is not a stopping condition — you would iterate forever. A spec is done when it is
   correct enough to implement without shipping a defect, not when it is beyond criticism.

   The one thing never to defer: a **contradiction**. Discovered during apply, it is resolved by
   whoever hits it first, silently, and by call order.

5. **Re-review after fixing**, scoped to the fixes *and* to what concurrent editing broke. The
   re-review must be able to fail.

6. **Assign one owner per seam.** When two specs share a boundary, one agent amends both. Split
   across agents, each solves half and the seam stays open.

7. **Record the verdict.**

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" \
     record-cross-spec-review <releaseId> --verdict pass|fail --reviewer "<identity>"
   ```

   `pass` MEANS an empty BLOCKS list with a falsifiability table populated from live data. It does
   not mean "no findings"; that round does not come.

## The six questions

Ask each one explicitly. They are ordered by severity, and reviewers skip the later ones unless
told not to.

1. **Contradiction** — do two specs require incompatible behavior of one surface? Shipped, it is a
   coin flip decided by call order.
2. **Double ownership** — do two specs claim a behavior, such that an implementer satisfies one and
   considers it done?
3. **Unmeetable requirements** — does any spec assume a field, verb, flag, or rendering that
   nothing in the release creates? Watch for **passive voice around the writer**: "the array is
   appended as each commit is attributed" names no writer, and nothing appends.
4. **Gaps** — walk the proposal's "Resolves" list **one issue at a time** and confirm each maps to
   a real requirement. Half-covered issues hide here.
5. **Vocabulary forks** — is one concept named two ways? That becomes two data models.
6. **Shared chokepoints** — is there a single allowlist, enum, or dispatch table that several
   capabilities must all edit? Whichever lands first rejects the others by name.

## Two failure modes specific to the FIXES

Check these on the re-review.

- **A narrowed requirement goes inert.** Fixing a contradiction usually means binding a rule more
  tightly. That can quietly remove every failing case. **For each requirement you narrow, state the
  failing condition that still exists against today's engine** — if you cannot, the fix turned a
  real check into decoration.
- **Cited evidence is falsified by the narrowing.** A spec that says "this can fail today, see
  these four epics" is wrong the moment the narrowing excludes those four. Re-derive the evidence
  against the amended binding; do not carry it forward.

## Concurrent-edit damage

When several agents amend interdependent specs at once, each sees only a snapshot of the others.
Look for:

- **Cross-references that no longer resolve.** A spec quoting a sibling requirement *by title*
  breaks silently when that title is renamed underneath it. Grep every quoted title and confirm it
  exists with matching wording.
- **A fix that moved the problem** rather than closing it — often reported honestly by the agent
  that made it. Believe the report and verify the residue landed somewhere covered.
- **New vocabulary used inconsistently.** Every field or value the fixes introduce should mean one
  thing across all files, and the proposal's Impact should name each one.

## Reporting

Rank Critical / Important / Minor. Each finding names exact files and requirement names, what
concretely breaks, and which spec should own the fix. Then two sections, both required:

- **What I checked and found clean** — so coverage is legible rather than assumed.
- **Requirements I verified can still fail today**, with the failing condition.

A report that is entirely POLISH is a valid and useful result — it means proceed. Do not
manufacture a BLOCKS finding to look thorough, and do not report clean without the two sections
above, because "clean" and "did not look" are indistinguishable without them.

**Stopping condition:** a round whose BLOCKS list is empty, with a falsifiability table populated
from live data.

## What the recorded verdict buys you

`record-cross-spec-review` stores a SHA-256 per spec the engine read, so the verdict is checkable
rather than asserted, and every surface reports it beside the release:

- a spec **added** to the release afterwards → `⚠ stale`. That is the case a change-scoped gate
  structurally misses: the new spec passes Gate 1 on its own merits, and the set it now belongs to
  was never reviewed as a set again.
- a reviewed spec **amended** → `⚠ stale`.
- a spec the engine cannot read → `⚠ unverifiable`, and a `pass` is refused outright.
- the archive move changes nothing — the record is keyed change-relative.
- a multi-spec release with no verdict says so, because silence and "reviewed and clean" must not
  look the same.

## Evidence

Measured on the `pm` plugin's own 0.27.0 release. Six capability specs written in parallel from
separate briefs each passed `openspec validate --strict` and would each have passed Gate 1 alone.
Two fresh-context reviewers pointed at the *set* returned **5 Critical and 10 Important**, and
every Critical was invisible to per-spec review by construction — among them a flagship scenario
that could not execute, a guard that would have refused every normal archive, and a shared
11-element flag allowlist four capabilities each needed to grow (found independently by both
reviewers). The re-review then found **two more Criticals introduced by the fixes**.

Four rounds ran where three would have done, because every finding was treated as work. That is
what step 4's BLOCKS/POLISH split exists to prevent.
