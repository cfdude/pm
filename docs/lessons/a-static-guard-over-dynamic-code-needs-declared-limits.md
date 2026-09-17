---
lesson: a-static-guard-over-dynamic-code-needs-declared-limits
date: 2026-09-17
trigger: You are writing a static checker that reads SOURCE — a lexer, a regex sweep, an AST pass — to prove a property holds at every site in a dynamic language, and you intend to report its result as "0 findings" without saying which shapes it cannot see.
cost: `user-text-never-forges-output` built a lexical sweep classifying every interpolation in the engine as escaped, literal, sunk or judged. It took FIVE Gate 2 rounds, four of them on that sweep alone, and every round's fix opened a new class of bypass — a judgment covering a whole function hid a raw `held.session` in `claim()` and a raw title in `supersedeAmended()`; wrappers counted as escapers whatever they wrapped; an ALL_CAPS name was trusted as literal whatever its declaration said; two reviewer mutants ran in a file importing neither wrapper, so they passed on import trust and the fix they were meant to pin could be reverted with nothing failing. Each round reported "0 findings" beforehand, and each was true only of the shapes that round could see.
rule: A static guard over a dynamic language is best-effort by construction, so ship it with the unsound shapes WRITTEN DOWN beside it (each verified absent today, with the command that checked) and with a behavioural backstop that exercises the real product. Report its result as what it lexes, never as the property it was built for — and when a review finds a bypass, add it to the declared limits rather than only patching that shape.
enforced_in: the KNOWN LIMITS OF THE LEXICAL SWEEP block at the top of `scripts/test/output-interpolations.mjs`, listed shape by shape with the rg that shows each absent from the engine; the backstop is the runtime poison sweep (section 7 of `scripts/test/output-text-integrity.test.mjs`), which runs a poisoned value through every registry-derived input and every surface, plus the in-suite reviewer mutants of `output-interpolations.test.mjs`.
tags: [verification, static-analysis, testing, sweeps, review]
---

**Cause.** A lexer is not a binder, and source in a dynamic language can always rename, wrap,
destructure or reassign the thing the lexer keys on. Each Gate 2 round found one such shape, each
fix was correct, and each left the same false impression as the last: that a clean run meant the
property held everywhere. Nothing in the tool said what it could not see, so "0 findings" kept
reading as "no raw value reaches an output", which was never what it measured.

`a-one-off-sweep-certifies-only-the-day-it-ran` covers the other half of this — a sweep is a test,
so put it in the suite. This lesson is about the day it runs: even a permanent, in-suite sweep
over source is sound only for the shapes it lexes, and the review rounds spent discovering that one
at a time are the cost of not declaring it up front.

**The step.** Before the first review round, write the limits section: every shape the checker
cannot classify soundly, each with the command showing it is absent from the code today, and one
sentence naming the runtime check that would catch it anyway. Then a reviewer's bypass is an
addition to a list that already exists, not a demonstration that the guard was oversold — and the
backstop, not the lexer, is what the guarantee rests on.
