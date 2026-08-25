---
lesson: editing-inside-a-generated-block
date: 2026-08-23
trigger: About to hand-edit a file that a tool also generates — CLAUDE.md, AGENTS.md, PROJECT.md, any managed region.
cost: Two hand-written CLAUDE.md sections (~30 lines) silently deleted by the next regeneration. Noticed only because an unrelated diff review showed 28 deletions.
rule: Hand-written content goes BELOW the END marker, never inside the managed block.
enforced_in: subagent brief template; product gap noted for pm
tags: [generated-files, silent-loss]
---

**Cause.** The sections were placed after `Current mode: **standard**`, which sits *inside* the
region bounded by `<!-- BEGIN pm-conductor rules -->` / `<!-- END pm-conductor rules -->`. The engine
rewrites that region wholesale. Nothing warns you; the content simply stops existing.

Worth noting as a product observation too: a tool that invites edits to a file it regenerates, and
marks the danger zone only with an HTML comment, will lose someone's work eventually.
