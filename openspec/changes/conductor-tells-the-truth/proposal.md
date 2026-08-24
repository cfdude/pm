## Why

A retrospective delivery audit of **49 archived OpenSpec epics across 8 repositories** found that the conductor's records are wrong and its guards do not fire. Gate 2 is enforced by `update-epic` and bypassed by the archive hook, so **42 of 49 epics archived with `gateReview: null`** — by following the documented `/opsx:archive` workflow. Of the 7 that did record a verdict, one provably does not cover the code its own note cites, one is a re-review conducted after the feature broke, and two were written 83 seconds after the merge. Meanwhile `sync` never walks `openspec/changes/archive/`, so **the conductor sees only 49 of 87 archived changes — 56%**.

Every number this project has published about its own effectiveness was computed from those records. This change makes them true.

## What Changes

**Enforcement actually enforces**

- **BREAKING** The archive transition is gated on **every** path, not just `update-epic`. `reconcileArchived()` currently flips an epic to `archived` with no lane check and no gate check. The rules bind **the function wherever invoked** — all four call sites: `upgrade`, `render`, the commit nudge, and `sync` — not a list of hook entry points, because two of those are interactive verbs an agent typed and binding to hooks would leave them under no rule at all. Archives that today succeed silently will refuse, or record how they bypassed.
- A gate verdict records `baseSha`/`headSha` and reviewer identity **as data**, so it can be checked and can go stale. Today a review of `a..b` on an epic that later ships `b..c` is byte-identical to one that covered everything.
- Integrity checks that can each fail today: a verdict whose range excludes the commits its note cites; a gate recorded after the merge commit; an epic archived with zero ticked tasks; one epic id registered under two lanes; an archive directory with no epic.
- `gate1` becomes readable. It is currently stored, documented, and consumed by nothing.
- The write-conflict warning **latches** instead of testing `count === 3`. A burst past the threshold between two briefings currently warns zero times — so the warning is least likely to fire in exactly the wedged-writer scenario it exists for. `snapshot()` also stops consuming the warning into a file nothing reads back.

**The record is honest**

- **BREAKING** An epic ending carries a **disposition with a reason** — `delivered`, `killed`, `superseded`, `abandoned`. A change dropped at Gate 1 for a good reason currently records byte-identically to one that shipped, and the audit's single strongest piece of evidence for gates (a proposal killed because it would have inverted stop-loss safety) is preserved only as a commit message on a deletion.
- The same disposition concept covers three further scopes that are currently unrepresentable: a **deferral** recorded in a design doc (found live in 3 of 3 audited repos, months old, untracked), a **handoff** of unfinished work at archive time, and a **deliberate exclusion** from a release.
- `sync` reconciles `openspec/changes/archive/`, registering an unknown archived change as an epic already in `archived` status. The backfill is a visible, one-time, announced action — never a silent side effect.
- Progress stops counting lifecycle bookkeeping. A task reading `run /opsx:archive <this change>` cannot be ticked before the thing that ticks it, and today it renders as outstanding work.

**The tracker contract is directional**

- **BREAKING** Tracker `direction` — `inward` | `outward` | `both` — replaces direction-by-vendor. Today `rules.mjs` suppresses the outward section with a literal `sys !== "github-issues"` test while `briefing.mjs` emits outward drift gated only on a tracker existing, so a repo receives a `CLAUDE.md` with no outward instructions and a briefing demanding outward action for 29 epics.
- A per-epic freshness watermark, and a refresh gate before specs are drawn. The gate keys on **provenance** (does this epic have an external origin), never on direction — an issue filed by a third party and an epic born from a local spec have different sources of truth in the same repo on the same day.
- The emitted inward-sync recipe **runs**. It currently instructs the agent to call `add-epic` without the required `--id`; two independent sessions hit it the same afternoon and each silently invented a slug.
- Lane at mirror time comes from `suggest-lane`, not a hardcoded `--lane claude-code`. This is the
  call-site half of #114 only; making the routing *decision* better needs product/milestone context
  that does not exist in `pm` yet and is explicitly out of scope (see `tracker-sync`).
- A `github-issues` tracker with no `repo` — which emits neither sync section today — keeps
  emitting neither. Direction alone does not turn an inward section on; the tracker must also name
  a scope to list, or `pm` would emit a command with an unfilled placeholder.

**Epic annotation**

