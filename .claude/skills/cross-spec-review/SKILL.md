---
name: cross-spec-review
description: Review a multi-spec change's specs AGAINST EACH OTHER before implementation — contradictions, double ownership, unmeetable requirements, gaps, vocabulary forks, and shared chokepoints. Gate 1 reviews one spec at a time and structurally cannot find these. Use BEFORE /opsx:apply on any change whose specs/ directory holds 2+ spec files, after any concurrent amendment of several specs, and whenever a release bundles more than one capability. Triggers: "cross-spec review", "do the specs agree", "release-level gate", "review the specs together", "we have more than one spec".
---

This is repo-maintenance tooling for developing `pm` itself — not part of the product `pm`
ships. Productizing it is tracked as **cfdude/pm#126**; when that lands, this moves to the
plugin's own `skills/` and joins `docs/parity-ledger.json`.

## When this fires

**Any change whose `specs/` directory holds two or more spec files, before `/opsx:apply`.**
Also after any round of concurrent amendment — three agents editing six interdependent files
in parallel is a distinct failure generator, and it is the case this skill was built from.

Not needed for a single-spec change. Gate 1 already covers that completely.

## Why Gate 1 cannot do this

Gate 1 and Gate 2 both take **one change artifact** as their unit and ask whether it is
internally sound. Every finding below involves **two documents at once**, so no amount of
per-spec rigor surfaces them. On this repo's 0.27.0, six specs each passed
`openspec validate --strict` and would each have passed Gate 1 alone; reviewing them as a set
returned **5 Critical and 10 Important**, including a flagship scenario that was literally
unreachable.

## Procedure

1. **Dispatch fresh-context reviewers.** One under `standard`, **two with different lenses**
   under `thorough` — coherence/contradiction, and falsifiability/dependency-order. Fresh
   context is mandatory: a reviewer that watched the specs being written inherits the authors'
   assumptions, which are exactly what is being tested.
2. **Give each reviewer the whole set** — every spec file, the proposal, the existing main specs
   any delta amends, and the engine. Not summaries.
3. **Adjudicate the findings — do not treat them as a mandate.** Ask the reviewer to split every
   finding into **BLOCKS** (implementing this as written ships a defect, produces unsatisfiable
   behavior, or leaves a check that cannot fail) and **POLISH** (correct and implementable; the
   finding would improve the document). **Fix BLOCKS. Decline most POLISH, and say why.**

   This matters more than it sounds. A cross-spec review will *always* return findings, so
   "no findings" is not a stopping condition — you would iterate forever. **Ship Real Software:**
   a spec is done when it is correct enough to implement without shipping a defect, not when it is
   beyond criticism. On 0.27.0 four rounds ran because every finding was treated as work; the
   correct stopping point was earlier.

   The one thing never to defer: a contradiction. Discovered during apply, it is resolved by
   whoever hits it first, silently, and by call order.
4. **Re-review after fixing**, scoped to the fixes *and* to what concurrent editing broke. The
   re-review must be able to fail — on 0.27.0 it found two new Criticals the fixes introduced.
5. **Assign one owner per seam.** When two specs share a boundary, one agent amends both. Split
   across agents, each solves half and the seam stays open.

## The six questions

Ask each one explicitly. They are ordered by severity, and reviewers skip the later ones unless
told not to.

1. **Contradiction** — do two specs require incompatible behavior of one surface? Shipped, it is
   a coin flip decided by call order.
2. **Double ownership** — do two specs claim a behavior, such that an implementer satisfies one
   and considers it done?
3. **Unmeetable requirements** — does any spec assume a field, verb, flag, or rendering that
   nothing in the release creates? Watch for **passive voice around the writer**: "the array is
   appended as each commit is attributed" names no writer, and nothing appends.
4. **Gaps** — walk the proposal's "Resolves" list **one issue at a time** and confirm each maps
   to a real requirement. Half-covered issues hide here.
5. **Vocabulary forks** — is one concept named two ways? That becomes two data models.
6. **Shared chokepoints** — is there a single allowlist, enum, or dispatch table that several
   capabilities must all edit? Whichever lands first rejects the others.

## Two failure modes specific to the FIXES

Check these on the re-review; both were live on 0.27.0.

- **A narrowed requirement goes inert.** Fixing a contradiction usually means binding a rule more
  tightly. That can quietly remove every failing case. **For each requirement you narrow, state
  the failing condition that still exists against today's engine** — if you cannot, the fix
  turned a real check into decoration. Two of four narrowed requirements went inert in one round.
- **Cited evidence is falsified by the narrowing.** A spec that says "this can fail today, see
  these four epics" is wrong the moment the narrowing excludes those four. Re-derive the evidence
  against the amended binding, do not carry it forward.

## Concurrent-edit damage

When several agents amend interdependent specs at once, each sees only a snapshot of the others.
Look for:

- **Cross-references that no longer resolve.** A spec quoting a sibling requirement *by title*
  breaks silently when that title is renamed underneath it. Grep every quoted title and confirm
  it exists with matching wording.
- **A fix that moved the problem** rather than closing it — often reported honestly by the agent
  that made it. Believe the report and verify the residue landed somewhere covered.
- **New vocabulary used inconsistently.** Every field or value the fixes introduce should mean
  one thing across all files, and the proposal's Impact should name each one.

## Reporting

Rank Critical / Important / Minor. Each finding names exact files and requirement names, what
concretely breaks, and which spec should own the fix. Then two sections, both required:

- **What I checked and found clean** — so coverage is legible rather than assumed.
- **Requirements I verified can still fail today**, with the failing condition.

A report that is entirely POLISH is a valid and useful result — it means proceed. Do not
manufacture a BLOCKS finding to look thorough, and do not report clean without the two sections
above, because "clean" and "did not look" are indistinguishable without them.

**Stopping condition:** a round whose BLOCKS list is empty, with a falsifiability table populated
from live data. Not a round with no findings — that round does not come.
