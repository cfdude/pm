# pm plugin improvement feedback — two dogfooding sessions (2026-07-14)

> Captured to survive compaction. Two independent Claude Code sessions, each having used pm for
> a while in a real project, were asked "what would you improve?" This doc consolidates both,
> records verdicts (confirmed bug / confirmed gap / policy reconsideration / speculative /
> rejected), and maps each surviving item to the epic registered under the parent
> `pm-plugin-improvements-2026-07-14`.

## Source A — a cfdude-plugins dogfooding session (11 items)

1. **`/pm:sync` scans `openspec/changes/archive/`** — claimed as a confirmed incident
   (2026-07-09, 18 epics re-registered). **Verdict: could not reproduce.**
   `activeChangeIds()` in `scripts/conductor.mjs` explicitly excludes the `archive` directory
   (`d.name !== "archive"`), and this filter appears to be original behavior, not a recent fix.
   Either misdiagnosed at the time, or from a pm version predating this session's history. Not
   registered as an epic without the actual incident log to re-examine.
2. **No epic-removal command.** Confirmed — the dispatch table has no `remove-epic`/soft-delete
   verb; the only recovery from a mis-registered epic is a raw `git checkout`. → epic
   `remove-epic-verb`.
3. **An already-archived epic can show `⚠ no change on disk` forever, no resolution guidance.**
   Confirmed and root-caused: `missing()`'s condition doesn't exclude `status === "archived"` —
   an epic marked archived whose on-disk directory doesn't match `isArchived()`'s exact
   name/date-prefix pattern shows the warning with no explanation of what's actually wrong. →
   epic `fix-archived-no-change-warning`.
4. **Autonomy blocks and `/pm:hierarchy` show zero real-world usage** in that repo's history.
   Real adoption signal, cause unknown (ceremony weight vs. discoverability vs. genuinely not
   needed at that repo's epic sizes). → epic `autonomy-hierarchy-adoption-investigation`
   (investigation, not a fix — first deliverable is finding out why).
5. **Minimal-detour classification is a forgettable manual trailing step.** Plausible small UX
   improvement: infer `--minimal` from diff shape (single file, no new OpenSpec proposal, small
   line count) with a one-line confirm. → epic `diffshape-minimal-detour-inference` (P3).
6. **The reconciler's verdict never writes back to the link it's reconciling** — its judgment
   only ever lived in conversation. Confirmed gap; merged with Source B's related item (below)
   into one epic covering both the write-back AND giving the reconciler's report a forced
   structure. → epic `reconciler-structured-writeback`.
7. **`reconcileNeeded` never fired despite 10 historical substantial detours.** Verdict: already
   explained by this session's own 0.9.2 fix — POP protocol never actually told the agent to
   *set* `reconcileNeeded: true` before a frame is popped, until that release. The observed data
   predates the fix; not re-registered as a new gap, but worth confirming it fires correctly
   going forward (the pending manual dogfood validation for epic-hierarchy orchestration is a
   natural place to also confirm this).
8. **The plugin's generic lane-routing heuristic is wrong for at least one real repo**, which
   compensates entirely via a CLAUDE.md carve-out rather than plugin config. → epic
   `lane-routing-config` (a real per-repo override mechanism, not just documentation).
9. **No priority staleness/decay signal.** Reporter's own framing: "a hypothesis, not a
   finding." → epic `priority-staleness-indicator` (P3, lowest confidence).
10. **`PROJECT.md` could theoretically drift after manual `state.json` surgery.** Speculative, no
    observed incident — every mutating CLI verb already calls `render()` internally. Folded into
    Source B's `verify-state` item (below), which addresses the actual underlying risk (an
    undetected hand-edit) more directly than a dedicated epic would.
11. **Honcho mirroring is manual with no verification.** **Rejected** — this is pm's deliberate
    instruction-layer law; the engine verifying Honcho state would require the engine to make a
    network call, exactly what the architecture forbids. An accepted tradeoff, not a plugin gap.

## Source B — a market-intelligence dogfooding session (grounded against pm 0.10.0 source + that
repo's `state.json`/`detours.log`)

Full text: `~/Servers/market-intelligence/docs/audits/pm-plugin-improvement-recommendations-2026-07-14.md`

- **Auto-write/print the Honcho pivot/resume memory instead of asking the agent to compose it.**
  Pure string formatting from data the engine already has — a good candidate for the engine to
  *print* the exact memory string as command output (law-compliant: the agent still makes the
  actual MCP call, the engine never touches Honcho itself). → epic `honcho-memory-string-print`.
