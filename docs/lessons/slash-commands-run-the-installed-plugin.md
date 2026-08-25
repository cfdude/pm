---
lesson: slash-commands-run-the-installed-plugin
date: 2026-08-23
trigger: Developing a plugin, CLI, or tool while also using that tool inside the same session.
cost: `/pm:status` ran the installed 0.26.0 engine and rewrote a generated file with output predating the worktree's changes — which a broad `git add` would then commit as an apparent regression.
rule: When developing the tool itself, invoke the checkout directly (`node scripts/conductor.mjs <verb>`), never the installed slash command.
enforced_in: subagent brief template
detect: {"tool":"Bash","commandMatches":"(^|[^a-z])/pm:|conductor\\.mjs.*--plugin|claude .*\\bplugin\\b"}
tags: [tooling, generated-files, self-hosting]
---

**Cause.** Slash commands resolve to the *installed* plugin, not the checkout being edited. The two
diverge the moment you start working.

Same root as the reverse case: a project running instruction files four minor versions behind the
CLI that generates them.
