---
lesson: slash-commands-run-the-installed-plugin
date: 2026-08-23
trigger: Developing a plugin, CLI, or tool while also using that tool in the same session — including any HOOK it installs, which fires without being invoked.
cost: `/pm:status` ran the installed 0.26.0 engine and rewrote a generated file with output predating the worktree's changes — which a broad `git add` would then commit as an apparent regression.
rule: When developing the tool itself, invoke the checkout directly (`node scripts/conductor.mjs <verb>`), never the installed slash command.
enforced_in: subagent brief template
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
