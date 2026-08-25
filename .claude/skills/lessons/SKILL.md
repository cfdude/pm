---
name: lessons
description: Consult the development-process lessons in docs/lessons/ BEFORE an operation that has already cost this project time, tokens, or recovery work — and add a lesson after one bites. Each lesson carries a `trigger` in YAML frontmatter, so matching is cheap and reading is targeted. Use BEFORE running parallel subagents, committing while another process may be staging, hand-editing a file a tool also generates, measuring a suite while agents write, invoking a slash command for the tool you are developing, deciding what to fix from a review, or writing a verification that names a live count. Also whenever a mistake costs real recovery work. Triggers: "lessons learned", "have we hit this before", "what went wrong last time", "before I run these in parallel", "is this safe to commit", "post-mortem", "we should write this down".
---

This is repo-maintenance tooling for developing `pm` itself. Its subject is **how we work**, which is
a different lane from **what the product should do** — a product gap becomes an issue and an epic;
a process failure becomes a lesson here.

## Consulting (the common case)

1. **Read `docs/lessons/README.md`.** Its table is generated from every lesson's frontmatter:
   lesson · trigger · rule. That table is the only thing you read in full.
2. **Match on `trigger`, not on topic.** Triggers are written as *"about to do X"*, because the
   moment a lesson is worth reading is the moment before the mistake, not after.
3. **Open a lesson only when its trigger matches.** The body carries cause and detail; the
   frontmatter carries everything needed to decide.
4. `rg -l "tags:.*<topic>" docs/lessons` narrows without opening anything.

**Do not read the whole directory.** It grows, and reading it all defeats the structure — that is
why the frontmatter exists.

## When to consult without being asked

Before **any** of these, check for a matching trigger first:

- Launching two or more subagents that will write to the same checkout.
- Committing while a subagent, watcher, or script may be staging.
- Hand-editing a file a tool also generates (`CLAUDE.md`, `PROJECT.md`, any managed region).
- Acting on a red — or green — suite while background writes are in flight.
- Invoking a slash command for the very tool you are developing.
- Deciding what to fix from a review's findings.
- Writing a verification that names a count drawn from live data.

Every one of those has already cost this project measurable time or tokens. The costs are in each
lesson's frontmatter, and they are the argument.

## Adding a lesson

**The bar: repeating the mistake would cost real time, tokens, or recovery work.** Not "something
surprising happened" — *"we spent four hours recovering, and the same setup would do it again."*

1. One file per lesson, `docs/lessons/<mechanism-slug>.md`. Name it for the **mechanism**, never the
   date, so `rg` finds it by topic. The date lives in frontmatter.
2. Frontmatter: `lesson`, `date`, `trigger`, `cost`, `rule`, `enforced_in`, `tags`.
   - **`trigger`** is the retrieval key. Write it as the situation *before* the mistake.
   - **`cost`** must be concrete. Vague cost is why rules get ignored.
   - **`enforced_in`** names where the rule actually binds — a skill, a subagent brief, a gate.
3. Body: cause and enough detail to recognise the situation. Short. The frontmatter is what gets read.
4. **Regenerate `README.md`'s two tables** from the frontmatter so the index cannot drift from the files.

## The rule that keeps this from becoming a graveyard

**Every lesson names where its rule is enforced.** A log nobody reads costs maintenance and returns
nothing — the same objection that made the activity log (#111) conditional on shipping its reader.
This skill *is* that reader; `enforced_in` is what makes each lesson binding rather than merely
recorded.

And this repo measured the difference: a rule carried by a **required task** reached **14/14**
adoption in the audited corpus; the same rule as a **prose bullet** reached **3/15**. So a lesson
whose `enforced_in` says "habit — no mechanism" is honest, but it is roughly 20% effective. Prefer a
skill, a brief, or a gate, and say so when you cannot have one.

## Lane-crossing

A lesson that turns out to be a **product** gap — the tool could have prevented this — crosses into
the other lane. File it as an issue, register the epic, and note the crossing in the lesson. The
`dogfooding` skill owns that direction.

A lesson that recurs across sessions has outgrown the directory: promote its rule into the thing
that enforces it, and leave the pointer behind.
