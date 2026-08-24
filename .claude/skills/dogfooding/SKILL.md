---
name: dogfooding
description: Turn practices invented while building pm into product candidates, and stop silent workarounds for pm's own friction. pm is a project-management conductor and this repo is a project it manages, so anything invented to work here is something pm's users could use. Use whenever you adopt a new practice/gate/discipline in this repo, whenever you work around friction in pm itself, whenever you hand-edit .conductor/state.json, and at the end of any epic or release. Triggers: "should this be in the product", "dogfood", "we should do this every time", "I had to work around", "there's no verb for this", "let me just edit state.json".
---

This is repo-maintenance tooling for developing `pm` itself. The rule it encodes is filed as a
product candidate at **cfdude/pm#127**.

## The asymmetry

`pm` is a project-management conductor. This repo is a project managed by it. So the set of
practices invented to build `pm` and the set `pm`'s users need are **the same set** — but only
one direction gets traveled. Practices get invented here constantly and stay here.

Measured across one session:

| Invented here | Filed as a product candidate |
|---|---|
| Cross-spec review before apply | only after the maintainer asked — #126 |
| Watch each guard fail under its own mutation before accepting it | never filed |
| Route cross-repo findings to the session that owns the code | never filed — it caught 2 false findings in 13 |
| Enumerate every call site of a rule before calling it done | #115, only after 5 defects shipped |
| Backlog-wide triage with deliberate exclusion | #125, only after the maintainer named it |

Four of five were invented, used successfully, and never offered to anyone else.

## Two triggers, opposite directions

### 1. You adopted a practice → file it as a feature

Whenever a new practice, gate, discipline, or checklist gets adopted here:

1. Encode it where it binds — a skill if it should fire on a trigger, `CLAUDE.md` only if it is
   a standing constraint rather than a procedure. **Prefer the skill.** A skill is invoked; a
   `CLAUDE.md` paragraph is read past.
2. **File it** (`/pm:feedback` or `gh issue create --repo cfdude/pm`) and register the epic.
3. **Put the evidence in the issue** — what went wrong that made the practice necessary, with
   numbers. That evidence is the strongest part of the eventual spec, and it is unrecoverable
   later.

### 2. You worked around friction → file it as a bug

**This is the direction that gets missed**, because a workaround produces working output and
nothing looks broken.

Fire on any of these:
- You hand-edited `.conductor/state.json` because no verb existed.
- A command `pm` **emitted** did not run as written.
- You invented a convention the tool should have supplied (an id format, a slug, a link type).
- You did something twice manually that the tool could have done once.
- You caught yourself thinking *"I'll just…"* about a tool that is supposed to do it for you.

**A papercut worked around silently here is one every user is also working around.** Two
independent sessions hit the same broken `add-epic` recipe on one afternoon; each invented a
workaround; neither reported it until asked. `CLAUDE.md` already warned about exactly this, using
a `state.json` hand-edit that had recurred across sessions — and it happened again while that
warning was being cited.

## The design constraint on anything you file

Measured in this repo's own delivery audit, same config file, same author, same period:

| Rule form | Adoption in later changes |
|---|---|
| Carried by a **required task** | **14 / 14** |
| The same rule as a **prose bullet** | **3 / 15** |

**A prose instruction is roughly 20% effective.** So when you file a practice as a feature, the
issue should say how the rule gets *carried* — a task, a gate, a mechanical check — not merely
what the rule says. A feature request that ships as advice will be ignored four times in five,
and the failure will be invisible.

Same test applies to this skill: if a practice adopted here does not end up in an issue, this
skill did not work.

## What NOT to file

- Something that only makes sense given this repo's own layout or history.
- A one-off judgment call with no rule behind it.
- Anything already covered by an open issue — check first (`gh issue list --repo cfdude/pm`),
  and add a comment with the new evidence instead. A second issue for one problem splits the
  evidence, which is worse than not filing.
