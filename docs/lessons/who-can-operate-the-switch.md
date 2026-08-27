---
lesson: who-can-operate-the-switch
date: 2026-08-27
trigger: A review says a change is unsafe and you are about to gate it, OR you are adding a control, flag, or opt-in that something outside the tool's reach has to set.
cost: A full build-review-rework cycle across two agent runs, ~350k tokens, plus a security-critical code path added to a shipped engine that only its own developer could ever enable.
rule: Before gating, ask who can operate the switch and how many people benefit. A plugin cannot set an env var, a shell profile, or a global config — so a gate living there is a gate the product can never turn on. When the beneficiary population is the developer, the fix belongs in the repo, not in the shipped artifact.
enforced_in: habit — the three questions below; no mechanism
tags: [security, boundaries, review, scope]
---

**Cause.** A review finds a real hole and proposes a gate. The gate is sound in isolation, so it
gets built. Nobody asks the two questions that decide whether the *feature* should exist:

1. **Who can operate the switch?** A plugin's reach ends at the project it is invoked in. It
   cannot write your `~/.config/zsh`, your env, or your global config. A control that lives in any
   of those can be set by a human, on one machine, by hand — never by the product, for anyone.
2. **Who benefits?** Count them. If the answer is "the person developing this tool", the change is
   developer tooling and belongs in that repo's own configuration, not in the artifact every user
   installs.

A third question follows from the first two, and it is the one most often skipped: **is "remove
it" on the table?** A finding says a change is *unsafe*. It does not say the change is *worth
making*. Gating is one response; deleting is another, and it is the cheaper one whenever the
beneficiary population is one person.

**Worked example.** pm's hooks invoke `${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs` — the
INSTALLED plugin. Developing pm therefore ran an engine a release behind the working tree, which
rewrote a tracked file with stale output on every commit. Real pain, a whole release of it.

The fix made the engine hand off to the checkout's engine. A fresh-context review then proved —
by running it — that any directory containing `.claude-plugin/plugin.json` with `{"name":"pm"}`
and a `scripts/conductor.mjs` got code execution on session start. Real hole; the manifest check
was a file the untrusted side writes.

The rework gated it behind `PM_ENGINE_DELEGATION=<absolute path>`, matched by realpath. Sound.
Also, as the maintainer pointed out immediately: **the plugin can never set that variable.** Only
a human editing a shell profile can. So every user's engine gained a security-critical code path
evaluated on every invocation, for a feature exactly one person on earth could enable.

**What should have happened.** The project owns `.claude/settings.json`. Repointing
`CLAUDE_PLUGIN_ROOT` there — project-scoped, checked into the repo, no shipped code, no new
surface for anyone — is the shape to test *before* building anything into the engine.

**What this is NOT.** It is not "security findings are theater." The vulnerability was real and
reproduced twice, and the gate does protect against it. The error was upstream of the gate: a
convenience feature was allowed into the shipped artifact without anyone counting its users. Say
that distinction out loud when pushing back, or the pushback reads as dismissing the finding.

**The tell.** You are writing documentation that tells a user to export something, edit a dotfile,
or change a global config in order to use a feature the product ships. That instruction is the
product admitting it cannot deliver the feature itself. See [[review-findings-are-not-a-mandate]] —
same family: a finding is an input to a decision, not the decision.
