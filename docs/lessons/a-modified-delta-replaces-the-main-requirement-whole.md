---
title: A trimmed MODIFIED requirement silently loses every clause you cut
trigger: You are shortening or rewording a requirement inside a `## MODIFIED Requirements` delta
  (for example to get under a length limit), and the delta restates a requirement that already
  exists in a main spec.
cost: In release-planning-taxonomy a board-export MODIFIED delta was trimmed below 500 characters
  and the clause saying control characters are escaped dropped out of it. `openspec validate
  --strict` passed. Only Gate 1 round 3 noticed, by reading the delta against the main
  requirement. Had it shipped, archive would have replaced the main requirement with the
  trimmed text and the clause would have been gone from the spec of record.
rule: A MODIFIED delta replaces the main requirement WHOLE. Before trimming one, diff its text
  against the main spec's requirement and confirm every clause you remove is one you mean to
  delete. Restore anything that is not.
enforced_in: Nothing mechanical. `openspec validate` checks the delta's shape, not what it drops
  from the requirement it replaces. Gate 1 and the cross-spec review are the catch. The `detect:`
  matcher is omitted on purpose: a trim is not recognisable from a tool call.
---

## What happened

The delta was edited down for length. The dropped clause (control characters escaped in an emitted
reason) was a behavioural requirement, not prose, and nothing failed. It was restored in commit
2d164548.

## Why it is silent

A MODIFIED delta is not a patch. Archive swaps the whole requirement for the delta's text, so a
clause absent from the delta is absent from the spec afterwards, with no diff shown at archive
time.