- **"Auto-render after every mutation."** Checked: already true — every mutating CLI verb
  (`add-epic`, `update-epic`, `set-active`, `set-autonomy`, `set-review-mode`, `set-gate-guard`,
  `set-tracker`, `log-detour`, etc.) already calls `render()` internally before returning. The
  real underlying risk is a *hand-edit* bypassing all of that, which is what `verify-state`
  (below) actually addresses — not registered as a separate item.
- **`tasks.md` checkbox truthfulness is asserted, not checked.** Speculative, heuristic-based
  (diffing checked items against commits touching the epic's paths) — not registered this round;
  worth a look in a future dogfooding pass if checkbox drift is actually observed.
- **`gate-guard` is off by default and has never been turned on**, despite 3 historical
  substantial detours in that repo. Recommendation: flip the *default* to on for any epic whose
  paused frame carries `reconcileOnResume: true` — the blast radius of a missed reconcile
  outweighs an occasional false-positive block. **This reverses a deliberate choice made earlier
  in this same session** (opt-in, off by default, "never a silent default"). Explicitly
  reconsidered and approved. → epic `gate-guard-default-on-reconcile` (P1 — highest-stakes gate).
- **The reconciler agent's report has no forced structure** — prose only, easy to skim past an
  "invalidated" verdict. Merged into `reconciler-structured-writeback` (see Source A #6).
- **`plan-hierarchy` doesn't describe a partial-batch-failure protocol**, and there's no
  re-preflight trigger if a child's scope changes mid-batch (e.g. a detour inside a hierarchy
  run amends a child epic). **Not registered as epics** — these are exactly the open questions
  the pending manual dogfood validation (already queued from the epic-hierarchy-orchestration
  plan) should answer through actual use, not speculative design.
- **No dependency notion for standalone (non-hierarchy) epics** — the same "don't let B starve
  A" starvation problem `plan-hierarchy`'s `depends-on` sort solves for children exists at the
  top-level queue too. → epic `dependency-aware-standalone-ordering`.
- **An `externalDependency` flag** ("this epic's finding depends on an external fact, re-verify
  before trusting," rendered like `reconcileNeeded` is) — real pattern named (alias/naming drift
  cost real time twice in that repo), but under-designed. Not registered this round; needs its
  own brainstorm before a design doc, flagged here for a future session.
- **A `verify-state` command** — fails loudly if `state.json`'s mtime is newer than the last
  render's stamp, catching an undetected hand-edit mechanically. → epic `verify-state-command`.
  This is the one item that actually addresses both this session's "auto-render" complaint and
  Source A's "PROJECT.md could drift" speculation.
- **`/pm:sync`'s planned→untriaged promotion timing** (file presence vs. `openspec validate`
  passing) — speculative, minor. Not registered this round.
- **`set-review-mode` has no per-epic override** — a detour needing `thorough` treatment can't
  get it without flipping the whole repo's mode. → epic `per-epic-review-mode-override`.

## Source C — a weeks-long real-usage session (phase0→phase2, 15/16 stories, zero detours
logged despite real friction; 13 items, grouped)

- **`detours.log` is empty despite real detours happening** — minimal detours get folded into
  commits without ever invoking `/pm:detour --minimal`, because remembering to run it mid-flow
  is itself the friction. Converges with Source A #5 and this session's own auto-detect idea
  (#5/#6 here: a heuristic — touches >1 subsystem, >N files, new external dependency →
  substantial; and a `--minimal --auto` batch-log mode fed by commit messages after the fact).
  **Three independent sessions now converge on this exact pain**, and the reporter named it
  their #1 priority. → `diffshape-minimal-detour-inference`, **promoted to P1** and broadened
  from "infer classification" to "auto-detect an unlogged detour from commit shape and log it
  without a manual invocation."
- **No `startedAt`/`completedAt` timestamps on epics** — `PROJECT.md`/`/pm:status` can't show
  velocity or how long an epic has been active, useful for the weekly Ship-Real-Software check.
  Merges with Source A #9 (priority staleness) into one broader epic, since staleness needs
  exactly this data. → `epic-timestamps-and-staleness` (supersedes `priority-staleness-indicator`
  as a name — same epic, broader scope).
- **`reconcileNeeded` should surface as a loud banner in `/pm:status`, not just a state field.**
  Checked: already substantially true — `buildBrief()` already emits `⚠ RECONCILE PENDING` for
  the active epic, and `render()` already shows `⚠` in the epic table. Not registered as a new
  epic; the only narrow gap (a paused/non-active epic's flag isn't prominently surfaced) isn't
  worth its own epic on current evidence.
