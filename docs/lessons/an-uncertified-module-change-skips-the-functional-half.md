---
lesson: an-uncertified-module-change-skips-the-functional-half
date: 2026-09-25
trigger: You are about to commit a change to a module or file a functional test observes — a refusal's wording, a printed count, a message — and you expect the drift script to ask only for `certify.mjs sweeps`, or you are about to satisfy its `certify.mjs functional` demand by running it over the working tree rather than over what you staged.
cost: A handoff-refusal rewording ("2 of 1/3" → "2 task(s) outstanding (1/3 done)") in archive-gate.mjs passed its pre-commit (1,328/1,328) and landed; functional/conductor-13 still pinned the old text. It surfaced two commits later as a failed functional certify (418 s) under the shared certify lock, and needed its own follow-up commit plus a re-certify (173 s) — lock time other worktree agents were queued behind (timings taken under heavy parallel load, not a benchmark).
rule: Let the gate decide, and satisfy it over the index: stage the commit exactly, run `node scripts/test/certify.mjs functional` (it certifies a copy of the index, not your working tree), then a plain `git commit`. The functional demand now fires for any staged path in the functional subject — what the half imports, executes or names — so an observed module no longer slips through on `certify.mjs sweeps` alone. When certify's run-time observer refuses a read the derivation missed, spell that file's name in the test that reads it; never widen the subject by hand.
enforced_in: scripts/test/drift.mjs check 4 over `functionalSubject()` (scripts/test/certification.mjs), since certification-record-redesign 3.3 (762d564f, #229 closed by it) — a staged path in the observed subject demands a functional run whose manifest equals the index's; certify.mjs's run-time observer (3.2) refuses a read the derivation missed; guarded by functional/certify-index 3.5, which derives the subject over this repository's index and asserts b4ffe164's change (archive-gate.mjs, store.mjs) demands the functional half.
tags: [testing, certification, drift, wording]
---

**Cause.** The drift script demands `certify.mjs functional` only when a module listed by
`certifiedModules()` changes (conductor.mjs, constants.mjs, subcommands.mjs, worktree-hygiene.mjs,
…). archive-gate.mjs is engine source, so it triggers the SWEEPS bucket — but the sweeps do not run
functional tests. A functional test that asserts on archive-gate's refusal text is therefore
exercised by CI and by the next functional certify, never by the commit that changed the text.

**Recognise it.** The drift script prints only the `engine-source … certify.mjs sweeps` line, and
your change alters a string a user or a test reads. That combination is the gap.

**Closed by `certification-record-redesign` (0.51.0).** The gap was the trigger, not the habit: the
functional demand keyed on `certifiedModules()`, the modules that call the git gateway, while the half
observes far more — its whole import closure, the assertion files it executes, the files it names, and
the shipped roots it walks. 3.3 replaced that scan with `functionalSubject()`, the subject derived from
what the half observes, so archive-gate.mjs, the module this lesson was earned on, now demands the
functional half by itself (functional/certify-index 3.5 pins exactly that change). Over the 0.50.0 build
the rule moves the functional demand from 15 of 126 commits to 70 (design.md, Baseline). The `rg` habit
above is no longer the defence; the demand is.
