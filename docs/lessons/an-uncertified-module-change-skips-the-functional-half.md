---
lesson: an-uncertified-module-change-skips-the-functional-half
date: 2026-09-25
trigger: You are about to commit a change to an engine module that is NOT in `certifiedModules()` — a refusal's wording, a printed count, a message — and the drift script asks only for `certify.mjs sweeps`, so the functional half will not run before the commit.
cost: A handoff-refusal rewording ("2 of 1/3" → "2 task(s) outstanding (1/3 done)") in archive-gate.mjs passed its pre-commit (1,328/1,328) and landed; functional/conductor-13 still pinned the old text. It surfaced two commits later as a failed functional certify (418 s) under the shared certify lock, and needed its own follow-up commit plus a re-certify (173 s) — lock time other worktree agents were queued behind (timings taken under heavy parallel load, not a benchmark).
rule: Before committing any change to text an uncertified module prints, `rg` the functional half (scripts/test/functional/) for the old wording and run every file it hits. The per-commit gate runs the assertion half and the sweeps; it runs the functional half only for a certified module, so a functional test that pins an uncertified module's output is checked by nothing until the next functional certify.
enforced_in: habit — no mechanism. The drift script's freshness check keys on certifiedModules(); widening it to every module a functional test observes is the product fix, filed as #229.
tags: [testing, certification, drift, wording]
---

**Cause.** The drift script demands `certify.mjs functional` only when a module listed by
`certifiedModules()` changes (conductor.mjs, constants.mjs, subcommands.mjs, worktree-hygiene.mjs,
…). archive-gate.mjs is engine source, so it triggers the SWEEPS bucket — but the sweeps do not run
functional tests. A functional test that asserts on archive-gate's refusal text is therefore
exercised by CI and by the next functional certify, never by the commit that changed the text.

**Recognise it.** The drift script prints only the `engine-source … certify.mjs sweeps` line, and
your change alters a string a user or a test reads. That combination is the gap.
