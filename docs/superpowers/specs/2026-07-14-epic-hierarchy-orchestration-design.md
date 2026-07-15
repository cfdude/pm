# Epic-hierarchy orchestration — design

> Second sub-project of the autonomy/orchestration vision (see
> `docs/vision/2026-07-14-autonomy-orchestration-vision.md`, section B). Builds on epic-level
> autonomy (pm 0.8.0, "A") — read that design/CHANGELOG entry first if anything here assumes
> unfamiliar context. Portfolio/architecture-consistency scanning ("C") depends on this epic
> existing and is explicitly out of scope here.

## Problem

Epic-level autonomy (A) lets one epic run unattended. Rob wants the same trust extended one
level up: a **parent epic's whole set of children** runs unattended, with per-child autonomy
grants (a child touching infrastructure needs more context/approval than a sibling that
doesn't), respecting that some children can run in parallel (independent) while others must run
in sequence (one builds on another), and producing a consolidated end-of-hierarchy report
flagging anything controversial.

Constraint established during scoping: **must not depend on Jira's Initiative→Epic grouping**
(Premium/Enterprise-tier only) — pm's existing `parent` field already provides the grouping, and
this design uses it unchanged.

## Scope: v1 vs. deferred v2

Rob raised a fuller "assessment framework" — deciding, for the whole batch, whether to execute
via plain subagents, the Workflow tool, "UltraCode," a specific model ("Fable"), or synchronously
vs. asynchronously. He was explicit that this might be "a future phase rather than something we
implement immediately," and agreed to split it out. **This design covers only v1**: priority- and
dependency-ordered subagent dispatch, reusing mechanisms pm already has. The fuller
strategy-selection framework is deferred to a separate, later epic — not designed here.

## Design

### 1. No new persistent state — recompute, don't remember

Consistent with pm's existing principle (see `reconcileArchived()`'s comments in
`conductor.mjs`): there is no "hierarchy run in progress" tracking. A hierarchy's execution plan
is recomputed fresh, every time, from data pm already has:

- `parent` — which epics are this hierarchy's children (existing field, unchanged).
- `priority` (P0–P3) — tie-breaks ordering within a batch (existing field, unchanged).
- `links` with `type: "depends-on"` **between siblings** — the sequencing signal. Already a
  documented link type; no new link type is introduced. A dependency link to something *outside*
  the parent's children (e.g. this repo's own `portfolio-architecture-consistency-scan
  depends-on epic-hierarchy-orchestration`, which are siblings under no common parent) does not
  affect batching — only sibling-to-sibling links inside one hierarchy do.
- `autonomy` (from A) — each child's own preflight-granted trust, unchanged.

Progress is just each child's own `status` transitioning `queued → active → archived`, exactly
as pm already tracks it. The parent epic's own status is **never auto-transitioned** by this
feature — closing it out stays a human decision, mirroring how A never auto-closes an epic
either.

### 2. `plan-hierarchy --parent <id>` — new engine verb (deterministic, testable)

Reads `state.epics`, filters to children of `<id>` (`e.parent === id`), and:

1. Builds a dependency graph from `depends-on` links where **both endpoints are children of the
   same parent** — links to epics outside the hierarchy are ignored for batching purposes.
2. Topologically sorts children into **batches**: batch 0 = children with no unresolved
   dependency on another child in this hierarchy; batch 1 = children whose only dependencies are
   in batch 0; and so on. Children in the same batch have no dependency relationship to each
   other — they're independent.
3. Within a batch, orders by priority (P0 first, ties broken by id for determinism).
4. **Detects a dependency cycle among children** and refuses to produce a plan — exits non-zero,
   naming every epic id in the cycle, rather than silently producing a bogus order.
5. **Annotates each child with its current autonomy status.** A child whose `autonomy.level` is
   not `"autonomous"` is flagged — dispatching it as-is would immediately hit A's decision-rule
   item (d), "no context to act on → STOP," the moment its subagent starts. Surfacing this in the
   plan lets the preflight step (below) catch it before any dispatch happens, not after.

Output shape (JSON, since this feeds an interactive agent's next steps, not a human terminal
read — mirrors how other engine verbs return structured data for the agent to act on):

```json
{
  "parent": "<id>",
  "batches": [
    { "batch": 0, "epics": [
      { "id": "child-a", "priority": "P1", "autonomous": true },
      { "id": "child-b", "priority": "P2", "autonomous": false }
    ]},
    { "batch": 1, "epics": [
      { "id": "child-c", "priority": "P0", "autonomous": true }
    ]}
  ]
}
```

A cycle produces a non-zero exit and a clear stderr message instead of this JSON, e.g.:
`conductor: plan-hierarchy: dependency cycle among children of '<id>': child-x -> child-y -> child-x`.

### 3. Preflight — all children up front, not interleaved

