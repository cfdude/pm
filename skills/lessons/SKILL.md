---
name: lessons
description: Keep a repository's hard-won PROCESS knowledge where it fires on the situation instead of on recall — consult a lesson before a risky operation, capture one the moment it is earned, and let the PreToolUse advisor surface a known lesson before the mistake. Use when about to run parallel agents in one checkout, commit while something else may be staging, hand-edit a file a tool also generates, measure a suite while agents write, invoke a slash command for the tool you are developing, or decide what to fix from a review — and the moment you undo work, kill and restart, hit the same problem twice, or say "that was my error". Triggers "lessons learned", "have we hit this before", "what went wrong last time", "post-mortem", "we should write this down", "that cost us", "I did that wrong".
---

# Lessons — three modes, and only one of them works without recall

A project accumulates process knowledge — the thing that cost four hours last month. It lands in
a doc, a `CLAUDE.md` paragraph, or nowhere. Then it is not consulted, because **consulting it
requires already suspecting there is something to know.**

| Mode | When | Initiated by | Depends on |
|---|---|---|---|
| **Read** | Before a risky operation | You, proactively | Remembering to look |
| **Write** | After a mistake bites | You, reactively | Noticing it was a lesson |
| **Advise** | *Before the error, lesson already known* | **A hook** | Nothing |

Read and Write are worth having and are **not enough** — both need recall. Measured in pm's own
repository: a rule carried by a required task reached **14/14** adoption in the audited corpus;
the same rule as a prose bullet reached **3/15**. **Advise is the only mode that fires on the
situation.**

## What pm owns, and what it does not

pm ships the **mechanism**: the directory shape, the frontmatter contract, and the `lesson-advice`
PreToolUse hook that matches your declared matchers. **pm never ships lessons, and never decides
what counts as one.** The corpus is yours — it is the record of what YOUR project learned, and an
engine that guessed at it would be inventing history.

The advisor is **advisory only**. It injects context and always exits 0; it cannot block a tool
call. That is deliberate — pm has exactly one blocking hook (the reconcile gate guard), and a
second one nobody agreed to would be a gate wearing a hint's clothing.

## The corpus shape

```
docs/lessons/
  README.md                         index — regenerate from the frontmatter, never by hand-typing
  <mechanism-slug>.md               one file per lesson
```

Name each file for the **mechanism**, never the date, so `rg` finds it by topic. The date lives
in frontmatter.

```yaml
---
lesson: Parallel agents in one checkout corrupt each other's commits
date: 2026-08-14
trigger: About to run two or more subagents that will each commit to the same git checkout.
cost: ~1M tokens, 4+ hours, one commit rewritten out of existence.
rule: Parallel subagents get isolated worktrees or they run serially.
enforced_in: skills/conductor (dispatch section), scripts/wt-preflight.sh
tags: git, agents, worktrees
detect: {"tool":"Bash","commandMatches":"^git commit","commandLacks":"--\\s"}
---
```

- **`trigger`** is the retrieval key. Write it as the situation *before* the mistake, not as a
  topic — the moment a lesson is worth reading is the moment before, not after.
- **`cost`** must be concrete. Vague cost is why rules get ignored, and cost detail evaporates
  fast: by the closeout you remember "that was messy" instead of the number.
- **`enforced_in`** names where the rule actually binds — a skill, a gate, a subagent brief. A
  lesson whose `enforced_in` says "habit — no mechanism" is honest, and it is roughly 20%
  effective. Prefer a skill, a task or a gate, and say so when you cannot have one.
- **`detect`** is OPTIONAL and is what the advisor fires on. See below.

## `detect:` — the matcher, and the constraint that matters more than the feature

A JSON object on one line. Every key present must match; an absent key is not checked.

| Key | Matches |
|---|---|
| `tool` | the tool name exactly (`Bash`, `Edit`, `Write`, `NotebookEdit`) |
| `pathEndsWith` | a suffix of `tool_input.file_path` |
| `commandMatches` | a regex against the **first line** of `tool_input.command` |
| `commandLacks` | suppresses the hit when this regex matches — the "safe form" escape |

