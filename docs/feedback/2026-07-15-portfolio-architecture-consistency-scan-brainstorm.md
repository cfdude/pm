# Portfolio/architecture-consistency scanning — brainstorm

> Captured 2026-07-15, dispatched as a decision-lane epic
> (`portfolio-architecture-consistency-scan`) with an explicit "brainstorm only, no
> implementation" grant. Source: `docs/vision/2026-07-14-autonomy-orchestration-vision.md`,
> section C — the least-scoped of the original A/B/C/D four-part autonomy vision. A (epic-level
> autonomy) and B (epic-hierarchy orchestration) have both shipped; D (infra-runbook preflight)
> shipped as a docs/taxonomy change. This doc scopes C so a future session can turn it into a
> real OpenSpec proposal without re-deriving the reasoning.

## 1. What does "portfolio/architecture-consistency scanning" concretely mean?

Rob's own framing (from the vision doc, verbatim): "we need to look at the entirety of the
backlog... to avoid a narrow focus... Rather than taking on technical debt, we should first
assess if we need to stand up something architecturally — like Redis, a Postgres database, or a
specific Python client... Architecture decisions may need to be P0 and must be carried
through/propagated to other in-flight or planned initiatives so everyone else is aware."

Reading that alongside the worked example in section B (five epics, one needs more
infra-context than its siblings) and D (infra-runbook preflight), the concrete failure mode this
is meant to catch is:

> Three separate epics, built independently (possibly by three separate hierarchy-child
> dispatches, possibly weeks apart), each quietly decide "I need a cache" / "I need a job queue"
> / "I need a Python HTTP client" and each picks a different answer (Redis vs. in-memory vs.
> Memcached; Celery vs. cron; requests vs. httpx) — with no single point where anyone notices
> the three decisions collide, or that they're the same decision being made three times instead
> of once.

So this is **not**:
- Detecting two in-flight epics that will literally conflict at the code level (merge
  conflicts, overlapping file edits) — that's a narrower, more mechanical problem already
  partially handled by B's sequential-merge worktree model (each child merges one at a time;
  git's own merge conflict detection catches file-level collisions; B even has a
  `pm:merge-conflict-resolver` agent for exactly this).
- A general code-quality or architecture-review pass over already-written code.

It **is**:
- A **decision-level** consistency check across epics that haven't necessarily touched code
  yet — reading epic descriptions/proposals/tasks (whatever's on disk before or during
  execution) and asking "does epic X's approach to problem P contradict, duplicate, or diverge
  from epic Y's approach to the same problem P?"
- Specifically aimed at *infrastructure/dependency-shaped* decisions (add a datastore, add a
  message queue, add a third-party client library, pick a caching strategy) — the kind of
  decision that's cheap to unify before any epic is built and expensive to reconcile after
  three epics have each shipped their own answer.

The mechanism implied by "architecture decisions may need to be P0 and propagated" is: detect →
surface → (if confirmed) spin up a new P0 epic that makes the decision once → link it to every
epic it affects → those epics' own execution should then defer to it rather than re-deciding.

## 2. How would this use the now-shipped B (epic-hierarchy-orchestration) mechanism?

B's mechanism, concretely: a parent epic with children; for each child, run the
`scan-epic-for-autonomy-readiness` preflight, assign an autonomy grant, dispatch a
`hierarchy-child-executor` agent into an isolated git worktree, execute to completion, merge
sequentially back to the parent branch, consolidate an end-of-hierarchy report.

C's natural hook points into that mechanism:

