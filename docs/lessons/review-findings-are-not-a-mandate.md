---
lesson: review-findings-are-not-a-mandate
date: 2026-08-23
trigger: A review returns findings and you are deciding what to fix before proceeding.
cost: Four cross-spec review rounds where three would have done. Each round found real defects and generated the next round's work.
rule: Split findings into BLOCKS (implementing this ships a defect) and POLISH (correct and implementable). Fix BLOCKS, decline most POLISH, say why. A contradiction is never POLISH.
enforced_in: .claude/skills/cross-spec-review/SKILL.md
tags: [review, stopping-condition, cost]
---

**Cause.** No stopping condition. "No findings" is not one — a review of a large document always
returns something, so treating every finding as work iterates forever.

The trap that keeps it going: narrowing a requirement to fix a contradiction can quietly remove every
case where it could fail, which the *next* round then correctly reports.

Stopping condition: an empty BLOCKS list with a falsifiability table drawn from live data.
