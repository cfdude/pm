---
lesson: a-guard-is-only-as-wide-as-the-events-it-is-wired-to
date: 2026-09-17
trigger: You are writing, reviewing or relying on a mechanical block — a hook matcher, a middleware route list, a CI path filter, an allowlist of subscribed events — and its message, its docs or your own reasoning describe an OBLIGATION rather than the events it is wired to.
cost: pm's reconcile gate guard shipped for five releases matching `Edit|Write|NotebookEdit` while telling the agent it blocked "Completing the reconcile gate is the only way through". A Bash call never reached the hook, so `cat > f <<EOF`, `sed -i` or `tee` wrote the same file in one hop. Two things hid it: the VERB was correct — fed a Bash payload by hand it exited 2 — and the gap was purely the matcher, which no test read; and the sentence claiming exhaustiveness was in the block's own output, where it read as a fact rather than a claim. It was found by a comprehensive code review, not by any test, and closing it took a release of its own.
rule: A guard's reach is the set of events it is SUBSCRIBED to, never the set of actions its message forbids. Before trusting one, read its subscription list from the shipped configuration and name one action that achieves the forbidden outcome through an unsubscribed event — and make its message state the obligation and its own incompleteness, never exhaustiveness.
enforced_in: scripts/test/gate-guard-write-paths.test.mjs asserts the shipped hooks.json matcher covers every tool the block claims, and the block message is asserted to STATE the obligation while no longer claiming to be the only way through; hooks/README.md carries the per-matcher rationale, which scripts/test/hooks-schema.test.mjs binds to hooks.json
tags: [verification, guards, hooks, false-signal]
---

**Cause.** A guard is two artifacts in two files: the decision (a function) and the subscription (a
matcher, a route, a path filter). Tests reach for the decision, because that is where the logic is
and where a case table is cheap to write. The subscription is one string in a config file that
nothing imports, and it is invisible from the decision's side — feed the verb a Bash payload by
hand and it behaves correctly, which is exactly what the first investigation did and exactly why
it concluded the guard was fine.

**Why the message made it worse.** The block printed "Completing the reconcile gate is the only way
through." That is a claim about the SUBSCRIPTION, written by someone reasoning about the decision.
An agent reading it has no way to check it, and a reader auditing the code reads it as a summary of
behaviour rather than as an assertion needing proof. The sibling failure is
[[a-guard-can-check-the-wrong-half]]: there a test proved the half it asserted rather than the half
it was named for; here a MESSAGE did.

**The step, and it is two minutes.** Read the subscription out of the file that ships — not from
memory and not from the code that consumes it. Then name, out loud, one action that reaches the
forbidden outcome through an event the subscription does not carry. If you cannot name one, the
guard may be complete; if you can, you have found the defect before a reviewer does. Widening the
subscription is usually the smaller half of the work: here it was one string, and everything else
in the release was deciding what the guard should do once the events arrived.

**And then do not overclaim in the other direction.** A widened guard that must inspect free text —
a shell command, a URL, a template — is incomplete BY CONSTRUCTION, and
[[a-static-guard-over-dynamic-code-needs-declared-limits]] governs what to do about it: write the
limits down beside the check and make the message say the obligation holds whether or not the check
can see it. A mechanism that admits its own reach is worth more than one that claims a reach it
does not have.
