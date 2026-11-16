---
title: When a reviewer offers a weaker and a stricter fix, take the stricter one first
trigger: A Gate 1 or cross-spec reviewer's finding offers two fixes, one that exempts or relaxes
  an existing rule for the new case and one that makes the new case obey the rule, and you are
  about to choose.
cost: release-planning-taxonomy took three Gate 1 rounds. The first fix exempted non-goal ids from
  the board id-format rule (the weaker option). Cross-spec round 2 reversed it, so non-goal ids
  were brought under the rule after all, which meant re-amending the board-export delta, the
  tasks and the changeset a second time. Each round is a fresh-context reviewer dispatch plus a
  re-record of the gate.
rule: Prefer the fix that makes the new thing obey the existing closed rule over the one that
  adds an exemption. An exemption is a second rule every later spec must also reconcile, and a
  cross-spec reviewer will find it. Take the exemption only when the stricter fix is impossible,
  and say why on the finding.
enforced_in: Nothing mechanical; choosing between two fixes is judgment. The release-scope
  cross-spec review (gate item 5) is where a wrong choice is caught, which is how this one was.
  The `detect:` matcher is omitted on purpose: the situation is not recognisable from a tool call.
---

## What happened

A Gate 1 review of `release-planning-taxonomy` found that non-goal ids (`n1`, `n2`) did not match
the board id format. It offered two fixes: exempt non-goal ids from the format, or put them under
it. The exemption was cheaper to write, so it was taken. The cross-spec review of the whole 0.56.0
spec set then showed the exemption forked the board-export contract (every emitted id passes the
format, except these), and the fix was reversed in round 2. The work done twice was real.

## Why the stricter fix wins

A closed list or a single format rule is what lets every other spec reason about the export. An
exemption keeps the finding quiet in the one spec it was raised against and moves the cost to the
release-scope review.
