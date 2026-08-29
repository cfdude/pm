---
name: dogfooding
description: Route what the work taught you instead of leaving it in the transcript — a practice you invented becomes a candidate improvement with its evidence attached, and a workaround you invented for your tooling's friction becomes a filed bug. Use whenever you adopt a new practice, gate, discipline or checklist, whenever you route around friction in a tool rather than reporting it, whenever you hand-edit a file a tool owns because no verb exists for it, and at the end of any epic or release. Triggers "should this be in the product", "dogfood", "we should do this every time", "I had to work around", "there's no verb for this", "let me just edit that file by hand".
---

# Dogfooding — the two directions nobody travels

Work invents things. A practice that made a review catch what it kept missing; a workaround for a
tool that would not do the obvious thing. Both are discovered at the moment of maximum evidence
and both are, by default, lost — they stay in one session's transcript, in one repository, in one
person's head.

This skill is two triggers pointing opposite ways. **Neither of them fires on its own**, which is
why it is a skill and not a paragraph.

## Direction 1 — you adopted a practice → register it as a candidate improvement

Whenever a new practice, gate, discipline or checklist gets adopted:

1. **Encode it where it binds.** A skill if it should fire on a trigger; a standing constraint
   document only if it is a constraint rather than a procedure. **Prefer the skill** — a skill is
   invoked, a paragraph is read past.
2. **Register it** as an epic in this repo's backlog (`/pm:epic add …`), and file it with the
   tracker if the practice belongs to a product other people use.
3. **Put the evidence in the record** — what went wrong that made the practice necessary, with
   numbers. That evidence is the strongest part of the eventual spec and it is unrecoverable
   later. A practice registered without its evidence reads as a preference.

## Direction 2 — you worked around friction → file it as a bug

**This is the direction that gets missed**, because a workaround produces working output and
nothing looks broken. The failure is silent by construction.

Fire on any of these:

- You **hand-edited a file a tool owns** because no verb existed for the change.
- A command the tool **emitted** did not run as written.
- You invented a convention the tool should have supplied — an id format, a slug, a link type.
- You did something **twice by hand** that the tool could have done once.
- You caught yourself thinking *"I'll just…"* about a tool that is supposed to do it for you.

For friction in `pm` itself, that is what `/pm:feedback [bug|feature] "<summary>"` is for. For
friction in anything else, file it wherever that thing is tracked — the point is that it leaves
the session.

**A papercut worked around silently is one every other user is also working around.** Measured in
pm's own repository: two independent sessions hit the same broken recipe on one afternoon, each
invented a workaround, neither reported it until asked — while the warning about exactly that was
being cited in the same session.

## The design constraint on anything you file

Measured in one audited corpus, same config file, same author, same period:

| Rule form | Adoption in later changes |
|---|---|
| Carried by a **required task** | **14 / 14** |
| The same rule as a **prose bullet** | **3 / 15** |

**A prose instruction is roughly 20% effective.** So when you register a practice, say how the
rule gets *carried* — a task, a gate, a mechanical check — not merely what the rule says. A
feature that ships as advice will be ignored four times in five, and the failure will be
invisible.

## What NOT to file

- Something that only makes sense given this repository's own layout or history.
- A one-off judgment call with no rule behind it.
- Anything already covered by an open item — **check first**, and add a comment carrying the new
  evidence instead. A second issue for one problem splits the evidence, which is worse than not
  filing.

## The other lane

A finding about **how we should work** is not a product candidate — it is a lesson, and it goes
in `docs/lessons/` where the `lessons` skill and the `lesson-advice` hook can surface it before
the next mistake. Same moment of recognition, different destination. Getting this wrong in either
direction buries the finding: a process lesson filed as a feature request never gets built, and a
product gap written down as a lesson never gets fixed.

**The test for this skill:** if a practice adopted here does not end up registered somewhere a
later session will find it, the skill did not work.
