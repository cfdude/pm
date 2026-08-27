---
description: Run the release-scope cross-spec review gate — do this release's specs agree with each other? — and record the verdict
argument-hint: "<releaseId>"
allowed-tools: Bash, Read, Grep, Glob, Task
---

# /pm:cross-spec-review

Gate 1 reviews **one change's** artifacts. Gate 2 reviews **one change's** implementation. A
release is many changes, and until this gate existed nothing asked the question that only appears
when you hold the whole set at once: **do these specs agree with each other?**

Every finding this gate returns involves **two documents at once**, so no amount of per-spec rigor
surfaces them. Measured on this plugin's own 0.27.0: six specs that had each passed
`openspec validate --strict` and would each have passed Gate 1 alone returned **5 Critical and 10
Important** when reviewed as a set — including a flagship scenario that was literally unreachable,
and a shared flag allowlist four capabilities all needed to grow.

## When this fires

**Any release holding two or more spec files, before `/opsx:apply`.** The count is FLAT across the
release's member changes, so one change carrying six specs qualifies exactly as six changes
carrying one each do. Also after any round of **concurrent amendment** — several agents editing
interdependent specs in parallel is a distinct failure generator, and it is the case this gate was
built from.

Not needed below that threshold. Gate 1 covers a single spec completely, and the engine refuses to
record a verdict there rather than storing a record that reads as coverage.

## Procedure

1. **See the set.** Do not type it — the engine enumerates it from disk, which is the whole point:
   a spec list written by the party being reviewed goes stale the moment a capability is added,
   and that staleness is exactly what this gate exists to catch. `/pm:status` shows each release's
   spec count and cross-spec state.

2. **Dispatch fresh-context reviewers** at the release's whole spec set — every spec file, the
   proposal, the existing main specs any delta amends, and the engine. Not summaries. Fresh
   context is mandatory: a reviewer that watched the specs being written inherits the authors'
   assumptions, which are exactly what is being tested.

   | Review mode | Reviewers |
   |---|---|
   | `off` | self-review only |
   | `standard` | one fresh-context reviewer |
   | `thorough` | two, with **different lenses** — coherence/contradiction, and falsifiability/dependency-order; adjudicate any disagreement yourself |

3. **Ask the six questions explicitly.** They are ordered by severity, and reviewers skip the later
   ones unless told not to.

   1. **Contradiction** — do two specs require incompatible behavior of one surface? Shipped, it
      is a coin flip decided by call order.
   2. **Double ownership** — do two specs claim a behavior, such that an implementer satisfies one
      and considers it done?
   3. **Unmeetable requirements** — does any spec assume a field, verb, flag or rendering that
      nothing in the release creates? Watch for **passive voice around the writer**: "the array is
      appended as each commit is attributed" names no writer, and nothing appends.
   4. **Gaps** — walk the proposal's "Resolves" list **one issue at a time** and confirm each maps
      to a real requirement. Half-covered issues hide here.
   5. **Vocabulary forks** — is one concept named two ways? That becomes two data models.
   6. **Shared chokepoints** — is there a single allowlist, enum or dispatch table several
      capabilities must all edit? Whichever lands first rejects the others by name.

4. **Adjudicate — findings are not a mandate.** Split every finding into **BLOCKS** (implementing
   this as written ships a defect, produces unsatisfiable behavior, or leaves a check that cannot
   fail) and **POLISH** (correct and implementable; the finding would improve the document).
   **Fix BLOCKS. Decline most POLISH, and say why.**

   A review of a large document *always* returns findings, so "no findings" is not a stopping
   condition — you would iterate forever. The one thing never to defer is a **contradiction**:
   discovered during apply, it is resolved by whoever hits it first, silently, and by call order.

5. **Re-review after fixing**, scoped to the fixes *and* to what concurrent editing broke. The
   re-review must be able to fail. Two failure modes belong to the fixes themselves:
   - **A narrowed requirement goes inert.** Binding a rule more tightly to resolve a contradiction
     can quietly remove every failing case. For each requirement you narrow, state the failing
     condition that still exists against today's engine — if you cannot, the fix turned a real
     check into decoration.
   - **Cited evidence is falsified by the narrowing.** A spec that says "this can fail today, see
     these four epics" is wrong the moment the narrowing excludes those four. Re-derive it.

6. **Record the verdict.**

   ```bash
   node scripts/conductor.mjs record-cross-spec-review <releaseId> \
     --verdict pass|fail --reviewer "<identity>"
   ```

   `pass` MEANS an empty BLOCKS list, with a falsifiability table populated from live data. It is
   not "no findings"; that round does not come.

   The engine enumerates the release's spec set and records a SHA-256 per file it read. Nothing in
   the verb performs a review, dispatches a reviewer or reads a spec's prose — pm is an
   instruction layer, and this records what a reviewer concluded with evidence a later reader can
   check.

## What the record buys you

A recorded verdict is checkable, and every surface reports it beside the release:

- a spec **added** to the release after the verdict → `⚠ stale`. This is the case a change-scoped
  gate structurally misses: the new spec passes Gate 1 on its own merits, and the set it now
  belongs to was never reviewed as a set again.
- a reviewed spec **amended** → `⚠ stale`.
- a spec the engine cannot read → `⚠ unverifiable`, and a `pass` is refused outright rather than
  recorded against evidence that does not exist.
- the **archive move** (`openspec/changes/<id>/` → `archive/<date>-<id>/`) changes nothing: the
  record is keyed change-relative, so relocating a change never reads as staleness.
- a re-recorded verdict **supersedes** the prior one and keeps it readable — one nested level, so
  the record's depth is not a function of how many rounds ran.

A multi-spec release with no verdict at all says so on every surface. Silence would be
indistinguishable from "reviewed and clean".

## Related

- `/pm:review-mode` — the dial that sets how many reviewers this gate gets.
- `/pm:status` — where each release's spec count and cross-spec state are rendered.
