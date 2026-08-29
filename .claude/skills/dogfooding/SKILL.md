---
name: dogfooding
description: Turn practices invented while building pm into product candidates, and stop silent workarounds for pm's own friction. pm is a project-management conductor and this repo is a project it manages, so anything invented to work here is something pm's users could use. Use whenever you adopt a new practice/gate/discipline in this repo, whenever you work around friction in pm itself, whenever you hand-edit .conductor/state.json, and at the end of any epic or release. Triggers: "should this be in the product", "dogfood", "we should do this every time", "I had to work around", "there's no verb for this", "let me just edit state.json".
---

**This practice is now part of the product.** It shipped as `pm`'s own `dogfooding` skill
(gh#127), and the rule it carries is emitted into every conductor-managed repo's rules block as
the numbered required task item **"Route what the work taught you."**

**Read the canonical procedure at `skills/dogfooding/SKILL.md` in this repository** — one copy,
so this repo's practice and what users get cannot drift. This file remains only so that
`CLAUDE.md`'s reference to the `dogfooding` skill keeps resolving in a checkout where the
plugin's own skills are not loaded; it deliberately carries no procedure of its own.

The one thing that is local rather than general: friction in `pm` itself is filed against
`cfdude/pm`, either with `/pm:feedback [bug|feature] "<summary>"` or directly:

```bash
gh issue create --repo cfdude/pm --title "<summary>"
```
