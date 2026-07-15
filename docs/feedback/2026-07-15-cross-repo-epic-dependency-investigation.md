# Investigation: cross-repo epic dependencies

**Epic:** `cross-repo-epic-dependency-investigation` (lane: decision, P3)
**Date:** 2026-07-15
**Type:** investigation writeup, no code changes

## Problem

`links[]` on an epic (`.conductor/state.json`) can only reference another epic within the
*same* repo's state file. Real dependencies cross repo boundaries — e.g. a deploy epic in
`highway-infra-playbooks` depending on a conventions epic in `infra-playbooks`, or an epic in
this `pm` repo depending on something shipped in `cfdude-plugins`. Today there is no way to
express that link at all.

## Current schema (read from source)

- `scripts/conductor.mjs:364-366` — `validLink(l)`: a link is only `{type: string, epic:
  string}` (+ optional `reason`). No repo/host field exists.
- `scripts/conductor.mjs:896-908` — `parseLinkFlags()`, used by `add-epic --link` and
  `update-epic --link`: splits `"<type>:<epic>[:<reason>]"` and **validates `epic` against
  `knownEpicIds`** — the set of ids in *this repo's* `state.epics`. Any id not present in the
  local state file throws `bad --link '<s>': '<epic>' is not a known epic id`. This is the
  actual blocker: the CLI mechanically rejects a link to an epic it can't see.
- `link.type ∈ resolves-blocker-for | may-invalidate | depends-on | relates-to` (per
  `skills/conductor/SKILL.md:306`).
- `depends-on` links additionally feed the sibling topological sort used by hierarchy
  orchestration (`scripts/conductor.mjs:942-968`, restricted to `childIds` within one
  hierarchy) — so `depends-on` is not just descriptive, it's load-bearing for ordering
  batches. A cross-repo `depends-on` could never participate in that sort (the other repo's
  epic isn't in this process's `childIds`), so at minimum a cross-repo link needs to be
  understood as *documentation-only*, never an input to automatic sequencing.

## Constraint that shapes every option

`pm`'s hard architectural law (CLAUDE.md, "The `pm` engine — hard constraints"): the engine
(`conductor.mjs`) must **never** open a network connection or call an external system itself.
The one documented, opt-in exception is the gate-guard hook. Any cross-repo mechanism must
either stay entirely instruction-layer (the engine only stores/renders a string; a human or
agent does the actual cross-repo lookup) or be scoped and opt-in narrowly enough to match the
gate-guard precedent.

## Options considered

### (a) Plain-string cross-repo reference, resolved manually by the agent

Extend the link schema with an optional `repo` field (a path or URL) alongside `epic`, e.g.
`{type: "depends-on", repo: "../infra-playbooks", epic: "some-epic-id", reason: "..."}`, or
equivalently encode it as a single string `<repo>#<epic-id>` if `epic` already contains `#`.
`validLink()` would accept it without trying to resolve it — resolution stays entirely a job
for the interactive agent, which reads the other repo's own `PROJECT.md`/`state.json` when
that link becomes relevant (before/during a status check, a preflight, etc.), exactly the way
an agent today reads a file it hasn't been told the contents of. The engine never dereferences
`repo` itself — no `fs.readFileSync` across a repo boundary inside `conductor.mjs`, no network
call, nothing added to the zero-dependency Node core-only surface.

- **Compliance:** fully compatible with the instruction-layer law — the engine only stores an
  opaque string/object and renders it in `PROJECT.md`/status output; it does not act on it.
- **Cost:** `parseLinkFlags`'s `knownEpicIds` check needs a carve-out — when `repo` is present,
  skip the "is a known epic id" validation (there is no way to validate a foreign id without
  crossing the boundary, which the law forbids anyway). This is a small, mechanical schema
  change: add optional `repo`, and if `repo` is set, don't require `epic ∈ knownEpicIds`.
  `link.type` semantics need one documented caveat: a cross-repo `depends-on` is
  advisory/documentation-only and MUST NOT be assumed to participate in the topological-sort
  ordering used for same-repo hierarchy batches.
- **UX cost:** resolution quality depends entirely on the agent actually going and reading the
  other repo when it matters. Nothing forces that to happen — it's a convention, not a
  guarantee, same as any other "go read this" instruction pm already emits.