- **No link between an epic and its Honcho memories — a one-way write.** Merges into
  `honcho-memory-string-print`: if the engine prints (and locally logs) the memory string it
  emits, that local log *is* the queryable link, without the engine ever calling Honcho's API.
- **Detour classification has no rubric enforcement** (#5) and **minimal detours still cost a
  full manual invocation** (#6) — both fold into `diffshape-minimal-detour-inference` above, not
  separate epics.
- **Autonomy preflight is all-or-nothing per epic** — no shorthand for "autonomous except
  category X" (e.g. schema changes, deploy config), only enumerable `--preauthorize` entries. →
  new epic `category-based-preauthorization`.
- **No visible incremental audit trail of WARN-class autonomous decisions** — only appear in the
  end-of-epic report, so a compacted/interrupted session loses them. The mechanism already
  exists (`autonomy.notifications`, `set-autonomy --notify`) — the gap is the decision rule's
  *wording* ("record for the end-of-epic report") reads as "at the end," not "incrementally as
  it happens." → new epic `incremental-notify-timing-fix` (a cheap, real compaction-safety
  clarification, not new mechanism).
- **`set-review-mode` has no per-epic override** — exact duplicate of the epic already
  registered from Source B. No new epic.
- **No epic-dependency tracking across repos** — a real cross-repo dependency (agent-dm's hub
  deploy on infra-playbooks conventions) isn't capturable in `links`, which only references
  epics within one repo. Genuinely uncertain what the right mechanism is. → new epic
  `cross-repo-epic-dependency-investigation` (decision lane, investigation not a designed fix).
- **`/pm:sync` only handles OpenSpec proposals and Superpowers plans** (checked: `planFiles()`
  already covers Superpowers) — claude-code-lane work with no formal plan file has no artifact
  to auto-detect from. Genuinely hard (there's nothing to scan). **Named but deferred, not
  registered as its own epic** — flagging for a future session if the pain recurs.
- **Manual `/pm:status` re-render after a state change is easy to forget.** Checked: every
  mutating CLI verb already calls `render()` internally; the real gap this points at is an
  undetected *hand-edit* bypassing all of that — already covered by `verify-state-command`. No
  new epic.
- **Upgrade notices fire on every session start with no inline changelog diff** — have to run
  `/pm:changelog` separately to decide if upgrading is worth mid-epic churn. → new epic
  `changelog-preview-in-sessionstart-nudge`.

## Registered epics (children of `pm-plugin-improvements-2026-07-14`)

| Epic id | Priority | Source |
|---|---|---|
| `gate-guard-default-on-reconcile` | P1 | B (policy reconsideration, approved) |
| `diffshape-minimal-detour-inference` | P1 | A #5 + C #1/#5/#6 (promoted, broadened) |
| `remove-epic-verb` | P2 | A #2 |
| `fix-archived-no-change-warning` | P2 | A #3 |
| `reconciler-structured-writeback` | P2 | A #6 + B (merged) |
| `lane-routing-config` | P2 | A #8 |
| `autonomy-hierarchy-adoption-investigation` | P2 | A #4 |
| `honcho-memory-string-print` | P2 | B + C #4 (merged) |
| `verify-state-command` | P2 | B (+ A #10, C #12, merged) |
| `dependency-aware-standalone-ordering` | P2 | B |
| `per-epic-review-mode-override` | P2 | B (= C #9, duplicate confirmed) |
| `epic-timestamps-and-staleness` | P2 | A #9 + C #2 (merged, broadened) |
| `category-based-preauthorization` | P2 | C #7 |
| `incremental-notify-timing-fix` | P2 | C #8 |
| `cross-repo-epic-dependency-investigation` | P3 | C #10 |
| `changelog-preview-in-sessionstart-nudge` | P2 | C #13 |
| `diffshape-minimal-detour-inference` | P3 | A #5 |
| `priority-staleness-indicator` | P3 | A #9 |

All sixteen are mutually independent (no real `depends-on` relationship among them) — this
parent is itself a natural first real-world test case for `plan-hierarchy`: a batch of genuinely
unrelated small-to-medium fixes (mostly claude-code lane; two decision-lane investigations),
exactly the shape epic-hierarchy orchestration was designed to run unattended. Running this
parent through the full B process (preflight all sixteen, `plan-hierarchy`, dispatch) doubles as
the pending manual dogfood validation for B itself — though note it exercises only the
fully-parallel, single-batch case (no dependency edges among these sixteen), not the sequential/
cycle/blocked paths; those still need a separate, deliberately-constructed test.