- `description` and `notes` as first-class fields, with the CLI flags to set them. Stories are currently the only free-text carrier, which is why four epics archived with "incomplete" stories that were completion notes.
- `update-epic` gains `--lane` and `--plan`. The **positional** id stays the documented form; what
  changes is that a *misplaced* `--id <x>` flag is either accepted as an alias for the positional id
  or rejected with a message naming `--id` and showing the positional form — never answered with a
  bare usage dump (#71). Which of the two ships is an implementation choice the spec leaves open.
  Every existing `update-epic <id>` invocation — including the reconcile and gate-review flows —
  keeps working exactly as documented.

**Gate procedure** (instruction layer, no engine work)

- The dominant defect class across all three audit shards is the **absent edit** — a rule applied at one call site while an identical sibling goes untouched, ~38 instances in one shard alone, and 5 whole epics that exist only to finish an earlier epic's rule. Both gates are diff-scoped and structurally cannot see it.
- The remedy ships as a **required task**, not prose. Measured in the audit: a rule added to a config with a mandatory task section reached **14/14** subsequent changes; the same rule as a prose bullet reached **3/15**.

## Capabilities

### New Capabilities

- `epic-disposition`: an epic or work item that ends, is deferred, is handed off, or is excluded from a release carries a recorded terminal disposition with a reason. One concept, four scopes — designed once rather than four times.
- `gate-integrity`: gate verdicts carry checkable evidence, the archive transition is gated on every path that can reach it, and the gate procedure requires a call-site completeness sweep and diff-based verification.
- `conductor-record`: the conductor's record of what a repository shipped is complete, and its progress signal reflects delivery rather than bookkeeping.
- `epic-annotation`: epics carry durable free-text rationale distinct from activity, settable from the CLI.
- `state-write-guard`: the optimistic write guard shipped in 0.26.0, with its threshold warning corrected to latch rather than sample.

### Modified Capabilities

- `tracker-sync`: direction becomes explicit configuration read by every emitter; mirrored items carry a freshness watermark and a provenance-keyed refresh gate; the emitted registration recipe is executable and lane-aware.

## Impact

**Schema (`.conductor/state.json`) — requires a `MIGRATIONS` entry.** New fields: `outcome` and its reason, `description`, `notes`, `release`/deferral records, `tracker.direction`, `externalUpdatedAt`, `gateReview.{baseSha, headSha, reviewer}`, a per-epic **array of attributed commit hashes** written by a repeatable `update-epic --attribute-commit <sha>` flag (initialized empty at epic creation, and never added to a pre-existing epic by the migration — absent and empty are different claims), a state-level **archive-backfill marker** — `archiveBackfilledAt`, an ISO timestamp whose *presence* is the marker (deliberately not a watermark: nothing is compared against it, and its only job is gating the announcement, so an absent field means "not yet backfilled" and pre-existing state loads unchanged) — a **`recordedBy`** field naming the non-interactive path that wrote a record (`archive-backfill`, the hook heal), so integrity checks key on a field rather than parsing a free-text reason — deliberately general, and therefore carried on **two host objects**: an epic's terminal disposition record and a gate verdict written by a non-interactive path; a **gate-verdict value distinct from pass and fail** marking an archive that bypassed the gate, plus the reviewer identity it must omit; a **handoff target** on a disposition, recording where unfinished work went; and, from the tracker side, a per-epic **refresh obligation** set at the activation transition and the **refresh-verdict record** that clears it (verdict, summary, when recorded, and the watermark it advances). Outside `state.json`, the task source gains an **agent-declared lifecycle marker** (`<!-- pm:lifecycle -->`) written onto a task line so lifecycle bookkeeping is excluded from progress only where it is declared.

**Migration, as ruled by the maintainer:** `github-issues` → `inward`, every other system → `outward` (verified: a Jira tracker today receives *only* the outward section, so `both` would grant inward pull no repo has ever had). Archived openspec epics are stamped `outcome: delivered` **only** where a passing Gate 2 exists — 7 of 49 — and `unknown` otherwise. The gate enforces going forward and does not touch history.

**New-tracker default is a user-visible behavior change.** A primary tracker registered *after* this change with no `--direction` defaults to `inward`, which reverses today's outcome for a newly registered non-`github-issues` tracker (it receives the outward section today, and would receive the inward one instead). Existing repos are unaffected — the no-`direction` fallback and the migration both preserve current behavior — but the new default must be stated in README and on the Mintlify site, not just in the spec.

**Engine:** `state.mjs`, `briefing.mjs`, `rules.mjs`, `epic-progress.mjs`, `subcommands.mjs`, `update-epic.mjs`, `add-epic.mjs`, `add-many.mjs`, `active-pointer.mjs`, `render.mjs`, `gate-review-writeback.mjs`, `tracker.mjs`, `migrations.mjs`, `write-conflicts.mjs`. `add-many.mjs` and `active-pointer.mjs` are load-bearing, not incidental: bulk creation bypasses the activation transition entirely today, so both the single-active invariant and the refresh obligation must be fixed at that chokepoint. Zero-dependency constraint unchanged. No network call anywhere: `direction` shapes emitted instructions, it does not perform sync.

**Docs:** README and the Mintlify site must reflect every user-visible change in the same PR cycle, per `CLAUDE.md`.

**Resolves:** #71, #79, #80, #88, #102, #103, #107, #109, #110, #113, #115, #116, #117, #118, #119, #120, #121, #122, #124, and the minimum slice of #125.

**Partially resolves:** #66 — what is specified here is `update-epic` gaining `--lane` and `--plan`; anything the issue raises beyond that (notably its `--link` complaint) is resolved only to the extent `epic-annotation` covers it, so confirm against that delta spec before closing. #114 — mirrored items are routed instead of hardcoded to `claude-code`; the primary complaint, that lane routing has no product or milestone context to weigh, needs a layer this release does not build and stays open. Neither issue should be closed when this change archives.

> **Scope note for review.** The maintainer approved 19 issues. #125 (release-planning and deliberate exclusion) is the **20th, included on my recommendation and flagged here so it is easy to cut**: 0.27.0 must build disposition-with-reason for #119/#120/#88 regardless, and release-scope exclusion is the same concept at a fourth scope. Without it, this release's own plan — including every "excluded because…" judgment — survives only in a conversation transcript, which is the exact failure this change exists to fix. Cut it at Gate 1 if you disagree; nothing else in the release depends on it.
