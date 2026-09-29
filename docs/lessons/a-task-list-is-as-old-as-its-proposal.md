---
lesson: a-task-list-is-as-old-as-its-proposal
date: 2026-09-29
trigger: You are executing one landing step of a multi-step change, and its task text enumerates the files, call sites or line numbers to edit — a list written when the change was proposed, before the earlier steps of the same change created, moved or renamed files.
cost: certification-record-redesign (0.51.0), four landing steps. 2.4's call-site list missed functional/certify-index.test.mjs, which L1 had created after the list was written (it imported RECORD_NAME and contentHash and asserted on the single-file record at seven sites), and did not name sweepIds() or the whole of recordRefusals(), which retired with it (evidence-2.4.txt, verify-2.4.txt). 3.1's list of fixtures copying certification.mjs missed the certify-index and drift-script fixtures, both created by earlier steps; without js-lexer.mjs they would have failed to load (be100e04's message: "found by rg, not listed by the task"). Every step from 2.4 on re-derived drifted line citations by hand (verify-2.4.txt, verify-3.3.txt, and 5.1 for L4's). Each miss was caught before commit only because the task's own Verify rg, or the executor's, re-derived the set.
rule: Treat a task's enumeration as a floor, never the set. Before editing, re-derive it with `rg` over today's tree — every caller of each name the task retires, every copier of each file it moves — and diff that against the list; edit the union, and write the difference into the step's evidence file so the next step's list can be corrected. When AUTHORING such a task, give the rg that derives the list beside the list.
enforced_in: habit, plus required task item 1 (the call-site sweep derives callers with rg, never a typed list) — which binds at the END of a change; nothing binds at the start of each landing step.
tags: [absent-edit, tasks, call-sites, multi-step]
---

**Cause.** A multi-step change's tasks are written at proposal time, against the tree as it was.
Each landing step then changes that tree — it adds test files, fixtures and modules the later steps'
lists could not name. The later list is still exact about everything it names, which is what makes
it look complete; what it lacks is everything created since, and a list gives no sign of what it
does not hold.

**Relation to `bind-rules-to-functions-not-enumerations`.** That lesson is for the author of a rule;
this one is for the executor of a stale enumeration inside the same change. Its trigger fires at a
different moment — the start of a landing step — and the fix is the executor's, not the author's.
