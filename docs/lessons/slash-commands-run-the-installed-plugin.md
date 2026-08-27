---
lesson: slash-commands-run-the-installed-plugin
date: 2026-08-23
trigger: Developing a plugin, CLI, or tool while also using that tool in the same session — including any HOOK it installs, which fires without being invoked.
cost: `/pm:status` ran the installed 0.26.0 engine and rewrote a generated file with output predating the worktree's changes — which a broad `git add` would then commit as an apparent regression.
rule: When developing the tool itself, invoke the checkout directly (`node scripts/conductor.mjs <verb>`), never the installed slash command.
enforced_in: subagent brief template; conductor.mjs self-hosting handoff (bootstrap-limited)
detect: {"tool":"Bash","commandMatches":"(^|[;&|]\\s*)/pm:"}
tags: [tooling, generated-files, self-hosting]
---

**Cause.** Slash commands resolve to the *installed* plugin, not the checkout being edited. The two
diverge the moment you start working.

**The hook layer is worse and was found later** (#134). `hooks.json` resolves the engine through
`${CLAUDE_PLUGIN_ROOT}` — the installed plugin — so a `PostToolUse` hook fires on **every commit**
and re-renders a tracked file using an engine a full release behind the working tree. Nobody invokes
it, so nobody thinks to doubt it, and a broad `git add` then commits its output as an apparent
regression. Through one release it rewrote `PROJECT.md` on every single commit; each agent
discarded it by hand.

Same root as the reverse case: a project running instruction files four minor versions behind the
CLI that generates them.

**Fixed in the engine, not in the entry points.** `conductor.mjs` hands the whole invocation off
to `<project>/scripts/conductor.mjs` when the developer has named that checkout in
`PM_ENGINE_DELEGATION`. One handoff at startup covers all 19 entry points at once: the 4 hooks
and the 15 command docs.

**The fix's own near-miss is the more transferable lesson.** The first version keyed the handoff
off what it found on disk — `scripts/conductor.mjs` plus a `.claude-plugin/plugin.json` naming
`pm` — reasoning that no ordinary project looks like that. Both files are things the project
writes, so a directory containing exactly those two was enough to get arbitrary code executed
with the full parent environment, in every project on the machine, by four hooks that fire
without anyone invoking them, with no `/pm:init` and no user action beyond opening the folder.
The convenience fix had quietly changed what those hooks could run from *code that ships with
the plugin* to *code the project supplies*.

The rule that falls out: **when a decision authorizes execution, it may only read inputs the
untrusted side cannot write.** A manifest inside the repo is not a credential, however unlikely
the shape looks. The environment can carry one; the repo cannot. And prefer a flag that names a
path over a boolean — a boolean gets exported once in a shell profile and is then set for every
project its owner ever opens, which re-opens the hole for precisely the person most likely to
enable it.

**The rule above still stands, for two reasons.** First, bootstrap: the handoff only exists once
the *installed* plugin carries the release that added it, so while developing the release that
ships a fix, the installed engine is still the one without it. Second, the handoff is a safety
net for the hooks nobody invokes — it is not a licence to invoke `/pm:*` by hand while developing
the tool. Keep running `node scripts/conductor.mjs <verb>` from the checkout.
