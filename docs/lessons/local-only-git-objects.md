---
lesson: local-only-git-objects
date: 2026-08-25
trigger: Pinning a commit hash into a test, doc, or fixture, or relying on `git` history being present in the checkout that runs it.
cost: Four integrity tests passed 604/604 locally and failed CI. Five pinned hashes were feature-branch commits a squash-merge had left unreachable from every branch — alive only in the authoring clone's object store — and `actions/checkout` clones shallow, so even the reachable ones were absent.
rule: Derive hashes from `rev-list` at run time, never pin them; and if a test reads git history, the CI checkout must be `fetch-depth: 0`.
enforced_in: scripts/test/conductor-15.test.mjs (requireHistory), .github/workflows/ci.yml
tags: [verification, false-signal, ci]
---

**Cause.** Two independent ways a clone can lack a commit the author can see:

1. **Squash-merge orphans the branch's commits.** They stay in the authoring clone (reflog keeps
   them alive until gc) and are reachable from nothing. No fresh clone has them, at any depth.
2. **CI clones shallow.** `actions/checkout` defaults to `fetch-depth: 1` — one commit, and every
   ancestry question answers "unknown".

**Why it hid.** The check under test treats "git could not answer" as `null` and reports nothing —
correct behaviour, and exactly what makes the absence silent. Locally the hashes resolved, so the
tests looked like they were exercising real ancestry. They were, in one clone on earth.

**The tell.** A test whose comment says "evaluated against THIS repository's real history" is
asserting something about the *environment*, not about the code. Ask what a fresh clone has.

**Fix shape.** Derive: `git rev-list --first-parent --abbrev-commit -n 12 HEAD`, index into it,
and guard on the list being long enough with a message that names `fetch-depth`. Then a shallow
clone fails with the cause instead of `0 !== 1`. See [[hardcoded-live-data-claims-rot]] — same
family: a verification pinned to a fact that was only ever true where it was written.
