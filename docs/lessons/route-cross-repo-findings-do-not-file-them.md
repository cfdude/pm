---
lesson: route-cross-repo-findings-do-not-file-them
date: 2026-08-23
trigger: An audit or sweep produces findings about a codebase you do not own.
cost: NEGATIVE — this one saved. Of 13 findings routed to owning sessions, 2 were refuted and 2 were confirmed with the wrong severity. Filing directly would have put four bad issues in other people's trackers.
rule: Route a cross-repo finding to the session that owns the code. Do not file it yourself.
enforced_in: .claude/skills/dogfooding/SKILL.md
tags: [audit, cross-session, accuracy]
---

**Cause.** A read-only cross-repo audit cannot query a live database, trace a caller, or remember
that a claim in a design doc was retracted three paragraphs later. All three happened.

Every one of the five method flaws that audit exposed came from an owning session, not from the audit
reviewing itself. An audit does not find its own blind spots.
