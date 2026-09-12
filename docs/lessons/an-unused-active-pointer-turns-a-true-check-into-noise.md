---
title: Running a multi-epic release without ever setting the active pointer turns a true check into twelve false ones
trigger: You are working a release with several member epics, closing them one at a time, and you
  have not run `set-active` on the one you are actually working.
cost: `delivered-release-epic-left-open` fired TWELVE times mid-release — every not-yet-done member
  of an in-flight release — and blocked a commit, because the pre-commit hook runs a suite with
  tests asserting that check is quiet. One `set-active` took it back to zero.
enforced_in: Nothing mechanical. `integrity.mjs`'s own comment states the heuristic and names this
  exact failure; the gap is operator behaviour, which is why this is a lesson and not a guard.
detect: conductor\.mjs (release|update-epic) [^\n]*--(member|status archived)
---

## What happened

A ten-member release object was created up front, and members were archived as each landed — the
right shape. But no epic was ever marked `active`, because the work was being driven from a task
list rather than from the conductor's own pointer.

`delivered-release-epic-left-open` reads "this release has delivered" as **at least one member
carries a `delivered` disposition** — deliberately, because a release object has no delivery marker
and *"a marker an agent must remember to set is the same class of forgetting that produced the
defect."* Its in-flight guard is: a release holding any `active` or `paused` member is silent.

With no active member, the second member to be archived made the first ten open siblings all read
as forgotten work. Twelve findings, every one false.

## The check was right and I was wrong

The comment in `scripts/lib/integrity.mjs` says this outright:

> It is a heuristic and it is stated as one — a repo that never marks an epic `active` gets this
> check firing mid-release, and the two remedies it prints are both correct answers in that case
> anyway.

So the behaviour was documented before it happened, in the file that produced it. The failure was
not reading the design of the thing that was complaining.

## The rule

**Set the active pointer when you start work on an epic, not as bookkeeping afterwards.** `/pm:next`
and `set-active` exist to hold "what is in flight"; the release checks read that answer. Driving a
release from an external plan while leaving the pointer null does not just lose the briefing — it
makes a check that exists to catch a genuinely forgotten release cry wolf once per open member.

And the second-order cost is the one that matters: an inflated count is precisely how a true
warning gets ignored. That is `gh-138`'s failure, and it is named three paragraphs above the code
that produced it.

## The recurrence has a shape: ARCHIVING the active epic leaves the pointer null

Hit three times in one session, and the first fix did not prevent the second or third, because the
rule as first written was *"set the pointer when you start work"* — which I did. What I did not do
is set it again after **archiving** the epic it pointed at.

`update-epic <id> --status archived` clears `.active` as a side effect, correctly. But a release
mid-flight almost always still holds open members, so the moment the last active epic archives, the
check has a delivered release, open siblings, and nothing marked in flight. It fires once per open
member.

So the rule has a second half: **after archiving an epic, point the pointer at what you are doing
next, before anything else reads the record.** If nothing is next, the release is finished and the
open members should be closed or deferred — which is the check telling the truth rather than
crying wolf.

The tell is a suite that was green minutes ago going red on live-record tests with no code change
between the two runs.

## Before reaching for the source of a noisy check, read its comment

Twelve findings looked like a bug in the check. The fix was one command, and the comment named it.
Related: `[[hardcoded-live-data-claims-rot]]`, and the closeout ordering in this repo's memory.
