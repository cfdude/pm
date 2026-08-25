# Lessons learned — development process

**This lane is separate from the product backlog on purpose.**

A finding about *what `pm` should do differently* becomes a GitHub issue and a conductor epic —
that loop works, and this session filed 23 of them (#109–#131). A finding about *how we should
work* has had nowhere to go, so it has lived in conversation transcripts and died there. This
directory is that second lane.

## What belongs here

A lesson qualifies when **repeating the mistake would cost real time, tokens, or recovery work.**
That is the bar. Not "something surprising happened" — *"we spent four hours and a million tokens
recovering, and the same setup would do it again."*

Not here: product defects (issue + epic), one-off judgment calls, or anything already covered by
a skill or `CLAUDE.md` — those get *updated*, not re-logged.

## The rule that makes this worth keeping

**Every lesson names where its rule now lives.** A lessons file nobody reads is a data graveyard —
the same objection that made the activity log (#111) conditional on shipping its reader. So each
entry ends with a **Rule** line pointing at the durable home: a skill, a `CLAUDE.md` section, a
subagent brief, or a filed issue.

And per this repo's own measurement — a rule carried by a **required task** reached **14/14**
adoption in the audited corpus; the same rule as a **prose bullet** reached **3/15** — a lesson
whose rule is only prose is roughly 20% effective. Prefer a skill, a brief, or a gate.

## Format

One file per session or incident cluster: `YYYY-MM-DD-<slug>.md`. Inside, one section per lesson:

```
### <What went wrong, in one line>
**Cost:** <time, tokens, recovery work — be specific, this is the whole argument>
**Cause:** <the mechanism, not the blame>
**Rule:** <the rule, and WHERE IT NOW LIVES>
```

Cost is not decoration. It is the reason the next person follows the rule instead of rediscovering
why it exists.

## Promotion

A lesson that recurs across sessions has outgrown this directory — promote it into the thing that
enforces it, and leave a pointer here. A lesson that turns out to be a *product* gap (pm could have
prevented this) crosses lanes: file it as an issue and note the crossing.
