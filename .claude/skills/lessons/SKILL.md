---
name: lessons
description: Consult the development-process lessons in docs/lessons/ before a risky operation, AND recognise when a new lesson has just been earned so it gets written while the cost is still measurable. Each lesson carries a `trigger` in YAML frontmatter, so matching is cheap and reading is targeted. CONSULT before running parallel subagents, committing while another process may be staging, hand-editing a file a tool also generates, measuring a suite while agents write, invoking a slash command for the tool you are developing, deciding what to fix from a review, or writing a verification that names a live count. CAPTURE the moment you recover from a mistake, redo work, kill and restart something, hit the same problem twice, say "that was my error" or "I should have", or a subagent reports a coordination failure. Triggers: "lessons learned", "have we hit this before", "what went wrong last time", "post-mortem", "we should write this down", "that cost us", "let me undo that", "I did that wrong".
---

**This practice is now part of the product.** It shipped as `pm`'s own `lessons` skill (gh#132),
backed by the `lesson-advice` engine verb — a `PreToolUse` advisor registered in
`hooks/hooks.json` that surfaces a lesson **before** the mistake, matching whatever `detect:`
matchers this repo's lessons declare. Advisory only: it never blocks.

**Read the canonical procedure at `skills/lessons/SKILL.md` in this repository** — one copy, so
this repo's practice and what users get cannot drift. This file remains only so that `CLAUDE.md`'s
reference to the `lessons` skill keeps resolving in a checkout where the plugin's own skills are
not loaded; it deliberately carries no procedure of its own.

`docs/lessons/` here is this repository's own corpus, not part of what pm ships. pm owns the
mechanism; the lessons are ours.
