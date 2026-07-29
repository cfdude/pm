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

## Resolved design decisions

**Fixture realism — start minimal, add only what a scenario proves it needs.** A fixture sits
between a bare `.conductor/state.json` and a full repository; reproducing a complete repo is
more than any scenario requires. The floor is set empirically: author a couple of scenarios,
run them on both platforms, and add realism only where a scenario cannot otherwise produce a
meaningful result. Some behaviors will demand more than others — auto-detour inference reads
commit *shape*, so those scenarios need real git history while most will not.

**Sample count is a tuning parameter, not an open question.** Pick a per-scenario count that
buys statistical confidence without being cost-prohibitive; `samples` is already per-scenario
in edd-harness, so a cheap deterministic scenario and an expensive judged one need not share a
value.

**Judge model must differ from the model under test — deliberately, to avoid confirmation
bias.** Multiple models are available; the judge is chosen to be a different one than whatever
agent is being evaluated. This satisfies edd-harness's own constraint and, more importantly,
prevents a model from grading its own homework.

## Platform capability verification: a standing procedure

Headless execution is available on every platform pm intends to support — each ships a CLI.
Establishing *what* a given platform supports follows a fixed order, and this procedure is
itself a deliverable, because it is the method that keeps every future platform assessment
honest:

1. **Install/update to the current CLI version.** Capability answers go stale fast.
2. **Run `--help`** and enumerate the actual subcommands and flags available.
3. **Consult the platform's own documentation** for hooks, plugins, skills, agents, and
   headless/exec modes.
4. **Probe the live binary** for anything the docs leave ambiguous.

This is not theoretical. Applied to Codex CLI 0.145.0 it overturned *both* secondary research
sources: web search claimed hooks were experimental and feature-flagged, Perplexity claimed
they were undocumented or absent, and `codex features list` showed `hooks` **stable and
enabled by default**. Any capability claim not verified against the installed binary should be
treated as unconfirmed.

**Fallbacks if a platform ever lacks a usable headless CLI path** (none currently does):
drive an interactive session through a terminal emulator via AppleScript (e.g. Ghostty) and
capture the output, or issue commands over SSH. These are contingencies — the CLI path is
strongly preferred wherever it exists, since it is scriptable, deterministic in invocation,
and free of UI-timing fragility.

## Feasibility: PROVEN for Claude Code (2026-07-26)

The load-bearing unknown — whether an installed pm plugin's **hooks fire in headless mode in
an arbitrary directory** — was probed directly and resolved positively.

**Method.** A pm-initialized fixture was created in a scratch directory (`~/Documents/Repos/pm-sample`)
with a deliberately unguessable active epic id, `canary-probe-7f3a`. A headless session was
then asked to report the active epic **from session context only, with tools blocked**
(`--allowedTools "NoSuchTool"`), so that reading `PROJECT.md` or `state.json` was impossible.

| Run | Directory | Tools | Result |
|---|---|---|---|
| Test | pm-initialized fixture | blocked | `canary-probe-7f3a` |
| Control | empty dir, no pm state | blocked | `NO_BRIEFING` |

**Conclusion.** With file access removed, the only path to that id was the `SessionStart` hook
injecting `hookSpecificOutput.additionalContext`. Claude Code plugin hooks therefore fire
under `claude -p`, in a directory unrelated to the plugin's own repo. The control rules out
hallucination and prompt leakage.

**Consequences for the design:**

- The adapter can drive genuine headless sessions; no manual staging of plugin artifacts is
  required for Claude Code.
- Scenarios may legitimately assert on **hook-injected behavior**, not merely on-disk state —
  e.g. "given a briefing naming epic X as active, does the agent act on X without being told?"
- The equivalent probe still must be run against Codex once pm is installable there; it is the
  first step of `codex-platform-support`, not a blocker for authoring the Claude Code baseline.

## Platform scope: CLI-bearing tools only

Support is limited to AI coding tools that ship a real CLI — a deliberate first-class-only
filter rather than chasing breadth. This is self-enforcing: the verification procedure above
begins with `--help`, which a tool without a CLI fails by definition. It also keeps the
adapter honest, since a scriptable CLI is what makes runs deterministic in invocation and free
of UI-timing fragility.

## Sandbox

`~/Documents/Repos/pm-sample` is the scratch project for probes and multi-tool experiments —
an empty, non-git directory usable as a disposable fixture target. The probe above ran there.
It is outside the pm repo, so experiments never pollute pm's own conductor state or git
history.