Before any batch executes, the agent runs A's existing preflight scan (unchanged — the same
"Epic-level autonomy — the preflight scan" process already documented in `SKILL.md`) against
**every** child of the hierarchy, not one at a time as each batch comes up. Findings across all
children are consolidated into **one** batch of questions presented to the user — matching Rob's
original framing of this exactly ("the PM analyzes the work and returns with a list of
questions... I provide explicit approval... then proceeds"). Answers are recorded per-child via
the existing `set-autonomy <child-id> --preauthorize ... --context ...`, then each child that's
cleared gets `set-autonomy <child-id> --level autonomous` — plain repeated application of A's
existing verb, N times, not a new mechanism.

### 4. `agents/hierarchy-child-executor.md` — a new packaged agent

Mirrors the shape of the existing `agents/reconciler.md` (pm already ships one custom agent this
way). Dispatched once per child epic, front-loaded with:

- The child epic's full context (its `tasks.md`/`planPath`/inline `stories[]`, whichever its lane
  uses).
- Its `autonomy` block (`preAuthorized`, `context`) from the preflight step.
- Explicit instructions: work the epic to completion using its lane's normal workflow (OpenSpec
  propose→apply→archive, Superpowers TDD, or direct claude-code work), follow A's five-criteria
  decision rule for whether to stop, and do not ask the orchestrating agent for guidance except
  for a genuine STOP condition A's rule already defines.
- A fixed report-back contract: what was done, decisions made in the user's absence (the
  WARN-class log from A), and status (`done` | `blocked` | `stopped-for-genuine-unknown`).