- **At hierarchy kickoff** (before any child is dispatched): after B's per-child preflight scans
  run individually, run one *additional* cross-cutting pass over the full set of children's
  sources (descriptions, tasks.md, proposal.md — whatever's on disk) looking for
  architecture-shaped keywords/decisions that appear in more than one child. This is the
  cheapest integration point because B already reads every child's full source during preflight
  — C would just add a second, cross-referencing pass over the same already-loaded material
  before dispatch begins, rather than a new read.
- **At end-of-hierarchy reporting**: B's design already calls for "a consolidated report
  flagging *controversial* decisions the human should know about (they may affect other backlog
  items — this is the seed of C)" — so C's simplest form could literally just be an extension of
  B's existing end-of-hierarchy report step: after all children finish, do one more pass
  comparing what each child *actually decided/built* (not just what it was asked to do) against
  the rest of the backlog (not just its hierarchy siblings), and fold cross-cutting findings into
  the same report the user already reviews.
- **Independent of any one hierarchy run** (the vision doc's own open question): a standing
  backlog audit that isn't tied to a hierarchy execution at all — could run as its own
  decision-lane epic on demand, or as a periodic `/pm:` command, scanning all `queued` +
  `planned` epics' sources for cross-cutting architecture keywords regardless of whether any of
  them are currently being executed via B.

These aren't mutually exclusive — the hierarchy-kickoff hook is the cheapest MVP because it
reuses B's existing read of child sources; the standing-audit form is more valuable long-term
(catches conflicts between epics that were never in the same hierarchy) but requires a new
command surface, not just a B extension.

## 3. Smallest useful version

Ranked from thinnest to more complete:

1. **Single-pass keyword/topic scan across queued epics' titles + descriptions** — the engine
   (or, per `pm`'s architectural law, an *instruction* the engine emits for the interactive
   agent to act on — the engine itself must never call an LLM or external system) reads all
   `queued`/`active`/`planned` epics' titles and top-level description text, and asks the acting
   Claude agent to identify epics that appear to be independently deciding on the same category
   of infrastructure (datastore, queue, cache, third-party client, auth provider). No new
   `state.json` fields, no new links — purely a read + an LLM judgment call, surfaced as a report
   for the human to act on manually (e.g. by hand-creating a P0 epic and hand-linking it).
2. **Automated cross-reference of `links[]` for contradictions** — leans on the fact that pm
   epics can already carry `relates-to`/`depends-on` links; this version would only look at
   epics that are *already* linked to each other (or share a parent) and check whether their
   descriptions contain conflicting architecture keywords. Cheaper to implement mechanically
   (bounded set of epics to compare, not the whole backlog) but much narrower coverage — it only
   catches conflicts between epics someone already thought to link, missing exactly the "three
   independently-conceived epics that never occurred to anyone to compare" case Rob is actually
   worried about.
3. **LLM-driven full-backlog read with a structured findings report** — the acting agent reads
   every queued/planned/active epic's full source (not just title/description — actual
   tasks.md/proposal.md content where it exists), and produces a structured "potential
   cross-cutting architecture decisions" report: for each finding, which epics are involved, what
   the apparent divergence/duplication is, and a suggested P0 epic to reconcile it. This is the
   most useful version but also the most expensive (full-source read scales with backlog size)
   and the most subjective (recall/precision entirely depends on how well the agent reasons
   about "is this really the same decision" vs. two superficially similar but actually unrelated
   needs).

**Recommendation:** build option 1 first, wired at B's hierarchy-kickoff hook point (per section
2) rather than as a standalone command — it reuses source material B already reads, requires no
new `state.json` schema, and produces a report the human reviews before any hierarchy dispatch
begins (cheap enough that a false positive just costs a few seconds of the user's attention).
Treat option 3 (or a periodic standing-audit command) as the natural v2 once option 1 has been
dogfooded and its false-positive/false-negative rate is understood empirically — building the
full-backlog audit machinery before knowing whether a cheap keyword pass already catches most
real cases would be exactly the kind of premature-complexity risk the project's own
"resist complexity until it hurts" principle warns against. Option 2 is not recommended as a
starting point: it under-covers the exact failure mode Rob named (independently-conceived,
unlinked epics), so it would ship a feature that doesn't address the motivating problem.

## Open questions for the user before this becomes a real spec

These are the vision doc's own open questions, still unanswered, plus a few sharpened by this
brainstorm:

1. **Scope of "propagation."** When a cross-cutting decision is detected and confirmed, what
   actually happens? Auto-create a new P0 epic and auto-link it to every affected epic (via
   pm's existing `relates-to`/`depends-on` link types)? Or just surface it in a report and let
   the human do the epic-creation/linking by hand? Given pm's architectural law (instruction
   layer, never integration layer, and no engine code path may write consequential state
   changes without a human in the loop for anything irreversible), auto-creating an epic
   probably needs to at minimum be presented as a proposed diff the human confirms — not a
   silent write.
2. **Trigger cadence.** Tied only to B's hierarchy-kickoff (cheap, narrow — only catches
   conflicts among a hierarchy's own children), or also a standing/periodic full-backlog audit
   (broader, but needs its own command and its own decision about when it runs — on demand via a
   `/pm:` verb? on a schedule outside pm's own control, since pm has no scheduler?)?
3. **What counts as "the same decision."** Keyword/topic clustering (cheap, likely noisy — e.g.
   "queue" the data-structure vs. "queue" the message broker) vs. an LLM semantic read (more
   accurate, more expensive, harder to make deterministic/testable per the project's zero-dep,
   Node-test-suite discipline)? Given `conductor.mjs`'s zero-dependency constraint and the fact
   that the engine itself must never talk to an LLM, any real semantic matching has to happen in
   the *instruction* the engine emits for the interactive agent to execute, not in
   `conductor.mjs` itself — worth confirming this is an acceptable division of labor before
   designing further.
4. **False-positive tolerance.** How wrong can this be before it stops being useful? A backlog
   audit that flags five plausible-sounding "conflicts" per run, of which one is real, trains
   the user to ignore the report — worth deciding an acceptable precision bar (even informally)
   before building option 3, since it's the version most exposed to this risk.
5. **Relationship to D (infra-runbook preflight).** D already wires "read the infra runbook
   before touching infrastructure" into per-epic preflight. Is C meant to subsume/supersede that
   check for cross-epic cases, or are they intentionally separate (D = "check reality before
   building," C = "check the rest of the backlog before building")? The vision doc treats them as
   separate but adjacent; worth confirming they shouldn't just be merged into one preflight
   concept before scoping C as its own epic.

No implementation was performed as part of this dispatch, per its autonomy grant
(`preAuthorized: []`, brainstorm/research only). This document is the full deliverable.
