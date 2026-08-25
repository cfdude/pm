---
name: lessons
description: Consult the development-process lessons in docs/lessons/ before a risky operation, AND recognise when a new lesson has just been earned so it gets written while the cost is still measurable. Each lesson carries a `trigger` in YAML frontmatter, so matching is cheap and reading is targeted. CONSULT before running parallel subagents, committing while another process may be staging, hand-editing a file a tool also generates, measuring a suite while agents write, invoking a slash command for the tool you are developing, deciding what to fix from a review, or writing a verification that names a live count. CAPTURE the moment you recover from a mistake, redo work, kill and restart something, hit the same problem twice, say "that was my error" or "I should have", or a subagent reports a coordination failure. Triggers: "lessons learned", "have we hit this before", "what went wrong last time", "post-mortem", "we should write this down", "that cost us", "let me undo that", "I did that wrong".
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

## Recognising a lesson — do not wait to be told

**Retrieval is the easy half. This is the half that fails**, because nobody notices the moment a
lesson is earned — they notice it two sessions later when it happens again.

**Capture when any of these fires. They are mechanical; you do not have to feel insightful.**

| Signal | Why it counts |
|---|---|
| You **undid** something — split a commit, restored a file, reset, reverted | Recovery work is the cost, and it is measurable right now |
| You **killed or restarted** work in flight | Something about the setup was wrong, not the work |
| The **same problem twice** in one session, or once here and once reported by a subagent | Recurrence is the whole bar; one instance may be luck |
| You said **"that was my error"**, "I should have", "next time" about *process* | You already formed the rule; write it down |
| A subagent reports a **coordination or environment failure** rather than a code defect | It will report the same one again next week |
| **Tokens or hours spent with nothing shipped** | The clearest possible cost, and the easiest to forget |
| A **verification passed that should have failed**, or a green signal turned out meaningless | This project's most expensive recurring class |

**Not a lesson:** a product defect (issue + epic), a one-off judgment call, a domain fact, or
anything a skill already enforces — that gets *updated*, not logged.

### Write it AT the moment, not at the end

The `cost` field is the entire argument for following the rule, and cost detail evaporates fast —
by the closeout you remember "that was messy" instead of *"~1M tokens, 4+ hours, one commit rewritten
out of existence."* Vague cost is why rules get ignored.

This is the same discipline as incremental `--notify` under epic autonomy, and the same failure as
#119: a deferral recorded only in prose at the end went missing in 3 of 3 audited repos.

### Before writing, check for an existing lesson

`rg -l "tags:.*<topic>" docs/lessons`. If one already covers it, **update its `cost` with the new
occurrence and strengthen `enforced_in`** — a second instance is evidence the current enforcement is
too weak, which is more useful than a second file. Splitting one problem across two lessons splits
the evidence, exactly as it does for issues.

### Then say so

Tell the user what you captured in one line, with the cost. They should not have to ask whether it
was recorded — and they should not have to be the one who noticed.

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
