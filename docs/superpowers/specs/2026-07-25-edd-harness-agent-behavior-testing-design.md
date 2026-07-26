# Design: EDD harness for agent-behavior and cross-platform parity

**Epic:** `edd-harness-agent-behavior-testing` — child of `multi-platform-agent-support`
**Date:** 2026-07-25
**Blocks:** `codex-platform-support`

## Why this exists

pm's parity enforcement has three layers. Two are already understood:

| Layer | Catches | Precedent |
|---|---|---|
| Mechanical (CI test + ledger) | *Structural* drift — "added a command, forgot Codex" | README/SKILL.md drift tests |
| Procedural (skill) | Propagation work per platform | `release-checklist`, `mintlify-doc-sync` |
| **EDD (this epic)** | ***Semantic* drift — the Codex artifact exists but behaves differently** | — |

A structural test can prove a counterpart file exists. It can never prove that file makes an
agent *do the same thing*. Only measurement against an answer key can, and because the output
is non-deterministic, that measurement must be a distribution over samples rather than an
equality assertion. That is precisely what
[`edd-harness`](https://github.com/cfdude/edd-harness) exists for.

## What gets evaluated — and what does not

**Evaluated: the artifacts an agent interprets.** These are the non-deterministic surface.

- `commands/*.md` (16) — does loading the command doc produce the intended action?
- `skills/conductor/SKILL.md` — the largest instruction surface (detour classification, the
  autonomy decision rule, hierarchy orchestration).
- `agents/*.md` — `hierarchy-child-executor`, `reconciler`, `merge-conflict-resolver`.
- Hook-injected output — does the `SessionStart` briefing actually change what the agent does
  next, or is it ignored?
- The managed `CLAUDE.md` / `AGENTS.md` rules block.

**Not evaluated: `scripts/conductor.mjs`.** The engine is deterministic and already covered by
250 unit tests. Running probabilistic evaluation against it would be slower, costlier, and
strictly weaker than the assertions that already exist. EDD is for emergent behavior; TDD
remains the sharper tool for anything assertable.

**Corpus inclusion criterion:** an artifact earns a scenario when its correct handling depends
on agent *judgment* rather than mechanical execution. "Does `/pm:detour` correctly classify
this interruption as minimal vs. substantial" qualifies. "Does `add-epic` reject a bad lane"
does not — that is a unit test.

## The key insight: the engine is the instrumentation

pm's agent behavior is **already observable**, because correctly-followed instructions leave
deterministic traces on disk:

| Intended behavior | Observable trace |
|---|---|
| Classified a minimal detour and logged it | `MINIMAL` line in `.conductor/detours.log` |
| Registered an epic in the right lane/priority | the epic object in `.conductor/state.json` |
| Refreshed the managed rules block | `CLAUDE.md` between `RULES_BEGIN`/`RULES_END` |
| Recorded a reconcile verdict durably | `links[].reconciled` on the paused epic |
| Re-rendered after a state change | `PROJECT.md` content |

Consequences:

1. **Most scorers are deterministic `check()` calls, not `JudgeScorer`s.** A scenario asserts
   what the agent *did*, not whether its prose sounded right.
2. **The corpus lands on the blocking side of edd-harness's gate.** `edd` blocks on
   deterministic regressions and treats judge regressions as advisory (`--strict` to block
   both). Building on observable state puts pm's parity signal in the blocking tier by
   construction.
3. **Judges are reserved for the genuinely unassertable** — e.g. "did the reconciler explain
   *why* it ruled the proposal invalidated." Kept to a minimum, since judges cost money and
   add variance.

## Adapter: one seam, platform-parameterized

```
adapter(scenario_input) →
  1. materialize a fixture project in a scratch dir
       (a known .conductor/state.json + any openspec/superpowers files the scenario needs)
  2. run the agent headlessly, per the scenario's platform:
       claude -p "<prompt>"        |   codex exec "<prompt>"
  3. read back the resulting .conductor/state.json, detours.log, PROJECT.md, CLAUDE.md
  4. return a plain JSON dict of those observables
```

Both runners are confirmed to exist: `claude -p` and `codex exec` (verified against Codex CLI
0.145.0). The same corpus runs against each; runs are labelled `pm@claude-code` and
`pm@codex`.

The adapter is the **only** domain seam, per edd-harness's contract — the engine itself is
never imported, only invoked and observed.

## Scorers assert desired behavior, not sameness

Parity is **"every supported platform passes the same corpus,"** not "the platforms produce
identical output."

Cross-platform diffing was considered and rejected as the primary signal: if Claude Code and
Codex both mishandle a detour in the same way, a diff reports perfect parity while pm is
broken on both. Encoding the *desired* behavior absolutely catches that; sameness does not.

The baseline/blessing mechanism keeps its normal role — per-platform regression detection over
time. `.edd/baseline.json` is committed, so its git diff *is* the drift review.

## Layout: in-repo, not shipped

```
pm/
  evals/                  # NEW — the corpus (authored)
    adapter.py            #   the single domain seam
    corpus.py             #   SCENARIOS: list[Scenario]
    fixtures/             #   frozen .conductor/ project states
  .edd/                   # NEW — harness output
    runs/*.jsonl          #   gitignored
    baseline.json         #   COMMITTED — diff = drift review
```

This follows edd-harness's own documented integration pattern, and sits alongside pm's
existing in-repo-but-not-product trees (`.claude/skills/`, `docs/`, `openspec/`,
`.changesets/`).

Rejected: a separate `pm-evals` repo. It would give harder isolation, but a new pm command
would then need a corpus update in a *different repo with no mechanical link* — recreating
exactly the drift problem `platform-parity-mechanism` exists to solve, and costing two PRs per
logical change. Keeping them in one repo means an artifact and its scenario change in the same
commit.

**Honest limitation on "never ships":** Claude Code plugins install by git clone, so `evals/`
will physically exist in a consumer's plugin cache. What is guaranteed is that nothing in
`.claude-plugin/plugin.json` references it and nothing loads it — **inert, not absent**,
exactly like `docs/` and `openspec/` today. The zero-dependency law is unaffected: it governs
`scripts/conductor.mjs`, and a Python tree is not in the engine's dependency chain.

## When it runs

**Not per-commit.** A meaningful corpus (say 20 scenarios × 3 samples × 2 platforms) is 120
real agent sessions — too slow and too expensive for a pre-commit hook or every CI run, and it
requires live credentials.

Instead:

- **On demand during development** — `--no-judge` and `--tags` for fast iteration on the
  artifact being edited. This is why the harness lives on the working branch rather than an
  isolated QA branch: the feedback loop only has value if it is reachable while editing.
- **As a release gate** — wired into `release-checklist`, alongside the existing engine tests.
- **Whenever an evaluated artifact changes**, per the procedural propagation skill from
  `platform-parity-mechanism`.

The existing `node --test` suite and the pre-commit hook remain the fast, always-on gate;
EDD is the deliberate, heavier one.

## Contributor onboarding (required deliverable)

`CONTRIBUTING.md` must gain a repeatable setup procedure, because a contributor cloning pm
gets the corpus but **not** a working harness — `edd-harness` is a separate project with a
Python toolchain, whereas pm itself needs only Node.

The section must cover: installing `uv` + Python 3.13; installing `edd-harness`; configuring a
flat-cost judge backend (`claude` CLI or a local Ollama server) and noting it is needed *only*
for `JudgeScorer`s; running the corpus; and blessing a baseline. It must also state plainly
that EDD setup is optional for contributors who are not touching an evaluated artifact.

## Out of scope

- Evaluating `scripts/conductor.mjs` (deterministic; unit-tested).
- Any platform beyond Claude Code and Codex. The corpus is authored to be platform-agnostic so
  a third runner is an adapter change, not a corpus rewrite.
- Running EDD in CI. Deferred until cost and credential handling are understood in practice.

## Open questions

1. **Fixture realism.** How much of a real project must a fixture reproduce for a scenario to
   be meaningful — a bare `.conductor/state.json`, or a full repo with git history (some
   behaviors, e.g. auto-detour inference, read commit shape)?
2. **Sample count vs. cost.** edd-harness folds across `samples` per scenario; the right number
   is an empirical trade-off between statistical confidence and spend.
3. **Plugin availability in a headless run.** Whether `claude -p` and `codex exec` load an
   installed pm plugin (hooks included) in a scratch directory, or whether the fixture must
   stage plugin artifacts explicitly. **This is the feasibility crux and should be probed
   first**, before any corpus is authored.
4. **Judge model separation.** edd-harness requires the judge model differ from the model under
   test; confirm what that means when the model under test is itself an agent CLI.