### (b) Shared external registry (read-only, opt-in)

A small external index (a file synced somewhere, or a lightweight lookup service) that maps
`repo#epic-id → status/title` across repos, updated by each repo's own conductor and read by
others. This is structurally the gate-guard precedent: normally forbidden, carved out only if
explicitly opt-in, local-first, and read-only.

- **Compliance:** viable ONLY under the same narrow carve-out gate-guard uses — off by default,
  explicit `set-...-registry on`, and even then it would need to be read-only (no epic's status
  in Repo A is ever *written* by conductor code running in Repo B). Even read-only, this is a
  materially bigger surface than gate-guard (gate-guard blocks a local tool call; this reaches
  across the filesystem or network to another project's data on every relevant command).
- **Cost:** meaningfully higher build/maintenance cost than (a) — needs a sync mechanism, staleness
  handling, and a new opt-in flag, config surface, and test suite. No evidence yet of demand
  frequent enough to justify that (this epic itself cites exactly one example use case).

### (c) Reject as out of scope — Honcho already covers cross-repo persistence

Argument: Honcho memory already exists specifically as the durable, cross-session/cross-repo
layer (CLAUDE.md, "PM Conductor → Routing → OpenSpec/Superpowers → Honcho"). Cross-repo
dependency notes could just be Honcho memories ("epic X in repo A depends on epic Y in repo
B, see repo B's PROJECT.md") written at PUSH/POP or epic-creation time, with no `conductor.mjs`
schema change at all.

- **Compliance:** trivially compliant — Honcho writes already happen from the interactive
  agent, not from the zero-dependency engine, so this adds zero engine surface.
  **Weakness:** Honcho memories are unstructured prose, not a queryable field on the epic
  itself. They wouldn't show up in `PROJECT.md`'s epic table or `/pm:status` link rendering,
  and they can't be inspected mechanically (e.g. "list all epics with an unresolved cross-repo
  dependency"). It also doesn't compose with the epic-hierarchy orchestrator, which reads
  `links[]` directly, not Honcho.

## Recommendation

**Adopt (a): a plain-string/optional-`repo`-field extension to the existing link schema,
resolved manually by the agent — not (b), not (c) alone.**

Rationale:
- (a) is the smallest change that actually gives cross-repo dependencies a durable, structured,
  renderable home (visible in `PROJECT.md`'s link column and `/pm:status`), which (c) cannot
  do on its own.
- (a) requires zero exceptions to the instruction-layer law — no engine-side network or
  cross-repo filesystem access is added, unlike (b), which would need a gate-guard-style
  carve-out for a much larger, ongoing surface (continuous cross-repo reads instead of a single
  local `PreToolUse` block) for a demand signal (one example epic) too thin to justify it yet.
- (a) and (c) are not mutually exclusive — keep using Honcho for the *narrative* ("why does
  this link exist, what happened when it was created") while the link schema carries the
  *structured* fact (which repo, which epic, which relationship type). Recommend pairing them:
  when a cross-repo link is added, also write the one-line Honcho memory, exactly as the
  existing detour PUSH/POP convention already does.

### Concrete follow-up (not built here — this is a decision-lane deliverable, no code)

If/when this graduates from investigation to a proposed change:
1. Add optional `repo` (string: relative path or URL) to the link object; `validLink()` accepts
   it without dereferencing it.
2. In `parseLinkFlags`, skip the `knownEpicIds` membership check when `repo` is present (can't
   validate a foreign id without crossing the instruction-layer boundary).
3. Document in `skills/conductor/SKILL.md`'s link section: a `repo`-qualified `depends-on` is
   advisory only, never an input to the hierarchy topological sort (`scripts/conductor.mjs`
   deps map, `childIds`-scoped).
4. Render `repo`-qualified links distinctly in `PROJECT.md`/status output (e.g.
   `depends-on→infra-playbooks#conventions-v2`) so a reader immediately knows it points outside
   the current repo and won't be auto-resolved.
5. Convention: when adding a cross-repo link, also write a one-line Honcho memory (mirrors the
   existing detour PUSH/POP pattern) so the relationship survives outside `state.json` too.

This keeps the epic-level autonomy grant's premise intact — a read-only, non-destructive
investigation with a clear recommendation, no filesystem/network mutation, no code change.
