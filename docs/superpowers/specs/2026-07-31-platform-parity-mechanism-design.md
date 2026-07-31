# Design: platform parity mechanism (structural gate)

**Epic:** `platform-parity-mechanism` — child of `multi-platform-agent-support`
**Date:** 2026-07-31
**Blocks:** `hermes-platform-support`, `codex-platform-support`

## Why this exists

Claude Code is the permanent base platform; every other platform is held to parity with it.
Parity enforcement has three layers, and this epic owns the first:

| Layer | Catches | Status |
|---|---|---|
| **Mechanical (this epic)** | *"you added a capability and never considered porting it"* | this spec |
| Procedural (a propagation skill) | the per-platform work of propagating a base change | deferred — `parity-propagation-skill` |
| Semantic (EDD) | the counterpart exists but *behaves* differently | shipped |

The mechanical layer catches the one failure mode that exists **even with a single platform**,
and the one EDD structurally cannot catch: a forgotten capability has no scenario, so a corpus
run stays green while the gap widens. This is why the gate lands *before* the first port —
otherwise drift gets an unobserved window during exactly the period when the most artifacts are
being added.

## Scope: scaffolding, not a system

Deliberately minimal. The hard part of multi-platform support is the Hermes port, not this
ledger, and building a rich gate against zero second platforms would be inventing structure for
a problem not yet met. What ships is the shape the port fills in.

**In scope:** one JSON ledger, one test, two assertions.

**Explicitly out of scope**, each with its own filed epic so it is not lost:

- The **propagation skill** (`parity-propagation-skill`, P3 planned) — writing the procedure
  before any port has happened would infer steps from design docs rather than from what a port
  actually required.
- **Exemptions** (`parity-ledger-exemptions`, P3 planned) — see "What was dropped" below.
- **Per-platform reassessment** (`parity-reassessment-per-platform`, P2 planned, blocks Hermes)
  — a recurring obligation, re-opened on each platform added, not a one-time task.
- **Corpus expansion** (`edd-corpus-expansion-nondeterministic-surfaces`, P2) — the EDD harness
  existing is not the same as EDD being *done*: the corpus covers one scenario against 22
  artifacts.

`scripts/` is out of scope entirely. The engine is already platform-neutral and shared, so it
has nothing to port.

## The ledger

`docs/parity-ledger.json` — hand-declared capabilities, machine-parseable. JSON rather than a
Markdown table because a test has to read it, and the zero-dependency law prefers JSON (native
`JSON.parse`) over pulling a parser.

```json
{
  "platforms": ["claude-code"],
  "capabilities": [
    {
      "id": "detour-lifecycle",
      "artifacts": ["commands/detour.md", "commands/resume.md", "agents/reconciler.md"],
      "platforms": { "claude-code": "slash commands + reconciler subagent" }
    }
  ]
}
```

**A capability is the unit, not a file.** Platforms implement the same capability differently —
Codex uses filename-derived prompt files, Hermes registers commands in plugin code — so a
file-for-file mapping would force a correspondence that cannot exist. A capability may claim
several artifacts; the per-platform value is a *description of the mechanism*, not a path.

**Unported platforms are absent from `platforms[]`, not present-with-nulls.** Nothing claims
support for a platform that has not been ported, so there is no half-truth to maintain. The
Hermes port adds itself to the list and fills its column as it goes.

## The gate

One test in `scripts/test/`, the same shape as the existing dispatch-key drift tests, which
already walk a directory and assert every entry is documented. Two assertions:

1. **Every artifact is claimed by exactly one capability.** Walk `commands/`, `agents/`,
   `skills/`, `hooks/`, `.claude-plugin/` — 22 files today. A new `commands/foo.md` with no
   ledger row fails CI. This is the assertion the epic exists for.
2. **Every claimed path exists.** A deleted command leaves a stale row asserting parity for
   something gone; that fails too.

Both can fail *today*, with one platform and no exemptions. That is the bar.

The test deliberately does **not** assert that any platform's column is complete. With one
platform that would be 22 instant failures; the assertion becomes meaningful only when a second
platform declares support, which is the port's job under this gate.

## What was dropped, and why

An earlier draft had a third assertion: *"every exemption carries a non-empty reason."* With
zero exemptions it could never fail — the vacuous-coverage pattern that appeared four separate
times while building the EDD harness (four of five guard tests passing on an unrelated
file-count rule; a hook-JSON regex matching zero commands; an `InstructionsLoaded` recorder
whose own error handler hid that it was broken). A test that cannot fail reads as coverage
while measuring nothing.

So exemptions are dropped from the initial ledger entirely and filed as
`parity-ledger-exemptions`. When Hermes hits a genuine cannot-support case, the concept gets
designed against a real example, with a test that can actually fail.

## Testing

The two assertions are the test. Beyond them:

- A fixture-based unit test proving assertion 1 **fails** on an unclaimed artifact, and
  assertion 2 **fails** on a claimed-but-missing path. Without these, the gate itself is
  unverified — the same trap as above.
- No agent runs, no network. This is a static consistency check over the repo.

## Consequences

Once this lands, `hermes-platform-support` has no remaining unarchived `depends-on`. Its port
proceeds *under* the gate: every capability it adds or ports is claimed as it goes, rather than
reconstructed afterward.