**PRECISION, NOT COVERAGE.** A hook firing on false positives gets ignored; a warning wrong 7
times in 8 trains people to ignore the one time it is right. So:

- **A lesson that cannot be matched with near-certainty carries NO `detect:` and stays
  retrieval-only.** That is the honest outcome, not a gap to close by loosening a regex. In pm's
  own corpus fewer than a third of lessons carry a matcher, on purpose.
- **Only the command's FIRST LINE is matched.** A heredoc body, an `echo`, or a file being
  written can contain any phrase — observed live: writing a lesson whose own text named a git
  command fired that lesson's own matcher, twice. The command being RUN is line one; everything
  after it is data. Losing recall on chained commands is the deliberate trade.
- Adding a matcher is a **frontmatter edit, not a code change**, which keeps the barrier low
  without putting pattern-writing in the hot path.

A lesson with an absent, malformed or non-object `detect:` is skipped **for itself alone** — the
rest of the corpus still fires.

## Consulting (the common case)

1. **Read `docs/lessons/README.md`.** Its table is the only thing you read in full.
2. **Match on `trigger`, not on topic.**
3. **Open a lesson only when its trigger matches.** The frontmatter carries everything needed to
   decide; the body carries cause and detail.
4. `rg -l "tags:.*<topic>" docs/lessons` narrows without opening anything.

**Do not read the whole directory.** It grows, and reading it all defeats the structure.

Consult without being asked before: launching two or more agents that write to one checkout;
committing while something else may be staging; hand-editing a file a tool also generates;
acting on a suite result while background writes are in flight; invoking a slash command for the
very tool you are developing; deciding what to fix from a review's findings; writing a
verification that names a count drawn from live data.

## Capturing — the half that fails

**Retrieval is the easy half.** Nobody notices the moment a lesson is earned; they notice it two
sessions later when it happens again. Capture when any of these fires — they are mechanical, and
you do not have to feel insightful:

| Signal | Why it counts |
|---|---|
| You **undid** something — split a commit, restored a file, reset, reverted | Recovery work is the cost, measurable right now |
| You **killed or restarted** work in flight | Something about the setup was wrong, not the work |
| The **same problem twice** in one session, or once here and once in a subagent's report | Recurrence is the bar; one instance may be luck |
| You said **"that was my error"**, "I should have", "next time" about *process* | You already formed the rule; write it down |
| A subagent reports a **coordination or environment failure** rather than a code defect | It will report the same one next week |
| **Tokens or hours spent with nothing shipped** | The clearest cost, and the easiest to forget |
| A **verification passed that should have failed** | The most expensive recurring class there is |

**The bar:** repeating the mistake would cost real time, tokens or recovery work — not "something
surprising happened".

**Write it AT the moment, not at the end.** Same discipline as incremental `--notify` under epic
autonomy, and the same failure mode: what is recorded only in prose at the end goes missing.

**Check for an existing lesson first** (`rg -l "tags:.*<topic>" docs/lessons`). If one covers it,
**update its `cost` with the new occurrence and strengthen `enforced_in`** — a second instance is
evidence the current enforcement is too weak, which is more useful than a second file. Then
regenerate `README.md`'s table from the frontmatter, and tell the user in one line what you
captured, with the cost. They should not have to ask whether it was recorded.

**Not a lesson:** a product defect (that is an issue and an epic), a one-off judgment call, a
domain fact, or anything a skill already enforces — that gets *updated*, not logged.

## The lane split — and where it crosses

A finding about **what the tool should do** is an issue and an epic. A finding about **how we
should work** is a lesson. Different lanes, different artifacts, both valuable.

A lesson that turns out to be a **product** gap — the tool could have prevented this — crosses
lanes. File it, register the epic, and note the crossing in the lesson. The `dogfooding` skill
owns that direction.

A lesson that recurs across sessions has outgrown the directory: promote its rule into the thing
that enforces it, and leave the pointer behind.