Dispatch is **parallel within a batch** (multiple subagent calls in the same turn when a batch
has more than one child) and **sequential across batches** (batch N+1 doesn't start until every
child in batch N has reported back) — this is instruction-layer behavior documented in `SKILL.md`,
not engine code, since the engine never dispatches agents itself (consistent with pm's law).

### 5. End-of-hierarchy report

After all batches complete, the orchestrating agent collects every child's report and produces
**one consolidated summary**: what was asked (the preflight batch), what was done (per child),
decisions made in the user's absence across the whole hierarchy, and an explicit flag on anything
controversial (WARN-class or consequential) since it may affect other backlog items — this is
the seed portfolio-architecture-consistency-scan ("C") will later build on, not something this
epic needs to act on itself.

## Error handling

- **Dependency cycle among children** → `plan-hierarchy` refuses outright (see §2.4).
- **A child lacks an autonomy grant** → flagged in the plan output (§2.5); the preflight step
  (§3) is the moment to catch and resolve this before any dispatch.
- **A child's subagent reports `blocked`** → the orchestrating agent does not advance to a later
  batch that depends on the blocked child; batches with no relation to it may still proceed. The
  blocked child is flagged in the end-of-hierarchy report for manual resolution — this feature
  does not attempt to auto-retry or auto-resolve a block.

## Testing

- `plan-hierarchy`: full `node --test` coverage — batch ordering across multiple dependency
  chains, priority tie-breaks within a batch, cycle detection (and that it names every epic in
  the cycle), the autonomy-status annotation, and edge cases (a parent with zero children, a
  single child, all children mutually independent, a straight linear chain).
- `agents/hierarchy-child-executor.md` and the `SKILL.md` orchestration section are not
  unit-testable (agent behavior, not engine code) — validated the same way A was: a live dogfood
  run against a real small parent+children hierarchy, judged for whether the reports and the
  consolidated summary are actually useful, before being trusted for real work.

## Out of scope (deferred to a later epic)

- The "assessment framework" choosing execution strategy (plain subagents vs. the Workflow tool
  vs. UltraCode vs. a specific model vs. sync-vs-async) — Rob's own words, "might be a future
  phase."
- Portfolio/architecture-consistency scanning ("C") — depends on this epic existing, not designed
  here.
- Any change to how a single epic (without a parent/children) is executed — A's behavior is
  unchanged.

---

## Addendum (2026-07-15) — worktree-isolated dispatch + tiered conflict resolution

**Discovered via actual dogfooding, not speculation.** The first live attempt to run this
feature against a real hierarchy (`pm-plugin-improvements-2026-07-14`, 15+ children) surfaced a
real gap the original design missed: §4's "parallel within a batch" dispatch assumed children
working independently, but nothing prevented two children from concurrently mutating the *same*
files — and in this specific batch, every child touches `scripts/conductor.mjs`. Logged as
`df-hierarchy-no-shared-file-conflict-detection` during the dogfood run itself; this addendum is
its resolution.

**Rejected approach:** an opt-in `--touches-files` declaration per epic, with `plan-hierarchy`
marking a batch `parallelSafe` only when declared file sets are provably disjoint. Rejected
because it puts the burden of prediction on the epic author (fragile, and the same class of
false confidence the preflight scan's own design already rejected for keyword-based scanning —
see "Approaches considered" above) and doesn't actually fix concurrent writes, only tries to
avoid triggering them.

**Adopted approach: git-worktree isolation per child, sequential merge-back, tiered conflict
resolution.** This fixes the underlying problem (concurrent writes) rather than predicting
around it, and requires **no change to `plan-hierarchy`'s output** — only to the dispatch/merge
instructions in `SKILL.md` and one new packaged agent.

### 1. Each child works in its own git worktree + branch

Per `superpowers:using-git-worktrees`. Branch naming convention: `hierarchy-child/<epic-id>` —
deterministic and greppable, so tooling (see §3 below) can reliably identify hierarchy-dispatch
worktrees versus any other worktree in play. Cleanup (worktree removal + branch deletion) happens
immediately after that child's branch merges back — never left dangling, per this repo's own
CLAUDE.md worktree-hygiene rule, which this addendum now bakes into the *plugin itself* (see §3)
rather than leaving it to depend on a user's personal global instructions being in place.

### 2. Children never write `.conductor/state.json`

`saveState()` rewrites the entire file (`JSON.stringify(state, null, 2)`) on every mutation —
two children each calling a state-mutating verb in their own worktree would produce two full
rewrites of the same file, which is exactly the shape of change most likely to conflict on
merge even when the two children's *logical* edits don't overlap. Rather than rely on git to
merge that cleanly, **children don't touch it at all.** They only return their fixed report
(`STATUS`/`DONE`/`DECISIONS`/`CONCERNS`, unchanged from §4 above). The orchestrating agent is the
**sole writer** of state transitions — marking a child `active` before dispatch, `archived` after
its worktree merges cleanly — applied in one pass after the batch, not interleaved with dispatch.

### 3. Sequential merge-back, with mechanical orphan detection

Even though children work in parallel, their worktree branches merge back **one at a time** —
this is what converts a silent concurrent-write race into a normal, visible git merge conflict
if two children genuinely touched overlapping lines, which is safe (git refuses to silently
produce a wrong result) even though it isn't free of conflicts entirely.

A new engine verb, **`verify-worktrees`** (pure read, zero-dependency, fully testable — same
shape as `plan-hierarchy`/`verify-state-command`): cross-references `git worktree list` against
`hierarchy-child/<epic-id>` branch names and each epic's current `status`. Any such worktree
whose epic is already `archived` (i.e. successfully merged and closed out) is flagged as
orphaned — this is what makes worktree hygiene a property of the **plugin**, checkable on any
fresh install, rather than something that only holds because a particular user's global CLAUDE.md
happens to say so.

### 4. Tiered conflict resolution — never a hard stop for an ordinary merge conflict

This is a direct, consistent application of epic-level autonomy's *existing* five-criteria
decision rule, not a new exception carved out for this feature: an ordinary git merge conflict is
always recoverable (inspect, revert, re-attempt — the branch and its history remain), which is
exactly criterion (c) — "destructive but restorable → WARN, log it, proceed" — never criterion
(b), which is the only one that would justify an unconditional stop, and which a git-tracked
conflict never triggers (there is always a restore path: the commit history itself).

The resolution ladder, attempted in order, on a merge conflict:

1. Attempt the merge normally.
2. On conflict: dispatch a new packaged agent, **`agents/merge-conflict-resolver.md`** (mirrors
   `reconciler.md`'s shape) — reads both sides of the conflict plus the merge base, and attempts
   a reasoned resolution.
3. If that agent reports uncertainty: escalate — retry with a more capable model (e.g. Opus)
   and/or consult the `advisor()` tool for a second opinion before finalizing.
4. If still genuinely unresolvable: commit the best-effort resolution anyway (recoverable via git
   history, so this is WARN not STOP per the existing decision rule) and **log a new follow-up
   epic under the same parent** describing the residual issue/technical debt, then continue the
   batch. The orchestrator never tells the human "we can't merge this, you handle it" for an
   ordinary code conflict — that outcome is explicitly designed out.

### Updated error handling (supersedes the relevant line above)

- **A child's subagent reports `blocked`** → unchanged from the original design (§ Error
  handling above) — still don't advance a later batch that depends on it.
- **A worktree merge conflict** → NOT a stop condition, per §4 above — resolved through the
  tiered ladder, worst case logged as a follow-up epic, batch continues.
- **An orphaned hierarchy worktree detected by `verify-worktrees`** → surfaced to the user/agent
  for cleanup; not auto-deleted without confirmation, since a worktree could in principle still
  hold in-progress work the epic-status bookkeeping hasn't caught up with yet.

### Updated testing

- `verify-worktrees`: full `node --test` coverage — detecting an orphan (archived epic + still-
  present matching worktree), the clean case (no orphans), and epics with no corresponding
  worktree at all (the common case — most epics never had one).
- `agents/merge-conflict-resolver.md` and the updated dispatch/merge instructions in `SKILL.md`
  are agent behavior, not unit-testable — validated via the same live dogfood run this addendum
  itself grew out of, once implemented.
