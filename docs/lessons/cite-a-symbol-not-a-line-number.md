---
title: Evidence cited as a line number is wrong within days, and a disposition citing one is wrong forever
trigger: You are recording evidence for a finding — in an epic's notes, a disposition reason, a
  grooming verdict, a lesson's `enforced_in`, or a review comment — and you are about to write
  `file.mjs:123`.
cost: A grooming pass on 2026-09-07/08 recorded its evidence as line numbers. Within two days,
  three of the citations checked were wrong — `README.md:207-208` (actually 208-209),
  `SKILL.md:328` (now `:849`, having passed through `:800`), `subcommands.mjs:68-85` (actually
  69-90). Two independent agents each burned a read discovering it. The worst one is unfixable:
  the same wrong README citation is frozen inside an archived epic's DISPOSITION REASON, which is
  a permanent record and is now permanently wrong.
rule: Cite a symbol, a heading or a quoted phrase — never `file.ext:123`. A line number rots within
  days, and one frozen in a disposition reason or an archived epic is wrong permanently.
enforced_in: Nothing mechanical — a line number is well-formed text and no test can tell a fresh
  one from a rotted one. This is a habit, which is why it is a lesson.
detect: --(reason|notes|description) "[^"]*\b[a-z0-9_.-]+\.(mjs|md|json|py|ts):[0-9]+
---

## What happened

Grooming and review both produce claims that need evidence, and a line number feels like the most
precise evidence available. It is the least durable. Any edit above the cited line moves it, and
the citation does not merely go stale — it silently points at *different, plausible-looking code*,
which is worse than pointing at nothing.

Two days was enough for three of a handful of citations to rot. One of them rotted twice.

## Why a disposition is the severe case

An epic's notes can be corrected. A **disposition reason cannot** — it is the terminal record of
what happened to that work, written once, and this project's whole architecture rests on it being
trustworthy. A disposition that cites `README.md:207` is a permanent assertion about a file that no
longer has that content at that line, and nothing will ever flag it.

## The rule

**Cite something that survives an edit above it.** In order of preference:

1. **A symbol name** — `isConductorOwnFiles`, `CONDUCTOR_OWN_FILES`, `rulesTarget()`. Findable with
   `rg`, and it moves with the code.
2. **A distinctive string** the reader can `rg` or `git log -S` for — the exact wording of a
   refusal message, a constant's value.
3. **A commit sha**, for "this shipped" claims. Immutable by construction.
4. **A file path alone**, when the whole file is the point.

A line number is fine as a *convenience* alongside one of those — `state.mjs:208, in stampTouched()`
— because the symbol is what the reader falls back to when the number has moved. It is never
adequate on its own.

## The tell

If your evidence would be unverifiable by someone reading it next month, it is not evidence, it is
a note to yourself. Related: `[[hardcoded-live-data-claims-rot]]` is the same decay one level up —
a transcribed count instead of a transcribed position.
